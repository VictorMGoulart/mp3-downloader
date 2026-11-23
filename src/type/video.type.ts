export type Video = {
    id: string;
    url: string;
    title: string;
    author: string;
    // Raw metadata returned by yt-dlp:
    rawTitle: string;
    rawChannel: string;
    rawArtist?: string;
    rawTrack?: string;
    rawAlbum?: string;
    /** "youtube-music": metadados oficiais · "title": inferido do título (conferir) · "pending": ainda buscando. */
    metadataSource?: "youtube-music" | "title" | "pending";
    duration?: string;
    thumbnail?: string;
    rawJson?: any;
    // Topic audio metadata:
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

export type DownloadProgressEvent = {
    jobId: string;
    status: "pending" | "downloading" | "zipping" | "completed" | "error";
    currentIndex?: number;
    totalCount?: number;
    currentVideo?: {
        id: string;
        title: string;
        author: string;
    };
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
