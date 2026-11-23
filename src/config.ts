/**
 * Configuração central da aplicação.
 *
 * Todas as variáveis de ambiente são lidas e validadas aqui — o resto do código
 * importa `config` em vez de acessar `process.env` diretamente.
 * Veja `.env.example` para a lista completa e documentação de cada variável.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

// ---------- Parsers ----------
function str(env: Env, key: string, fallback: string): string;
function str(env: Env, key: string): string | undefined;
function str(env: Env, key: string, fallback?: string): string | undefined {
    const v = env[key]?.trim();
    return v ? v : fallback;
}

function int(env: Env, key: string, fallback: number, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number {
    const raw = env[key]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
        throw new ConfigError(`${key} deve ser um inteiro entre ${min} e ${max} (recebido: "${raw}")`);
    }
    return n;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
    const raw = env[key]?.trim().toLowerCase();
    if (!raw) return fallback;
    if (["1", "true", "yes", "on"].includes(raw)) return true;
    if (["0", "false", "no", "off"].includes(raw)) return false;
    throw new ConfigError(`${key} deve ser true/false (recebido: "${env[key]}")`);
}

function list(env: Env, key: string): string[] {
    return (env[key] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Divide argumentos extras respeitando aspas simples/duplas: `--foo "a b" --bar` → ["--foo","a b","--bar"]. */
export function splitArgs(raw: string | undefined): string[] {
    if (!raw) return [];
    const out: string[] = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) out.push(m[1] ?? m[2] ?? m[3]);
    return out;
}

// ---------- Schema ----------
export type AppConfig = ReturnType<typeof buildConfig>;

export function buildConfig(env: Env = process.env, cwd = process.cwd()) {
    const nodeEnv = str(env, "NODE_ENV", "development");
    const isProd = nodeEnv === "production";
    const dataDir = path.resolve(cwd, str(env, "DATA_DIR", isProd ? path.join(os.tmpdir(), "mp3-downloader") : "tmp_downloads"));

    const config = {
        env: nodeEnv,
        isProd,
        server: {
            host: str(env, "HOST", "0.0.0.0"),
            port: int(env, "PORT", 3000, { min: 1, max: 65535 }),
            /** Necessário atrás de proxy reverso (Render, Railway, Fly, Nginx) para pegar o IP real no rate limit. */
            trustProxy: bool(env, "TRUST_PROXY", isProd),
            /** Origens liberadas para CORS. Vazio = só mesma origem (recomendado quando o front é servido pelo próprio servidor). */
            corsOrigins: list(env, "CORS_ORIGINS"),
            publicDir: path.resolve(__dirname, "../public"),
        },
        storage: {
            dataDir,
            jobTtlMinutes: int(env, "JOB_TTL_MINUTES", 60, { min: 1 }),
        },
        limits: {
            /** Músicas por download. 0 = sem limite. */
            maxTracksPerJob: int(env, "MAX_TRACKS_PER_JOB", 0, { min: 0 }),
            /** Faixas lidas de uma playlist. 0 = sem limite. */
            maxPlaylistItems: int(env, "MAX_PLAYLIST_ITEMS", 0, { min: 0 }),
            maxConcurrentJobs: int(env, "MAX_CONCURRENT_JOBS", 2, { min: 1 }),
            /** Requisições por IP por janela em /api/playlist e /api/download. 0 desativa. */
            rateLimitPerWindow: int(env, "RATE_LIMIT_MAX", isProd ? 20 : 0, { min: 0 }),
            rateLimitWindowMinutes: int(env, "RATE_LIMIT_WINDOW_MINUTES", 15, { min: 1 }),
        },
        ytdlp: {
            bin: str(env, "YTDLP_PATH", "yt-dlp"),
            ffmpegLocation: str(env, "FFMPEG_LOCATION"),
            /** Proxy (idealmente residencial) — IPs de datacenter costumam ser bloqueados pelo YouTube. */
            proxy: str(env, "YTDLP_PROXY"),
            /** Ex.: "web,mweb" ou "default". Vazio usa o padrão do yt-dlp (recomendado nas versões recentes). */
            playerClient: str(env, "YTDLP_PLAYER_CLIENT"),
            /** PO token, formato "CLIENTE.CONTEXTO+TOKEN" (ex.: "mweb.gvs+XXX"). */
            poToken: str(env, "YTDLP_PO_TOKEN"),
            /** Argumentos extras repassados a toda chamada do yt-dlp. */
            extraArgs: splitArgs(str(env, "YTDLP_EXTRA_ARGS")),
            /** Busca metadados do YouTube Music (artista/faixa/álbum) de cada faixa: 1–2 chamadas ao yt-dlp por faixa. */
            topicLookup: bool(env, "YTDLP_TOPIC_LOOKUP", true),
            /** Faixa indisponível: usa o vídeo equivalente que o YouTube Music tocaria no lugar. */
            musicFallback: bool(env, "YTMUSIC_FALLBACK", true),
            topicLookupConcurrency: int(env, "YTDLP_TOPIC_LOOKUP_CONCURRENCY", 4, { min: 1, max: 16 }),
            topicLookupTimeoutMs: int(env, "YTDLP_TOPIC_LOOKUP_TIMEOUT_MS", 15000, { min: 1000 }),
            /** Faixas por processo do yt-dlp na busca de metadados (evita ~1,5 s de inicialização por faixa). */
            metadataBatchSize: int(env, "YTDLP_METADATA_BATCH_SIZE", 5, { min: 1, max: 50 }),
            /** Cache de metadados por vídeo, em memória. */
            metadataCacheSize: int(env, "METADATA_CACHE_SIZE", 5000, { min: 0 }),
            metadataCacheTtlHours: int(env, "METADATA_CACHE_TTL_HOURS", 24, { min: 1 }),
            playlistTimeoutMs: int(env, "YTDLP_PLAYLIST_TIMEOUT_MS", 120_000, { min: 5000 }),
            downloadTimeoutMs: int(env, "YTDLP_DOWNLOAD_TIMEOUT_MS", 600_000, { min: 10_000 }),
            /** Novas tentativas por faixa em falhas passageiras (403, timeout, arquivo bloqueado). */
            downloadRetries: int(env, "YTDLP_DOWNLOAD_RETRIES", 2, { min: 0, max: 10 }),
            /** Faixas baixadas ao mesmo tempo em cada job. */
            downloadConcurrency: int(env, "YTDLP_DOWNLOAD_CONCURRENCY", 3, { min: 1, max: 8 }),
            /** Pausa entre downloads de um job, para reduzir chance de bloqueio. */
            sleepBetweenDownloadsMs: int(env, "YTDLP_SLEEP_BETWEEN_MS", 0, { min: 0 }),
        },
        cookies: {
            /** Caminho para um cookies.txt (formato Netscape). */
            file: str(env, "COOKIES_PATH"),
            /** Conteúdo do cookies.txt direto na env (multilinha) — útil em PaaS. */
            text: str(env, "COOKIES_TXT"),
            /** Mesmo conteúdo em base64 — mais seguro para painéis que não aceitam quebra de linha. */
            base64: str(env, "COOKIES_BASE64"),
        },
    };

    if (config.cookies.file && !fs.existsSync(path.resolve(cwd, config.cookies.file))) {
        throw new ConfigError(`COOKIES_PATH aponta para um arquivo inexistente: ${config.cookies.file}`);
    }
    if (config.ytdlp.poToken && !/^[\w-]+\.[\w-]+\+.+$/.test(config.ytdlp.poToken)) {
        throw new ConfigError('YTDLP_PO_TOKEN deve ter o formato "CLIENTE.CONTEXTO+TOKEN" (ex.: "mweb.gvs+XXX")');
    }

    return config;
}

