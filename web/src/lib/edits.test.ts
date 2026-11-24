import { describe, expect, it } from "vitest";
import { makeVideo } from "../test/fixtures";
import {
    ALIASES_KEY,
    EDITS_KEY,
    applySaved,
    artistKey,
    canAlias,
    loadAliases,
    loadEdits,
    recordAlias,
    recordEdit,
    removeAlias,
    resolveArtist,
    saveAliases,
    saveEdits,
} from "./edits";

const now = new Date("2026-01-01T00:00:00.000Z");
const original = { title: "Orig", author: "Artist", rawAlbum: undefined };

describe("persistência", () => {
    it("salva e carrega edições e artistas", () => {
        saveEdits({ a: { title: "T", updatedAt: now.toISOString() } });
        saveAliases(recordAlias({}, "Queen Official", "Queen", now));
        expect(loadEdits().a.title).toBe("T");
        expect(loadAliases()["queen official"].to).toBe("Queen");
    });

    it("tolera JSON corrompido e remove a chave quando vazio", () => {
        localStorage.setItem(EDITS_KEY, "{x");
        expect(loadEdits()).toEqual({});
        saveAliases({});
        expect(localStorage.getItem(ALIASES_KEY)).toBeNull();
    });
});

describe("recordEdit", () => {
    it("salva o campo para o ID atual e o original", () => {
        const e = recordEdit({}, ["topic", "clip"], "title", "Novo", original, now);
        expect(e.topic.title).toBe("Novo");
        expect(e.clip.title).toBe("Novo");
    });

    it("voltar ao valor original remove a edição", () => {
        let e = recordEdit({}, ["a"], "title", "Novo", original, now);
        e = recordEdit(e, ["a"], "author", "Outro", original, now);
        e = recordEdit(e, ["a"], "title", "Orig", original, now);
        expect(e.a).toEqual({ author: "Outro", updatedAt: now.toISOString() });
        e = recordEdit(e, ["a"], "author", "Artist", original, now);
        expect(e.a).toBeUndefined();
    });

    it("ignora IDs vazios", () => {
        expect(Object.keys(recordEdit({}, ["a", undefined], "title", "x", original, now))).toEqual(["a"]);
    });
});

describe("artistas renomeados", () => {
    it("normaliza a chave (acentos, caixa, espaços)", () => {
        expect(artistKey("  Beyoncé  Knowles ")).toBe("beyonce knowles");
    });

    it("resolve pelo nome normalizado", () => {
        const a = recordAlias({}, "Queen Official", "Queen", now);
        expect(resolveArtist("QUEEN official", a)).toBe("Queen");
        expect(resolveArtist("Outro", a)).toBe("Outro");
    });

    it("encadeia: o que apontava para o nome antigo passa a apontar para o novo", () => {
        let a = recordAlias({}, "QueenVEVO", "Queen Official", now);
        a = recordAlias(a, "Queen Official", "Queen", now);
        expect(resolveArtist("QueenVEVO", a)).toBe("Queen");
        expect(resolveArtist("Queen Official", a)).toBe("Queen");
    });

    it("renomear de volta para o original remove o alias", () => {
        let a = recordAlias({}, "Queen Official", "Queen", now);
        a = recordAlias(a, "Queen Official", "queen official", now);
        expect(a).toEqual({});
    });

    it("não cria alias para nomes genéricos", () => {
        expect(recordAlias({}, "Unknown Artist", "Fulano", now)).toEqual({});
        expect(canAlias("Unknown Artist", "Fulano")).toBe(false);
        expect(canAlias("A", "a")).toBe(false);
        expect(canAlias("A", "B")).toBe(true);
    });

    it("remove", () => {
        const a = recordAlias({}, "A", "B", now);
        expect(removeAlias(a, "a")).toEqual({});
    });
});

describe("applySaved", () => {
    it("aplica edições e trava os campos editados", () => {
        const { video, locked } = applySaved(makeVideo("a"), { a: { title: "Meu", updatedAt: "" } }, {});
        expect(video.title).toBe("Meu");
        expect(locked).toEqual(["title"]);
    });

    it("aplica edições salvas pelo ID original (clipe trocado pela versão oficial)", () => {
        const v = makeVideo("topic", { originalId: "clip" });
        expect(applySaved(v, { clip: { rawAlbum: "Alb", updatedAt: "" } }, {}).video.rawAlbum).toBe("Alb");
    });

    it("o ID atual tem prioridade sobre o original", () => {
        const v = makeVideo("topic", { originalId: "clip" });
        const edits = { clip: { title: "Velho", updatedAt: "" }, topic: { title: "Novo", updatedAt: "" } };
        expect(applySaved(v, edits, {}).video.title).toBe("Novo");
    });

    it("renomeia o artista só se ele não foi editado na faixa", () => {
        const aliases = recordAlias({}, "Artist a", "Renomeado", now);
        expect(applySaved(makeVideo("a"), {}, aliases).video.author).toBe("Renomeado");
        const edited = applySaved(makeVideo("a"), { a: { author: "Manual", updatedAt: "" } }, aliases);
        expect(edited.video.author).toBe("Manual");
    });
});
