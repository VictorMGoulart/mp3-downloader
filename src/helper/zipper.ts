import fs from "fs";
import path from "path";
import archiver from "archiver";

export async function zipFolder(source: string, out: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(out);
        const archive = archiver("zip", { zlib: { level: 9 } });

        output.on("close", () => {
            resolve();
        });

        archive.on("error", (err: any) => reject(err));

        archive.pipe(output);
        archive.directory(source, false);
        archive.finalize();
    });
}

export function clearFolder(folder: string) {
    if (!fs.existsSync(folder)) return;

    for (const file of fs.readdirSync(folder)) {
        const filePath = path.join(folder, file);
        fs.unlinkSync(filePath);
    }
}
