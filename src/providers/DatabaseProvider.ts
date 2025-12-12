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

  constructor(private readonly context: vscode.ExtensionContext) {
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
   */
  private getCollectionBrowserHtml(
    webview: vscode.Webview,
    connection: DatabaseConnection
  ): string {
    // SeekDB 连接使用空列表（等待真实数据加载）
    const isSeekDB = this.isSeekDBConnection(connection);
    const initialCollections = isSeekDB ? [] : this.getMockCollections();
    const collectionsJson = JSON.stringify(initialCollections);

    return `
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${connection.name} - Collections</title>
        <style>
          :root {
            --bg-color: var(--vscode-editor-background, #1e1e1e);
            --sidebar-bg: var(--vscode-sideBar-background, #252526);
            --text-color: var(--vscode-foreground, #cccccc);
            --text-muted: var(--vscode-descriptionForeground, #888888);
            --border-color: var(--vscode-panel-border, #3c3c3c);
            --hover-bg: var(--vscode-list-hoverBackground, #2a2d2e);
            --selected-bg: var(--vscode-list-activeSelectionBackground, #094771);
            --header-bg: var(--vscode-editorGroupHeader-tabsBackground, #323233);
            --button-bg: var(--vscode-button-background, #0078d4);
            --button-hover: var(--vscode-button-hoverBackground, #026ec1);
            --success-color: var(--vscode-terminal-ansiGreen, #4ec9b0);
            --warning-color: var(--vscode-editorWarning-foreground, #dcdcaa);
            --type-color: var(--vscode-symbolIcon-typeParameterForeground, #569cd6);
            --input-bg: var(--vscode-input-background, #3c3c3c);
            --input-border: var(--vscode-input-border, #3c3c3c);
            --input-fg: var(--vscode-input-foreground, #cccccc);
          }
          
          * { box-sizing: border-box; margin: 0; padding: 0; }
          
          body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif);
            background: var(--bg-color);
            color: var(--text-color);
            height: 100vh;
            overflow: hidden;
            padding: 0;
          }
          
          .container {
            display: flex;
            height: 100vh;
          }
          
          /* 左侧边栏 - 数据库结构树 */
          .sidebar {
            width: 280px;
            background: var(--sidebar-bg);
            border-right: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          
          .sidebar-header {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            font-weight: 500;
          }
          
          .sidebar-header .icon { font-size: 16px; }
          
          .sidebar-actions {
            display: flex;
            gap: 4px;
            margin-left: auto;
          }
          
          .sidebar-actions button {
            background: none;
            border: none;
            color: var(--text-color);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
          }
          
          .sidebar-actions button:hover {
            background: var(--hover-bg);
          }
          
          .tree-container {
            flex: 1;
            overflow-y: auto;
            padding: 8px 0;
          }
          
          .tree-item {
            display: flex;
            align-items: center;
            padding: 4px 8px 4px 16px;
            cursor: pointer;
            font-size: 13px;
            user-select: none;
          }
          
          .tree-item:hover {
            background: var(--hover-bg);
          }
          
          .tree-item.selected {
            background: var(--selected-bg);
          }
          
          .tree-item .expand-icon {
            width: 16px;
            font-size: 10px;
            color: var(--text-muted);
          }
          
          .tree-item .item-icon {
            margin-right: 6px;
            font-size: 14px;
          }
          
          .tree-item .item-name {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          
          .tree-item.level-1 { padding-left: 24px; }
          .tree-item.level-2 { padding-left: 40px; }
          .tree-item.level-3 { padding-left: 56px; }
          
          .tree-group-header {
            display: flex;
            align-items: center;
            padding: 4px 8px 4px 24px;
            font-size: 12px;
            color: var(--text-muted);
            text-transform: uppercase;
          }
          
          .tree-group-count {
            margin-left: 6px;
            font-size: 11px;
            color: var(--text-muted);
          }
          
          /* 右侧主区域 */
          .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          
          /* 查询编辑器 */
          .query-editor {
            background: var(--sidebar-bg);
            border-bottom: 1px solid var(--border-color);
            padding: 12px;
          }
          
          .query-input {
            width: 100%;
            min-height: 80px;
            background: var(--bg-color);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            color: var(--text-color);
            padding: 12px;
            font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
            font-size: 13px;
            resize: vertical;
          }
          
          .query-input:focus {
            outline: none;
            border-color: var(--button-bg);
          }
          
          .query-actions {
            display: flex;
            gap: 8px;
            margin-top: 8px;
            align-items: center;
          }
          
          .query-actions .btn {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
          }
          
          .btn-primary {
            background: var(--button-bg);
            color: white;
          }
          
          .btn-primary:hover {
            background: var(--button-hover);
          }
          
          .btn-secondary {
            background: var(--header-bg);
            color: var(--text-color);
          }
          
          .btn-secondary:hover {
            background: var(--hover-bg);
          }

          /* 相似度搜索区域 */
          .vector-search {
            background: var(--sidebar-bg);
            border-bottom: 1px solid var(--border-color);
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .vector-search-header {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            font-weight: 500;
            color: var(--text-color);
          }

          .vector-search-header .icon {
            font-size: 16px;
          }

          .vector-search-input-group {
            display: flex;
            gap: 8px;
            align-items: center;
          }

          .vector-search-input {
            flex: 1;
            padding: 8px 12px;
            background: var(--bg-color);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            color: var(--text-color);
            font-size: 13px;
          }

          .vector-search-input:focus {
            outline: none;
            border-color: var(--button-bg);
          }

          .vector-search-input::placeholder {
            color: var(--text-muted);
          }

          .vector-search-options {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
          }

          .vector-search-select {
            padding: 6px 8px;
            background: var(--bg-color);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            color: var(--text-color);
            font-size: 12px;
            cursor: pointer;
          }

          .vector-search-select:focus {
            outline: none;
            border-color: var(--button-bg);
          }

          .vector-search-limit {
            width: 80px;
          }

          .vector-search-api-key {
            flex: 1;
            min-width: 200px;
            padding: 6px 8px;
            background: var(--bg-color);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            color: var(--text-color);
            font-size: 12px;
            font-family: monospace;
          }

          .vector-search-api-key:focus {
            outline: none;
            border-color: var(--button-bg);
          }

          .vector-search-api-key::placeholder {
            color: var(--text-muted);
            font-family: inherit;
          }

          .vector-search-btn {
            padding: 6px 16px;
            background: var(--button-bg);
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
          }

          .vector-search-btn:hover {
            background: var(--button-hover);
          }

          .vector-search-btn:disabled {
            background: var(--input-bg);
            color: var(--text-muted);
            cursor: not-allowed;
          }

          .vector-search-model-info {
            margin-top: 12px;
            padding: 10px;
            background: var(--sidebar-bg);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            font-size: 12px;
            display: flex;
            flex-direction: column;
            gap: 6px;
          }

          .model-info-item {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .model-info-label {
            color: var(--text-muted);
            font-weight: 500;
            min-width: 120px;
          }

          .model-info-value {
            color: var(--text-color);
            font-family: monospace;
            flex: 1;
          }
          
          /* 结果区域 */
          .result-area {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          
          .result-header {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            background: var(--header-bg);
            border-bottom: 1px solid var(--border-color);
            gap: 12px;
          }
          
          .result-header .search-box {
            display: flex;
            align-items: center;
            gap: 6px;
            background: var(--bg-color);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 4px 8px;
          }
          
          .result-header .search-box input {
            background: none;
            border: none;
            color: var(--text-color);
            font-size: 12px;
            width: 150px;
          }
          
          .result-header .search-box input:focus {
            outline: none;
          }
          
          .result-header .actions {
            display: flex;
            gap: 4px;
            margin-left: auto;
          }
          
          .result-header .actions button {
            background: none;
            border: none;
            color: var(--text-color);
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 14px;
          }
          
          .result-header .actions button:hover {
            background: var(--hover-bg);
          }
          
          /* 数据表格 */
          .table-container {
            flex: 1;
            overflow: auto;
          }
          
          .data-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
          }
          
          .data-table th {
            position: sticky;
            top: 0;
            background: var(--header-bg);
            border-bottom: 1px solid var(--border-color);
            padding: 8px 12px;
            text-align: left;
            font-weight: 500;
            white-space: nowrap;
          }
          
          .data-table th .column-info {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }
          
          .data-table th .column-name {
            color: var(--warning-color);
          }
          
          .data-table th .column-type {
            font-size: 11px;
            color: var(--type-color);
            font-weight: normal;
          }

          .data-table td.similarity-cell {
            font-weight: 600;
            color: var(--success-color);
          }

          .data-table th.similarity-header {
            background: var(--header-bg);
          }
          
          .data-table td {
            padding: 6px 12px;
            border-bottom: 1px solid var(--border-color);
            white-space: nowrap;
          }
          
          .data-table tr:hover {
            background: var(--hover-bg);
          }
          
          .data-table .row-number {
            color: var(--text-muted);
            width: 50px;
            text-align: right;
            padding-right: 16px;
            background: var(--sidebar-bg);
            position: sticky;
            left: 0;
          }
          
          /* 状态栏 */
          .status-bar {
            display: flex;
            align-items: center;
            padding: 4px 12px;
            background: var(--header-bg);
            border-top: 1px solid var(--border-color);
            font-size: 12px;
            color: var(--text-muted);
            gap: 16px;
          }
          
          .status-bar .status-item {
            display: flex;
            align-items: center;
            gap: 4px;
          }
          
          /* 空状态 */
          .empty-state {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
          }
          
          .empty-state .icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
          }
          
          /* 加载状态 */
          .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            color: var(--text-muted);
          }
          
          .loading-spinner {
            width: 24px;
            height: 24px;
            border: 2px solid var(--border-color);
            border-top-color: var(--button-bg);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-right: 8px;
          }
          
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <!-- 左侧边栏 -->
          <div class="sidebar">
            <div class="sidebar-header">
              <span class="icon">🔌</span>
              <span>${connection.host}:${connection.port}</span>
              <div class="sidebar-actions">
                <button title="刷新" id="btnRefresh">🔄</button>
                <button title="新建查询" id="btnNewQuery">➕</button>
                <button title="设置">⚙️</button>
              </div>
            </div>
            <div class="tree-container" id="treeContainer">
              <!-- 数据库节点 -->
              <div class="tree-item" data-expanded="true" id="dbNode">
                <span class="expand-icon">▼</span>
                <span class="item-icon">🗄️</span>
                <span class="item-name">${
                  connection.database || "information_schema"
                }</span>
              </div>
              
              <!-- Query 节点 -->
              <div class="tree-item level-1">
                <span class="expand-icon">▶</span>
                <span class="item-icon">📝</span>
                <span class="item-name">query</span>
              </div>
              
              <!-- Collections 节点 -->
              <div class="tree-item level-1" data-expanded="true" id="collectionsNode">
                <span class="expand-icon">▼</span>
                <span class="item-icon">📋</span>
                <span class="item-name">collections</span>
                <span class="tree-group-count" id="collectionCount">${
                  isSeekDB ? "(加载中...)" : `(${initialCollections.length})`
                }</span>
              </div>
              
              <!-- 集合列表 -->
              <div id="collectionsList">
                ${
                  isSeekDB
                    ? '<div class="loading" style="padding: 16px 28px;"><div class="loading-spinner"></div>加载集合列表...</div>'
                    : initialCollections
                        .map(
                          (collection) => `
                    <div class="tree-item level-2 collection-item" data-collection="${collection.name}">
                      <span class="expand-icon">▶</span>
                      <span class="item-icon">📄</span>
                      <span class="item-name">${collection.name}</span>
                    </div>
                  `
                        )
                        .join("")
                }
              </div>
            </div>
          </div>
          
          <!-- 右侧主区域 -->
          <div class="main-content">
            <!-- 查询编辑器 -->
            <div class="query-editor">
              <textarea class="query-input" id="queryInput" placeholder="输入 SQL 查询语句...">${
                isSeekDB
                  ? "-- 选择左侧集合查看数据，或输入 SQL 查询"
                  : "SELECT * FROM `COLLATION_CHARACTER_SET_APPLICABILITY`"
              }</textarea>
              <div class="query-actions">
                <button class="btn btn-primary" id="btnExecute">▶ Execute</button>
                <button class="btn btn-secondary">💾 Save</button>
                <button class="btn btn-secondary">📋 Format</button>
              </div>
            </div>

            <!-- 相似度搜索区域 -->
            <div class="vector-search">
              <div class="vector-search-header">
                <span class="icon">🔎</span>
                <span>相似度搜索</span>
              </div>
              <div class="vector-search-input-group">
                <input 
                  type="text" 
                  class="vector-search-input" 
                  id="vectorSearchInput" 
                  placeholder="输入查询文本进行相似度搜索..."
                />
                <button class="vector-search-btn" id="btnVectorSearch">
                  <span>🔍</span>
                  <span>搜索</span>
                </button>
              </div>
              <div class="vector-search-options">
                <select class="vector-search-select" id="vectorSearchType">
                  <option value="builtin">内置模型</option>
                  <option value="openai">OpenAI</option>
                </select>
                <input 
                  type="number" 
                  class="vector-search-select vector-search-limit" 
                  id="vectorSearchLimit" 
                  value="10" 
                  min="1" 
                  max="100" 
                  placeholder="结果数量"
                />
                <input 
                  type="password" 
                  class="vector-search-api-key" 
                  id="vectorSearchApiKey" 
                  placeholder="OpenAI API Key (仅在使用 OpenAI 时需要)"
                  style="display: none;"
                />
              </div>
              <!-- 模型信息展示区域 -->
              <div class="vector-search-model-info" id="vectorSearchModelInfo" style="display: none;">
                <div class="model-info-item">
                  <span class="model-info-label">Collection 模型:</span>
                  <span class="model-info-value" id="collectionModelName">-</span>
                </div>
                <div class="model-info-item">
                  <span class="model-info-label">搜索模型:</span>
                  <span class="model-info-value" id="searchModelName">-</span>
                </div>
              </div>
            </div>
            
            <!-- 结果区域 -->
            <div class="result-area">
              <div class="result-header">
                <div class="search-box">
                  <span>🔍</span>
                  <input type="text" placeholder="Search results" id="searchInput" />
                </div>
                <div class="actions">
                  <button title="设置">⚙️</button>
                  <button title="添加">➕</button>
                  <button title="删除">🗑️</button>
                  <button title="切换">🔄</button>
                  <button title="上移">⬆️</button>
                  <button title="下移">⬇️</button>
                </div>
              </div>
              
              <div class="table-container" id="tableContainer">
                <div class="empty-state" id="emptyState">
                  <div class="icon">📊</div>
                  <p>执行查询或选择集合查看数据</p>
                </div>
                <table class="data-table" id="dataTable" style="display: none;">
                  <thead id="tableHead"></thead>
                  <tbody id="tableBody"></tbody>
                </table>
              </div>
            </div>
            
            <!-- 状态栏 -->
            <div class="status-bar">
              <div class="status-item" id="statusRows">
                <span>📊</span>
                <span>0 rows</span>
              </div>
              <div class="status-item" id="statusTime">
                <span>⏱️</span>
                <span>-</span>
              </div>
            </div>
          </div>
        </div>
        
        <script>
          const vscode = acquireVsCodeApi();
          let currentData = null;
          
          // 执行查询
          document.getElementById('btnExecute').addEventListener('click', () => {
            const sql = document.getElementById('queryInput').value.trim();
            if (!sql) return;
            
            showLoading();
            vscode.postMessage({ type: 'executeQuery', data: { sql } });
          });
          
          // 刷新集合列表
          document.getElementById('btnRefresh').addEventListener('click', () => {
            vscode.postMessage({ type: 'refreshCollections' });
          });

          // 向量搜索相关变量
          let currentCollectionName = null;

          // 向量搜索类型切换
          document.getElementById('vectorSearchType').addEventListener('change', (e) => {
            const type = e.target.value;
            const apiKeyInput = document.getElementById('vectorSearchApiKey');
            if (type === 'openai') {
              apiKeyInput.style.display = 'block';
            } else {
              apiKeyInput.style.display = 'none';
            }
          });

          // 向量搜索按钮
          document.getElementById('btnVectorSearch').addEventListener('click', () => {
            const query = document.getElementById('vectorSearchInput').value.trim();
            if (!query) {
              alert('请输入查询文本');
              return;
            }

            if (!currentCollectionName) {
              alert('请先选择一个集合');
              return;
            }

            const type = document.getElementById('vectorSearchType').value;
            const limit = parseInt(document.getElementById('vectorSearchLimit').value) || 10;
            const apiKey = document.getElementById('vectorSearchApiKey').value.trim();

            showLoading();
            vscode.postMessage({
              type: 'vectorSearch',
              data: {
                query,
                collectionName: currentCollectionName,
                limit,
                embeddingType: type,
                apiKey: type === 'openai' ? apiKey : undefined
              }
            });
          });

          // 向量搜索输入框回车事件
          document.getElementById('vectorSearchInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
              document.getElementById('btnVectorSearch').click();
            }
          });
          
          // 展开/折叠树节点
          document.querySelectorAll('.tree-item[data-expanded]').forEach(item => {
            item.addEventListener('click', (e) => {
              if (e.target.classList.contains('expand-icon') || e.target === item) {
                const expanded = item.dataset.expanded === 'true';
                item.dataset.expanded = (!expanded).toString();
                item.querySelector('.expand-icon').textContent = expanded ? '▶' : '▼';
              }
            });
          });
          
          // 显示加载状态
          function showLoading() {
            document.getElementById('emptyState').innerHTML = '<div class="loading"><div class="loading-spinner"></div>Loading...</div>';
            document.getElementById('emptyState').style.display = 'flex';
            document.getElementById('dataTable').style.display = 'none';
          }
          
          // 对字符串做 HTML 转义，避免 tooltip 中出现非法字符
          function escapeHtml(str) {
            return str
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
          }
          
          // 统一处理单元格显示与 hover 提示
          function formatCell(value) {
            if (value === null || value === undefined) {
              return { display: '', title: '' };
            }
            
            if (typeof value === 'object') {
              try {
                const compact = JSON.stringify(value);
                const pretty = JSON.stringify(value, null, 2);
                return {
                  display: escapeHtml(compact),
                  title: pretty
                };
              } catch (err) {
                return { display: '[object Object]', title: '' };
              }
            }
            
            const text = String(value);
            return { display: escapeHtml(text), title: '' };
          }
          
          // 渲染数据表格
          function renderTable(data) {
            if (!data || !data.columns || !data.rows) {
              document.getElementById('emptyState').innerHTML = '<div class="icon">📊</div><p>No data</p>';
              document.getElementById('emptyState').style.display = 'flex';
              document.getElementById('dataTable').style.display = 'none';
              return;
            }
            
            currentData = data;
            
            // 渲染表头
            const thead = document.getElementById('tableHead');
            thead.innerHTML = '<tr><th class="row-number">#</th>' + 
              data.columns.map(col => {
                const isSimilarity = col.name === 'similarity';
                const headerClass = isSimilarity ? ' similarity-header' : '';
                return '<th class="' + headerClass + '"><div class="column-info"><span class="column-name">* ' + col.name + '</span><span class="column-type">' + col.type + '</span></div></th>';
              }).join('') + '</tr>';
            
            // 渲染表体（HTML table 元素，保留 table 术语）
            const tbody = document.getElementById('tableBody');
            tbody.innerHTML = data.rows.map((row, index) => {
              const cells = data.columns.map(col => {
                const { display, title } = formatCell(row[col.name]);
                const titleAttr = title ? ' title="' + escapeHtml(title) + '"' : '';
                const isSimilarity = col.name === 'similarity';
                const cellClass = isSimilarity ? ' similarity-cell' : '';
                // 如果是相似度，格式化为百分比
                let finalDisplay = display;
                if (isSimilarity && typeof row[col.name] === 'number') {
                  finalDisplay = (row[col.name] * 100).toFixed(2) + '%';
                }
                return '<td class="' + cellClass + '"' + titleAttr + '>' + finalDisplay + '</td>';
              }).join('');
              return '<tr><td class="row-number">' + (index + 1) + '</td>' + cells + '</tr>';
            }).join('');
            
            // 显示表格
            document.getElementById('emptyState').style.display = 'none';
            document.getElementById('dataTable').style.display = 'table';
            
            // 更新状态栏
            document.getElementById('statusRows').innerHTML = '<span>📊</span><span>' + data.rowCount + ' rows</span>';
            if (data.executionTime) {
              document.getElementById('statusTime').innerHTML = '<span>⏱️</span><span>' + data.executionTime + '</span>';
            }
          }
          
          // 搜索过滤
          document.getElementById('searchInput').addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            if (!currentData) return;
            
            const rows = document.querySelectorAll('#tableBody tr');
            rows.forEach(row => {
              const text = row.textContent.toLowerCase();
              row.style.display = text.includes(query) ? '' : 'none';
            });
          });
          
          // 显示错误信息
          function showError(errorMessage) {
            document.getElementById('emptyState').innerHTML = 
              '<div class="icon">❌</div><p style="color: var(--danger-color, #dc3545);">' + errorMessage + '</p>';
            document.getElementById('emptyState').style.display = 'flex';
            document.getElementById('dataTable').style.display = 'none';
          }
          
          // 绑定集合项事件
          function bindCollectionItemEvents() {
            document.querySelectorAll('.collection-item').forEach(item => {
              item.addEventListener('click', () => {
                const collectionName = item.dataset.collection;
                
                // 更新选中状态
                document.querySelectorAll('.collection-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                
                // 更新当前集合名称
                currentCollectionName = collectionName;
                
                // 更新查询输入框
                document.getElementById('queryInput').value = 'SELECT * FROM \`' + collectionName + '\`';
                
                // 加载集合数据
                showLoading();
                vscode.postMessage({ type: 'loadCollectionData', data: { collectionName } });
              });
            });
          }

          // 监听来自扩展的消息
          window.addEventListener('message', (event) => {
            const message = event.data;
            
            switch (message.type) {
              case 'queryResult':
              case 'collectionData':
                renderTable(message.data);
                break;
              case 'queryError':
              case 'collectionsError':
                showError(message.data?.error || '操作失败');
                break;
              case 'collectionsList':
                // 更新集合列表
                const collectionsList = document.getElementById('collectionsList');
                collectionsList.innerHTML = message.data.collections.map(collection => 
                  '<div class="tree-item level-2 collection-item" data-collection="' + collection.name + '">' +
                  '<span class="expand-icon">▶</span>' +
                  '<span class="item-icon">📄</span>' +
                  '<span class="item-name">' + collection.name + '</span>' +
                  '</div>'
                ).join('');
                document.getElementById('collectionCount').textContent = '(' + message.data.collections.length + ')';
                // 重新绑定事件
                bindCollectionItemEvents();
                break;
              case 'loadCollectionByName':
                // 根据名称加载指定的collection
                const targetCollectionName = message.data?.collectionName;
                if (targetCollectionName) {
                  // 查找对应的collection项并点击
                  const collectionItem = document.querySelector(\`.collection-item[data-collection="\${targetCollectionName}"]\`);
                  if (collectionItem) {
                    collectionItem.click();
                  } else {
                    // 如果集合列表还没加载，等待一下再试
                    setTimeout(() => {
                      const retryItem = document.querySelector(\`.collection-item[data-collection="\${targetCollectionName}"]\`);
                      if (retryItem) {
                        retryItem.click();
                      } else {
                        // 直接加载数据（即使不在列表中）
                        showLoading();
                        vscode.postMessage({ type: 'loadCollectionData', data: { collectionName: targetCollectionName } });
                      }
                    }, 500);
                  }
                }
                break;
              case 'databasesList':
                // 更新数据库列表（如果有数据库选择器的话）
                console.log('收到数据库列表:', message.data.databases);
                break;
              case 'databaseError':
                console.error('数据库操作错误:', message.data?.error);
                break;
              case 'vectorSearchResult':
                renderTable(message.data);
                // 显示模型信息
                if (message.data.collectionModelName !== undefined || message.data.searchModelName !== undefined) {
                  const modelInfoDiv = document.getElementById('vectorSearchModelInfo');
                  const collectionModelNameEl = document.getElementById('collectionModelName');
                  const searchModelNameEl = document.getElementById('searchModelName');
                  
                  if (modelInfoDiv && collectionModelNameEl && searchModelNameEl) {
                    collectionModelNameEl.textContent = message.data.collectionModelName || '未检测到向量字段';
                    searchModelNameEl.textContent = message.data.searchModelName || '-';
                    modelInfoDiv.style.display = 'flex';
                  }
                }
                break;
              case 'vectorSearchError':
                showError(message.data?.error || '向量搜索失败');
                // 隐藏模型信息
                const modelInfoDiv = document.getElementById('vectorSearchModelInfo');
                if (modelInfoDiv) {
                  modelInfoDiv.style.display = 'none';
                }
                break;
            }
          });
          
          // 初始绑定集合项事件
          bindCollectionItemEvents();
          
          // 初始化
          const isSeekDBConnection = ${isSeekDB};
          setTimeout(() => {
            if (isSeekDBConnection) {
              // SeekDB 连接：只刷新集合列表，由服务端自动调用
              // 不需要手动请求，openCollectionBrowser 会自动调用 refreshCollections
            } else {
              // 非 SeekDB 连接：执行初始查询
              document.getElementById('btnExecute').click();
            }
          }, 200);
        </script>
      </body>
      </html>
    `;
  }

  /**
   * 生成连接页面HTML
   */
  private getConnectPageHtml(
    webview: vscode.Webview,
    defaultConfig: any
  ): string {
    return `
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Connect to Server</title>
        <style>
          :root {
            --bg-color: var(--vscode-editor-background, #1e1e1e);
            --text-color: var(--vscode-foreground, #cccccc);
            --header-bg: var(--vscode-sideBar-background, #252526);
            --border-color: var(--vscode-panel-border, #3c3c3c);
            --input-bg: var(--vscode-input-background, #3c3c3c);
            --input-text: var(--vscode-input-foreground, #cccccc);
            --input-border: var(--vscode-input-border, #3c3c3c);
            --button-bg: var(--vscode-button-background, #0078d4);
            --button-hover: var(--vscode-button-hoverBackground, #026ec1);
            --button-text: var(--vscode-button-foreground, white);
            --success-color: var(--vscode-terminal-ansiGreen, #28a745);
            --danger-color: var(--vscode-errorForeground, #dc3545);
            --info-color: var(--vscode-textLink-foreground, #17a2b8);
            --hover-bg: var(--vscode-list-hoverBackground, #2a2d2e);
            --focus-border: var(--vscode-focusBorder, #0078d4);
            --secondary-bg: var(--vscode-button-secondaryBackground, #3c3c3c);
            --secondary-fg: var(--vscode-button-secondaryForeground, #cccccc);
          }
          
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          
          body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif);
            background: var(--bg-color);
            color: var(--text-color);
            padding: 24px;
            min-height: 100vh;
          }
          
          .container {
            max-width: 900px;
            margin: 0 auto;
          }
          
          .header {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border-color);
          }
          
          .header-icon {
            width: 56px;
            height: 56px;
            background: linear-gradient(135deg, var(--vscode-textLink-foreground, #4fc3f7) 0%, var(--button-bg) 100%);
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
          }
          
          .header h1 {
            font-size: 24px;
            font-weight: 600;
            color: var(--text-color);
          }
          
          .header p {
            font-size: 13px;
            color: var(--vscode-descriptionForeground, #888888);
            margin-top: 4px;
          }
          
          .form-section {
            background: var(--header-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
          }
          
          .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 16px;
          }
          
          .form-row.single {
            grid-template-columns: 1fr;
          }
          
          .form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          
          .form-group label {
            font-size: 12px;
            font-weight: 500;
            color: var(--text-color);
          }
          
          .form-group label.required::after {
            content: " *";
            color: var(--danger-color);
          }
          
          .form-group input,
          .form-group select {
            padding: 10px 12px;
            background: var(--input-bg);
            border: 1px solid var(--border-color);
            color: var(--input-text);
            border-radius: 6px;
            font-size: 13px;
            transition: border-color 0.2s;
          }
          
          .form-group input:focus,
          .form-group select:focus {
            outline: none;
            border-color: var(--button-bg);
          }
          
          .form-group input::placeholder {
            color: var(--vscode-input-placeholderForeground, #666666);
          }
          
          .db-type-selector {
            margin-bottom: 20px;
          }
          
          .db-type-label {
            font-size: 12px;
            font-weight: 500;
            color: var(--text-color);
            margin-bottom: 12px;
            display: block;
          }
          
          .db-type-tabs {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }
          
          .db-type-tab {
            padding: 8px 16px;
            border: 1px solid var(--border-color);
            background: var(--input-bg);
            color: var(--text-color);
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
          }
          
          .db-type-tab:hover {
            border-color: var(--button-bg);
          }
          
          .db-type-tab.active {
            background: var(--button-bg);
            border-color: var(--button-bg);
            color: white;
          }
          
          .config-tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 20px;
            background: var(--input-bg);
            padding: 4px;
            border-radius: 8px;
          }
          
          .config-tab {
            padding: 8px 16px;
            background: transparent;
            border: none;
            color: var(--text-color);
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            transition: all 0.2s;
          }
          
          .config-tab:hover {
            background: rgba(255, 255, 255, 0.1);
          }
          
          .config-tab.active {
            background: var(--bg-color);
            color: var(--button-bg);
            font-weight: 500;
          }
          
          .toggle-row {
            display: flex;
            align-items: center;
            gap: 24px;
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid var(--border-color);
          }
          
          .toggle-item {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          
          .toggle-switch {
            position: relative;
            width: 40px;
            height: 22px;
          }
          
          .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
          }
          
          .toggle-slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: var(--input-bg);
            border: 1px solid var(--border-color);
            border-radius: 11px;
            transition: 0.2s;
          }
          
          .toggle-slider:before {
            position: absolute;
            content: "";
            height: 16px;
            width: 16px;
            left: 2px;
            bottom: 2px;
            background-color: var(--text-color);
            border-radius: 50%;
            transition: 0.2s;
          }
          
          .toggle-switch input:checked + .toggle-slider {
            background-color: var(--button-bg);
            border-color: var(--button-bg);
          }
          
          .toggle-switch input:checked + .toggle-slider:before {
            transform: translateX(18px);
            background-color: white;
          }
          
          .scope-buttons {
            display: flex;
            gap: 8px;
          }
          
          .scope-btn {
            padding: 6px 16px;
            border: 1px solid var(--border-color);
            background: transparent;
            color: var(--text-color);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
          }
          
          .scope-btn:hover {
            background: rgba(255, 255, 255, 0.05);
          }
          
          .scope-btn.active {
            background: var(--button-bg);
            border-color: var(--button-bg);
            color: white;
          }
          
          .action-buttons {
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            margin-top: 24px;
          }
          
          .btn {
            padding: 10px 20px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            border: none;
          }
          
          .btn-primary {
            background: var(--button-bg);
            color: white;
          }
          
          .btn-primary:hover {
            background: var(--button-hover);
          }
          
          .btn-secondary {
            background: var(--input-bg);
            color: var(--text-color);
          }
          
          .btn-secondary:hover {
            background: var(--hover-bg);
          }
          
          .btn-success {
            background: var(--success-color);
            color: white;
          }
          
          .btn-success:hover {
            background: #218838;
          }
          
          .port-control {
            display: flex;
            gap: 8px;
            align-items: center;
          }
          
          .port-control input {
            flex: 1;
            text-align: center;
          }
          
          .port-btn {
            padding: 10px 12px;
            background: var(--input-bg);
            border: 1px solid var(--border-color);
            color: var(--text-color);
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
          }
          
          .port-btn:hover {
            background: var(--hover-bg);
          }
          
          .message-toast {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 8px;
            z-index: 1000;
            animation: slideIn 0.3s ease;
          }
          
          .message-toast.success { background: var(--success-color); color: white; }
          .message-toast.error { background: var(--danger-color); color: white; }
          .message-toast.info { background: var(--button-bg); color: white; }
          
          @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          
          .loading-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
          }
          
          .loading-spinner {
            width: 40px;
            height: 40px;
            border: 3px solid var(--border-color);
            border-top-color: var(--button-bg);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
          }
          
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="header-icon">🗄️</div>
            <div>
              <h1>Connect to Server</h1>
              <p>连接到 SeekDB、Nero 或其他数据库服务器</p>
            </div>
          </div>
          
          <div class="form-section">
            <div class="form-row">
              <div class="form-group">
                <label>Name</label>
                <input type="text" id="connectionName" placeholder="Connection Name" />
              </div>
              <div class="form-group">
                <label>Group</label>
                <input type="text" id="group" placeholder="Parent/Sub" />
              </div>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div class="scope-buttons">
                <button class="scope-btn" id="btn-advance">Advance</button>
                <button class="scope-btn" id="btn-scope">Scope</button>
                <button class="scope-btn active" id="btn-global">Global</button>
                <button class="scope-btn" id="btn-workspace">Workspace</button>
              </div>
            </div>
          </div>
          
          <div class="db-type-selector">
            <span class="db-type-label">Server Type</span>
            <div class="db-type-tabs" id="dbTypeTabs">
              <button class="db-type-tab active" data-type="seekdb">🔍 seekdb</button>
              <button class="db-type-tab" data-type="nero">⚡ Nero</button>

            </div>
          </div>
          
          <div class="config-tabs">
            <button class="config-tab active" data-tab="main">⚙️ Main</button>
            <button class="config-tab" data-tab="ssh">🔐 SSH</button>
            <button class="config-tab" data-tab="socks">🧦 Socks Proxy</button>
            <button class="config-tab" data-tab="http">🌐 HTTP Proxy</button>
          </div>
          
          <div id="mainConfig" class="form-section">
            <div class="form-row">
              <div class="form-group">
                <label class="required">Host</label>
                <input type="text" id="host" placeholder="127.0.0.1" value="${defaultConfig.host}" />
              </div>
              <div class="form-group">
                <label class="required">Port</label>
                <div class="port-control">
                  <button class="port-btn" id="portMinus">−</button>
                  <input type="number" id="port" placeholder="2881" value="${defaultConfig.port}" />
                  <button class="port-btn" id="portPlus">+</button>
                </div>
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group">
                <label class="required">Username</label>
                <input type="text" id="user" placeholder="root" value="${defaultConfig.user}" />
              </div>
              <div class="form-group">
                <label class="required">Password</label>
                <input type="password" id="password" placeholder="Password" />
              </div>
            </div>
            
            <div class="form-row" id="tenantRow">
              <div class="form-group">
                <label>Tenant</label>
                <input type="text" id="tenant" placeholder="sys" value="${defaultConfig.tenant}" />
              </div>
              <div class="form-group">
                <label>Database</label>
                <input type="text" id="database" placeholder="Database" value="${defaultConfig.database}" />
              </div>
            </div>
            
            <div class="toggle-row">
              <div class="toggle-item">
                <label>Use Connection String</label>
                <label class="toggle-switch">
                  <input type="checkbox" id="useConnectionString" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
              <div class="toggle-item">
                <label>SSL</label>
                <label class="toggle-switch">
                  <input type="checkbox" id="ssl" />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>
          
          <div id="sshConfig" class="form-section" style="display: none;">
            <div class="form-row">
              <div class="form-group">
                <label>SSH Host</label>
                <input type="text" id="sshHost" placeholder="SSH 主机地址" />
              </div>
              <div class="form-group">
                <label>SSH Port</label>
                <input type="number" id="sshPort" placeholder="22" value="22" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>SSH Username</label>
                <input type="text" id="sshUser" placeholder="SSH 用户名" />
              </div>
              <div class="form-group">
                <label>SSH Password / Key</label>
                <input type="password" id="sshPassword" placeholder="SSH 密码或密钥路径" />
              </div>
            </div>
          </div>
          
          <div id="socksConfig" class="form-section" style="display: none;">
            <div class="form-row">
              <div class="form-group">
                <label>Proxy Host</label>
                <input type="text" placeholder="代理服务器地址" />
              </div>
              <div class="form-group">
                <label>Proxy Port</label>
                <input type="number" placeholder="1080" value="1080" />
              </div>
            </div>
          </div>
          
          <div id="httpConfig" class="form-section" style="display: none;">
            <div class="form-row single">
              <div class="form-group">
                <label>HTTP Proxy URL</label>
                <input type="text" placeholder="http://proxy:port" />
              </div>
            </div>
          </div>
          
          <div class="action-buttons">
            <button class="btn btn-secondary" id="btnSave">💾 Save</button>
            <button class="btn btn-success" id="btnConnect">➕ Connect</button>
            <button class="btn btn-secondary" id="btnClose">✕ Close</button>
          </div>
        </div>
        
        <div id="messageToast" class="message-toast" style="display: none;"></div>
        <div id="loadingOverlay" class="loading-overlay" style="display: none;">
          <div class="loading-spinner"></div>
        </div>
        
        <script>
          const vscode = acquireVsCodeApi();
          let currentDbType = 'seekdb';
          let currentConfigTab = 'main';
          
          // 数据库类型切换
          document.getElementById('dbTypeTabs').addEventListener('click', (e) => {
            const tab = e.target.closest('.db-type-tab');
            if (!tab) return;
            
            document.querySelectorAll('.db-type-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentDbType = tab.dataset.type;
            
            // SeekDB 和 Nero 显示 Tenant 字段
            const tenantRow = document.getElementById('tenantRow');
            if (currentDbType === 'seekdb' || currentDbType === 'nero') {
              tenantRow.style.display = 'grid';
            } else {
              tenantRow.style.display = 'none';
            }
          });
          
          // 配置选项卡切换
          document.querySelectorAll('.config-tab').forEach(tab => {
            tab.addEventListener('click', () => {
              document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
              tab.classList.add('active');
              currentConfigTab = tab.dataset.tab;
              
              document.getElementById('mainConfig').style.display = currentConfigTab === 'main' ? 'block' : 'none';
              document.getElementById('sshConfig').style.display = currentConfigTab === 'ssh' ? 'block' : 'none';
              document.getElementById('socksConfig').style.display = currentConfigTab === 'socks' ? 'block' : 'none';
              document.getElementById('httpConfig').style.display = currentConfigTab === 'http' ? 'block' : 'none';
            });
          });
          
          // Scope 按钮
          document.querySelectorAll('.scope-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              document.querySelectorAll('.scope-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
            });
          });
          
          // 端口加减
          document.getElementById('portMinus').addEventListener('click', () => {
            const input = document.getElementById('port');
            input.value = Math.max(1, parseInt(input.value || 0) - 1);
          });
          
          document.getElementById('portPlus').addEventListener('click', () => {
            const input = document.getElementById('port');
            input.value = parseInt(input.value || 0) + 1;
          });
          
          // 获取表单数据
          function getFormData() {
            return {
              type: currentDbType,
              connectionName: document.getElementById('connectionName').value,
              group: document.getElementById('group').value,
              host: document.getElementById('host').value,
              port: parseInt(document.getElementById('port').value) || 2881,
              user: document.getElementById('user').value,
              password: document.getElementById('password').value,
              tenant: document.getElementById('tenant').value,
              database: document.getElementById('database').value,
              useConnectionString: document.getElementById('useConnectionString').checked,
              ssl: document.getElementById('ssl').checked,
            };
          }
          
          // 显示消息
          function showMessage(type, text) {
            const toast = document.getElementById('messageToast');
            toast.className = 'message-toast ' + type;
            toast.textContent = text;
            toast.style.display = 'flex';
            setTimeout(() => { toast.style.display = 'none'; }, 3000);
          }
          
          // 显示/隐藏加载
          function setLoading(show) {
            document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
          }
          
          // 保存按钮
          document.getElementById('btnSave').addEventListener('click', () => {
            const data = getFormData();
            if (!data.connectionName) {
              showMessage('error', '请输入连接名称');
              return;
            }
            vscode.postMessage({ type: 'save', data });
          });
          
          // 连接按钮
          document.getElementById('btnConnect').addEventListener('click', () => {
            const data = getFormData();
            if (!data.host || !data.port) {
              showMessage('error', '请填写主机地址和端口');
              return;
            }
            setLoading(true);
            vscode.postMessage({ type: 'connect', data });
          });
          
          // 关闭按钮
          document.getElementById('btnClose').addEventListener('click', () => {
            vscode.postMessage({ type: 'close' });
          });
          
          // 监听来自扩展的消息
          window.addEventListener('message', (event) => {
            const message = event.data;
            setLoading(false);
            
            switch (message.type) {
              case 'connectionSuccess':
                showMessage('success', '连接成功！');
                break;
              case 'connectionError':
                showMessage('error', message.data?.error || '连接失败');
                break;
              case 'testResult':
                showMessage(message.data?.success ? 'success' : 'error', 
                  message.data?.success ? '测试成功！' : '测试失败');
                break;
            }
          });
        </script>
      </body>
      </html>
    `;
  }
}
