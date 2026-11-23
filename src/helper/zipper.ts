import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { removeQuietly } from "./fsRetry";

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

/** Esvazia a pasta (e a remove, se `removeSelf`). Tolera arquivos bloqueados por instantes no Windows. */
export function clearFolder(folder: string, removeSelf = false) {
    if (!fs.existsSync(folder)) return;
    if (removeSelf) {
        removeQuietly(folder);
        return;
    }
    for (const file of fs.readdirSync(folder)) removeQuietly(path.join(folder, file));
}
