import express, { Request, Response } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { getPlaylist, downloadMP3, getCookiesPath } from "./helper/youtube.adapter";
import { clearFolder, zipFolder } from "./helper/zipper";
import { Video, DownloadProgressEvent } from "./type/video.type";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "../public")));

interface JobData {
    id: string;
    status: "pending" | "downloading" | "zipping" | "completed" | "error";
    videos: Video[];
    zipName: string;
    zipPath: string;
    tempFolder: string;
    currentIndex: number;
    totalCount: number;
    currentVideo?: Video;
    percent: number;
    message: string;
    error?: string;
    clients: Response[];
    createdAt: number;
}

const jobs = new Map<string, JobData>();

function broadcastJob(job: JobData) {
    const payload: DownloadProgressEvent = {
        jobId: job.id,
        status: job.status,
        currentIndex: job.currentIndex,
        totalCount: job.totalCount,
        currentVideo: job.currentVideo
            ? {
                  id: job.currentVideo.id,
                  title: job.currentVideo.title,
                  author: job.currentVideo.author,
              }
            : undefined,
        percent: job.percent,
        message: job.message,
        downloadUrl:
            job.status === "completed"
                ? `/api/download/${job.id}/zip`
                : undefined,
    };

    const sseData = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of job.clients) {
        try {
            client.write(sseData);
        } catch (err) {
            // Client probably disconnected
        }
    }
}

// Periodic cleanup of stale jobs (older than 1 hour)
setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs.entries()) {
        if (now - job.createdAt > 3600 * 1000) {
            clearFolder(job.tempFolder, true);
            if (fs.existsSync(job.zipPath)) {
                try {
                    fs.unlinkSync(job.zipPath);
                } catch {}
            }
            jobs.delete(id);
        }
    }
}, 600 * 1000);

// Endpoint to fetch playlist metadata
app.post("/api/playlist", async (req: Request, res: Response) => {
    try {
        const { url } = req.body;
        if (!url || typeof url !== "string") {
            return res.status(400).json({ error: "URL da playlist é obrigatória." });
        }

        console.log(`[API] Buscando playlist: ${url}`);
        const videos = await getPlaylist(url);

        if (!videos || videos.length === 0) {
            return res.status(404).json({
                error: "Nenhuma música encontrada. Verifique se a URL está correta e se a playlist é pública/não listada.",
            });
        }

        return res.json({
            success: true,
            total: videos.length,
            videos,
        });
    } catch (err: any) {
        console.error("[API Error] Falha ao obter playlist:", err);
        return res.status(500).json({
            error: err.message || "Erro interno ao processar a playlist.",
        });
    }
});

