import { spawn, type ChildProcess } from "node:child_process";
import { config, resolveCookiesFile, type AppConfig } from "../config";

/**
 * Camada única de acesso ao binário do yt-dlp:
 * - monta os argumentos comuns (cookies, proxy, PO token, ffmpeg, extras da env);
 * - SEMPRE separa a URL com "--" para que nada vindo do usuário seja interpretado como opção;
 * - aplica timeout e limita quantos processos rodam ao mesmo tempo.
 */

let cookiesFile: string | null | undefined;
export function getCookiesFile(): string | null {
    if (cookiesFile === undefined) cookiesFile = resolveCookiesFile(config);
    return cookiesFile;
}

export function buildCommonArgs(cfg: AppConfig["ytdlp"], cookies: string | null): string[] {
    const args = ["--no-warnings"];

    if (cookies) args.push("--cookies", cookies);
    if (cfg.proxy) args.push("--proxy", cfg.proxy);
    if (cfg.ffmpegLocation) args.push("--ffmpeg-location", cfg.ffmpegLocation);

    const youtubeArgs: string[] = [];
    if (cfg.playerClient) youtubeArgs.push(`player_client=${cfg.playerClient}`);
    if (cfg.poToken) youtubeArgs.push(`po_token=${cfg.poToken}`);
    if (youtubeArgs.length) args.push("--extractor-args", `youtube:${youtubeArgs.join(";")}`);

    args.push(...cfg.extraArgs);
    return args;
}

/** Monta a linha final: comuns + específicos + "--" + URL(s). */
export function buildArgs(
    specific: string[],
    urls: string | string[],
    cfg = config.ytdlp,
    cookies = getCookiesFile()
): string[] {
    return [...buildCommonArgs(cfg, cookies), ...specific, "--", ...(Array.isArray(urls) ? urls : [urls])];
}

// ---------- Semáforo simples ----------
class Semaphore {
    private queue: (() => void)[] = [];
    private active = 0;
    constructor(private readonly max: number) {}

    async acquire(): Promise<() => void> {
        if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
        this.active++;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.active--;
            this.queue.shift()?.();
        };
    }
}

// Downloads + listagens + buscas compartilham o mesmo limite de processos.
const processLimit = new Semaphore(
    Math.max(config.limits.maxConcurrentJobs * config.ytdlp.downloadConcurrency, config.ytdlp.topicLookupConcurrency) + 1
);

export type RunOptions = {
    timeoutMs: number;
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
    /** Cancela (mata o processo) quando abortado — ex.: cliente fechou a conexão. */
    signal?: AbortSignal;
};

export type RunResult = { code: number | null; stderr: string; timedOut: boolean; aborted?: boolean };

/** Executa o yt-dlp, entregando stdout linha a linha. Nunca usa shell. */
export async function runYtDlp(args: string[], opts: RunOptions): Promise<RunResult> {
    if (opts.signal?.aborted) return { code: null, stderr: "", timedOut: false, aborted: true };
    const release = await processLimit.acquire();
    try {
        if (opts.signal?.aborted) return { code: null, stderr: "", timedOut: false, aborted: true };
        return await new Promise<RunResult>((resolve, reject) => {
            let proc: ChildProcess;
            try {
                proc = spawn(config.ytdlp.bin, args, { shell: false, windowsHide: true });
            } catch (err) {
                return reject(err);
            }

            let stderr = "";
            let timedOut = false;
            let aborted = false;
            const timer = setTimeout(() => {
                timedOut = true;
                proc.kill("SIGKILL");
            }, opts.timeoutMs);
            const onAbort = () => {
                aborted = true;
                proc.kill("SIGKILL");
            };
            opts.signal?.addEventListener("abort", onAbort, { once: true });

            const lineReader = (cb?: (line: string) => void) => {
                let buf = "";
                return {
                    push(chunk: Buffer) {
                        buf += chunk.toString();
                        // yt-dlp usa \r para atualizar progresso na mesma linha
                        const parts = buf.split(/\r?\n|\r/);
                        buf = parts.pop() ?? "";
                        if (cb) for (const p of parts) if (p.trim()) cb(p);
                    },
                    flush() {
                        if (cb && buf.trim()) cb(buf);
                        buf = "";
                    },
                };
            };

            const out = lineReader(opts.onStdoutLine);
            const err = lineReader((line) => {
                stderr = (stderr + line + "\n").slice(-4000);
                opts.onStderrLine?.(line);
            });

            proc.stdout?.on("data", (c: Buffer) => out.push(c));
            proc.stderr?.on("data", (c: Buffer) => err.push(c));
            proc.on("error", (e: NodeJS.ErrnoException) => {
                clearTimeout(timer);
                opts.signal?.removeEventListener("abort", onAbort);
                reject(
                    e.code === "ENOENT"
                        ? new Error(`yt-dlp não encontrado ("${config.ytdlp.bin}"). Instale-o ou defina YTDLP_PATH.`)
                        : e
                );
            });
            proc.on("close", (code) => {
                clearTimeout(timer);
                opts.signal?.removeEventListener("abort", onAbort);
                out.flush();
                err.flush();
                resolve({ code, stderr, timedOut, aborted });
            });
        });
    } finally {
        release();
    }
}

/** Traduz erros conhecidos do yt-dlp em mensagens úteis para o usuário. */
export function explainYtDlpError(stderr: string): string | null {
    if (/Sign in to confirm you.re not a bot|confirm your age|LOGIN_REQUIRED/i.test(stderr)) {
        return "O YouTube bloqueou a requisição do servidor (verificação anti-bot). Configure cookies, proxy ou PO token.";
    }
    if (/HTTP Error 429|Too Many Requests/i.test(stderr)) {
        return "O YouTube está limitando requisições deste servidor (429). Tente novamente mais tarde.";
    }
    if (/The playlist does not exist|This playlist .* (private|unavailable)/i.test(stderr)) {
        return "Playlist inexistente ou privada.";
    }
    if (/Private video|Video unavailable/i.test(stderr)) {
        return "Vídeo privado ou indisponível.";
    }
    return null;
}

let cachedVersion: Promise<string | null> | null = null;
export function getYtDlpVersion(): Promise<string | null> {
    cachedVersion ??= new Promise((resolve) => {
        try {
            const p = spawn(config.ytdlp.bin, ["--version"], { shell: false, windowsHide: true });
            let out = "";
            p.stdout.on("data", (d) => (out += d));
            p.on("error", () => resolve(null));
            p.on("close", (code) => resolve(code === 0 ? out.trim() : null));
        } catch {
            resolve(null);
        }
    });
    return cachedVersion;
}
