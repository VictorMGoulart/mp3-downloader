import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        projects: [
            "web/vite.config.mts",
            {
                test: {
                    name: "server",
                    root: "src",
                    environment: "node",
                    include: ["**/*.test.ts"],
                    env: { NODE_ENV: "test" },
                },
            },
        ],
    },
});
