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
      ),
      vscode.commands.registerCommand("seekdb.openSettings", async () => {
        try {
          // 方法1: 使用配置前缀打开设置并自动过滤
          // 这会打开设置页面并搜索 "seekdb" 相关的配置项
          await vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "seekdb"
          );
        } catch (error) {
          console.error("打开设置失败，尝试备用方法:", error);
          try {
            // 方法2: 直接打开设置页面
            await vscode.commands.executeCommand(
              "workbench.action.openSettings"
            );
            // 提示用户搜索 seekdb
            vscode.window.showInformationMessage(
              "请在设置搜索框中输入 'seekdb' 来查看扩展配置"
            );
          } catch (fallbackError) {
            console.error("打开设置完全失败:", fallbackError);
            vscode.window.showErrorMessage(
              "无法打开设置页面，请手动打开设置（Ctrl+,）并搜索 'seekdb'"
            );
          }
        }
      })
    );
  }
}
