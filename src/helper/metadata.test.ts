import { describe, expect, it } from "vitest";
import {
    albumFromDescription,
    cleanAlbum,
    cleanTrackTitle,
    isSameTrack,
    mainArtistFromMetadata,
    mainArtistFromText,
    metadataFromTitle,
    metadataFromYtDlp,
} from "./metadata";

describe("cleanTrackTitle — participações", () => {
    it.each([
        ["Song feat. ABC", "Song"],
        ["Song feat ABC", "Song"],
        ["Song ft. ABC & DEF", "Song"],
        ["Song featuring ABC", "Song"],
        ["Song (feat. ABC)", "Song"],
        ["Song [ft. ABC]", "Song"],
        ["Song part. Anitta", "Song"],
        ["Song (Participação Especial de Fulano)", "Song"],
        ["Song (with Ed Sheeran)", "Song"],
        ["Song (com Fulano)", "Song"],
        ["Song feat. X - Remastered", "Song"],
        ["Song feat. X (Remix)", "Song (Remix)"],
    ])("%s → %s", (input, out) => {
        expect(cleanTrackTitle(input)).toBe(out);
    });
});

describe("cleanTrackTitle — edições", () => {
    it.each([
        ["Never Gonna Give You Up (2022 Remaster)", "Never Gonna Give You Up"],
        ["Bohemian Rhapsody - Remastered 2011", "Bohemian Rhapsody"],
        ["Here Comes the Sun - 2019 Mix", "Here Comes the Sun"],
        ["Song (Deluxe Edition)", "Song"],
        ["Song (Acoustic Version)", "Song"],
        ["Song (Versão Acústica)", "Song"],
        ["Song (Ao Vivo)", "Song"],
        ["Song - Ao Vivo", "Song"],
        ["Song (Radio Edit)", "Song"],
        ["Song (Extended Mix)", "Song"],
        ["Song (Single Version)", "Song"],
        ["Song (2009)", "Song"],
        ["Song (Live) [Remastered 2009]", "Song"],
        ["Song (Official Music Video) [4K]", "Song"],
        ["Song (Áudio Oficial)", "Song"],
        ["Song [Clipe Oficial]", "Song"],
        ["Song (Lyric Video)", "Song"],
    ])("%s → %s", (input, out) => {
        expect(cleanTrackTitle(input)).toBe(out);
    });
});

describe("cleanTrackTitle — preserva", () => {
    it.each([
        "Song (Calvin Harris Remix)",
        "Song (Instrumental)",
        "Song (Demo)",
        "Song (Remix Edit)",
        "(I Can't Get No) Satisfaction",
        "Don't You (Forget About Me)",
        "Part 2 (The Return)",
        "With or Without You",
        "Clean Bandit",
        "Live and Let Die",
        "Edição Especial", // sem parênteses é o nome da música
    ])("%s", (input) => {
        expect(cleanTrackTitle(input)).toBe(input);
    });

    it("combina parênteses mantidos e sufixo removido", () => {
        expect(cleanTrackTitle("Sweet Dreams (Are Made of This) - 2005 Remaster")).toBe("Sweet Dreams (Are Made of This)");
    });

    it("remove caracteres inválidos e aspas nas pontas", () => {
        expect(cleanTrackTitle('"What?: <Yes>"')).toBe("What Yes");
    });

    it("nunca devolve vazio", () => {
        expect(cleanTrackTitle("")).toBe("Unknown Title");
        expect(cleanTrackTitle(undefined)).toBe("Unknown Title");
        expect(cleanTrackTitle("(Official Video)")).toBe("(Official Video)");
    });
});

describe("cleanAlbum", () => {
    it("remove só anotações de edição", () => {
        expect(cleanAlbum("Whenever You Need Somebody (Deluxe Edition)")).toBe("Whenever You Need Somebody");
        expect(cleanAlbum("A Night at the Opera (2011 Remaster)")).toBe("A Night at the Opera");
        expect(cleanAlbum("Live at Wembley '86")).toBe("Live at Wembley '86");
        expect(cleanAlbum(undefined)).toBeUndefined();
    });
});

