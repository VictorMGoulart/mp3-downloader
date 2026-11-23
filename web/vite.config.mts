/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

// Mesma PORT do backend (.env na raiz). Usa 127.0.0.1 em vez de "localhost":
// no Node 17+ "localhost" pode resolver para ::1 (IPv6), e o backend escuta em IPv4.
const env = { ...loadEnv("development", projectRoot, ""), ...process.env };
const apiTarget = `http://127.0.0.1:${env.PORT || 3000}`;

export default defineConfig({
    root,
    plugins: [react()],
    build: {
        outDir: fileURLToPath(new URL("../public", import.meta.url)),
        emptyOutDir: true,
    },
    server: {
        port: 5173,
        proxy: {
            "/api": apiTarget,
        },
    },
    test: {
        name: "web",
        root,
        environment: "jsdom",
        setupFiles: ["./src/test/setup.ts"],
        css: false,
    },
});
