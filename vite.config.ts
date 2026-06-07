/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Vitest: frontend unit tests. Coverage uses `all: true` so every source file is
  // reported (files without tests count as 0%) - this is the baseline we raise over
  // time. LCOV is consumed by SonarCloud.
  test: {
    environment: "jsdom",
    globals: true,
    passWithNoTests: true,
    setupFiles: ["./vitest.setup.js"],
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "./coverage",
      all: true,
      include: ["src/**/*.{js,jsx,ts,tsx}"],
      exclude: ["src/main.tsx", "src/types.ts", "src/vite-env.d.ts", "**/*.config.*", "src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
    },
  },
}));
