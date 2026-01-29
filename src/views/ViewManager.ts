import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { FfProvider } from "../providers/FfProvider.js";
import { DatabaseTreeDataProvider } from "../providers/DatabaseTreeDataProvider.js";
import {
  AppTreeDataProvider,
  AppTemplate,
} from "../providers/AppTreeDataProvider.js";

const execAsync = promisify(exec);

export class ViewManager {
  private context: vscode.ExtensionContext;
  private cloudTreeDataProvider?: DatabaseTreeDataProvider;
  private localTreeDataProvider?: DatabaseTreeDataProvider;
  private appTreeDataProvider?: AppTreeDataProvider;

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

    // 创建 App 分组的 TreeDataProvider
    this.appTreeDataProvider = new AppTreeDataProvider();

    // 注册 App tree view
    const appTreeView = vscode.window.createTreeView("seekdb.apps", {
      treeDataProvider: this.appTreeDataProvider,
      showCollapseAll: true,
    });

    this.context.subscriptions.push(cloudTreeView);
    this.context.subscriptions.push(localTreeView);
    this.context.subscriptions.push(appTreeView);

    // 注册命令
    this.registerCommands(databaseProvider);
    this.registerAppCommands();
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

    // Sign in to OceanBase Cloud
    this.context.subscriptions.push(
      vscode.commands.registerCommand("seekdb.signInCloud", async () => {
        try {
          const url = vscode.Uri.parse("https://en.oceanbase.com/");
          await vscode.env.openExternal(url);
        } catch (error) {
          vscode.window.showErrorMessage(
            "Failed to open OceanBase Cloud. Please visit https://en.oceanbase.com/",
          );
        }
      }),
    );
  }

  /**
   * 注册应用相关命令
   */
  private registerAppCommands(): void {
    // 从模板创建应用
    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "seekdb.createAppFromTemplate",
        async (template?: AppTemplate) => {
          try {
            // 如果没有提供模板，使用默认模板
            if (!template) {
              const templates = this.appTreeDataProvider?.getTemplates() || [];
              if (templates.length === 0) {
                vscode.window.showErrorMessage("No templates available");
                return;
              }
              template = templates[0];
            }

            // 让用户选择项目保存位置
            const folderUri = await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              openLabel: "Select Folder",
            });

            if (!folderUri || folderUri.length === 0) {
              return;
            }

            const parentFolder = folderUri[0].fsPath;

            // 让用户输入项目名称
            const projectName = await vscode.window.showInputBox({
              prompt: "Enter project name",
              placeHolder: "my-seekdb-app",
              validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                  return "Project name cannot be empty";
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                  return "Project name can only contain letters, numbers, underscores, and hyphens";
                }
                const projectPath = path.join(parentFolder, value);
                if (fs.existsSync(projectPath)) {
                  return "A folder with this name already exists";
                }
                return null;
              },
            });

            if (!projectName) {
              return;
            }

            const projectPath = path.join(parentFolder, projectName);

            // 确保 template 已定义
            if (!template) {
              vscode.window.showErrorMessage("Template not found");
              return;
            }

            // 显示进度
            await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: `Creating app from template: ${template.name}`,
                cancellable: false,
              },
              async (progress) => {
                try {
                  progress.report({
                    increment: 0,
                    message: "Cloning repository...",
                  });

                  // 克隆仓库
                  const cloneCommand = `git clone ${template!.repository} "${projectPath}"`;
                  await execAsync(cloneCommand, {
                    timeout: 60000, // 60秒超时
                  });

                  progress.report({ increment: 50, message: "Cleaning up..." });

                  // 删除 .git 文件夹（可选，让用户自己初始化）
                  const gitPath = path.join(projectPath, ".git");
                  if (fs.existsSync(gitPath)) {
                    fs.rmSync(gitPath, { recursive: true, force: true });
                  }

                  progress.report({ increment: 100, message: "Done!" });

                  // 询问是否打开新项目
                  const action = await vscode.window.showInformationMessage(
                    `Project "${projectName}" created successfully!`,
                    "Open in New Window",
                    "Open in Current Window",
                    "Cancel",
                  );

                  if (action === "Open in New Window") {
                    await vscode.commands.executeCommand(
                      "vscode.openFolder",
                      vscode.Uri.file(projectPath),
                      true,
                    );
                  } else if (action === "Open in Current Window") {
                    await vscode.commands.executeCommand(
                      "vscode.openFolder",
                      vscode.Uri.file(projectPath),
                      false,
                    );
                  }
                } catch (error: any) {
                  const errorMsg =
                    error instanceof Error ? error.message : String(error);
                  vscode.window.showErrorMessage(
                    `Failed to create app: ${errorMsg}`,
                  );
                  // 如果创建失败，清理已创建的文件夹
                  if (fs.existsSync(projectPath)) {
                    fs.rmSync(projectPath, { recursive: true, force: true });
                  }
                }
              },
            );
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(
              `Failed to create app from template: ${errorMsg}`,
            );
          }
        },
      ),
    );

    // 打开模板链接
    this.context.subscriptions.push(
      vscode.commands.registerCommand(
        "seekdb.openTemplate",
        async (item: vscode.TreeItem) => {
          const template = (item as any).templateData as
            | AppTemplate
            | undefined;
          if (template?.repository) {
            try {
              const url = vscode.Uri.parse(template.repository);
              await vscode.env.openExternal(url);
            } catch (error) {
              vscode.window.showErrorMessage(
                `Failed to open template: ${template.repository}`,
              );
            }
          }
        },
      ),
    );
  }

  /**
   * 刷新所有树视图
   */
  private refreshAll(): void {
    this.cloudTreeDataProvider?.refresh();
    this.localTreeDataProvider?.refresh();
    this.appTreeDataProvider?.refresh();
  }
}
