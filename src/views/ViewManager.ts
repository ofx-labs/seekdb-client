import * as vscode from "vscode";
import { FfProvider } from "../providers/FfProvider.js";
import { DatabaseTreeDataProvider } from "../providers/DatabaseTreeDataProvider.js";

export class ViewManager {
  private context: vscode.ExtensionContext;
  private cloudTreeDataProvider?: DatabaseTreeDataProvider;
  private localTreeDataProvider?: DatabaseTreeDataProvider;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * 注册所有视图
   */
  public registerAllViews(ffProvider: FfProvider): void {
    this.registerTreeViewProviders(ffProvider);
  }

  /**
   * 注册TreeView提供器
   */
  private registerTreeViewProviders(ffProvider: FfProvider): void {
    const databaseProvider = ffProvider.getDatabaseProvider();

    // 创建 CLOUD 分组的 TreeDataProvider
    this.cloudTreeDataProvider = new DatabaseTreeDataProvider(
      databaseProvider,
      "cloud",
    );

    // 创建 LOCAL 分组的 TreeDataProvider
    this.localTreeDataProvider = new DatabaseTreeDataProvider(
      databaseProvider,
      "local",
    );

    // 注册 CLOUD tree view
    const cloudTreeView = vscode.window.createTreeView(
      "seekdb.cloudConnections",
      {
        treeDataProvider: this.cloudTreeDataProvider,
        showCollapseAll: true,
      },
    );

    // 注册 LOCAL tree view
    const localTreeView = vscode.window.createTreeView(
      "seekdb.localConnections",
      {
        treeDataProvider: this.localTreeDataProvider,
        showCollapseAll: true,
      },
    );

    this.context.subscriptions.push(cloudTreeView);
    this.context.subscriptions.push(localTreeView);

    // 注册命令
    this.registerCommands(databaseProvider);
  }

  /**
   * 注册命令
   */
  private registerCommands(databaseProvider: any): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "seekdb.selectDatabase",
        async (connectionId: string, databaseName: string) => {
          try {
            await databaseProvider.selectDatabaseForConnection(
              connectionId,
              databaseName,
            );
            this.refreshAll();
            vscode.window.showInformationMessage(
              `Switched to database: ${databaseName}`,
            );
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(
              `Failed to switch database: ${errorMsg}`,
            );
          }
        },
      ),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "seekdb.connectDatabase",
        async (item: vscode.TreeItem) => {
          const connectionId = (item as any).connectionId;
          if (connectionId) {
            const connection = databaseProvider
              .getConnections()
              .find((c: any) => c.id === connectionId);
            if (connection) {
              databaseProvider.openConnectPage(connection);
            }
          }
        },
      ),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "seekdb.disconnectDatabase",
        async (item: vscode.TreeItem) => {
          const connectionId = (item as any).connectionId;
          if (connectionId) {
            await databaseProvider.disconnectDatabase(connectionId);
            this.refreshAll();
          }
        },
      ),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "seekdb.deleteConnection",
        async (item: vscode.TreeItem) => {
          const connectionId = (item as any).connectionId;
          if (connectionId) {
            const confirmed = await vscode.window.showWarningMessage(
              `Are you sure you want to delete connection "${item.label}"?`,
              "Delete",
              "Cancel",
            );
            if (confirmed === "Delete") {
              await databaseProvider.deleteConnection(connectionId);
              this.refreshAll();
            }
          }
        },
      ),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "seekdb.openConnectionCollections",
        async (item: vscode.TreeItem) => {
          const connectionId = (item as any).connectionId;
          if (connectionId) {
            databaseProvider.openCollectionBrowser(connectionId);
          }
        },
      ),
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand("seekdb.refreshConnections", () => {
        this.refreshAll();
      }),
    );
  }

  /**
   * 刷新所有树视图
   */
  private refreshAll(): void {
    this.cloudTreeDataProvider?.refresh();
    this.localTreeDataProvider?.refresh();
  }
}
