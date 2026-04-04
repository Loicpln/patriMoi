import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => ({
  plugins: [react()],
  // Tauri dev server config
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/.git/**"],
      usePolling: false,
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Tauri supports es2021
    target: ["es2021", "chrome100", "safari14"],
    // don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },
}));
