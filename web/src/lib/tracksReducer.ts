import type { EditableField, History, Video, ViewFilter } from "../types";
import { addToHistory, indexHistory, removeFromHistory } from "./history";
import { filterTracks } from "./filter";
import {
    applySaved,
    artistKey,
    canAlias,
    forgetEdits,
    recordAlias,
    recordEdit,
    removeAlias,
    savedFieldsFor,
    resolveArtist,
    type ArtistAliases,
    type OriginalFields,
    type TrackEdit,
    type TrackEdits,
} from "./edits";

export type TracksState = {
    videos: Video[];
    selected: ReadonlySet<string>;
    history: History;
    query: string;
    view: ViewFilter;
    /** Campos editados pelo usuário, por faixa — não são sobrescritos quando os metadados chegam. */
    edited: Readonly<Record<string, readonly EditableField[]>>;
    /** Valores como vieram do servidor (antes de edições/renomeações) — para restaurar e comparar. */
    originals: Readonly<Record<string, OriginalFields>>;
    /** Persistidos no navegador. */
    savedEdits: TrackEdits;
    aliases: ArtistAliases;
};

export type TracksAction =
    | { type: "loaded"; videos: Video[] }
    | { type: "toggle"; id: string; checked?: boolean }
    | { type: "setRange"; ids: string[]; checked: boolean }
    | { type: "selectVisible" }
    | { type: "deselectVisible" }
    | { type: "selectNew" }
    | { type: "deselectAll" }
    /** `applyToSame`: aplica também às faixas com o mesmo valor nesse campo (artista/álbum). */
    | { type: "editField"; id: string; field: EditableField; value: string; now?: Date; applyToSame?: boolean }
    | { type: "restoreTracks"; snapshots: TrackSnapshot[]; aliases?: ArtistAliases }
    | { type: "resetTrack"; id: string }
    | { type: "renameArtist"; from: string; to: string; now?: Date }
    | { type: "removeAlias"; key: string }
    | { type: "markDownloaded"; ids: string[]; now?: Date }
    | { type: "unmarkDownloaded"; id: string }
    | { type: "removeFromHistory"; id: string }
    | { type: "clearHistory" }
    | { type: "setQuery"; query: string }
    | { type: "setView"; view: ViewFilter }
    | { type: "trackResolved"; id: string; video: Video }
    | { type: "metadataFinished" };

/** Estado de faixas antes de uma edição — para "Desfazer". */
export type TrackSnapshot = {
    id: string;
    fields: OriginalFields;
    edited?: readonly EditableField[];
    /** Entradas de edições salvas (ID atual e original); undefined = não existia. */
    saved: Record<string, TrackEdit | undefined>;
};

/** Campos em que editar uma faixa altera todas com o mesmo valor. */
export const BULK_FIELDS: readonly EditableField[] = ["author", "rawAlbum"];

/**
 * Faixas que têm o mesmo valor que a faixa `id` no campo (sem diferenciar caixa/acentos/espaços),
 * incluindo ela. Valor vazio não se propaga.
 */
export function sameValueIds(state: TracksState, id: string, field: EditableField): string[] {
    const video = state.videos.find((v) => v.id === id);
    if (!video) return [];
    const key = artistKey(video[field] ?? "");
    if (!BULK_FIELDS.includes(field) || !key) return [id];
    return state.videos.filter((v) => artistKey(v[field] ?? "") === key).map((v) => v.id);
}

export function snapshotTracks(state: TracksState, ids: string[]): TrackSnapshot[] {
    return state.videos
        .filter((v) => ids.includes(v.id))
        .map((v) => {
            const saved: Record<string, TrackEdit | undefined> = {};
            for (const key of [v.id, v.originalId]) if (key) saved[key] = state.savedEdits[key];
            return {
                id: v.id,
                fields: { title: v.title, author: v.author, rawAlbum: v.rawAlbum },
                edited: state.edited[v.id],
                saved,
            };
        });
}

export function initTracksState(
    history: History,
    savedEdits: TrackEdits = {},
    aliases: ArtistAliases = {}
): TracksState {
    return {
        videos: [],
        selected: new Set(),
        history,
        query: "",
        view: "all",
        edited: {},
        originals: {},
        savedEdits,
        aliases,
    };
}

/** Baixada = o ID atual ou o original da faixa está no histórico. */
export const isDownloadedIn = (history: History) => {
    const index = indexHistory(history);
    return (video: Pick<Video, "id" | "originalId">) => Boolean(index.downloaded(video));
};

/** Entrada do histórico com a mesma música (artista + título) baixada de outro vídeo. */
export const similarIn = (history: History) => indexHistory(history).similar;

