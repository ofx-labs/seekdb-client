import * as vscode from "vscode";

/**
 * App template interface
 */
export interface AppTemplate {
  id: string;
  name: string;
  description: string;
  repository: string;
  icon?: string;
}

/**
 * App Tree Data Provider
 * 管理应用模板和已创建的应用
 */
export class AppTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  > = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    vscode.TreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private templates: AppTemplate[] = [
    {
      id: "nextjs-seekdb-template",
      name: "Next.js + SeekDB Template",
      description: "A Next.js 15 template with SeekDB vector search",
      repository: "https://github.com/ofx-labs/nextjs-seekdb-template",
      icon: "file-code",
    },
  ];

  /**
   * 获取树节点
   */
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * 获取子节点
   */
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      // 根节点：返回模板列表
      const contextKey = "seekdb.appsEmpty";
      vscode.commands.executeCommand(
        "setContext",
        contextKey,
        this.templates.length === 0,
      );

      if (this.templates.length === 0) {
        return [];
      }

      return this.templates.map((template) =>
        this.createTemplateItem(template),
      );
    }

    return [];
  }

  /**
   * 创建模板项
   */
  private createTemplateItem(template: AppTemplate): vscode.TreeItem {
    const item = new vscode.TreeItem(
      template.name,
      vscode.TreeItemCollapsibleState.None,
    );

    item.contextValue = "app-template";
    item.description = template.description;
    item.tooltip = new vscode.MarkdownString();
    item.tooltip.appendMarkdown(`**${template.name}**\n\n`);
    item.tooltip.appendMarkdown(`${template.description}\n\n`);
    item.tooltip.appendMarkdown(
      `Repository: [${template.repository}](${template.repository})`,
    );

    // 设置图标
    if (template.icon) {
      item.iconPath = new vscode.ThemeIcon(template.icon);
    } else {
      item.iconPath = new vscode.ThemeIcon("file-code");
    }

    // 存储模板数据
    (item as any).templateData = template;

    // 设置命令：点击模板项时创建应用
    item.command = {
      command: "seekdb.createAppFromTemplate",
      title: "Create App from Template",
      arguments: [template],
    };

    return item;
  }

  /**
   * 刷新树视图
   */
  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * 获取所有模板
   */
  public getTemplates(): AppTemplate[] {
    return this.templates;
  }
}
