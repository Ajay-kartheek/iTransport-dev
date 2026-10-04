import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    // Keep the browser's Host header so the API's same-origin check passes in dev.
    proxy: { "/api": { target: "http://127.0.0.1:8077", changeOrigin: false } },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
