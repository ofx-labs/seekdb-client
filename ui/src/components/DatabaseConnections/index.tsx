import React, { useState, useEffect } from "react";
import {
  Database,
  Search,
  Zap,
  RefreshCw,
  List,
  Square,
  Play,
  Trash2,
  ChevronDown,
  ChevronRight,
  Plus,
  AlertTriangle,
  XCircle,
  Info,
  HardDrive,
} from "lucide-react";
import { vscode } from "../../utils/vscode";
import DatabaseModal, { ModalMode } from "../DatabaseModal";
import "./index.css";

interface DatabaseConnection {
  id: string;
  name: string;
  type: "seekdb" | "nero" | string;
  host: string;
  port: number;
  database?: string;
  tenant?: string;
  connected?: boolean;
}

interface ServerDatabase {
  name: string;
  charset: string;
  collation: string;
}

const DB_TYPE_ICONS: { [key: string]: React.ReactNode } = {
  seekdb: <Search size={16} />,
  nero: <Zap size={16} />,
};

interface WarningMessage {
  type: "error" | "info" | "warning";
  message: string;
  timestamp: Date;
}

/** Modal 状态接口 */
interface ModalState {
  isOpen: boolean;
  mode: ModalMode;
  connectionId: string;
  databaseName: string;
}

/**
 * DatabaseConnections - 侧边栏数据库连接列表组件
 */
