import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

/**
 * 国际化文本接口
 */
interface I18nTexts {
  title: string;
  subtitle: string;
  versionFrom: string;
  versionTo: string;
  btnStart: string;
  btnChangelog: string;
  footerText: string;
  footerLink: string;
  panelTitle: string;
  errorLoadVersion: string;
  errorLoadChangelog: string;
  errorOpenChangelog: string;
  noChangelog: string;
}

/**
 * 版本更新通知服务
 * 负责检测插件版本更新并展示更新日志
 */
export class UpdateNotificationService {
  private context: vscode.ExtensionContext;
  private readonly STORAGE_KEY = "seekdb.lastVersion";
  private locale: string;
  private i18n: I18nTexts;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.locale = this.detectLocale();
    this.i18n = this.getI18nTexts(this.locale);
  }

  /**
   * 检测当前语言环境
   */
  private detectLocale(): string {
    const vscodeLocale = vscode.env.language;
    
    // 支持的语言列表
    const supportedLocales = ["zh-CN", "zh-TW", "en"];
    
    // 如果是中文相关的语言，统一返回 zh-CN
    if (vscodeLocale.startsWith("zh")) {
      return "zh-CN";
    }
    
    // 检查是否在支持列表中
    if (supportedLocales.includes(vscodeLocale)) {
      return vscodeLocale;
    }
    
    // 默认返回英文
    return "en";
  }

  /**
   * 获取国际化文本
   */
  private getI18nTexts(locale: string): I18nTexts {
    const texts: { [key: string]: I18nTexts } = {
      "zh-CN": {
        title: "seekdb-client 更新说明",
        subtitle: "感谢您的使用！来看看新版本带来了什么。",
        versionFrom: "旧版本",
        versionTo: "新版本",
        btnStart: "开始体验",
        btnChangelog: "完整日志",
        footerText: "遇到问题？访问",
        footerLink: "反馈",
        panelTitle: "更新日志",
        errorLoadVersion: "无法获取当前版本信息",
        errorLoadChangelog: "无法加载更新日志",
        errorOpenChangelog: "无法打开 CHANGELOG.md 文件",
        noChangelog: "无法加载更新日志",
      },
      en: {
        title: "seekdb-client Update Notes",
        subtitle: "Thank you for using! Let's see what's new in this version.",
        versionFrom: "Previous",
        versionTo: "Current",
        btnStart: "Get Started",
        btnChangelog: "Full Changelog",
        footerText: "Having issues? Visit",
        footerLink: "GitHub",
        panelTitle: "What's New",
        errorLoadVersion: "Unable to get current version information",
        errorLoadChangelog: "Unable to load changelog",
        errorOpenChangelog: "Unable to open CHANGELOG.md file",
        noChangelog: "Unable to load changelog",
      },
    };

    return texts[locale] || texts["en"];
  }

  /**
   * 检查版本更新并显示通知
   */
  public async checkAndShowUpdateNotification(): Promise<void> {
    try {
      // 检查是否启用更新通知
      const config = vscode.workspace.getConfiguration(
        "seekdb.updateNotification"
      );
      const enabled = config.get<boolean>("enabled", true);

      if (!enabled) {
        console.log("[UpdateNotification] 更新通知已禁用");
        return;
      }

      // 获取当前版本
      const currentVersion = this.getCurrentVersion();
      if (!currentVersion) {
        console.log("[UpdateNotification] 无法获取当前版本");
        return;
      }

      // 获取上次记录的版本
      const lastVersion = this.context.globalState.get<string>(
        this.STORAGE_KEY
      );

      console.log(
        `[UpdateNotification] 当前版本: ${currentVersion}, 上次版本: ${lastVersion}`
      );

      // 如果是首次安装或版本发生变化
      if (!lastVersion) {
        console.log("[UpdateNotification] 首次安装，跳过更新通知");
        // 保存当前版本
        await this.context.globalState.update(this.STORAGE_KEY, currentVersion);
        return;
      }

      // 版本发生变化，显示更新日志
      if (lastVersion !== currentVersion) {
        console.log("[UpdateNotification] 检测到版本更新");
        await this.showUpdatePanel(currentVersion, lastVersion);
        // 更新版本记录
        await this.context.globalState.update(this.STORAGE_KEY, currentVersion);
      }
    } catch (error) {
      console.error("[UpdateNotification] 检查更新失败:", error);
    }
  }

  /**
   * 手动显示更新日志（不管版本是否变化）
   */
  public async showUpdateLog(): Promise<void> {
    try {
      const currentVersion = this.getCurrentVersion();
      if (!currentVersion) {
        vscode.window.showErrorMessage(this.i18n.errorLoadVersion);
        return;
      }

      const lastVersion =
        this.context.globalState.get<string>(this.STORAGE_KEY) || "0.0.0";
      await this.showUpdatePanel(currentVersion, lastVersion);
    } catch (error) {
      console.error("[UpdateNotification] 显示更新日志失败:", error);
      vscode.window.showErrorMessage(this.i18n.errorLoadChangelog);
    }
  }

  /**
   * 获取当前插件版本
   */
  private getCurrentVersion(): string | undefined {
    try {
      const packageJsonPath = path.join(
        this.context.extensionPath,
        "package.json"
      );
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      return packageJson.version;
    } catch (error) {
      console.error("[UpdateNotification] 读取版本失败:", error);
      return undefined;
    }
  }

  /**
   * 显示更新日志面板
   */
  private async showUpdatePanel(
    currentVersion: string,
    lastVersion: string
  ): Promise<void> {
    // 创建 WebView 面板
    const panel = vscode.window.createWebviewPanel(
      "seekdbUpdateNotification",
      `seekdb-client ${currentVersion} ${this.i18n.panelTitle}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    // 设置面板图标
    panel.iconPath = {
      light: vscode.Uri.file(
        path.join(this.context.extensionPath, "media", "logo.png")
      ),
      dark: vscode.Uri.file(
        path.join(this.context.extensionPath, "media", "logo.png")
      ),
    };

    // 加载更新日志内容
    const changelogContent = await this.loadChangelog();

    // 设置 HTML 内容
    panel.webview.html = this.getWebviewContent(
      currentVersion,
      lastVersion,
      changelogContent,
      panel.webview
    );

    // 处理来自 WebView 的消息
    panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "close":
            panel.dispose();
            break;
          case "openChangelog":
            this.openChangelogFile();
            break;
        }
      },
      undefined,
      this.context.subscriptions
    );
  }

  /**
   * 加载 CHANGELOG.md 文件内容
   * 优先加载对应语言的 CHANGELOG 文件
   */
  private async loadChangelog(): Promise<string> {
    try {
      // 尝试加载对应语言的 CHANGELOG
      const localizedChangelogPath = path.join(
        this.context.extensionPath,
        `CHANGELOG.${this.locale}.md`
      );
      
      if (fs.existsSync(localizedChangelogPath)) {
        console.log(`[UpdateNotification] 加载本地化 CHANGELOG: ${this.locale}`);
        return fs.readFileSync(localizedChangelogPath, "utf-8");
      }
      
      // 如果没有对应语言的文件，加载默认的 CHANGELOG.md
      const defaultChangelogPath = path.join(
        this.context.extensionPath,
        "CHANGELOG.md"
      );
      
      if (fs.existsSync(defaultChangelogPath)) {
        console.log("[UpdateNotification] 加载默认 CHANGELOG");
        return fs.readFileSync(defaultChangelogPath, "utf-8");
      }
      
      return this.i18n.noChangelog;
    } catch (error) {
      console.error("[UpdateNotification] 读取 CHANGELOG 失败:", error);
      return this.i18n.noChangelog;
    }
  }

  /**
   * 打开 CHANGELOG 文件
   * 优先打开对应语言的 CHANGELOG 文件
   */
  private async openChangelogFile(): Promise<void> {
    try {
      // 尝试打开对应语言的 CHANGELOG
      const localizedChangelogPath = path.join(
        this.context.extensionPath,
        `CHANGELOG.${this.locale}.md`
      );
      
      if (fs.existsSync(localizedChangelogPath)) {
        const doc = await vscode.workspace.openTextDocument(localizedChangelogPath);
        await vscode.window.showTextDocument(doc);
        return;
      }
      
      // 如果没有对应语言的文件，打开默认的 CHANGELOG.md
      const defaultChangelogPath = path.join(
        this.context.extensionPath,
        "CHANGELOG.md"
      );
      const doc = await vscode.workspace.openTextDocument(defaultChangelogPath);
      await vscode.window.showTextDocument(doc);
    } catch (error) {
      vscode.window.showErrorMessage(this.i18n.errorOpenChangelog);
    }
  }

  /**
   * 解析 Markdown 格式的更新日志为 HTML
   */
  private parseChangelogToHtml(changelog: string): string {
    const lines = changelog.split("\n");
    let html = "";
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimLine = line.trim();

      // 跳过主标题和版本标题，因为我们会在头部单独处理
      if (trimLine.startsWith("## Changelog") || trimLine.startsWith("### ")) {
        // 如果我们遇到下一个版本的标题，停止解析
        if (trimLine.startsWith("### ") && html.length > 0) {
          break;
        }
        continue;
      }

      // H4 标题 (类别，如 New, Fixes)
      if (trimLine.startsWith("#### ")) {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        const title = trimLine.substring(5);
        let icon = "";
        let className = "category-title";
        
        if (title.includes("New")) {
          icon = "✨";
          className += " new";
        } else if (title.includes("Fix")) {
          icon = "🐛";
          className += " fix";
        } else if (title.includes("Improvement")) {
          icon = "📝";
          className += " improvement";
        }

        html += `<h4 class="${className}">${title}</h4>`;
        continue;
      }

      // 列表项
      if (trimLine.startsWith("- ")) {
        if (!inList) {
          html += "<ul>";
          inList = true;
        }
        
        let content = trimLine.substring(2);
        
        // 处理粗体
        content = content.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
        
        // 处理代码
        content = content.replace(/`(.*?)`/g, "<code>$1</code>");

        html += `<li>${content}</li>`;
        continue;
      }

      // 缩进列表项 (子项)
      if (line.startsWith("  - ") || line.startsWith("\t- ")) {
         // 我们简单地将其作为普通列表项处理，但添加一个类来缩进
         if (!inList) {
            html += "<ul>";
            inList = true;
         }
         let content = trimLine.substring(2);
         content = content.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
         content = content.replace(/`(.*?)`/g, "<code>$1</code>");
         
         // 关闭上一个 li，如果存在
         if (html.endsWith("</li>")) {
            html = html.substring(0, html.length - 5);
            html += `<div class="sub-item">• ${content}</div></li>`;
         } else {
             html += `<li class="sub-item">${content}</li>`;
         }
         continue;
      }

      // 结束列表
      if (trimLine === "" && inList) {
        html += "</ul>";
        inList = false;
        continue;
      }

      // 分隔线
      if (trimLine === "---") {
        if (inList) {
            html += "</ul>";
            inList = false;
        }
        html += "<hr>";
        continue;
      }
      
      // 引用
      if (trimLine.startsWith("> ")) {
          if (inList) {
              html += "</ul>";
              inList = false;
          }
          html += `<blockquote>${trimLine.substring(2)}</blockquote>`;
          continue;
      }

      // 普通文本（非空行）
      if (trimLine !== "") {
          if (inList) {
              html += "</ul>";
              inList = false;
          }
          html += `<p>${trimLine}</p>`;
      }
    }

    if (inList) {
      html += "</ul>";
    }

    return html;
  }

  /**
   * 生成 WebView HTML 内容
   */
  private getWebviewContent(
    currentVersion: string,
    lastVersion: string,
    changelogContent: string,
    webview: vscode.Webview
  ): string {
    const changelogHtml = this.parseChangelogToHtml(changelogContent);

    // 获取图标路径
    const logoUri = webview.asWebviewUri(
        vscode.Uri.file(path.join(this.context.extensionPath, "media", "logo.png"))
    );

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>seekdb-client 更新日志</title>
    <style>
        :root {
            --container-paddding: 20px;
            --input-padding-vertical: 6px;
            --input-padding-horizontal: 4px;
            --input-margin-vertical: 4px;
            --input-margin-horizontal: 0;
        }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            padding: 0;
            margin: 0;
            line-height: 1.5;
            font-size: 13px;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
            animation: fadeIn 0.4s ease-in-out;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* 顶部卡片 */
        .hero-card {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 32px;
            text-align: center;
            margin-bottom: 24px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            position: relative;
            overflow: hidden;
        }

        .hero-card::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, var(--vscode-button-background), #3794ff);
        }

        .logo-container {
            margin-bottom: 16px;
        }

        .logo {
            width: 80px;
            height: 80px;
            object-fit: contain;
        }

        .title {
            font-size: 24px;
            font-weight: 600;
            color: var(--vscode-editor-foreground);
            margin-bottom: 8px;
        }

        .subtitle {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
            margin-bottom: 24px;
        }

        /* 版本对比 */
        .version-compare {
            display: inline-flex;
            align-items: center;
            background-color: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 20px;
            padding: 4px 6px;
            gap: 12px;
        }

        .version-tag {
            padding: 4px 12px;
            border-radius: 16px;
            font-weight: 600;
            font-size: 13px;
        }

        .version-tag.old {
            color: var(--vscode-descriptionForeground);
            background-color: rgba(128, 128, 128, 0.1);
        }

        .version-tag.new {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .arrow-icon {
            color: var(--vscode-descriptionForeground);
            font-size: 16px;
        }

        /* Changelog 内容 */
        .content-card {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 32px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }

        .category-title {
            font-size: 16px;
            font-weight: 600;
            margin-top: 24px;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            color: var(--vscode-editor-foreground);
        }

        .category-title:first-child {
            margin-top: 0;
        }

        /* 列表样式优化 */
        ul {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        li {
            padding: 8px 0;
            padding-left: 24px;
            position: relative;
            color: var(--vscode-foreground);
            line-height: 1.6;
        }

        li::before {
            content: "";
            position: absolute;
            left: 8px;
            top: 15px;
            width: 4px;
            height: 4px;
            border-radius: 50%;
            background-color: var(--vscode-button-background);
        }
        
        /* 子项目缩进 */
        .sub-item {
            margin-top: 4px;
            color: var(--vscode-descriptionForeground);
            font-size: 0.95em;
        }

        strong {
            color: var(--vscode-editor-foreground);
            font-weight: 600;
        }

        code {
            font-family: var(--vscode-editor-font-family, "Menlo", "Monaco", "Courier New", monospace);
            background-color: var(--vscode-textBlockQuote-background, rgba(128, 128, 128, 0.1));
            padding: 2px 4px;
            border-radius: 3px;
            font-size: 0.9em;
            color: var(--vscode-textLink-activeForeground);
        }
        
        blockquote {
            margin: 16px 0;
            padding: 12px 16px;
            background-color: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textBlockQuote-border);
            color: var(--vscode-descriptionForeground);
        }

        /* 按钮组 */
        .actions {
            margin-top: 32px;
            display: flex;
            justify-content: center;
            gap: 16px;
        }

        /* 复刻 VS Code 按钮样式 */
        .vscode-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 8px 16px; /* 稍微大一点，适合作为主要操作 */
            border-radius: 2px;
            font-size: 13px;
            font-weight: 400;
            cursor: pointer;
            border: none;
            outline: none;
            transition: background-color 0.1s;
            text-decoration: none;
            min-width: 100px;
        }

        .vscode-button.primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .vscode-button.primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .vscode-button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .vscode-button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        /* 页脚 */
        .footer {
            margin-top: 40px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        
        .footer a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        
        .footer a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- 顶部卡片 -->
        <div class="hero-card">
            <div class="logo-container">
                <img src="${logoUri}" alt="Logo" class="logo" />
            </div>
            <h1 class="title">${this.i18n.title}</h1>
            <p class="subtitle">${this.i18n.subtitle}</p>
            
            <div class="version-compare">
                <span class="version-tag old">v${lastVersion}</span>
                <span class="arrow-icon">→</span>
                <span class="version-tag new">v${currentVersion}</span>
            </div>
        </div>

        <!-- 内容区域 -->
        <div class="content-card">
            ${changelogHtml}
        </div>

        <!-- 操作按钮 -->
        <div class="actions">
            <button class="vscode-button primary" onclick="handleClose()">
                ${this.i18n.btnStart}
            </button>
            <button class="vscode-button secondary" onclick="handleOpenChangelog()">
                ${this.i18n.btnChangelog}
            </button>
        </div>

        <!-- 页脚 -->
        <div class="footer">
            <p>
                ${this.i18n.footerText} 
                <a href="https://github.com/ofx-labs/seekdb-client" target="_blank">${this.i18n.footerLink}</a>
            </p>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function handleClose() {
            vscode.postMessage({ command: 'close' });
        }

        function handleOpenChangelog() {
            vscode.postMessage({ command: 'openChangelog' });
        }
    </script>
</body>
</html>`;
  }
}
