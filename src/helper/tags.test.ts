import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTagArgs, ffmpegBinary } from "./tags";

describe("buildTagArgs", () => {
    it("copia o áudio e grava as tags como argumentos separados", () => {
        const args = buildTagArgs("in.mp3", "out.mp3", { title: 'Say "Hi" \\ -y', artist: "A; rm -rf", album: "Alb" });
        expect(args).toContain("copy");
        expect(args).toContain('title=Say "Hi" \\ -y');
        expect(args).toContain("artist=A; rm -rf");
        expect(args).toContain("album=Alb");
        expect(args.indexOf("in.mp3")).toBe(args.indexOf("-i") + 1);
        expect(args[args.length - 1]).toBe("out.mp3");
    });

    it("limpa o álbum quando não informado", () => {
        expect(buildTagArgs("i", "o", { title: "t", artist: "a" })).toContain("album=");
    });
});

describe("ffmpegBinary", () => {
    it("usa ffmpeg do PATH por padrão", () => {
        expect(ffmpegBinary(undefined)).toBe("ffmpeg");
    });

    it("aceita diretório ou arquivo", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-"));
        const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
        expect(ffmpegBinary(dir)).toBe(path.join(dir, exe));
        expect(ffmpegBinary("/opt/ffmpeg/bin/ffmpeg")).toBe("/opt/ffmpeg/bin/ffmpeg");
        fs.rmSync(dir, { recursive: true });
    });
});
