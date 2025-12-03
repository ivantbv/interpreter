// import { defineConfig } from "vite";
// import react from "@vitejs/plugin-react";
// import { resolve } from "path";

// // https://vite.dev/config/
// export default defineConfig({
// plugins: [react()],
// build: {
// rollupOptions: {
// input: {
// // main app (uses index.html that references src/main.jsx)
// main: resolve(__dirname, "index.html"),
// // embeddable widget bundle
// widget: resolve(__dirname, "src/widget-entry.jsx"),
// },
// output: {
// // keep names predictable
// entryFileNames: (chunk) => {
// if (chunk.name === "widget") return "widget.js";
// return "assets/[name]-[hash].js";
// },
// },
// },
// },
// });

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  // Load ONLY VITE_* prefixed env vars (safe for client)
  const viteEnv = loadEnv(mode, process.cwd(), 'VITE_');
  
  return {
    plugins: [react()],
    define: {
      // SAFE: Only VITE_* vars + empty fallback
      'process.env': {
        ...viteEnv,
        NODE_ENV: JSON.stringify(mode)  // Required by React
      }
    },
    build: {
      lib: {
        entry: resolve(__dirname, "src/widget-entry.jsx"),
        name: "BotWidget",
        fileName: "widget",
        formats: ["iife"],
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
      sourcemap: true,
      minify: false,
    },
  };
});