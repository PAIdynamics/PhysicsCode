import { defineConfig } from "vite"
import appPlugin from "@physicscode-ai/app/vite"

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  plugins: [appPlugin],
  publicDir: "../app/public",
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  esbuild: {
    // Improves production stack traces
    keepNames: true,
  },
  build: {
    // Sourcemaps add ~25MB to the installed app and nothing in a shipped build
    // uploads or reads them, so they are opt-in. The dev server is unaffected,
    // and `keepNames` above keeps production stack traces readable.
    sourcemap: process.env.PHYSICSCODE_SOURCEMAPS === "true",
  },
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
})
