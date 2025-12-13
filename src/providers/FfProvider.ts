import * as vscode from "vscode";
import { DatabaseProvider } from "./DatabaseProvider";

export class FfProvider implements vscode.WebviewViewProvider {
  private webviewView?: vscode.WebviewView; // 添加WebView视图引用
  private databaseProvider: DatabaseProvider; // 添加DatabaseProvider引用

  constructor(private readonly context: vscode.ExtensionContext) {
    // 初始化DatabaseProvider
    this.databaseProvider = new DatabaseProvider(this.context);

    // 监听数据库连接变化，更新侧边栏
    this.databaseProvider.onConnectionsChanged((connections) => {
      if (this.webviewView) {
        this.webviewView.webview.postMessage({
          type: "updateDatabaseConnections",
          data: { connections },
        });
      }
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView; // 保存WebView视图的引用
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewView.webview.html = this.getHtmlContent(webviewView);

    this.setWebviewEventListeners(webviewView);
  }

  /**
   * setWebviewEventListeners
   */
  public setWebviewEventListeners(webviewView: vscode.WebviewView) {
    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        // 基础功能
        case "openBrowser":
          // 打开外部URL
          vscode.env.openExternal(vscode.Uri.parse(message.data.url));
          break;

        case "getState":
          if (message.key) {
            const value = this.getState(message.key);
            webviewView.webview.postMessage({
              type: message.key,
              value: value,
            });
          }
          break;

        case "setState":
          if (message.key) {
            this.saveState(message.key, message.value);
          }
          break;

        // 数据库相关消息处理
        case "getDatabaseConnections":
          webviewView.webview.postMessage({
            type: "updateDatabaseConnections",
            data: { connections: this.getDatabaseConnections() },
          });
          break;

        case "openDatabaseConnect":
          this.openDatabaseConnectPage();
          break;

        case "connectToDatabase":
          if (message.data) {
            // 重新连接数据库
            this.databaseProvider.openConnectPage();
          }
          break;

        case "disconnectDatabase":
          if (message.data?.id) {
            this.disconnectDatabase(message.data.id);
            webviewView.webview.postMessage({
              type: "updateDatabaseConnections",
              data: { connections: this.getDatabaseConnections() },
            });
          }
          break;

        case "deleteDatabaseConnection":
          if (message.data?.id) {
            this.deleteDatabaseConnection(message.data.id);
            webviewView.webview.postMessage({
              type: "updateDatabaseConnections",
              data: { connections: this.getDatabaseConnections() },
            });
          }
          break;

        case "openCollectionBrowser":
          if (message.data?.id) {
            this.openCollectionBrowser(message.data.id);
          }
          break;

        // seekdb 数据库操作相关消息
        case "getServerDatabases":
          if (message.data?.connectionId) {
            this.handleGetServerDatabases(
              message.data.connectionId,
              webviewView
            );
          }
          break;

        case "selectServerDatabase":
          if (message.data?.connectionId && message.data?.database) {
            this.handleSelectServerDatabase(
              message.data.connectionId,
              message.data.database,
              webviewView
            );
          }
          break;

        case "createServerDatabase":
          if (message.data?.connectionId && message.data?.name) {
            this.handleCreateServerDatabase(
              message.data.connectionId,
              message.data.name,
              webviewView
            );
          }
          break;

        case "deleteServerDatabase":
          if (message.data?.connectionId && message.data?.name) {
            this.handleDeleteServerDatabase(
              message.data.connectionId,
              message.data.name,
              webviewView
            );
          }
          break;

        case "clearWarnings":
          this.databaseProvider.clearWarnings();
          break;

        default:
          break;
      }
    });
  }

  /**
   * 获取HTML内容
   */
  getHtmlContent(webviewView: vscode.WebviewView) {
    // 获取 assets 目录的 base URI（用于解析相对路径）
    const assetsUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "out", "ui", "assets")
    );

    // 获取主CSS和JS文件的URI（Vite 构建输出到 out/ui/assets）
    const styleUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "out",
        "ui",
        "assets",
        "style.css"
      )
    );

    const scriptUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "out",
        "ui",
        "assets",
        "Sidebar.js"
      )
    );

    // 获取 VS Code 的 codicon 图标样式文件路径
    // 尝试不同的路径来查找 codicon.css
    let codiconsUri;
    try {
      codiconsUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
          this.context.extensionUri,
          "node_modules",
          "@vscode/codicons",
          "dist",
          "codicon.css"
        )
      );
    } catch (error) {
      // 如果路径不存在，尝试备用路径
      console.error("加载codicon.css出错，尝试备用路径:", error);
      codiconsUri = webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(
          this.context.extensionUri,
          "resources",
          "codicon.css"
        )
      );
    }

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>FF</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <base href="${assetsUri}/">
          <link href="${styleUri}" rel="stylesheet">
          <link href="${codiconsUri}" rel="stylesheet">
          <style>
            /* 确保基本的图标样式 */
            .codicon {
              font-family: 'codicon', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              font-size: 16px;
              display: inline-block;
              text-align: center;
              vertical-align: middle;
              font-style: normal;
              font-weight: normal;
              color: var(--vscode-foreground);
            }
            .codicon-add:before { content: '\\ea60'; }
            .codicon-check:before { content: '\\ea91'; }
            .codicon-close:before { content: '\\ea76'; }
            .codicon-edit:before { content: '\\ea73'; }
            .codicon-trash:before { content: '\\eb9f'; }
            .codicon-folder:before { content: '\\ea83'; }
          </style>
          <script type="module" src="${scriptUri}"></script>
        </head>
        <body>
          <div id="root"></div>
        </body>
      </html>
    `;
  }

  /**
   * 保存状态到全局存储
   */
  private saveState(key: string, value: any) {
    this.context.globalState.update(key, value);
  }

  /**
   * 从全局存储获取状态
   */
  private getState(key: string): any {
    return this.context.globalState.get(key);
  }

  /**
   * 获取指定配置项的值
   * @param configKey 配置项键名（不包含前缀）
   * @param defaultValue 默认值
   * @returns 配置项的值
   */
  private getConfiguration<T>(configKey: string, defaultValue: T): T {
    // 获取扩展配置
    const config = vscode.workspace.getConfiguration("seekdb");
    // 返回配置值，如果没有则返回默认值
    return config.get<T>(configKey, defaultValue);
  }

  /**
   * 打开数据库管理（侧边栏显示实例列表）
   */
  public openDatabase(): void {
    try {
      if (this.webviewView && this.webviewView.webview) {
        // 在侧边栏显示数据库连接列表
        this.webviewView.webview.postMessage({
          type: "openDatabase",
        });

        // 同时发送已保存的连接数据
        this.webviewView.webview.postMessage({
          type: "updateDatabaseConnections",
          data: { connections: this.getDatabaseConnections() },
        });

        // 如果webView当前未可见，则尝试显示它
        if (!this.webviewView.visible) {
          vscode.commands.executeCommand("seekdb.webviewProvider.focus");
        }
      } else {
        vscode.window.showErrorMessage("无法打开数据库管理，WebView未初始化");
      }
    } catch (error) {
      console.error("打开数据库管理时出错:", error);
      vscode.window.showErrorMessage(`无法打开数据库管理: ${error}`);
    }
  }

  /**
   * 打开数据库连接页面（新tab）
   */
  public openDatabaseConnectPage(): void {
    console.log("openDatabaseConnectPage - 打开新tab");
    try {
      this.databaseProvider.openConnectPage();
    } catch (error) {
      console.error("打开数据库连接页面时出错:", error);
      vscode.window.showErrorMessage(`无法打开数据库连接页面: ${error}`);
    }
  }

  /**
   * 获取数据库连接列表
   */
  public getDatabaseConnections(): any[] {
    return this.databaseProvider.getConnections();
  }

  /**
   * 断开数据库连接
   */
  public async disconnectDatabase(connectionId: string): Promise<void> {
    await this.databaseProvider.disconnectDatabase(connectionId);
  }

  /**
   * 删除数据库连接
   */
  public async deleteDatabaseConnection(connectionId: string): Promise<void> {
    await this.databaseProvider.deleteConnection(connectionId);
  }

  /**
   * 打开集合浏览器
   */
  public openCollectionBrowser(connectionId: string): void {
    this.databaseProvider.openCollectionBrowser(connectionId);
  }

  /**
   * 处理获取服务器数据库列表
   */
  private async handleGetServerDatabases(
    connectionId: string,
    webviewView: vscode.WebviewView
  ): Promise<void> {
    try {
      const databases = await this.databaseProvider.getServerDatabases(
        connectionId
      );
      webviewView.webview.postMessage({
        type: "serverDatabasesList",
        data: { connectionId, databases },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      webviewView.webview.postMessage({
        type: "serverDatabasesList",
        data: { connectionId, databases: [], error: errorMsg },
      });
    }
  }

  /**
   * 处理选择服务器数据库
   */
  private async handleSelectServerDatabase(
    connectionId: string,
    database: string,
    webviewView: vscode.WebviewView
  ): Promise<void> {
    try {
      // 调用 DatabaseProvider 的方法来切换数据库并刷新已打开的 Collection Browser panel
      await this.databaseProvider.selectDatabaseForConnection(
        connectionId,
        database
      );

      // 刷新连接列表
      webviewView.webview.postMessage({
        type: "updateDatabaseConnections",
        data: { connections: this.getDatabaseConnections() },
      });

      vscode.window.showInformationMessage(`已切换到数据库: ${database}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`切换数据库失败: ${errorMsg}`);
    }
  }

  /**
   * 处理创建服务器数据库
   */
  private async handleCreateServerDatabase(
    connectionId: string,
    name: string,
    webviewView: vscode.WebviewView
  ): Promise<void> {
    try {
      await this.databaseProvider.createServerDatabase(connectionId, name);

      // 刷新数据库列表
      await this.handleGetServerDatabases(connectionId, webviewView);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`创建数据库失败: ${errorMsg}`);
    }
  }

  /**
   * 处理删除服务器数据库
   */
  private async handleDeleteServerDatabase(
    connectionId: string,
    name: string,
    webviewView: vscode.WebviewView
  ): Promise<void> {
    try {
      await this.databaseProvider.deleteServerDatabase(connectionId, name);

      // 刷新数据库列表
      await this.handleGetServerDatabases(connectionId, webviewView);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`删除数据库失败: ${errorMsg}`);
    }
  }

  /**
   * 获取DatabaseProvider实例
   */
  public getDatabaseProvider(): DatabaseProvider {
    return this.databaseProvider;
  }
}
