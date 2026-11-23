import { useEffect, useMemo, useState } from "react";
import type { History } from "../types";
import type { ArtistAliases } from "../lib/edits";
import { sortedEntries } from "../lib/history";
import { IconSearch, IconTrash, IconX } from "./Icons";

type Props = {
    open: boolean;
    history: History;
    aliases?: ArtistAliases;
    onClose: () => void;
    onRemove: (id: string) => void;
    onClear: () => void;
    onRemoveAlias?: (key: string) => void;
};

type Tab = "downloads" | "artists";

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

export function relativeTime(iso: string, now = Date.now()): string {
    const diff = (new Date(iso).getTime() - now) / 1000;
    if (Number.isNaN(diff)) return "";
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ["year", 31536000],
        ["month", 2592000],
        ["day", 86400],
        ["hour", 3600],
        ["minute", 60],
    ];
    for (const [unit, secs] of units) {
        if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
    }
    return "agora";
}

export function HistoryDrawer({ open, history, aliases = {}, onClose, onRemove, onClear, onRemoveAlias }: Props) {
    const [tab, setTab] = useState<Tab>("downloads");
    const [query, setQuery] = useState("");
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
        if (!open) {
            setConfirming(false);
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    const q = query.trim().toLowerCase();
    const entries = useMemo(
        () =>
            sortedEntries(history).filter(
                (e) => !q || (e.title || "").toLowerCase().includes(q) || (e.author || "").toLowerCase().includes(q)
            ),
        [history, q]
    );
    const aliasEntries = useMemo(
        () =>
            Object.entries(aliases)
                .filter(([, a]) => !q || a.from.toLowerCase().includes(q) || a.to.toLowerCase().includes(q))
                .sort(([, a], [, b]) => a.from.localeCompare(b.from, "pt-BR")),
        [aliases, q]
    );

    const total = Object.keys(history).length;
    const aliasTotal = Object.keys(aliases).length;
    const showSearch = tab === "downloads" ? total > 0 : aliasTotal > 0;

    return (
        <>
            <div className={`scrim ${open ? "is-open" : ""}`} onClick={onClose} aria-hidden />
            <aside className={`drawer ${open ? "is-open" : ""}`} aria-label="Histórico" inert={!open}>
                <header className="drawer-head">
                    <div>
                        <h2>Histórico</h2>
                        <p>
                            {tab === "downloads"
                                ? "Faixas baixadas vêm desmarcadas ao carregar uma playlist."
                                : "Artistas renomeados são aplicados a todas as faixas deles."}
                        </p>
                    </div>
                    <button type="button" className="btn-icon" aria-label="Fechar histórico" onClick={onClose}>
                        <IconX />
                    </button>
                </header>

                <div className="segmented drawer-tabs" role="tablist" aria-label="Seção">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={tab === "downloads"}
                        className={tab === "downloads" ? "is-active" : ""}
                        onClick={() => setTab("downloads")}
                    >
                        Baixadas <span className="count">{total}</span>
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={tab === "artists"}
                        className={tab === "artists" ? "is-active" : ""}
                        onClick={() => setTab("artists")}
                    >
                        Artistas renomeados <span className="count">{aliasTotal}</span>
                    </button>
                </div>

                {showSearch && (
                    <label className="search">
                        <IconSearch />
                        <input
                            type="search"
                            value={query}
                            placeholder="Buscar"
                            aria-label="Buscar no histórico"
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </label>
                )}

                {tab === "downloads" ? (
                    <ul className="history-list">
                        {total === 0 && <li className="empty">Nada baixado ainda.</li>}
                        {total > 0 && entries.length === 0 && <li className="empty">Nenhum resultado.</li>}
                        {entries.map((e) => (
                            <li key={e.id} className="history-item">
                                <div className="history-meta">
                                    <span className="history-title">{e.title}</span>
                                    <span className="history-sub">
                                        {e.author} · {relativeTime(e.downloadedAt)}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    className="btn-icon"
                                    aria-label={`Remover ${e.title} do histórico`}
                                    onClick={() => onRemove(e.id)}
                                >
                                    <IconTrash width={14} height={14} />
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <ul className="history-list">
                        {aliasTotal === 0 && (
                            <li className="empty">
                                Nenhum artista renomeado. Ao editar o artista de uma faixa, o novo nome passa a valer em todas as playlists.
                            </li>
                        )}
                        {aliasTotal > 0 && aliasEntries.length === 0 && <li className="empty">Nenhum resultado.</li>}
                        {aliasEntries.map(([key, a]) => (
                            <li key={key} className="history-item">
                                <div className="history-meta">
                                    <span className="history-title">{a.to}</span>
                                    <span className="history-sub">em vez de “{a.from}”</span>
                                </div>
                                <button
                                    type="button"
                                    className="btn-icon"
                                    aria-label={`Deixar de renomear ${a.from}`}
                                    onClick={() => onRemoveAlias?.(key)}
                                >
                                    <IconTrash width={14} height={14} />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {tab === "downloads" && total > 0 && (
                    <footer className="drawer-foot">
                        {confirming ? (
                            <>
                                <span>Apagar todo o histórico?</span>
                                <button type="button" className="btn" onClick={() => setConfirming(false)}>
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-danger"
                                    onClick={() => {
                                        onClear();
                                        setConfirming(false);
                                    }}
                                >
                                    Apagar
                                </button>
                            </>
                        ) : (
                            <button type="button" className="btn" onClick={() => setConfirming(true)}>
                                Limpar histórico
                            </button>
                        )}
                    </footer>
                )}
            </aside>
        </>
    );
}
