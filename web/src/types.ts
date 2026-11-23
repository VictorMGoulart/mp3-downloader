// Espelha src/type/video.type.ts (backend). Manter em sincronia.
export type Video = {
    id: string;
    url: string;
    title: string;
    author: string;
    rawTitle: string;
    rawChannel: string;
    rawArtist?: string;
    rawTrack?: string;
    rawAlbum?: string;
    /** "youtube-music": metadados oficiais · "title": inferido do título (conferir) · "pending": ainda buscando. */
    metadataSource?: "youtube-music" | "title" | "pending";
    duration?: string;
    thumbnail?: string;
    rawJson?: unknown;
    isMusicVideo?: boolean;
    isTopic?: boolean;
    originalUrl?: string;
    originalId?: string;
    topicChannel?: string;
    /** O vídeo da playlist está indisponível e foi trocado por um equivalente (ID original em originalId). */
    replaced?: boolean;
    /** Indisponível e sem equivalente encontrado. */
    unavailable?: boolean;
};

export type JobStatus = "pending" | "downloading" | "zipping" | "completed" | "error";

export type DownloadProgressEvent = {
    jobId: string;
    status: JobStatus;
    currentIndex?: number;
    totalCount?: number;
    currentVideo?: { id: string; title: string; author: string };
    percent?: number;
    /** Percentual do job inteiro (downloads em paralelo). */
    overallPercent?: number;
    /** Faixas já processadas (com sucesso ou não). */
    completedCount?: number;
    /** IDs que falharam — ficam fora do ZIP e do histórico. */
    failedIds?: string[];
    message?: string;
    downloadUrl?: string;
};

export type HistoryEntry = {
    id: string;
    /** ID que a faixa tinha na playlist, quando foi trocada pela versão oficial/equivalente. */
    originalId?: string;
    title: string;
    author: string;
    downloadedAt: string;
};

export type History = Record<string, HistoryEntry>;

export type EditableField = "title" | "author" | "rawAlbum";

export type ViewFilter = "all" | "new" | "downloaded";
