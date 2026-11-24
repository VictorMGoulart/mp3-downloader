import type { History, HistoryEntry, Video } from "../types";

/** Mesma chave usada pela versão anterior do app, para preservar o histórico existente. */
export const HISTORY_KEY = "yt_downloaded_tracks_v1";

export function loadHistory(storage: Storage = localStorage): History {
    try {
        const raw = storage.getItem(HISTORY_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as History) : {};
    } catch {
        return {};
    }
}

export function saveHistory(history: History, storage: Storage = localStorage): void {
    try {
        if (Object.keys(history).length === 0) storage.removeItem(HISTORY_KEY);
        else storage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
        // Armazenamento indisponível (modo privado, cota cheia): segue sem persistir.
    }
}

type HistoryVideo = Pick<Video, "id" | "title" | "author" | "originalId">;

export function toEntry(video: HistoryVideo, now = new Date()): HistoryEntry {
    const entry: HistoryEntry = { id: video.id, title: video.title, author: video.author, downloadedAt: now.toISOString() };
    if (video.originalId && video.originalId !== video.id) entry.originalId = video.originalId;
    return entry;
}

export function addToHistory(
    history: History,
    videos: HistoryVideo[],
    now = new Date()
): History {
    const next = { ...history };
    for (const v of videos) {
        if (v.id) next[v.id] = toEntry(v, now);
    }
    return next;
}

/** Remove as entradas que tenham qualquer um dos IDs (atual ou original). */
export function removeFromHistory(history: History, ids: (string | undefined)[]): History {
    const drop = new Set(ids.filter(Boolean));
    const next: History = {};
    for (const [key, entry] of Object.entries(history)) {
        if (!drop.has(key) && !(entry.originalId && drop.has(entry.originalId))) next[key] = entry;
    }
    return next;
}

// ---------- Comparação ----------

/**
 * Chave "artista|título" normalizada para achar a mesma música vinda de outro vídeo:
 * sem acento, caixa, pontuação e participações ("feat. X"). Mantém o resto do título,
 * então "Música (Remix)" e "Música (Ao Vivo)" continuam diferentes de "Música".
 */
export function trackKey(author: string | undefined, title: string | undefined): string {
    const norm = (s: string) =>
        s
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .toLowerCase()
            .replace(/[([]\s*(?:feat|ft|featuring|part|com)\.?\s[^)\]]*[)\]]/g, " ")
            .replace(/\s(?:feat|ft|featuring)\.?\s.*$/g, " ")
            .replace(/&/g, " and ")
            .replace(/[^\p{L}\p{N}]+/gu, " ")
            .trim();
    const a = norm(author ?? "");
    const t = norm(title ?? "");
    if (!a || !t || a === "unknown artist" || t === "unknown title") return "";
    return `${a}|${t}`;
}

export type HistoryIndex = {
    /** Baixada: o ID atual ou o original da faixa está no histórico. */
    downloaded: (video: Pick<Video, "id" | "originalId">) => HistoryEntry | undefined;
    /** Mesma música (artista + título) baixada a partir de outro vídeo. */
    similar: (video: Pick<Video, "id" | "originalId" | "author" | "title">) => HistoryEntry | undefined;
};

const indexCache = new WeakMap<History, HistoryIndex>();

/** Índice do histórico (memorizado por objeto: o histórico é imutável). */
export function indexHistory(history: History): HistoryIndex {
    const cached = indexCache.get(history);
    if (cached) return cached;

    const byId = new Map<string, HistoryEntry>();
    const byKey = new Map<string, HistoryEntry>();
    for (const [key, entry] of Object.entries(history)) {
        byId.set(key, entry);
        if (entry.originalId) byId.set(entry.originalId, entry);
        const k = trackKey(entry.author, entry.title);
        if (k && !byKey.has(k)) byKey.set(k, entry);
    }

    const downloaded: HistoryIndex["downloaded"] = (v) =>
        byId.get(v.id) ?? (v.originalId ? byId.get(v.originalId) : undefined);
    const index: HistoryIndex = {
        downloaded,
        similar: (v) => {
            if (downloaded(v)) return undefined;
            const k = trackKey(v.author, v.title);
            return k ? byKey.get(k) : undefined;
        },
    };
    indexCache.set(history, index);
    return index;
}

export function sortedEntries(history: History): HistoryEntry[] {
    return Object.values(history).sort(
        (a, b) => new Date(b.downloadedAt).getTime() - new Date(a.downloadedAt).getTime()
    );
}