function DatabaseConnections() {
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<{
    [key: string]: boolean;
  }>({});
  // 每个连接的服务器数据库列表
  const [serverDatabases, setServerDatabases] = useState<{
    [key: string]: ServerDatabase[];
  }>({});
  // 加载状态
  const [loadingDatabases, setLoadingDatabases] = useState<{
    [key: string]: boolean;
  }>({});
  // 展开的连接（显示数据库列表）
  const [expandedConnections, setExpandedConnections] = useState<{
    [key: string]: boolean;
  }>({});
  // 警告信息
  const [warnings, setWarnings] = useState<WarningMessage[]>([]);
  // 显示警告面板
  const [showWarnings, setShowWarnings] = useState(false);
  // Modal 状态
  const [modalState, setModalState] = useState<ModalState>({
    isOpen: false,
    mode: "create",
    connectionId: "",
    databaseName: "",
  });
  // Modal 加载状态
  const [modalLoading, setModalLoading] = useState(false);

  useEffect(() => {
    // 监听来自扩展的消息
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "updateDatabaseConnections") {
        setConnections(message.data?.connections || []);
      } else if (message.type === "serverDatabasesList") {
        // 收到服务器数据库列表
        const { connectionId, databases } = message.data || {};
        if (connectionId) {
          setServerDatabases((prev) => ({
            ...prev,
            [connectionId]: databases || [],
          }));
          setLoadingDatabases((prev) => ({
            ...prev,
            [connectionId]: false,
          }));
        }
      } else if (message.type === "serverDatabasesError") {
        // 数据库列表加载失败
        const { connectionId, error } = message.data || {};
        if (connectionId) {
          setLoadingDatabases((prev) => ({
            ...prev,
            [connectionId]: false,
          }));
          // 添加警告
          setWarnings((prev: WarningMessage[]) => [
            ...prev,
            {
              type: "error",
              message: `Failed to load database list: ${error}`,
              timestamp: new Date(),
            },
          ]);
        }
      } else if (message.type === "updateWarnings") {
        setWarnings(message.data?.warnings || []);
      } else if (message.type === "databaseCreated") {
        // 数据库创建成功
        setModalLoading(false);
        setModalState((prev) => ({ ...prev, isOpen: false }));
      } else if (message.type === "databaseDeleted") {
        // 数据库删除成功
        setModalLoading(false);
        setModalState((prev) => ({ ...prev, isOpen: false }));
      } else if (message.type === "databaseError") {
        // 数据库操作失败
        setModalLoading(false);
        // 添加警告
        setWarnings((prev: WarningMessage[]) => [
          ...prev,
          {
            type: "error",
            message: message.data?.error || "Database operation failed",
            timestamp: new Date(),
          },
        ]);
      }
    };

    window.addEventListener("message", handleMessage);

    // 请求加载数据库连接
    vscode.postMessage({
      type: "getDatabaseConnections",
    });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const handleCreateConnection = () => {
    vscode.postMessage({
      type: "openDatabaseConnect",
    });
  };

  const handleConnect = (connection: DatabaseConnection) => {
    vscode.postMessage({
      type: "connectToDatabase",
      data: connection,
    });
  };

  const handleDisconnect = (connectionId: string) => {
    vscode.postMessage({
      type: "disconnectDatabase",
      data: { id: connectionId },
    });
  };

  const handleDelete = (connectionId: string) => {
    vscode.postMessage({
      type: "deleteDatabaseConnection",
      data: { id: connectionId },
    });
  };

  const handleViewCollections = (connectionId: string) => {
    vscode.postMessage({
      type: "openCollectionBrowser",
      data: { id: connectionId },
    });
  };

  const toggleGroup = (groupName: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupName]: !prev[groupName],
    }));
  };

  // 切换连接展开状态（显示数据库列表）
  const toggleConnectionExpand = (
    connectionId: string,
    connection: DatabaseConnection,
  ) => {
    const isExpanding = !expandedConnections[connectionId];
    setExpandedConnections((prev) => ({
      ...prev,
      [connectionId]: isExpanding,
    }));

    // 如果是 seekdb 类型且正在展开，加载数据库列表
    if (isExpanding && connection.type === "seekdb" && connection.connected) {
      loadServerDatabases(connectionId);
    }
  };

  // 加载服务器数据库列表
  const loadServerDatabases = (connectionId: string) => {
    setLoadingDatabases((prev) => ({
      ...prev,
      [connectionId]: true,
    }));
    vscode.postMessage({
      type: "getServerDatabases",
      data: { connectionId },
    });
  };

  // 选择数据库
  const handleSelectDatabase = (connectionId: string, dbName: string) => {
    vscode.postMessage({
      type: "selectServerDatabase",
      data: { connectionId, database: dbName },
    });
  };

  // 打开创建数据库 Modal
  const handleCreateServerDatabase = (connectionId: string) => {
    setModalState({
      isOpen: true,
      mode: "create",
      connectionId,
      databaseName: "",
    });
  };

  // 打开删除数据库 Modal
  const handleDeleteServerDatabase = (connectionId: string, dbName: string) => {
    setModalState({
      isOpen: true,
      mode: "delete",
      connectionId,
      databaseName: dbName,
    });
  };

  // Modal 确认操作
  const handleModalConfirm = (name?: string) => {
    if (modalState.mode === "create" && name) {
      setModalLoading(true);
      vscode.postMessage({
        type: "createServerDatabase",
        data: { connectionId: modalState.connectionId, name },
      });
      // 延迟刷新数据库列表
      setTimeout(() => loadServerDatabases(modalState.connectionId), 500);
    } else if (modalState.mode === "delete") {
      setModalLoading(true);
      vscode.postMessage({
        type: "deleteServerDatabase",
        data: {
          connectionId: modalState.connectionId,
          name: modalState.databaseName,
        },
      });
      // 延迟刷新数据库列表
      setTimeout(() => loadServerDatabases(modalState.connectionId), 500);
    }
  };

  // Modal 取消操作
  const handleModalCancel = () => {
    if (!modalLoading) {
      setModalState((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // 刷新数据库列表
  const handleRefreshDatabases = (
    connectionId: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    loadServerDatabases(connectionId);
  };

  // 清除警告
  const clearWarnings = () => {
    setWarnings([]);
    vscode.postMessage({ type: "clearWarnings" });
  };

  // 判断连接是本地还是云端
  const isLocalConnection = (connection: DatabaseConnection): boolean => {
    // 如果是 oceanbase-cloud 类型，肯定是云端
    if (connection.type === "oceanbase-cloud") {
      return false;
    }
    // 判断 host 是否为本地地址
    const localHosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
    return localHosts.includes(connection.host.toLowerCase());
  };

  // 按本地和云端分组
  const cloudConnections = connections.filter((c) => !isLocalConnection(c));
  const localConnections = connections.filter((c) => isLocalConnection(c));

  // 渲染单个连接项
  const renderConnectionItem = (
    connection: DatabaseConnection,
    isConnected: boolean,
  ) => {
    const isExpanded = expandedConnections[connection.id];
    const databases = serverDatabases[connection.id] || [];
    const isLoading = loadingDatabases[connection.id];
    const isSeekDB = connection.type === "seekdb";

    return (
      <div key={connection.id} className="db-connection-wrapper">
        <div
          className={`db-connection-item ${isConnected ? "connected" : ""}`}
          onClick={
            isConnected && isSeekDB
              ? () => toggleConnectionExpand(connection.id, connection)
              : undefined
          }
        >
          {/* expand icon (only seekdb connected) */}
          {isConnected && isSeekDB && (
            <span className="db-expand-icon">
              {isExpanded ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
            </span>
          )}
          <div className="db-connection-icon">
            {DB_TYPE_ICONS[connection.type] || <Database size={16} />}
          </div>
          <div className="db-connection-info">
            <div className="db-connection-name">{connection.name}</div>
            <div className="db-connection-details">
              {connection.host}:{connection.port}
              {connection.database && ` / ${connection.database}`}
              {connection.tenant && isSeekDB && (
                <span className="db-tenant-badge">@{connection.tenant}</span>
              )}
            </div>
          </div>
          {isConnected && (
            <div className="db-connection-status">
              <span className="status-dot connected"></span>
            </div>
          )}
          <div className="db-connection-actions">
            {isConnected ? (
              <>
                {isSeekDB && (
                  <button
                    className="db-action-btn refresh"
                    onClick={(e) => handleRefreshDatabases(connection.id, e)}
                    title="Refresh database list"
                  >
                    <RefreshCw size={14} />
                  </button>
                )}
                <button
                  className="db-action-btn view"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleViewCollections(connection.id);
                  }}
                  title="View collections"
                >
                  <List size={14} />
                </button>
                <button
                  className="db-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDisconnect(connection.id);
                  }}
                  title="Disconnect"
                >
                  <Square size={14} />
                </button>
              </>
            ) : (
              <>
                <button
                  className="db-action-btn connect"
                  onClick={() => handleConnect(connection)}
                  title="Connect"
                >
                  <Play size={14} />
                </button>
                <button
                  className="db-action-btn delete"
                  onClick={() => handleDelete(connection.id)}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* databases list (only seekdb connected and expanded) */}
        {isConnected && isSeekDB && isExpanded && (
          <div className="db-databases-list">
            {isLoading ? (
              <div className="db-loading">
                <span className="db-loading-spinner"></span>
                Loading...
              </div>
            ) : databases.length > 0 ? (
              <>
                <div className="db-databases-header">
                  <span>Databases ({databases.length})</span>
                  <button
                    className="db-action-btn create"
                    onClick={() => handleCreateServerDatabase(connection.id)}
                    title="Create database"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {databases.map((db) => (
                  <div
                    key={db.name}
                    className={`db-database-item ${
                      connection.database === db.name ? "selected" : ""
                    }`}
                    onClick={() => handleSelectDatabase(connection.id, db.name)}
                  >
                    <HardDrive size={14} className="db-database-icon" />
                    <span className="db-database-name">{db.name}</span>
                    <span className="db-database-info">
                      {db.charset} / {db.collation}
                    </span>
                    <button
                      className="db-action-btn delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteServerDatabase(connection.id, db.name);
                      }}
                      title="Delete database"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <div className="db-empty-databases">
                <p>No databases</p>
                <button
                  className="db-create-db-btn"
                  onClick={() => handleCreateServerDatabase(connection.id)}
                >
                  <Plus size={14} /> Create Database
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="db-connections-container">
      {/* 头部 */}
      <div className="db-connections-header">
        <h3>
          <Database size={16} /> DATABASE
        </h3>
        <div className="db-header-actions">
          {warnings.length > 0 && (
            <button
              className={`db-warnings-btn ${showWarnings ? "active" : ""}`}
              onClick={() => setShowWarnings(!showWarnings)}
              title={`${warnings.length} warning(s)`}
            >
              <AlertTriangle size={14} /> {warnings.length}
            </button>
          )}
          <button
            className="db-create-btn"
            onClick={handleCreateConnection}
            title="Create new connection"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* 警告面板 */}
      {showWarnings && warnings.length > 0 && (
        <div className="db-warnings-panel">
          <div className="db-warnings-header">
            <span>Warnings</span>
            <button className="db-clear-warnings-btn" onClick={clearWarnings}>
              Clear
            </button>
          </div>
          <div className="db-warnings-list">
            {warnings.map((warning, index) => (
              <div
                key={index}
                className={`db-warning-item ${warning.type || "warning"}`}
              >
                <span className="db-warning-icon">
                  {warning.type === "error" ? (
                    <XCircle size={14} />
                  ) : warning.type === "info" ? (
                    <Info size={14} />
                  ) : (
                    <AlertTriangle size={14} />
                  )}
                </span>
                <span className="db-warning-message">{warning.message}</span>
                <span className="db-warning-time">
                  {new Date(warning.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {connections.length === 0 ? (
        <div className="db-empty-state">
          <p>No database connections</p>
          <button
            className="db-create-connection-btn"
            onClick={handleCreateConnection}
          >
            <Plus size={14} /> Create Connection
          </button>
          <p className="db-hint">
            <a href="#" onClick={handleCreateConnection}>
              learn more
            </a>
          </p>
        </div>
      ) : (
        <div className="db-connections-list">
          {/* CLOUD 分组 */}
          {cloudConnections.length > 0 && (
            <div className="db-group">
              <div
                className="db-group-header"
                onClick={() => toggleGroup("cloud")}
              >
                <span className="db-group-icon">
                  {expandedGroups["cloud"] !== false ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </span>
                <span className="db-group-title">DATABASE (CLOUD)</span>
              </div>
              {expandedGroups["cloud"] !== false && (
                <div className="db-group-content">
                  {cloudConnections.map((connection) =>
                    renderConnectionItem(
                      connection,
                      connection.connected || false,
                    ),
                  )}
                </div>
              )}
            </div>
          )}

          {/* LOCAL 分组 */}
          {localConnections.length > 0 && (
            <div className="db-group">
              <div
                className="db-group-header"
                onClick={() => toggleGroup("local")}
              >
                <span className="db-group-icon">
                  {expandedGroups["local"] !== false ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </span>
                <span className="db-group-title">DATABASE (LOCAL)</span>
              </div>
              {expandedGroups["local"] !== false && (
                <div className="db-group-content">
                  {localConnections.map((connection) =>
                    renderConnectionItem(
                      connection,
                      connection.connected || false,
                    ),
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 数据库新增/删除 Modal */}
      <DatabaseModal
        isOpen={modalState.isOpen}
        mode={modalState.mode}
        databaseName={modalState.databaseName}
        onConfirm={handleModalConfirm}
        onCancel={handleModalCancel}
        loading={modalLoading}
      />
    </div>
  );
}

export default DatabaseConnections;
