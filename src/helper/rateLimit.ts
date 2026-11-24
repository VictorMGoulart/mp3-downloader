import type { NextFunction, Request, Response } from "express";

/** IP do visitante: o cabeçalho do proxy da frente (se configurado) ou o `req.ip` do Express. */
export function clientIp(req: Pick<Request, "ip" | "headers">, header = ""): string {
    const fromHeader = header ? req.headers[header] : undefined;
    const value = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
    return value?.trim() || req.ip || "unknown";
}

/**
 * Rate limit em memória por IP (janela fixa). Suficiente para uma instância única;
 * com várias réplicas, troque por um store compartilhado (ex.: Redis).
 */
export function createRateLimiter(
    max: number,
    windowMs: number,
    now: () => number = Date.now,
    keyOf: (req: Request) => string = (req) => clientIp(req)
) {
    const hits = new Map<string, { count: number; resetAt: number }>();

    const sweep = setInterval(() => {
        const t = now();
        for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
    }, Math.min(windowMs, 60_000));
    sweep.unref?.();

    function check(key: string): { allowed: boolean; retryAfterSec: number } {
        if (max <= 0) return { allowed: true, retryAfterSec: 0 };
        const t = now();
        let entry = hits.get(key);
        if (!entry || entry.resetAt <= t) {
            entry = { count: 0, resetAt: t + windowMs };
            hits.set(key, entry);
        }
        entry.count++;
        return { allowed: entry.count <= max, retryAfterSec: Math.ceil((entry.resetAt - t) / 1000) };
    }

    function middleware(req: Request, res: Response, next: NextFunction) {
        const { allowed, retryAfterSec } = check(keyOf(req));
        if (allowed) return next();
        res.setHeader("Retry-After", String(retryAfterSec));
        res.status(429).json({ error: "Muitas requisições. Tente novamente em alguns minutos." });
    }

    return { check, middleware };
}
