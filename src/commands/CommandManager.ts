import * as vscode from "vscode";
import { FfProvider } from "../providers/FfProvider.js";
import { DatabaseProvider } from "../providers/DatabaseProvider";

export class CommandManager {
  private context: vscode.ExtensionContext;
  private ffProvider: FfProvider;
  private databaseProvider: DatabaseProvider;

  constructor(
    context: vscode.ExtensionContext,
    ffProvider: FfProvider,
    databaseProvider: DatabaseProvider
  ) {
    this.context = context;
    this.ffProvider = ffProvider;
    this.databaseProvider = databaseProvider;
  }

  /**
   * 注册所有命令
   */
  public registerAllCommands(): void {
    this.registerDatabaseCommands();
  }

  /**
   * 注册数据库相关命令
   */
  private registerDatabaseCommands(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand("seekdb.openDatabase", () => {
        if (this.ffProvider) {
          this.ffProvider.openDatabase();
        } else {
          vscode.window.showErrorMessage("无法打开数据库管理，请重新加载扩展");
        }
      }),
      vscode.commands.registerCommand(
        "seekdb.openCollectionBrowser",
        async (collectionName: string) => {
          if (this.databaseProvider && collectionName) {
            await this.databaseProvider.openCollectionBrowserWithCollection(
              collectionName
            );
          } else {
            vscode.window.showErrorMessage(
              "无法打开Collection浏览器，请检查参数"
            );
          }
        }
      )
    );
  }
}
