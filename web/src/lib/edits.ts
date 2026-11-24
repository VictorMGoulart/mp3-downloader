import type { EditableField, Video } from "../types";

/**
 * Edições manuais salvas no navegador (por usuário, como o histórico):
 * - TrackEdits: campos editados por faixa (ID do vídeo) — reaplicados na próxima consulta;
 * - ArtistAliases: artista renomeado ("Queen Official" → "Queen") — aplicado a qualquer faixa desse artista.
 */

export const EDITS_KEY = "yt_track_edits_v1";
export const ALIASES_KEY = "yt_artist_aliases_v1";

export const EDITABLE_FIELDS: readonly EditableField[] = ["title", "author", "rawAlbum"];

export type TrackEdit = Partial<Record<EditableField, string>> & { updatedAt: string };
export type TrackEdits = Record<string, TrackEdit>;
export type ArtistAlias = { from: string; to: string; updatedAt: string };
/** Chave: nome original normalizado (sem acento/caixa). */
export type ArtistAliases = Record<string, ArtistAlias>;

export type OriginalFields = Pick<Video, "title" | "author" | "rawAlbum">;

// ---------- Persistência ----------

function loadJson<T extends object>(key: string, storage: Storage): T {
    try {
        const raw = storage.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : ({} as T);
    } catch {
        return {} as T;
    }
}

function saveJson(key: string, value: object, storage: Storage): void {
    try {
        if (Object.keys(value).length === 0) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify(value));
    } catch {
        // armazenamento indisponível: segue sem persistir
    }
}

export const loadEdits = (storage: Storage = localStorage) => loadJson<TrackEdits>(EDITS_KEY, storage);
export const saveEdits = (edits: TrackEdits, storage: Storage = localStorage) => saveJson(EDITS_KEY, edits, storage);
export const loadAliases = (storage: Storage = localStorage) => loadJson<ArtistAliases>(ALIASES_KEY, storage);
export const saveAliases = (aliases: ArtistAliases, storage: Storage = localStorage) =>
    saveJson(ALIASES_KEY, aliases, storage);

// ---------- Artistas ----------

export function artistKey(name: string): string {
    return (name || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

const PLACEHOLDER_ARTISTS = new Set(["", "unknown artist", "various artists", "varios artistas"]);

/** Vale a pena oferecer "sempre renomear from → to"? */
export function canAlias(from: string | undefined, to: string): boolean {
    const fromKey = artistKey(from ?? "");
    const toKey = artistKey(to);
    return !PLACEHOLDER_ARTISTS.has(fromKey) && Boolean(toKey) && fromKey !== toKey;
}

/** Nome a exibir para um artista, considerando os renomeados. */
export function resolveArtist(name: string, aliases: ArtistAliases): string {
    return aliases[artistKey(name)]?.to ?? name;
}

/**
 * Registra "from → to". Ignora nomes genéricos (ex.: "Unknown Artist").
 * Encadeia: se algo já apontava para `from`, passa a apontar para `to`.
 * Renomear de volta para o original remove o alias.
 */
export function recordAlias(aliases: ArtistAliases, from: string, to: string, now = new Date()): ArtistAliases {
    const fromKey = artistKey(from);
    const toKey = artistKey(to);
    if (PLACEHOLDER_ARTISTS.has(fromKey) || !toKey) return aliases;

    const next: ArtistAliases = {};
    for (const [key, alias] of Object.entries(aliases)) {
        const target = artistKey(alias.to) === fromKey ? to : alias.to;
        if (key !== artistKey(target)) next[key] = { ...alias, to: target };
    }
    if (fromKey !== toKey) next[fromKey] = { from, to, updatedAt: now.toISOString() };
    else delete next[fromKey];
    return next;
}

export function removeAlias(aliases: ArtistAliases, key: string): ArtistAliases {
    const next = { ...aliases };
    delete next[key];
    return next;
}

// ---------- Faixas ----------

/** Salva um campo editado para os IDs da faixa (atual e original, pois o ID pode mudar para a versão oficial). */
export function recordEdit(
    edits: TrackEdits,
    ids: (string | undefined)[],
    field: EditableField,
    value: string,
    original: OriginalFields | undefined,
    now = new Date()
): TrackEdits {
    const next = { ...edits };
    const sameAsOriginal = original !== undefined && (original[field] ?? "") === value;
    for (const id of new Set(ids.filter((x): x is string => Boolean(x)))) {
        const entry: TrackEdit = { ...next[id], updatedAt: now.toISOString() };
        if (sameAsOriginal) delete entry[field];
        else entry[field] = value;
        if (EDITABLE_FIELDS.some((f) => f in entry)) next[id] = entry;
        else delete next[id];
    }
    return next;
}

export function forgetEdits(edits: TrackEdits, ids: (string | undefined)[]): TrackEdits {
    const next = { ...edits };
    for (const id of ids) if (id) delete next[id];
    return next;
}

/** Campos salvos de uma faixa. IDs mais à direita têm prioridade (passe o ID atual por último). */
export function savedFieldsFor(edits: TrackEdits, ids: (string | undefined)[]): Partial<Record<EditableField, string>> {
    const out: Partial<Record<EditableField, string>> = {};
    for (const id of ids) {
        const entry = id ? edits[id] : undefined;
        if (!entry) continue;
        for (const f of EDITABLE_FIELDS) if (entry[f] !== undefined) out[f] = entry[f];
    }
    return out;
}

/**
 * Aplica edições salvas e artistas renomeados a uma faixa vinda do servidor.
 * Retorna a faixa e os campos "travados" (edições da própria faixa, que metadados novos não devem sobrescrever).
 */
export function applySaved(
    video: Video,
    edits: TrackEdits,
    aliases: ArtistAliases,
    extraIds: (string | undefined)[] = []
): { video: Video; locked: EditableField[] } {
    const saved = savedFieldsFor(edits, [...extraIds, video.originalId, video.id]);
    const locked = EDITABLE_FIELDS.filter((f) => saved[f] !== undefined);
    const next: Video = { ...video, ...saved };
    // Artista renomeado vale inclusive para nomes editados à mão (renomear "B" → "C" atualiza quem tinha "B").
    next.author = resolveArtist(next.author, aliases);
    return { video: next, locked };
}
