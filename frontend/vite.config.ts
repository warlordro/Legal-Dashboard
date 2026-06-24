/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

// Single source of truth for app version: root package.json. UI reads __APP_VERSION__.
const rootPkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: ["xlsx-js-style", "jspdf", "jspdf-autotable"],
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendor libs into their own cache-stable chunks.
        // xlsx-js-style/jspdf are loaded via dynamic import() in lib/export.ts;
        // naming them here just stabilises the chunk filename. v2.22.0 drop
        // `xlsx` din chunk-uri (migrat de pe `xlsx` pe `xlsx-js-style` pe path-ul
        // de parsare in `monitoringBulkTemplate.ts`).
        manualChunks: {
          charts: ["recharts"],
          xlsx: ["xlsx-js-style"],
          pdf: ["jspdf", "jspdf-autotable"],
        },
      },
    },
  },
  worker: {
    // ES module worker: permite code-splitting (dynamic import xlsx/jspdf in worker).
    // Default-ul Vite e "iife" care nu suporta multi-chunk.
    format: "es",
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
  server: {
    port: 5173,
    proxy: {
      // SSE endpoints need special config to avoid buffering/timeout
      "/api/dosare/load-more": {
        target: "http://localhost:3002",
        changeOrigin: true,
        timeout: 600000, // 10 minutes
        proxyTimeout: 600000,
      },
      "/api/termene/load-more": {
        target: "http://localhost:3002",
        changeOrigin: true,
        timeout: 600000,
        proxyTimeout: 600000,
      },
      "/api": {
        target: "http://localhost:3002",
        changeOrigin: true,
      },
    },
  },
});
