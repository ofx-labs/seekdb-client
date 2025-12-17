import * as vscode from "vscode";
import { FfProvider } from "../providers/FfProvider";
import { DatabaseProvider } from "../providers/DatabaseProvider";
import { CollectionHoverProvider } from "../providers/CollectionHoverProvider";
import { CommandManager } from "../commands/CommandManager";
import { ViewManager } from "../views/ViewManager";
import { PreflightService } from "../services/preflight/PreflightService";

export class ExtensionManager {
  private context: vscode.ExtensionContext;
  private rootPath?: string;

  // 管理器实例
  private commandManager?: CommandManager;
  private viewManager?: ViewManager;

  // 提供器实例
  private ffProvider?: FfProvider;
  private databaseProvider?: DatabaseProvider;
  private collectionHoverProvider?: CollectionHoverProvider;

  // 预检查服务
  private preflightService?: PreflightService;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.rootPath = this.getRootPath();
  }

  /**
   * 激活扩展
   */
  public async activate(): Promise<void> {
    try {
      // 1. 初始化预检查服务（不立即运行，等待 webview 请求）
      this.initializePreflightService();

      // 2. 初始化提供器
      this.initializeProviders();

      // 3. 将预检查服务设置到 FfProvider
      if (this.ffProvider && this.preflightService) {
        this.ffProvider.setPreflightService(this.preflightService);
      }

      // 4. 初始化管理器
      this.initializeManagers();

      // 5. 注册所有组件
      await this.registerComponents();

      // 6. 注册预检查相关命令
      this.registerPreflightCommands();
    } catch (error) {
      vscode.window.showErrorMessage(`seekdb-client 扩展激活失败: ${error}`);
    }
  }

  /**
   * 初始化预检查服务
   */
  private initializePreflightService(): void {
    // 获取用户配置
    const config = vscode.workspace.getConfiguration("seekdb.preflight");
    const enabled = config.get<boolean>("enabled", true);

    if (!enabled) {
      console.log("[SeekDB] 预检查已禁用");
      return;
    }

    this.preflightService = new PreflightService(this.context);
  }

  /**
   * 注册预检查相关命令
   */
  private registerPreflightCommands(): void {
    if (!this.preflightService) {
      return;
    }

    const preflightService = this.preflightService;

    this.context.subscriptions.push(
      vscode.commands.registerCommand("seekdb.runPreflight", async () => {
        await preflightService.runAllChecks(true);
        await preflightService.showReportPanel();
      }),
      vscode.commands.registerCommand(
        "seekdb.showPreflightReport",
        async () => {
          await preflightService.showReportPanel();
        }
      )
    );
  }

  /**
   * 停用扩展
   */
  public deactivate(): void {
    // 清理预检查服务资源
    if (this.preflightService) {
      this.preflightService.dispose();
    }
  }

  /**
   * 获取工作区根路径
   */
  private getRootPath(): string | undefined {
    return vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;
  }

  /**
   * 初始化提供器
   */
  private initializeProviders(): void {
    // 创建提供器实例
    this.ffProvider = new FfProvider(this.context);

    // 从FfProvider获取DatabaseProvider实例
    this.databaseProvider = this.ffProvider.getDatabaseProvider();

    // 创建CollectionHoverProvider
    this.collectionHoverProvider = new CollectionHoverProvider(
      this.databaseProvider
    );
  }

  /**
   * 初始化管理器
   */
  private initializeManagers(): void {
    if (!this.ffProvider || !this.databaseProvider) {
      throw new Error("提供器未正确初始化");
    }

    this.commandManager = new CommandManager(
      this.context,
      this.ffProvider,
      this.databaseProvider
    );

    this.viewManager = new ViewManager(this.context);
  }

  /**
   * 注册所有组件
   */
  private async registerComponents(): Promise<void> {
    if (!this.commandManager || !this.viewManager) {
      throw new Error("管理器未正确初始化");
    }

    if (!this.ffProvider || !this.collectionHoverProvider) {
      throw new Error("提供器未正确初始化");
    }

    // 注册命令
    this.commandManager.registerAllCommands();

    // 注册视图
    this.viewManager.registerAllViews(this.ffProvider);

    // 注册Hover Provider
    this.context.subscriptions.push(
      vscode.languages.registerHoverProvider(
        { scheme: "file", language: "typescript" },
        this.collectionHoverProvider
      )
    );
    this.context.subscriptions.push(
      vscode.languages.registerHoverProvider(
        { scheme: "file", language: "javascript" },
        this.collectionHoverProvider
      )
    );
    this.context.subscriptions.push(
      vscode.languages.registerHoverProvider(
        { scheme: "file", language: "typescriptreact" },
        this.collectionHoverProvider
      )
    );
    this.context.subscriptions.push(
      vscode.languages.registerHoverProvider(
        { scheme: "file", language: "javascriptreact" },
        this.collectionHoverProvider
      )
    );
  }

  /**
   * 获取FfProvider实例
   */
  public getFfProvider(): FfProvider | undefined {
    return this.ffProvider;
  }
}
