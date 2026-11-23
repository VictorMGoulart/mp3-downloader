import { describe, expect, it } from "vitest";
import { TtlCache } from "./cache";

describe("TtlCache", () => {
    it("guarda e expira por TTL", () => {
        let t = 0;
        const c = new TtlCache<number>(10, 1000, () => t);
        c.set("a", 1);
        expect(c.get("a")).toBe(1);
        t = 999;
        expect(c.get("a")).toBe(1);
        t = 1000;
        expect(c.get("a")).toBeUndefined();
        expect(c.size).toBe(0);
    });

    it("descarta o menos usado recentemente ao lotar", () => {
        const c = new TtlCache<number>(2, 60_000);
        c.set("a", 1);
        c.set("b", 2);
        c.get("a"); // "a" passa a ser o mais recente
        c.set("c", 3);
        expect(c.get("b")).toBeUndefined();
        expect(c.get("a")).toBe(1);
        expect(c.get("c")).toBe(3);
    });

    it("tamanho 0 desativa", () => {
        const c = new TtlCache<number>(0, 60_000);
        c.set("a", 1);
        expect(c.get("a")).toBeUndefined();
    });
});
