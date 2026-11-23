import { memo } from "react";
import { relativeTime } from "./HistoryDrawer";
import type { EditableField, HistoryEntry, Video } from "../types";
import { InlineEdit } from "./InlineEdit";
import { IconCheck, IconUndo } from "./Icons";

type Props = {
    video: Video;
    selected: boolean;
    downloaded: boolean;
    /** Mesma música (artista + título) já baixada a partir de outro vídeo. */
    similar?: HistoryEntry;
    disabled?: boolean;
    /** `range`: Shift pressionado — aplica a todas as faixas entre a última clicada e esta. */
    onToggle: (id: string, checked: boolean, range?: boolean) => void;
    onEdit: (id: string, field: EditableField, value: string) => void;
    onToggleDownloaded: (id: string, downloaded: boolean) => void;
    /** A faixa tem edições salvas (mostra o botão de restaurar). */
    edited?: boolean;
    onReset?: (id: string) => void;
};

const FALLBACK_THUMB =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='100%25' height='100%25' fill='%231b1b1e'/%3E%3C/svg%3E";

export const TrackRow = memo(function TrackRow({
    video,
    selected,
    downloaded,
    similar,
    disabled,
    onToggle,
    onEdit,
    onToggleDownloaded,
    edited,
    onReset,
}: Props) {
    const classes = ["track", selected && "is-selected", downloaded && "is-downloaded"].filter(Boolean).join(" ");

    return (
        <li
            className={classes}
            data-testid="track-row"
            onMouseDown={(e) => {
                // Shift + clique selecionaria o texto da página entre os cliques.
                if (e.shiftKey && !(e.target as HTMLElement).closest("input")) e.preventDefault();
            }}
            onClick={(e) => {
                if (disabled) return;
                if ((e.target as HTMLElement).closest("a, button, input")) return;
                onToggle(video.id, !selected, e.shiftKey);
            }}
        >
            <input
                type="checkbox"
                className="checkbox"
                checked={selected}
                disabled={disabled}
                aria-label={`Selecionar ${video.title}`}
                title="Shift + clique seleciona um intervalo"
                // Em checkboxes, o onChange do React vem do evento de clique — dá para ler o Shift.
                onChange={(e) => onToggle(video.id, e.target.checked, (e.nativeEvent as MouseEvent).shiftKey === true)}
            />

            <a
                className="track-thumb"
                href={video.url}
                target="_blank"
                rel="noopener noreferrer"
                title="Abrir no YouTube"
            >
                <img src={video.thumbnail || FALLBACK_THUMB} alt="" loading="lazy" />
            </a>

            <div className="track-meta">
                <InlineEdit
                    className="track-title"
                    value={video.title}
                    placeholder="Título"
                    label="Título"
                    onCommit={(v) => onEdit(video.id, "title", v)}
                />
                <div className="track-sub">
                    <InlineEdit
                        className="track-artist"
                        value={video.author}
                        placeholder="Artista"
                        label="Artista"
                        onCommit={(v) => onEdit(video.id, "author", v)}
                    />
                    <span className="dot" aria-hidden>·</span>
                    <InlineEdit
                        className="track-album"
                        value={video.rawAlbum || ""}
                        placeholder="Álbum"
                        label="Álbum"
                        onCommit={(v) => onEdit(video.id, "rawAlbum", v)}
                    />
                    {video.metadataSource === "pending" && (
                        <span className="track-flag is-pending" title="Buscando metadados do YouTube Music…">
                            buscando…
                        </span>
                    )}
                    {similar && (
                        <span
                            className="track-flag"
                            title={`Parece já ter sido baixada a partir de outro vídeo: ${similar.author} — ${similar.title} (${relativeTime(similar.downloadedAt)}). Continua selecionada; desmarque se for a mesma versão.`}
                        >
                            possivelmente baixada
                        </span>
                    )}
                    {video.unavailable && (
                        <span className="track-flag is-error" title="O vídeo está indisponível e não foi encontrada uma versão equivalente. O download vai tentar de novo, mas pode falhar.">
                            indisponível
                        </span>
                    )}
                    {video.replaced && (
                        <span className="track-flag" title="O vídeo original da playlist está indisponível. Será baixada a versão equivalente que o YouTube Music toca no lugar.">
                            versão alternativa
                        </span>
                    )}
                    {video.metadataSource === "title" && !video.unavailable && (
                        <span className="track-flag" title="Sem metadados do YouTube Music: artista e título foram inferidos do nome do vídeo. Confira.">
                            inferido
                        </span>
                    )}
                </div>
            </div>

            {video.duration && video.duration !== "--:--" && <span className="track-duration">{video.duration}</span>}

            {edited && onReset && (
                <button
                    type="button"
                    className="track-reset"
                    disabled={disabled}
                    title="Desfazer edições salvas desta faixa"
                    aria-label="Restaurar dados originais"
                    onClick={() => onReset(video.id)}
                >
                    <IconUndo width={14} height={14} />
                </button>
            )}

            <button
                type="button"
                className={`track-status ${downloaded ? "is-on" : ""}`}
                disabled={disabled}
                title={downloaded ? "Já baixada · clique para marcar como nova" : "Marcar como já baixada"}
                aria-label={downloaded ? "Marcar como nova" : "Marcar como já baixada"}
                aria-pressed={downloaded}
                onClick={() => onToggleDownloaded(video.id, !downloaded)}
            >
                <IconCheck width={14} height={14} />
            </button>
        </li>
    );
});
