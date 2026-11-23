import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

export type Tags = { title: string; artist: string; album?: string };

export function ffmpegBinary(location = config.ytdlp.ffmpegLocation): string {
    if (!location) return "ffmpeg";
    try {
        if (fs.statSync(location).isDirectory()) {
            return path.join(location, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
        }
    } catch {
        // caminho inexistente: deixa o spawn reportar
    }
    return location;
}

/** Argumentos do ffmpeg para regravar as tags sem recodificar (mantém a capa embutida). */
export function buildTagArgs(input: string, output: string, tags: Tags): string[] {
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-map", "0", "-c", "copy", "-id3v2_version", "3"];
    args.push("-metadata", `title=${tags.title}`, "-metadata", `artist=${tags.artist}`);
    // album vazio remove a tag herdada do YouTube, se houver
    args.push("-metadata", `album=${tags.album ?? ""}`);
    args.push(output);
    return args;
}

/**
 * Grava título/artista/álbum no MP3 usando o ffmpeg diretamente.
 * Argumentos vão como array (sem shell), então qualquer caractere no texto é seguro.
 */
export async function writeTags(file: string, tags: Tags): Promise<void> {
    const tmp = file.replace(/\.mp3$/i, ".tagging.mp3");
    await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpegBinary(), buildTagArgs(file, tmp, tags), { shell: false, windowsHide: true });
        let stderr = "";
        proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-1000)));
        proc.on("error", reject);
        proc.on("close", (code) =>
            code === 0 ? resolve() : reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.trim()}`))
        );
    }).catch((err) => {
        fs.rmSync(tmp, { force: true });
        throw err;
    });
    fs.renameSync(tmp, file);
}
