import { describe, expect, it } from "vitest";
import { makeVideo } from "../test/fixtures";
import { filterTracks, matchesQuery } from "./filter";

const videos = [
    makeVideo("a", { title: "Bohemian Rhapsody", author: "Queen", rawAlbum: "A Night at the Opera" }),
    makeVideo("b", { title: "Clocks", author: "Coldplay", rawAlbum: undefined }),
    makeVideo("c", { title: "Under Pressure", author: "Queen & David Bowie" }),
];
const downloaded = new Set(["b"]);
const isDownloaded = (v: { id: string }) => downloaded.has(v.id);
const ids = (vs: { id: string }[]) => vs.map((v) => v.id);

describe("matchesQuery", () => {
    it("aceita consulta vazia", () => {
        expect(matchesQuery(videos[0], "  ")).toBe(true);
    });

    it("busca em título, artista e álbum sem diferenciar maiúsculas", () => {
        expect(matchesQuery(videos[0], "RHAPSODY")).toBe(true);
        expect(matchesQuery(videos[0], "queen")).toBe(true);
        expect(matchesQuery(videos[0], "opera")).toBe(true);
        expect(matchesQuery(videos[1], "opera")).toBe(false);
    });
});

describe("filterTracks", () => {
    it("view all retorna tudo que bate com a busca", () => {
        expect(ids(filterTracks(videos, "", "all", isDownloaded))).toEqual(["a", "b", "c"]);
        expect(ids(filterTracks(videos, "queen", "all", isDownloaded))).toEqual(["a", "c"]);
    });

    it("view new exclui baixadas", () => {
        expect(ids(filterTracks(videos, "", "new", isDownloaded))).toEqual(["a", "c"]);
    });

    it("view downloaded mostra só baixadas", () => {
        expect(ids(filterTracks(videos, "", "downloaded", isDownloaded))).toEqual(["b"]);
        expect(ids(filterTracks(videos, "queen", "downloaded", isDownloaded))).toEqual([]);
    });
});
