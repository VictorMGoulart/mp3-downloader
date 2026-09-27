import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";

export async function zipFolder(source: string, out: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const outDir = path.dirname(out);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        const output = fs.createWriteStream(out);
        const archive = archiver("zip", { zlib: { level: 9 } });

        let mp3Count = 0;

        output.on("close", () => {
            resolve(mp3Count);
        });

        archive.on("error", (err: any) => reject(err));

        archive.pipe(output);

        if (fs.existsSync(source)) {
            const files = fs.readdirSync(source);
            for (const file of files) {
                const filePath = path.join(source, file);
                try {
                    const stat = fs.statSync(filePath);
                    if (stat.isFile() && file.toLowerCase().endsWith(".mp3")) {
                        archive.file(filePath, { name: file });
                        mp3Count++;
                    } else if (stat.isFile() && !file.toLowerCase().endsWith(".mp3")) {
                        // Delete residual non-mp3 files (e.g. webp thumbnails from interrupted/failed downloads)
                        fs.unlinkSync(filePath);
                    }
                } catch {}
            }
        }

        archive.finalize();
    });
}

export function clearFolder(folder: string, removeSelf = false) {
    if (!fs.existsSync(folder)) return;

    try {
        const files = fs.readdirSync(folder);
        for (const file of files) {
            const filePath = path.join(folder, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                clearFolder(filePath, true);
            } else {
                fs.unlinkSync(filePath);
            }
        }
        if (removeSelf) {
            fs.rmdirSync(folder);
        }
    } catch (err) {
        console.error(`Error cleaning directory ${folder}:`, err);
    }
}
