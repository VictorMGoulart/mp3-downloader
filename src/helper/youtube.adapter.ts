import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Video } from "../type/video.type";

export function getCookiesPath(): string | null {
    if (fs.existsSync("/app/cookies.txt")) return "/app/cookies.txt";
    if (fs.existsSync(path.resolve(process.cwd(), "cookies.txt"))) {
        return path.resolve(process.cwd(), "cookies.txt");
    }
    return null;
}

export function getMainArtist(rawArtist: string): string {
    if (!rawArtist) return "Unknown Artist";

    // Strip common channel suffixes (e.g. " - Topic", "VEVO", "Official")
    let cleaned = rawArtist
        .replace(/\s*-\s*Topic$/i, "")
        .replace(/\s*VEVO$/i, "")
        .replace(/\s*Official$/i, "")
        .trim();

    // Split on common collaborator separators:
    // comma (,), &, x, vs, feat, ft, and, com, e, with, semicolon (;)
    const parts = cleaned.split(
        /\s*(?:,|&|\bx\b|\bvs\.?\b|\bfeat\.?\b|\bft\.?\b|\band\b|\bcom\b|\be\b|\bwith\b|;)\s*/i
    );

    let firstArtist = parts[0] ? parts[0].trim() : cleaned;

    // Clean any leading/trailing quotes or brackets
    firstArtist = firstArtist.replace(/^["'(\[]+|["')\]]+$/g, "").trim();

    return firstArtist || "Unknown Artist";
}

export function sanitizeTitle(rawTitle: string): string {
    if (!rawTitle) return "Unknown Title";

    let title = rawTitle
        // Remove common fluff in parentheses/brackets:
        // e.g. (Official Video), (Lyric Video), (Audio), [Clipe Oficial], (feat. XYZ), [feat. XYZ]
        .replace(
            /\s*[\(\[](?:official\s*(?:video|audio|music\s*video|lyric\s*video|visualizer|clip|clipe)?|video\s*oficial|clipe\s*oficial|lyric\s*video|audio\s*oficial|audio|visualizer|4k|hd|remastered|ao\s*vivo|live|feat\.?[^)]*|ft\.?[^)]*)[\)\]]/gi,
            ""
        )
        // Remove invalid filename characters
        .replace(/[<>:"/\\|?*]+/g, "")
        // Normalize whitespaces
        .replace(/\s+/g, " ")
        .trim();

    // Strip leading and trailing quotes (single quote, double quote, backticks, curly quotes)
    title = title.replace(/^['"`‘“\s]+|['"`’”\s]+$/g, "").trim();

    return title || "Unknown Title";
}

export function extractArtistAndTitle(
    rawTitle: string,
    channel: string,
    rawArtist?: string,
    rawTrack?: string
): { author: string; title: string } {
    // 1. If yt-dlp extracted explicit artist metadata
    if (rawArtist && rawArtist !== "NA" && rawArtist.trim()) {
        const cleanTrack = rawTrack && rawTrack !== "NA" && rawTrack.trim()
            ? sanitizeTitle(rawTrack)
            : sanitizeTitle(rawTitle);
        return {
            author: getMainArtist(rawArtist),
            title: cleanTrack,
        };
    }

    // 2. Check if title has pattern: "Artist - Title"
    // Handles space before dash, space after dash, or dash immediately followed by quotes e.g. "Yung Lean -'Silver Arrows"
    // Does NOT break compound words without spaces e.g. "bran-new"
    const match = rawTitle.match(/^([^-–—]{1,60}?)(?:\s+[-–—]\s*|\s*[-–—]\s+|\s*[-–—]['"`‘“])\s*(.+)$/);

    if (match) {
        return {
            author: getMainArtist(match[1]),
            title: sanitizeTitle(match[2]),
        };
    }

    return {
        author: getMainArtist(channel),
        title: sanitizeTitle(rawTitle),
    };
}

export function formatDuration(seconds?: number | string | null): string {
    if (!seconds) return "--:--";
    const sec = typeof seconds === "string" ? parseInt(seconds, 10) : seconds;
    if (isNaN(sec) || sec <= 0) return "--:--";

    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const remainingSecs = sec % 60;

    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, "0")}:${remainingSecs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${remainingSecs.toString().padStart(2, "0")}`;
}

export function isMusicVideo(rawTitle: string, channel: string): boolean {
    const channelLower = (channel || "").toLowerCase();
    if (channelLower.includes("- topic") || channelLower.includes(" - topic")) {
        return false;
    }

    const titleLower = (rawTitle || "").toLowerCase();
    const clipPatterns = [
        /\b(?:official\s*(?:music\s*)?video|video\s*oficial|clipe\s*oficial|music\s*video|clipe|clip\s*oficial|visualizer|official\s*visualizer|official\s*audio|lyric\s*video|mv)\b/i,
        /\[(?:official|video|clipe|mv|visualizer|audio|lyric)\]/i,
        /\((?:official|video|clipe|mv|visualizer|audio|lyric)\)/i,
    ];

    return clipPatterns.some((p) => p.test(titleLower)) || /vevo$/i.test(channelLower);
}

export function extractAlbumFromDescription(description?: string): string | undefined {
    if (!description) return undefined;
    const match = description.match(/Provided to YouTube by[^\n]*\n\n[^\n]+·[^\n]+\n\n([^\n]+)\n\n[℗©]/);
    if (match && match[1]) {
        return match[1].trim();
    }
    return undefined;
}

export async function findTopicTrack(
    author: string,
    title: string
): Promise<{ id: string; url: string; title: string; channel: string; album?: string; artist?: string } | null> {
    return new Promise((resolve) => {
        // Search official YouTube release with "Provided to YouTube"
        const query = `ytsearch1:${author} ${title} "Provided to YouTube"`;
        const args = [
            "--no-warnings",
            "--ignore-errors",
            "--dump-json",
            query,
        ];
        const cookiesPath = getCookiesPath();
        if (cookiesPath) {
            args.push("--cookies", cookiesPath);
        }

        const proc = spawn("yt-dlp", args);
        let output = "";

        const timer = setTimeout(() => {
            try {
                proc.kill();
            } catch {}
            resolve(null);
        }, 6000);

        proc.stdout.on("data", (data) => {
            output += data.toString();
        });

        proc.on("close", () => {
            clearTimeout(timer);
            const lines = output.trim().split("\n");
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const item = JSON.parse(line.trim());
                    const id = item.id ? String(item.id).trim() : "";
                    if (id && id !== "NA" && !id.startsWith("[")) {
                        const album = (item.album && item.album !== "NA" ? String(item.album).trim() : undefined) 
                            || extractAlbumFromDescription(item.description);

                        return resolve({
                            id,
                            url: item.webpage_url || item.url || `https://www.youtube.com/watch?v=${id}`,
                            title: item.track || item.title ? String(item.track || item.title).trim() : title,
                            channel: item.channel || item.uploader ? String(item.channel || item.uploader).trim() : "",
                            album,
                            artist: item.artist && item.artist !== "NA" ? String(item.artist).trim() : undefined,
                        });
                    }
                } catch (err) {
                    console.warn("[yt-dlp Topic JSON parse error]:", err);
                }
            }
            resolve(null);
        });

        proc.on("error", () => {
            clearTimeout(timer);
            resolve(null);
        });
    });
}

