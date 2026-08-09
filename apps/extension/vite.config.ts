import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: { popup: resolve(import.meta.dirname, "popup.html"), welcome: resolve(import.meta.dirname, "welcome.html"), background: resolve(import.meta.dirname, "src/background.ts") },
      output: { entryFileNames: (chunk) => chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js" },
    },
  },
});
