import { describe, expect, it } from "vitest";
import {
    HISTORY_KEY,
    addToHistory,
    indexHistory,
    loadHistory,
    removeFromHistory,
    saveHistory,
    sortedEntries,
    trackKey,
} from "./history";

const now = new Date("2026-01-01T12:00:00.000Z");

describe("history", () => {
    it("usa a mesma chave da versão anterior", () => {
        expect(HISTORY_KEY).toBe("yt_downloaded_tracks_v1");
    });

    it("retorna vazio sem dados", () => {
        expect(loadHistory()).toEqual({});
    });

    it("retorna vazio com JSON corrompido ou formato inesperado", () => {
        localStorage.setItem(HISTORY_KEY, "{not json");
        expect(loadHistory()).toEqual({});
        localStorage.setItem(HISTORY_KEY, "[1,2]");
        expect(loadHistory()).toEqual({});
    });

    it("salva e recarrega", () => {
        const h = addToHistory({}, [{ id: "a", title: "A", author: "X" }], now);
        saveHistory(h);
        expect(loadHistory()).toEqual({
            a: { id: "a", title: "A", author: "X", downloadedAt: now.toISOString() },
        });
    });

    it("lê o formato salvo pela versão anterior", () => {
        localStorage.setItem(
            HISTORY_KEY,
            JSON.stringify({ old: { id: "old", title: "T", author: "A", downloadedAt: "2025-01-01T00:00:00Z" } })
        );
        expect(loadHistory().old.title).toBe("T");
    });

    it("remove itens sem mutar o original e limpa a chave quando vazio", () => {
        const h = addToHistory({}, [{ id: "a", title: "A", author: "X" }], now);
        const next = removeFromHistory(h, ["a"]);
        expect(h.a).toBeDefined();
        expect(next).toEqual({});
        saveHistory(h);
        saveHistory(next);
        expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
    });

    it("ordena da mais recente para a mais antiga", () => {
        const h = {
            ...addToHistory({}, [{ id: "old", title: "", author: "" }], new Date("2025-01-01")),
            ...addToHistory({}, [{ id: "new", title: "", author: "" }], new Date("2026-01-01")),
        };
        expect(sortedEntries(h).map((e) => e.id)).toEqual(["new", "old"]);
    });
});

describe("ID original", () => {
    it("guarda o ID original quando a faixa foi trocada", () => {
        const h = addToHistory({}, [{ id: "topic", originalId: "clip", title: "T", author: "A" }], now);
        expect(h.topic).toEqual({ id: "topic", originalId: "clip", title: "T", author: "A", downloadedAt: now.toISOString() });
        expect(addToHistory({}, [{ id: "x", originalId: "x", title: "T", author: "A" }], now).x.originalId).toBeUndefined();
    });

    it("considera baixada pelo ID atual ou pelo original", () => {
        const idx = indexHistory(addToHistory({}, [{ id: "topic", originalId: "clip", title: "T", author: "A" }], now));
        expect(idx.downloaded({ id: "clip" })?.id).toBe("topic"); // playlist ainda com o ID antigo
        expect(idx.downloaded({ id: "topic" })?.id).toBe("topic");
        expect(idx.downloaded({ id: "outro", originalId: "clip" })?.id).toBe("topic");
        expect(idx.downloaded({ id: "outro" })).toBeUndefined();
    });

    it("removeFromHistory remove pelo ID atual ou original", () => {
        const h = addToHistory({}, [{ id: "topic", originalId: "clip", title: "T", author: "A" }, { id: "b", title: "B", author: "A" }], now);
        expect(Object.keys(removeFromHistory(h, ["clip"]))).toEqual(["b"]);
        expect(Object.keys(removeFromHistory(h, ["topic", undefined]))).toEqual(["b"]);
    });
});

describe("trackKey", () => {
    it("ignora acento, caixa, pontuação e participações", () => {
        const k = trackKey("Anitta", "Envolver");
        expect(trackKey("ANITTA", "Envolver!")).toBe(k);
        expect(trackKey("Anitta", "Envolver (feat. Fulano)")).toBe(k);
        expect(trackKey("Anitta", "Envolver ft. Fulano")).toBe(k);
        expect(trackKey("Tom Jobim", "Águas de Março")).toBe(trackKey("tom jobim", "aguas de marco"));
    });

    it("mantém versões diferentes separadas", () => {
        expect(trackKey("A", "Música (Remix)")).not.toBe(trackKey("A", "Música"));
        expect(trackKey("A", "Música (Ao Vivo)")).not.toBe(trackKey("A", "Música"));
        expect(trackKey("A", "Música")).not.toBe(trackKey("B", "Música"));
    });

    it("não compara nomes genéricos ou vazios", () => {
        expect(trackKey("Unknown Artist", "Música")).toBe("");
        expect(trackKey("A", "")).toBe("");
    });
});

describe("indexHistory.similar", () => {
    const h = addToHistory({}, [{ id: "v1", title: "Envolver", author: "Anitta" }], now);

    it("acha a mesma música vinda de outro vídeo", () => {
        expect(indexHistory(h).similar({ id: "v2", title: "Envolver (feat. X)", author: "anitta" })?.id).toBe("v1");
    });

    it("não marca como parecida a própria faixa baixada nem músicas diferentes", () => {
        expect(indexHistory(h).similar({ id: "v1", title: "Envolver", author: "Anitta" })).toBeUndefined();
        expect(indexHistory(h).similar({ id: "v3", title: "Envolver (Remix)", author: "Anitta" })).toBeUndefined();
    });

    it("reaproveita o índice para o mesmo histórico", () => {
        expect(indexHistory(h)).toBe(indexHistory(h));
    });
});
