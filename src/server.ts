import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { config } from "./config";
import { DownloadError, downloadMP3, enrichPlaylist, findReplacement, listPlaylist, removePartialFiles } from "./helper/youtube.adapter";
import { zipFolder } from "./helper/zipper";
import { removeQuietly } from "./helper/fsRetry";
import { createRateLimiter } from "./helper/rateLimit";
import { DownloadItem, ValidationError, parseDownloadRequest, parseYoutubeUrl, safeFilename } from "./helper/validation";
import { getCookiesFile, getYtDlpVersion } from "./helper/ytdlp";
import { DownloadProgressEvent } from "./type/video.type";

const app = express();

app.disable("x-powered-by");
if (config.server.trustProxy) app.set("trust proxy", 1);
if (config.server.corsOrigins.length) app.use(cors({ origin: config.server.corsOrigins }));
// Sem limite de faixas por download: uma lista de alguns milhares de faixas ocupa poucos MB.
app.use(express.json({ limit: "10mb" }));
app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    next();
});
app.use(express.static(config.server.publicDir, { index: "index.html", maxAge: config.isProd ? "1h" : 0 }));

const limiter = createRateLimiter(config.limits.rateLimitPerWindow, config.limits.rateLimitWindowMinutes * 60_000);

// ---------- Jobs ----------
interface JobData {
    id: string;
    status: DownloadProgressEvent["status"];
    items: DownloadItem[];
    zipName: string;
    zipPath: string;
    tempFolder: string;
    currentIndex: number;
    totalCount: number;
    currentItem?: DownloadItem;
    percent: number;
    message: string;
    clients: Response[];
    createdAt: number;
    /** Último uso (criação, conclusão, download do ZIP) — base da expiração. */
    lastAccess: number;
    /** Cancela o processamento quando o job é descartado. */
    abort: AbortController;
    mp3Count?: number;
    /** Progresso (0–100) de cada faixa, pelo índice. */
    progress: number[];
    completedCount: number;
    failedIds: string[];
}

const jobs = new Map<string, JobData>();
const isRunning = (j: JobData) => j.status === "pending" || j.status === "downloading" || j.status === "zipping";
const activeJobs = () => [...jobs.values()].filter(isRunning).length;

function broadcastJob(job: JobData) {
    const payload: DownloadProgressEvent = {
        jobId: job.id,
        status: job.status,
        currentIndex: job.currentIndex,
        totalCount: job.totalCount,
        currentVideo: job.currentItem
            ? { id: job.currentItem.id, title: job.currentItem.title, author: job.currentItem.author }
            : undefined,
        percent: job.percent,
        overallPercent: job.progress.length ? job.progress.reduce((a, b) => a + b, 0) / job.progress.length : 0,
        completedCount: job.completedCount,
        failedIds: job.failedIds,
        message: job.message,
        downloadUrl: job.status === "completed" ? `/api/download/${job.id}/zip` : undefined,
    };
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of job.clients) {
        try {
            client.write(data);
        } catch {
            // cliente desconectado
        }
    }
}

function removeJobFiles(job: JobData) {
    removeQuietly(job.tempFolder);
    removeQuietly(job.zipPath);
}

/**
 * Descarta o job. Se ainda estiver baixando, só cancela: a fila apaga os arquivos quando o
 * yt-dlp terminar de fato (no Windows ele segura o .part até o processo morrer).
 */
function removeJob(job: JobData) {
    const running = isRunning(job);
    job.abort.abort();
    if (!running) removeJobFiles(job);
    for (const c of job.clients) c.end();
    jobs.delete(job.id);
}

/** Pasta/ZIP de job: "<uuid>" ou "<uuid>.zip". Só esses nomes são apagados pela varredura. */
const JOB_ENTRY = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(.zip)?$/i;

/**
 * Apaga sobras de jobs que não existem mais (servidor reiniciado, cancelamentos).
 * Os jobs vivem só em memória, então no boot tudo que estiver em DATA_DIR é órfão.
 */