// Endpoint to start a batch download job
app.post("/api/download", async (req: Request, res: Response) => {
    try {
        const { videos, zipName } = req.body as {
            videos: Video[];
            zipName?: string;
        };

        if (!videos || !Array.isArray(videos) || videos.length === 0) {
            return res.status(400).json({ error: "Nenhuma música selecionada para download." });
        }

        const jobId = crypto.randomUUID();
        const baseTemp = path.join(process.cwd(), "tmp_downloads");
        const tempFolder = path.join(baseTemp, jobId);
        const zipFileName = (zipName || "playlist").replace(/[<>:"/\\|?*]+/g, "") + ".zip";
        const zipPath = path.join(baseTemp, `${jobId}_${zipFileName}`);

        if (!fs.existsSync(tempFolder)) {
            fs.mkdirSync(tempFolder, { recursive: true });
        }

        const job: JobData = {
            id: jobId,
            status: "pending",
            videos,
            zipName: zipFileName,
            zipPath,
            tempFolder,
            currentIndex: 0,
            totalCount: videos.length,
            percent: 0,
            message: "Iniciando fila de downloads...",
            clients: [],
            createdAt: Date.now(),
        };

        jobs.set(jobId, job);

        // Process queue in background
        processDownloadQueue(job);

        return res.json({
            success: true,
            jobId,
            total: videos.length,
        });
    } catch (err: any) {
        console.error("[API Error] Falha ao iniciar download:", err);
        return res.status(500).json({ error: err.message || "Erro ao iniciar download." });
    }
});

async function processDownloadQueue(job: JobData) {
    job.status = "downloading";

    for (let i = 0; i < job.videos.length; i++) {
        const video = job.videos[i];
        job.currentIndex = i + 1;
        job.currentVideo = video;
        job.percent = 0;
        job.message = `Baixando [${job.currentIndex}/${job.totalCount}]: ${video.author} - ${video.title}`;
        broadcastJob(job);

        // Format clean filename: "Author - Title"
        const cleanFilename = `${video.author} - ${video.title}`
            .replace(/[<>:"/\\|?*]+/g, "")
            .replace(/\s+/g, " ")
            .trim();

        try {
            await downloadMP3(
                video.url,
                cleanFilename,
                job.tempFolder,
                video.author,
                video.title,
                video.rawAlbum,
                {
                    onProgress: (percent) => {
                        job.percent = Math.round(percent);
                        broadcastJob(job);
                    },
                }
            );
        } catch (err: any) {
            console.error(`[Download Error] Erro no vídeo ${video.id}:`, err);
            // Clean up any residual partial files or thumbnails for this failed track
            try {
                const files = fs.readdirSync(job.tempFolder);
                for (const file of files) {
                    if (file.startsWith(cleanFilename) && !file.endsWith(".mp3")) {
                        fs.unlinkSync(path.join(job.tempFolder, file));
                    }
                }
            } catch {}
            job.message = `Aviso: Falha ao baixar ${video.title}. Pulando...`;
            broadcastJob(job);
        }
    }

    // Zip process
    job.status = "zipping";
    job.percent = 100;
    job.message = "Finalizando e preparando download...";
    broadcastJob(job);

    try {
        const mp3Count = await zipFolder(job.tempFolder, job.zipPath);
        // Clear unzipped audio files to save disk space immediately
        clearFolder(job.tempFolder, true);

        if (mp3Count === 0) {
            job.status = "error";
            job.message = "Nenhuma música pôde ser baixada com sucesso (0 faixas em MP3).";
            broadcastJob(job);
            return;
        }

        job.status = "completed";
        job.message = `Download concluído com sucesso! (${mp3Count} faixa(s) em MP3)`;
        broadcastJob(job);
    } catch (err: any) {
        console.error("[Zip Error]:", err);
        job.status = "error";
        job.message = "Erro ao preparar download.";
        broadcastJob(job);
    }
}

// SSE Progress Endpoint
app.get("/api/progress/:jobId", (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ error: "Job não encontrado." });
    }

    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });

    job.clients.push(res);

    // Send initial status immediately
    broadcastJob(job);

    req.on("close", () => {
        job.clients = job.clients.filter((c) => c !== res);
    });
});

// Download ZIP file
app.get("/api/download/:jobId/zip", (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = jobs.get(jobId);

    if (!job || !fs.existsSync(job.zipPath)) {
        return res.status(404).send("Arquivo não encontrado ou já expirado.");
    }

    res.download(job.zipPath, job.zipName, (err) => {
        if (err) {
            console.error("[Download Send Error]:", err);
        }

        // Clean zip after download to avoid duplicating files on disk
        setTimeout(() => {
            try {
                if (fs.existsSync(job.zipPath)) {
                    fs.unlinkSync(job.zipPath);
                }
                jobs.delete(jobId);
            } catch {}
        }, 5000);
    });
});

// Status / Health check
app.get("/api/status", (req: Request, res: Response) => {
    res.json({
        status: "ok",
        cookiesPresent: getCookiesPath() !== null,
        uptime: process.uptime(),
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT} (http://localhost:${PORT})`);
});
