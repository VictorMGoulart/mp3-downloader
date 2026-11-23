import type { Video } from "../types";

export function makeVideo(id: string, overrides: Partial<Video> = {}): Video {
    return {
        id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: `Title ${id}`,
        author: `Artist ${id}`,
        rawTitle: `Artist ${id} - Title ${id}`,
        rawChannel: `Channel ${id}`,
        ...overrides,
    };
}
