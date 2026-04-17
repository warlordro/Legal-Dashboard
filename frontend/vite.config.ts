import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";

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
    include: ["xlsx", "xlsx-js-style", "jspdf", "jspdf-autotable"],
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendor libs into their own cache-stable chunks.
        // xlsx/jspdf are already loaded via dynamic import() in lib/export.ts,
        // so naming them here just stabilises the chunk filename.
        manualChunks: {
          charts: ["recharts"],
          xlsx: ["xlsx", "xlsx-js-style"],
          pdf: ["jspdf", "jspdf-autotable"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // SSE endpoints need special config to avoid buffering/timeout
      "/api/dosare/load-more": {
        target: "http://localhost:3001",
        changeOrigin: true,
        timeout: 600000, // 10 minutes
        proxyTimeout: 600000,
      },
      "/api/termene/load-more": {
        target: "http://localhost:3001",
        changeOrigin: true,
        timeout: 600000,
        proxyTimeout: 600000,
      },
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
