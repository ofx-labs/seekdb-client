import { Plugin } from "vite";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Vite 插件：将构建后的 HTML 文件从 src/pages/ 目录复制到输出根目录
 */
export function copyHtmlToRoot(): Plugin {
  return {
    name: "copy-html-to-root",
    closeBundle() {
      const outDir = path.resolve(__dirname, "build");

      // 要复制的 HTML 文件列表（Vite构建后的文件名）
      // Vite会将HTML文件输出到 build/src/pages/ 目录，文件名保持原始大小写
      const htmlFiles = [
        { source: "src/pages/ConnectPage.html", target: "ConnectPage.html" },
        {
          source: "src/pages/CollectionBrowserPage.html",
          target: "CollectionBrowserPage.html",
        },
      ];

      htmlFiles.forEach(({ source, target }) => {
        const sourcePath = path.join(outDir, source);
        const targetPath = path.join(outDir, target);

        if (fs.existsSync(sourcePath)) {
          // 读取源文件内容
          let content = fs.readFileSync(sourcePath, "utf-8");

          // 修复资源路径：从 ../../static/ 改为 ./static/
          content = content.replace(/\.\.\/\.\.\/static\//g, "./static/");

          // 写入目标文件
          fs.writeFileSync(targetPath, content, "utf-8");
          console.log(
            `✓ Copied ${source} to ${path.relative(outDir, targetPath)}`
          );
        } else {
          console.warn(`⚠ File not found: ${sourcePath}`);
        }
      });
    },
  };
}
