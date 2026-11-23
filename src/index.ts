/**
 * CLI: baixa uma playlist inteira sem a interface web.
 * Uso: tsx src/index.ts <url-da-playlist> [nome.zip]
 * Saída em OUTPUT_DIR (padrão ./output).
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { downloadMP3, getPlaylist } from "./helper/youtube.adapter";
import { parseYoutubeUrl, safeFilename } from "./helper/validation";
import { clearFolder, zipFolder } from "./helper/zipper";

async function run(input?: string, zipArg?: string) {
    if (!input) {
        console.log("Uso: tsx src/index.ts <url-da-playlist> [nome.zip]");
        return;
    }

    const outputFolder = path.resolve(process.env.OUTPUT_DIR || "output");
    const downloadFolder = path.join(config.storage.dataDir, `cli-${Date.now()}`);
    const zipName = safeFilename((zipArg || "My Playlist").replace(/\.zip$/i, ""), "playlist") + ".zip";
    fs.mkdirSync(downloadFolder, { recursive: true });

    const videos = await getPlaylist(parseYoutubeUrl(input));
    if (!videos.length) {
        console.log("Playlist não encontrada.");
        return;
    }

    for (const [i, video] of videos.entries()) {
        console.log(`[${i + 1}/${videos.length}] ${video.author} - ${video.title}`);
        try {
            const name = safeFilename(`${video.author} - ${video.title}`, video.id);
            await downloadMP3(video.url, name, downloadFolder, video.author, video.title, video.rawAlbum);
        } catch (err) {
            console.warn(`  falhou: ${(err as Error).message}`);
        }
    }

    await zipFolder(downloadFolder, path.join(outputFolder, zipName));
    clearFolder(downloadFolder, true);
    console.log(`ZIP salvo em ${path.join(outputFolder, zipName)}`);
}

run(process.argv[2], process.argv[3]).catch((err) => {
    console.error("Erro:", err);
    process.exit(1);
});
