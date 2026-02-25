import * as vscode from "vscode";
import {
  SeekdbAdminClient,
  SeekdbClient,
  Database,
  SeekdbError,
  SeekdbConnectionError,
  SeekdbNotFoundError,
  DEFAULT_TENANT,
  DEFAULT_PORT,
  DEFAULT_USER,
  DEFAULT_DATABASE,
  OBDatabase,
} from "seekdb";
import {
  EmbeddingServiceFactory,
  cosineSimilarity,
  EmbeddingService,
} from "../services/embedding/EmbeddingService";
import { WebviewHtmlLoader } from "../utils/WebviewHtmlLoader";

/**
 * Database connection interface
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
 * SeekDB client instance management
 */
interface SeekdbClientInstance {
  adminClient: SeekdbAdminClient;
  client?: SeekdbClient;
}

/**
 * Database info (from server)
 */
interface DatabaseInfo {
  name: string;
  tenant: string | null;
  charset: string;
  collation: string;
}

/**
 * Collection info
 */
interface CollectionInfo {
  name: string;
  type: string;
  rows?: number;
  engine?: string;
}

/**
 * Query result
 */
interface QueryResultData {
  columns: { name: string; type: string }[];
  rows: Record<string, any>[];
  rowCount: number;
  executionTime: string;
}

/**
 * Warning message
 */
interface WarningMessage {
  type: "warning" | "info" | "error";
  message: string;
  timestamp: Date;
}

/**
 * Saved query interface
 */
interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * DatabaseProvider - Manages database connection WebviewPanel
 */
/**
 * Collection table prefixes
 */
const COLLECTION_TABLE_PREFIXES = ["c$v2$", "c$v1$"];

/**
 * Strip prefix from collection table name
 */
function stripCollectionPrefix(name: string): {
  cleanName: string;
  prefix: string | null;
} {
  for (const prefix of COLLECTION_TABLE_PREFIXES) {
    if (name.startsWith(prefix)) {
      return {
        cleanName: name.slice(prefix.length),
        prefix,
      };
    }
  }
  return { cleanName: name, prefix: null };
}

/**
 * Check if table is a collection backing table
 */
function isCollectionBackingTable(tableName: string): boolean {
  return COLLECTION_TABLE_PREFIXES.some((prefix) =>
    tableName.startsWith(prefix),
  );
}

/**
 * Resolve actual table name from clean collection name
 */
async function resolveCollectionTableName(
  cleanName: string,
  allTables: string[],
  execute: (sql: string) => Promise<any>,
): Promise<string | null> {
  try {
    // Try c$v2$ first, v2 version collection name will be saved in `sdk_collections` table, collection_name field
    // The name of collection is in form of `c$v2$collection_id`
    const metas = await execute(
      `SELECT COUNT(*) as count FROM sdk_collections`,
    );
    if (metas?.rows?.[0]?.count > 0) {
      const selectSql = `SELECT collection_id FROM sdk_collections WHERE collection_name = \'${cleanName}\'`;
      const result = await execute(selectSql);
      const [row] = result?.rows || [];
      if (row) {
        return `c$v2$${row.collection_id}`;
      }
    }
  } catch (error) {
    console.error(
      "[DatabaseProvider] resolve c$v2$ CollectionName error:",
      error,
    );
  }

  // Try c$v1$
  const v1Name = `c$v1$${cleanName}`;
  if (allTables.includes(v1Name)) {
    return v1Name;
  }

  // Fallback to clean name
  return cleanName;
}

export class DatabaseProvider {
  private panel: vscode.WebviewPanel | undefined;
  private collectionPanels: Map<string, vscode.WebviewPanel> = new Map();
  private connections: DatabaseConnection[] = [];
  private onConnectionsChangedCallback?: (
    connections: DatabaseConnection[],
  ) => void;

  // SeekDB client instance management
  private seekdbClients: Map<string, SeekdbClientInstance> = new Map();
  // Warning message cache
  private warnings: WarningMessage[] = [];
  // Embedding service instance
  private embeddingService: EmbeddingService | null = null;
  // Embedding cache: key is hash of text content, value is vector
  private embeddingCache: Map<string, number[]> = new Map();
  // Maximum size of embedding cache (prevent memory overflow)
  private readonly MAX_CACHE_SIZE = 10000;
  // Webview HTML loader
  private htmlLoader: WebviewHtmlLoader;

  constructor(private readonly context: vscode.ExtensionContext) {
    // Initialize HTML loader
    this.htmlLoader = new WebviewHtmlLoader(context.extensionUri);
    // Load saved connections from storage
    this.loadConnections();
    // Initialize embedding service
    this.initializeEmbeddingService();
  }

  /**
   * Initialize embedding service
   */
  private initializeEmbeddingService(): void {
    try {
      const config = vscode.workspace.getConfiguration("seekdb");
      this.embeddingService = EmbeddingServiceFactory.createFromConfig(config);
    } catch (error) {
      console.error("Failed to initialize embedding service:", error);
      // Use built-in service as fallback
      this.embeddingService = EmbeddingServiceFactory.create("builtin");
    }
  }

  /**
   * Get SeekDB AdminClient
   */
  private getSeekdbAdminClient(
    connectionId: string,
  ): SeekdbAdminClient | undefined {
    return this.seekdbClients.get(connectionId)?.adminClient;
  }

  /**
   * Get SeekDB Client
   */
  private getSeekdbClient(connectionId: string): SeekdbClient | undefined {
    return this.seekdbClients.get(connectionId)?.client;
  }

  /**
   * Create an EmbeddingFunction adapter from the project's EmbeddingService
   * This adapts our EmbeddingService interface to SeekDB's IEmbeddingFunction interface
   */
  private createEmbeddingFunctionAdapter(): {
    name: string;
    generate: (texts: string[]) => Promise<number[][]>;
    getConfig: () => Record<string, any>;
  } | null {
    const embeddingService = this.embeddingService;
    if (!embeddingService) {
      return null;
    }

    return {
      name: embeddingService.getModelName(),
      generate: async (texts: string[]): Promise<number[][]> => {
        const embeddings: number[][] = [];
        for (const text of texts) {
          const embedding = await embeddingService.embed(text);
          embeddings.push(embedding);
        }
        return embeddings;
      },
      getConfig: () => ({
        modelName: embeddingService.getModelName(),
      }),
    };
  }

  /**
   * Create SeekDB client instance
   */
  private async createSeekdbClients(
    connection: DatabaseConnection,
  ): Promise<SeekdbClientInstance> {
    const adminClient = new SeekdbAdminClient({
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password: connection.password,
      tenant: connection.tenant || DEFAULT_TENANT,
    });

    const client = new SeekdbClient({
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
   * Close SeekDB client
   */
  private async closeSeekdbClients(connectionId: string): Promise<void> {
    const instance = this.seekdbClients.get(connectionId);
    if (instance) {
      try {
        await instance.adminClient.close();
        if (instance.client) {
          await instance.client.close();
        }
      } catch (error) {
        console.error("Failed to close s client:", error);
      }
      this.seekdbClients.delete(connectionId);
    }
  }

  /**
   * Add warning message
   */
  private addWarning(
    type: "warning" | "info" | "error",
    message: string,
  ): void {
    const warning: WarningMessage = {
      type,
      message,
      timestamp: new Date(),
    };
    this.warnings.push(warning);
    // Keep the most recent 100 warnings
    if (this.warnings.length > 100) {
      this.warnings.shift();
    }
  }

  /**
   * Check if connection is SeekDB type
   */
  private isSeekDBConnection(connection: DatabaseConnection): boolean {
    return connection.type === "seekdb";
  }

  /**
   * Check if connection is OceanBase Cloud type
   */
  private isOceanBaseCloudConnection(connection: DatabaseConnection): boolean {
    return connection.type === "oceanbase-cloud";
  }

  /**
   * Set connection change callback
   */
  public onConnectionsChanged(
    callback: (connections: DatabaseConnection[]) => void,
  ) {
    this.onConnectionsChangedCallback = callback;
  }

  /**
   * Get all connections
   */
  public getConnections(): DatabaseConnection[] {
    return this.connections;
  }

  /**
   * Load saved connections
   */
  private loadConnections(): void {
    const saved = this.context.globalState.get<DatabaseConnection[]>(
      "databaseConnections",
      [],
    );
    this.connections = saved;
  }

  /**
   * Save connections
   */
  private saveConnections(): void {
    this.context.globalState.update("databaseConnections", this.connections);
    this.onConnectionsChangedCallback?.(this.connections);
  }

  /**
   * Open database connection page (new tab)
   * @param savedConnection Optional saved connection to restore/edit
   */
  public openConnectPage(savedConnection?: DatabaseConnection): void {
    console.log("DatabaseProvider.openConnectPage called", savedConnection);

    // If panel already exists, show it and send saved connection data
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      // If a saved connection is provided, send it to the webview to restore
      if (savedConnection) {
        setTimeout(() => {
          this.panel?.webview.postMessage({
            type: "restoreConnection",
            data: savedConnection,
          });
        }, 100);
      }
      return;
    }

    // Create new WebviewPanel
    this.panel = vscode.window.createWebviewPanel(
      "databaseConnect",
      "Connect to Server",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      },
    );

    // Set icon
    this.panel.iconPath = {
      light: vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "light",
        "snippet.svg",
      ),
      dark: vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "dark",
        "snippet.svg",
      ),
    };

    // Get default values from config or use saved connection
    const config = vscode.workspace.getConfiguration("seekdb");
    const defaultConfig = savedConnection
      ? {
          id: savedConnection.id,
          connectionName: savedConnection.name,
          type: savedConnection.type,
          host: savedConnection.host,
          port: savedConnection.port,
          tenant: savedConnection.tenant || "",
          database: savedConnection.database || "",
          user: savedConnection.user,
          password: savedConnection.password || "",
        }
      : {
          host: config.get("database.defaultHost", "127.0.0.1"),
          port: config.get("database.defaultPort", 2881),
          tenant: config.get("database.defaultTenant", "sys"),
          database: config.get("database.defaultDatabase", "test"),
          user: config.get("database.defaultUser", "root"),
          password: "",
        };

    // Set HTML content
    this.panel.webview.html = this.getConnectPageHtml(
      this.panel.webview,
      defaultConfig,
    );

