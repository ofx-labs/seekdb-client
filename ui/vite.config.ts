import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyHtmlToRoot } from "./vite-plugin-copy-html";

export default defineConfig({
  plugins: [react(), copyHtmlToRoot()],
  build: {
    outDir: "../out/ui",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        connect: resolve(__dirname, "src/pages/ConnectPage.html"),
        collectionBrowser: resolve(
          __dirname,
          "src/pages/CollectionBrowserPage.html"
        ),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  base: "./",
});
