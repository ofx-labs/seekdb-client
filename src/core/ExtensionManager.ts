import * as vscode from "vscode";
import { FfProvider } from "../providers/FfProvider";
import { DatabaseProvider } from "../providers/DatabaseProvider";
import { CollectionHoverProvider } from "../providers/CollectionHoverProvider";
import { CommandManager } from "../commands/CommandManager";
import { ViewManager } from "../views/ViewManager";

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

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.rootPath = this.getRootPath();
  }

  /**
   * 激活扩展
   */
  public async activate(): Promise<void> {
    try {
      // 初始化提供器
      this.initializeProviders();

      // 初始化管理器
      this.initializeManagers();

      // 注册所有组件
      await this.registerComponents();
    } catch (error) {
      vscode.window.showErrorMessage(`seekdb-client 扩展激活失败: ${error}`);
    }
  }

  /**
   * 停用扩展
   */
  public deactivate(): void {
    // 清理资源
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
