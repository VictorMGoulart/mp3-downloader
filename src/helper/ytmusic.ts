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

/** Faixa que o YouTube Music tocaria para este ID. Nunca lança: em falha retorna null. */
export async function musicNext(videoId: string, signal?: AbortSignal): Promise<MusicTrack | null> {
    if (!config.ytdlp.musicFallback || signal?.aborted) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
        const res = await fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: "https://music.youtube.com" },
            body: JSON.stringify({ videoId, isAudioOnly: true, context: { client: CLIENT } }),
            signal: ctrl.signal,
        });
        if (!res.ok) return null;
        return parseNextResponse(await res.json());
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
    }
}
