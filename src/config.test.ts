import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, buildConfig, resolveCookiesFile, splitArgs } from "./config";

const COOKIES = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n";

let tmp: string;
beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-test-"));
});
afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("buildConfig", () => {
    it("usa padrões de desenvolvimento", () => {
        const c = buildConfig({}, tmp);
        expect(c.server.port).toBe(3000);
        expect(c.isProd).toBe(false);
        expect(c.server.trustProxy).toBe(false);
        expect(c.limits.rateLimitPerWindow).toBe(0);
        expect(c.limits.minFreeDiskMb).toBe(0);
        expect(c.storage.dataDir).toBe(path.resolve(tmp, "tmp_downloads"));
        expect(c.ytdlp.bin).toBe("yt-dlp");
    });

    it("ajusta padrões em produção", () => {
        const c = buildConfig({ NODE_ENV: "production" }, tmp);
        expect(c.server.trustProxy).toBe(true);
        expect(c.limits.rateLimitPerWindow).toBeGreaterThan(0);
        expect(c.ytdlp.topicLookup).toBe(true);
        expect(c.limits.minFreeDiskMb).toBe(2048);
        expect(c.server.clientIpHeader).toBe("");
    });

    it("lê o cabeçalho de IP do proxy e o mínimo de disco", () => {
        const c = buildConfig({ CLIENT_IP_HEADER: "CF-Connecting-IP", MIN_FREE_DISK_MB: "0" }, tmp);
        expect(c.server.clientIpHeader).toBe("cf-connecting-ip");
        expect(c.limits.minFreeDiskMb).toBe(0);
    });

    it("lê valores da env", () => {
        const c = buildConfig(
            {
                PORT: "8080",
                CORS_ORIGINS: "https://a.com, https://b.com",
                YTDLP_TOPIC_LOOKUP: "false",
                YTDLP_PROXY: "http://user:pass@proxy:8080",
                MAX_TRACKS_PER_JOB: "10",
                DATA_DIR: "data",
            },
            tmp
        );
        expect(c.server.port).toBe(8080);
        expect(c.server.corsOrigins).toEqual(["https://a.com", "https://b.com"]);
        expect(c.ytdlp.topicLookup).toBe(false);
        expect(c.ytdlp.proxy).toBe("http://user:pass@proxy:8080");
        expect(c.limits.maxTracksPerJob).toBe(10);
        expect(c.storage.dataDir).toBe(path.resolve(tmp, "data"));
    });

    it("ignora valores vazios", () => {
        expect(buildConfig({ PORT: "  ", YTDLP_PATH: "" }, tmp).server.port).toBe(3000);
    });

    it.each([
        [{ PORT: "abc" }, /PORT/],
        [{ PORT: "70000" }, /PORT/],
        [{ MAX_TRACKS_PER_JOB: "-1" }, /MAX_TRACKS_PER_JOB/],
        [{ TRUST_PROXY: "talvez" }, /TRUST_PROXY/],
        [{ YTDLP_PO_TOKEN: "semformato" }, /YTDLP_PO_TOKEN/],
        [{ COOKIES_PATH: "nao-existe.txt" }, /COOKIES_PATH/],
    ])("rejeita %o", (env, msg) => {
        expect(() => buildConfig(env, tmp)).toThrow(ConfigError);
        expect(() => buildConfig(env, tmp)).toThrow(msg);
    });

    it("aceita PO token no formato correto", () => {
        expect(buildConfig({ YTDLP_PO_TOKEN: "mweb.gvs+AbC123==" }, tmp).ytdlp.poToken).toBe("mweb.gvs+AbC123==");
    });
});

describe("splitArgs", () => {
    it("divide respeitando aspas", () => {
        expect(splitArgs(`--sleep-requests 1 --user-agent "Mozilla 5.0" --x 'a b'`)).toEqual([
            "--sleep-requests",
            "1",
            "--user-agent",
            "Mozilla 5.0",
            "--x",
            "a b",
        ]);
        expect(splitArgs(undefined)).toEqual([]);
    });
});

describe("resolveCookiesFile", () => {
    const cfg = (env: Record<string, string>) => buildConfig({ DATA_DIR: "data", ...env }, tmp);
    const read = (p: string | null) => fs.readFileSync(p!, "utf8");

    it("retorna null sem cookies", () => {
        expect(resolveCookiesFile(cfg({}), tmp)).toBeNull();
    });

    it("grava COOKIES_TXT numa cópia em DATA_DIR", () => {
        const p = resolveCookiesFile(cfg({ COOKIES_TXT: COOKIES }), tmp);
        expect(p).toBe(path.join(tmp, "data", "cookies.txt"));
        expect(read(p)).toBe(COOKIES);
    });

    it("aceita \\n literal em COOKIES_TXT (painéis de uma linha)", () => {
        const p = resolveCookiesFile(cfg({ COOKIES_TXT: COOKIES.replace(/\n/g, "\\n") }), tmp);
        expect(read(p)).toBe(COOKIES);
    });

    it("decodifica COOKIES_BASE64", () => {
        const p = resolveCookiesFile(cfg({ COOKIES_BASE64: Buffer.from(COOKIES).toString("base64") }), tmp);
        expect(read(p)).toBe(COOKIES);
    });

    it("copia COOKIES_PATH", () => {
        fs.writeFileSync(path.join(tmp, "mine.txt"), COOKIES);
        const p = resolveCookiesFile(cfg({ COOKIES_PATH: "mine.txt" }), tmp);
        expect(read(p)).toBe(COOKIES);
    });

    it("detecta ./cookies.txt legado", () => {
        fs.writeFileSync(path.join(tmp, "cookies.txt"), COOKIES);
        expect(read(resolveCookiesFile(cfg({}), tmp))).toBe(COOKIES);
    });

    it("rejeita conteúdo que não é cookies.txt", () => {
        expect(() => resolveCookiesFile(cfg({ COOKIES_TXT: "lixo" }), tmp)).toThrow(ConfigError);
    });
});
