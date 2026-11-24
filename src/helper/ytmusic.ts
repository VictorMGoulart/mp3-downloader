import { ProxyAgent, fetch as undiciFetch } from "undici";
import { config } from "../config";
import { isVideoId } from "./validation";

/**
 * Consulta à API interna do YouTube Music (a mesma que o player web usa).
 *
 * Quando uma faixa de playlist fica indisponível (relançamento, troca de distribuidora, bloqueio
 * regional), o YouTube Music toca no lugar um vídeo equivalente — por isso o link "muda" ao abrir.
 * O endpoint `next` devolve esse substituto e, mesmo sem substituto, título/artista/álbum da faixa.
 */

export type MusicTrack = {
    videoId: string;
    title: string;
    artist: string;
    album?: string;
};

const ENDPOINT = "https://music.youtube.com/youtubei/v1/next?prettyPrint=false";
const CLIENT = { clientName: "WEB_REMIX", clientVersion: "1.20241111.01.00", hl: "en", gl: "US" };

function findKey(obj: unknown, key: string, depth = 0): any {
    if (!obj || typeof obj !== "object" || depth > 40) return undefined;
    const rec = obj as Record<string, unknown>;
    if (rec[key] !== undefined) return rec[key];
    for (const value of Object.values(rec)) {
        const found = findKey(value, key, depth + 1);
        if (found !== undefined) return found;
    }
    return undefined;
}

const runsText = (runs: unknown): string[] =>
    Array.isArray(runs) ? runs.map((r) => (typeof r?.text === "string" ? r.text : "")) : [];

/** Extrai a faixa tocada (primeiro item da fila) da resposta do `next`. */
export function parseNextResponse(json: unknown): MusicTrack | null {
    const item = findKey(json, "playlistPanelVideoRenderer");
    const videoId = item?.videoId ?? item?.navigationEndpoint?.watchEndpoint?.videoId;
    if (!isVideoId(videoId)) return null;

    const title = runsText(item.title?.runs).join("").trim();
    // longBylineText: "Artista • Álbum • Ano" (vídeos comuns: "Canal • views • ano")
    const parts = runsText(item.longBylineText?.runs)
        .join("")
        .split(" • ")
        .map((p) => p.trim())
        .filter(Boolean);
    const artist = parts[0] ?? "";
    // Só confia no álbum quando o link aponta para uma página de álbum.
    const albumRun = (item.longBylineText?.runs ?? []).find(
        (r: any) => r?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === "MUSIC_PAGE_TYPE_ALBUM"
    );
    if (!title || !artist) return null;
    return { videoId, title, artist, album: typeof albumRun?.text === "string" ? albumRun.text.trim() : undefined };
}

let proxyAgent: ProxyAgent | null | undefined;

/**
 * Agente para sair pelo mesmo proxy do yt-dlp (YTDLP_PROXY). Sem ele, esta consulta sairia
 * direto do servidor, e IPs de datacenter costumam ser bloqueados pelo YouTube.
 * Só proxies HTTP(S); com SOCKS, a consulta sai direto.
 */
export function proxyAgentFor(proxy: string | undefined): ProxyAgent | null {
    if (!proxy) return null;
    if (!/^https?:\/\//i.test(proxy)) {
        console.warn("[ytmusic] YTDLP_PROXY não é HTTP(S); a consulta ao YouTube Music sai sem proxy.");
        return null;
    }
    return new ProxyAgent(proxy);
}

/** Faixa que o YouTube Music tocaria para este ID. Nunca lança: em falha retorna null. */
export async function musicNext(videoId: string, signal?: AbortSignal): Promise<MusicTrack | null> {
    if (!config.ytdlp.musicFallback || signal?.aborted) return null;
    if (proxyAgent === undefined) proxyAgent = proxyAgentFor(config.ytdlp.proxy);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
        const res = await undiciFetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: "https://music.youtube.com" },
            body: JSON.stringify({ videoId, isAudioOnly: true, context: { client: CLIENT } }),
            signal: ctrl.signal,
            dispatcher: proxyAgent ?? undefined,
        });
        if (!res.ok) {
            console.warn(`[ytmusic] ${videoId}: HTTP ${res.status}`);
            return null;
        }
        return parseNextResponse(await res.json());
    } catch (err) {
        if (!signal?.aborted) console.warn(`[ytmusic] ${videoId}: ${(err as Error).message}`);
        return null;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
    }
}
