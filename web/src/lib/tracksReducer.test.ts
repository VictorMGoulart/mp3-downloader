import { describe, expect, it } from "vitest";
import { makeVideo } from "../test/fixtures";
import type { History } from "../types";
import {
    initTracksState,
    rangeBetween,
    sameValueIds,
    selectedVideos,
    snapshotTracks,
    tracksReducer,
    visibleTracks,
    type TracksAction,
    type TracksState,
} from "./tracksReducer";

const history: History = { b: { id: "b", title: "B", author: "X", downloadedAt: "2025-01-01T00:00:00Z" } };
const videos = [makeVideo("a"), makeVideo("b"), makeVideo("c", { title: "Special" })];

function run(...actions: TracksAction[]): TracksState {
    return actions.reduce(tracksReducer, initTracksState(history));
}
const sel = (s: TracksState) => [...s.selected].sort();

describe("tracksReducer", () => {
    it("ao carregar seleciona só as faixas novas", () => {
        const s = run({ type: "loaded", videos });
        expect(sel(s)).toEqual(["a", "c"]);
    });

    it("carregar reseta filtro e visualização", () => {
        const s = run({ type: "setQuery", query: "x" }, { type: "setView", view: "new" }, { type: "loaded", videos });
        expect(s.query).toBe("");
        expect(s.view).toBe("all");
    });

    it("toggle alterna ou força o estado", () => {
        let s = run({ type: "loaded", videos }, { type: "toggle", id: "a" });
        expect(s.selected.has("a")).toBe(false);
        s = tracksReducer(s, { type: "toggle", id: "a", checked: true });
        s = tracksReducer(s, { type: "toggle", id: "a", checked: true });
        expect(s.selected.has("a")).toBe(true);
    });

    describe("edição em massa de artista/álbum", () => {
        const list = [
            makeVideo("v1", { author: "Queen Official", rawAlbum: "Jazz" }),
            makeVideo("v2", { author: "queen  OFFICIAL", rawAlbum: undefined }),
            makeVideo("v3", { author: "Outro", rawAlbum: "jazz" }),
            makeVideo("v4", { author: "Outro", rawAlbum: undefined }),
        ];
        const bulk = (id: string, field: "author" | "rawAlbum" | "title", value: string) =>
            ({ type: "editField", id, field, value, applyToSame: true }) as const;

        it("sameValueIds ignora caixa, acentos e espaços extras", () => {
            const s = run({ type: "loaded", videos: list });
            expect(sameValueIds(s, "v1", "author")).toEqual(["v1", "v2"]);
            expect(sameValueIds(s, "v1", "rawAlbum")).toEqual(["v1", "v3"]);
        });

        it("artista: altera todas as faixas com o mesmo nome e salva cada uma", () => {
            const s = run({ type: "loaded", videos: list }, bulk("v1", "author", "Queen"));
            expect(s.videos.map((v) => v.author)).toEqual(["Queen", "Queen", "Outro", "Outro"]);
            expect(s.savedEdits.v2.author).toBe("Queen");
            expect(s.savedEdits.v3).toBeUndefined();
        });

        it("álbum: altera todas com o mesmo álbum", () => {
            const s = run({ type: "loaded", videos: list }, bulk("v3", "rawAlbum", "Jazz (1978)"));
            expect(s.videos.map((v) => v.rawAlbum)).toEqual(["Jazz (1978)", undefined, "Jazz (1978)", undefined]);
        });

        it("álbum vazio: muda só aquele item", () => {
            const s = run({ type: "loaded", videos: list }, bulk("v2", "rawAlbum", "Greatest Hits"));
            expect(s.videos.map((v) => v.rawAlbum)).toEqual(["Jazz", "Greatest Hits", "jazz", undefined]);
            expect(sameValueIds(run({ type: "loaded", videos: list }), "v4", "rawAlbum")).toEqual(["v4"]);
        });

        it("título nunca é alterado em massa", () => {
            const same = [makeVideo("v1", { title: "Intro" }), makeVideo("v2", { title: "Intro" })];
            const s = run({ type: "loaded", videos: same }, bulk("v1", "title", "Abertura"));
            expect(s.videos.map((v) => v.title)).toEqual(["Abertura", "Intro"]);
        });

        it("artista renomeado vale para as próximas playlists, sem confirmação", () => {
            const first = run({ type: "loaded", videos: list }, bulk("v1", "author", "Queen"));
            expect(first.aliases["queen official"].to).toBe("Queen");

            // outra playlist, outras faixas do mesmo artista
            const other = [makeVideo("n1", { author: "Queen Official" }), makeVideo("n2", { author: "QUEEN OFFICIAL" })];
            const next = tracksReducer(initTracksState(history, first.savedEdits, first.aliases), { type: "loaded", videos: other });
            expect(next.videos.map((v) => v.author)).toEqual(["Queen", "Queen"]);
        });

        it("nome já renomeado antes: renomear de novo atualiza a regra antiga (A → B → C)", () => {
            const aliases = { "queen official": { from: "Queen Official", to: "Queen", updatedAt: "" } };
            const vs = [makeVideo("n1", { author: "Queen Official" }), makeVideo("n2", { author: "Queen" })];
            let s = tracksReducer(initTracksState(history, {}, aliases), { type: "loaded", videos: vs });
            expect(s.videos.map((v) => v.author)).toEqual(["Queen", "Queen"]);

            s = tracksReducer(s, bulk("n1", "author", "Queen (banda)"));
            const later = tracksReducer(initTracksState(history, {}, s.aliases), {
                type: "loaded",
                videos: [makeVideo("x1", { author: "Queen Official" }), makeVideo("x2", { author: "Queen" })],
            });
            expect(later.videos.map((v) => v.author)).toEqual(["Queen (banda)", "Queen (banda)"]);
        });

        it("artista editado à mão também recebe o novo nome quando ele é renomeado", () => {
            const saved = { v3: { author: "Fulano", updatedAt: "" } };
            const aliases = { fulano: { from: "Fulano", to: "Fulano Oficial", updatedAt: "" } };
            const s = tracksReducer(initTracksState(history, saved, aliases), { type: "loaded", videos: list });
            expect(s.videos[2].author).toBe("Fulano Oficial");
        });

        it("álbum não cria regra para outras playlists", () => {
            const s = run({ type: "loaded", videos: list }, bulk("v1", "rawAlbum", "Jazz (1978)"));
            expect(s.aliases).toEqual({});
        });

        it("Desfazer também remove a regra do artista", () => {
            const loaded = run({ type: "loaded", videos: list });
            const snapshots = snapshotTracks(loaded, sameValueIds(loaded, "v1", "author"));
            const edited = tracksReducer(loaded, bulk("v1", "author", "Queen"));
            const undone = tracksReducer(edited, { type: "restoreTracks", snapshots, aliases: loaded.aliases });
            expect(undone.aliases).toEqual({});
            expect(undone.videos[0].author).toBe("Queen Official");
        });

        it("restoreTracks desfaz valores, travas e edições salvas", () => {
            const loaded = run({ type: "loaded", videos: list }, { type: "editField", id: "v2", field: "title", value: "Antes" });
            const snapshots = snapshotTracks(loaded, sameValueIds(loaded, "v1", "author"));
            const edited = tracksReducer(loaded, bulk("v1", "author", "Queen"));
            const undone = tracksReducer(edited, { type: "restoreTracks", snapshots });

            expect(undone.videos.map((v) => v.author)).toEqual(list.map((v) => v.author));
            expect(undone.savedEdits.v1).toBeUndefined();
            expect(undone.savedEdits.v2).toEqual(loaded.savedEdits.v2); // edição anterior preservada
            expect(undone.edited.v1).toBeUndefined();
            expect(undone.edited.v2).toEqual(["title"]);
        });
    });

    describe("seleção por intervalo (Shift)", () => {
        const five = ["v1", "v2", "v3", "v4", "v5"].map((id) => makeVideo(id));

        it("rangeBetween funciona nos dois sentidos, inclusive nas pontas", () => {
            expect(rangeBetween(five, "v2", "v4")).toEqual(["v2", "v3", "v4"]);
            expect(rangeBetween(five, "v4", "v2")).toEqual(["v2", "v3", "v4"]);
            expect(rangeBetween(five, "v3", "v3")).toEqual(["v3"]);
        });

        it("rangeBetween retorna null se a âncora não está na lista (ex.: filtrada)", () => {
            expect(rangeBetween(five, "x", "v2")).toBeNull();
        });

        it("setRange marca ou desmarca todo o intervalo", () => {
            let s = run({ type: "loaded", videos: five }, { type: "deselectAll" });
            s = tracksReducer(s, { type: "setRange", ids: ["v2", "v3", "v4"], checked: true });
            expect(sel(s)).toEqual(["v2", "v3", "v4"]);
            s = tracksReducer(s, { type: "setRange", ids: ["v3", "v4", "v5"], checked: false });
            expect(sel(s)).toEqual(["v2"]);
        });

        it("setRange ignora IDs que não estão na lista", () => {
            const s = run({ type: "loaded", videos: five }, { type: "deselectAll" }, { type: "setRange", ids: ["v1", "zz"], checked: true });
            expect(sel(s)).toEqual(["v1"]);
        });

        it("intervalo calculado sobre a lista visível pula faixas filtradas", () => {
            const vs = [makeVideo("v1"), makeVideo("v2", { title: "outra" }), makeVideo("v3")];
            const s = run({ type: "loaded", videos: vs }, { type: "setQuery", query: "title" });
            expect(rangeBetween(visibleTracks(s), "v1", "v3")).toEqual(["v1", "v3"]);
        });
    });

    it("selectVisible respeita o filtro e preserva seleções fora dele", () => {
        const s = run(
            { type: "loaded", videos },
            { type: "deselectAll" },
            { type: "toggle", id: "a" },
            { type: "setQuery", query: "special" },
            { type: "selectVisible" }
        );
        expect(sel(s)).toEqual(["a", "c"]);
        expect(visibleTracks(s).map((v) => v.id)).toEqual(["c"]);
    });

    it("deselectVisible só remove as visíveis", () => {
        const s = run(
            { type: "loaded", videos },
            { type: "setQuery", query: "special" },
            { type: "deselectVisible" }
        );
        expect(sel(s)).toEqual(["a"]);
    });

    it("selectNew volta à seleção de novas", () => {
        const s = run({ type: "loaded", videos }, { type: "toggle", id: "b" }, { type: "selectNew" });
        expect(sel(s)).toEqual(["a", "c"]);
    });

    it("editField aplica trim e não muta o array original", () => {
        const s = run({ type: "loaded", videos }, { type: "editField", id: "a", field: "rawAlbum", value: "  Album  " });
        expect(s.videos[0].rawAlbum).toBe("Album");
        expect(videos[0].rawAlbum).toBeUndefined();
    });

    it("markDownloaded grava no histórico e desmarca", () => {
        const s = run({ type: "loaded", videos }, { type: "markDownloaded", ids: ["a"], now: new Date("2026-01-01") });
        expect(s.history.a.title).toBe("Title a");
        expect(s.history.a.downloadedAt).toBe("2026-01-01T00:00:00.000Z");
        expect(sel(s)).toEqual(["c"]);
    });

    it("markDownloaded usa os metadados editados", () => {
        const s = run(
            { type: "loaded", videos },
            { type: "editField", id: "a", field: "title", value: "Novo" },
            { type: "markDownloaded", ids: ["a"] }
        );
        expect(s.history.a.title).toBe("Novo");
    });

    it("unmarkDownloaded remove do histórico e seleciona", () => {
        const s = run({ type: "loaded", videos }, { type: "unmarkDownloaded", id: "b" });
        expect(s.history.b).toBeUndefined();
        expect(s.selected.has("b")).toBe(true);
    });

    it("removeFromHistory de faixa fora da playlist não altera seleção", () => {
        const s = run({ type: "loaded", videos: [makeVideo("a")] }, { type: "removeFromHistory", id: "b" });
        expect(s.history).toEqual({});
        expect(sel(s)).toEqual(["a"]);
    });

    it("clearHistory zera histórico e seleciona tudo", () => {
        const s = run({ type: "loaded", videos }, { type: "clearHistory" });
        expect(s.history).toEqual({});
        expect(sel(s)).toEqual(["a", "b", "c"]);
    });

    it("view downloaded mostra só baixadas", () => {
        const s = run({ type: "loaded", videos }, { type: "setView", view: "downloaded" });
        expect(visibleTracks(s).map((v) => v.id)).toEqual(["b"]);
    });

    describe("metadados chegando depois", () => {
        const pending = [makeVideo("a", { metadataSource: "pending" }), makeVideo("c", { metadataSource: "pending" })];

        it("trackResolved substitui a faixa mantendo a posição", () => {
            const s = run(
                { type: "loaded", videos: pending },
                { type: "trackResolved", id: "a", video: makeVideo("a", { title: "Oficial", metadataSource: "youtube-music" }) }
            );
            expect(s.videos.map((v) => [v.id, v.title, v.metadataSource])).toEqual([
                ["a", "Oficial", "youtube-music"],
                ["c", "Title c", "pending"],
            ]);
        });

        it("não sobrescreve campos que o usuário já editou", () => {
            const s = run(
                { type: "loaded", videos: pending },
                { type: "editField", id: "a", field: "title", value: "Meu título" },
                { type: "trackResolved", id: "a", video: makeVideo("a", { title: "Oficial", author: "Artista Oficial" }) }
            );
            expect(s.videos[0].title).toBe("Meu título");
            expect(s.videos[0].author).toBe("Artista Oficial");
        });

        it("troca de ID (versão oficial) mantém seleção e edições", () => {
            const s = run(
                { type: "loaded", videos: pending },
                { type: "editField", id: "a", field: "rawAlbum", value: "Álbum" },
                { type: "trackResolved", id: "a", video: makeVideo("z", { originalId: "a" }) },
                { type: "trackResolved", id: "z", video: makeVideo("z", { rawAlbum: "Outro" }) }
            );
            expect(s.videos[0].id).toBe("z");
            expect(s.selected.has("z")).toBe(true);
            expect(s.selected.has("a")).toBe(false);
            expect(s.videos[0].rawAlbum).toBe("Álbum");
        });

        it("troca para um ID já baixado desmarca a faixa", () => {
            const s = run({ type: "loaded", videos: pending }, { type: "trackResolved", id: "a", video: makeVideo("b") });
            expect(s.videos[0].id).toBe("b");
            expect(s.selected.has("b")).toBe(false);
        });

        it("troca para um ID que já está na lista remove a duplicata", () => {
            const s = run({ type: "loaded", videos: pending }, { type: "trackResolved", id: "c", video: makeVideo("a") });
            expect(s.videos.map((v) => v.id)).toEqual(["a"]);
            expect(sel(s)).toEqual(["a"]);
        });

        it("ignora faixa desconhecida (ex.: de uma busca anterior)", () => {
            const before = run({ type: "loaded", videos: pending });
            expect(tracksReducer(before, { type: "trackResolved", id: "x", video: makeVideo("x") })).toBe(before);
        });

        it("metadataFinished marca o que ficou pendente como inferido", () => {
            const s = run(
                { type: "loaded", videos: pending },
                { type: "trackResolved", id: "a", video: makeVideo("a", { metadataSource: "youtube-music" }) },
                { type: "metadataFinished" }
            );
            expect(s.videos.map((v) => v.metadataSource)).toEqual(["youtube-music", "title"]);
        });
    });

    describe("edições salvas", () => {
        const withSaved = (edits = {}, aliases = {}) => initTracksState(history, edits, aliases);

        it("editar salva a edição", () => {
            const s = run({ type: "loaded", videos }, { type: "editField", id: "a", field: "title", value: " Meu " });
            expect(s.savedEdits.a.title).toBe("Meu");
        });

        it("na próxima consulta a faixa vem com o valor editado", () => {
            const first = run({ type: "loaded", videos }, { type: "editField", id: "a", field: "author", value: "Fulano" });
            const next = tracksReducer(withSaved(first.savedEdits), { type: "loaded", videos });
            expect(next.videos[0].author).toBe("Fulano");
            expect(next.edited.a).toEqual(["author"]);
        });

        it("metadados que chegam depois não sobrescrevem a edição salva", () => {
            const saved = { a: { title: "Meu", updatedAt: "" } };
            const s = [
                { type: "loaded", videos } as const,
                { type: "trackResolved", id: "a", video: makeVideo("a", { title: "Oficial", author: "Oficial" }) } as const,
            ].reduce(tracksReducer, withSaved(saved));
            expect(s.videos[0]).toMatchObject({ title: "Meu", author: "Oficial" });
        });

        it("edição salva no ID do clipe vale após a troca pela versão oficial", () => {
            const saved = { a: { rawAlbum: "Alb", updatedAt: "" } };
            const s = [
                { type: "loaded", videos } as const,
                { type: "trackResolved", id: "a", video: makeVideo("z", { originalId: "a", rawAlbum: "Oficial" }) } as const,
            ].reduce(tracksReducer, withSaved(saved));
            expect(s.videos[0]).toMatchObject({ id: "z", rawAlbum: "Alb" });
        });

        it("resetTrack restaura os valores originais e esquece a edição", () => {
            const s = run(
                { type: "loaded", videos },
                { type: "editField", id: "a", field: "title", value: "Meu" },
                { type: "resetTrack", id: "a" }
            );
            expect(s.videos[0].title).toBe("Title a");
            expect(s.savedEdits.a).toBeUndefined();
            expect(s.edited.a).toBeUndefined();
        });

        it("renameArtist aplica a todas as faixas do artista que não foram editadas", () => {
            const same = [makeVideo("a", { author: "Queen Official" }), makeVideo("c", { author: "Queen Official" }), makeVideo("d", { author: "Outro" })];
            const s = run(
                { type: "loaded", videos: same },
                { type: "editField", id: "c", field: "author", value: "Manual" },
                { type: "renameArtist", from: "Queen Official", to: "Queen" }
            );
            expect(s.videos.map((v) => v.author)).toEqual(["Queen", "Manual", "Outro"]);
            expect(s.aliases["queen official"].to).toBe("Queen");
        });

        it("artista renomeado vale nas próximas consultas e ao remover volta ao original", () => {
            const aliases = { "artist a": { from: "Artist a", to: "Renomeado", updatedAt: "" } };
            let s = tracksReducer(withSaved({}, aliases), { type: "loaded", videos });
            expect(s.videos[0].author).toBe("Renomeado");
            s = tracksReducer(s, { type: "removeAlias", key: "artist a" });
            expect(s.videos[0].author).toBe("Artist a");
        });
    });

    it("selectedVideos mantém a ordem da playlist", () => {
        const s = run({ type: "loaded", videos }, { type: "toggle", id: "b" });
        expect(selectedVideos(s).map((v) => v.id)).toEqual(["a", "b", "c"]);
    });
});

describe("histórico com IDs trocados", () => {
    const swapped: History = {
        topic: { id: "topic", originalId: "clip", title: "T", author: "A", downloadedAt: "2025-01-01T00:00:00Z" },
    };
    const start = (...actions: TracksAction[]) => actions.reduce(tracksReducer, initTracksState(swapped));

    it("faixa que chega com o ID antigo já vem como baixada (desmarcada)", () => {
        const s = start({ type: "loaded", videos: [makeVideo("clip"), makeVideo("nova")] });
        expect(sel(s)).toEqual(["nova"]);
    });

    it("marcar como baixada guarda o ID original", () => {
        const v = makeVideo("t2", { originalId: "c2" });
        const s = start({ type: "loaded", videos: [v] }, { type: "markDownloaded", ids: ["t2"], now: new Date() });
        expect(s.history.t2.originalId).toBe("c2");
    });

    it("desmarcar pela faixa com ID antigo remove a entrada e volta a selecionar", () => {
        const s = start({ type: "loaded", videos: [makeVideo("clip")] }, { type: "unmarkDownloaded", id: "clip" });
        expect(s.history).toEqual({});
        expect(sel(s)).toEqual(["clip"]);
    });
});
