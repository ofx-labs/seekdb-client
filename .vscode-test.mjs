import { defineConfig } from "@vscode/test-cli";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  // 测试文件的 glob 模式
  files: "out/test/**/*.js",
  // VS Code 扩展开发路径
  extensionDevelopmentPath: __dirname,
  // Mocha 测试框架选项
  mocha: {
    timeout: 120000, // 2 分钟超时（模型下载可能需要较长时间）
    ui: "tdd", // 使用 TDD 接口（suite/test）
  },
});