function sweepOrphans(minAgeMs: number) {
    let entries: string[];
    try {
        entries = fs.readdirSync(config.storage.dataDir);
    } catch {
        return;
    }
    for (const name of entries) {
        const m = name.match(JOB_ENTRY);
        if (!m || jobs.has(m[1].toLowerCase())) continue;
        const full = path.join(config.storage.dataDir, name);
        try {
            if (Date.now() - fs.statSync(full).mtimeMs < minAgeMs) continue;
            fs.rmSync(full, { recursive: true, force: true });
        } catch {
            // em uso ou já removido
        }
    }
}

setInterval(() => {
    const ttl = config.storage.jobTtlMinutes * 60_000;
    // Só expira o que já terminou: um download longo (playlist grande) não pode ser cortado no meio.
    for (const job of jobs.values()) if (!isRunning(job) && Date.now() - job.lastAccess > ttl) removeJob(job);
    sweepOrphans(5 * 60_000);
}, 60_000).unref();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function processDownloadQueue(job: JobData) {
    try {
        await runQueue(job);
    } finally {
        // Cancelado (descartado, outra playlist, servidor encerrando): o yt-dlp já saiu, então dá para apagar tudo.
        if (job.abort.signal.aborted) removeJobFiles(job);
    }
}

/** Nome de arquivo único dentro do job (duas faixas com o mesmo "Artista - Título" não se sobrescrevem). */
function uniqueFilename(base: string, used: Set<string>): string {
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    used.add(name.toLowerCase());
    return name;
}

/** Baixa uma faixa, repetindo em falhas passageiras. Retorna false se ela teve de ser pulada. */
async function downloadWithRetries(
    job: JobData,
    item: DownloadItem,
    filename: string,
    onProgress: (percent: number) => void
): Promise<boolean> {
    const maxAttempts = 1 + config.ytdlp.downloadRetries;
    let url = item.url;
    const tried = [item.id];
    let lookups = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await downloadMP3(url, filename, job.tempFolder, item.author, item.title, item.album, {
                onProgress,
                signal: job.abort.signal,
            });
            return true;
        } catch (err) {
            if (job.abort.signal.aborted) return false;
            const message = (err as Error).message;
            const retryable = err instanceof DownloadError && err.retryable;
            removePartialFiles(job.tempFolder, filename);

            // Indisponível: tenta o vídeo equivalente que o YouTube Music toca no lugar (as tags editadas continuam).
            // Até 2 buscas: o substituto do YouTube Music e, se ele também estiver bloqueado, a mesma faixa por busca.
            if (err instanceof DownloadError && err.unavailable && lookups < 2) {
                lookups++;
                job.message = `"${item.title}" está indisponível. Procurando versão equivalente...`;
                broadcastJob(job);
                const found = await findReplacement(item.id, item, job.abort.signal, tried);
                if (job.abort.signal.aborted) return false;
                if (found) {
                    console.warn(`[download] ${item.id}: indisponível, usando ${found.id} (${found.author} - ${found.title})`);
                    tried.push(found.id);
                    url = `https://www.youtube.com/watch?v=${found.id}`;
                    job.message = `Baixando versão equivalente de "${item.title}"`;
                    broadcastJob(job);
                    attempt--; // a troca não conta como tentativa
                    continue;
                }
            }

            if (retryable && attempt < maxAttempts) {
                console.warn(`[download] ${item.id}: tentativa ${attempt} falhou (${message}). Tentando de novo...`);
                onProgress(0);
                job.message = `Falha temporária em "${item.title}". Tentando de novo (${attempt + 1}/${maxAttempts})...`;
                broadcastJob(job);
                await sleep(2000 * attempt);
                if (job.abort.signal.aborted) return false;
                continue;
            }
            console.error(`[download] ${item.id}: ${message}`);
            job.message = `Falha em "${item.title}": ${message}. Pulando...`;
            broadcastJob(job);
            return false;
        }
    }
    return false;
}

