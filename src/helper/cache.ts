/** Cache LRU em memória com expiração. Map mantém ordem de inserção: o primeiro é o mais antigo. */
export class TtlCache<V> {
    private store = new Map<string, { value: V; expiresAt: number }>();

    constructor(
        private readonly maxSize: number,
        private readonly ttlMs: number,
        private readonly now: () => number = Date.now
    ) {}

    get(key: string): V | undefined {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= this.now()) {
            this.store.delete(key);
            return undefined;
        }
        // reinsere para marcar como usado recentemente
        this.store.delete(key);
        this.store.set(key, entry);
        return entry.value;
    }

    set(key: string, value: V): void {
        if (this.maxSize <= 0) return;
        this.store.delete(key);
        this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
        while (this.store.size > this.maxSize) {
            const oldest = this.store.keys().next().value as string;
            this.store.delete(oldest);
        }
    }

    get size(): number {
        return this.store.size;
    }

    clear(): void {
        this.store.clear();
    }
}
