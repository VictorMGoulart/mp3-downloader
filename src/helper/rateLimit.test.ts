import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit";

describe("createRateLimiter", () => {
    it("bloqueia após o limite e libera na próxima janela", () => {
        let t = 0;
        const { check } = createRateLimiter(2, 1000, () => t);
        expect(check("ip").allowed).toBe(true);
        expect(check("ip").allowed).toBe(true);
        const blocked = check("ip");
        expect(blocked.allowed).toBe(false);
        expect(blocked.retryAfterSec).toBe(1);
        expect(check("outro").allowed).toBe(true);
        t = 1000;
        expect(check("ip").allowed).toBe(true);
    });

    it("max 0 desativa", () => {
        const { check } = createRateLimiter(0, 1000);
        for (let i = 0; i < 100; i++) expect(check("ip").allowed).toBe(true);
    });
});
