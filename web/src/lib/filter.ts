import type { Video, ViewFilter } from "../types";

export function matchesQuery(video: Video, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [video.title, video.author, video.rawAlbum].some((f) => (f || "").toLowerCase().includes(q));
}

export function filterTracks(
    videos: Video[],
    query: string,
    view: ViewFilter,
    isDownloaded: (video: Video) => boolean
): Video[] {
    return videos.filter((v) => {
        if (view === "new" && isDownloaded(v)) return false;
        if (view === "downloaded" && !isDownloaded(v)) return false;
        return matchesQuery(v, query);
    });
}