export function visibleTracks(state: TracksState): Video[] {
    return filterTracks(state.videos, state.query, state.view, isDownloadedIn(state.history));
}

export function selectedVideos(state: TracksState): Video[] {
    return state.videos.filter((v) => state.selected.has(v.id));
}

/**
 * IDs entre `anchorId` e `targetId` (inclusive) na ordem em que aparecem — para seleção com Shift.
 * Retorna null se a âncora não estiver na lista (ex.: escondida pelo filtro).
 */
export function rangeBetween(list: Video[], anchorId: string, targetId: string): string[] | null {
    const a = list.findIndex((v) => v.id === anchorId);
    const b = list.findIndex((v) => v.id === targetId);
    if (a === -1 || b === -1) return null;
    const [start, end] = a <= b ? [a, b] : [b, a];
    return list.slice(start, end + 1).map((v) => v.id);
}

export function hasSavedEdits(state: TracksState, video: Video): boolean {
    return Boolean(state.savedEdits[video.id] || (video.originalId && state.savedEdits[video.originalId]));
}

function newIds(videos: Video[], history: History): Set<string> {
    const isDownloaded = isDownloadedIn(history);
    return new Set(videos.filter((v) => !isDownloaded(v)).map((v) => v.id));
}

const pickOriginal = (v: Video): OriginalFields => ({ title: v.title, author: v.author, rawAlbum: v.rawAlbum });

/** Reaplica os artistas renomeados às faixas cujo artista não foi editado manualmente. */
function reapplyAliases(state: TracksState, aliases: ArtistAliases): Video[] {
    return state.videos.map((v) => {
        // Base: o que o usuário digitou (edição salva) ou o nome original do servidor.
        const typed = savedFieldsFor(state.savedEdits, [v.originalId, v.id]).author;
        const base = typed ?? (state.edited[v.id]?.includes("author") ? v.author : state.originals[v.id]?.author ?? v.author);
        const author = resolveArtist(base, aliases);
        return author === v.author ? v : { ...v, author };
    });
}

