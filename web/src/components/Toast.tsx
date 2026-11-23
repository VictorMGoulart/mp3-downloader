export type ToastAction = { label: string; onClick: () => void };

export type ToastMsg = {
    id: number;
    text: string;
    kind?: "error" | "info";
    actions?: ToastAction[];
};

export function Toasts({ toasts, onDismiss }: { toasts: ToastMsg[]; onDismiss: (id: number) => void }) {
    return (
        <div className="toasts" role="status" aria-live="polite">
            {toasts.map((t) => (
                <div key={t.id} className={`toast ${t.kind === "error" ? "is-error" : ""}`}>
                    <span className="toast-text">{t.text}</span>
                    {t.actions?.map((a, i) => (
                        <button
                            key={a.label}
                            type="button"
                            className={`toast-action ${i > 0 ? "is-secondary" : ""}`}
                            onClick={() => {
                                a.onClick();
                                onDismiss(t.id);
                            }}
                        >
                            {a.label}
                        </button>
                    ))}
                    <button type="button" className="toast-close" aria-label="Fechar aviso" onClick={() => onDismiss(t.id)}>
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
}
