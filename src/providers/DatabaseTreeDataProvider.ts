import * as vscode from "vscode";
import { DatabaseProvider } from "./DatabaseProvider";

/**
 * Tree item types
 */
enum TreeItemType {
  Connection = "connection",
  Database = "database",
}

/**
 * Tree item data
 */
interface TreeItemData {
  type: TreeItemType;
  id: string;
  connectionId?: string;
  [key: string]: any;
}

/**
 * Connection filter type
 */
export type ConnectionFilter = "cloud" | "local";

/**
 * Database Tree Data Provider
 * 使用 VS Code 原生 TreeView 实现数据库连接列表
 */
export class DatabaseTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  > = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    vscode.TreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private databaseProvider: DatabaseProvider;
  private filter: ConnectionFilter;

  constructor(databaseProvider: DatabaseProvider, filter: ConnectionFilter) {
    this.databaseProvider = databaseProvider;
    this.filter = filter;

    // 监听连接变化
    this.databaseProvider.onConnectionsChanged(() => {
      this._onDidChangeTreeData.fire();
    });
  }

  /**
   * 判断连接是本地还是云端
   */
  private isLocalConnection(connection: any): boolean {
    // 如果是 oceanbase-cloud 类型，肯定是云端
    if (connection.type === "oceanbase-cloud") {
      return false;
    }
    // 判断 host 是否为本地地址
    const localHosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
    return localHosts.includes(connection.host?.toLowerCase() || "");
  }

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
      // 根节点：返回该分组下的连接
      const connections = this.databaseProvider.getConnections();
      const filteredConnections = connections.filter((conn) =>
        this.filter === "cloud"
          ? !this.isLocalConnection(conn)
          : this.isLocalConnection(conn),
      );

      // 设置上下文变量，用于控制 welcome 内容的显示
      const contextKey =
        this.filter === "cloud"
          ? "seekdb.cloudConnectionsEmpty"
          : "seekdb.localConnectionsEmpty";
      vscode.commands.executeCommand(
        "setContext",
        contextKey,
        filteredConnections.length === 0,
      );

      // 如果没有连接，返回空数组让 viewsWelcome 显示
      if (filteredConnections.length === 0) {
        return [];
      }

      return filteredConnections.map((conn) => this.createConnectionItem(conn));
    }

    // 尝试从自定义属性获取数据（连接项）
    const data = (element as any).connectionData as TreeItemData | undefined;

    if (data && data.type === TreeItemType.Connection) {
      // 连接节点：如果是 seekdb 且已连接，返回数据库列表
      const connection = this.databaseProvider
        .getConnections()
        .find((c) => c.id === data.id);
      if (connection && connection.type === "seekdb" && connection.connected) {
        try {
          const databases = await this.databaseProvider.getServerDatabases(
            data.id,
          );
          return databases.map((db) =>
            this.createDatabaseItem(
              db,
              data.id,
              connection.database === db.name,
            ),
          );
        } catch (error) {
          // 如果获取失败，返回空数组
          return [];
        }
      }
      return [];
    }

    return [];
  }

  /**
   * 创建连接项
   */
  private createConnectionItem(connection: any): vscode.TreeItem {
    const label = connection.name || `${connection.host}:${connection.port}`;
    const item = new vscode.TreeItem(
      label,
      connection.type === "seekdb" && connection.connected
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    // 设置 contextValue，用于菜单识别
    const contextValue = connection.connected
      ? "connection-connected"
      : "connection-disconnected";
    item.contextValue = contextValue;

    // 将连接数据存储在 item 的自定义属性中，供命令使用
    const data: TreeItemData = {
      type: TreeItemType.Connection,
      id: connection.id,
    };
    (item as any).connectionId = connection.id;
    (item as any).connectionData = data;

    // 设置图标
    if (connection.type === "seekdb") {
      item.iconPath = new vscode.ThemeIcon("database");
    } else if (connection.type === "oceanbase-cloud") {
      item.iconPath = new vscode.ThemeIcon("cloud");
    } else {
      item.iconPath = new vscode.ThemeIcon("server");
    }

    // 设置描述
    let description = connection.connected ? "connected" : "stopped";
    item.description = description;

    // 设置工具提示
    item.tooltip = new vscode.MarkdownString();
    item.tooltip.appendMarkdown(`**${label}**\n\n`);
    item.tooltip.appendMarkdown(`Host: ${connection.host}\n`);
    item.tooltip.appendMarkdown(`Port: ${connection.port}\n`);
    if (connection.database) {
      item.tooltip.appendMarkdown(`Database: ${connection.database}\n`);
    }
    if (connection.tenant) {
      item.tooltip.appendMarkdown(`Tenant: ${connection.tenant}\n`);
    }
    item.tooltip.appendMarkdown(
      `Status: ${connection.connected ? "Connected" : "Disconnected"}`,
    );

    return item;
  }

  /**
   * 创建数据库项
   */
  private createDatabaseItem(
    database: any,
    connectionId: string,
    isSelected: boolean,
  ): vscode.TreeItem {
    const item = new vscode.TreeItem(
      database.name,
      vscode.TreeItemCollapsibleState.None,
    );

    item.contextValue = "database";

    // 存储数据库信息
    const data: TreeItemData = {
      type: TreeItemType.Database,
      id: database.name,
      connectionId,
    };
    (item as any).databaseData = data;

    item.iconPath = new vscode.ThemeIcon("database");
    item.description = `${database.charset} / ${database.collation}`;

    if (isSelected) {
      item.description = `✓ ${item.description}`;
    }

    item.command = {
      command: "seekdb.selectDatabase",
      title: "Select Database",
      arguments: [connectionId, database.name],
    };

    return item;
  }

  /**
   * 刷新树视图
   */
  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}
