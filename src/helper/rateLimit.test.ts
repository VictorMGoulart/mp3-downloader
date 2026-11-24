import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "./rateLimit";

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

describe("clientIp", () => {
    const req = (ip: string | undefined, headers: Record<string, string | string[]> = {}) =>
        ({ ip, headers }) as Parameters<typeof clientIp>[0];

    it("usa req.ip quando não há cabeçalho configurado", () => {
        expect(clientIp(req("10.0.0.1", { "cf-connecting-ip": "1.2.3.4" }))).toBe("10.0.0.1");
    });

    it("usa o cabeçalho do proxy quando configurado", () => {
        expect(clientIp(req("10.0.0.1", { "cf-connecting-ip": " 1.2.3.4 " }), "cf-connecting-ip")).toBe("1.2.3.4");
        expect(clientIp(req("10.0.0.1", { "cf-connecting-ip": ["5.6.7.8", "9.9.9.9"] }), "cf-connecting-ip")).toBe("5.6.7.8");
    });

    it("cai para req.ip se o cabeçalho não vier", () => {
        expect(clientIp(req("10.0.0.1"), "cf-connecting-ip")).toBe("10.0.0.1");
        expect(clientIp(req(undefined), "cf-connecting-ip")).toBe("unknown");
    });

    it("o rate limit separa visitantes pelo IP do cabeçalho", () => {
        const limiter = createRateLimiter(1, 60_000, () => 0, (r) => clientIp(r, "cf-connecting-ip"));
        const next = () => {};
        const res = () => {
            const r = { statusCode: 200, setHeader() {}, status(c: number) { r.statusCode = c; return r; }, json() { return r; } };
            return r;
        };
        const a = res(), b = res(), c = res();
        limiter.middleware(req("10.0.0.1", { "cf-connecting-ip": "1.1.1.1" }) as never, a as never, next);
        limiter.middleware(req("10.0.0.1", { "cf-connecting-ip": "2.2.2.2" }) as never, b as never, next);
        limiter.middleware(req("10.0.0.1", { "cf-connecting-ip": "1.1.1.1" }) as never, c as never, next);
        expect([a.statusCode, b.statusCode, c.statusCode]).toEqual([200, 200, 429]);
    });
});
