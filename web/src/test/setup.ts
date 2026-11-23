import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Node 25+ tem um `localStorage` global próprio que, sem `--localstorage-file`, fica indefinido
 * e esconde o do jsdom. Nesse caso usa um Storage em memória, com a mesma interface.
 */
function usableStorage(): boolean {
    try {
        const s = globalThis.localStorage;
        return typeof s?.setItem === "function" && typeof s.clear === "function";
    } catch {
        return false;
    }
}

class MemoryStorage implements Storage {
    private data = new Map<string, string>();
    get length() {
        return this.data.size;
    }
    clear() {
        this.data.clear();
    }
    getItem(key: string) {
        return this.data.has(key) ? this.data.get(key)! : null;
    }
    key(index: number) {
        return [...this.data.keys()][index] ?? null;
    }
    removeItem(key: string) {
        this.data.delete(key);
    }
    setItem(key: string, value: string) {
        this.data.set(key, String(value));
    }
}

if (!usableStorage()) {
    for (const name of ["localStorage", "sessionStorage"] as const) {
        Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true, writable: true });
    }
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});
