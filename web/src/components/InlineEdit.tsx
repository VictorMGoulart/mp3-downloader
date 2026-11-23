import { useEffect, useRef, useState, type KeyboardEvent } from "react";

type Props = {
    value: string;
    placeholder: string;
    label: string;
    className?: string;
    onCommit: (value: string) => void;
};

/** Texto que vira campo editável ao clicar. Enter confirma, Esc cancela. */
export function InlineEdit({ value, placeholder, label, className = "", onCommit }: Props) {
    const [draft, setDraft] = useState(value);
    const cancelled = useRef(false);

    useEffect(() => setDraft(value), [value]);

    const commit = () => {
        if (cancelled.current) {
            cancelled.current = false;
            setDraft(value);
            return;
        }
        const next = draft.trim();
        setDraft(next);
        if (next !== value) onCommit(next);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
        }
    };

    return (
        <input
            className={`inline-edit ${className}`}
            value={draft}
            placeholder={placeholder}
            aria-label={label}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
        />
    );
}