describe("artista principal", () => {
    it("usa o primeiro de `artists`", () => {
        expect(mainArtistFromMetadata(["Simon & Garfunkel", "Outro"], "ignorado")).toBe("Simon & Garfunkel");
    });

    it("divide `artist` só por vírgula (formato do yt-dlp)", () => {
        expect(mainArtistFromMetadata(undefined, "Earth, Wind & Fire")).toBe("Earth");
        expect(mainArtistFromMetadata(undefined, "Simon & Garfunkel")).toBe("Simon & Garfunkel");
        expect(mainArtistFromMetadata([], "NA")).toBeUndefined();
    });

    it.each([
        ["Queen - Topic", "Queen"],
        ["TaylorSwiftVEVO", "TaylorSwift"],
        ["Anitta, Pedro Sampaio", "Anitta"],
        ["Daft Punk feat. Pharrell", "Daft Punk"],
        ["MC Fulano part. MC Ciclano", "MC Fulano"],
        ["Alok x Ava Max", "Alok"],
        ["", "Unknown Artist"],
    ])("texto livre: %s → %s", (input, out) => {
        expect(mainArtistFromText(input)).toBe(out);
    });
});

describe("metadataFromYtDlp", () => {
    it("usa artists/track/album do YouTube Music e limpa edições", () => {
        expect(
            metadataFromYtDlp({
                artists: ["Rick Astley"],
                artist: "Rick Astley",
                track: "Never Gonna Give You Up (2022 Remaster)",
                album: "Whenever You Need Somebody (Deluxe Edition)",
            })
        ).toEqual({ author: "Rick Astley", title: "Never Gonna Give You Up", album: "Whenever You Need Somebody" });
    });

    it("remove feat. do nome da faixa mesmo vindo de metadados", () => {
        expect(metadataFromYtDlp({ artists: ["A", "B"], track: "Song (feat. B)" })?.title).toBe("Song");
    });

    it("retorna null sem track ou artista", () => {
        expect(metadataFromYtDlp({ title: "x", channel: "y" })).toBeNull();
        expect(metadataFromYtDlp({ track: "x" })).toBeNull();
        expect(metadataFromYtDlp(null)).toBeNull();
    });
});

describe("metadataFromTitle", () => {
    it.each([
        ["Anitta, Pedro Sampaio - Sentadona (Clipe Oficial)", { author: "Anitta", title: "Sentadona" }],
        ["Daft Punk ft. Pharrell Williams - Get Lucky (Official Audio)", { author: "Daft Punk", title: "Get Lucky" }],
        ["Yung Lean - Ginseng Strip 2002 (Official Video)", { author: "Yung Lean", title: "Ginseng Strip 2002" }],
        ["Artist - Song feat. Other", { author: "Artist", title: "Song" }],
    ])("%s", (input, out) => {
        expect(metadataFromTitle(input, "canal")).toEqual(out);
    });

    it("sem separador usa o canal como artista", () => {
        expect(metadataFromTitle("bran-new song (Official Video)", "Band - Topic")).toEqual({
            author: "Band",
            title: "bran-new song",
        });
    });
});

describe("albumFromDescription", () => {
    it("lê o álbum do texto 'Provided to YouTube'", () => {
        const desc = "Provided to YouTube by Label\n\nSong · Artist\n\nGreat Album (Deluxe)\n\n℗ 2020 Label";
        expect(albumFromDescription(desc)).toBe("Great Album");
        expect(albumFromDescription("outra coisa")).toBeUndefined();
    });
});

describe("isSameTrack", () => {
    const expected = { author: "Rick Astley", title: "Never Gonna Give You Up", channel: "RickAstleyVEVO" };

    it("aceita mesmo artista e título (ignorando acentos, caixa e pontuação)", () => {
        expect(isSameTrack({ author: "Rick Astley", title: "Never Gonna Give You Up" }, expected)).toBe(true);
        expect(isSameTrack({ author: "Beyoncé", title: "Halo" }, { author: "Beyonce", title: "HALO!" })).toBe(true);
    });

    it("aceita artista que bate com o canal ou com outro artista da lista", () => {
        expect(isSameTrack({ author: "X", artists: ["Rick Astley"], title: "Never Gonna Give You Up" }, expected)).toBe(true);
        expect(isSameTrack({ author: "Rick Astley", title: "Never Gonna Give You Up" }, { ...expected, author: "Desconhecido", channel: "Rick Astley - Topic" })).toBe(true);
    });

    it("rejeita outro artista ou outra música", () => {
        expect(isSameTrack({ author: "Cover Band", title: "Never Gonna Give You Up" }, expected)).toBe(false);
        expect(isSameTrack({ author: "Rick Astley", title: "Together Forever" }, expected)).toBe(false);
    });
});