export function tracksReducer(state: TracksState, action: TracksAction): TracksState {
    switch (action.type) {
        case "loaded": {
            const originals: Record<string, OriginalFields> = {};
            const edited: Record<string, EditableField[]> = {};
            const videos = action.videos.map((raw) => {
                originals[raw.id] = pickOriginal(raw);
                const { video, locked } = applySaved(raw, state.savedEdits, state.aliases);
                if (locked.length) edited[raw.id] = locked;
                return video;
            });
            return {
                ...state,
                videos,
                originals,
                edited,
                selected: newIds(videos, state.history),
                query: "",
                view: "all",
            };
        }

        case "toggle": {
            const selected = new Set(state.selected);
            const checked = action.checked ?? !selected.has(action.id);
            if (checked) selected.add(action.id);
            else selected.delete(action.id);
            return { ...state, selected };
        }

        case "setRange": {
            const known = new Set(state.videos.map((v) => v.id));
            const selected = new Set(state.selected);
            for (const id of action.ids) {
                if (!known.has(id)) continue;
                if (action.checked) selected.add(id);
                else selected.delete(id);
            }
            return { ...state, selected };
        }

        case "selectVisible": {
            const selected = new Set(state.selected);
            for (const v of visibleTracks(state)) selected.add(v.id);
            return { ...state, selected };
        }

        case "deselectVisible": {
            const selected = new Set(state.selected);
            for (const v of visibleTracks(state)) selected.delete(v.id);
            return { ...state, selected };
        }

        case "selectNew":
            return { ...state, selected: newIds(state.videos, state.history) };

        case "deselectAll":
            return { ...state, selected: new Set() };

        case "editField": {
            if (!state.videos.some((v) => v.id === action.id)) return state;
            const value = action.value.trim();
            const targets = new Set(action.applyToSame ? sameValueIds(state, action.id, action.field) : [action.id]);

            const edited = { ...state.edited };
            let savedEdits = state.savedEdits;
            const videos = state.videos.map((v) => {
                if (!targets.has(v.id)) return v;
                const fields = edited[v.id] ?? [];
                if (!fields.includes(action.field)) edited[v.id] = [...fields, action.field];
                savedEdits = recordEdit(
                    savedEdits,
                    [v.id, v.originalId],
                    action.field,
                    value,
                    state.originals[v.id],
                    action.now
                );
                return { ...v, [action.field]: value };
            });

            // Artista renomeado vale para as próximas playlists: registra "nome original → novo"
            // para cada nome de origem das faixas alteradas (podem diferir na grafia ou já ser renomeados).
            let aliases = state.aliases;
            if (action.applyToSame && action.field === "author") {
                for (const id of targets) {
                    const from = state.originals[id]?.author;
                    if (from && canAlias(from, value)) aliases = recordAlias(aliases, from, value, action.now);
                }
            }
            return { ...state, videos, edited, savedEdits, aliases };
        }

        case "restoreTracks": {
            const byId = new Map(action.snapshots.map((s) => [s.id, s]));
            const edited = { ...state.edited };
            const savedEdits = { ...state.savedEdits };
            for (const snap of action.snapshots) {
                if (snap.edited) edited[snap.id] = snap.edited;
                else delete edited[snap.id];
                for (const [key, entry] of Object.entries(snap.saved)) {
                    if (entry) savedEdits[key] = entry;
                    else delete savedEdits[key];
                }
            }
            const videos = state.videos.map((v) => {
                const snap = byId.get(v.id);
                return snap ? { ...v, ...snap.fields } : v;
            });
            return { ...state, videos, edited, savedEdits, aliases: action.aliases ?? state.aliases };
        }

        case "resetTrack": {
            const video = state.videos.find((v) => v.id === action.id);
            const original = state.originals[action.id];
            if (!video || !original) return state;
            const edited = { ...state.edited };
            delete edited[action.id];
            const restored: Video = {
                ...video,
                ...original,
                author: resolveArtist(original.author, state.aliases),
            };
            return {
                ...state,
                videos: state.videos.map((v) => (v.id === action.id ? restored : v)),
                edited,
                savedEdits: forgetEdits(state.savedEdits, [video.id, video.originalId]),
            };
        }

        case "renameArtist": {
            const aliases = recordAlias(state.aliases, action.from, action.to, action.now);
            return { ...state, aliases, videos: reapplyAliases(state, aliases) };
        }

        case "removeAlias": {
            const aliases = removeAlias(state.aliases, action.key);
            return { ...state, aliases, videos: reapplyAliases(state, aliases) };
        }

        case "trackResolved": {
            const index = state.videos.findIndex((v) => v.id === action.id);
            if (index === -1) return state;

            const current = state.videos[index];
            const { video: merged, locked } = applySaved(action.video, state.savedEdits, state.aliases, [action.id]);
            const sessionLocked = state.edited[action.id] ?? [];
            for (const field of sessionLocked) Object.assign(merged, { [field]: current[field] });
            const allLocked = [...new Set([...sessionLocked, ...locked])];

            const newId = merged.id;
            const selected = new Set(state.selected);
            const edited = { ...state.edited };
            const originals = { ...state.originals };
            delete edited[action.id];
            delete originals[action.id];

            // Trocou para a versão oficial e ela já está na lista: remove a duplicata.
            if (newId !== action.id && state.videos.some((v) => v.id === newId)) {
                selected.delete(action.id);
                return { ...state, videos: state.videos.filter((_, i) => i !== index), selected, edited, originals };
            }

            originals[newId] = pickOriginal(action.video);
            if (allLocked.length) edited[newId] = allLocked;

            const videos = state.videos.slice();
            videos[index] = merged;
            if (newId !== action.id) {
                const wasSelected = selected.delete(action.id);
                if (wasSelected && !isDownloadedIn(state.history)(merged)) selected.add(newId);
            }
            return { ...state, videos, selected, edited, originals };
        }

        case "metadataFinished":
            // O que não chegou (conexão caiu, cancelado) fica com o que foi inferido do título.
            return state.videos.some((v) => v.metadataSource === "pending")
                ? {
                      ...state,
                      videos: state.videos.map((v) =>
                          v.metadataSource === "pending" ? { ...v, metadataSource: "title" } : v
                      ),
                  }
                : state;

        case "markDownloaded": {
            const ids = new Set(action.ids);
            const videos = state.videos.filter((v) => ids.has(v.id));
            const selected = new Set([...state.selected].filter((id) => !ids.has(id)));
            return { ...state, history: addToHistory(state.history, videos, action.now), selected };
        }

        case "unmarkDownloaded":
        case "removeFromHistory": {
            // Remove pelo ID atual e pelo original; faixas da lista que deixaram de ser "baixadas" voltam a ser selecionadas.
            const video = state.videos.find((v) => v.id === action.id);
            const entry = state.history[action.id];
            const history = removeFromHistory(state.history, [action.id, video?.originalId, entry?.originalId]);
            const before = isDownloadedIn(state.history);
            const after = isDownloadedIn(history);
            const selected = new Set(state.selected);
            for (const v of state.videos) if (before(v) && !after(v)) selected.add(v.id);
            return { ...state, history, selected };
        }

        case "clearHistory":
            return { ...state, history: {}, selected: new Set(state.videos.map((v) => v.id)) };

        case "setQuery":
            return { ...state, query: action.query };

        case "setView":
            return { ...state, view: action.view };
    }
}
