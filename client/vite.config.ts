/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    // Keep the bundle small: no heavy UI framework, hand-rolled CSS.
    chunkSizeWarningLimit: 1024,
  },
  server: {
    port: 5173,
    proxy: {
      // Dev convenience: forward API calls to a local/mock backend.
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/test/**/*.test.{ts,tsx}"],
  },
});