/**
 * Resolve o arquivo de cookies a ser passado ao yt-dlp.
 * Cookies vindos de env são gravados numa cópia gravável em DATA_DIR (o yt-dlp reescreve o arquivo ao terminar).
 * Por compatibilidade, ainda detecta ./cookies.txt e /app/cookies.txt.
 */
export function resolveCookiesFile(cfg: AppConfig, cwd = process.cwd()): string | null {
    const { file, text, base64 } = cfg.cookies;
    let content: string | undefined;

    if (base64) content = Buffer.from(base64, "base64").toString("utf8");
    else if (text) content = text.replace(/\\n/g, "\n");
    else if (file) content = fs.readFileSync(path.resolve(cwd, file), "utf8");
    else {
        const legacy = [path.resolve(cwd, "cookies.txt"), "/app/cookies.txt"].find((p) => fs.existsSync(p));
        if (!legacy) return null;
        content = fs.readFileSync(legacy, "utf8");
    }

    if (!content.trim()) return null;
    if (!/^# (Netscape )?HTTP Cookie File/m.test(content) && !content.includes("\t")) {
        throw new ConfigError("Cookies inválidos: esperado arquivo no formato Netscape (cookies.txt).");
    }

    fs.mkdirSync(cfg.storage.dataDir, { recursive: true });
    const target = path.join(cfg.storage.dataDir, "cookies.txt");
    fs.writeFileSync(target, content.endsWith("\n") ? content : content + "\n", { mode: 0o600 });
    return target;
}

// ---------- Instância carregada ----------
function load(): AppConfig {
    // .env.local sobrescreve .env; variáveis reais do ambiente têm prioridade sobre ambos.
    for (const file of [".env.local", ".env"]) {
        const p = path.resolve(process.cwd(), file);
        if (fs.existsSync(p)) dotenv.config({ path: p });
    }
    try {
        return buildConfig();
    } catch (err) {
        if (err instanceof ConfigError) {
            console.error(`[config] ${err.message}`);
            process.exit(1);
        }
        throw err;
    }
}

export const config: AppConfig = load();
