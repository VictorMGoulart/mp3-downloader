import type { NextFunction, Request, Response } from "express";

/**
 * Rate limit em memória por IP (janela fixa). Suficiente para uma instância única;
 * com várias réplicas, troque por um store compartilhado (ex.: Redis).
 */
export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now) {
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
        const { allowed, retryAfterSec } = check(req.ip || "unknown");
        if (allowed) return next();
        res.setHeader("Retry-After", String(retryAfterSec));
        res.status(429).json({ error: "Muitas requisições. Tente novamente em alguns minutos." });
    }

    return { check, middleware };
}
