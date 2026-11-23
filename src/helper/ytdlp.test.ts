import { describe, expect, it } from "vitest";
import { buildConfig } from "../config";
import { buildArgs, buildCommonArgs, explainYtDlpError } from "./ytdlp";

const ytdlp = (env: Record<string, string> = {}) => buildConfig(env).ytdlp;

describe("buildCommonArgs", () => {
    it("só --no-warnings sem configuração", () => {
        expect(buildCommonArgs(ytdlp(), null)).toEqual(["--no-warnings"]);
    });

    it("inclui cookies, proxy, ffmpeg, extractor-args e extras", () => {
        const args = buildCommonArgs(
            ytdlp({
                YTDLP_PROXY: "socks5://p:1080",
                FFMPEG_LOCATION: "/usr/bin/ffmpeg",
                YTDLP_PLAYER_CLIENT: "web,mweb",
                YTDLP_PO_TOKEN: "mweb.gvs+TOKEN",
                YTDLP_EXTRA_ARGS: "--sleep-requests 1",
            }),
            "/data/cookies.txt"
        );
        expect(args).toEqual([
            "--no-warnings",
            "--cookies",
            "/data/cookies.txt",
            "--proxy",
            "socks5://p:1080",
            "--ffmpeg-location",
            "/usr/bin/ffmpeg",
            "--extractor-args",
            "youtube:player_client=web,mweb;po_token=mweb.gvs+TOKEN",
            "--sleep-requests",
            "1",
        ]);
    });
});

describe("buildArgs", () => {
    it("sempre separa a URL com -- no final", () => {
        const args = buildArgs(["--dump-json"], "-malicious", ytdlp(), null);
        expect(args.slice(-2)).toEqual(["--", "-malicious"]);
        expect(args).toContain("--dump-json");
    });

    it("aceita várias URLs, todas depois do --", () => {
        const args = buildArgs(["--dump-json"], ["u1", "ytsearch1:x"], ytdlp(), null);
        expect(args.slice(-3)).toEqual(["--", "u1", "ytsearch1:x"]);
    });
});

describe("explainYtDlpError", () => {
    it.each([
        ["ERROR: [youtube] x: Sign in to confirm you're not a bot", /anti-bot/],
        ["ERROR: HTTP Error 429: Too Many Requests", /429/],
        ["ERROR: The playlist does not exist", /inexistente/],
        ["ERROR: [youtube] x: Private video", /privado/],
    ])("%s", (stderr, msg) => {
        expect(explainYtDlpError(stderr)).toMatch(msg);
    });

    it("retorna null para erro desconhecido", () => {
        expect(explainYtDlpError("ERROR: algo")).toBeNull();
    });
});
