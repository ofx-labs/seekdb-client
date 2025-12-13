import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

/**
 * WebviewHtmlLoader - 加载和处理 React 构建产物的工具类
 *
 * 用于将 ui 项目构建的 HTML 文件加载到 VS Code Webview 中，
 * 处理 CSP（Content Security Policy）和资源路径转换。
 */
export class WebviewHtmlLoader {
  private extensionUri: vscode.Uri;
  private uiOutputPath: string;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
    this.uiOutputPath = path.join(extensionUri.fsPath, "out", "ui");
  }

  /**
   * 加载 React 构建的 HTML 页面
   * @param webview Webview 实例
   * @param pageName 页面名称（如 'ConnectPage' 或 'CollectionBrowserPage'）
   * @param injectedConfig 需要注入到页面的配置对象
   * @returns 处理后的 HTML 内容
   */
  public loadPage(
    webview: vscode.Webview,
    pageName: string,
    injectedConfig?: Record<string, any>
  ): string {
    // Vite 构建会将 HTML 文件输出到 src/pages/ 子目录
    const htmlPath = path.join(
      this.uiOutputPath,
      "src",
      "pages",
      `${pageName}.html`
    );

    // 检查文件是否存在
    if (!fs.existsSync(htmlPath)) {
      console.error(`HTML file not found: ${htmlPath}`);
      return this.getFallbackHtml(pageName, htmlPath);
    }

    // 读取 HTML 文件
    let html = fs.readFileSync(htmlPath, "utf-8");

    // 生成 CSP nonce
    const nonce = this.getNonce();

    // 获取 webview URI 用于资源加载
    const baseUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "ui")
    );

    // 替换资源路径：将相对路径转换为 webview URI
    html = this.processResourcePaths(html, baseUri.toString());

    // 注入 CSP meta 标签
    html = this.injectCSP(html, webview, nonce);

    // 注入配置脚本
    if (injectedConfig) {
      html = this.injectConfig(html, injectedConfig, nonce);
    }

    // 为 script 标签添加 nonce
    html = this.addNonceToScripts(html, nonce);

    return html;
  }

  /**
   * 处理资源路径，将相对路径转换为 webview URI
   */
  private processResourcePaths(html: string, baseUri: string): string {
    // Vite 构建产物中，HTML 在 src/pages/ 目录，资源在根目录的 assets/
    // 需要将 ../../assets/ 转换为 webviewUri/assets/
    html = html.replace(
      /src="\.\.\/\.\.\/assets\//g,
      `src="${baseUri}/assets/`
    );
    html = html.replace(
      /href="\.\.\/\.\.\/assets\//g,
      `href="${baseUri}/assets/`
    );

    // 替换 src="./assets/..." 为 src="webviewUri/assets/..."
    html = html.replace(/src="\.\/assets\//g, `src="${baseUri}/assets/`);
    // 替换 href="./assets/..." 为 href="webviewUri/assets/..."
    html = html.replace(/href="\.\/assets\//g, `href="${baseUri}/assets/`);
    // 替换其他 ./ 开头的路径
    html = html.replace(/src="\.\/([^"]+)"/g, `src="${baseUri}/$1"`);
    html = html.replace(/href="\.\/([^"]+)"/g, `href="${baseUri}/$1"`);

    return html;
  }

  /**
   * 注入 Content Security Policy
   */
  private injectCSP(
    html: string,
    webview: vscode.Webview,
    nonce: string
  ): string {
    // 外部脚本需要 webview.cspSource，内联脚本需要 nonce
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="
      default-src 'none';
      style-src ${webview.cspSource} 'unsafe-inline';
      script-src ${webview.cspSource} 'nonce-${nonce}';
      font-src ${webview.cspSource};
      img-src ${webview.cspSource} https: data:;
      connect-src ${webview.cspSource} https:;
    ">`;

    // 在 <head> 标签后插入 CSP
    html = html.replace(/<head>/i, `<head>\n    ${cspMeta}`);

    return html;
  }

  /**
   * 注入配置脚本
   */
  private injectConfig(
    html: string,
    config: Record<string, any>,
    nonce: string
  ): string {
    // 生成配置注入脚本
    const configScripts = Object.entries(config)
      .map(([key, value]) => `window.${key} = ${JSON.stringify(value)};`)
      .join("\n      ");

    const configScript = `<script nonce="${nonce}">
      ${configScripts}
    </script>`;

    // 在第一个 <script> 标签之前插入配置
    const scriptMatch = html.match(/<script/i);
    if (scriptMatch && scriptMatch.index !== undefined) {
      html =
        html.slice(0, scriptMatch.index) +
        configScript +
        "\n    " +
        html.slice(scriptMatch.index);
    } else {
      // 如果没有找到 script 标签，在 </body> 之前插入
      html = html.replace("</body>", `${configScript}\n  </body>`);
    }

    return html;
  }

  /**
   * 为所有 script 标签添加 nonce 属性
   */
  private addNonceToScripts(html: string, nonce: string): string {
    // 匹配没有 nonce 的 script 标签
    html = html.replace(
      /<script(?![^>]*nonce)([^>]*)>/gi,
      `<script nonce="${nonce}"$1>`
    );

    return html;
  }

  /**
   * 生成随机 nonce
   */
  private getNonce(): string {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  /**
   * 返回备用 HTML（当构建产物不存在时）
   */
  private getFallbackHtml(pageName: string, expectedPath: string): string {
    return `
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error</title>
        <style>
          body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
            background: var(--vscode-editor-background, #1e1e1e);
            color: var(--vscode-foreground, #cccccc);
            padding: 24px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
          }
          .error-container {
            max-width: 600px;
            text-align: center;
          }
          .error-icon { font-size: 48px; margin-bottom: 16px; }
          h1 { margin-bottom: 16px; color: var(--vscode-errorForeground, #f48771); }
          p { margin-bottom: 8px; color: var(--vscode-descriptionForeground, #888); }
          code {
            background: var(--vscode-textCodeBlock-background, #2d2d2d);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
          }
          .help {
            margin-top: 24px;
            padding: 16px;
            background: var(--vscode-textBlockQuote-background, #2d2d2d);
            border-radius: 8px;
          }
        </style>
      </head>
      <body>
        <div class="error-container">
          <div class="error-icon">⚠️</div>
          <h1>页面加载失败</h1>
          <p>找不到页面文件: <code>${pageName}.html</code></p>
          <p>预期路径: <code>${expectedPath}</code></p>
          <div class="help">
            <p><strong>解决方法：</strong></p>
            <p>请在 ui 目录下运行构建命令：</p>
            <p><code>cd ui && pnpm build</code></p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * 检查 UI 构建产物是否存在
   */
  public isBuilt(): boolean {
    const connectPagePath = path.join(
      this.uiOutputPath,
      "src",
      "pages",
      "ConnectPage.html"
    );
    const collectionPagePath = path.join(
      this.uiOutputPath,
      "src",
      "pages",
      "CollectionBrowserPage.html"
    );
    return fs.existsSync(connectPagePath) && fs.existsSync(collectionPagePath);
  }
}
