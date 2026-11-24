import type { DownloadProgressEvent } from "../types";

/**
 * Percentual geral do job: faixas concluídas + fração da faixa atual.
 * Mesma fórmula da versão anterior, com zipping fixo em 98 e completed em 100.
 */
export function computeOverallPercent(event: DownloadProgressEvent, fallbackTotal: number): number {
    if (event.status === "completed") return 100;
    if (event.status === "zipping") return 98;
    if (event.status !== "downloading") return 0;
    if (typeof event.overallPercent === "number") return Math.round(Math.min(Math.max(event.overallPercent, 0), 100));

    const total = event.totalCount || fallbackTotal;
    if (!total) return 0;
    const index = event.currentIndex || 1;
    const percent = Math.min(Math.max(event.percent || 0, 0), 100);
    const value = Math.round(((index - 1) / total) * 100 + percent / total);
    return Math.min(Math.max(value, 0), 100);
}
