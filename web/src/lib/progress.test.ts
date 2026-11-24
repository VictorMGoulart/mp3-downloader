import { describe, expect, it } from "vitest";
import { computeOverallPercent } from "./progress";

const ev = (o: object) => ({ jobId: "j", status: "downloading" as const, ...o });

describe("computeOverallPercent", () => {
    it("começa em 0 na primeira faixa", () => {
        expect(computeOverallPercent(ev({ currentIndex: 1, totalCount: 4, percent: 0 }), 4)).toBe(0);
    });

    it("soma faixas concluídas e fração da atual", () => {
        // 2 de 4 concluídas (50%) + 50% de 1/4 (12.5%) = 62.5 → 63
        expect(computeOverallPercent(ev({ currentIndex: 3, totalCount: 4, percent: 50 }), 4)).toBe(63);
    });

    it("chega a 100 no fim da última faixa", () => {
        expect(computeOverallPercent(ev({ currentIndex: 4, totalCount: 4, percent: 100 }), 4)).toBe(100);
    });

    it("usa o total de fallback quando o evento não traz", () => {
        expect(computeOverallPercent(ev({ currentIndex: 2, percent: 0 }), 2)).toBe(50);
    });

    it("limita valores fora da faixa", () => {
        expect(computeOverallPercent(ev({ currentIndex: 1, totalCount: 1, percent: 250 }), 1)).toBe(100);
        expect(computeOverallPercent(ev({ currentIndex: 1, totalCount: 1, percent: -5 }), 1)).toBe(0);
    });

    it("trata estados especiais", () => {
        expect(computeOverallPercent(ev({ status: "zipping" }), 3)).toBe(98);
        expect(computeOverallPercent(ev({ status: "completed" }), 3)).toBe(100);
        expect(computeOverallPercent(ev({ status: "pending" }), 3)).toBe(0);
        expect(computeOverallPercent(ev({ currentIndex: 1, percent: 50 }), 0)).toBe(0);
    });
});

describe("computeOverallPercent com downloads em paralelo", () => {
    it("usa overallPercent quando o servidor envia", () => {
        expect(computeOverallPercent(ev({ currentIndex: 1, totalCount: 4, percent: 0, overallPercent: 42.6 }), 4)).toBe(43);
    });

    it("limita overallPercent entre 0 e 100", () => {
        expect(computeOverallPercent(ev({ overallPercent: 140 }), 4)).toBe(100);
    });
});
