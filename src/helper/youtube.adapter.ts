import { spawn } from "node:child_process";
import { Video } from "../type/video.type";
import path from "node:path";

export async function getPlaylist(url: string): Promise<Video[]> {
    return new Promise((resolve) => {
        const ytDlp = spawn("yt-dlp", [
            "--no-warnings",
            "--cookies",
            "/app/cookies.txt",
            "--print",
            "%(id)s|%(title)s|%(channel)s",
            url,
        ]);

        const videos: Video[] = [];
        let buffer = "";

        ytDlp.stdout.on("data", (chunk) => {
            buffer += chunk.toString();

            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;

                const [id, rawTitle, channel] = line.split("|");

                const { author, title } = extractArtistAndTitle(
                    rawTitle,
                    channel
                );

                videos.push({
                    url: `https://www.youtube.com/watch?v=${id}`,
                    title,
                    author,
                });
            }
        });

        ytDlp.on("close", () => resolve(videos));

        ytDlp.stderr.on("data", (data) => {
            console.error("YT-DLP ERROR:", data.toString());
        });
    });
}

export async function downloadMP3(
    url: string,
    filename: string,
    downloadFolder: string
): Promise<void> {
    return new Promise((resolve) => {
        const process = spawn("yt-dlp", [
            "--embed-metadata",
            "--embed-thumbnail",
            "--js-runtimes",
            "node",
            "--remote-components",
            "ejs:github",
            "--user-agent",
            "Mozilla/5.0",
            "--cookies",
            "/app/cookies.txt",
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "--sleep-interval",
            "2",
            "--max-sleep-interval",
            "5",
            "--no-keep-video",
            "-o",
            `${downloadFolder}/${filename}.%(ext)s`,
            url,
        ]);

        process.stderr.on("data", (data) => {
            console.error(data.toString());
        });

        process.on("close", (code) => {
            if (code === 0) {
                console.log(`🎵 Finalizado: ${filename}`);
            }

            resolve();
        });
    });
}

function extractArtistAndTitle(title: string, channel: string) {
    const match = title.match(/^([^-]{1,50})\s*[-–—]\s*(.+)$/);

    if (match) {
        return {
            author: getMainArtist(match[1]),
            title: sanitize(match[2]),
        };
    }

    return {
        author: getMainArtist(channel),
        title: sanitize(title),
    };
}

function getMainArtist(channel: string): string {
    return channel.split(/\s*(?:,|&| x | feat\.?| ft\.?| and )\s*/i)[0].trim();
}

function sanitize(title: string): string {
    return title
        .replace(/\s*[\(\[].*?[\)\]]/g, "")
        .replace(/[<>:"/\\|?*]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
