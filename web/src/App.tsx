import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
    discardDownload,
    isZipAvailable,
    startDownload,
    streamPlaylist,
    subscribeProgress,
    triggerBrowserDownload,
} from "./api";
import { loadHistory, saveHistory } from "./lib/history";
import { canAlias, loadAliases, loadEdits, saveAliases, saveEdits } from "./lib/edits";
import { computeOverallPercent } from "./lib/progress";
import {
    BULK_FIELDS,
    hasSavedEdits,
    initTracksState,
    sameValueIds,
    snapshotTracks,
    rangeBetween,
    isDownloadedIn,
    similarIn,
    selectedVideos,
    tracksReducer,
    visibleTracks,
} from "./lib/tracksReducer";
import type { DownloadProgressEvent, EditableField, ViewFilter } from "./types";
import { DownloadBar, type ReadyZip } from "./components/DownloadBar";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { IconClock } from "./components/Icons";
import { ProgressPanel, type JobView, type LogLine } from "./components/ProgressPanel";
import { Toasts, type ToastAction, type ToastMsg } from "./components/Toast";
import { Toolbar } from "./components/Toolbar";
import { TrackRow } from "./components/TrackRow";
import { UrlBar } from "./components/UrlBar";

const now = () => new Date().toLocaleTimeString("pt-BR");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function App() {
    const [state, dispatch] = useReducer(tracksReducer, undefined, () =>
        initTracksState(loadHistory(), loadEdits(), loadAliases())
    );
    const stateRef = useRef(state);
    stateRef.current = state;
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [job, setJob] = useState<JobView | null>(null);
    const [toasts, setToasts] = useState<ToastMsg[]>([]);
    const unsubscribe = useRef<(() => void) | null>(null);
    const playlistAbort = useRef<AbortController | null>(null);
    /** Job do servidor cujo ZIP (pronto ou em produção) pertence a esta página. */
    const serverJobId = useRef<string | null>(null);
    const [readyZip, setReadyZip] = useState<ReadyZip | null>(null);
    const closeHistory = useCallback(() => setHistoryOpen(false), []);

    /** Descarta o ZIP guardado no servidor (ao trocar de playlist, iniciar outro download ou sair). */
    const discardZip = useCallback((onUnload = false) => {
        if (serverJobId.current) discardDownload(serverJobId.current, onUnload);
        serverJobId.current = null;
        if (!onUnload) setReadyZip(null);
    }, []);

    useEffect(() => {
        const onPageHide = () => discardZip(true);
        window.addEventListener("pagehide", onPageHide);
        return () => window.removeEventListener("pagehide", onPageHide);
    }, [discardZip]);

    useEffect(() => saveHistory(state.history), [state.history]);
    useEffect(() => saveEdits(state.savedEdits), [state.savedEdits]);
    useEffect(() => saveAliases(state.aliases), [state.aliases]);
    useEffect(
        () => () => {
            unsubscribe.current?.();
            playlistAbort.current?.abort();
        },
        []
    );

    const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
    const toast = useCallback(
        (text: string, kind: ToastMsg["kind"] = "info", actions?: ToastAction[]) => {
            const id = Date.now() + Math.random();
            setToasts((t) => [...t, { id, text, kind, actions }]);
            setTimeout(() => dismissToast(id), actions?.length ? 10_000 : 4000);
        },
        [dismissToast]
    );

    const isDownloaded = useMemo(() => isDownloadedIn(state.history), [state.history]);
    const similarTo = useMemo(() => similarIn(state.history), [state.history]);
    /** Selecionadas que parecem já ter sido baixadas de outro vídeo (mesmo artista + título). */
    const similarSelected = useMemo(
        () => state.videos.filter((v) => state.selected.has(v.id) && similarTo(v)).map((v) => v.id),
        [state.videos, state.selected, similarTo]
    );
    const visible = useMemo(() => visibleTracks(state), [state]);
    const counts = useMemo(() => {
        const downloaded = state.videos.filter((v) => isDownloaded(v)).length;
        return { all: state.videos.length, new: state.videos.length - downloaded, downloaded };
    }, [state.videos, isDownloaded]);
    const visibleSelected = visible.filter((v) => state.selected.has(v.id)).length;
    const historyCount = Object.keys(state.history).length;
    const jobRunning = job !== null && job.status !== "completed" && job.status !== "error";

    const pendingCount = useMemo(
        () => state.videos.filter((v) => v.metadataSource === "pending").length,
        [state.videos]
    );

    // --- Playlist ---
    // A lista aparece assim que o servidor a envia; os metadados chegam faixa a faixa em seguida.
    const loadPlaylist = async (url: string) => {
        if (jobRunning) {
            toast("Aguarde o download atual terminar antes de buscar outra playlist.", "error");
            return;
        }
        discardZip();
        setJob(null);
        playlistAbort.current?.abort();
        const controller = new AbortController();
        playlistAbort.current = controller;
        setLoading(true);
        try {
            await streamPlaylist(
                url,
                {
                    onList: (videos) => {
                        selectionAnchor.current = null;
                        dispatch({ type: "loaded", videos });
                        setLoaded(true);
                        setLoading(false);
                    },
                    onTrack: (id, video) => dispatch({ type: "trackResolved", id, video }),
                },
                controller.signal
            );
        } catch (err) {
            toast(err instanceof Error ? err.message : "Falha ao buscar a playlist.", "error");
        } finally {
            if (playlistAbort.current === controller) {
                playlistAbort.current = null;
                setLoading(false);
                if (!controller.signal.aborted) dispatch({ type: "metadataFinished" });
            }
        }
    };

    // --- Row callbacks (estáveis para o memo de TrackRow) ---
    /** Última faixa clicada — âncora da seleção com Shift. */
    const selectionAnchor = useRef<string | null>(null);
    const onToggle = useCallback((id: string, checked: boolean, range = false) => {
        const anchor = selectionAnchor.current;
        const ids =
            range && anchor && anchor !== id ? rangeBetween(visibleTracks(stateRef.current), anchor, id) : null;
        dispatch(ids ? { type: "setRange", ids, checked } : { type: "toggle", id, checked });
        selectionAnchor.current = id;
    }, []);
    /**
     * Editar artista ou álbum altera todas as faixas da lista com o mesmo valor (vazio não se propaga).
     * Artista renomeado também vale para as próximas playlists. "Desfazer" reverte as faixas e a regra.
     */
    const onEdit = useCallback(
        (id: string, field: EditableField, value: string) => {
            const current = stateRef.current;
            const to = value.trim();
            const targets = BULK_FIELDS.includes(field) ? sameValueIds(current, id, field) : [id];
            const before = current.videos.find((v) => v.id === id)?.[field] ?? "";
            const snapshots = snapshotTracks(current, targets);
            const aliasesBefore = current.aliases;
            dispatch({ type: "editField", id, field, value, applyToSame: true });

            const createsRule = field === "author" && targets.some((t) => canAlias(current.originals[t]?.author, to));
            if (targets.length <= 1 && !createsRule) return;

            const what = field === "author" ? "Artista" : "Álbum";
            const where = targets.length > 1 ? ` em ${targets.length} faixas` : "";
            const future = createsRule ? " Vale também para as próximas playlists." : "";
            toast(`${what} “${before}” → “${to}”${where}.${future}`, "info", [
                {
                    label: "Desfazer",
                    onClick: () => dispatch({ type: "restoreTracks", snapshots, aliases: aliasesBefore }),
                },
            ]);
        },
        [toast]
    );
    const onReset = useCallback((id: string) => dispatch({ type: "resetTrack", id }), []);
    const onToggleDownloaded = useCallback((id: string, downloaded: boolean) => {
        dispatch(downloaded ? { type: "markDownloaded", ids: [id] } : { type: "unmarkDownloaded", id });
    }, []);

    // --- Download ---
    const appendLog = (j: JobView, text: string, kind?: LogLine["kind"]): JobView => {
        const last = j.logs[j.logs.length - 1];
        if (last && last.text === text) return j;
        return { ...j, logs: [...j.logs, { time: now(), text, kind }] };
    };

    const handleEvent = (event: DownloadProgressEvent, ids: string[]) => {
        setJob((prev) => {
            if (!prev) return prev;
            let next: JobView = {
                ...prev,
                status: event.status,
                percent: computeOverallPercent(event, prev.total),
                index: event.currentIndex ?? prev.index,
                total: event.totalCount || prev.total,
                current: event.currentVideo ? `${event.currentVideo.author} — ${event.currentVideo.title}` : prev.current,
                message: event.message,
                downloadUrl: event.downloadUrl ?? prev.downloadUrl,
            };
            if (event.message) {
                const kind =
                    event.status === "error" || event.message.startsWith("Falha em")
                        ? "error"
                        : event.status === "completed"
                          ? "success"
                          : undefined;
                next = appendLog(next, event.message, kind);
            }
            return next;
        });

        if (event.status === "completed") {
            // Só as faixas que entraram no ZIP vão para o histórico; as que falharam continuam selecionáveis.
            const failed = new Set(event.failedIds ?? []);
            const ok = ids.filter((id) => !failed.has(id));
            dispatch({ type: "markDownloaded", ids: ok });
            if (event.downloadUrl) {
                setReadyZip({ url: event.downloadUrl, count: ok.length });
                triggerBrowserDownload(event.downloadUrl);
            }
        }
    };

    const download = async (zipName: string | undefined) => {
        const videos = selectedVideos(state);
        if (videos.length === 0 || jobRunning || pendingCount > 0) return;
        const ids = videos.map((v) => v.id);

        unsubscribe.current?.();
        discardZip(); // um novo download substitui o ZIP anterior
        setJob({
            status: "starting",
            percent: 0,
            index: 0,
            total: videos.length,
            logs: [{ time: now(), text: `Iniciando download de ${plural(videos.length, "faixa", "faixas")}` }],
        });

        try {
            const jobId = await startDownload(videos, zipName);
            serverJobId.current = jobId;
            unsubscribe.current = subscribeProgress(jobId, {
                onEvent: (e) => handleEvent(e, ids),
                onConnectionError: (closed) => {
                    if (!closed) return; // o navegador ainda está tentando reconectar
                    const message = "Conexão com o servidor perdida. O download foi interrompido.";
                    setJob((j) =>
                        j && (j.status === "starting" || j.status === "pending" || j.status === "downloading" || j.status === "zipping")
                            ? appendLog({ ...j, status: "error", message }, message, "error")
                            : j
                    );
                },
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Falha ao iniciar o download.";
            setJob((j) => (j ? appendLog({ ...j, status: "error", message }, message, "error") : j));
        }
    };

    const redownloadZip = async () => {
        if (!readyZip) return;
        if (await isZipAvailable(readyZip.url)) {
            triggerBrowserDownload(readyZip.url);
        } else {
            setReadyZip(null);
            serverJobId.current = null;
            toast("O ZIP expirou no servidor. Baixe as músicas novamente.", "error");
        }
    };

    // --- Menu ---
    const menuItems = [
        { label: "Selecionar apenas novas", onSelect: () => dispatch({ type: "selectNew" }) },
        { label: "Desmarcar todas", onSelect: () => dispatch({ type: "deselectAll" }), disabled: state.selected.size === 0 },
        {
            label: `Desmarcar possivelmente baixadas${similarSelected.length ? ` (${similarSelected.length})` : ""}`,
            disabled: similarSelected.length === 0,
            onSelect: () => dispatch({ type: "setRange", ids: similarSelected, checked: false }),
        },
        {
            label: "Marcar selecionadas como baixadas",
            disabled: state.selected.size === 0,
            onSelect: () => {
                const n = state.selected.size;
                dispatch({ type: "markDownloaded", ids: [...state.selected] });
                toast(`${plural(n, "faixa marcada", "faixas marcadas")} como baixada${n === 1 ? "" : "s"}.`);
            },
        },
        {
            label: "Marcar playlist inteira como baixada",
            onSelect: () => {
                dispatch({ type: "markDownloaded", ids: state.videos.map((v) => v.id) });
                toast("Playlist marcada como baixada.");
            },
        },
    ];

    return (
        <div className={`app ${loaded ? "has-results" : ""}`}>
            <header className="topbar">
                <span className="brand">mp3 downloader</span>
                <button type="button" className="btn btn-ghost" onClick={() => setHistoryOpen(true)}>
                    <IconClock />
                    Histórico
                    <span className="muted">{historyCount}</span>
                </button>
            </header>

            <main className="content">
                <UrlBar compact={loaded} loading={loading} onSubmit={loadPlaylist} />

                {loaded && state.videos.length > 0 && (
                    <section className="results" aria-label="Faixas">
                        <div className="results-head">
                            <h2>{plural(counts.all, "faixa", "faixas")}</h2>
                            <span className="muted">
                                {counts.new} {counts.new === 1 ? "nova" : "novas"} · {counts.downloaded}{" "}
                                {counts.downloaded === 1 ? "baixada" : "baixadas"}
                            </span>
                            {pendingCount > 0 && (
                                <span className="metadata-progress" role="status">
                                    <span className="spinner" aria-hidden />
                                    Buscando metadados · {counts.all - pendingCount} de {counts.all}
                                </span>
                            )}
                        </div>

                        <Toolbar
                            query={state.query}
                            view={state.view}
                            counts={counts}
                            visibleCount={visible.length}
                            visibleSelected={visibleSelected}
                            menuItems={menuItems}
                            onQuery={(query) => dispatch({ type: "setQuery", query })}
                            onView={(view: ViewFilter) => dispatch({ type: "setView", view })}
                            onToggleVisible={(select) =>
                                dispatch({ type: select ? "selectVisible" : "deselectVisible" })
                            }
                        />

                        {visible.length === 0 ? (
                            <p className="empty">Nenhuma faixa corresponde ao filtro.</p>
                        ) : (
                            <ul className="tracks">
                                {visible.map((v) => (
                                    <TrackRow
                                        key={v.id}
                                        video={v}
                                        selected={state.selected.has(v.id)}
                                        downloaded={isDownloaded(v)}
                                        similar={similarTo(v)}
                                        onToggle={onToggle}
                                        onEdit={onEdit}
                                        onToggleDownloaded={onToggleDownloaded}
                                        edited={hasSavedEdits(state, v)}
                                        onReset={onReset}
                                    />
                                ))}
                            </ul>
                        )}
                    </section>
                )}
            </main>

            {job ? (
                <ProgressPanel job={job} onClose={() => setJob(null)} />
            ) : (
                <DownloadBar
                    selectedCount={state.selected.size}
                    waitingMessage={pendingCount > 0 ? "Aguardando metadados…" : undefined}
                    readyZip={readyZip ?? undefined}
                    onRedownload={redownloadZip}
                    onDownload={download}
                />
            )}

            <HistoryDrawer
                open={historyOpen}
                history={state.history}
                onClose={closeHistory}
                onRemove={(id) => dispatch({ type: "removeFromHistory", id })}
                onClear={() => dispatch({ type: "clearHistory" })}
                aliases={state.aliases}
                onRemoveAlias={(key) => dispatch({ type: "removeAlias", key })}
            />

            <Toasts toasts={toasts} onDismiss={dismissToast} />
        </div>
    );
}
