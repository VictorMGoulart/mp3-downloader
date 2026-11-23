import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { Video } from "../type/video.type";
import {
    albumFromDescription,
    cleanAlbum,
    cleanTrackTitle,
    isSameTrack,
    metadataFromTitle,
    metadataFromYtDlp,
} from "./metadata";
import { TtlCache } from "./cache";
import { renameWithRetry, removeQuietly } from "./fsRetry";
import { writeTags } from "./tags";
import { musicNext } from "./ytmusic";
import { isVideoId } from "./validation";
import { buildArgs, explainYtDlpError, runYtDlp } from "./ytdlp";

export function formatDuration(seconds?: number | string | null): string {
    if (!seconds) return "--:--";
    const sec = typeof seconds === "string" ? parseInt(seconds, 10) : Math.round(seconds);
    if (isNaN(sec) || sec <= 0) return "--:--";

    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = sec % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

/** Clipe oficial (cujo áudio pode ser trocado pela versão de estúdio). */
export function isMusicVideo(rawTitle: string, channel: string): boolean {
    const channelLower = (channel || "").toLowerCase();
    if (channelLower.includes("- topic")) return false;
    if (/vevo$/i.test(channelLower)) return true;

    const clipPatterns = [
        /\b(?:official\s*(?:music\s*)?video|video\s*oficial|clipe\s*oficial|music\s*video|clipe|clip\s*oficial|visualizer|official\s*audio|lyric\s*video|mv)\b/i,
        /[([](?:official|video|clipe|mv|visualizer|audio|lyric)[)\]]/i,
    ];
    return clipPatterns.some((p) => p.test(rawTitle || ""));
}

const str = (v: unknown) => (typeof v === "string" && v.trim() && v !== "NA" ? v.trim() : undefined);

function pickThumbnail(item: any, id: string): string {
    if (typeof item.thumbnail === "string" && item.thumbnail) return item.thumbnail;
    if (Array.isArray(item.thumbnails) && item.thumbnails.length) {
        // Prefere uma miniatura média (as maiores pesam e a lista mostra 40px)
        const medium = item.thumbnails.find((t: any) => t?.url && t.width && t.width >= 300 && t.width <= 500);
        const last = item.thumbnails[item.thumbnails.length - 1];
        if (medium?.url || last?.url) return medium?.url || last.url;
    }
    return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

/** Álbum quando não há metadados: playlist de álbum oficial (OLAK5uy_) ou descrição "Provided to YouTube". */
function fallbackAlbum(item: any): string | undefined {
    if (String(item.playlist_id || "").startsWith("OLAK5uy_") && str(item.playlist_title)) {
        return cleanAlbum(String(item.playlist_title).replace(/^Album\s*-\s*/i, ""));
    }
    return albumFromDescription(item.description);
}

/** Monta um Video a partir de um item do yt-dlp (listagem rápida ou extração completa). */
export function parseYtDlpVideo(item: any): Video | null {
    if (!item) return null;
    const id = str(item.id);
    if (!id || !isVideoId(id)) return null;

    const rawTitle = str(item.title) ?? "Unknown";
    const rawChannel = str(item.channel) ?? str(item.uploader) ?? "";
    const meta = metadataFromYtDlp(item);
    const chosen = meta ?? metadataFromTitle(rawTitle, rawChannel);

    return {
        id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: chosen.title,
        author: chosen.author,
        rawTitle,
        rawChannel,
        rawArtist: str(item.artist),
        rawTrack: str(item.track),
        rawAlbum: meta?.album ?? fallbackAlbum(item),
        metadataSource: meta ? "youtube-music" : "title",
        duration: formatDuration(item.duration),
        thumbnail: pickThumbnail(item, id),
        rawJson: config.isProd ? undefined : item,
    };
}

// ---------- Resolução de metadados (em lote, com cache) ----------

/** Campos que a resolução de metadados altera — é o que fica em cache por vídeo. */
type Resolution = Pick<
    Video,
    | "id"
    | "url"
    | "author"
    | "title"
    | "rawAlbum"
    | "rawChannel"
    | "rawArtist"
    | "rawTrack"
    | "metadataSource"
    | "duration"
    | "isTopic"
    | "originalId"
    | "originalUrl"
    | "topicChannel"
    | "replaced"
    | "unavailable"
>;

const metadataCache = new TtlCache<Resolution>(
    config.ytdlp.metadataCacheSize,
    config.ytdlp.metadataCacheTtlHours * 3_600_000
);

function snapshot(v: Video): Resolution {
    const { id, url, author, title, rawAlbum, rawChannel, rawArtist, rawTrack, metadataSource, duration } = v;
    const { isTopic, originalId, originalUrl, topicChannel, replaced, unavailable } = v;
    return { id, url, author, title, rawAlbum, rawChannel, rawArtist, rawTrack, metadataSource, duration, isTopic, originalId, originalUrl, topicChannel, replaced, unavailable };
}

/** Aplica os metadados do próprio vídeo. Retorna true se ele tinha metadados do YouTube Music. */
export function applyVideoInfo(v: Video, info: any): boolean {
    const meta = metadataFromYtDlp(info);
    if (meta) {
        Object.assign(v, {
            author: meta.author,
            title: meta.title,
            rawAlbum: meta.album ?? albumFromDescription(info.description) ?? v.rawAlbum,
            rawArtist: str(info.artist),
            rawTrack: str(info.track),
            metadataSource: "youtube-music",
        });
        return true;
    }
    // A listagem rápida nem sempre traz o canal; com ele o fallback melhora.
    const channel = str(info?.channel) ?? str(info?.uploader);
    if (channel && channel !== v.rawChannel) {
        v.rawChannel = channel;
        Object.assign(v, metadataFromTitle(v.rawTitle, channel));
    }
    v.rawAlbum ??= fallbackAlbum(info ?? {});
    return false;
}

/**
 * Aplica o resultado da busca pela versão oficial, se artista e título baterem.
 * Se o original for um clipe, troca também o áudio pela versão de estúdio.
 */
export function applySearchResult(v: Video, found: any): boolean {
    const meta = metadataFromYtDlp(found);
    if (!found || !meta || !isVideoId(found.id)) return false;

    const artists = Array.isArray(found.artists) ? found.artists.filter((a: unknown) => typeof a === "string") : [];
    if (!isSameTrack({ ...meta, artists }, { author: v.author, title: v.title, channel: v.rawChannel })) return false;

    if (found.id !== v.id && isMusicVideo(v.rawTitle, v.rawChannel)) {
        v.originalUrl = v.url;
        v.originalId = v.id;
        v.id = found.id;
        v.url = `https://www.youtube.com/watch?v=${found.id}`;
        v.isTopic = true;
        v.topicChannel = str(found.channel);
        if (found.duration) v.duration = formatDuration(found.duration);
    }
    Object.assign(v, {
        author: meta.author,
        title: meta.title,
        rawAlbum: meta.album ?? albumFromDescription(found.description) ?? v.rawAlbum,
        metadataSource: "youtube-music",
    });
    return true;
}

/** IDs que o yt-dlp reportou como indisponíveis/privados/removidos no stderr. */
export function unavailableIdsFrom(stderr: string): string[] {
    const re = /ERROR: \[youtube\] ([\w-]{11}): (?:Video unavailable|Private video|This video (?:is|has been) (?:no longer available|removed|unavailable|private)|The uploader has not made this video available)/g;
    return [...new Set([...stderr.matchAll(re)].map((m) => m[1]))];
}

export type Replacement = { id: string; title: string; author: string; album?: string; duration?: string; channel?: string };

/**
 * Procura um vídeo disponível equivalente a uma faixa indisponível:
 * 1. o substituto que o próprio YouTube Music toca no lugar (endpoint `next`);
 * 2. senão, busca pela mesma faixa ("Provided to YouTube"), aceitando só se artista e título baterem.
 * Os nomes de referência vêm do YouTube Music (mais confiáveis); `hint` é o que a playlist trouxe.
 * `exclude`: IDs já tentados sem sucesso (o substituto do YouTube Music às vezes também está bloqueado).
 */
export async function findReplacement(
    id: string,
    hint: { title: string; author: string },
    signal?: AbortSignal,
    exclude: string[] = []
): Promise<Replacement | null> {
    const skip = new Set([id, ...exclude]);
    if (!config.ytdlp.musicFallback) return null;
    const music = await musicNext(id, signal);
    if (signal?.aborted) return null;
    if (music && !skip.has(music.videoId)) {
        return { id: music.videoId, title: cleanTrackTitle(music.title), author: music.artist, album: music.album };
    }

    const expected = music ? { title: cleanTrackTitle(music.title), author: music.artist } : hint;
    if (!expected.title || !expected.author || /^unknown/i.test(expected.author)) return null;

    let best: Replacement | null = null;
    await streamInfos(
        [`ytsearch5:${searchQuery(expected)}`],
        (found) => {
            if (best || !isVideoId(found?.id) || skip.has(found.id)) return;
            const meta = metadataFromYtDlp(found) ?? metadataFromTitle(str(found.title) ?? "", str(found.channel) ?? "");
            const artists = Array.isArray(found.artists) ? found.artists.filter((a: unknown) => typeof a === "string") : [];
            if (!isSameTrack({ ...meta, artists }, { ...expected, channel: str(found.channel) })) return;
            best = {
                id: found.id,
                title: meta.title,
                author: meta.author,
                album: (meta as { album?: string }).album ?? music?.album,
                duration: found.duration ? formatDuration(found.duration) : undefined,
                channel: str(found.channel),
            };
        },
        signal
    );
    return best;
}

/** Troca a faixa pelo equivalente encontrado, guardando o ID original (edições salvas continuam valendo). */
export function applyReplacement(v: Video, r: Replacement): void {
    v.originalId ??= v.id;
    v.originalUrl ??= v.url;
    v.id = r.id;
    v.url = `https://www.youtube.com/watch?v=${r.id}`;
    v.title = r.title;
    v.author = r.author;
    v.rawAlbum = r.album ?? v.rawAlbum;
    if (r.duration) v.duration = r.duration;
    if (r.channel) v.topicChannel = r.channel;
    v.metadataSource = "youtube-music";
    v.replaced = true;
    v.unavailable = false;
}

export const searchQuery = (v: Pick<Video, "author" | "title">) => `${v.author} ${v.title} "Provided to YouTube"`;

/** Extrai metadados de várias URLs/buscas num único processo (a inicialização do yt-dlp custa ~1,5 s). */
async function streamInfos(targets: string[], onInfo: (info: any) => void, signal?: AbortSignal) {
    if (targets.length === 0) return null;
    try {
        return await runYtDlp(buildArgs(["--skip-download", "--no-playlist", "--ignore-errors", "--dump-json"], targets), {
            timeoutMs: config.ytdlp.topicLookupTimeoutMs * targets.length,
            signal,
            onStdoutLine: (line) => {
                try {
                    onInfo(JSON.parse(line));
                } catch {
                    // linha não-JSON
                }
            },
        });
    } catch (err) {
        console.warn("[metadata]", (err as Error).message);
        return null;
    }
}

export type OnResolved = (originalId: string, video: Video) => void;

/**
 * Resolve um lote de faixas:
 * 1. metadados dos próprios vídeos (faixas do YouTube Music já os têm);
 * 2. para as que não têm, busca a versão oficial ("Provided to YouTube") — também em lote;
 * 3. o resto fica com o que foi inferido do título.
 */
async function resolveChunk(chunk: Video[], onResolved: OnResolved, signal?: AbortSignal): Promise<void> {
    const done = new Set<Video>();
    const finish = (v: Video, originalId: string, cache = true) => {
        done.add(v);
        if (cache) metadataCache.set(originalId, snapshot(v));
        onResolved(originalId, v);
    };

    const byId = new Map(chunk.map((v) => [v.id, v]));
    const received = new Set<string>();
    const infos = await streamInfos(
        chunk.map((v) => v.url),
        (info) => {
            const v = byId.get(info?.id);
            if (v) received.add(v.id);
            if (v && !done.has(v) && applyVideoInfo(v, info)) finish(v, v.id);
        },
        signal
    );
    if (signal?.aborted) return;

    // Vídeos que o YouTube diz estar indisponíveis: troca pelo equivalente do YouTube Music.
    const unavailableIds = new Set(unavailableIdsFrom(infos?.stderr ?? ""));
    await Promise.all(
        chunk
            .filter((v) => !received.has(v.id) && unavailableIds.has(v.id))
            .map(async (v) => {
                const originalId = v.id;
                const found = await findReplacement(v.id, { title: v.title, author: v.author }, signal);
                if (signal?.aborted) return;
                if (found) applyReplacement(v, found);
                else v.unavailable = true;
                finish(v, originalId);
            })
    );
    if (signal?.aborted) return;

    const rest = chunk.filter((v) => !done.has(v));
    const byQuery = new Map(rest.map((v) => [searchQuery(v), v]));
    const search = await streamInfos(
        [...byQuery.keys()].map((q) => `ytsearch1:${q}`),
        (found) => {
            // Em buscas, o yt-dlp devolve a consulta de origem em `playlist`.
            const v = byQuery.get(found?.playlist);
            if (!v || done.has(v)) return;
            const originalId = v.id;
            if (applySearchResult(v, found)) finish(v, originalId);
        },
        signal
    );
    if (signal?.aborted) return;

    // Só guarda "não encontrado" em cache se a busca rodou sem falhas (evita cachear erro de rede).
    const searchOk = search !== null && search.code === 0 && !search.timedOut;
    for (const v of rest) {
        if (done.has(v)) continue;
        v.metadataSource = "title";
        finish(v, v.id, searchOk);
    }
}

async function mapConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const worker = async () => {
        while (next < items.length) await fn(items[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

/** Lista rápida da playlist (sem metadados). Aplica o cache e marca o resto como "pending". */
export async function listPlaylist(url: string, signal?: AbortSignal): Promise<Video[]> {
    const videos: Video[] = [];
    const seen = new Set<string>();

    const result = await runYtDlp(
        buildArgs(
            [
                "--flat-playlist",
                "--ignore-errors",
                "--dump-json",
                ...(config.limits.maxPlaylistItems > 0 ? ["--playlist-end", String(config.limits.maxPlaylistItems)] : []),
            ],
            url
        ),
        {
            timeoutMs: config.ytdlp.playlistTimeoutMs,
            signal,
            onStdoutLine: (line) => {
                try {
                    const video = parseYtDlpVideo(JSON.parse(line));
                    if (video && !seen.has(video.id)) {
                        seen.add(video.id);
                        videos.push(video);
                    }
                } catch {
                    // linha não-JSON
                }
            },
        }
    );

    if (videos.length === 0) {
        if (result.aborted) return [];
        if (result.timedOut) throw new Error("Tempo esgotado ao buscar a playlist.");
        const explained = explainYtDlpError(result.stderr);
        if (explained) throw new Error(explained);
        if (result.code !== 0) console.error("[yt-dlp playlist]", result.stderr.slice(-1000));
        return [];
    }

    for (const v of videos) {
        if (v.metadataSource === "youtube-music") continue;
        const cached = metadataCache.get(v.id);
        if (cached) Object.assign(v, cached);
        else if (config.ytdlp.topicLookup) v.metadataSource = "pending";
    }
    return videos;
}

/**
 * Busca os metadados das faixas "pending", em lotes paralelos e na ordem da playlist.
 * `onResolved` é chamado assim que cada faixa fica pronta (com o ID original, pois o ID pode mudar).
 */
export async function enrichPlaylist(videos: Video[], onResolved: OnResolved, signal?: AbortSignal): Promise<void> {
    const pending = videos.filter((v) => v.metadataSource === "pending");
    await mapConcurrent(chunk(pending, config.ytdlp.metadataBatchSize), config.ytdlp.topicLookupConcurrency, (c) =>
        resolveChunk(c, onResolved, signal)
    );
}

/** Lista + metadados de uma vez (usado pela CLI). */
export async function getPlaylist(url: string): Promise<Video[]> {
    const videos = await listPlaylist(url);
    await enrichPlaylist(videos, () => {});
    // Após trocar para a versão oficial, dois itens podem apontar para o mesmo ID.
    const unique = new Map(videos.map((v) => [v.id, v]));
    return [...unique.values()];
}

export interface DownloadCallbacks {
    onProgress?: (percent: number, rawMessage: string) => void;
    /** Cancela o download em andamento (mata o yt-dlp). */
    signal?: AbortSignal;
}

const PROGRESS_RE = /\[download\]\s+([\d.]+)%/;

/**
 * Falha de download. `retryable` indica se vale tentar de novo (403 passageiro, timeout,
 * arquivo bloqueado no Windows...) ou não (vídeo privado, bloqueio anti-bot, cancelamento).
 */
export class DownloadError extends Error {
    constructor(
        message: string,
        readonly retryable: boolean,
        /** O vídeo não existe mais/está privado: vale procurar um equivalente. */
        readonly unavailable = false
    ) {
        super(message);
        this.name = "DownloadError";
    }
}

/** Erros do yt-dlp que costumam passar numa nova tentativa. */
const TRANSIENT_RE =
    /HTTP Error (403|5\d\d)|WinError (5|32)\b|Permission denied|Acesso negado|being used by another process|Connection (reset|aborted|refused)|timed out|Read timed out|IncompleteRead|unable to download video data|did not get any data blocks|Postprocessing/i;

export function classifyYtDlpFailure(stderr: string, code: number | null): DownloadError {
    const explained = explainYtDlpError(stderr);
    // Mensagens conhecidas (privado, anti-bot, 429) não melhoram tentando de novo agora.
    if (explained) return new DownloadError(explained, false, /Private video|Video unavailable/i.test(stderr));
    const last = stderr.trim().split(/\r?\n/).filter((l) => /ERROR/.test(l)).pop() ?? stderr.slice(-300).trim();
    return new DownloadError(`yt-dlp saiu com código ${code}: ${last}`, TRANSIENT_RE.test(stderr));
}

/** O yt-dlp não conseguiu trocar o arquivo final (bloqueado no Windows)? */
const LOCKED_RENAME_RE = /WinError (5|32)\b|Permission denied|Acesso negado|being used by another process/i;

/** Apaga sobras de uma tentativa (.part, .webm, .temp.mp3, thumbnails...). Mantém outros MP3 do job. */
export function removePartialFiles(folder: string, filename: string, keepMp3 = false): void {
    let files: string[];
    try {
        files = fs.readdirSync(folder);
    } catch {
        return;
    }
    for (const file of files) {
        if (!file.startsWith(`${filename}.`)) continue;
        if (keepMp3 && file === `${filename}.mp3`) continue;
        removeQuietly(path.join(folder, file));
    }
}

/** Baixa uma faixa como MP3 com as tags informadas. Entradas já devem estar validadas. */
export async function downloadMP3(
    url: string,
    filename: string,
    downloadFolder: string,
    author: string,
    title: string,
    album?: string,
    callbacks?: DownloadCallbacks
): Promise<void> {
    const args = buildArgs(
        [
            "--newline",
            "--no-playlist",
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "--embed-thumbnail",
            "--no-keep-video",
            "-o",
            path.join(downloadFolder, `${filename}.%(ext)s`),
        ],
        url
    );

    const onLine = (line: string) => {
        const m = line.match(PROGRESS_RE);
        if (m && callbacks?.onProgress) callbacks.onProgress(parseFloat(m[1]), line.trim());
    };

    const result = await runYtDlp(args, {
        timeoutMs: config.ytdlp.downloadTimeoutMs,
        onStdoutLine: onLine,
        onStderrLine: onLine,
        signal: callbacks?.signal,
    });

    if (result.aborted) throw new DownloadError("Download cancelado.", false);
    if (result.timedOut) throw new DownloadError("Tempo esgotado no download.", true);

    const file = path.join(downloadFolder, `${filename}.mp3`);
    if (result.code !== 0) {
        // O áudio já foi convertido e só a troca final do arquivo falhou (antivírus/indexador do Windows
        // segurando o arquivo): conclui a troca aqui em vez de baixar tudo de novo.
        const recovered = LOCKED_RENAME_RE.test(result.stderr) && (await recoverLockedRename(downloadFolder, filename));
        if (!recovered) throw classifyYtDlpFailure(result.stderr, result.code);
    }

    if (!fs.existsSync(file)) throw new DownloadError("Arquivo MP3 não foi gerado.", true);
    // Tags editadas pelo usuário são gravadas direto com o ffmpeg (o yt-dlp gravaria as do YouTube).
    try {
        await writeTags(file, { title, artist: author, album });
    } catch (err) {
        throw new DownloadError(`Falha ao gravar as tags: ${(err as Error).message}`, true);
    }
}

/** Termina a troca `<nome>.temp.mp3` → `<nome>.mp3` que o yt-dlp não conseguiu fazer. */
async function recoverLockedRename(folder: string, filename: string): Promise<boolean> {
    const file = path.join(folder, `${filename}.mp3`);
    const temp = path.join(folder, `${filename}.temp.mp3`);
    try {
        if (fs.existsSync(temp)) await renameWithRetry(temp, file);
        return fs.existsSync(file);
    } catch {
        // Não deu para trocar: fica com o MP3 sem a capa, se ele existir.
        removeQuietly(temp);
        return fs.existsSync(file);
    }
}
