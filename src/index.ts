import path from "node:path";
import { downloadMP3, getPlaylist } from "./helper/youtube.adapter";
import { clearFolder, zipFolder } from "./helper/zipper";

const query = process.argv[2];
const outputFolder = "/app/output";
const downloadFolder = "/app/tmp";
const zipName = process.argv[3] || "My Playlist.zip";
const zipPath = path.join(outputFolder, zipName);

async function run(query?: string) {
    if (!query) return;

    const videos = await getPlaylist(query);

    if (!videos?.length) {
        console.log("⚠️ Playlist not found.");
        return;
    }

    for (const video of videos) {
        await downloadMP3(video.url, video.title, downloadFolder);
    }

    console.log(`✅ Playlist downloaded.`);

    await zipFolder(downloadFolder, zipPath);
    clearFolder(downloadFolder);

    console.log("✅ Files zipped.");
}

run(query)
    .then(() => {
        console.log("🏁 Finished");
    })
    .catch((err) => {
        console.error("❌ Error:", err);
        process.exit(1);
    });
