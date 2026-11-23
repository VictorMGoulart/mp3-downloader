import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DownloadError, applyReplacement, classifyYtDlpFailure, removePartialFiles, unavailableIdsFrom } from "./youtube.adapter";
import { removeQuietly, renameWithRetry } from "./fsRetry";

describe("classifyYtDlpFailure", () => {
    it("403 no meio do download é passageiro", () => {
        const err = classifyYtDlpFailure("ERROR: unable to download video data: HTTP Error 403: Forbidden", 1);
        expect(err).toBeInstanceOf(DownloadError);
        expect(err.retryable).toBe(true);
        expect(err.message).toContain("HTTP Error 403");
    });

    it("arquivo bloqueado no Windows é passageiro", () => {
        const err = classifyYtDlpFailure("ERROR: [WinError 5] Acesso negado: 'a.temp.mp3' -> 'a.mp3'", 1);
        expect(err.retryable).toBe(true);
    });

    it("vídeo privado não é repetido", () => {
        const err = classifyYtDlpFailure("ERROR: [youtube] abc: Private video. Sign in if you've been granted access", 1);
        expect(err.retryable).toBe(false);
        expect(err.message).toBe("Vídeo privado ou indisponível.");
    });

    it("bloqueio anti-bot não é repetido", () => {
        expect(classifyYtDlpFailure("ERROR: Sign in to confirm you're not a bot", 1).retryable).toBe(false);
    });

    it("usa a última linha de ERROR na mensagem", () => {
        const err = classifyYtDlpFailure("WARNING: x\nERROR: primeiro\nERROR: segundo\n", 1);
        expect(err.message).toBe("yt-dlp saiu com código 1: ERROR: segundo");
        expect(err.retryable).toBe(false);
    });
});

describe("arquivos", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "mp3dl-"));
    });
    afterEach(() => removeQuietly(dir));

    const touch = (name: string, content = "x") => fs.writeFileSync(path.join(dir, name), content);

    it("removePartialFiles apaga só as sobras da faixa", () => {
        for (const f of ["A - B.webm.part", "A - B.temp.mp3", "A - B.webp", "A - B.mp3", "A - B (2).mp3", "C - D.mp3"]) touch(f);
        removePartialFiles(dir, "A - B");
        expect(fs.readdirSync(dir).sort()).toEqual(["A - B (2).mp3", "C - D.mp3"]);
    });

    it("removePartialFiles pode manter o MP3 da faixa", () => {
        touch("A - B.mp3");
        touch("A - B.webm.part");
        removePartialFiles(dir, "A - B", true);
        expect(fs.readdirSync(dir)).toEqual(["A - B.mp3"]);
    });

    it("renameWithRetry substitui o destino", async () => {
        touch("a.temp.mp3", "novo");
        touch("a.mp3", "velho");
        await renameWithRetry(path.join(dir, "a.temp.mp3"), path.join(dir, "a.mp3"));
        expect(fs.readFileSync(path.join(dir, "a.mp3"), "utf8")).toBe("novo");
        expect(fs.existsSync(path.join(dir, "a.temp.mp3"))).toBe(false);
    });

    it("renameWithRetry não insiste em erros que não são de bloqueio", async () => {
        await expect(renameWithRetry(path.join(dir, "nao-existe"), path.join(dir, "b"), 3, 1)).rejects.toMatchObject({
            code: "ENOENT",
        });
    });

    it("removeQuietly não lança para caminho inexistente", () => {
        expect(removeQuietly(path.join(dir, "nada"))).toBe(true);
    });
});

describe("vídeos indisponíveis", () => {
    it("classifica 'Video unavailable' como indisponível (vale procurar equivalente)", () => {
        const err = classifyYtDlpFailure("ERROR: [youtube] balV_JgLwVU: Video unavailable", 1);
        expect(err.unavailable).toBe(true);
        expect(err.retryable).toBe(false);
    });

    it("403 não é tratado como indisponível", () => {
        expect(classifyYtDlpFailure("ERROR: unable to download video data: HTTP Error 403: Forbidden", 1).unavailable).toBe(false);
    });

    it("unavailableIdsFrom lê os IDs do stderr do yt-dlp", () => {
        const stderr = [
            "WARNING: [youtube] abc: something",
            "ERROR: [youtube] balV_JgLwVU: Video unavailable",
            "ERROR: [youtube] VRpptE7F9I0: Video unavailable. This video is not available",
            "ERROR: [youtube] HydkjjDNTmY: Private video. Sign in if you've been granted access to this video",
            "ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you're not a bot",
            "ERROR: [youtube] balV_JgLwVU: Video unavailable",
        ].join("\n");
        expect(unavailableIdsFrom(stderr)).toEqual(["balV_JgLwVU", "VRpptE7F9I0", "HydkjjDNTmY"]);
    });

    it("applyReplacement troca o vídeo e guarda o ID original", () => {
        const v = {
            id: "balV_JgLwVU",
            url: "https://www.youtube.com/watch?v=balV_JgLwVU",
            title: "Where Are We Now",
            author: "American Football",
            rawTitle: "Where Are We Now",
            rawChannel: "",
            metadataSource: "pending" as const,
        };
        applyReplacement(v, { id: "Smmua48ORw4", title: "Where Are We Now?", author: "American Football", album: "LP2" });
        expect(v).toMatchObject({
            id: "Smmua48ORw4",
            url: "https://www.youtube.com/watch?v=Smmua48ORw4",
            originalId: "balV_JgLwVU",
            originalUrl: "https://www.youtube.com/watch?v=balV_JgLwVU",
            title: "Where Are We Now?",
            rawAlbum: "LP2",
            metadataSource: "youtube-music",
            replaced: true,
            unavailable: false,
        });
    });
});
