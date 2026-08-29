import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Pure-TypeScript test setup: the domain, simulation and command layers run
 * without React, JSDOM or a bundler, so tests stay fast and deterministic.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    reporters: ["default"],
  },
});
