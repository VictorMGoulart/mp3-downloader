import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DownloadBar } from "./DownloadBar";

describe("DownloadBar", () => {
    it("não aparece sem seleção", () => {
        const { container } = render(<DownloadBar selectedCount={0} onDownload={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("mostra a contagem no singular e plural", () => {
        const { rerender } = render(<DownloadBar selectedCount={1} onDownload={vi.fn()} />);
        expect(screen.getByText(/selecionada$/)).toBeInTheDocument();
        rerender(<DownloadBar selectedCount={3} onDownload={vi.fn()} />);
        expect(screen.getByText(/selecionadas/)).toBeInTheDocument();
    });

    it("envia o nome do ZIP informado", async () => {
        const onDownload = vi.fn();
        const user = userEvent.setup();
        render(<DownloadBar selectedCount={2} onDownload={onDownload} />);
        await user.type(screen.getByLabelText("Nome do arquivo ZIP"), "  Minha Mix ");
        await user.click(screen.getByRole("button", { name: /baixar/i }));
        expect(onDownload).toHaveBeenCalledWith("Minha Mix");
    });

    it("envia undefined quando o nome fica vazio", async () => {
        const onDownload = vi.fn();
        const user = userEvent.setup();
        render(<DownloadBar selectedCount={2} onDownload={onDownload} />);
        await user.click(screen.getByRole("button", { name: /baixar/i }));
        expect(onDownload).toHaveBeenCalledWith(undefined);
    });

    it("bloqueia e mostra o motivo enquanto aguarda metadados", async () => {
        const onDownload = vi.fn();
        render(<DownloadBar selectedCount={2} waitingMessage="Aguardando metadados…" onDownload={onDownload} />);
        const button = screen.getByRole("button", { name: /aguardando metadados/i });
        expect(button).toBeDisabled();
    });

    it("sem seleção mas com ZIP pronto, oferece baixar de novo", async () => {
        const onRedownload = vi.fn();
        const user = userEvent.setup();
        render(<DownloadBar selectedCount={0} readyZip={{ url: "/z", count: 12 }} onRedownload={onRedownload} onDownload={vi.fn()} />);
        expect(screen.getByText(/12 faixas/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /baixar zip/i }));
        expect(onRedownload).toHaveBeenCalledTimes(1);
    });

    it("com seleção e ZIP pronto, mostra o atalho para o ZIP anterior", async () => {
        const onRedownload = vi.fn();
        const onDownload = vi.fn();
        const user = userEvent.setup();
        render(<DownloadBar selectedCount={2} readyZip={{ url: "/z", count: 1 }} onRedownload={onRedownload} onDownload={onDownload} />);
        await user.click(screen.getByRole("button", { name: /zip anterior/i }));
        expect(onRedownload).toHaveBeenCalledTimes(1);
        expect(onDownload).not.toHaveBeenCalled();
    });

    it("não envia enquanto ocupado", () => {
        render(<DownloadBar selectedCount={2} busy onDownload={vi.fn()} />);
        expect(screen.getByRole("button", { name: /baixar/i })).toBeDisabled();
    });
});
