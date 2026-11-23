import { useState, type FormEvent } from "react";
import { IconDownload } from "./Icons";

/** ZIP já gerado no servidor, disponível para baixar de novo sem refazer o download das músicas. */
export type ReadyZip = { url: string; count: number };

type Props = {
    selectedCount: number;
    defaultZipName?: string;
    busy?: boolean;
    /** Quando definido, o download fica bloqueado e a mensagem aparece no botão. */
    waitingMessage?: string;
    readyZip?: ReadyZip;
    onRedownload?: () => void;
    onDownload: (zipName: string | undefined) => void;
};

const faixas = (n: number) => `${n} ${n === 1 ? "faixa" : "faixas"}`;

export function DownloadBar({
    selectedCount,
    defaultZipName = "playlist",
    busy,
    waitingMessage,
    readyZip,
    onRedownload,
    onDownload,
}: Props) {
    const [zipName, setZipName] = useState("");

    if (selectedCount === 0) {
        if (!readyZip) return null;
        return (
            <div className="dock" role="region" aria-label="ZIP pronto">
                <span className="dock-count">
                    <strong>ZIP pronto</strong> · {faixas(readyZip.count)}
                </span>
                <span className="dock-hint">Fechou a janela de salvar? Baixe de novo sem esperar.</span>
                <button type="button" className="btn btn-primary" onClick={onRedownload}>
                    <IconDownload />
                    Baixar ZIP
                </button>
            </div>
        );
    }

    const blocked = busy || Boolean(waitingMessage);
    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (!blocked) onDownload(zipName.trim() || undefined);
    };

    return (
        <form className="dock" onSubmit={submit} aria-label="Download">
            <span className="dock-count">
                <strong>{selectedCount}</strong> {selectedCount === 1 ? "selecionada" : "selecionadas"}
            </span>
            <label className="dock-zip">
                <input
                    type="text"
                    value={zipName}
                    onChange={(e) => setZipName(e.target.value)}
                    placeholder={defaultZipName}
                    aria-label="Nome do arquivo ZIP"
                    maxLength={100}
                />
                <span className="suffix">.zip</span>
            </label>
            {readyZip && (
                <button
                    type="button"
                    className="btn btn-ghost"
                    title={`Baixar de novo o ZIP anterior (${faixas(readyZip.count)}). Um novo download o substitui.`}
                    onClick={onRedownload}
                >
                    ZIP anterior
                </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={blocked}>
                {waitingMessage ? (
                    <>
                        <span className="spinner" aria-hidden />
                        {waitingMessage}
                    </>
                ) : (
                    <>
                        <IconDownload />
                        Baixar
                    </>
                )}
            </button>
        </form>
    );
}
