/**
 * Normalização de metadados de música.
 *
 * Fonte preferida: metadados do YouTube Music (campos `artists`, `track`, `album` que o yt-dlp
 * devolve para faixas oficiais "Provided to YouTube" / canais "- Topic").
 * O título do vídeo só é interpretado como último recurso (metadataSource = "title").
 */

export type TrackMetadata = {
    author: string;
    title: string;
    album?: string;
};

const UNKNOWN_ARTIST = "Unknown Artist";
const UNKNOWN_TITLE = "Unknown Title";

// ---------- Participações (feat.) ----------

/** Palavras que introduzem artistas convidados. "part." exige o ponto para não pegar "Part 2". */
const FEAT_WORDS = String.raw`feat\.?|ft\.?|featuring|part\.|participação(?:\s+especial)?(?:\s+de)?|with|com`;
const FEAT_IN_GROUP = new RegExp(String.raw`^\s*(?:${FEAT_WORDS})\s`, "i");
/** feat. sem parênteses, até o fim (ou até um " - " / parêntese seguinte). "with"/"com" ficam de fora: são palavras comuns em títulos. */
const FEAT_BARE = /\s+(?:feat\.?|ft\.?|featuring|part\.)\s+[^()[\]]*?(?=\s+[-–—]\s|\s*[([]|$)/gi;

// ---------- Edições / versões ----------

/** Fronteiras de palavra que entendem acentos (o \b do JS só considera ASCII). */
const WB_START = String.raw`(?<![\p{L}\p{N}])`;
const WB_END = String.raw`(?![\p{L}\p{N}])`;

/** Anotações que indicam outra edição da MESMA gravação — removidas do título. */
const EDITION_RE = new RegExp(
    [
        String.raw`remaster(?:ed)?`,
        String.raw`remasterizad[oa]`,
        String.raw`deluxe`,
        String.raw`expanded`,
        String.raw`edition`,
        String.raw`edição`,
        String.raw`version`,
        String.raw`versão`,
        String.raw`edit`,
        String.raw`bonus(?:\s+track)?`,
        String.raw`mono`,
        String.raw`stereo`,
        String.raw`anniversary`,
        String.raw`aniversário`,
        String.raw`explicit`,
        String.raw`clean`,
        String.raw`live`,
        String.raw`ao\s+vivo`,
        String.raw`acoustic`,
        String.raw`acústic[oa]`,
        String.raw`extended(?:\s+mix)?`,
        String.raw`radio\s+mix`,
        String.raw`original\s+mix`,
        String.raw`(?:19|20)\d{2}\s+(?:stereo\s+|mono\s+)?mix`,
        // ruído típico de vídeo
        String.raw`official(?:\s+(?:music\s+)?(?:video|audio|visualizer|lyric\s+video|clip))?`,
        String.raw`oficial`,
        String.raw`(?:music|lyric|lyrics)\s+video`,
        String.raw`lyrics?`,
        String.raw`letra`,
        String.raw`legendad[oa]`,
        String.raw`audio`,
        String.raw`áudio`,
        String.raw`visualizer`,
        String.raw`video\s*clipe?`,
        String.raw`clipe`,
        String.raw`videoclip`,
        String.raw`mv`,
        String.raw`4k`,
        String.raw`hd`,
        String.raw`hq`,
    ]
        .map((p) => `${WB_START}(?:${p})${WB_END}`)
        .join("|"),
    "iu"
);

/** Anotações que indicam OUTRA gravação — mantidas mesmo que contenham palavras de edição. */
const DISTINCT_RECORDING_RE = new RegExp(
    String.raw`${WB_START}(?:remix|rmx|instrumental|karaok[eê]|demo|cover|sped\s*up|slowed|reverb|nightcore|bootleg|mashup|vip)${WB_END}`,
    "iu"
);

const YEAR_ONLY_RE = /^\s*(?:19|20)\d{2}\s*$/;

function isRemovableGroup(content: string): boolean {
    if (FEAT_IN_GROUP.test(content)) return true;
    if (DISTINCT_RECORDING_RE.test(content)) return false;
    return EDITION_RE.test(content) || YEAR_ONLY_RE.test(content);
}

/** Remove grupos "(...)" e "[...]" que sejam participação ou edição. Mantém os demais: "(I Can't Get No) Satisfaction". */
function stripGroups(title: string): string {
    let prev: string;
    let out = title;
    do {
        prev = out;
        out = out.replace(/\s*[([]([^()[\]]*)[)\]]/g, (whole, content: string) =>
            isRemovableGroup(content) ? "" : whole
        );
    } while (out !== prev);
    return out;
}

/** Remove sufixos " - Remastered 2011", " - Live at Wembley", " - Radio Edit". */
function stripDashSuffix(title: string): string {
    const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (!m) return title;
    const [, head, suffix] = m;
    if (DISTINCT_RECORDING_RE.test(suffix)) return title;
    return EDITION_RE.test(suffix) || YEAR_ONLY_RE.test(suffix) ? stripDashSuffix(head) : title;
}

function tidy(s: string): string {
    return s
        .replace(/[<>:"/\\|?*]+/g, "")
        .replace(/\s+/g, " ")
        .replace(/^['"`‘“\s]+|['"`’”\s]+$/g, "")
        .replace(/\s*[-–—]\s*$/, "")
        .trim();
}

/**
 * Limpa o nome de uma faixa: remove participações ("feat. X", "(ft. X)", "part. X")
 * e anotações de edição ("(2022 Remaster)", "(Deluxe Edition)", " - Radio Edit", "(Official Video)").
 * Mantém remixes, instrumentais, demos e parênteses que fazem parte do nome.
 */
export function cleanTrackTitle(raw: string | undefined | null): string {
    if (!raw) return UNKNOWN_TITLE;
    let t = raw.normalize("NFC");
    t = stripGroups(t);
    t = t.replace(FEAT_BARE, "");
    t = stripDashSuffix(t);
    t = tidy(t);
    return t || tidy(raw) || UNKNOWN_TITLE;
}

/** Álbum: remove só anotações de edição ("(Deluxe Edition)", "(Remastered)"). */
export function cleanAlbum(raw: string | undefined | null): string | undefined {
    if (!raw) return undefined;
    const a = tidy(stripDashSuffix(stripGroups(raw.normalize("NFC"))));
    return a || tidy(raw) || undefined;
}

// ---------- Artistas ----------

export function stripChannelSuffix(name: string): string {
    return name
        .replace(/\s*-\s*Topic$/i, "")
        .replace(/VEVO$/i, "")
        .replace(/\s+Official$/i, "")
        .replace(/\s+Oficial$/i, "")
        .trim();
}

/** Artista principal a partir de metadados: `artists` (lista) tem prioridade sobre `artist` ("A, B"). */
export function mainArtistFromMetadata(artists: unknown, artist: unknown): string | undefined {
    if (Array.isArray(artists)) {
        const first = artists.find((a) => typeof a === "string" && a.trim());
        if (first) return tidy(first);
    }
    if (typeof artist === "string" && artist.trim() && artist !== "NA") {
        // yt-dlp junta múltiplos artistas com ", " — nomes com "&" (ex.: "Simon & Garfunkel") são preservados.
        return tidy(artist.split(/\s*,\s*/)[0]);
    }
    return undefined;
}

/** Artista principal a partir de texto livre (título/canal) — heurística, usada só sem metadados. */
export function mainArtistFromText(raw: string | undefined | null): string {
    if (!raw) return UNKNOWN_ARTIST;
    const cleaned = stripChannelSuffix(raw);
    const first = cleaned.split(
        /\s*(?:,|;|\s&\s|\s\+\s|\bx\b|\bvs\.?(?=\s)|\bfeat\.?(?=\s)|\bft\.?(?=\s)|\bfeaturing\b|\bpart\.(?=\s)|\bwith\b|\bcom\b|\be\b)\s*/i
    )[0];
    return tidy(first.replace(/^[("[]+|[)"\]]+$/g, "")) || UNKNOWN_ARTIST;
}

// ---------- Fontes ----------

/** Metadados do YouTube Music, se o item do yt-dlp os tiver. */
export function metadataFromYtDlp(item: any): TrackMetadata | null {
    if (!item) return null;
    const track = typeof item.track === "string" && item.track !== "NA" ? item.track : undefined;
    const author = mainArtistFromMetadata(item.artists, item.artist ?? item.creator);
    if (!track || !author) return null;
    return {
        author,
        title: cleanTrackTitle(track),
        album: cleanAlbum(typeof item.album === "string" && item.album !== "NA" ? item.album : undefined),
    };
}

/** Separador "Artista - Título" (não quebra palavras compostas como "bran-new"). */
const ARTIST_TITLE_RE = /^([^-–—]{1,60}?)(?:\s+[-–—]\s*|\s*[-–—]\s+|\s*[-–—](?=['"`‘“]))\s*(.+)$/;

/** Último recurso: interpreta "Artista - Título (Official Video)" ou usa o canal como artista. */
export function metadataFromTitle(rawTitle: string, channel: string): TrackMetadata {
    const m = (rawTitle || "").match(ARTIST_TITLE_RE);
    if (m) return { author: mainArtistFromText(m[1]), title: cleanTrackTitle(m[2]) };
    return { author: mainArtistFromText(channel), title: cleanTrackTitle(rawTitle) };
}

/** Álbum a partir da descrição padrão "Provided to YouTube by ...". */
export function albumFromDescription(description?: string): string | undefined {
    if (!description) return undefined;
    const m = description.match(/Provided to YouTube by[^\n]*\n\n[^\n]+·[^\n]+\n\n([^\n]+)\n\n[℗©]/);
    return m ? cleanAlbum(m[1]) : undefined;
}

// ---------- Comparação (validação da busca pela versão oficial) ----------

export function normalizeForCompare(s: string): string {
    return s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\b(?:the|a|o|os|as)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function looselyEqual(a: string, b: string): boolean {
    const x = normalizeForCompare(a);
    const y = normalizeForCompare(b);
    if (!x || !y) return false;
    return x === y || x.includes(y) || y.includes(x);
}

/**
 * A versão oficial encontrada na busca corresponde à faixa? Evita trocar a música
 * por outra só porque foi o primeiro resultado.
 */
export function isSameTrack(
    candidate: TrackMetadata & { artists?: string[] },
    expected: { author: string; title: string; channel?: string }
): boolean {
    const candidateArtists = [candidate.author, ...(candidate.artists ?? [])];
    const expectedArtists = [expected.author, expected.channel ? stripChannelSuffix(expected.channel) : ""].filter(Boolean);
    const artistOk = candidateArtists.some((c) => expectedArtists.some((e) => looselyEqual(c, e)));
    return artistOk && looselyEqual(candidate.title, expected.title);
}
