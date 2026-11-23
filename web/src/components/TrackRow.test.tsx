import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeVideo } from "../test/fixtures";
import { TrackRow } from "./TrackRow";

function setup(props: Partial<Parameters<typeof TrackRow>[0]> = {}) {
    const handlers = { onToggle: vi.fn(), onEdit: vi.fn(), onToggleDownloaded: vi.fn() };
    render(
        <ul>
            <TrackRow
                video={makeVideo("a", { title: "Song", author: "Band", rawAlbum: "Record" })}
                selected={false}
                downloaded={false}
                {...handlers}
                {...props}
            />
        </ul>
    );
    return { ...handlers, user: userEvent.setup() };
}

describe("TrackRow", () => {
    it("mostra título, artista e álbum editáveis", () => {
        setup();
        expect(screen.getByLabelText("Título")).toHaveValue("Song");
        expect(screen.getByLabelText("Artista")).toHaveValue("Band");
        expect(screen.getByLabelText("Álbum")).toHaveValue("Record");
    });

    it("sinaliza metadados inferidos do título", () => {
        setup({ video: makeVideo("a", { metadataSource: "title" }) });
        expect(screen.getByText("inferido")).toBeInTheDocument();
    });

    it("indica busca de metadados em andamento", () => {
        setup({ video: makeVideo("a", { metadataSource: "pending" }) });
        expect(screen.getByText("buscando…")).toBeInTheDocument();
    });

    it("não sinaliza metadados do YouTube Music", () => {
        setup({ video: makeVideo("a", { metadataSource: "youtube-music" }) });
        expect(screen.queryByText("inferido")).not.toBeInTheDocument();
    });

    it("Enter confirma a edição com trim", async () => {
        const { user, onEdit } = setup();
        const title = screen.getByLabelText("Título");
        await user.clear(title);
        await user.type(title, "  Nova  {Enter}");
        expect(onEdit).toHaveBeenCalledWith("a", "title", "Nova");
        expect(title).toHaveValue("Nova");
    });

    it("Esc cancela a edição", async () => {
        const { user, onEdit } = setup();
        const artist = screen.getByLabelText("Artista");
        await user.clear(artist);
        await user.type(artist, "Outro{Escape}");
        expect(onEdit).not.toHaveBeenCalled();
        expect(artist).toHaveValue("Band");
    });

    it("não chama onEdit se o valor não mudou", async () => {
        const { user, onEdit } = setup();
        await user.click(screen.getByLabelText("Álbum"));
        await user.keyboard("{Enter}");
        expect(onEdit).not.toHaveBeenCalled();
    });

    it("clicar na linha alterna a seleção", async () => {
        const { user, onToggle } = setup({ selected: true });
        await user.click(screen.getByTestId("track-row"));
        expect(onToggle).toHaveBeenCalledWith("a", false, false);
    });

    it("clicar num campo de texto não alterna a seleção", async () => {
        const { user, onToggle } = setup();
        await user.click(screen.getByLabelText("Título"));
        expect(onToggle).not.toHaveBeenCalled();
    });

    it("checkbox alterna a seleção uma única vez", async () => {
        const { user, onToggle } = setup();
        await user.click(screen.getByRole("checkbox"));
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onToggle).toHaveBeenCalledWith("a", true, false);
    });

    it("Shift + clique no checkbox sinaliza seleção de intervalo", async () => {
        const { user, onToggle } = setup();
        await user.keyboard("{Shift>}");
        await user.click(screen.getByRole("checkbox"));
        await user.keyboard("{/Shift}");
        expect(onToggle).toHaveBeenCalledWith("a", true, true);
    });

    it("Shift + clique na linha sinaliza seleção de intervalo", async () => {
        const { user, onToggle } = setup({ selected: true });
        await user.keyboard("{Shift>}");
        await user.click(screen.getByTestId("track-row"));
        await user.keyboard("{/Shift}");
        expect(onToggle).toHaveBeenCalledWith("a", false, true);
    });

    it("botão de status marca/desmarca como baixada sem alternar seleção", async () => {
        const { user, onToggle, onToggleDownloaded } = setup({ downloaded: true });
        await user.click(screen.getByRole("button", { name: "Marcar como nova" }));
        expect(onToggleDownloaded).toHaveBeenCalledWith("a", false);
        expect(onToggle).not.toHaveBeenCalled();
    });
});
