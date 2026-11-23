import { describe, expect, it } from "vitest";
import { parseNextResponse } from "./ytmusic";

const albumRun = (text: string) => ({
    text,
    navigationEndpoint: {
        browseEndpoint: {
            browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ALBUM" } },
        },
    },
});

const response = (renderer: object) => ({
    contents: { singleColumnMusicWatchNextResultsRenderer: { tabbedRenderer: { content: { playlistPanelRenderer: { contents: [{ playlistPanelVideoRenderer: renderer }] } } } } },
});

describe("parseNextResponse", () => {
    it("extrai o vídeo substituto com título, artista e álbum", () => {
        const json = response({
            videoId: "Smmua48ORw4",
            title: { runs: [{ text: "Where Are We Now?" }] },
            longBylineText: { runs: [{ text: "American Football" }, { text: " • " }, albumRun("American Football (LP2)"), { text: " • " }, { text: "2016" }] },
        });
        expect(parseNextResponse(json)).toEqual({
            videoId: "Smmua48ORw4",
            title: "Where Are We Now?",
            artist: "American Football",
            album: "American Football (LP2)",
        });
    });

    it("sem link de álbum, não inventa álbum (vídeo comum: canal • views)", () => {
        const json = response({
            videoId: "dQw4w9WgXcQ",
            title: { runs: [{ text: "Never Gonna Give You Up" }] },
            longBylineText: { runs: [{ text: "Rick Astley" }, { text: " • " }, { text: "1.6B views" }] },
        });
        expect(parseNextResponse(json)?.album).toBeUndefined();
    });

    it("usa o watchEndpoint quando não há videoId direto", () => {
        const json = response({
            navigationEndpoint: { watchEndpoint: { videoId: "Smmua48ORw4" } },
            title: { runs: [{ text: "T" }] },
            longBylineText: { runs: [{ text: "A" }] },
        });
        expect(parseNextResponse(json)?.videoId).toBe("Smmua48ORw4");
    });

    it("retorna null para respostas sem faixa ou com ID inválido", () => {
        expect(parseNextResponse({})).toBeNull();
        expect(parseNextResponse(null)).toBeNull();
        expect(parseNextResponse(response({ videoId: "x", title: { runs: [{ text: "T" }] }, longBylineText: { runs: [{ text: "A" }] } }))).toBeNull();
        expect(parseNextResponse(response({ videoId: "Smmua48ORw4", title: { runs: [] }, longBylineText: { runs: [] } }))).toBeNull();
    });
});
