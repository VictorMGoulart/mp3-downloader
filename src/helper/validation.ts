/**
 * Validação de tudo que chega do cliente antes de ir para o yt-dlp / sistema de arquivos.
 */

const YOUTUBE_HOSTS = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
]);

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export class ValidationError extends Error {
    readonly status = 400;
}

/** Aceita apenas URLs http(s) de domínios do YouTube. Retorna a URL normalizada. */
export function parseYoutubeUrl(input: unknown): string {
    if (typeof input !== "string" || !input.trim()) {
        throw new ValidationError("URL da playlist é obrigatória.");
    }
    if (input.length > 2048) throw new ValidationError("URL muito longa.");

    let url: URL;
    try {
        url = new URL(input.trim());
    } catch {
        throw new ValidationError("URL inválida.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new ValidationError("URL inválida.");
    }
    if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
        throw new ValidationError("Apenas links do YouTube são suportados.");
    }
    url.protocol = "https:";
    return url.toString();
}

export function isVideoId(id: unknown): id is string {
    return typeof id === "string" && VIDEO_ID.test(id);
}

/** Remove caracteres de controle, normaliza espaços e corta no tamanho máximo. */
export function cleanText(value: unknown, max = 200): string {
    if (typeof value !== "string") return "";
    return value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
}

/** Nome seguro para arquivo (sem separadores, reservados do Windows ou pontos iniciais). */
export function safeFilename(value: string, fallback: string, max = 150): string {
    const cleaned = cleanText(value, max * 2)
        .replace(/[<>:"/\\|?*]+/g, "")
        .replace(/^[.\s]+|[.\s]+$/g, "")
        .slice(0, max)
        .trim();
    if (!cleaned || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) return fallback;
    return cleaned;
}

export type DownloadItem = { id: string; url: string; title: string; author: string; album?: string };

/**
 * Valida a lista de faixas do /api/download.
 * A URL é sempre reconstruída a partir do ID — a URL enviada pelo cliente é ignorada.
 */
export function parseDownloadRequest(
    body: unknown,
    /** 0 = sem limite. */
    maxTracks = 0
): { items: DownloadItem[]; zipName: string } {
    const { videos, zipName } = (body ?? {}) as { videos?: unknown; zipName?: unknown };
    if (!Array.isArray(videos) || videos.length === 0) {
        throw new ValidationError("Nenhuma música selecionada para download.");
    }
    if (maxTracks > 0 && videos.length > maxTracks) {
        throw new ValidationError(`Máximo de ${maxTracks} músicas por download.`);
    }

    const seen = new Set<string>();
    const items: DownloadItem[] = [];
    for (const raw of videos) {
        const v = (raw ?? {}) as Record<string, unknown>;
        if (!isVideoId(v.id)) throw new ValidationError("Lista contém um ID de vídeo inválido.");
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        items.push({
            id: v.id,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            title: cleanText(v.title) || "Unknown Title",
            author: cleanText(v.author) || "Unknown Artist",
            album: cleanText(v.rawAlbum ?? v.album) || undefined,
        });
    }

    return {
        items,
        zipName: safeFilename(typeof zipName === "string" ? zipName : "", "playlist", 100) + ".zip",
    };
}