function parseYtDlpVideo(item: any): Video | null {
    if (!item) return null;
    console.log("[yt-dlp JSON]:", JSON.stringify(item, null, 2));

    const id = item.id ? String(item.id).trim() : "";
    if (!id || id === "NA" || id.startsWith("[")) return null;

    const cleanRawArtist = item.artist && item.artist !== "NA" ? String(item.artist).trim() : undefined;
    const cleanRawTrack = item.track && item.track !== "NA" ? String(item.track).trim() : undefined;
    
    // Check if album is explicitly provided or if the playlist is an official YouTube album (starts with OLAK5uy_)
    let cleanRawAlbum = item.album && item.album !== "NA" ? String(item.album).trim() : undefined;
    if (!cleanRawAlbum && item.playlist_id && String(item.playlist_id).startsWith("OLAK5uy_") && item.playlist_title) {
        cleanRawAlbum = String(item.playlist_title).trim();
    }
    if (!cleanRawAlbum && item.description) {
        cleanRawAlbum = extractAlbumFromDescription(item.description);
    }

    const cleanRawTitle = item.title && item.title !== "NA" ? String(item.title).trim() : "Unknown";
    const cleanRawChannel =
        (item.channel || item.uploader) && (item.channel || item.uploader) !== "NA"
            ? String(item.channel || item.uploader).trim()
            : "";

    const { author, title } = extractArtistAndTitle(
        cleanRawTitle,
        cleanRawChannel,
        cleanRawArtist,
        cleanRawTrack
    );

    let thumbnail = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
    if (typeof item.thumbnail === "string" && item.thumbnail) {
        thumbnail = item.thumbnail;
    } else if (Array.isArray(item.thumbnails) && item.thumbnails.length > 0) {
        const lastThumb = item.thumbnails[item.thumbnails.length - 1];
        if (lastThumb && lastThumb.url) {
            thumbnail = lastThumb.url;
        }
    }

    const videoUrl =
        item.webpage_url ||
        item.url ||
        (id ? `https://www.youtube.com/watch?v=${id}` : "");

    return {
        id,
        url: videoUrl,
        title: title || cleanRawTitle || "Unknown Title",
        author: author || "Unknown Artist",
        rawTitle: cleanRawTitle,
        rawChannel: cleanRawChannel,
        rawArtist: cleanRawArtist,
        rawTrack: cleanRawTrack,
        rawAlbum: cleanRawAlbum,
        duration: formatDuration(item.duration),
        thumbnail,
        rawJson: item,
    };
}