async function runQueue(job: JobData) {
    job.status = "downloading";
    const usedNames = new Set<string>();
    const failures: string[] = [];
    let next = 0;
    let lastBroadcast = 0;
    const throttledBroadcast = () => {
        // evita inundar o SSE com dezenas de eventos por segundo
        if (Date.now() - lastBroadcast > 250) {
            lastBroadcast = Date.now();
            broadcastJob(job);
        }
    };

    const worker = async () => {
        while (!job.abort.signal.aborted && next < job.items.length) {
            const i = next++;
            const item = job.items[i];
            // currentIndex = faixas concluídas; currentItem = a última que começou
            job.currentItem = item;
            job.message = `Baixando: ${item.author} - ${item.title}`;
            broadcastJob(job);

            const filename = uniqueFilename(safeFilename(`${item.author} - ${item.title}`, item.id), usedNames);
            const ok = await downloadWithRetries(job, item, filename, (percent) => {
                job.progress[i] = percent;
                job.percent = Math.round(percent);
                throttledBroadcast();
            });
            if (job.abort.signal.aborted) return;

            job.progress[i] = 100;
            job.completedCount++;
            job.currentIndex = job.completedCount;
            if (!ok) {
                failures.push(item.title);
                job.failedIds.push(item.id);
            }
            broadcastJob(job);

            if (config.ytdlp.sleepBetweenDownloadsMs && next < job.items.length) {
                await sleep(config.ytdlp.sleepBetweenDownloadsMs);
            }
        }
    };

    const workers = Math.min(config.ytdlp.downloadConcurrency, job.items.length);
    await Promise.all(Array.from({ length: workers }, worker));

    if (job.abort.signal.aborted) return;
    job.status = "zipping";
    job.percent = 100;
    job.message = "Compactando arquivos...";
    broadcastJob(job);

    try {
        const mp3Count = await zipFolder(job.tempFolder, job.zipPath);
        removeQuietly(job.tempFolder);
        if (job.abort.signal.aborted) return;
        job.mp3Count = mp3Count;
        job.lastAccess = Date.now();

        if (mp3Count === 0) {
            job.status = "error";
            job.message = "Nenhuma música pôde ser baixada.";
        } else {
            job.status = "completed";
            job.message = `Concluído · ${mp3Count} de ${job.totalCount} faixa(s)`;
            if (failures.length) job.message += ` · falharam: ${failures.join(", ")}`;
        }
    } catch (err) {
        console.error("[zip]", err);
        job.status = "error";
        job.message = "Erro ao gerar o arquivo ZIP.";
        job.lastAccess = Date.now();
    }
    broadcastJob(job);
}

// ---------- Rotas ----------
/**
 * Lista a playlist em stream (NDJSON, uma mensagem JSON por linha):
 *   {"type":"list","videos":[...],"pending":N}   → imediatamente, com a listagem rápida
 *   {"type":"track","id":"<id original>","video":{...}} → cada faixa conforme os metadados chegam
 *   {"type":"done"}
 * Se o cliente desconectar, as consultas ao yt-dlp em andamento são canceladas.
 */
app.post("/api/playlist", limiter.middleware, async (req: Request, res: Response, next: NextFunction) => {
    const abort = new AbortController();
    res.on("close", () => {
        if (!res.writableFinished) abort.abort();
    });

    let videos;
    try {
        const url = parseYoutubeUrl(req.body?.url);
        videos = await listPlaylist(url, abort.signal);
    } catch (err) {
        return next(err);
    }
    if (abort.signal.aborted) return;
    if (videos.length === 0) {
        return res.status(404).json({
            error: "Nenhuma música encontrada. Verifique se a URL está correta e se a playlist é pública ou não listada.",
        });
    }

    res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
    });
    const send = (msg: unknown) => {
        if (!res.writableEnded) res.write(JSON.stringify(msg) + "\n");
    };

    const pending = videos.filter((v) => v.metadataSource === "pending").length;
    send({ type: "list", videos, pending });

    try {
        await enrichPlaylist(videos, (id, video) => send({ type: "track", id, video }), abort.signal);
        send({ type: "done" });
    } catch (err) {
        console.error("[metadata]", err);
        send({ type: "error", error: "Falha ao buscar parte dos metadados." });
    }
    res.end();
});

