import { useEffect, useRef, useState } from "react";
import type { JobStatus } from "../types";
import { IconX } from "./Icons";

export type LogLine = { time: string; text: string; kind?: "error" | "success" };

export type JobView = {
    status: JobStatus | "starting";
    percent: number;
    index: number;
    total: number;
    current?: string;
    message?: string;
    downloadUrl?: string;
    logs: LogLine[];
};

const LABEL: Record<JobView["status"], string> = {
    starting: "Iniciando",
    pending: "Na fila",
    downloading: "Baixando",
    zipping: "Compactando",
    completed: "Concluído",
    error: "Erro",
};

function describe(job: JobView): string {
    switch (job.status) {
        case "downloading":
            return job.current || "Baixando";
        case "zipping":
            return "Gerando arquivo ZIP";
        case "completed":
            return job.message || "Download pronto";
        case "error":
            return job.message || "Falha no download";
        default:
            return "Preparando";
    }
}

export function ProgressPanel({ job, onClose }: { job: JobView; onClose: () => void }) {
    const [showLog, setShowLog] = useState(false);
    const logRef = useRef<HTMLDivElement>(null);
    const done = job.status === "completed" || job.status === "error";

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [job.logs.length, showLog]);

    return (
        <section className={`dock dock-progress is-${job.status}`} aria-label="Progresso do download">
            <div className="progress-head" aria-live="polite">
                <span className="progress-state">{LABEL[job.status]}</span>
                <span className="progress-current">{describe(job)}</span>
                <span className="progress-num">
                    {job.total > 0 && !done && `${job.index} de ${job.total} prontas · `}
                    {job.percent}%
                </span>
                {done && (
                    <button type="button" className="btn-icon" aria-label="Fechar" onClick={onClose}>
                        <IconX />
                    </button>
                )}
            </div>

            <div
                className="progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={job.percent}
            >
                <div className="progress-fill" style={{ width: `${job.percent}%` }} />
            </div>

            <div className="progress-foot">
                <button type="button" className="link" onClick={() => setShowLog((s) => !s)}>
                    {showLog ? "Ocultar log" : "Ver log"}
                </button>
                {job.status === "completed" && job.downloadUrl && (
                    <a className="link" href={job.downloadUrl} download>
                        Baixar novamente
                    </a>
                )}
            </div>

            {showLog && (
                <div className="log" ref={logRef}>
                    {job.logs.map((l, i) => (
                        <div key={i} className={l.kind ? `log-${l.kind}` : undefined}>
                            <span className="log-time">{l.time}</span> {l.text}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
