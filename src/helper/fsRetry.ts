import fs from "node:fs";

/**
 * No Windows, antivírus/indexador e processos recém-encerrados (yt-dlp, ffmpeg) seguram
 * arquivos por alguns instantes. Estas funções repetem a operação em vez de falhar na hora.
 */

const RETRYABLE = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY", "EMFILE", "ENFILE"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isLockError(err: unknown): boolean {
    return RETRYABLE.has((err as NodeJS.ErrnoException)?.code ?? "");
}

/** Renomeia, substituindo o destino, com novas tentativas enquanto o arquivo estiver bloqueado. */
export async function renameWithRetry(from: string, to: string, attempts = 10, delayMs = 300): Promise<void> {
    for (let i = 1; ; i++) {
        try {
            fs.renameSync(from, to);
            return;
        } catch (err) {
            if (i >= attempts || !isLockError(err)) throw err;
            await sleep(delayMs * i);
        }
    }
}

/** Remove arquivo ou pasta (recursivo). Nunca lança: o que sobrar a varredura de órfãos apaga depois. */
export function removeQuietly(target: string): boolean {
    try {
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        return true;
    } catch (err) {
        console.warn(`[cleanup] não foi possível remover ${target}: ${(err as Error).message}`);
        return false;
    }
}