app.post("/api/download", limiter.middleware, (req: Request, res: Response, next: NextFunction) => {
    try {
        const { items, zipName } = parseDownloadRequest(req.body, config.limits.maxTracksPerJob);

        if (activeJobs() >= config.limits.maxConcurrentJobs) {
            res.setHeader("Retry-After", "30");
            return res.status(503).json({ error: "Servidor ocupado com outros downloads. Tente novamente em instantes." });
        }

        const id = crypto.randomUUID();
        const job: JobData = {
            id,
            status: "pending",
            items,
            zipName,
            zipPath: path.join(config.storage.dataDir, `${id}.zip`),
            tempFolder: path.join(config.storage.dataDir, id),
            currentIndex: 0,
            totalCount: items.length,
            percent: 0,
            message: "Iniciando fila de downloads...",
            clients: [],
            createdAt: Date.now(),
            lastAccess: Date.now(),
            abort: new AbortController(),
            progress: items.map(() => 0),
            completedCount: 0,
            failedIds: [],
        };
        fs.mkdirSync(job.tempFolder, { recursive: true });
        jobs.set(id, job);

        processDownloadQueue(job).catch((err) => {
            console.error("[job]", err);
            job.status = "error";
            job.message = "Erro inesperado no processamento.";
            job.lastAccess = Date.now();
            broadcastJob(job);
        });

        res.json({ success: true, jobId: id, total: items.length });
    } catch (err) {
        next(err);
    }
});

app.get("/api/progress/:jobId", (req: Request, res: Response) => {
    const job = jobs.get(String(req.params.jobId));
    if (!job) return res.status(404).json({ error: "Job não encontrado." });

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // desliga buffer do Nginx
    });
    job.clients.push(res);
    broadcastJob(job);

    // Mantém a conexão viva atrás de proxies que derrubam conexões ociosas
    const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => {
        clearInterval(ping);
        job.clients = job.clients.filter((c) => c !== res);
    });
});

app.get("/api/download/:jobId/zip", (req: Request, res: Response) => {
    const job = jobs.get(String(req.params.jobId));
    if (!job || job.status !== "completed" || !fs.existsSync(job.zipPath)) {
        return res.status(404).send("Arquivo não encontrado ou expirado.");
    }
    // O ZIP fica guardado até o usuário descartá-lo (outra playlist, sair da página) ou expirar sem uso.
    job.lastAccess = Date.now();
    res.download(job.zipPath, job.zipName, (err) => {
        if (err && !res.headersSent) console.error("[zip send]", err);
    });
});

/**
 * Descarta o ZIP (e cancela o download, se ainda estiver rodando).
 * POST para funcionar com navigator.sendBeacon ao fechar a página. Idempotente.
 */
app.post("/api/download/:jobId/discard", (req: Request, res: Response) => {
    const job = jobs.get(String(req.params.jobId));
    if (job) removeJob(job);
    res.status(204).end();
});

app.get("/api/status", async (_req: Request, res: Response) => {
    const ytdlpVersion = await getYtDlpVersion();
    res.status(ytdlpVersion ? 200 : 503).json({
        status: ytdlpVersion ? "ok" : "degraded",
        ytdlpVersion,
        cookiesConfigured: getCookiesFile() !== null,
        activeJobs: activeJobs(),
        uptime: Math.round(process.uptime()),
    });
});

app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Rota não encontrada." });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "Requisição muito grande." });
    if (err instanceof SyntaxError) return res.status(400).json({ error: "JSON inválido." });
    console.error("[api]", err);
    res.status(500).json({ error: err?.message || "Erro interno." });
});

// ---------- Boot ----------
fs.mkdirSync(config.storage.dataDir, { recursive: true });
sweepOrphans(0);
getCookiesFile();

const server = app.listen(config.server.port, config.server.host, async () => {
    const version = await getYtDlpVersion();
    console.log(`Servidor em http://localhost:${config.server.port} (${config.env})`);
    console.log(`yt-dlp: ${version ?? "NÃO ENCONTRADO — defina YTDLP_PATH"} · cookies: ${getCookiesFile() ? "sim" : "não"}`);
    if (!fs.existsSync(path.join(config.server.publicDir, "index.html"))) {
        console.warn("Frontend não encontrado em public/. Rode `npm run build` (ou use `npm run dev`).");
    }
});

function shutdown(signal: string) {
    console.log(`${signal} recebido, encerrando...`);
    server.close(() => process.exit(0));
    for (const job of jobs.values()) removeJob(job);
    setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
