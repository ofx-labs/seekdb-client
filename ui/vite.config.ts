import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../out/ui",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        ConnectPage: resolve(__dirname, "src/pages/ConnectPage.html"),
        CollectionBrowserPage: resolve(
          __dirname,
          "src/pages/CollectionBrowserPage.html"
        ),
      },
      output: {
        // 使用固定文件名（不带 hash），便于 webview 加载
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
    // 不分割 CSS
    cssCodeSplit: false,
    // 内联小于 10KB 的资源
    assetsInlineLimit: 10240,
    minify: "esbuild",
  },
  base: "./",
});