    // Handle messages
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      undefined,
      this.context.subscriptions,
    );

    // Listen for panel close
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  /**
   * Handle messages from Webview
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
      case "openBrowser":
        // Open external URL in browser
        vscode.env.openExternal(vscode.Uri.parse(message.data.url));
        break;
    }
  }

  /**
   * Connect to database
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
        `Connecting to ${data.host}:${data.port}...`,
      );

      // If SeekDB type, create real connection
      if (this.isSeekDBConnection(connection)) {
        const clients = await this.createSeekdbClients(connection);

        // Test if connection is successful - try to list databases
        try {
          await clients.adminClient.listDatabases(1);
          this.seekdbClients.set(connection.id, clients);
          connection.connected = true;
          this.addWarning(
            "info",
            `Successfully connected to seekdb: ${connection.name}`,
          );
        } catch (connError) {
          // Close failed connection
          await clients.adminClient.close();
          if (clients.client) {
            await clients.client.close();
          }
          throw connError;
        }
      } else if (this.isOceanBaseCloudConnection(connection)) {
        // OceanBase Cloud connection - use MySQL compatible mode
        await this.testOceanBaseCloudConnection(connection);
        connection.connected = true;
        this.addWarning(
          "info",
          `Successfully connected to OceanBase Cloud: ${connection.name}`,
        );
      } else {
        // Non-SeekDB type, use mock connection
        connection.connected = true;
      }

      // Add or update connection
      const existingIndex = this.connections.findIndex((c) => c.id === data.id);
      if (existingIndex >= 0) {
        this.connections[existingIndex] = connection;
      } else {
        this.connections.push(connection);
      }

      this.saveConnections();

      // Send success message
      this.panel?.webview.postMessage({
        type: "connectionSuccess",
        data: connection,
      });

      vscode.window.showInformationMessage(
        `Successfully connected to ${connection.name}`,
      );
    } catch (error) {
      let errorMessage = String(error);
      if (error instanceof SeekdbConnectionError) {
        errorMessage = `Connection failed: Unable to connect to server ${data.host}:${data.port}`;
        // Show how to connect to seekdb in editor notification
        this.addWarning("error", errorMessage);
      } else if (error instanceof SeekdbError) {
        errorMessage = `seekdb error: ${error.message}`;
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
   * Save connection config (without connecting)
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
      `Connection config "${connection.name}" saved`,
    );
  }

  /**
   * Test OceanBase Cloud connection using MySQL compatible mode
   */
  private async testOceanBaseCloudConnection(
    connection: DatabaseConnection,
  ): Promise<void> {
    const mysql = await import("mysql2/promise");

    // Build user string: if tenant is provided, use format "user@tenant", otherwise just "user"
    // const userString = connection.host
    //   ? `${connection.user}@${connection.host}`
    //   : connection.user;
    const userString = connection.user;

    const conn = await mysql.createConnection({
      host: connection.host,
      port: connection.port,
      user: userString,
      password: connection.password,
      database: connection.database || "test",
      connectTimeout: 10000,
    });

    try {
      // Test connection by executing a simple query
      await conn.execute("SELECT 1");
      await conn.end();
    } catch (error) {
      await conn.end();
      throw error;
    }
  }

  /**
   * Test connection
   */
  private async testConnection(data: any): Promise<void> {
    vscode.window.showInformationMessage(
      `Testing connection ${data.host}:${data.port}...`,
    );

    // If it's SeekDB type, perform real test
    if (data.type === "seekdb") {
      try {
        const testClient = new SeekdbAdminClient({
          host: data.host,
          port: data.port || DEFAULT_PORT,
          user: data.user || DEFAULT_USER,
          password: data.password,
          tenant: data.tenant || DEFAULT_TENANT,
        });

        // Try to list databases to test connection
        await testClient.listDatabases(1);
        await testClient.close();

        this.panel?.webview.postMessage({
          type: "testResult",
          data: { success: true },
        });
        vscode.window.showInformationMessage("Connection test successful!");
      } catch (error) {
        let errorMessage = "Connection test failed";
        if (error instanceof SeekdbConnectionError) {
          errorMessage = `Unable to connect to server: ${data.host}:${data.port}`;
        } else if (error instanceof SeekdbError) {
          errorMessage = `seekdb error: ${error.message}`;
        } else if (error instanceof Error) {
          errorMessage = error.message;
        }

        this.panel?.webview.postMessage({
          type: "testResult",
          data: { success: false, error: errorMessage },
        });
        vscode.window.showErrorMessage(errorMessage);
      }
    } else if (data.type === "oceanbase-cloud") {
      // OceanBase Cloud connection test
      try {
        const testConnection: DatabaseConnection = {
          id: "test",
          name: "test",
          type: "oceanbase-cloud",
          host: data.host,
          port: data.port || 2881,
          user: data.user,
          password: data.password,
          database: data.database,
          tenant: data.tenant,
          connected: false,
        };

        await this.testOceanBaseCloudConnection(testConnection);

        this.panel?.webview.postMessage({
          type: "testResult",
          data: { success: true },
        });
        vscode.window.showInformationMessage("Connection test successful!");
      } catch (error) {
        let errorMessage = "Connection test failed";
        if (error instanceof Error) {
          errorMessage = `OceanBase Cloud connection error: ${error.message}`;
        }

        this.panel?.webview.postMessage({
          type: "testResult",
          data: { success: false, error: errorMessage },
        });
        vscode.window.showErrorMessage(errorMessage);
      }
    } else {
      // Non-SeekDB type, use simulated test
      setTimeout(() => {
        this.panel?.webview.postMessage({
          type: "testResult",
          data: { success: true },
        });
        vscode.window.showInformationMessage("Connection test successful!");
      }, 1000);
    }
  }

  /**
   * Disconnect from database
   */
  public async disconnectDatabase(connectionId: string): Promise<void> {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (connection) {
      // If it's SeekDB type, close real connection
      if (this.isSeekDBConnection(connection)) {
        await this.closeSeekdbClients(connectionId);
        this.addWarning("info", `Disconnected from seekdb: ${connection.name}`);
      } else if (this.isOceanBaseCloudConnection(connection)) {
        // OceanBase Cloud connections are stateless, just mark as disconnected
        this.addWarning(
          "info",
          `Disconnected from OceanBase Cloud: ${connection.name}`,
        );
      }

      connection.connected = false;
      this.saveConnections();
      vscode.window.showInformationMessage(
        `Disconnected from ${connection.name}`,
      );
    }
  }

  /**
   * Delete connection
   */
  public async deleteConnection(connectionId: string): Promise<void> {
    const connection = this.connections.find((c) => c.id === connectionId);

    // If it's SeekDB type and connected, close connection first
    if (connection && this.isSeekDBConnection(connection)) {
      await this.closeSeekdbClients(connectionId);
    }

    this.connections = this.connections.filter((c) => c.id !== connectionId);
    this.saveConnections();
    vscode.window.showInformationMessage("Connection deleted");
  }

  /**
   * Get server database list (SeekDB only)
   */
  public async getServerDatabases(
    connectionId: string,
  ): Promise<DatabaseInfo[]> {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection || !this.isSeekDBConnection(connection)) {
      return [];
    }

    let adminClient = this.getSeekdbAdminClient(connectionId);

    // If client doesn't exist but connection is marked as connected, try to recreate client
    if (!adminClient && connection.connected) {
      try {
        const clients = await this.createSeekdbClients(connection);
        this.seekdbClients.set(connectionId, clients);
        adminClient = clients.adminClient;
        this.addWarning("info", `Reconnected to seekdb: ${connection.name}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.addWarning("error", `Failed to reconnect: ${errorMsg}`);
        return [];
      }
    }

    if (!adminClient) {
      this.addWarning(
        "warning",
        `Connection ${connection.name} has no AdminClient`,
      );
      return [];
    }

    try {
      const databases = await adminClient.listDatabases();
      return databases.map((db: Database | OBDatabase) => ({
        name: db.name,
        tenant: db instanceof OBDatabase ? db.tenant : null,
        charset: db.charset,
        collation: db.collation,
      }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Failed to get database list: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * Create database (SeekDB only)
   */
  public async createServerDatabase(
    connectionId: string,
    dbName: string,
  ): Promise<void> {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection || !this.isSeekDBConnection(connection)) {
      throw new Error(
        "Only seekdb type connections support creating databases",
      );
    }

    let adminClient = this.getSeekdbAdminClient(connectionId);

    // If client doesn't exist, try to recreate
    if (!adminClient && connection.connected) {
      const clients = await this.createSeekdbClients(connection);
      this.seekdbClients.set(connectionId, clients);
      adminClient = clients.adminClient;
    }

    if (!adminClient) {
      throw new Error("Connection not established");
    }

    try {
      await adminClient.createDatabase(dbName);
      this.addWarning("info", `Successfully created database: ${dbName}`);
      vscode.window.showInformationMessage(
        `Successfully created database: ${dbName}`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Failed to create database: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * Delete database (SeekDB only)
   */
  public async deleteServerDatabase(
    connectionId: string,
    dbName: string,
  ): Promise<void> {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection || !this.isSeekDBConnection(connection)) {
      throw new Error(
        "Only seekdb type connections support deleting databases",
      );
    }

    let adminClient = this.getSeekdbAdminClient(connectionId);

    // If client doesn't exist, try to recreate
    if (!adminClient && connection.connected) {
      const clients = await this.createSeekdbClients(connection);
      this.seekdbClients.set(connectionId, clients);
      adminClient = clients.adminClient;
    }

    if (!adminClient) {
      throw new Error("Connection not established");
    }

    try {
      await adminClient.deleteDatabase(dbName);
      this.addWarning("info", `Successfully deleted database: ${dbName}`);
      vscode.window.showInformationMessage(
        `Successfully deleted database: ${dbName}`,
      );
    } catch (error) {
      if (error instanceof SeekdbNotFoundError) {
        this.addWarning("warning", `Database not found: ${dbName}`);
      } else {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.addWarning("error", `Failed to delete database: ${errorMsg}`);
      }
      throw error;
    }
  }

  /**
   * Get database details (SeekDB only)
   */
  public async getServerDatabaseInfo(
    connectionId: string,
    dbName: string,
  ): Promise<DatabaseInfo | null> {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection || !this.isSeekDBConnection(connection)) {
      return null;
    }

    let adminClient = this.getSeekdbAdminClient(connectionId);

    // If client doesn't exist, try to recreate
    if (!adminClient && connection.connected) {
      try {
        const clients = await this.createSeekdbClients(connection);
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
        tenant: db instanceof OBDatabase ? db.tenant : null,
        charset: db.charset,
        collation: db.collation,
      };
    } catch (error) {
      if (error instanceof SeekdbNotFoundError) {
        this.addWarning("warning", `Database not found: ${dbName}`);
        return null;
      }
      throw error;
    }
  }

  /**
   * Open collection browser page (new tab)
   */
  public openCollectionBrowser(
    connectionId: string,
    collectionName?: string,
  ): void {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection) {
      vscode.window.showErrorMessage("Database connection not found");
      return;
    }

    // Check if collection browser already exists for this connection
    const existingPanel = this.collectionPanels.get(connectionId);
    if (existingPanel) {
      existingPanel.reveal(vscode.ViewColumn.One);
      // If collectionName is specified, load that collection's data
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

    // Create new WebviewPanel
    const panel = vscode.window.createWebviewPanel(
      "databaseCollectionBrowser",
      `${connection.name} - Collections`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      },
    );

    // Set icon
    panel.iconPath = {
      light: vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "light",
        "snippet.svg",
      ),
      dark: vscode.Uri.joinPath(
        this.context.extensionUri,
        "media",
        "dark",
        "snippet.svg",
      ),
    };

    // Set HTML content
    panel.webview.html = this.getCollectionBrowserHtml(
      panel.webview,
      connection,
    );

    // Save panel reference
    this.collectionPanels.set(connectionId, panel);

    // Handle messages
    panel.webview.onDidReceiveMessage(
      (message) =>
        this.handleCollectionBrowserMessage(message, panel, connection),
      undefined,
      this.context.subscriptions,
    );

    // Listen for panel close
    panel.onDidDispose(() => {
      this.collectionPanels.delete(connectionId);
    });

    // If it's a SeekDB or OceanBase Cloud connection, load real collections list immediately
    if (
      this.isSeekDBConnection(connection) ||
      this.isOceanBaseCloudConnection(connection)
    ) {
      console.log(
        `[DatabaseProvider] openCollectionBrowser: ${connection.type}, will refresh collections in 100ms`,
      );
      // Delay a bit to ensure webview is fully loaded
      setTimeout(async () => {
        console.log(
          "[DatabaseProvider] openCollectionBrowser: calling refreshCollections now",
        );
        await this.refreshCollections(panel, connection);
        // If collectionName is specified, load that collection's data
        if (collectionName) {
          setTimeout(() => {
            panel.webview.postMessage({
              type: "loadCollectionByName",
              data: { collectionName },
            });
          }, 300);
        }
      }, 100);
    } else {
      console.log(
        "[DatabaseProvider] openCollectionBrowser: not SeekDB or OceanBase Cloud, skipping initial refresh",
      );
    }
  }

  /**
   * Open collection browser and load specified collection (let user choose connection)
   */
  public async openCollectionBrowserWithCollection(
    collectionName: string,
  ): Promise<void> {
    // Get all connected connections
    const connectedConnections = this.connections.filter((c) => c.connected);

    if (connectedConnections.length === 0) {
      vscode.window.showWarningMessage(
        "No connected database connections, please connect to a database first",
      );
      return;
    }

    // If only one connection, use it directly
    if (connectedConnections.length === 1) {
      this.openCollectionBrowser(connectedConnections[0].id, collectionName);
      return;
    }

    // Multiple connections, let user choose
    const items = connectedConnections.map((conn) => ({
      label: conn.name,
      description: `${conn.type} - ${conn.host}:${conn.port}`,
      connection: conn,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Select database connection to view Collection: ${collectionName}`,
    });

    if (selected) {
      this.openCollectionBrowser(selected.connection.id, collectionName);
    }
  }

  /**
   * Handle collection browser messages
   */
  private async handleCollectionBrowserMessage(
    message: any,
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    console.log(
      "[DatabaseProvider] handleCollectionBrowserMessage:",
      message.type,
      message.data,
    );

    try {
      switch (message.type) {
        case "executeQuery":
          await this.executeQuery(
            message.data.sql,
            panel,
            connection,
            message.data.context,
          );
          break;
        case "loadCollectionData":
          await this.loadCollectionData(
            message.data.collectionName,
            panel,
            connection,
          );
          break;
        case "loadTableData":
          await this.loadTableData(message.data.tableName, panel, connection);
          break;
        case "refreshCollections":
          console.log("[DatabaseProvider] Handling refreshCollections");
          await this.refreshCollections(panel, connection);
          break;
        case "loadDatabases":
          await this.handleLoadDatabases(panel, connection);
          break;
        case "selectDatabase":
          await this.handleSelectDatabase(
            message.data.database,
            panel,
            connection,
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
        case "getSavedQueries":
          await this.handleGetSavedQueries(panel, connection);
          break;
        case "saveQuery":
          await this.handleSaveQuery(message.data, panel, connection);
          break;
        case "updateQuery":
          await this.handleUpdateQuery(message.data, panel, connection);
          break;
        case "deleteQuery":
          await this.handleDeleteQuery(message.data, panel, connection);
          break;
        case "createCollection":
          await this.handleCreateCollection(message.data, panel, connection);
          break;
        case "deleteCollection":
          await this.handleDeleteCollection(message.data, panel, connection);
          break;
        case "renameCollection":
          await this.handleRenameCollection(message.data, panel, connection);
          break;
        case "deleteDocument":
          await this.handleDeleteDocument(message.data, panel, connection);
          break;
        case "updateDocument":
          await this.handleUpdateDocument(message.data, panel, connection);
          break;
        case "createDocument":
          await this.handleCreateDocument(message.data, panel, connection);
          break;
        // Fork Table operations
        case "forkTable":
          await this.handleForkTable(message.data, panel, connection);
          break;
        case "promoteFork":
          await this.handlePromoteFork(message.data, panel, connection);
          break;
        case "discardFork":
          await this.handleDiscardFork(message.data, panel, connection);
          break;
        case "compareTables":
          await this.handleCompareTables(message.data, panel, connection);
          break;
        case "getForkInfo":
          await this.handleGetForkInfo(message.data, panel, connection);
          break;
        case "abTestCreate":
          await this.handleABTestCreate(message.data, panel, connection);
          break;
        case "abTestRunQuery":
          await this.handleABTestRunQuery(message.data, panel, connection);
          break;
        case "abTestCleanup":
          await this.handleABTestCleanup(message.data, panel, connection);
          break;
        // OceanBase Cloud table operations
        case "createTable":
          await this.handleCreateTable(message.data, panel, connection);
          break;
        case "deleteTable":
          await this.handleDeleteTable(message.data, panel, connection);
          break;
        // OceanBase Cloud row operations
        case "createRow":
          await this.handleCreateRow(message.data, panel, connection);
          break;
        case "updateRow":
          await this.handleUpdateRow(message.data, panel, connection);
          break;
        case "deleteRow":
          await this.handleDeleteRow(message.data, panel, connection);
          break;
        case "getTableStructures":
          await this.handleGetTableStructures(panel, connection);
          break;
      }
    } catch (error) {
      // Global error handler for all collection browser messages
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(
        "[DatabaseProvider] Unhandled error in handleCollectionBrowserMessage:",
        errorMsg,
      );
      this.addWarning("error", `Operation failed: ${errorMsg}`);

      // Send error message to frontend based on message type
      if (
        message.type === "deleteDocument" ||
        message.type === "updateDocument" ||
        message.type === "createDocument"
      ) {
        panel.webview.postMessage({
          type: "documentError",
          data: { error: errorMsg },
        });
      } else if (
        message.type === "deleteRow" ||
        message.type === "updateRow" ||
        message.type === "createRow"
      ) {
        panel.webview.postMessage({
          type: "rowError",
          data: { error: errorMsg },
        });
      } else if (
        message.type === "createCollection" ||
        message.type === "deleteCollection" ||
        message.type === "renameCollection"
      ) {
        panel.webview.postMessage({
          type: "collectionError",
          data: { error: errorMsg },
        });
      } else if (
        message.type === "createTable" ||
        message.type === "deleteTable"
      ) {
        panel.webview.postMessage({
          type: "tableError",
          data: { error: errorMsg },
        });
      } else {
        panel.webview.postMessage({
          type: "queryError",
          data: { error: errorMsg },
        });
      }
    }
  }

  /**
   * Handle loading database list
   */
  private async handleLoadDatabases(
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
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
   * Handle database selection
   */
  private async handleSelectDatabase(
    dbName: string,
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    // Update connection's database
    const connIndex = this.connections.findIndex((c) => c.id === connection.id);
    if (connIndex >= 0) {
      this.connections[connIndex].database = dbName;
      connection.database = dbName;
      this.saveConnections();

      // Recreate client
      if (this.isSeekDBConnection(connection)) {
        await this.closeSeekdbClients(connection.id);
        const clients = await this.createSeekdbClients(connection);
        this.seekdbClients.set(connection.id, clients);
      }

      // 发送更新后的 connectionInfo 给 panel
      panel.webview.postMessage({
        type: "connectionInfoUpdated",
        data: {
          name: connection.name,
          host: connection.host,
          port: connection.port,
          database: dbName,
        },
      });

      // Refresh collections list
      await this.refreshCollections(panel, connection);
      this.addWarning("info", `Switched to database: ${dbName}`);
    }
  }

  /**
   * Select database for connection (public method for external database switching)
   * If this connection has an open Collection Browser panel, it will be refreshed automatically
   */
  public async selectDatabaseForConnection(
    connectionId: string,
    dbName: string,
  ): Promise<void> {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    // Update connection's database
    const connIndex = this.connections.findIndex((c) => c.id === connectionId);
    if (connIndex >= 0) {
      this.connections[connIndex].database = dbName;
      connection.database = dbName;
      this.saveConnections();

      // Recreate client
      if (this.isSeekDBConnection(connection)) {
        await this.closeSeekdbClients(connection.id);
        const clients = await this.createSeekdbClients(connection);
        this.seekdbClients.set(connection.id, clients);
      }

      // If this connection has an open Collection Browser panel, refresh collections list
      const existingPanel = this.collectionPanels.get(connectionId);
      if (existingPanel) {
        // 发送更新后的 connectionInfo 给 panel
        existingPanel.webview.postMessage({
          type: "connectionInfoUpdated",
          data: {
            name: connection.name,
            host: connection.host,
            port: connection.port,
            database: dbName,
          },
        });
        await this.refreshCollections(existingPanel, connection);
      }
    }
  }

  /**
   * Handle create database
   */
  private async handleCreateDatabase(
    dbName: string,
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    try {
      await this.createServerDatabase(connection.id, dbName);
      // Refresh database list
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
   * Handle delete database
   */
  private async handleDeleteDatabase(
    dbName: string,
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    try {
      await this.deleteServerDatabase(connection.id, dbName);
      // Refresh database list
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
   * Parse CREATE TABLE statement to extract table name
   * Returns null if not a CREATE TABLE statement
   */
  private parseCreateTableStatement(sql: string): string | null {
    // Remove comments and normalize whitespace
    const normalizedSql = sql
      .replace(/--.*$/gm, "") // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
      .trim();

    // Match CREATE TABLE [IF NOT EXISTS] `table_name` or CREATE TABLE [IF NOT EXISTS] table_name
    // Handle both backtick-quoted and unquoted table names
    const createTableRegex =
      /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`([^`]+)`|"([^"]+)"|(\w+))/i;
    const match = normalizedSql.match(createTableRegex);
    if (match) {
      // Return the first non-empty capture group (backtick, double quote, or unquoted)
      return match[1] || match[2] || match[3] || null;
    }
    return null;
  }

  /**
   * Parse DROP TABLE statement to extract table name
   * Returns null if not a DROP TABLE statement
   */
  private parseDropTableStatement(sql: string): string | null {
    // Remove comments and normalize whitespace
    const normalizedSql = sql
      .replace(/--.*$/gm, "") // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
      .trim();

    // Match DROP TABLE [IF EXISTS] `table_name` or DROP TABLE [IF EXISTS] table_name
    // Handle both backtick-quoted and unquoted table names
    const dropTableRegex =
      /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:`([^`]+)`|"([^"]+)"|(\w+))/i;
    const match = normalizedSql.match(dropTableRegex);
    if (match) {
      // Return the first non-empty capture group (backtick, double quote, or unquoted)
      return match[1] || match[2] || match[3] || null;
    }
    return null;
  }

  /**
   * Execute SQL query
   */
  private async executeQuery(
    sql: string,
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
    context?: { kind: string; cleanName: string; tableName?: string },
  ): Promise<void> {
    const startTime = Date.now();

    let finalSql = sql;
    if (
      this.isSeekDBConnection(connection) &&
      context?.kind === "collection" &&
      context.cleanName
    ) {
      try {
        const { allTables } = await this.getTables(connection);
        const allTableNames = allTables.map((t) => t.name);
        const resolved = await resolveCollectionTableName(
          context.cleanName,
          allTableNames,
          async (sql: string) =>
            await this.executeSeekDBQuery(connection.id, sql),
        );
        console.log("[DatabaseProvider] resolved table name:", resolved);
        if (resolved !== context.cleanName) {
          finalSql = sql.replace(
            new RegExp(`\`${context.cleanName}\``, "g"),
            `\`${resolved}\``,
          );
          console.log(`[DatabaseProvider] Rewrote SQL: ${sql} -> ${finalSql}`);
        }
      } catch (e) {
        console.error("Error resolving table name:", e);
      }
    }

    // If it's SeekDB or OceanBase Cloud type, execute real query
    if (this.isSeekDBConnection(connection)) {
      // Check if this is a CREATE TABLE statement - if so, use SDK API instead
      const createTableName = this.parseCreateTableStatement(finalSql);
      if (createTableName) {
        // Use SDK's createCollection method for CREATE TABLE in SeekDB
        try {
          // Remove 'c$v1$' prefix if present - SDK adds it automatically
          const COLLECTION_PREFIX = "c$v1$";
          const actualCollectionName = createTableName.startsWith(
            COLLECTION_PREFIX,
          )
            ? createTableName.slice(COLLECTION_PREFIX.length)
            : createTableName;

          // Get SeekDB client
          let client = this.getSeekdbClient(connection.id);
          if (!client && connection.connected) {
            try {
              const clients = await this.createSeekdbClients(connection);
              this.seekdbClients.set(connection.id, clients);
              client = clients.client;
              this.addWarning(
                "info",
                `Reconnected to seekdb: ${connection.name}`,
              );
            } catch (reconnectError) {
              const errMsg =
                reconnectError instanceof Error
                  ? reconnectError.message
                  : String(reconnectError);
              panel.webview.postMessage({
                type: "queryError",
                data: { error: `Failed to reconnect: ${errMsg}` },
              });
              return;
            }
          }

          if (!client) {
            panel.webview.postMessage({
              type: "queryError",
              data: { error: "SeekDB client not connected" },
            });
            return;
          }

          // Create embedding function adapter from project's embedding service
          const embeddingFunction = this.createEmbeddingFunctionAdapter();
          if (!embeddingFunction) {
            panel.webview.postMessage({
              type: "queryError",
              data: {
                error:
                  "Embedding service not available. Please check your embedding configuration in settings.",
              },
            });
            return;
          }

          // Use SDK's createCollection method to properly create a vector-enabled collection
          await client.createCollection({
            name: actualCollectionName,
            embeddingFunction: embeddingFunction,
            configuration: {
              dimension: 384, // Default dimension for all-MiniLM-L6-v2 model
              distance: "cosine" as const,
            },
          });

          const executionTime = ((Date.now() - startTime) / 1000).toFixed(3);
          this.addWarning(
            "info",
            `Successfully created collection: ${actualCollectionName}`,
          );

          // Refresh collections list to show the newly created collection
          panel.webview.postMessage({
            type: "refreshCollections",
          });

          panel.webview.postMessage({
            type: "queryResult",
            data: {
              columns: [],
              rows: [],
              rowCount: 0,
              executionTime: `${executionTime}s`,
            },
          });
          return;
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          this.addWarning("error", `Failed to create collection: ${errorMsg}`);
          panel.webview.postMessage({
            type: "queryError",
            data: { error: errorMsg },
          });
          return;
        }
      }

      // Check if this is a DROP TABLE statement - if so, use SDK API instead
      const dropTableName = this.parseDropTableStatement(finalSql);
      if (dropTableName) {
        // Use SDK's deleteCollection method for DROP TABLE in SeekDB
        try {
          // Remove 'c$v1$' prefix if present - SDK handles it automatically
          const COLLECTION_PREFIX = "c$v1$";
          const actualCollectionName = dropTableName.startsWith(
            COLLECTION_PREFIX,
          )
            ? dropTableName.slice(COLLECTION_PREFIX.length)
            : dropTableName;

          // Get SeekDB client
          let client = this.getSeekdbClient(connection.id);
          if (!client && connection.connected) {
            try {
              const clients = await this.createSeekdbClients(connection);
              this.seekdbClients.set(connection.id, clients);
              client = clients.client;
              this.addWarning(
                "info",
                `Reconnected to seekdb: ${connection.name}`,
              );
            } catch (reconnectError) {
              const errMsg =
                reconnectError instanceof Error
                  ? reconnectError.message
                  : String(reconnectError);
              panel.webview.postMessage({
                type: "queryError",
                data: { error: `Failed to reconnect: ${errMsg}` },
              });
              return;
            }
          }

          if (!client) {
            panel.webview.postMessage({
              type: "queryError",
              data: { error: "SeekDB client not connected" },
            });
            return;
          }

          // Use SDK's deleteCollection() API
          // This properly cleans up vector indexes and metadata tables
          await client.deleteCollection(actualCollectionName);

          const executionTime = ((Date.now() - startTime) / 1000).toFixed(3);
          this.addWarning(
            "info",
            `Successfully deleted collection: ${actualCollectionName}`,
          );

          // Refresh collections list to reflect the deletion
          panel.webview.postMessage({
            type: "refreshCollections",
          });

          panel.webview.postMessage({
            type: "queryResult",
            data: {
              columns: [],
              rows: [],
              rowCount: 0,
              executionTime: `${executionTime}s`,
            },
          });
          return;
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          this.addWarning("error", `Failed to delete collection: ${errorMsg}`);
          panel.webview.postMessage({
            type: "queryError",
            data: { error: errorMsg },
          });
          return;
        }
      }

      // For non-CREATE/DROP TABLE queries, execute normally
      try {
        const result = await this.executeSeekDBQuery(connection.id, finalSql);
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
        this.addWarning("error", `SQL execution failed: ${errorMsg}`);
        panel.webview.postMessage({
          type: "queryError",
          data: { error: errorMsg },
        });
      }
    } else if (this.isOceanBaseCloudConnection(connection)) {
      try {
        const result = await this.executeOceanBaseCloudQuery(
          connection.id,
          finalSql,
        );
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
        this.addWarning("error", `SQL execution failed: ${errorMsg}`);
        panel.webview.postMessage({
          type: "queryError",
          data: { error: errorMsg },
        });
      }
    } else {
      // Non-SeekDB type, use mock data
      const mockData = this.getMockQueryResult(sql);
      panel.webview.postMessage({
        type: "queryResult",
        data: mockData,
      });
    }
  }

  /**
   * Execute OceanBase Cloud SQL query using MySQL compatible mode
   */
  private async executeOceanBaseCloudQuery(
    connectionId: string,
    sql: string,
  ): Promise<QueryResultData> {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection) {
      throw new Error("Connection does not exist");
    }

    const mysql = await import("mysql2/promise");

    // OceanBase Cloud uses plain username (not user@tenant format)
    const userString = connection.user;

    const conn = await mysql.createConnection({
      host: connection.host,
      port: connection.port,
      user: userString,
      password: connection.password,
      database: connection.database || "test",
      connectTimeout: 10000,
    });

    try {
      const [rows, fields] = await conn.execute(sql);

      // Parse results - fields may be undefined or ResultSetHeader for DDL statements
      const columns = Array.isArray(fields)
        ? (fields as any[]).map((field: any) => ({
            name: field.name,
            type: this.mysqlTypeToString(field.type, field.length),
          }))
        : [];

      // Sort columns: put metadata before embedding-related columns
      const embeddingColumns = ["embedding", "_vector", "vector", "embeddings"];
      const sortedColumns = this.sortColumnsWithMetadataFirst(
        columns,
        embeddingColumns,
      );

      const resultRows = Array.isArray(rows) ? (rows as any[]) : [];

      // Convert Buffer fields to strings (for BLOB/BINARY types like _id)
      const processedRows = resultRows.map((row) => {
        const processedRow: Record<string, any> = {};
        for (const [key, value] of Object.entries(row)) {
          if (Buffer.isBuffer(value)) {
            // Convert Buffer to UTF-8 string
            processedRow[key] = value.toString("utf-8");
          } else {
            processedRow[key] = value;
          }
        }
        return processedRow;
      });

      return {
        columns: sortedColumns,
        rows: processedRows,
        rowCount: processedRows.length,
        executionTime: "0s",
      };
    } finally {
      await conn.end();
    }
  }

  /**
   * Execute SeekDB SQL query
   */
  private async executeSeekDBQuery(
    connectionId: string,
    sql: string,
  ): Promise<QueryResultData> {
    const connection = this.connections.find((c) => c.id === connectionId);
    if (!connection) {
      throw new Error("Connection does not exist");
    }

    // Create temporary client to execute query
    const tempClient = new SeekdbClient({
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password: connection.password,
      tenant: connection.tenant || DEFAULT_TENANT,
      database: connection.database || DEFAULT_DATABASE,
    });

    try {
      // Use mysql2 to execute SQL directly
      // SeekdbClient uses mysql2 internally, we create a new connection to execute raw SQL
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

      // Parse results - fields may be undefined or ResultSetHeader for DDL statements
      const columns = Array.isArray(fields)
        ? (fields as any[]).map((field: any) => ({
            name: field.name,
            type: this.mysqlTypeToString(field.type, field.length),
          }))
        : [];

      // Sort columns: put metadata before embedding-related columns
      const embeddingColumns = ["embedding", "_vector", "vector", "embeddings"];
      const sortedColumns = this.sortColumnsWithMetadataFirst(
        columns,
        embeddingColumns,
      );

      const resultRows = Array.isArray(rows) ? (rows as any[]) : [];

      // Convert Buffer fields to strings (for BLOB/BINARY types like _id)
      const processedRows = resultRows.map((row) => {
        const processedRow: Record<string, any> = {};
        for (const [key, value] of Object.entries(row)) {
          if (Buffer.isBuffer(value)) {
            // Convert Buffer to UTF-8 string
            processedRow[key] = value.toString("utf-8");
          } else {
            processedRow[key] = value;
          }
        }
        return processedRow;
      });

      return {
        columns: sortedColumns,
        rows: processedRows,
        rowCount: processedRows.length,
        executionTime: "0s",
      };
    } catch (error) {
      throw error;
    } finally {
      await tempClient.close();
    }
  }

  /**
   * MySQL type to string
   */
  private mysqlTypeToString(type: number, length?: number): string {
    // MySQL type constant mapping
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
   * Sort columns: put metadata before embedding-related columns
   */
  private sortColumnsWithMetadataFirst(
    columns: { name: string; type: string }[],
    embeddingColumns: string[],
  ): { name: string; type: string }[] {
    const embeddingSet = new Set(
      embeddingColumns.map((name) => name.toLowerCase()),
    );

    // Find metadata and embedding column indices
    const metadataIndex = columns.findIndex(
      (col) => col.name.toLowerCase() === "metadata",
    );
    const firstEmbeddingIndex = columns.findIndex((col) =>
      embeddingSet.has(col.name.toLowerCase()),
    );

    // If both exist and metadata is after embedding, swap them
    if (
      metadataIndex !== -1 &&
      firstEmbeddingIndex !== -1 &&
      metadataIndex > firstEmbeddingIndex
    ) {
      // Create a new sorted array
      const sortedColumns = [...columns];

      // Remove metadata from its current position
      const [metadataCol] = sortedColumns.splice(metadataIndex, 1);

      // Insert metadata before the first embedding column
      sortedColumns.splice(firstEmbeddingIndex, 0, metadataCol);

      return sortedColumns;
    }

    return columns;
  }

  /**
   * 加载集合数据
   */
  private async loadCollectionData(
    collectionName: string,
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (this.isSeekDBConnection(connection)) {
      try {
        // For SeekDB, collection names are typically clean, but backing tables may use c$v1$/c$v2$ prefixes.
        // Resolve to the actual table name that exists in the database.
        const { cleanName } = stripCollectionPrefix(collectionName);
        const { allTables } = await this.getTables(connection);
        const allTableNames = allTables.map((t) => t.name);
        const tableName = await resolveCollectionTableName(
          cleanName,
          allTableNames,
          async (sql: string) =>
            await this.executeSeekDBQuery(connection.id, sql),
        );
        console.log(
          "[DatabaseProvider] loadCollectionData resolved table name:",
          tableName,
        );

        // 构建 SELECT 查询
        const sql = `SELECT * FROM \`${tableName}\` LIMIT 1000`;
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
        this.addWarning("error", `Failed to load collection data: ${errorMsg}`);
        panel.webview.postMessage({
          type: "queryError",
          data: { error: errorMsg },
        });
      }
    } else if (this.isOceanBaseCloudConnection(connection)) {
      try {
        // 构建 SELECT 查询
        const sql = `SELECT * FROM \`${collectionName}\` LIMIT 1000`;
        const result = await this.executeOceanBaseCloudQuery(
          connection.id,
          sql,
        );

        panel.webview.postMessage({
          type: "collectionData",
          data: {
            collectionName,
            ...result,
          },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.addWarning("error", `Failed to load collection data: ${errorMsg}`);
        panel.webview.postMessage({
          type: "queryError",
          data: { error: errorMsg },
        });
      }
    } else {
      // Non-SeekDB type, use mock data
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
   * Load table data (SeekDB plain tables, no collection prefix rewriting)
   */
  private async loadTableData(
    tableName: string,
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (this.isSeekDBConnection(connection)) {
      try {
        const sql = `SELECT * FROM \`${tableName}\` LIMIT 1000`;
        const result = await this.executeSeekDBQuery(connection.id, sql);
        panel.webview.postMessage({
          type: "collectionData",
          data: {
            collectionName: tableName,
            ...result,
          },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.addWarning("error", `Failed to load table data: ${errorMsg}`);
        panel.webview.postMessage({
          type: "queryError",
          data: { error: errorMsg },
        });
      }
      return;
    }

    if (this.isOceanBaseCloudConnection(connection)) {
      // OceanBase Cloud tables are already handled as collections/tables uniformly.
      await this.loadCollectionData(tableName, panel, connection);
      return;
    }

    const mockData = this.getMockCollectionData(tableName);
    panel.webview.postMessage({
      type: "collectionData",
      data: {
        collectionName: tableName,
        ...mockData,
      },
    });
  }

  /**
   * Refresh collections list
   */
  private async refreshCollections(
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    console.log(
      "[DatabaseProvider] refreshCollections called, isSeekDB:",
      this.isSeekDBConnection(connection),
      "isOceanBaseCloud:",
      this.isOceanBaseCloudConnection(connection),
    );
    console.log("[DatabaseProvider] refreshCollections connection:", {
      id: connection.id,
      name: connection.name,
      type: connection.type,
      host: connection.host,
      port: connection.port,
      user: connection.user,
      tenant: connection.tenant,
      database: connection.database || DEFAULT_DATABASE,
    });
    if (this.isSeekDBConnection(connection)) {
      try {
        console.log(
          "[DatabaseProvider] Getting SeekDB collections and tables...",
          `Connection: ${connection.name}, Database: ${
            connection.database || DEFAULT_DATABASE
          }`,
        );

        // 1. Get collections via SDK
        // Note: SDK automatically handles c$v1$ prefix and returns clean names
        const collections = await this.getSeekDBCollections(connection);

        // 2. Get tables via MySQL SHOW TABLES (filtering out collection backing tables)
        const { tables } = await this.getTables(connection);

        console.log(
          `[DatabaseProvider] Got ${collections.length} collections and ${tables.length} tables`,
        );

        panel.webview.postMessage({
          type: "collectionsList",
          data: { collections, tables },
        });
        console.log(
          "[DatabaseProvider] Sent collectionsList message with collections and tables",
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error(
          "[DatabaseProvider] Error getting collections/tables:",
          errorMsg,
          errorStack ? `\nStack: ${errorStack}` : "",
        );
        this.addWarning(
          "error",
          `Failed to get collections/tables list: ${errorMsg}`,
        );
        panel.webview.postMessage({
          type: "collectionsError",
          data: { error: errorMsg },
        });
      }
    } else if (this.isOceanBaseCloudConnection(connection)) {
      try {
        console.log(
          "[DatabaseProvider] Getting OceanBase Cloud collections...",
        );
        const collections = await this.getOceanBaseCloudCollections(connection);
        console.log("[DatabaseProvider] Got collections:", collections.length);
        panel.webview.postMessage({
          type: "collectionsList",
          data: { collections },
        });
        console.log("[DatabaseProvider] Sent collectionsList message");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(
          "[DatabaseProvider] Error getting collections:",
          errorMsg,
        );
        this.addWarning("error", `Failed to get collections list: ${errorMsg}`);
        panel.webview.postMessage({
          type: "collectionsError",
          data: { error: errorMsg },
        });
      }
    } else {
      // Non-SeekDB type, use mock data
      console.log("[DatabaseProvider] Using mock collections");
      const mockCollections = this.getMockCollections();
      panel.webview.postMessage({
        type: "collectionsList",
        data: { collections: mockCollections },
      });
    }
  }

  /**
   * Get SeekDB tables list (excluding collections)
   * allTables: all tables in the database, including collections
   * tables: tables in the database excluding collections
   */
  private async getTables(
    connection: DatabaseConnection,
  ): Promise<{ allTables: CollectionInfo[]; tables: CollectionInfo[] }> {
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
      const allTables = (rows as any[]).map((row: any) => {
        const tableName = Object.values(row)[0] as string;
        return {
          name: tableName,
          type: "table",
        };
      });
      const tables = allTables.filter(
        (table) => !isCollectionBackingTable(table.name),
      );
      return { tables, allTables };
    } finally {
      await conn.end();
    }
  }

  /**
   * Get OceanBase Cloud collections list (tables)
   */
  private async getOceanBaseCloudCollections(
    connection: DatabaseConnection,
  ): Promise<CollectionInfo[]> {
    const mysql = await import("mysql2/promise");

    // OceanBase Cloud uses plain username (not user@tenant format)
    const userString = connection.user;

    const conn = await mysql.createConnection({
      host: connection.host,
      port: connection.port,
      user: userString,
      password: connection.password,
      database: connection.database || "test",
      connectTimeout: 10000,
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
   * Get SeekDB collections list using seekdb-js SDK
   * The SDK automatically handles the 'c$v1$' prefix internally,
   * so the returned collection names are already clean (without prefix).
   * Falls back to SHOW TABLES if listCollections() returns empty (for compatibility with legacy tables).
   */
  private async getSeekDBCollections(
    connection: DatabaseConnection,
  ): Promise<CollectionInfo[]> {
    // Get or create SeekdbClient instance
    let client = this.getSeekdbClient(connection.id);
    if (!client) {
      const clients = await this.createSeekdbClients(connection);
      this.seekdbClients.set(connection.id, clients);
      client = clients.client;
    }

    if (!client) {
      throw new Error("Failed to create SeekDB client");
    }

    // Check if client is connected
    if (!client.isConnected()) {
      console.warn(
        "[DatabaseProvider] SeekDB client is not connected, attempting to reconnect...",
      );
      // Close and recreate client
      await this.closeSeekdbClients(connection.id);
      const clients = await this.createSeekdbClients(connection);
      this.seekdbClients.set(connection.id, clients);
      client = clients.client;
      if (!client) {
        throw new Error("Failed to recreate SeekDB client");
      }
    }

    try {
      // Use standard listCollections API from seekdb-js SDK
      // The SDK automatically handles 'c$v1$' prefix removal internally
      console.log("[DatabaseProvider] listCollections() start:", {
        connectionId: connection.id,
        connectionName: connection.name,
        host: connection.host,
        port: connection.port,
        user: connection.user,
        tenant: connection.tenant,
        database: connection.database || DEFAULT_DATABASE,
        clientConnected: client.isConnected(),
      });
      const allCollections = await client.listCollections({
        withEmbeddingFunction: false,
      });

      console.log(
        `[DatabaseProvider] listCollections() returned ${allCollections.length} collections`,
      );

      if (allCollections.length > 0) {
        const collectionNames = allCollections.map((col) => col.name);
        console.log(
          `[DatabaseProvider] Collection names from SDK: ${collectionNames.join(", ")}`,
        );
      } else {
        console.warn(
          "[DatabaseProvider] listCollections() returned empty array; connection/database may be wrong or SDK returned no collections.",
        );
      }

      // If SDK returns collections, use them
      return allCollections.map((col) => ({
        name: col.name,
        type: "collection",
      }));
    } catch (sdkError) {
      const sdkErrorMsg =
        sdkError instanceof Error ? sdkError.message : String(sdkError);
      const sdkErrorStack =
        sdkError instanceof Error ? sdkError.stack : undefined;
      console.warn(
        `[DatabaseProvider] listCollections() failed: ${sdkErrorMsg}`,
        sdkErrorStack ? `\nStack: ${sdkErrorStack}` : "",
      );

      // Fallback: Use SHOW TABLES to get potential collections (for compatibility)
      console.log(
        "[DatabaseProvider] Falling back to SHOW TABLES for collections",
      );

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
        const collections: CollectionInfo[] = [];

        for (const row of rows as any[]) {
          const tableName = Object.values(row)[0] as string;
          // Check if it looks like a collection table (starts with c$v1$ or c$v2$)
          const { cleanName, prefix } = stripCollectionPrefix(tableName);

          if (prefix) {
            collections.push({
              name: cleanName,
              type: "collection",
            });
          }
        }

        console.log(
          `[DatabaseProvider] SHOW TABLES fallback found ${collections.length} collections`,
        );
        return collections;
      } finally {
        await conn.end();
      }
    }
  }

  /**
   * Get mock collections list
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
   * Get mock query result
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
   * Get mock collection data
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
   * Get warnings
   */
  public getWarnings(): WarningMessage[] {
    return [...this.warnings];
  }

  /**
   * Clear warnings
   */
  public clearWarnings(): void {
    this.warnings = [];
  }

  /**
   * Calculate hash of text (for cache key)
   */
  private hashText(text: string): string {
    // Use simple hash algorithm to generate cache key
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `embed_${Math.abs(hash).toString(36)}_${text.length}`;
  }

  /**
   * Update embedding cache (with size limit)
   */
  private updateCache(key: string, vector: number[]): void {
    // If cache is full, delete oldest entry (simple strategy: delete first)
    if (this.embeddingCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.embeddingCache.keys().next().value;
      if (firstKey) {
        this.embeddingCache.delete(firstKey);
      }
    }
    this.embeddingCache.set(key, vector);
  }

  /**
   * Handle vector similarity search
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
    connection: DatabaseConnection,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const { query, collectionName, limit = 10, embeddingType, apiKey } = data;

      if (!query || !query.trim()) {
        panel.webview.postMessage({
          type: "vectorSearchError",
          data: { error: "Query text cannot be empty" },
        });
        return;
      }

      if (!this.isSeekDBConnection(connection)) {
        panel.webview.postMessage({
          type: "vectorSearchError",
          data: { error: "Vector search only supports seekdb connections" },
        });
        return;
      }

      // Create or get embedding service
      let embeddingService = this.embeddingService;
      if (embeddingType && embeddingType !== "builtin") {
        // If external model is specified, create service instance from config
        const config = vscode.workspace.getConfiguration(
          "seekdb.database.embedding",
        );

        switch (embeddingType) {
          case "openai": {
            const openaiApiKey =
              apiKey || config.get<string>("openaiApiKey", "");
            const openaiBaseUrl = config.get<string>(
              "openaiBaseUrl",
              "https://api.openai.com/v1",
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
              "http://localhost:11434",
            );
            const ollamaModel = config.get<string>(
              "ollamaModel",
              "nomic-embed-text",
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
              "https://api.anthropic.com",
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
              "https://dashscope.aliyuncs.com",
            );
            embeddingService = EmbeddingServiceFactory.create("qwen", {
              apiKey: qwenApiKey,
              baseUrl: qwenBaseUrl,
            });
            break;
          }
          default:
            throw new Error(`Unsupported embedding type: ${embeddingType}`);
        }
      }

      if (!embeddingService) {
        // Create service using default settings from config
        embeddingService = EmbeddingServiceFactory.createFromConfig(
          vscode.workspace.getConfiguration("seekdb.database"),
        );
      }

      // Convert query text to vector (use cache)
      const queryText = query.trim();
      const queryHash = this.hashText(queryText);
      let queryVector = this.embeddingCache.get(queryHash);

      if (!queryVector) {
        vscode.window.showInformationMessage("Vectorizing query text...");
        queryVector = await embeddingService.embed(queryText);
        this.updateCache(queryHash, queryVector);
      }

      // Get data from collection
      // For SeekDB, collection names from listCollections() are clean (without prefix)
      // But actual table names have 'c$v1$' prefix, so we need to add it back for SQL queries
      const COLLECTION_PREFIX = "c$v1$";
      const tableName = collectionName.startsWith(COLLECTION_PREFIX)
        ? collectionName
        : `${COLLECTION_PREFIX}${collectionName}`;
      const sql = `SELECT * FROM \`${tableName}\` LIMIT 1000`;
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

      // Check for pre-stored vector field (common vector field names)
      const vectorFieldNames = ["_vector", "embedding", "vector", "embeddings"];
      let vectorFieldName: string | null = null;

      // Check if first row has vector field
      if (collectionData.rows.length > 0) {
        const firstRow = collectionData.rows[0];
        for (const fieldName of vectorFieldNames) {
          if (
            firstRow[fieldName] !== undefined &&
            firstRow[fieldName] !== null
          ) {
            // Check if it's array format vector
            const vectorValue = firstRow[fieldName];
            if (
              Array.isArray(vectorValue) &&
              vectorValue.length > 0 &&
              typeof vectorValue[0] === "number"
            ) {
              vectorFieldName = fieldName;
              break;
            }
            // Check if it's JSON string format vector
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
                // Not JSON, continue checking next field
              }
            }
          }
        }
      }

      // Vectorize and calculate similarity for each row (parallel processing)
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
          `Detected vector field "${vectorFieldName}", using stored vectors for calculation...`,
        );
      } else {
        vscode.window.showInformationMessage(
          `No vector field detected, processing ${totalRows} rows in parallel for vectorization...`,
        );
      }

      // Prepare text and vectorization tasks for all rows
      const rowTasks = collectionData.rows.map(async (row) => {
        try {
          let rowVector: number[] | null = null;

          // If vector field exists, use it directly
          if (
            vectorFieldName &&
            row[vectorFieldName] !== undefined &&
            row[vectorFieldName] !== null
          ) {
            const vectorValue = row[vectorFieldName];

            if (Array.isArray(vectorValue)) {
              // Already in array format
              rowVector = vectorValue;
              vectorFieldUsed++;
            } else if (typeof vectorValue === "string") {
              // Try to parse JSON string
              try {
                const parsed = JSON.parse(vectorValue);
                if (Array.isArray(parsed)) {
                  rowVector = parsed;
                  vectorFieldUsed++;
                }
              } catch {
                // Parse failed, continue with text vectorization
              }
            }
          }

          // If no vector field or parse failed, perform text vectorization
          if (!rowVector) {
            // Convert row data to text (select all text fields, exclude vector fields)
            const textFields: string[] = [];
            for (const [key, value] of Object.entries(row)) {
              // Skip vector fields
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

            // Check cache
            const textHash = this.hashText(rowText);
            rowVector = this.embeddingCache.get(textHash) || null;

            // If not in cache, vectorize and cache
            if (!rowVector) {
              cacheMisses++;
              rowVector = await embeddingService.embed(rowText);
              // Update cache (if cache is full, delete oldest entry)
              this.updateCache(textHash, rowVector);
            } else {
              cacheHits++;
            }
          }

          // Calculate similarity
          const similarity = cosineSimilarity(queryVector, rowVector);

          return {
            row,
            similarity,
          };
        } catch (error) {
          console.error("Error processing row data:", error);
          // Return null to skip this row
          return null;
        }
      });

      // Execute all vectorization tasks in parallel
      const rowResults = await Promise.all(rowTasks);

      // Filter out null values (rows with errors)
      for (const result of rowResults) {
        if (result !== null) {
          results.push(result);
        }
      }

      // Log statistics (only output in dev mode)
      if (vectorFieldName) {
        console.log(
          `Vector search statistics: using stored vector field "${vectorFieldName}", ${vectorFieldUsed} records`,
        );
      } else if (cacheHits > 0 || cacheMisses > 0) {
        const hitRate = ((cacheHits / (cacheHits + cacheMisses)) * 100).toFixed(
          1,
        );
        console.log(
          `Vector search cache statistics: hit ${cacheHits} times, miss ${cacheMisses} times, hit rate ${hitRate}%`,
        );
      }

      // Sort by similarity
      results.sort((a, b) => b.similarity - a.similarity);

      // Get top limit results
      const topResults = results.slice(0, limit);

      // Get search model name
      const searchModelName = embeddingService.getModelName();

      // Infer collection model used (if vector field exists, try to infer from metadata, otherwise null)
      let collectionModelName: string | null = null;
      if (vectorFieldName) {
        // If vector field exists, try to infer model from data
        // Can infer model by vector dimension: 384 dimensions usually means all-MiniLM-L6-v2, 1536 dimensions usually means OpenAI text-embedding-3-small
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
              // Parse failed
            }
          }

          // Infer model by vector dimension
          if (vectorLength === 384) {
            // 384 dimensions usually means all-MiniLM-L6-v2
            // Note: Simple TF-IDF also produces 384 dimensions, but we assume it's the real model
            collectionModelName = "Builtin (Xenova/all-MiniLM-L6-v2)";
          } else if (vectorLength === 1536) {
            collectionModelName = "OpenAI text-embedding-3-small";
          } else if (vectorLength === 3072) {
            collectionModelName = "OpenAI text-embedding-3-large";
          } else if (vectorLength > 0) {
            collectionModelName = `Unknown (${vectorLength} dimensions)`;
          } else {
            collectionModelName = "Unknown";
          }
        }
      } else {
        // No vector field, means data is not vectorized
        collectionModelName = null;
      }

      // Build result data
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

      // Check if models might be inconsistent and warn user
      let modelWarning: string | null = null;
      if (collectionModelName && searchModelName) {
        // Extract base model name for comparison (ignore prefixes like "Builtin", "OpenAI")
        const normalizeModelName = (name: string) =>
          name
            .toLowerCase()
            .replace(/^(builtin|openai|ollama|anthropic|qwen)\s*/, "")
            .replace(/[()]/g, "")
            .trim();

        const collectionBase = normalizeModelName(collectionModelName);
        const searchBase = normalizeModelName(searchModelName);

        // If model names are significantly different, show warning
        if (
          collectionBase !== searchBase &&
          !collectionBase.includes("unknown") &&
          !searchBase.includes("unknown")
        ) {
          modelWarning = `⚠️ Model mismatch detected: Collection was vectorized with a different model than the search model. This may affect search accuracy.`;
        }
      }

      panel.webview.postMessage({
        type: "vectorSearchResult",
        data: {
          query,
          ...resultData,
          // Add model information
          collectionModelName,
          searchModelName,
          modelWarning,
        },
      });

      const infoMessage = modelWarning
        ? `Vector search completed with model mismatch warning`
        : `Vector search completed, found ${topResults.length} similar results`;

      vscode.window.showInformationMessage(infoMessage);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Vector search failed: ${errorMsg}`);
      panel.webview.postMessage({
        type: "vectorSearchError",
        data: { error: errorMsg },
      });
      vscode.window.showErrorMessage(`Vector search failed: ${errorMsg}`);
    }
  }

  /**
   * Generate collection browser page HTML
   * Use React components to render, load from build artifacts
   */
  private getCollectionBrowserHtml(
    webview: vscode.Webview,
    connection: DatabaseConnection,
  ): string {
    const isSeekDB = this.isSeekDBConnection(connection);
    const isOceanBaseCloud = this.isOceanBaseCloudConnection(connection);

    // Inject configuration into page
    const config = {
      __VSCODE_CONNECTION_INFO__: {
        name: connection.name,
        host: connection.host,
        port: connection.port,
        database: connection.database,
      },
      __VSCODE_IS_SEEKDB__: isSeekDB,
      __VSCODE_IS_OCEANBASE_CLOUD__: isOceanBaseCloud,
    };

    return this.htmlLoader.loadPage(webview, "CollectionBrowserPage", config);
  }

  /**
   * Generate connection page HTML
   * Use React components to render, load from build artifacts
   */
  private getConnectPageHtml(
    webview: vscode.Webview,
    defaultConfig: any,
  ): string {
    // Inject configuration into page
    const config = {
      __VSCODE_DEFAULT_CONFIG__: defaultConfig,
    };

    return this.htmlLoader.loadPage(webview, "ConnectPage", config);
  }

  /**
   * Get storage key for saved queries
   */
  private getSavedQueriesKey(connectionId: string): string {
    return `savedQueries_${connectionId}`;
  }

  /**
   * Get saved queries for a connection
   */
  private getSavedQueries(connectionId: string): SavedQuery[] {
    const key = this.getSavedQueriesKey(connectionId);
    return this.context.globalState.get<SavedQuery[]>(key, []);
  }

  /**
   * Save queries for a connection
   */
  private saveSavedQueries(connectionId: string, queries: SavedQuery[]): void {
    const key = this.getSavedQueriesKey(connectionId);
    this.context.globalState.update(key, queries);
  }

  /**
   * Handle get saved queries
   */
  private async handleGetSavedQueries(
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    const queries = this.getSavedQueries(connection.id);
    panel.webview.postMessage({
      type: "savedQueriesList",
      data: { queries },
    });
  }

  /**
   * Handle save query
   */
  private async handleSaveQuery(
    data: { name: string; sql: string },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    const queries = this.getSavedQueries(connection.id);
    const now = Date.now();
    const newQuery: SavedQuery = {
      id: `query_${now}_${Math.random().toString(36).substr(2, 9)}`,
      name: data.name,
      sql: data.sql,
      createdAt: now,
      updatedAt: now,
    };
    queries.push(newQuery);
    this.saveSavedQueries(connection.id, queries);

    panel.webview.postMessage({
      type: "querySaved",
      data: newQuery,
    });
  }

  /**
   * Handle update query
   */
  private async handleUpdateQuery(
    data: { id: string; name?: string; sql?: string },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    const queries = this.getSavedQueries(connection.id);
    const index = queries.findIndex((q) => q.id === data.id);
    if (index >= 0) {
      if (data.name !== undefined) {
        queries[index].name = data.name;
      }
      if (data.sql !== undefined) {
        queries[index].sql = data.sql;
      }
      queries[index].updatedAt = Date.now();
      this.saveSavedQueries(connection.id, queries);

      panel.webview.postMessage({
        type: "queryUpdated",
        data: queries[index],
      });
    }
  }

  /**
   * Handle delete query
   */
  private async handleDeleteQuery(
    data: { id: string },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    const queries = this.getSavedQueries(connection.id);
    const filteredQueries = queries.filter((q) => q.id !== data.id);
    this.saveSavedQueries(connection.id, filteredQueries);

    panel.webview.postMessage({
      type: "queryDeleted",
      data: { id: data.id },
    });
  }

  /**
   * Handle create collection
   */
  private async handleCreateCollection(
    data: { name: string },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isSeekDBConnection(connection)) {
      panel.webview.postMessage({
        type: "collectionError",
        data: { error: "Only SeekDB connections support creating collections" },
      });
      return;
    }

    try {
      const collectionName = data.name.trim();
      if (!collectionName) {
        panel.webview.postMessage({
          type: "collectionError",
          data: { error: "Collection name cannot be empty" },
        });
        return;
      }

      // Get SeekDB client
      let client = this.getSeekdbClient(connection.id);
      if (!client && connection.connected) {
        try {
          const clients = await this.createSeekdbClients(connection);
          this.seekdbClients.set(connection.id, clients);
          client = clients.client;
          this.addWarning("info", `Reconnected to seekdb: ${connection.name}`);
        } catch (reconnectError) {
          const errMsg =
            reconnectError instanceof Error
              ? reconnectError.message
              : String(reconnectError);
          panel.webview.postMessage({
            type: "collectionError",
            data: { error: `Failed to reconnect: ${errMsg}` },
          });
          return;
        }
      }

      if (!client) {
        panel.webview.postMessage({
          type: "collectionError",
          data: { error: "SeekDB client not connected" },
        });
        return;
      }

      // Remove 'c$v1$' prefix if present - SDK adds it automatically
      const COLLECTION_PREFIX = "c$v1$";
      const actualCollectionName = collectionName.startsWith(COLLECTION_PREFIX)
        ? collectionName.slice(COLLECTION_PREFIX.length)
        : collectionName;

      // Create embedding function adapter from project's embedding service
      const embeddingFunction = this.createEmbeddingFunctionAdapter();
      if (!embeddingFunction) {
        panel.webview.postMessage({
          type: "collectionError",
          data: {
            error:
              "Embedding service not available. Please check your embedding configuration in settings.",
          },
        });
        return;
      }

      // Show info message about using embedding model
      const modelName = embeddingFunction.name;
      vscode.window.showInformationMessage(
        `Creating collection with vectorization using: ${modelName}`,
      );

      // Use SDK's createCollection method to properly create a vector-enabled collection
      await client.createCollection({
        name: actualCollectionName,
        embeddingFunction: embeddingFunction,
        configuration: {
          dimension: 384, // Default dimension for all-MiniLM-L6-v2 model
          distance: "cosine" as const,
        },
      });

      this.addWarning(
        "info",
        `Successfully created collection: ${collectionName}`,
      );
      vscode.window.showInformationMessage(
        `Successfully created collection: ${collectionName}`,
      );

      panel.webview.postMessage({
        type: "collectionCreated",
        data: { name: collectionName },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Failed to create collection: ${errorMsg}`);
      panel.webview.postMessage({
        type: "collectionError",
        data: { error: errorMsg },
      });
    }
  }

  /**
   * Handle delete collection - uses SeekDB SDK API
   */
  private async handleDeleteCollection(
    data: { name: string },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isSeekDBConnection(connection)) {
      panel.webview.postMessage({
        type: "collectionError",
        data: { error: "Only SeekDB connections support deleting collections" },
      });
      return;
    }

    try {
      const collectionName = data.name.trim();
      if (!collectionName) {
        panel.webview.postMessage({
          type: "collectionError",
          data: { error: "Collection name cannot be empty" },
        });
        return;
      }

      // Get SeekDB client
      let client = this.getSeekdbClient(connection.id);
      if (!client && connection.connected) {
        try {
          const clients = await this.createSeekdbClients(connection);
          this.seekdbClients.set(connection.id, clients);
          client = clients.client;
          this.addWarning("info", `Reconnected to seekdb: ${connection.name}`);
        } catch (reconnectError) {
          const errMsg =
            reconnectError instanceof Error
              ? reconnectError.message
              : String(reconnectError);
          panel.webview.postMessage({
            type: "collectionError",
            data: { error: `Failed to reconnect: ${errMsg}` },
          });
          return;
        }
      }

      if (!client) {
        panel.webview.postMessage({
          type: "collectionError",
          data: { error: "SeekDB client not connected" },
        });
        return;
      }

      // Remove 'c$v1$' prefix if present - SDK handles it automatically
      const COLLECTION_PREFIX = "c$v1$";
      const actualCollectionName = collectionName.startsWith(COLLECTION_PREFIX)
        ? collectionName.slice(COLLECTION_PREFIX.length)
        : collectionName;

      // Use SDK's deleteCollection() API
      // This properly cleans up vector indexes and metadata tables
      await client.deleteCollection(actualCollectionName);

      this.addWarning(
        "info",
        `Successfully deleted collection: ${collectionName}`,
      );
      vscode.window.showInformationMessage(
        `Successfully deleted collection: ${collectionName}`,
      );

      panel.webview.postMessage({
        type: "collectionDeleted",
        data: { name: collectionName },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Failed to delete collection: ${errorMsg}`);
      panel.webview.postMessage({
        type: "collectionError",
        data: { error: errorMsg },
      });
    }
  }

  /**
   * Handle rename collection
   *
   * WARNING: seekdb SDK 1.0.0 does not provide a renameCollection() API.
   * This implementation uses direct SQL (RENAME TABLE), which may cause
   * inconsistencies with vector indexes and metadata tables.
   *
   * Recommendation: Consider implementing as delete + recreate + migrate data
   * for collections created via SDK, or warn users about potential issues.
   */
  private async handleRenameCollection(
    data: { oldName: string; newName: string },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isSeekDBConnection(connection)) {
      panel.webview.postMessage({
        type: "collectionError",
        data: { error: "Only SeekDB connections support renaming collections" },
      });
      return;
    }

    try {
      const oldName = data.oldName.trim();
      const newName = data.newName.trim();

      if (!oldName || !newName) {
        panel.webview.postMessage({
          type: "collectionError",
          data: { error: "Collection name cannot be empty" },
        });
        return;
      }

      if (oldName === newName) {
        panel.webview.postMessage({
          type: "collectionError",
          data: { error: "New name is the same as the old name" },
        });
        return;
      }

      // For SeekDB, collection names should have 'c$v1$' prefix for table names
      // If user provides clean name, add prefix; if already has prefix, use as is
      const COLLECTION_PREFIX = "c$v1$";
      const oldTableName = oldName.startsWith(COLLECTION_PREFIX)
        ? oldName
        : `${COLLECTION_PREFIX}${oldName}`;
      const newTableName = newName.startsWith(COLLECTION_PREFIX)
        ? newName
        : `${COLLECTION_PREFIX}${newName}`;

      // Rename table using SQL
      // NOTE: This only renames the main table, not the vector index metadata
      // This may cause issues with collections created via SDK
      const renameTableSql = `RENAME TABLE \`${oldTableName}\` TO \`${newTableName}\``;
      await this.executeSeekDBQuery(connection.id, renameTableSql);

      this.addWarning(
        "info",
        `Successfully renamed collection: ${oldName} -> ${newName}`,
      );
      vscode.window.showInformationMessage(
        `Successfully renamed collection: ${oldName} -> ${newName}`,
      );

      panel.webview.postMessage({
        type: "collectionRenamed",
        data: { oldName, newName },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Failed to rename collection: ${errorMsg}`);
      panel.webview.postMessage({
        type: "collectionError",
        data: { error: errorMsg },
      });
    }
  }

  /**
   * Handle delete document - uses SeekDB Collection API
   */
  private async handleDeleteDocument(
    data: {
      collectionName: string;
      documentId: any;
      rowData: Record<string, any>;
    },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isSeekDBConnection(connection)) {
      panel.webview.postMessage({
        type: "documentError",
        data: { error: "Only SeekDB connections support deleting documents" },
      });
      return;
    }

    try {
      const { collectionName, documentId, rowData } = data;

      if (!collectionName) {
        panel.webview.postMessage({
          type: "documentError",
          data: { error: "Collection name is required" },
        });
        return;
      }

      // Get document ID (_id field is the standard field name in SeekDB Collection)
      const docId = documentId || rowData._id || rowData.id;

      if (!docId) {
        panel.webview.postMessage({
          type: "documentError",
          data: { error: "Cannot identify document to delete (no _id found)" },
        });
        return;
      }

      // Get SeekDB client, try to reconnect if not connected
      let client = this.getSeekdbClient(connection.id);
      if (!client && connection.connected) {
        try {
          const clients = await this.createSeekdbClients(connection);
          this.seekdbClients.set(connection.id, clients);
          client = clients.client;
          this.addWarning("info", `Reconnected to seekdb: ${connection.name}`);
        } catch (reconnectError) {
          const errMsg =
            reconnectError instanceof Error
              ? reconnectError.message
              : String(reconnectError);
          panel.webview.postMessage({
            type: "documentError",
            data: { error: `Failed to reconnect: ${errMsg}` },
          });
          return;
        }
      }

      if (!client) {
        panel.webview.postMessage({
          type: "documentError",
          data: { error: "SeekDB client not connected" },
        });
        return;
      }

      // Extract collection name (remove c$v1$ prefix if present)
      // Note: SDK's getCollection() automatically adds 'c$v1$' prefix internally,
      // so we must ensure the name passed to SDK is clean (without prefix).
      // This defensive check handles cases where collectionName might already include the prefix.
      const COLLECTION_PREFIX = "c$v1$";
      const actualCollectionName = collectionName.startsWith(COLLECTION_PREFIX)
        ? collectionName.slice(COLLECTION_PREFIX.length)
        : collectionName;

      // Get collection with embeddingFunction set to null (not needed for delete)
      let collection;
      try {
        collection = await client.getCollection({
          name: actualCollectionName,
          embeddingFunction: null,
        });
      } catch (getCollectionError) {
        const errMsg =
          getCollectionError instanceof Error
            ? getCollectionError.message
            : String(getCollectionError);
        panel.webview.postMessage({
          type: "documentError",
          data: { error: `Failed to get collection: ${errMsg}` },
        });
        return;
      }

      // Use collection.delete() API
      try {
        await collection.delete({
          ids: [String(docId)],
        });
      } catch (deleteError) {
        const errMsg =
          deleteError instanceof Error
            ? deleteError.message
            : String(deleteError);
        panel.webview.postMessage({
          type: "documentError",
          data: { error: `Failed to delete document: ${errMsg}` },
        });
        return;
      }

      this.addWarning(
        "info",
        `Successfully deleted document from ${collectionName}`,
      );

      panel.webview.postMessage({
        type: "documentDeleted",
        data: { collectionName, documentId: docId },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Failed to delete document: ${errorMsg}`);
      panel.webview.postMessage({
        type: "documentError",
        data: { error: errorMsg },
      });
    }
  }

  /**
   * Handle update document - uses SeekDB Collection API with automatic vectorization
   */
  private async handleUpdateDocument(
    data: {
      collectionName: string;
      documentId: any;
      originalData: Record<string, any>;
      updatedData: Record<string, any>;
    },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isSeekDBConnection(connection)) {
      panel.webview.postMessage({
        type: "documentError",
        data: { error: "Only SeekDB connections support updating documents" },
      });
      return;
    }

    try {
      const { collectionName, documentId, originalData, updatedData } = data;

      if (!collectionName) {
        panel.webview.postMessage({
          type: "documentError",
          data: { error: "Collection name is required" },
        });
        return;
      }

      // Get SeekDB client, try to reconnect if not connected
      let client = this.getSeekdbClient(connection.id);
      if (!client && connection.connected) {
        try {
          const clients = await this.createSeekdbClients(connection);
          this.seekdbClients.set(connection.id, clients);
          client = clients.client;
          this.addWarning("info", `Reconnected to seekdb: ${connection.name}`);
        } catch (reconnectError) {
          const errMsg =
            reconnectError instanceof Error
              ? reconnectError.message
              : String(reconnectError);
          panel.webview.postMessage({
            type: "documentError",
            data: { error: `Failed to reconnect: ${errMsg}` },
          });
          return;
        }
      }

      if (!client) {
        panel.webview.postMessage({
          type: "documentError",
          data: { error: "SeekDB client not connected" },
        });
        return;
      }

      // Extract collection name (remove c$v1$ prefix if present)
      // Note: SDK's getCollection() automatically adds 'c$v1$' prefix internally,
      // so we must ensure the name passed to SDK is clean (without prefix).
      // This defensive check handles cases where collectionName might already include the prefix.
      const COLLECTION_PREFIX = "c$v1$";
      const actualCollectionName = collectionName.startsWith(COLLECTION_PREFIX)
        ? collectionName.slice(COLLECTION_PREFIX.length)
        : collectionName;

      // Get document ID (_id field)
      const docId =
        documentId || originalData._id || originalData.id || String(Date.now());

      // Create embedding function adapter from project's embedding service
      const embeddingFunction = this.createEmbeddingFunctionAdapter();
      if (!embeddingFunction) {
        panel.webview.postMessage({
          type: "documentError",
          data: {
            error:
              "Embedding service not available. Please check your embedding configuration in settings.",
          },
        });
        return;
      }

      // Show info message about using embedding model
      const modelName = embeddingFunction.name;
      vscode.window.showInformationMessage(
        `Updating document with vectorization using: ${modelName}`,
      );

      // Get collection with embedding function for automatic vectorization
      const collection = await client.getCollection({
        name: actualCollectionName,
        embeddingFunction: embeddingFunction,
      });

      // Extract document content and metadata from updated data
      const documentContent = updatedData.document || null;
      const metadata = updatedData.metadata || null;

      // Build update options
      const updateOptions: {
        ids: string[];
        documents?: string[];
        metadatas?: Record<string, any>[];
      } = {
        ids: [String(docId)],
      };

      if (documentContent !== null) {
        updateOptions.documents = [String(documentContent)];
      }

      if (metadata !== null) {
        updateOptions.metadatas = [
          typeof metadata === "object" ? metadata : { value: metadata },
        ];
      }

      // Use collection.update() which automatically handles vectorization
      await collection.update(updateOptions);

      this.addWarning(
        "info",
        `Successfully updated document in ${collectionName} with vectorization`,
      );

      panel.webview.postMessage({
        type: "documentUpdated",
        data: { collectionName, documentId: docId },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Failed to update document: ${errorMsg}`);
      panel.webview.postMessage({
        type: "documentError",
        data: { error: errorMsg },
      });
    }
  }

  /**
   * Handle create document - uses SeekDB Collection API with automatic vectorization
   */
  private async handleCreateDocument(
    data: {
      collectionName: string;
      documentData: Record<string, any>;
    },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isSeekDBConnection(connection)) {
      panel.webview.postMessage({
        type: "documentError",
        data: { error: "Only SeekDB connections support creating documents" },
      });
      return;
    }

    try {
      const { collectionName, documentData } = data;

      if (!collectionName) {
        panel.webview.postMessage({
          type: "documentError",
          data: { error: "Collection name is required" },
        });
        return;
      }

      // Get SeekDB client, try to reconnect if not connected
      let client = this.getSeekdbClient(connection.id);
      if (!client && connection.connected) {
        try {
          const clients = await this.createSeekdbClients(connection);
          this.seekdbClients.set(connection.id, clients);
          client = clients.client;
          this.addWarning("info", `Reconnected to seekdb: ${connection.name}`);
        } catch (reconnectError) {
          const errMsg =
            reconnectError instanceof Error
              ? reconnectError.message
              : String(reconnectError);
          panel.webview.postMessage({
            type: "documentError",
            data: { error: `Failed to reconnect: ${errMsg}` },
          });
          return;
        }
      }

      if (!client) {
        panel.webview.postMessage({
          type: "documentError",
          data: { error: "SeekDB client not connected" },
        });
        return;
      }

      // Extract collection name (remove c$v1$ prefix if present)
      // Note: SDK's getCollection() automatically adds 'c$v1$' prefix internally,
      // so we must ensure the name passed to SDK is clean (without prefix).
      // This defensive check handles cases where collectionName might already include the prefix.
      const COLLECTION_PREFIX = "c$v1$";
      const actualCollectionName = collectionName.startsWith(COLLECTION_PREFIX)
        ? collectionName.slice(COLLECTION_PREFIX.length)
        : collectionName;

      // Generate unique ID for the document
      const docId = String(Date.now());

      // Create embedding function adapter from project's embedding service
      const embeddingFunction = this.createEmbeddingFunctionAdapter();
      if (!embeddingFunction) {
        panel.webview.postMessage({
          type: "documentError",
          data: {
            error:
              "Embedding service not available. Please check your embedding configuration in settings.",
          },
        });
        return;
      }

      // Show info message about using embedding model
      const modelName = embeddingFunction.name;
      vscode.window.showInformationMessage(
        `Adding document with vectorization using: ${modelName}`,
      );

      // Get collection with embedding function for automatic vectorization
      const collection = await client.getCollection({
        name: actualCollectionName,
        embeddingFunction: embeddingFunction,
      });

      // Extract document content and metadata
      const documentContent = documentData.document || null;
      const metadata = documentData.metadata || null;

      if (!documentContent) {
        panel.webview.postMessage({
          type: "documentError",
          data: { error: "Document content is required for vectorization" },
        });
        return;
      }

      // Build add options
      const addOptions: {
        ids: string[];
        documents: string[];
        metadatas?: Record<string, any>[];
      } = {
        ids: [docId],
        documents: [String(documentContent)],
      };

      if (metadata !== null) {
        addOptions.metadatas = [
          typeof metadata === "object" ? metadata : { value: metadata },
        ];
      }

      // Use collection.add() which automatically handles vectorization
      await collection.add(addOptions);

      this.addWarning(
        "info",
        `Successfully created document in ${collectionName} with vectorization`,
      );

      panel.webview.postMessage({
        type: "documentCreated",
        data: { collectionName, documentId: docId },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Failed to create document: ${errorMsg}`);
      panel.webview.postMessage({
        type: "documentError",
        data: { error: errorMsg },
      });
    }
  }

  // ============================================
  // Fork Table Operations
  // ============================================

  /**
   * Resolve a display name to the actual SQL table name using the SDK's
   * resolveCollectionTableName (supports c$v1$ and c$v2$ prefixes via
   * sdk_collections lookup). Falls back to the raw name for plain tables.
   */
  private async resolveActualTableName(
    connection: DatabaseConnection,
    displayName: string,
  ): Promise<string> {
    if (isCollectionBackingTable(displayName)) {
      return displayName;
    }
    const { allTables } = await this.getTables(connection);
    const allTableNames = allTables.map((t) => t.name);
    const resolved = await resolveCollectionTableName(
      displayName,
      allTableNames,
      async (sql: string) =>
        await this.executeSeekDBQuery(connection.id, sql),
    );
    return resolved || displayName;
  }

  /**
   * Build a target table name that lives in the same namespace as the source.
   * If the source resolves to a prefixed name (e.g. c$v1$docs), the target
   * will get the same prefix (e.g. c$v1$docs_fork_123).
   */
  private buildForkTargetName(
    resolvedSource: string,
    targetDisplayName: string,
  ): string {
    const { prefix } = stripCollectionPrefix(resolvedSource);
    if (!prefix) {
      return targetDisplayName;
    }
    if (targetDisplayName.startsWith(prefix)) {
      return targetDisplayName;
    }
    return `${prefix}${targetDisplayName}`;
  }

  /**
   * Handle fork table - creates a zero-copy clone using FORK TABLE SQL
   */
  private async handleForkTable(
    data: { sourceTable: string; targetTable: string },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isSeekDBConnection(connection)) {
      panel.webview.postMessage({
        type: "forkError",
        data: { error: "Fork Table is only supported on SeekDB connections" },
      });
      return;
    }

    try {
      const sourceTable = data.sourceTable.trim();
      const targetTable = data.targetTable.trim();

      if (!sourceTable || !targetTable) {
        panel.webview.postMessage({
          type: "forkError",
          data: { error: "Source and target table names are required" },
        });
        return;
      }

      if (sourceTable === targetTable) {
        panel.webview.postMessage({
          type: "forkError",
          data: { error: "Target table name must differ from source" },
        });
        return;
      }

      const actualSource = await this.resolveActualTableName(
        connection,
        sourceTable,
      );
      const actualTarget = this.buildForkTargetName(actualSource, targetTable);

      const startTime = Date.now();
      const sql = `FORK TABLE \`${actualSource}\` TO \`${actualTarget}\``;
      await this.executeSeekDBQuery(connection.id, sql);
      const elapsed = Date.now() - startTime;

      this.addWarning(
        "info",
        `Fork completed in ${elapsed}ms: ${sourceTable} → ${targetTable}`,
      );
      vscode.window.showInformationMessage(
        `Fork completed in ${elapsed}ms: ${sourceTable} → ${targetTable}`,
      );

      panel.webview.postMessage({
        type: "forkCreated",
        data: { sourceTable, targetTable, elapsed },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Fork failed: ${errorMsg}`);
      panel.webview.postMessage({
        type: "forkError",
        data: { error: `Fork failed: ${errorMsg}` },
      });
    }
  }

  /**
   * Handle promote fork - replaces source table with the fork using RENAME TABLE
   */
  private async handlePromoteFork(
    data: { sourceTable: string; forkTable: string },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isSeekDBConnection(connection)) {
      panel.webview.postMessage({
        type: "forkError",
        data: { error: "Only SeekDB connections support this operation" },
      });
      return;
    }

    try {
      const { sourceTable, forkTable } = data;
      const actualSource = await this.resolveActualTableName(
        connection,
        sourceTable,
      );
      const actualFork = await this.resolveActualTableName(
        connection,
        forkTable,
      );
      const backupSuffix = `_backup_${Date.now()}`;
      const actualBackup = this.buildForkTargetName(
        actualSource,
        `${sourceTable}${backupSuffix}`,
      );

      const sql = `RENAME TABLE \`${actualSource}\` TO \`${actualBackup}\`, \`${actualFork}\` TO \`${actualSource}\``;
      await this.executeSeekDBQuery(connection.id, sql);

      this.addWarning(
        "info",
        `Fork promoted: ${forkTable} → ${sourceTable} (backup: ${sourceTable}${backupSuffix})`,
      );
      vscode.window.showInformationMessage(
        `Fork promoted successfully. Old table backed up as "${sourceTable}${backupSuffix}"`,
      );

      panel.webview.postMessage({
        type: "forkPromoted",
        data: { sourceTable, forkTable, backupName: `${sourceTable}${backupSuffix}` },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Promote fork failed: ${errorMsg}`);
      panel.webview.postMessage({
        type: "forkError",
        data: { error: `Promote failed: ${errorMsg}` },
      });
    }
  }

  /**
   * Handle discard fork - drops the forked table
   */
  private async handleDiscardFork(
    data: { forkTable: string },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isSeekDBConnection(connection)) {
      panel.webview.postMessage({
        type: "forkError",
        data: { error: "Only SeekDB connections support this operation" },
      });
      return;
    }

    try {
      const actualFork = await this.resolveActualTableName(
        connection,
        data.forkTable,
      );
      const sql = `DROP TABLE IF EXISTS \`${actualFork}\``;
      await this.executeSeekDBQuery(connection.id, sql);

      this.addWarning("info", `Fork discarded: ${data.forkTable}`);
      vscode.window.showInformationMessage(
        `Fork "${data.forkTable}" discarded successfully`,
      );

      panel.webview.postMessage({
        type: "forkDiscarded",
        data: { forkTable: data.forkTable },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Discard fork failed: ${errorMsg}`);
      panel.webview.postMessage({
        type: "forkError",
        data: { error: `Discard failed: ${errorMsg}` },
      });
    }
  }

  /**
   * Handle compare tables - compares schema between two tables
   */
  private async handleCompareTables(
    data: { tableA: string; tableB: string },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isSeekDBConnection(connection)) {
      panel.webview.postMessage({
        type: "forkError",
        data: { error: "Only SeekDB connections support this operation" },
      });
      return;
    }

    try {
      const { tableA, tableB } = data;
      const actualA = await this.resolveActualTableName(connection, tableA);
      const actualB = await this.resolveActualTableName(connection, tableB);

      const descA = await this.executeSeekDBQuery(
        connection.id,
        `DESCRIBE \`${actualA}\``,
      );
      const descB = await this.executeSeekDBQuery(
        connection.id,
        `DESCRIBE \`${actualB}\``,
      );

      const countA = await this.executeSeekDBQuery(
        connection.id,
        `SELECT COUNT(*) AS cnt FROM \`${actualA}\``,
      );
      const countB = await this.executeSeekDBQuery(
        connection.id,
        `SELECT COUNT(*) AS cnt FROM \`${actualB}\``,
      );

      const columnsA = (descA.rows || []).map((r: any) => ({
        field: r.Field,
        type: r.Type,
        null: r.Null,
        key: r.Key,
        default: r.Default,
        extra: r.Extra,
      }));
      const columnsB = (descB.rows || []).map((r: any) => ({
        field: r.Field,
        type: r.Type,
        null: r.Null,
        key: r.Key,
        default: r.Default,
        extra: r.Extra,
      }));

      const rowCountA = countA.rows?.[0]?.cnt ?? 0;
      const rowCountB = countB.rows?.[0]?.cnt ?? 0;

      const allFields = new Set([
        ...columnsA.map((c: any) => c.field),
        ...columnsB.map((c: any) => c.field),
      ]);

      const diff: any[] = [];
      for (const field of allFields) {
        const colA = columnsA.find((c: any) => c.field === field);
        const colB = columnsB.find((c: any) => c.field === field);

        if (!colA) {
          diff.push({ field, status: "added", tableA: null, tableB: colB });
        } else if (!colB) {
          diff.push({ field, status: "removed", tableA: colA, tableB: null });
        } else if (
          colA.type !== colB.type ||
          colA.null !== colB.null ||
          colA.key !== colB.key
        ) {
          diff.push({ field, status: "modified", tableA: colA, tableB: colB });
        } else {
          diff.push({
            field,
            status: "unchanged",
            tableA: colA,
            tableB: colB,
          });
        }
      }

      panel.webview.postMessage({
        type: "compareResult",
        data: {
          tableA,
          tableB,
          rowCountA,
          rowCountB,
          columnsA,
          columnsB,
          diff,
        },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Compare tables failed: ${errorMsg}`);
      panel.webview.postMessage({
        type: "forkError",
        data: { error: `Compare failed: ${errorMsg}` },
      });
    }
  }

  /**
   * Handle get fork info - retrieves fork metadata for a table.
   * Uses getTables() to get the full table list from the database.
   */
  private async handleGetForkInfo(
    data: { tableName: string },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isSeekDBConnection(connection)) {
      return;
    }

    try {
      const { tableName } = data;
      const { cleanName } = stripCollectionPrefix(tableName);
      const baseName = cleanName
        .replace(/_fork_\d+$/, "")
        .replace(/_safe_\d+$/, "")
        .replace(/_variant_[a-z]$/, "")
        .replace(/_backup_\d+$/, "")
        .replace(/_v\d+$/, "");

      const { allTables } = await this.getTables(connection);
      const allTableNames = allTables.map((t) => t.name);

      const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const forkPattern = new RegExp(
        `(^|\\$)${escapedBase}(_fork_\\d+|_safe_\\d+|_variant_[a-z]|_backup_\\d+|_v\\d+)?$`,
      );
      const relatedTables = allTableNames.filter((t: string) => {
        const { cleanName: clean } = stripCollectionPrefix(t);
        return clean === baseName || forkPattern.test(clean);
      });

      const displayNames = relatedTables.map((t: string) => {
        const { cleanName: clean } = stripCollectionPrefix(t);
        return clean;
      });

      panel.webview.postMessage({
        type: "forkInfo",
        data: { tableName, baseName, relatedTables: displayNames },
      });
    } catch (error) {
      console.error("[DatabaseProvider] Error getting fork info:", error);
    }
  }

  /**
   * Handle A/B test creation - forks a table into multiple variants
   */
  private async handleABTestCreate(
    data: { sourceTable: string; variantCount: number; variantNames?: string[] },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isSeekDBConnection(connection)) {
      panel.webview.postMessage({
        type: "forkError",
        data: { error: "Only SeekDB connections support A/B testing" },
      });
      return;
    }

    try {
      const { sourceTable, variantCount, variantNames } = data;
      const actualSource = await this.resolveActualTableName(
        connection,
        sourceTable,
      );
      const variants: { name: string; elapsed: number }[] = [];

      for (let i = 0; i < variantCount; i++) {
        const variantDisplayName =
          variantNames?.[i] ||
          `${sourceTable}_variant_${String.fromCharCode(97 + i)}`;
        const actualTarget = this.buildForkTargetName(
          actualSource,
          variantDisplayName,
        );
        const startTime = Date.now();
        const sql = `FORK TABLE \`${actualSource}\` TO \`${actualTarget}\``;
        await this.executeSeekDBQuery(connection.id, sql);
        const elapsed = Date.now() - startTime;
        variants.push({ name: variantDisplayName, elapsed });
      }

      this.addWarning(
        "info",
        `A/B test created: ${variants.length} variants from ${sourceTable}`,
      );
      vscode.window.showInformationMessage(
        `A/B test created: ${variants.length} variants from "${sourceTable}"`,
      );

      panel.webview.postMessage({
        type: "abTestCreated",
        data: { sourceTable, variants },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `A/B test creation failed: ${errorMsg}`);
      panel.webview.postMessage({
        type: "forkError",
        data: { error: `A/B test creation failed: ${errorMsg}` },
      });
    }
  }

  /**
   * Handle A/B test query - runs the same query against multiple variants
   */
  private async handleABTestRunQuery(
    data: { variants: string[]; sql: string },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isSeekDBConnection(connection)) {
      panel.webview.postMessage({
        type: "forkError",
        data: { error: "Only SeekDB connections support A/B testing" },
      });
      return;
    }

    try {
      const { variants, sql } = data;
      const results: {
        variant: string;
        elapsed: number;
        rowCount: number;
        error?: string;
      }[] = [];

      for (const variant of variants) {
        const actualVariant = await this.resolveActualTableName(
          connection,
          variant,
        );
        const variantSql = sql.replace(/\{table\}/g, actualVariant);
        const startTime = Date.now();
        try {
          const result = await this.executeSeekDBQuery(
            connection.id,
            variantSql,
          );
          const elapsed = Date.now() - startTime;
          results.push({
            variant,
            elapsed,
            rowCount: result.rows?.length ?? 0,
          });
        } catch (queryError) {
          const elapsed = Date.now() - startTime;
          results.push({
            variant,
            elapsed,
            rowCount: 0,
            error:
              queryError instanceof Error
                ? queryError.message
                : String(queryError),
          });
        }
      }

      panel.webview.postMessage({
        type: "abTestQueryResult",
        data: { sql, results },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      panel.webview.postMessage({
        type: "forkError",
        data: { error: `A/B test query failed: ${errorMsg}` },
      });
    }
  }

  /**
   * Handle A/B test cleanup - drops all variant tables
   */
  private async handleABTestCleanup(
    data: { variants: string[] },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isSeekDBConnection(connection)) {
      panel.webview.postMessage({
        type: "forkError",
        data: { error: "Only SeekDB connections support this operation" },
      });
      return;
    }

    try {
      for (const variant of data.variants) {
        const actualVariant = await this.resolveActualTableName(
          connection,
          variant,
        );
        await this.executeSeekDBQuery(
          connection.id,
          `DROP TABLE IF EXISTS \`${actualVariant}\``,
        );
      }

      this.addWarning(
        "info",
        `A/B test cleanup: ${data.variants.length} variants dropped`,
      );

      panel.webview.postMessage({
        type: "abTestCleanedUp",
        data: { variants: data.variants },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      panel.webview.postMessage({
        type: "forkError",
        data: { error: `Cleanup failed: ${errorMsg}` },
      });
    }
  }

  // ============================================
  // OceanBase Cloud Table Operations
  // ============================================

  /**
   * Handle create table for OceanBase Cloud
   */
  private async handleCreateTable(
    data: { name: string },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isOceanBaseCloudConnection(connection)) {
      panel.webview.postMessage({
        type: "tableError",
        data: {
          error: "Only OceanBase Cloud connections support this operation",
        },
      });
      return;
    }

    try {
      const tableName = data.name.trim();
      if (!tableName) {
        panel.webview.postMessage({
          type: "tableError",
          data: { error: "Table name cannot be empty" },
        });
        return;
      }

      // Create table with basic structure
      const createTableSql = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
        \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
        \`name\` VARCHAR(255),
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`;

      await this.executeOceanBaseCloudQuery(connection.id, createTableSql);

      this.addWarning("info", `Successfully created table: ${tableName}`);
      vscode.window.showInformationMessage(
        `Successfully created table: ${tableName}`,
      );

      panel.webview.postMessage({
        type: "tableCreated",
        data: { name: tableName },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Failed to create table: ${errorMsg}`);
      panel.webview.postMessage({
        type: "tableError",
        data: { error: errorMsg },
      });
    }
  }

  /**
   * Handle delete table for OceanBase Cloud
   */
  private async handleDeleteTable(
    data: { name: string },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isOceanBaseCloudConnection(connection)) {
      panel.webview.postMessage({
        type: "tableError",
        data: {
          error: "Only OceanBase Cloud connections support this operation",
        },
      });
      return;
    }

    try {
      const tableName = data.name.trim();
      if (!tableName) {
        panel.webview.postMessage({
          type: "tableError",
          data: { error: "Table name cannot be empty" },
        });
        return;
      }

      // Drop table
      const dropTableSql = `DROP TABLE IF EXISTS \`${tableName}\``;
      await this.executeOceanBaseCloudQuery(connection.id, dropTableSql);

      this.addWarning("info", `Successfully deleted table: ${tableName}`);
      vscode.window.showInformationMessage(
        `Successfully deleted table: ${tableName}`,
      );

      panel.webview.postMessage({
        type: "tableDeleted",
        data: { name: tableName },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Failed to delete table: ${errorMsg}`);
      panel.webview.postMessage({
        type: "tableError",
        data: { error: errorMsg },
      });
    }
  }

  // ============================================
  // OceanBase Cloud Row Operations
  // ============================================

  /**
   * Handle create row for OceanBase Cloud
   */
  private async handleCreateRow(
    data: {
      tableName: string;
      rowData: Record<string, any>;
      columns?: { name: string; type: string }[];
    },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isOceanBaseCloudConnection(connection)) {
      panel.webview.postMessage({
        type: "rowError",
        data: {
          error: "Only OceanBase Cloud connections support this operation",
        },
      });
      return;
    }

    try {
      const { tableName, rowData } = data;

      if (!tableName) {
        panel.webview.postMessage({
          type: "rowError",
          data: { error: "Table name is required" },
        });
        return;
      }

      // Build INSERT SQL
      const columns: string[] = [];
      const values: string[] = [];

      for (const [key, value] of Object.entries(rowData)) {
        if (value !== null && value !== undefined && value !== "") {
          columns.push(`\`${key}\``);
          if (typeof value === "string") {
            // Escape single quotes in string values
            values.push(`'${value.replace(/'/g, "''")}'`);
          } else if (typeof value === "number") {
            values.push(String(value));
          } else if (typeof value === "boolean") {
            values.push(value ? "1" : "0");
          } else {
            values.push(`'${JSON.stringify(value).replace(/'/g, "''")}'`);
          }
        }
      }

      if (columns.length === 0) {
        panel.webview.postMessage({
          type: "rowError",
          data: { error: "At least one column value is required" },
        });
        return;
      }

      const insertSql = `INSERT INTO \`${tableName}\` (${columns.join(
        ", ",
      )}) VALUES (${values.join(", ")})`;
      await this.executeOceanBaseCloudQuery(connection.id, insertSql);

      this.addWarning("info", `Successfully inserted row into ${tableName}`);

      panel.webview.postMessage({
        type: "rowCreated",
        data: { tableName },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Failed to insert row: ${errorMsg}`);
      panel.webview.postMessage({
        type: "rowError",
        data: { error: errorMsg },
      });
    }
  }

  /**
   * Handle update row for OceanBase Cloud
   */
  private async handleUpdateRow(
    data: {
      tableName: string;
      originalData: Record<string, any>;
      updatedData: Record<string, any>;
      columns?: { name: string; type: string }[];
    },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isOceanBaseCloudConnection(connection)) {
      panel.webview.postMessage({
        type: "rowError",
        data: {
          error: "Only OceanBase Cloud connections support this operation",
        },
      });
      return;
    }

    try {
      const { tableName, originalData, updatedData } = data;

      if (!tableName) {
        panel.webview.postMessage({
          type: "rowError",
          data: { error: "Table name is required" },
        });
        return;
      }

      // Build SET clause for UPDATE
      const setClauses: string[] = [];
      for (const [key, value] of Object.entries(updatedData)) {
        if (value === null || value === undefined) {
          setClauses.push(`\`${key}\` = NULL`);
        } else if (typeof value === "string") {
          setClauses.push(`\`${key}\` = '${value.replace(/'/g, "''")}'`);
        } else if (typeof value === "number") {
          setClauses.push(`\`${key}\` = ${value}`);
        } else if (typeof value === "boolean") {
          setClauses.push(`\`${key}\` = ${value ? 1 : 0}`);
        } else {
          setClauses.push(
            `\`${key}\` = '${JSON.stringify(value).replace(/'/g, "''")}'`,
          );
        }
      }

      if (setClauses.length === 0) {
        panel.webview.postMessage({
          type: "rowError",
          data: { error: "No columns to update" },
        });
        return;
      }

      // Build WHERE clause using primary key or all original columns
      const whereClauses: string[] = [];
      // Try to use id or primary key first
      if (originalData.id !== undefined) {
        whereClauses.push(`\`id\` = ${this.formatSqlValue(originalData.id)}`);
      } else {
        // Use all original columns to identify the row
        for (const [key, value] of Object.entries(originalData)) {
          if (value === null || value === undefined) {
            whereClauses.push(`\`${key}\` IS NULL`);
          } else {
            whereClauses.push(`\`${key}\` = ${this.formatSqlValue(value)}`);
          }
        }
      }

      const updateSql = `UPDATE \`${tableName}\` SET ${setClauses.join(
        ", ",
      )} WHERE ${whereClauses.join(" AND ")} LIMIT 1`;
      await this.executeOceanBaseCloudQuery(connection.id, updateSql);

      this.addWarning("info", `Successfully updated row in ${tableName}`);

      panel.webview.postMessage({
        type: "rowUpdated",
        data: { tableName },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Failed to update row: ${errorMsg}`);
      panel.webview.postMessage({
        type: "rowError",
        data: { error: errorMsg },
      });
    }
  }

  /**
   * Handle delete row for OceanBase Cloud
   */
  private async handleDeleteRow(
    data: {
      tableName: string;
      rowData: Record<string, any>;
      columns?: { name: string; type: string }[];
    },
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    if (!this.isOceanBaseCloudConnection(connection)) {
      panel.webview.postMessage({
        type: "rowError",
        data: {
          error: "Only OceanBase Cloud connections support this operation",
        },
      });
      return;
    }

    try {
      const { tableName, rowData } = data;

      if (!tableName) {
        panel.webview.postMessage({
          type: "rowError",
          data: { error: "Table name is required" },
        });
        return;
      }

      // Build WHERE clause using primary key or all columns
      const whereClauses: string[] = [];
      // Try to use id or primary key first
      if (rowData.id !== undefined) {
        whereClauses.push(`\`id\` = ${this.formatSqlValue(rowData.id)}`);
      } else {
        // Use all columns to identify the row
        for (const [key, value] of Object.entries(rowData)) {
          if (value === null || value === undefined) {
            whereClauses.push(`\`${key}\` IS NULL`);
          } else {
            whereClauses.push(`\`${key}\` = ${this.formatSqlValue(value)}`);
          }
        }
      }

      if (whereClauses.length === 0) {
        panel.webview.postMessage({
          type: "rowError",
          data: { error: "Cannot identify row to delete" },
        });
        return;
      }

      const deleteSql = `DELETE FROM \`${tableName}\` WHERE ${whereClauses.join(
        " AND ",
      )} LIMIT 1`;
      await this.executeOceanBaseCloudQuery(connection.id, deleteSql);

      this.addWarning("info", `Successfully deleted row from ${tableName}`);

      panel.webview.postMessage({
        type: "rowDeleted",
        data: { tableName },
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.addWarning("error", `Failed to delete row: ${errorMsg}`);
      panel.webview.postMessage({
        type: "rowError",
        data: { error: errorMsg },
      });
    }
  }

  /**
   * Format value for SQL query
   */
  private formatSqlValue(value: any): string {
    if (value === null || value === undefined) {
      return "NULL";
    } else if (typeof value === "string") {
      return `'${value.replace(/'/g, "''")}'`;
    } else if (typeof value === "number") {
      return String(value);
    } else if (typeof value === "boolean") {
      return value ? "1" : "0";
    } else {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }
  }

  /**
   * Handle get table structures request
   */
  private async handleGetTableStructures(
    panel: vscode.WebviewPanel,
    connection: DatabaseConnection,
  ): Promise<void> {
    try {
      const mysql = await import("mysql2/promise");
      let conn: any;
      let collectionNames: string[] = [];
      const COLLECTION_PREFIX = "c$v1$";

      if (this.isSeekDBConnection(connection)) {
        // For SeekDB, use SDK API to get clean collection names
        try {
          const client = this.getSeekdbClient(connection.id);
          if (!client || !client.isConnected()) {
            // Create client if not exists
            const clients = await this.createSeekdbClients(connection);
            this.seekdbClients.set(connection.id, clients);
            const newClient = clients.client;
            if (newClient && newClient.isConnected()) {
              const allCollections = await newClient.listCollections({
                withEmbeddingFunction: false,
              });
              collectionNames = allCollections.map((col) => col.name);
            }
          } else {
            const allCollections = await client.listCollections({
              withEmbeddingFunction: false,
            });
            collectionNames = allCollections.map((col) => col.name);
          }
        } catch (sdkError) {
          console.warn(
            "[DatabaseProvider] Failed to get collections from SDK, falling back to SHOW TABLES",
            sdkError,
          );
        }

        // Create MySQL connection for querying table structures
        conn = await mysql.createConnection({
          host: connection.host,
          port: connection.port,
          user: `${connection.user}@${connection.tenant || DEFAULT_TENANT}`,
          password: connection.password,
          database: connection.database || DEFAULT_DATABASE,
          connectTimeout: 10000,
        });
      } else if (this.isOceanBaseCloudConnection(connection)) {
        const userString = connection.user;
        conn = await mysql.createConnection({
          host: connection.host,
          port: connection.port,
          user: userString,
          password: connection.password,
          database: connection.database || "test",
          connectTimeout: 10000,
        });
      } else {
        // For other MySQL connections
        conn = await mysql.createConnection({
          host: connection.host,
          port: connection.port,
          user: connection.user,
          password: connection.password,
          database: connection.database || "information_schema",
          connectTimeout: 10000,
        });
      }

      try {
        // Get table names
        let tableNames: string[] = [];

        if (this.isSeekDBConnection(connection) && collectionNames.length > 0) {
          // Use clean collection names from SDK, but need to add prefix for SQL queries
          tableNames = collectionNames.map(
            (name) => `${COLLECTION_PREFIX}${name}`,
          );
        } else {
          // Fallback: Get all tables using SHOW TABLES
          const [tableRows] = await conn.execute("SHOW TABLES");
          tableNames = (tableRows as any[]).map(
            (row: any) => Object.values(row)[0],
          ) as string[];
        }

        const tables: any[] = [];

        // Get structure for each table
        for (let i = 0; i < tableNames.length; i++) {
          const tableName = tableNames[i];
          // Use clean name for SeekDB collections (without prefix)
          const displayName =
            this.isSeekDBConnection(connection) && collectionNames.length > 0
              ? collectionNames[i]
              : tableName.startsWith(COLLECTION_PREFIX)
                ? tableName.slice(COLLECTION_PREFIX.length)
                : tableName;
          // Get column information
          const [columns] = await conn.execute(`DESCRIBE \`${tableName}\``);
          const columnData = columns as any[];

          // Get primary keys
          const [pkRows] = await conn.execute(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? 
             AND CONSTRAINT_NAME = 'PRIMARY' 
             ORDER BY ORDINAL_POSITION`,
            [
              connection.database ||
                (this.isSeekDBConnection(connection)
                  ? "test"
                  : "information_schema"),
              tableName,
            ],
          );
          const primaryKeys = new Set(
            (pkRows as any[]).map((row: any) => row.COLUMN_NAME),
          );

          // Get foreign keys
          const [fkRows] = await conn.execute(
            `SELECT 
               COLUMN_NAME, 
               REFERENCED_TABLE_NAME, 
               REFERENCED_COLUMN_NAME 
             FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
             WHERE TABLE_SCHEMA = ? 
             AND TABLE_NAME = ? 
             AND REFERENCED_TABLE_NAME IS NOT NULL 
             ORDER BY ORDINAL_POSITION`,
            [
              connection.database ||
                (this.isSeekDBConnection(connection)
                  ? "test"
                  : "information_schema"),
              tableName,
            ],
          );
          const foreignKeys = new Map<
            string,
            { table: string; column: string }
          >();
          (fkRows as any[]).forEach((row: any) => {
            // Remove prefix from referenced table name if it's a SeekDB collection
            let referencedTableName = row.REFERENCED_TABLE_NAME;
            if (
              this.isSeekDBConnection(connection) &&
              referencedTableName.startsWith(COLLECTION_PREFIX)
            ) {
              referencedTableName = referencedTableName.slice(
                COLLECTION_PREFIX.length,
              );
            }
            foreignKeys.set(row.COLUMN_NAME, {
              table: referencedTableName,
              column: row.REFERENCED_COLUMN_NAME,
            });
          });

          const tableColumns = columnData.map((col: any) => ({
            name: col.Field,
            type: col.Type,
            nullable: col.Null === "YES",
            primaryKey: primaryKeys.has(col.Field),
            foreignKey: foreignKeys.get(col.Field),
          }));

          tables.push({
            name: displayName,
            columns: tableColumns,
          });
        }

        panel.webview.postMessage({
          type: "tableStructures",
          data: { tables },
        });
      } finally {
        // Close connection if we created it
        if (conn && typeof conn.end === "function") {
          await conn.end();
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(
        "[DatabaseProvider] Error getting table structures:",
        errorMsg,
      );
      this.addWarning("error", `Failed to get table structures: ${errorMsg}`);
      panel.webview.postMessage({
        type: "tableStructuresError",
        data: { error: errorMsg },
      });
    }
  }
}
