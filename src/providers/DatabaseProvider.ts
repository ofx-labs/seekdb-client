import * as vscode from "vscode";
import {
  SeekDBAdminClient,
  SeekDBClient,
  Database,
  SeekDBError,
  SeekDBConnectionError,
  SeekDBNotFoundError,
  DEFAULT_TENANT,
  DEFAULT_PORT,
  DEFAULT_USER,
  DEFAULT_DATABASE,
} from "seekdb";
import {
  EmbeddingServiceFactory,
  cosineSimilarity,
  EmbeddingService,
} from "../services/embedding/EmbeddingService";
import { WebviewHtmlLoader } from "../utils/WebviewHtmlLoader";

/**
 * 数据库连接接口
 */
interface DatabaseConnection {
  id: string;
  name: string;
  type: string;
  host: string;
  port: number;
  user: string;
  password?: string;
  database?: string;
  tenant?: string;
  connected: boolean;
}

/**
 * SeekDB 客户端实例管理
 */
interface SeekDBClientInstance {
  adminClient: SeekDBAdminClient;
  client?: SeekDBClient;
}

/**
 * 数据库信息（从服务器获取）
 */
interface DatabaseInfo {
  name: string;
  tenant: string | null;
  charset: string;
  collation: string;
}

/**
 * 集合信息
 */
interface CollectionInfo {
  name: string;
  type: string;
  rows?: number;
  engine?: string;
}

/**
 * 查询结果
 */
interface QueryResultData {
  columns: { name: string; type: string }[];
  rows: Record<string, any>[];
  rowCount: number;
  executionTime: string;
}

/**
 * 警告信息
 */
interface WarningMessage {
  type: "warning" | "info" | "error";
  message: string;
  timestamp: Date;
}

/**
 * DatabaseProvider - 管理数据库连接WebviewPanel
 */
export class DatabaseProvider {
  private panel: vscode.WebviewPanel | undefined;
  private collectionPanels: Map<string, vscode.WebviewPanel> = new Map();
  private connections: DatabaseConnection[] = [];
  private onConnectionsChangedCallback?: (
    connections: DatabaseConnection[]
  ) => void;

  // SeekDB 客户端实例管理
  private seekdbClients: Map<string, SeekDBClientInstance> = new Map();
  // 警告信息缓存
  private warnings: WarningMessage[] = [];
  // 向量化服务实例
  private embeddingService: EmbeddingService | null = null;
  // 向量缓存：key 为文本内容的 hash，value 为向量
  private embeddingCache: Map<string, number[]> = new Map();
  // 向量缓存的最大大小（防止内存溢出）
  private readonly MAX_CACHE_SIZE = 10000;
  // Webview HTML 加载器
  private htmlLoader: WebviewHtmlLoader;

  constructor(private readonly context: vscode.ExtensionContext) {
    // 初始化 HTML 加载器
    this.htmlLoader = new WebviewHtmlLoader(context.extensionUri);
    // 从存储中加载已保存的连接
    this.loadConnections();
    // 初始化向量化服务
    this.initializeEmbeddingService();
  }

  /**
   * 初始化向量化服务
   */
  private initializeEmbeddingService(): void {
    try {
      const config = vscode.workspace.getConfiguration("seekdb");
      this.embeddingService = EmbeddingServiceFactory.createFromConfig(config);
    } catch (error) {
      console.error("初始化向量化服务失败:", error);
      // 使用内置服务作为后备
      this.embeddingService = EmbeddingServiceFactory.create("builtin");
    }
  }

  /**
   * 获取 SeekDB AdminClient
   */
  private getSeekDBAdminClient(
    connectionId: string
  ): SeekDBAdminClient | undefined {
    return this.seekdbClients.get(connectionId)?.adminClient;
  }

  /**
   * 获取 SeekDB Client
   */
  private getSeekDBClient(connectionId: string): SeekDBClient | undefined {
    return this.seekdbClients.get(connectionId)?.client;
  }

  /**
   * 创建 SeekDB 客户端实例
   */
  private async createSeekDBClients(
    connection: DatabaseConnection
  ): Promise<SeekDBClientInstance> {
    const adminClient = new SeekDBAdminClient({
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password: connection.password,
      tenant: connection.tenant || DEFAULT_TENANT,
    });

    const client = new SeekDBClient({
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password: connection.password,
      tenant: connection.tenant || DEFAULT_TENANT,
      database: connection.database || DEFAULT_DATABASE,
    });

    return { adminClient, client };
  }

  /**
   * 关闭 SeekDB 客户端
   */
  private async closeSeekDBClients(connectionId: string): Promise<void> {
    const instance = this.seekdbClients.get(connectionId);
    if (instance) {
      try {
        await instance.adminClient.close();
        if (instance.client) {
          await instance.client.close();
        }
      } catch (error) {
        console.error("关闭 SeekDB 客户端失败:", error);
      }
      this.seekdbClients.delete(connectionId);
    }
  }

  /**
   * 添加警告信息
   */
  private addWarning(
    type: "warning" | "info" | "error",
    message: string
  ): void {
    const warning: WarningMessage = {
      type,
      message,
      timestamp: new Date(),
    };
    this.warnings.push(warning);
    // 保留最近 100 条警告
    if (this.warnings.length > 100) {
      this.warnings.shift();
    }
  }

  /**
   * 检查是否为 SeekDB 类型连接
   */
  private isSeekDBConnection(connection: DatabaseConnection): boolean {
    return connection.type === "seekdb";
  }

  /**
   * 设置连接变化回调
   */
  public onConnectionsChanged(
    callback: (connections: DatabaseConnection[]) => void
  ) {
    this.onConnectionsChangedCallback = callback;
  }

  /**
   * 获取所有连接
   */
  public getConnections(): DatabaseConnection[] {
    return this.connections;
  }

  /**
   * 加载已保存的连接
   */
  private loadConnections(): void {
    const saved = this.context.globalState.get<DatabaseConnection[]>(
      "databaseConnections",
      []
    );
    this.connections = saved;
  }

