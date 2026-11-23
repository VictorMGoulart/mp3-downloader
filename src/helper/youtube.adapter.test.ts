import { describe, expect, it } from "vitest";
import type { Video } from "../type/video.type";
import {
    applySearchResult,
    applyVideoInfo,
    chunk,
    formatDuration,
    isMusicVideo,
    parseYtDlpVideo,
    searchQuery,
} from "./youtube.adapter";

const clip = (): Video =>
    parseYtDlpVideo({
        id: "dQw4w9WgXcQ",
        title: "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
    })!;

const topic = {
    id: "lYBUbBu4W08",
    channel: "Rick Astley",
    artists: ["Rick Astley"],
    track: "Never Gonna Give You Up (2022 Remaster)",
    album: "Whenever You Need Somebody",
    duration: 214,
    playlist: 'Rick Astley Never Gonna Give You Up "Provided to YouTube"',
};

describe("chunk", () => {
    it("divide em lotes", () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        expect(chunk([], 3)).toEqual([]);
    });
});

describe("searchQuery", () => {
    it("monta a busca pela versão oficial", () => {
        expect(searchQuery({ author: "A", title: "B" })).toBe('A B "Provided to YouTube"');
    });
});

describe("applyVideoInfo", () => {
    it("aplica metadados do YouTube Music quando existem", () => {
        const v = clip();
        expect(applyVideoInfo(v, { ...topic, id: v.id })).toBe(true);
        expect(v).toMatchObject({ title: "Never Gonna Give You Up", rawAlbum: "Whenever You Need Somebody", metadataSource: "youtube-music" });
        expect(v.id).toBe("dQw4w9WgXcQ");
    });

    it("sem metadados, só completa o canal e retorna false", () => {
        const v = parseYtDlpVideo({ id: "abcdefghijk", title: "Song (Official Video)" })!;
        expect(applyVideoInfo(v, { id: v.id, channel: "Band - Topic" })).toBe(false);
        expect(v.rawChannel).toBe("Band - Topic");
        expect(v.author).toBe("Band");
    });
});

describe("applySearchResult", () => {
    it("aceita a versão oficial correspondente e troca o áudio de um clipe", () => {
        const v = clip();
        expect(applySearchResult(v, topic)).toBe(true);
        expect(v).toMatchObject({
            id: "lYBUbBu4W08",
            originalId: "dQw4w9WgXcQ",
            isTopic: true,
            author: "Rick Astley",
            title: "Never Gonna Give You Up",
            rawAlbum: "Whenever You Need Somebody",
            metadataSource: "youtube-music",
            duration: "3:34",
        });
    });

    it("rejeita resultado de outra música", () => {
        const v = clip();
        expect(applySearchResult(v, { ...topic, track: "Together Forever" })).toBe(false);
        expect(v.id).toBe("dQw4w9WgXcQ");
        expect(v.metadataSource).toBe("title");
    });

    it("rejeita resultado sem metadados ou com ID inválido", () => {
        expect(applySearchResult(clip(), { id: "lYBUbBu4W08", title: "x" })).toBe(false);
        expect(applySearchResult(clip(), { ...topic, id: "--exec" })).toBe(false);
        expect(applySearchResult(clip(), null)).toBe(false);
    });

    it("não troca o áudio se o original não é clipe", () => {
        const v = parseYtDlpVideo({ id: "abcdefghijk", title: "Rick Astley - Never Gonna Give You Up" })!;
        expect(applySearchResult(v, topic)).toBe(true);
        expect(v.id).toBe("abcdefghijk");
        expect(v.isTopic).toBeUndefined();
    });
});

describe("formatDuration", () => {
    it.each([
        [undefined, "--:--"],
        [0, "--:--"],
        [65, "1:05"],
        [212.6, "3:33"],
        ["3725", "1:02:05"],
    ])("%s → %s", (input, out) => {
        expect(formatDuration(input as number)).toBe(out);
    });
});

describe("isMusicVideo", () => {
    it("detecta clipes e ignora canais Topic", () => {
        expect(isMusicVideo("Song (Official Music Video)", "Band")).toBe(true);
        expect(isMusicVideo("Song", "BandVEVO")).toBe(true);
        expect(isMusicVideo("Song (Official Video)", "Band - Topic")).toBe(false);
        expect(isMusicVideo("Song", "Band")).toBe(false);
    });
});

describe("parseYtDlpVideo", () => {
    it("sem metadados, infere do título e marca a fonte como 'title'", () => {
        const v = parseYtDlpVideo({
            id: "dQw4w9WgXcQ",
            title: "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
            duration: 213,
        });
        expect(v).toMatchObject({
            id: "dQw4w9WgXcQ",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            author: "Rick Astley",
            title: "Never Gonna Give You Up",
            metadataSource: "title",
            duration: "3:33",
            thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
        });
    });

    it("com metadados do YouTube Music, usa-os e ignora o título do vídeo", () => {
        const v = parseYtDlpVideo({
            id: "3BFTio5296w",
            title: "qualquer coisa",
            channel: "Rick Astley",
            artists: ["Rick Astley"],
            track: "Never Gonna Give You Up (2022 Remaster)",
            album: "Whenever You Need Somebody",
        });
        expect(v).toMatchObject({
            author: "Rick Astley",
            title: "Never Gonna Give You Up",
            rawAlbum: "Whenever You Need Somebody",
            metadataSource: "youtube-music",
        });
    });

    it("usa o título da playlist como álbum em álbuns oficiais", () => {
        const v = parseYtDlpVideo({ id: "abcdefghijk", title: "T", playlist_id: "OLAK5uy_xyz", playlist_title: "Album - Album X (Deluxe)" });
        expect(v?.rawAlbum).toBe("Album X");
    });

    it("ignora itens sem ID válido", () => {
        expect(parseYtDlpVideo({ id: "NA" })).toBeNull();
        expect(parseYtDlpVideo({ id: "[private]" })).toBeNull();
        expect(parseYtDlpVideo(null)).toBeNull();
    });
});