export async function getPlaylist(url: string): Promise<Video[]> {
    return new Promise((resolve, reject) => {
        const cookiesPath = getCookiesPath();
        const args = [
            "--flat-playlist",
            "--no-warnings",
            "--ignore-errors",
            "--dump-json",
        ];

        if (cookiesPath) {
            args.push("--cookies", cookiesPath);
        }

        args.push(url);

        const ytDlp = spawn("yt-dlp", args);
        const videos: Video[] = [];
        let buffer = "";
        let errorOutput = "";

        ytDlp.stdout.on("data", (chunk) => {
            buffer += chunk.toString();

            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const item = JSON.parse(line.trim());
                    const video = parseYtDlpVideo(item);
                    if (video) {
                        videos.push(video);
                    }
                } catch (err) {
                    console.warn("[yt-dlp JSON parse error]:", err);
                }
            }
        });

        ytDlp.stderr.on("data", (data) => {
            errorOutput += data.toString();
        });

        ytDlp.on("error", (err) => {
            reject(new Error(`Failed to execute yt-dlp: ${err.message}`));
        });

        ytDlp.on("close", async (code) => {
            if (buffer.trim()) {
                try {
                    const item = JSON.parse(buffer.trim());
                    const video = parseYtDlpVideo(item);
                    if (video) {
                        videos.push(video);
                    }
                } catch {}
            }

            if (code !== 0 && videos.length === 0) {
                console.error("yt-dlp error:", errorOutput);
                return resolve([]);
            }

            // Resolve official Topic track & Album for tracks that are music videos or missing album
            const tracksToResolve = videos.filter((v) => isMusicVideo(v.rawTitle, v.rawChannel) || !v.rawAlbum);

            // Resolve in parallel batches of 8 for high throughput
            const batchSize = 8;
            for (let i = 0; i < tracksToResolve.length; i += batchSize) {
                const batch = tracksToResolve.slice(i, i + batchSize);
                await Promise.all(
                    batch.map(async (v) => {
                        try {
                            const topic = await findTopicTrack(v.author, v.title);
                            if (topic) {
                                if (topic.album && !v.rawAlbum) {
                                    v.rawAlbum = topic.album;
                                }
                                if (topic.id && topic.id !== v.id && isMusicVideo(v.rawTitle, v.rawChannel)) {
                                    v.originalUrl = v.url;
                                    v.originalId = v.id;
                                    v.id = topic.id;
                                    v.url = topic.url;
                                    v.isTopic = true;
                                    v.topicChannel = topic.channel;

                                    const topicMeta = extractArtistAndTitle(topic.title, topic.channel, topic.artist);
                                    if (topicMeta.title && topicMeta.title !== "Unknown Title") {
                                        v.title = topicMeta.title;
                                    }
                                    if (topicMeta.author && topicMeta.author !== "Unknown Artist") {
                                        v.author = topicMeta.author;
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn(`[Topic Resolution Warning] Erro ao buscar dados oficiais de "${v.title}":`, err);
                        }
                    })
                );
            }

            resolve(videos);
        });
    });
}

export interface DownloadCallbacks {
    onProgress?: (percent: number, rawMessage: string) => void;
}

export async function downloadMP3(
    url: string,
    filename: string,
    downloadFolder: string,
    author: string,
    title: string,
    albumOrCallbacks?: string | DownloadCallbacks,
    maybeCallbacks?: DownloadCallbacks
): Promise<void> {
    return new Promise((resolve, reject) => {
        const cookiesPath = getCookiesPath();

        let album: string | undefined;
        let callbacks: DownloadCallbacks | undefined;

        if (typeof albumOrCallbacks === "string") {
            album = albumOrCallbacks;
            callbacks = maybeCallbacks;
        } else if (albumOrCallbacks && typeof albumOrCallbacks === "object") {
            callbacks = albumOrCallbacks;
        }

        const cleanAuthor = author ? author.replace(/["\r\n]+/g, "").trim() : getMainArtist(author);
        const cleanTitle = title ? title.replace(/["\r\n]+/g, "").trim() : sanitizeTitle(title);
        const cleanAlbum = album ? album.replace(/["\r\n]+/g, "").trim() : "";

        const ffmpegMetadata = [
            `-metadata artist="${cleanAuthor.replace(/"/g, '\\"')}"`,
            `-metadata title="${cleanTitle.replace(/"/g, '\\"')}"`,
        ];
        if (cleanAlbum) {
            ffmpegMetadata.push(`-metadata album="${cleanAlbum.replace(/"/g, '\\"')}"`);
        }

        const args = [
            "--no-warnings",
            "--extractor-args",
            "youtube:player_client=android,web",
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "--embed-metadata",
            "--embed-thumbnail",
            // Replace feats and secondary artists in metadata so embedded ID3 tag has only the 1st artist
            "--replace-in-metadata",
            "artist",
            "(?i)\\s*(?:feat\\.?|ft\\.?|&| x | and |,|;).*$",
            "",
            // Explicitly set artist, title and album tags in FFmpeg metadata postprocessor
            "--postprocessor-args",
            `FFmpegMetadata:${ffmpegMetadata.join(" ")}`,
            "--no-keep-video",
            "-o",
            path.join(downloadFolder, `${filename}.%(ext)s`),
        ];

        if (cookiesPath) {
            args.push("--cookies", cookiesPath);
        }

        args.push(url);

        const proc = spawn("yt-dlp", args);
        let errorOutput = "";

        proc.stdout.on("data", (data) => {
            const str = data.toString();
            // Parse percentage if available e.g. [download]  45.0% of ...
            const percentMatch = str.match(/\[download\]\s+([\d.]+)%/);
            if (percentMatch && callbacks?.onProgress) {
                callbacks.onProgress(parseFloat(percentMatch[1]), str.trim());
            }
        });

        proc.stderr.on("data", (data) => {
            const str = data.toString();
            errorOutput += str;
            const percentMatch = str.match(/\[download\]\s+([\d.]+)%/);
            if (percentMatch && callbacks?.onProgress) {
                callbacks.onProgress(parseFloat(percentMatch[1]), str.trim());
            }
        });

        proc.on("error", (err) => {
            reject(err);
        });

        proc.on("close", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`yt-dlp exited with code ${code}: ${errorOutput.slice(-300).trim()}`));
            }
        });
    });
}
