// vite.config.widget.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, "src/widget-entry.jsx"),
      name: "BotWidget",
      fileName: (format) => `widget.${format}.js`,
      formats: ["iife"],
    },
    rollupOptions: {
      external: [],
      output: {
        inlineDynamicImports: true,  // Single file
      },
    },
    minify: false,  // Easier to debug
  },
  define: {
    global: "globalThis",
  },
});
