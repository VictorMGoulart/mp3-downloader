import type { DownloadProgressEvent, Video } from "./types";

export class ApiError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = "ApiError";
    }
}

async function postJson<T>(url: string, body: unknown, fallbackError: string): Promise<T> {
    let response: Response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    } catch {
        throw new ApiError("Não foi possível conectar ao servidor.", 0);
    }

    let data: any = null;
    try {
        data = await response.json();
    } catch {
        // resposta sem JSON
    }

    if (!response.ok) {
        throw new ApiError(data?.error || fallbackError, response.status);
    }
    return data as T;
}

export type PlaylistMessage =
    | { type: "list"; videos: Video[]; pending: number }
    | { type: "track"; id: string; video: Video }
    | { type: "done" }
    | { type: "error"; error: string };

export type PlaylistHandlers = {
    onList: (videos: Video[], pending: number) => void;
    onTrack: (id: string, video: Video) => void;
};

/**
 * Busca a playlist em stream: a lista chega primeiro (rápido) e os metadados de cada faixa
 * chegam depois, um a um. Resolve quando o servidor termina. Aceita AbortSignal para cancelar.
 */
export async function streamPlaylist(url: string, handlers: PlaylistHandlers, signal?: AbortSignal): Promise<void> {
    let response: Response;
    try {
        response = await fetch("/api/playlist", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
            body: JSON.stringify({ url }),
            signal,
        });
    } catch (err) {
        if (signal?.aborted) return;
        throw new ApiError("Não foi possível conectar ao servidor.", 0);
    }

    if (!response.ok || !response.body) {
        let data: any = null;
        try {
            data = await response.json();
        } catch {
            // sem JSON
        }
        throw new ApiError(data?.error || "Falha ao buscar a playlist.", response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let gotList = false;

    const handle = (line: string) => {
        if (!line.trim()) return;
        let msg: PlaylistMessage;
        try {
            msg = JSON.parse(line);
        } catch {
            return;
        }
        if (msg.type === "list") {
            gotList = true;
            handlers.onList(msg.videos, msg.pending);
        } else if (msg.type === "track") handlers.onTrack(msg.id, msg.video);
        else if (msg.type === "error") throw new ApiError(msg.error, 200);
    };

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            lines.forEach(handle);
        }
        handle(buffer + decoder.decode());
    } catch (err) {
        if (signal?.aborted) return;
        if (err instanceof ApiError) throw err;
        throw new ApiError(gotList ? "A conexão caiu enquanto buscava os metadados." : "Falha ao buscar a playlist.", 0);
    }
}

export type DownloadRequestVideo = Pick<Video, "id" | "url" | "title" | "author" | "rawAlbum">;

export async function startDownload(videos: DownloadRequestVideo[], zipName?: string): Promise<string> {
    const payload = videos.map(({ id, url, title, author, rawAlbum }) => ({ id, url, title, author, rawAlbum }));
    const data = await postJson<{ jobId: string }>(
        "/api/download",
        { videos: payload, zipName: zipName || undefined },
        "Falha ao iniciar o download."
    );
    return data.jobId;
}

export type ProgressHandlers = {
    onEvent: (event: DownloadProgressEvent) => void;
    /** `closed`: o navegador desistiu de reconectar (ex.: job não existe mais no servidor). */
    onConnectionError?: (closed: boolean) => void;
};

/** Assina o SSE de progresso. Retorna a função para encerrar a conexão. */
export function subscribeProgress(
    jobId: string,
    handlers: ProgressHandlers,
    EventSourceImpl: typeof EventSource = EventSource
): () => void {
    const source = new EventSourceImpl(`/api/progress/${encodeURIComponent(jobId)}`);
    source.onmessage = (e: MessageEvent) => {
        try {
            const event = JSON.parse(e.data) as DownloadProgressEvent;
            handlers.onEvent(event);
            if (event.status === "completed" || event.status === "error") source.close();
        } catch {
            // ignora mensagens malformadas
        }
    };
    // readyState 2 = CLOSED: a reconexão automática falhou de vez.
    source.onerror = () => handlers.onConnectionError?.(source.readyState === 2);
    return () => source.close();
}

/**
 * Descarta o ZIP no servidor (e cancela o download, se ainda estiver rodando).
 * Com `onUnload`, usa sendBeacon, que é entregue mesmo com a página fechando.
 */
export function discardDownload(jobId: string, onUnload = false): void {
    const url = `/api/download/${encodeURIComponent(jobId)}/discard`;
    if (onUnload && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url)) return;
    fetch(url, { method: "POST", keepalive: true }).catch(() => {
        // melhor esforço: o servidor expira o ZIP sozinho
    });
}

/** O ZIP ainda está disponível no servidor? */
export async function isZipAvailable(url: string): Promise<boolean> {
    try {
        const res = await fetch(url, { method: "HEAD" });
        return res.ok;
    } catch {
        return false;
    }
}

export function triggerBrowserDownload(url: string): void {
    const a = document.createElement("a");
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
}
