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
    duration?: string;
    thumbnail?: string;
    rawJson?: any;
    // Topic audio metadata:
    isMusicVideo?: boolean;
    isTopic?: boolean;
    originalUrl?: string;
    originalId?: string;
    topicChannel?: string;
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
    message?: string;
    downloadUrl?: string;
};
