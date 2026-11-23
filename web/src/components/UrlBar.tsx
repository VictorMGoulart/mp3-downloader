import { useState, type FormEvent } from "react";
import { IconClipboard } from "./Icons";

type Props = {
    compact: boolean;
    loading: boolean;
    onSubmit: (url: string) => void;
};

export function UrlBar({ compact, loading, onSubmit }: Props) {
    const [url, setUrl] = useState("");

    const submit = (e: FormEvent) => {
        e.preventDefault();
        const value = url.trim();
        if (value && !loading) onSubmit(value);
    };

    const paste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) setUrl(text.trim());
        } catch {
            // sem permissão de clipboard
        }
    };

    return (
        <form className={`urlbar ${compact ? "is-compact" : ""}`} onSubmit={submit}>
            {!compact && (
                <div className="urlbar-intro">
                    <h1>Baixe uma playlist em MP3</h1>
                    <p>Cole o link de uma playlist do YouTube. Você revisa e edita as faixas antes de baixar.</p>
                </div>
            )}
            <div className="urlbar-field">
                <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://www.youtube.com/playlist?list=…"
                    aria-label="Link da playlist"
                    autoComplete="off"
                    autoFocus={!compact}
                    required
                />
                <button type="button" className="btn-icon" onClick={paste} title="Colar" aria-label="Colar">
                    <IconClipboard />
                </button>
                <button type="submit" className="btn btn-primary" disabled={loading || !url.trim()}>
                    {loading ? <span className="spinner" aria-label="Carregando" /> : "Buscar"}
                </button>
            </div>
        </form>
    );
}
