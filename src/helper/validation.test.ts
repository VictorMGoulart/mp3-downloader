import { describe, expect, it } from "vitest";
import { ValidationError, cleanText, parseDownloadRequest, parseYoutubeUrl, safeFilename } from "./validation";

describe("parseYoutubeUrl", () => {
    it.each([
        "https://www.youtube.com/playlist?list=PL123",
        "https://youtube.com/playlist?list=PL123",
        "https://music.youtube.com/playlist?list=OLAK5uy_x",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1",
        "https://youtu.be/dQw4w9WgXcQ",
        "http://www.youtube.com/playlist?list=PL123",
    ])("aceita %s", (url) => {
        expect(parseYoutubeUrl(url)).toMatch(/^https:\/\//);
    });

    it.each([
        ["", /obrigatória/],
        [undefined, /obrigatória/],
        [42, /obrigatória/],
        ["--exec rm -rf /", /inválida/],
        ["-o /etc/passwd", /inválida/],
        ["file:///etc/passwd", /inválida/],
        ["ytsearch:abc", /inválida|YouTube/],
        ["https://evil.com/playlist?list=1", /YouTube/],
        ["https://youtube.com.evil.com/x", /YouTube/],
        ["https://" + "a".repeat(3000), /longa/],
    ])("rejeita %j", (url, msg) => {
        expect(() => parseYoutubeUrl(url)).toThrow(ValidationError);
        expect(() => parseYoutubeUrl(url)).toThrow(msg);
    });
});

describe("cleanText", () => {
    it("remove controles, normaliza espaços e limita tamanho", () => {
        expect(cleanText("  a\n\tb\u0000c  ")).toBe("a b c");
        expect(cleanText("x".repeat(500), 10)).toHaveLength(10);
        expect(cleanText(null)).toBe("");
    });
});

describe("safeFilename", () => {
    it("remove caracteres proibidos e separadores de caminho", () => {
        expect(safeFilename('AC/DC - Back: In "Black"?', "f")).toBe("ACDC - Back In Black");
        expect(safeFilename("../../etc/passwd", "f")).toBe("etcpasswd");
    });

    it("usa fallback para vazio ou nomes reservados", () => {
        expect(safeFilename("...", "fallback")).toBe("fallback");
        expect(safeFilename("CON", "fallback")).toBe("fallback");
    });
});

describe("parseDownloadRequest", () => {
    const id = "dQw4w9WgXcQ";

    it("reconstrói a URL a partir do ID e ignora a URL do cliente", () => {
        const { items } = parseDownloadRequest(
            { videos: [{ id, url: "--exec evil", title: " T ", author: "A", rawAlbum: "Alb" }] },
            10
        );
        expect(items).toEqual([{ id, url: `https://www.youtube.com/watch?v=${id}`, title: "T", author: "A", album: "Alb" }]);
    });

    it("limite 0 aceita qualquer quantidade", () => {
        const many = Array.from({ length: 2000 }, (_, i) => ({ id: `id${String(i).padStart(9, "0")}` }));
        expect(parseDownloadRequest({ videos: many }, 0).items).toHaveLength(2000);
        expect(parseDownloadRequest({ videos: many }).items).toHaveLength(2000);
    });

    it("preenche padrões e remove duplicados", () => {
        const { items } = parseDownloadRequest({ videos: [{ id }, { id }] }, 10);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ title: "Unknown Title", author: "Unknown Artist", album: undefined });
    });

    it("sanitiza o nome do ZIP", () => {
        expect(parseDownloadRequest({ videos: [{ id }], zipName: "../Minha/Mix" }, 10).zipName).toBe("MinhaMix.zip");
        expect(parseDownloadRequest({ videos: [{ id }] }, 10).zipName).toBe("playlist.zip");
    });

    it.each([
        [{}, /Nenhuma/],
        [{ videos: [] }, /Nenhuma/],
        [{ videos: [{ id: "curto" }] }, /ID/],
        [{ videos: [{ id: "--exec=abcde" }] }, /ID/],
        [{ videos: Array.from({ length: 3 }, () => ({ id })) }, /Máximo de 2/],
    ])("rejeita %j", (body, msg) => {
        expect(() => parseDownloadRequest(body, 2)).toThrow(msg);
    });
});
