import { useEffect, useRef } from "react";
import type { ViewFilter } from "../types";
import { IconSearch } from "./Icons";
import { Menu, type MenuItem } from "./Menu";

type Props = {
    query: string;
    view: ViewFilter;
    counts: Record<ViewFilter, number>;
    visibleCount: number;
    visibleSelected: number;
    disabled?: boolean;
    menuItems: MenuItem[];
    onQuery: (q: string) => void;
    onView: (v: ViewFilter) => void;
    onToggleVisible: (select: boolean) => void;
};

const VIEWS: { id: ViewFilter; label: string }[] = [
    { id: "all", label: "Todas" },
    { id: "new", label: "Novas" },
    { id: "downloaded", label: "Baixadas" },
];

export function Toolbar(props: Props) {
    const { query, view, counts, visibleCount, visibleSelected, disabled, menuItems } = props;
    const master = useRef<HTMLInputElement>(null);
    const all = visibleCount > 0 && visibleSelected === visibleCount;
    const some = visibleSelected > 0 && !all;

    useEffect(() => {
        if (master.current) master.current.indeterminate = some;
    }, [some]);

    return (
        <div className="toolbar">
            <input
                ref={master}
                type="checkbox"
                className="checkbox"
                checked={all}
                disabled={disabled || visibleCount === 0}
                aria-label={all ? "Desmarcar visíveis" : "Selecionar visíveis"}
                onChange={() => props.onToggleVisible(!all)}
            />

            <label className="search">
                <IconSearch />
                <input
                    type="search"
                    value={query}
                    placeholder="Filtrar"
                    aria-label="Filtrar faixas"
                    onChange={(e) => props.onQuery(e.target.value)}
                />
            </label>

            <div className="segmented" role="tablist" aria-label="Visualização">
                {VIEWS.map((v) => (
                    <button
                        key={v.id}
                        type="button"
                        role="tab"
                        aria-selected={view === v.id}
                        className={view === v.id ? "is-active" : ""}
                        onClick={() => props.onView(v.id)}
                    >
                        {v.label} <span className="count">{counts[v.id]}</span>
                    </button>
                ))}
            </div>

            <Menu items={menuItems} />
        </div>
    );
}
