import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, discardDownload, isZipAvailable, startDownload, streamPlaylist, subscribeProgress } from "./api";
import { makeVideo } from "./test/fixtures";

function mockFetch(status: number, body: unknown) {
    const fn = vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    });
    vi.stubGlobal("fetch", fn);
    return fn;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

/** Corpo em stream entregue em pedaços arbitrários (testa linhas quebradas entre pedaços). */
function streamBody(chunks: string[]) {
    const enc = new TextEncoder();
    let i = 0;
    return {
        getReader: () => ({
            read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true, value: undefined }),
        }),
    };
}

function mockStream(chunks: string[]) {
    const fn = vi.fn().mockResolvedValue({ ok: true, status: 200, body: streamBody(chunks), json: () => Promise.reject() });
    vi.stubGlobal("fetch", fn);
    return fn;
}

describe("streamPlaylist", () => {
    const list = JSON.stringify({ type: "list", videos: [makeVideo("a"), makeVideo("b")], pending: 2 });
    const track = (id: string, title: string) => JSON.stringify({ type: "track", id, video: makeVideo(id, { title }) });

    it("entrega a lista e depois cada faixa, mesmo com linhas quebradas entre pedaços", async () => {
        const a = track("a", "A1");
        const fn = mockStream([
            list.slice(0, 10),
            list.slice(10) + "\n" + a.slice(0, 5),
            a.slice(5) + "\n",
            track("b", "B1") + '\n{"type":"done"}',
        ]);
        const onList = vi.fn();
        const onTrack = vi.fn();
        await streamPlaylist("https://youtube.com/playlist?list=x", { onList, onTrack });

        expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ url: "https://youtube.com/playlist?list=x" });
        expect(onList).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "a" })]), 2);
        expect(onTrack.mock.calls.map(([id, v]) => [id, v.title])).toEqual([["a", "A1"], ["b", "B1"]]);
    });

    it("ignora linhas inválidas", async () => {
        mockStream([list + "\nlixo\n\n" + track("a", "A1") + "\n"]);
        const onTrack = vi.fn();
        await streamPlaylist("u", { onList: vi.fn(), onTrack });
        expect(onTrack).toHaveBeenCalledTimes(1);
    });

    it("propaga erro enviado no meio do stream", async () => {
        mockStream([list + "\n" + JSON.stringify({ type: "error", error: "Falhou" }) + "\n"]);
        await expect(streamPlaylist("u", { onList: vi.fn(), onTrack: vi.fn() })).rejects.toThrow("Falhou");
    });

    it("propaga a mensagem de erro do servidor (antes do stream)", async () => {
        mockFetch(404, { error: "Nada encontrado" });
        await expect(streamPlaylist("u", { onList: vi.fn(), onTrack: vi.fn() })).rejects.toMatchObject({
            message: "Nada encontrado",
            status: 404,
        });
    });

    it("usa mensagem padrão sem corpo JSON", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.reject() }));
        await expect(streamPlaylist("u", { onList: vi.fn(), onTrack: vi.fn() })).rejects.toThrow("Falha ao buscar a playlist.");
    });

    it("trata falha de rede", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fail")));
        await expect(streamPlaylist("u", { onList: vi.fn(), onTrack: vi.fn() })).rejects.toBeInstanceOf(ApiError);
    });

    it("não lança erro quando cancelado", async () => {
        const controller = new AbortController();
        controller.abort();
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
        await expect(streamPlaylist("u", { onList: vi.fn(), onTrack: vi.fn() }, controller.signal)).resolves.toBeUndefined();
    });
});

describe("discardDownload / isZipAvailable", () => {
    it("usa sendBeacon ao sair da página", () => {
        const beacon = vi.fn().mockReturnValue(true);
        const fetchFn = vi.fn();
        vi.stubGlobal("navigator", { ...navigator, sendBeacon: beacon });
        vi.stubGlobal("fetch", fetchFn);
        discardDownload("job 1", true);
        expect(beacon).toHaveBeenCalledWith("/api/download/job%201/discard");
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it("usa fetch keepalive fora do unload", () => {
        const fetchFn = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal("fetch", fetchFn);
        discardDownload("j");
        expect(fetchFn).toHaveBeenCalledWith("/api/download/j/discard", { method: "POST", keepalive: true });
    });

    it("isZipAvailable reflete o status do HEAD", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
        await expect(isZipAvailable("/z")).resolves.toBe(false);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
        await expect(isZipAvailable("/z")).resolves.toBe(true);
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error()));
        await expect(isZipAvailable("/z")).resolves.toBe(false);
    });
});

describe("startDownload", () => {
    it("envia só os campos necessários e o nome do zip", async () => {
        const fn = mockFetch(200, { jobId: "job-1" });
        const v = makeVideo("a", { rawAlbum: "Alb", rawJson: { huge: true } });
        await expect(startDownload([v], "Mix")).resolves.toBe("job-1");
        const body = JSON.parse(fn.mock.calls[0][1].body);
        expect(body).toEqual({
            zipName: "Mix",
            videos: [{ id: "a", url: v.url, title: v.title, author: v.author, rawAlbum: "Alb" }],
        });
    });
});

describe("subscribeProgress", () => {
    class FakeEventSource {
        static last: FakeEventSource;
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: (() => void) | null = null;
        closed = false;
        constructor(public url: string) {
            FakeEventSource.last = this;
        }
        close() {
            this.closed = true;
        }
        emit(data: unknown) {
            this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
        }
    }

    it("repassa eventos e fecha ao concluir", () => {
        const onEvent = vi.fn();
        subscribeProgress("j 1", { onEvent }, FakeEventSource as unknown as typeof EventSource);
        const es = FakeEventSource.last;
        expect(es.url).toBe("/api/progress/j%201");

        es.emit({ jobId: "j", status: "downloading", percent: 10 });
        expect(es.closed).toBe(false);
        es.onmessage?.({ data: "not json" } as MessageEvent);
        es.emit({ jobId: "j", status: "completed" });

        expect(onEvent).toHaveBeenCalledTimes(2);
        expect(es.closed).toBe(true);
    });

    it("a função retornada encerra a conexão", () => {
        const stop = subscribeProgress("j", { onEvent: vi.fn() }, FakeEventSource as unknown as typeof EventSource);
        stop();
        expect(FakeEventSource.last.closed).toBe(true);
    });
});