  /**
   * 保存连接
   */
  private saveConnections(): void {
    this.context.globalState.update("databaseConnections", this.connections);
    this.onConnectionsChangedCallback?.(this.connections);
  }

  /**
   * 打开数据库连接页面（新tab）
   */
  public openConnectPage(): void {
    console.log("DatabaseProvider.openConnectPage 被调用");

    // 如果已经有打开的panel，直接显示
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // 创建新的WebviewPanel
    this.panel = vscode.window.createWebviewPanel(
      "databaseConnect",
      "Connect to Server",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      }
    );

    // 设置图标
    this.panel.iconPath = {
      light: vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "light",
        "snippet.svg"
      ),
      dark: vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "dark",
        "snippet.svg"
      ),
    };

    // 从配置获取默认值
    const config = vscode.workspace.getConfiguration("seekdb");
    const defaultConfig = {
      host: config.get("database.defaultHost", "127.0.0.1"),
      port: config.get("database.defaultPort", 2881),
      tenant: config.get("database.defaultTenant", "sys"),
      database: config.get("database.defaultDatabase", "test"),
      user: config.get("database.defaultUser", "root"),
      password: "",
    };

    // 设置HTML内容
    this.panel.webview.html = this.getConnectPageHtml(
      this.panel.webview,
      defaultConfig
    );

    // 处理消息
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      undefined,
      this.context.subscriptions
    );

    // 监听panel关闭
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  /**
   * 处理来自Webview的消息
   */
  private handleMessage(message: any): void {
    switch (message.type) {
      case "connect":
        this.connectDatabase(message.data);
        break;
      case "save":
        this.saveConnection(message.data);
        break;
      case "testConnection":
        this.testConnection(message.data);
        break;
      case "close":
        this.panel?.dispose();
        break;
    }
  }

  /**
   * 连接数据库
   */
  private async connectDatabase(data: any): Promise<void> {
    const connection: DatabaseConnection = {
      id: data.id || Date.now().toString(),
      name: data.connectionName || `${data.type}-${data.host}:${data.port}`,
      type: data.type || "seekdb",
      host: data.host,
      port: data.port,
      user: data.user,
      password: data.password,
      database: data.database,
      tenant: data.tenant,
      connected: false,
    };

    try {
      vscode.window.showInformationMessage(
        `正在连接到 ${data.host}:${data.port}...`
      );

      // 如果是 SeekDB 类型，创建真实连接
      if (this.isSeekDBConnection(connection)) {
        const clients = await this.createSeekDBClients(connection);

        // 测试连接是否成功 - 尝试列出数据库
        try {
          await clients.adminClient.listDatabases(1);
          this.seekdbClients.set(connection.id, clients);
          connection.connected = true;
          this.addWarning("info", `成功连接到 SeekDB: ${connection.name}`);
        } catch (connError) {
          // 关闭失败的连接
          await clients.adminClient.close();
          if (clients.client) {
            await clients.client.close();
          }
          throw connError;
        }
      } else {
        // 非 SeekDB 类型，使用模拟连接
        connection.connected = true;
      }

      // 添加或更新连接
      const existingIndex = this.connections.findIndex((c) => c.id === data.id);
      if (existingIndex >= 0) {
        this.connections[existingIndex] = connection;
      } else {
        this.connections.push(connection);
      }

      this.saveConnections();

      // 发送成功消息
      this.panel?.webview.postMessage({
        type: "connectionSuccess",
        data: connection,
      });

      vscode.window.showInformationMessage(`已成功连接到 ${connection.name}`);
    } catch (error) {
      let errorMessage = String(error);
      if (error instanceof SeekDBConnectionError) {
        errorMessage = `连接失败: 无法连接到服务器 ${data.host}:${data.port}`;
        // 编辑器的右下角弹窗显示如何连接 seekdb，区分mac和 pc
        this.addWarning("error", errorMessage);
      } else if (error instanceof SeekDBError) {
        errorMessage = `SeekDB 错误: ${error.message}`;
        this.addWarning("error", errorMessage);
      }

      vscode.window.showErrorMessage(errorMessage);
      this.panel?.webview.postMessage({
        type: "connectionError",
        data: { error: errorMessage },
      });
    }
  }

  /**
   * 保存连接配置（不连接）
   */
  private saveConnection(data: any): void {
    const connection: DatabaseConnection = {
      id: data.id || Date.now().toString(),
      name: data.connectionName || `${data.type}-${data.host}:${data.port}`,
      type: data.type || "seekdb",
      host: data.host,
      port: data.port,
      user: data.user,
      password: data.password,
      database: data.database,
      tenant: data.tenant,
      connected: false,
    };

    const existingIndex = this.connections.findIndex((c) => c.id === data.id);
    if (existingIndex >= 0) {
      this.connections[existingIndex] = connection;
    } else {
      this.connections.push(connection);
    }

    this.saveConnections();
    vscode.window.showInformationMessage(
      `连接配置 "${connection.name}" 已保存`
    );
  }

  /**
   * 测试连接
   */
  private async testConnection(data: any): Promise<void> {
    vscode.window.showInformationMessage(
      `正在测试连接 ${data.host}:${data.port}...`
    );

    // 如果是 SeekDB 类型，进行真实测试
    if (data.type === "seekdb") {
      try {
        const testClient = new SeekDBAdminClient({
          host: data.host,
          port: data.port || DEFAULT_PORT,
          user: data.user || DEFAULT_USER,
          password: data.password,
          tenant: data.tenant || DEFAULT_TENANT,
        });

        // 尝试列出数据库来测试连接
        await testClient.listDatabases(1);
        await testClient.close();

        this.panel?.webview.postMessage({
          type: "testResult",
          data: { success: true },
        });
        vscode.window.showInformationMessage("连接测试成功！");
      } catch (error) {
        let errorMessage = "连接测试失败";
        if (error instanceof SeekDBConnectionError) {
          errorMessage = `无法连接到服务器: ${data.host}:${data.port}`;
        } else if (error instanceof SeekDBError) {
          errorMessage = `SeekDB 错误: ${error.message}`;
        } else if (error instanceof Error) {
          errorMessage = error.message;
        }

        this.panel?.webview.postMessage({
          type: "testResult",
          data: { success: false, error: errorMessage },
        });
        vscode.window.showErrorMessage(errorMessage);
      }
    } else {
      // 非 SeekDB 类型，使用模拟测试
      setTimeout(() => {
        this.panel?.webview.postMessage({
          type: "testResult",
          data: { success: true },
        });
        vscode.window.showInformationMessage("连接测试成功！");
      }, 1000);
    }
  }

  /**
   * 断开连接
   */
  public async disconnectDatabase(connectionId: string): Promise<void> {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (connection) {
      // 如果是 SeekDB 类型，关闭真实连接
      if (this.isSeekDBConnection(connection)) {
        await this.closeSeekDBClients(connectionId);
        this.addWarning("info", `已断开 SeekDB 连接: ${connection.name}`);
      }

      connection.connected = false;
      this.saveConnections();
      vscode.window.showInformationMessage(`已断开连接 ${connection.name}`);
    }
  }

  /**
   * 删除连接
   */
  public async deleteConnection(connectionId: string): Promise<void> {
    const connection = this.connections.find((c) => c.id === connectionId);

    // 如果是 SeekDB 类型且已连接，先关闭连接
    if (connection && this.isSeekDBConnection(connection)) {
      await this.closeSeekDBClients(connectionId);
    }

    this.connections = this.connections.filter((c) => c.id !== connectionId);
    this.saveConnections();
    vscode.window.showInformationMessage("连接已删除");
  }

  /**
   * 获取服务器上的数据库列表（仅 SeekDB）
   */
  public async getServerDatabases(
    connectionId: string
  ): Promise<DatabaseInfo[]> {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection || !this.isSeekDBConnection(connection)) {
      return [];
    }

    let adminClient = this.getSeekDBAdminClient(connectionId);

    // 如果客户端不存在且连接已标记为已连接，尝试重新创建客户端
    if (!adminClient && connection.connected) {
      try {
        const clients = await this.createSeekDBClients(connection);
        this.seekdbClients.set(connectionId, clients);
        adminClient = clients.adminClient;
        this.addWarning("info", `重新建立 SeekDB 连接: ${connection.name}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.addWarning("error", `重新建立连接失败: ${errorMsg}`);
        return [];
      }
    }

    if (!adminClient) {
      this.addWarning("warning", `连接 ${connection.name} 未建立 AdminClient`);
      return [];
    }

    try {
      const databases = await adminClient.listDatabases();
      return databases.map((db: Database) => ({
        name: db.name,
        tenant: db.tenant,
        charset: db.charset,
        collation: db.collation,
      }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `获取数据库列表失败: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * 创建数据库（仅 SeekDB）
   */
  public async createServerDatabase(
    connectionId: string,
    dbName: string
  ): Promise<void> {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection || !this.isSeekDBConnection(connection)) {
      throw new Error("仅支持 SeekDB 类型连接创建数据库");
    }

    let adminClient = this.getSeekDBAdminClient(connectionId);

    // 如果客户端不存在，尝试重新创建
    if (!adminClient && connection.connected) {
      const clients = await this.createSeekDBClients(connection);
      this.seekdbClients.set(connectionId, clients);
      adminClient = clients.adminClient;
    }

    if (!adminClient) {
      throw new Error("连接未建立");
    }

    try {
      await adminClient.createDatabase(dbName);
      this.addWarning("info", `成功创建数据库: ${dbName}`);
      vscode.window.showInformationMessage(`成功创建数据库: ${dbName}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `创建数据库失败: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * 删除数据库（仅 SeekDB）
   */
  public async deleteServerDatabase(
    connectionId: string,
    dbName: string
  ): Promise<void> {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection || !this.isSeekDBConnection(connection)) {
      throw new Error("仅支持 SeekDB 类型连接删除数据库");
    }

    let adminClient = this.getSeekDBAdminClient(connectionId);

    // 如果客户端不存在，尝试重新创建
    if (!adminClient && connection.connected) {
      const clients = await this.createSeekDBClients(connection);
      this.seekdbClients.set(connectionId, clients);
      adminClient = clients.adminClient;
    }

    if (!adminClient) {
      throw new Error("连接未建立");
    }

    try {
      await adminClient.deleteDatabase(dbName);
      this.addWarning("info", `成功删除数据库: ${dbName}`);
      vscode.window.showInformationMessage(`成功删除数据库: ${dbName}`);
    } catch (error) {
      if (error instanceof SeekDBNotFoundError) {
        this.addWarning("warning", `数据库不存在: ${dbName}`);
      } else {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.addWarning("error", `删除数据库失败: ${errorMsg}`);
      }
      throw error;
    }
  }

  /**
   * 获取数据库详情（仅 SeekDB）
   */
  public async getServerDatabaseInfo(
    connectionId: string,
    dbName: string
  ): Promise<DatabaseInfo | null> {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection || !this.isSeekDBConnection(connection)) {
      return null;
    }

    let adminClient = this.getSeekDBAdminClient(connectionId);

    // 如果客户端不存在，尝试重新创建
    if (!adminClient && connection.connected) {
      try {
        const clients = await this.createSeekDBClients(connection);
        this.seekdbClients.set(connectionId, clients);
        adminClient = clients.adminClient;
      } catch {
        return null;
      }
    }

    if (!adminClient) {
      return null;
    }

    try {
      const db = await adminClient.getDatabase(dbName);
      return {
        name: db.name,
        tenant: db.tenant,
        charset: db.charset,
        collation: db.collation,
      };
    } catch (error) {
      if (error instanceof SeekDBNotFoundError) {
        this.addWarning("warning", `数据库不存在: ${dbName}`);
        return null;
      }
      throw error;
    }
  }

  /**
   * 打开集合查看页面（新tab）
   */
  public openCollectionBrowser(
    connectionId: string,
    collectionName?: string
  ): void {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection) {
      vscode.window.showErrorMessage("未找到数据库连接");
      return;
    }

    // 检查是否已有该连接的集合浏览器
    const existingPanel = this.collectionPanels.get(connectionId);
    if (existingPanel) {
      existingPanel.reveal(vscode.ViewColumn.One);
      // 如果指定了collectionName，加载该collection的数据
      if (collectionName) {
        setTimeout(() => {
          existingPanel.webview.postMessage({
            type: "loadCollectionByName",
            data: { collectionName },
          });
        }, 200);
      }
      return;
    }

    // 创建新的WebviewPanel
    const panel = vscode.window.createWebviewPanel(
      "databaseCollectionBrowser",
      `${connection.name} - Collections`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      }
    );

    // 设置图标
    panel.iconPath = {
      light: vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "light",
        "snippet.svg"
      ),
      dark: vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "dark",
        "snippet.svg"
      ),
    };

    // 设置HTML内容
    panel.webview.html = this.getCollectionBrowserHtml(
      panel.webview,
      connection
    );

    // 保存panel引用
    this.collectionPanels.set(connectionId, panel);

    // 处理消息
    panel.webview.onDidReceiveMessage(
      (message) =>
        this.handleCollectionBrowserMessage(message, panel, connection),
      undefined,
      this.context.subscriptions
    );

    // 监听panel关闭
    panel.onDidDispose(() => {
      this.collectionPanels.delete(connectionId);
    });

    // 如果是 SeekDB 连接，立即加载真实集合列表
    if (this.isSeekDBConnection(connection)) {
      // 延迟一点确保 webview 已完全加载
      setTimeout(async () => {
        await this.refreshCollections(panel, connection);
        // 如果指定了collectionName，加载该collection的数据
        if (collectionName) {
          setTimeout(() => {
            panel.webview.postMessage({
              type: "loadCollectionByName",
              data: { collectionName },
            });
          }, 300);
        }
      }, 100);
    }
  }

  /**
   * 打开集合浏览器并加载指定的collection（让用户选择connection）
   */
  public async openCollectionBrowserWithCollection(
    collectionName: string
  ): Promise<void> {
    // 获取所有已连接的连接
    const connectedConnections = this.connections.filter((c) => c.connected);

    if (connectedConnections.length === 0) {
      vscode.window.showWarningMessage(
        "没有已连接的数据库连接，请先连接数据库"
      );
      return;
    }

    // 如果只有一个连接，直接使用
    if (connectedConnections.length === 1) {
      this.openCollectionBrowser(connectedConnections[0].id, collectionName);
      return;
    }

    // 多个连接，让用户选择
    const items = connectedConnections.map((conn) => ({
      label: conn.name,
      description: `${conn.type} - ${conn.host}:${conn.port}`,
      connection: conn,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `选择数据库连接以查看 Collection: ${collectionName}`,
    });

    if (selected) {
      this.openCollectionBrowser(selected.connection.id, collectionName);
    }
  }

  /**
   * 处理集合浏览器消息
   */
  private async handleCollectionBrowserMessage(
    message: any,
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection
  ): Promise<void> {
    switch (message.type) {
      case "executeQuery":
        await this.executeQuery(message.data.sql, panel, connection);
        break;
      case "loadCollectionData":
        await this.loadCollectionData(
          message.data.collectionName,
          panel,
          connection
        );
        break;
      case "refreshCollections":
        await this.refreshCollections(panel, connection);
        break;
      case "loadDatabases":
        await this.handleLoadDatabases(panel, connection);
        break;
      case "selectDatabase":
        await this.handleSelectDatabase(
          message.data.database,
          panel,
          connection
        );
        break;
      case "createDatabase":
        await this.handleCreateDatabase(message.data.name, panel, connection);
        break;
      case "deleteDatabase":
        await this.handleDeleteDatabase(message.data.name, panel, connection);
        break;
      case "getWarnings":
        panel.webview.postMessage({
          type: "warnings",
          data: { warnings: this.getWarnings() },
        });
        break;
      case "vectorSearch":
        await this.handleVectorSearch(message.data, panel, connection);
        break;
    }
  }

  /**
   * 处理加载数据库列表
   */
  private async handleLoadDatabases(
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection
  ): Promise<void> {
    if (this.isSeekDBConnection(connection)) {
      try {
        const databases = await this.getServerDatabases(connection.id);
        panel.webview.postMessage({
          type: "databasesList",
          data: { databases },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        panel.webview.postMessage({
          type: "databasesError",
          data: { error: errorMsg },
        });
      }
    }
  }

  /**
   * 处理选择数据库
   */
  private async handleSelectDatabase(
    dbName: string,
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection
  ): Promise<void> {
    // 更新连接的数据库
    const connIndex = this.connections.findIndex((c) => c.id === connection.id);
    if (connIndex >= 0) {
      this.connections[connIndex].database = dbName;
      connection.database = dbName;
      this.saveConnections();

      // 重新创建客户端
      if (this.isSeekDBConnection(connection)) {
        await this.closeSeekDBClients(connection.id);
        const clients = await this.createSeekDBClients(connection);
        this.seekdbClients.set(connection.id, clients);
      }

      // 刷新集合列表
      await this.refreshCollections(panel, connection);
      this.addWarning("info", `已切换到数据库: ${dbName}`);
    }
  }

  /**
   * 为连接选择数据库（公共方法，用于从外部切换数据库）
   * 如果该连接有已打开的 Collection Browser panel，会自动刷新
   */
  public async selectDatabaseForConnection(
    connectionId: string,
    dbName: string
  ): Promise<void> {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection) {
      throw new Error(`未找到连接: ${connectionId}`);
    }

    // 更新连接的数据库
    const connIndex = this.connections.findIndex((c) => c.id === connectionId);
    if (connIndex >= 0) {
      this.connections[connIndex].database = dbName;
      connection.database = dbName;
      this.saveConnections();

      // 重新创建客户端
      if (this.isSeekDBConnection(connection)) {
        await this.closeSeekDBClients(connection.id);
        const clients = await this.createSeekDBClients(connection);
        this.seekdbClients.set(connection.id, clients);
      }

      // 如果该连接有已打开的 Collection Browser panel，刷新集合列表
      const existingPanel = this.collectionPanels.get(connectionId);
      if (existingPanel) {
        await this.refreshCollections(existingPanel, connection);
      }
    }
  }

  /**
   * 处理创建数据库
   */
  private async handleCreateDatabase(
    dbName: string,
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection
  ): Promise<void> {
    try {
      await this.createServerDatabase(connection.id, dbName);
      // 刷新数据库列表
      await this.handleLoadDatabases(panel, connection);
      panel.webview.postMessage({
        type: "databaseCreated",
        data: { name: dbName },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      panel.webview.postMessage({
        type: "databaseError",
        data: { error: errorMsg },
      });
    }
  }

  /**
   * 处理删除数据库
   */
  private async handleDeleteDatabase(
    dbName: string,
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection
  ): Promise<void> {
    try {
      await this.deleteServerDatabase(connection.id, dbName);
      // 刷新数据库列表
      await this.handleLoadDatabases(panel, connection);
      panel.webview.postMessage({
        type: "databaseDeleted",
        data: { name: dbName },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      panel.webview.postMessage({
        type: "databaseError",
        data: { error: errorMsg },
      });
    }
  }

  /**
   * 执行SQL查询
   */
  private async executeQuery(
    sql: string,
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection
  ): Promise<void> {
    const startTime = Date.now();

    // 如果是 SeekDB 类型，执行真实查询
    if (this.isSeekDBConnection(connection)) {
      try {
        const result = await this.executeSeekDBQuery(connection.id, sql);
        const executionTime = ((Date.now() - startTime) / 1000).toFixed(3);

        panel.webview.postMessage({
          type: "queryResult",
          data: {
            ...result,
            executionTime: `${executionTime}s`,
          },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.addWarning("error", `SQL 执行失败: ${errorMsg}`);
        panel.webview.postMessage({
          type: "queryError",
          data: { error: errorMsg },
        });
      }
    } else {
      // 非 SeekDB 类型，使用模拟数据
      const mockData = this.getMockQueryResult(sql);
      panel.webview.postMessage({
        type: "queryResult",
        data: mockData,
      });
    }
  }

  /**
   * 执行 SeekDB SQL 查询
   */
  private async executeSeekDBQuery(
    connectionId: string,
    sql: string
  ): Promise<QueryResultData> {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection) {
      throw new Error("连接不存在");
    }

    // 创建临时客户端来执行查询
    const tempClient = new SeekDBClient({
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password: connection.password,
      tenant: connection.tenant || DEFAULT_TENANT,
      database: connection.database || DEFAULT_DATABASE,
    });

    try {
      // 使用 mysql2 直接执行 SQL
      // SeekDBClient 内部使用 mysql2，我们通过创建新连接来执行原始 SQL
      const mysql = await import("mysql2/promise");
      const conn = await mysql.createConnection({
        host: connection.host,
        port: connection.port,
        user: `${connection.user}@${connection.tenant || DEFAULT_TENANT}`,
        password: connection.password,
        database: connection.database || DEFAULT_DATABASE,
      });

      const [rows, fields] = await conn.execute(sql);
      await conn.end();

      // 解析结果
      const columns = (fields as any[]).map((field: any) => ({
        name: field.name,
        type: this.mysqlTypeToString(field.type, field.length),
      }));

      const resultRows = Array.isArray(rows) ? (rows as any[]) : [];

      return {
        columns,
        rows: resultRows,
        rowCount: resultRows.length,
        executionTime: "0s",
      };
    } catch (error) {
      throw error;
    } finally {
      await tempClient.close();
    }
  }

  /**
   * MySQL 类型转字符串
   */
  private mysqlTypeToString(type: number, length?: number): string {
    // MySQL 类型常量映射
    const typeMap: Record<number, string> = {
      0: "DECIMAL",
      1: "TINYINT",
      2: "SMALLINT",
      3: "INT",
      4: "FLOAT",
      5: "DOUBLE",
      6: "NULL",
      7: "TIMESTAMP",
      8: "BIGINT",
      9: "MEDIUMINT",
      10: "DATE",
      11: "TIME",
      12: "DATETIME",
      13: "YEAR",
      14: "NEWDATE",
      15: "VARCHAR",
      16: "BIT",
      245: "JSON",
      246: "NEWDECIMAL",
      247: "ENUM",
      248: "SET",
      249: "TINY_BLOB",
      250: "MEDIUM_BLOB",
      251: "LONG_BLOB",
      252: "BLOB",
      253: "VAR_STRING",
      254: "STRING",
      255: "GEOMETRY",
    };

    const typeName = typeMap[type] || "UNKNOWN";
    if (length && (typeName === "VARCHAR" || typeName === "VAR_STRING")) {
      return `${typeName}(${length})`;
    }
    return typeName;
  }

  /**
   * 加载集合数据
   */
  private async loadCollectionData(
    collectionName: string,
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection
  ): Promise<void> {
    if (this.isSeekDBConnection(connection)) {
      try {
        // 构建 SELECT 查询
        const sql = `SELECT * FROM \`${collectionName}\` LIMIT 1000`;
        const result = await this.executeSeekDBQuery(connection.id, sql);

        panel.webview.postMessage({
          type: "collectionData",
          data: {
            collectionName,
            ...result,
          },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.addWarning("error", `加载集合数据失败: ${errorMsg}`);
        panel.webview.postMessage({
          type: "queryError",
          data: { error: errorMsg },
        });
      }
    } else {
      // 非 SeekDB 类型，使用模拟数据
      const mockData = this.getMockCollectionData(collectionName);
      panel.webview.postMessage({
        type: "collectionData",
        data: {
          collectionName,
          ...mockData,
        },
      });
    }
  }

  /**
   * 刷新集合列表
   */
  private async refreshCollections(
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection
  ): Promise<void> {
    if (this.isSeekDBConnection(connection)) {
      try {
        const collections = await this.getSeekDBCollections(connection);
        panel.webview.postMessage({
          type: "collectionsList",
          data: { collections },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.addWarning("error", `获取集合列表失败: ${errorMsg}`);
        panel.webview.postMessage({
          type: "collectionsError",
          data: { error: errorMsg },
        });
      }
    } else {
      // 非 SeekDB 类型，使用模拟数据
      const mockCollections = this.getMockCollections();
      panel.webview.postMessage({
        type: "collectionsList",
        data: { collections: mockCollections },
      });
    }
  }

  /**
   * 获取 SeekDB 集合列表
   */
  private async getSeekDBCollections(
    connection: DatabaseConnection
  ): Promise<CollectionInfo[]> {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.createConnection({
      host: connection.host,
      port: connection.port,
      user: `${connection.user}@${connection.tenant || DEFAULT_TENANT}`,
      password: connection.password,
      database: connection.database || DEFAULT_DATABASE,
    });

    try {
      const [rows] = await conn.execute("SHOW TABLES");
      const collections = (rows as any[]).map((row: any) => {
        const collectionName = Object.values(row)[0] as string;
        return {
          name: collectionName,
          type: "collection",
        };
      });

      return collections;
    } finally {
      await conn.end();
    }
  }

  /**
   * 获取模拟的集合列表
   */
  private getMockCollections(): CollectionInfo[] {
    return [
      { name: "ADMINISTRABLE_ROLE_AUTHORIZATIONS", type: "collection" },
      { name: "APPLICABLE_ROLES", type: "collection" },
      { name: "CHARACTER_SETS", type: "collection" },
      { name: "CHECK_CONSTRAINTS", type: "collection" },
      { name: "COLLATION_CHARACTER_SET_APPLICABILITY", type: "collection" },
      { name: "COLLATIONS", type: "collection" },
      { name: "COLUMN_PRIVILEGES", type: "collection" },
      { name: "COLUMN_STATISTICS", type: "collection" },
      { name: "COLUMNS", type: "collection" },
      { name: "COLUMNS_EXTENSIONS", type: "collection" },
      { name: "ENABLED_ROLES", type: "collection" },
      { name: "ENGINES", type: "collection" },
      { name: "EVENTS", type: "collection" },
      { name: "FILES", type: "collection" },
    ];
  }

  /**
   * 获取模拟的查询结果
   */
  private getMockQueryResult(sql: string): QueryResultData {
    return {
      columns: [
        { name: "COLLATION_NAME", type: "varchar(64)" },
        { name: "CHARACTER_SET_NAME", type: "varchar(64)" },
      ],
      rows: [
        {
          COLLATION_NAME: "armscii8_general_ci",
          CHARACTER_SET_NAME: "armscii8",
        },
        { COLLATION_NAME: "armscii8_bin", CHARACTER_SET_NAME: "armscii8" },
        { COLLATION_NAME: "ascii_general_ci", CHARACTER_SET_NAME: "ascii" },
        { COLLATION_NAME: "ascii_bin", CHARACTER_SET_NAME: "ascii" },
        { COLLATION_NAME: "big5_chinese_ci", CHARACTER_SET_NAME: "big5" },
        { COLLATION_NAME: "big5_bin", CHARACTER_SET_NAME: "big5" },
        { COLLATION_NAME: "binary", CHARACTER_SET_NAME: "binary" },
        { COLLATION_NAME: "cp1250_general_ci", CHARACTER_SET_NAME: "cp1250" },
      ],
      rowCount: 8,
      executionTime: "0.023s",
    };
  }

  /**
   * 获取模拟的集合数据
   */
  private getMockCollectionData(collectionName: string): QueryResultData {
    return {
      columns: [
        { name: "id", type: "int" },
        { name: "name", type: "varchar(255)" },
        { name: "created_at", type: "datetime" },
      ],
      rows: [
        { id: 1, name: "Record 1", created_at: "2024-01-01 10:00:00" },
        { id: 2, name: "Record 2", created_at: "2024-01-02 11:00:00" },
        { id: 3, name: "Record 3", created_at: "2024-01-03 12:00:00" },
      ],
      rowCount: 3,
      executionTime: "0s",
    };
  }

  /**
   * 获取警告信息
   */
  public getWarnings(): WarningMessage[] {
    return [...this.warnings];
  }

  /**
   * 清空警告信息
   */
  public clearWarnings(): void {
    this.warnings = [];
  }

  /**
   * 计算文本的哈希值（用于缓存键）
   */
  private hashText(text: string): string {
    // 使用简单的哈希算法生成缓存键
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `embed_${Math.abs(hash).toString(36)}_${text.length}`;
  }

  /**
   * 更新向量缓存（带大小限制）
   */
  private updateCache(key: string, vector: number[]): void {
    // 如果缓存已满，删除最旧的条目（简单策略：删除第一个）
    if (this.embeddingCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.embeddingCache.keys().next().value;
      if (firstKey) {
        this.embeddingCache.delete(firstKey);
      }
    }
    this.embeddingCache.set(key, vector);
  }

  /**
   * 处理向量相似度搜索
   */
  private async handleVectorSearch(
    data: {
      query: string;
      collectionName: string;
      limit?: number;
      embeddingType?: "openai" | "builtin" | "ollama" | "anthropic" | "qwen";
      apiKey?: string;
    },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const { query, collectionName, limit = 10, embeddingType, apiKey } = data;

      if (!query || !query.trim()) {
        panel.webview.postMessage({
          type: "vectorSearchError",
          data: { error: "查询文本不能为空" },
        });
        return;
      }

      if (!this.isSeekDBConnection(connection)) {
        panel.webview.postMessage({
          type: "vectorSearchError",
          data: { error: "向量搜索仅支持 SeekDB 连接" },
        });
        return;
      }

      // 创建或获取向量化服务
      let embeddingService = this.embeddingService;
      if (embeddingType && embeddingType !== "builtin") {
        // 如果指定了外部模型，从配置创建服务实例
        const config = vscode.workspace.getConfiguration(
          "seekdb.database.embedding"
        );

        switch (embeddingType) {
          case "openai": {
            const openaiApiKey =
              apiKey || config.get<string>("openaiApiKey", "");
            const openaiBaseUrl = config.get<string>(
              "openaiBaseUrl",
              "https://api.openai.com/v1"
            );
            embeddingService = EmbeddingServiceFactory.create("openai", {
              apiKey: openaiApiKey,
              baseUrl: openaiBaseUrl,
            });
            break;
          }
          case "ollama": {
            const ollamaBaseUrl = config.get<string>(
              "ollamaBaseUrl",
              "http://localhost:11434"
            );
            const ollamaModel = config.get<string>(
              "ollamaModel",
              "nomic-embed-text"
            );
            embeddingService = EmbeddingServiceFactory.create("ollama", {
              ollamaBaseUrl,
              ollamaModel,
            });
            break;
          }
          case "anthropic": {
            const anthropicApiKey =
              apiKey || config.get<string>("anthropicApiKey", "");
            const anthropicBaseUrl = config.get<string>(
              "anthropicBaseUrl",
              "https://api.anthropic.com"
            );
            embeddingService = EmbeddingServiceFactory.create("anthropic", {
              apiKey: anthropicApiKey,
              baseUrl: anthropicBaseUrl,
            });
            break;
          }
          case "qwen": {
            const qwenApiKey = apiKey || config.get<string>("qwenApiKey", "");
            const qwenBaseUrl = config.get<string>(
              "qwenBaseUrl",
              "https://dashscope.aliyuncs.com"
            );
            embeddingService = EmbeddingServiceFactory.create("qwen", {
              apiKey: qwenApiKey,
              baseUrl: qwenBaseUrl,
            });
            break;
          }
          default:
            throw new Error(`不支持的向量化类型: ${embeddingType}`);
        }
      }

      if (!embeddingService) {
        // 使用配置中的默认设置创建服务
        embeddingService = EmbeddingServiceFactory.createFromConfig(
          vscode.workspace.getConfiguration("seekdb.database")
        );
      }

      // 将查询文本转换为向量（使用缓存）
      const queryText = query.trim();
      const queryHash = this.hashText(queryText);
      let queryVector = this.embeddingCache.get(queryHash);

      if (!queryVector) {
        vscode.window.showInformationMessage("正在向量化查询文本...");
        queryVector = await embeddingService.embed(queryText);
        this.updateCache(queryHash, queryVector);
      }

      // 从集合中获取数据
      const sql = `SELECT * FROM \`${collectionName}\` LIMIT 1000`;
      const collectionData = await this.executeSeekDBQuery(connection.id, sql);

      if (!collectionData.rows || collectionData.rows.length === 0) {
        panel.webview.postMessage({
          type: "vectorSearchResult",
          data: {
            query,
            results: [],
            executionTime: `${((Date.now() - startTime) / 1000).toFixed(3)}s`,
          },
        });
        return;
      }

      // 检查是否有预存的向量字段（常见的向量字段名）
      const vectorFieldNames = ["_vector", "embedding", "vector", "embeddings"];
      let vectorFieldName: string | null = null;

      // 检查第一行数据是否有向量字段
      if (collectionData.rows.length > 0) {
        const firstRow = collectionData.rows[0];
        for (const fieldName of vectorFieldNames) {
          if (
            firstRow[fieldName] !== undefined &&
            firstRow[fieldName] !== null
          ) {
            // 检查是否是数组格式的向量
            const vectorValue = firstRow[fieldName];
            if (
              Array.isArray(vectorValue) &&
              vectorValue.length > 0 &&
              typeof vectorValue[0] === "number"
            ) {
              vectorFieldName = fieldName;
              break;
            }
            // 检查是否是 JSON 字符串格式的向量
            if (typeof vectorValue === "string") {
              try {
                const parsed = JSON.parse(vectorValue);
                if (
                  Array.isArray(parsed) &&
                  parsed.length > 0 &&
                  typeof parsed[0] === "number"
                ) {
                  vectorFieldName = fieldName;
                  break;
                }
              } catch {
                // 不是 JSON，继续检查下一个字段
              }
            }
          }
        }
      }

      // 对每一行数据进行向量化和相似度计算（并行处理）
      const results: Array<{
        row: Record<string, any>;
        similarity: number;
      }> = [];

      const totalRows = collectionData.rows.length;
      let cacheHits = 0;
      let cacheMisses = 0;
      let vectorFieldUsed = 0;

      if (vectorFieldName) {
        vscode.window.showInformationMessage(
          `检测到向量字段 "${vectorFieldName}"，直接使用存储的向量进行计算...`
        );
      } else {
        vscode.window.showInformationMessage(
          `未检测到向量字段，正在并行处理 ${totalRows} 行数据的向量化...`
        );
      }

      // 准备所有行的文本和向量化任务
      const rowTasks = collectionData.rows.map(async (row) => {
        try {
          let rowVector: number[] | null = null;

          // 如果存在向量字段，直接使用
          if (
            vectorFieldName &&
            row[vectorFieldName] !== undefined &&
            row[vectorFieldName] !== null
          ) {
            const vectorValue = row[vectorFieldName];

            if (Array.isArray(vectorValue)) {
              // 已经是数组格式
              rowVector = vectorValue;
              vectorFieldUsed++;
            } else if (typeof vectorValue === "string") {
              // 尝试解析 JSON 字符串
              try {
                const parsed = JSON.parse(vectorValue);
                if (Array.isArray(parsed)) {
                  rowVector = parsed;
                  vectorFieldUsed++;
                }
              } catch {
                // 解析失败，继续使用文本向量化
              }
            }
          }

          // 如果没有向量字段或解析失败，进行文本向量化
          if (!rowVector) {
            // 将行数据转换为文本（选择所有文本字段，排除向量字段）
            const textFields: string[] = [];
            for (const [key, value] of Object.entries(row)) {
              // 跳过向量字段
              if (vectorFieldNames.includes(key.toLowerCase())) {
                continue;
              }

              if (
                value !== null &&
                value !== undefined &&
                typeof value === "string"
              ) {
                textFields.push(value);
              } else if (typeof value === "object") {
                textFields.push(JSON.stringify(value));
              } else {
                textFields.push(String(value));
              }
            }
            const rowText = textFields.join(" ");

            // 检查缓存
            const textHash = this.hashText(rowText);
            rowVector = this.embeddingCache.get(textHash) || null;

            // 如果缓存中没有，进行向量化并缓存
            if (!rowVector) {
              cacheMisses++;
              rowVector = await embeddingService.embed(rowText);
              // 更新缓存（如果缓存已满，删除最旧的条目）
              this.updateCache(textHash, rowVector);
            } else {
              cacheHits++;
            }
          }

          // 计算相似度
          const similarity = cosineSimilarity(queryVector, rowVector);

          return {
            row,
            similarity,
          };
        } catch (error) {
          console.error("处理行数据时出错:", error);
          // 返回 null 表示跳过此行
          return null;
        }
      });

      // 并行执行所有向量化任务
      const rowResults = await Promise.all(rowTasks);

      // 过滤掉 null 值（出错的行）
      for (const result of rowResults) {
        if (result !== null) {
          results.push(result);
        }
      }

      // 记录统计信息（仅在开发模式下输出）
      if (vectorFieldName) {
        console.log(
          `向量搜索统计: 使用存储的向量字段 "${vectorFieldName}"，共 ${vectorFieldUsed} 条记录`
        );
      } else if (cacheHits > 0 || cacheMisses > 0) {
        const hitRate = ((cacheHits / (cacheHits + cacheMisses)) * 100).toFixed(
          1
        );
        console.log(
          `向量搜索缓存统计: 命中 ${cacheHits} 次, 未命中 ${cacheMisses} 次, 命中率 ${hitRate}%`
        );
      }

      // 按相似度排序
      results.sort((a, b) => b.similarity - a.similarity);

      // 取前 limit 条结果
      const topResults = results.slice(0, limit);

      // 获取搜索使用的模型名称
      const searchModelName = embeddingService.getModelName();

      // 推断 collection 使用的模型（如果有向量字段，尝试从元数据推断，否则为 null）
      let collectionModelName: string | null = null;
      if (vectorFieldName) {
        // 如果有向量字段，尝试从数据中推断模型
        // 可以通过向量维度来推断：384维通常是 all-MiniLM-L6-v2，1536维通常是 OpenAI text-embedding-3-small
        if (collectionData.rows.length > 0) {
          const firstRow = collectionData.rows[0];
          const vectorValue = firstRow[vectorFieldName];
          let vectorLength = 0;

          if (Array.isArray(vectorValue)) {
            vectorLength = vectorValue.length;
          } else if (typeof vectorValue === "string") {
            try {
              const parsed = JSON.parse(vectorValue);
              if (Array.isArray(parsed)) {
                vectorLength = parsed.length;
              }
            } catch {
              // 解析失败
            }
          }

          // 根据向量维度推断模型
          if (vectorLength === 384) {
            collectionModelName = "Builtin (Xenova/all-MiniLM-L6-v2)";
          } else if (vectorLength === 1536) {
            collectionModelName = "OpenAI text-embedding-3-small";
          } else if (vectorLength === 3072) {
            collectionModelName = "OpenAI text-embedding-3-large";
          } else if (vectorLength > 0) {
            collectionModelName = `Unknown (${vectorLength}维)`;
          } else {
            collectionModelName = "Unknown";
          }
        }
      } else {
        // 没有向量字段，说明数据还未向量化
        collectionModelName = null;
      }

      // 构建结果数据
      const resultData: QueryResultData = {
        columns: [
          ...collectionData.columns,
          { name: "similarity", type: "FLOAT" },
        ],
        rows: topResults.map((r) => ({
          ...r.row,
          similarity: r.similarity,
        })),
        rowCount: topResults.length,
        executionTime: `${((Date.now() - startTime) / 1000).toFixed(3)}s`,
      };

      panel.webview.postMessage({
        type: "vectorSearchResult",
        data: {
          query,
          ...resultData,
          // 添加模型信息
          collectionModelName,
          searchModelName,
        },
      });

      vscode.window.showInformationMessage(
        `向量搜索完成，找到 ${topResults.length} 条相似结果`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `向量搜索失败: ${errorMsg}`);
      panel.webview.postMessage({
        type: "vectorSearchError",
        data: { error: errorMsg },
      });
      vscode.window.showErrorMessage(`向量搜索失败: ${errorMsg}`);
    }
  }

  /**
   * 生成集合浏览器页面HTML
   * 使用 React 组件渲染，从构建产物加载
   */
  private getCollectionBrowserHtml(
    webview: vscode.Webview,
    connection: DatabaseConnection
  ): string {
    const isSeekDB = this.isSeekDBConnection(connection);

    // 注入到页面的配置
    const config = {
      __VSCODE_CONNECTION_INFO__: {
        name: connection.name,
        host: connection.host,
        port: connection.port,
        database: connection.database,
      },
      __VSCODE_IS_SEEKDB__: isSeekDB,
    };

    return this.htmlLoader.loadPage(webview, "CollectionBrowserPage", config);
  }

  /**
   * 生成连接页面HTML
   * 使用 React 组件渲染，从构建产物加载
   */
  private getConnectPageHtml(
    webview: vscode.Webview,
    defaultConfig: any
  ): string {
    // 注入到页面的配置
    const config = {
      __VSCODE_DEFAULT_CONFIG__: defaultConfig,
    };

    return this.htmlLoader.loadPage(webview, "ConnectPage", config);
  }
}
