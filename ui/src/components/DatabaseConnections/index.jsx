import React, { useState, useEffect } from "react";
import { vscode } from "../../utils/vscode";
import "./index.css";

const DB_TYPE_ICONS = {
  seekdb: "🔍",
  nero: "⚡",
  mysql: "🐬",
  mariadb: "🦭",
  postgresql: "🐘",
  sqlite: "📦",
  oracle: "🔶",
  duckdb: "🦆",
};

/**
 * DatabaseConnections - 侧边栏数据库连接列表组件
 */
function DatabaseConnections() {
  const [connections, setConnections] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState({});
  // 每个连接的服务器数据库列表
  const [serverDatabases, setServerDatabases] = useState({});
  // 加载状态
  const [loadingDatabases, setLoadingDatabases] = useState({});
  // 展开的连接（显示数据库列表）
  const [expandedConnections, setExpandedConnections] = useState({});
  // 警告信息
  const [warnings, setWarnings] = useState([]);
  // 显示警告面板
  const [showWarnings, setShowWarnings] = useState(false);

  useEffect(() => {
    // 监听来自扩展的消息
    const handleMessage = (event) => {
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
          setWarnings((prev) => [
            ...prev,
            {
              type: "error",
              message: `加载数据库列表失败: ${error}`,
              timestamp: new Date(),
            },
          ]);
        }
      } else if (message.type === "updateWarnings") {
        setWarnings(message.data?.warnings || []);
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

  const handleConnect = (connection) => {
    vscode.postMessage({
      type: "connectToDatabase",
      data: connection,
    });
  };

  const handleDisconnect = (connectionId) => {
    vscode.postMessage({
      type: "disconnectDatabase",
      data: { id: connectionId },
    });
  };

  const handleDelete = (connectionId) => {
    vscode.postMessage({
      type: "deleteDatabaseConnection",
      data: { id: connectionId },
    });
  };

  const handleViewCollections = (connectionId) => {
    vscode.postMessage({
      type: "openCollectionBrowser",
      data: { id: connectionId },
    });
  };

  const toggleGroup = (groupName) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupName]: !prev[groupName],
    }));
  };

  // 切换连接展开状态（显示数据库列表）
  const toggleConnectionExpand = (connectionId, connection) => {
    const isExpanding = !expandedConnections[connectionId];
    setExpandedConnections((prev) => ({
      ...prev,
      [connectionId]: isExpanding,
    }));

    // 如果是 SeekDB 类型且正在展开，加载数据库列表
    if (isExpanding && connection.type === "seekdb" && connection.connected) {
      loadServerDatabases(connectionId);
    }
  };

  // 加载服务器数据库列表
  const loadServerDatabases = (connectionId) => {
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
  const handleSelectDatabase = (connectionId, dbName) => {
    vscode.postMessage({
      type: "selectServerDatabase",
      data: { connectionId, database: dbName },
    });
  };

  // 创建数据库
  const handleCreateServerDatabase = (connectionId) => {
    const dbName = prompt("请输入新数据库名称:");
    if (dbName && dbName.trim()) {
      vscode.postMessage({
        type: "createServerDatabase",
        data: { connectionId, name: dbName.trim() },
      });
    }
  };

  // 删除数据库
  const handleDeleteServerDatabase = (connectionId, dbName) => {
    if (confirm(`确定要删除数据库 "${dbName}" 吗？此操作不可恢复！`)) {
      vscode.postMessage({
        type: "deleteServerDatabase",
        data: { connectionId, name: dbName },
      });
      // 刷新数据库列表
      setTimeout(() => loadServerDatabases(connectionId), 500);
    }
  };

  // 刷新数据库列表
  const handleRefreshDatabases = (connectionId, e) => {
    e.stopPropagation();
    loadServerDatabases(connectionId);
  };

  // 清除警告
  const clearWarnings = () => {
    setWarnings([]);
    vscode.postMessage({ type: "clearWarnings" });
  };

  // 按连接状态分组
  const connectedList = connections.filter((c) => c.connected);
  const disconnectedList = connections.filter((c) => !c.connected);

  // 渲染单个连接项
  const renderConnectionItem = (connection, isConnected) => {
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
          {/* 展开图标 (仅 SeekDB 已连接时显示) */}
          {isConnected && isSeekDB && (
            <span className="db-expand-icon">{isExpanded ? "▼" : "▶"}</span>
          )}
          <div className="db-connection-icon">
            {DB_TYPE_ICONS[connection.type] || "🗄️"}
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
                    title="刷新数据库列表"
                  >
                    🔄
                  </button>
                )}
                <button
                  className="db-action-btn view"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleViewCollections(connection.id);
                  }}
                  title="查看集合"
                >
                  📋
                </button>
                <button
                  className="db-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDisconnect(connection.id);
                  }}
                  title="断开连接"
                >
                  ⏹
                </button>
              </>
            ) : (
              <>
                <button
                  className="db-action-btn connect"
                  onClick={() => handleConnect(connection)}
                  title="连接"
                >
                  ▶
                </button>
                <button
                  className="db-action-btn delete"
                  onClick={() => handleDelete(connection.id)}
                  title="删除"
                >
                  🗑
                </button>
              </>
            )}
          </div>
        </div>

        {/* 数据库列表 (仅 SeekDB 已连接且展开时显示) */}
        {isConnected && isSeekDB && isExpanded && (
          <div className="db-databases-list">
            {isLoading ? (
              <div className="db-loading">
                <span className="db-loading-spinner"></span>
                加载中...
              </div>
            ) : databases.length > 0 ? (
              <>
                <div className="db-databases-header">
                  <span>数据库 ({databases.length})</span>
                  <button
                    className="db-action-btn create"
                    onClick={() => handleCreateServerDatabase(connection.id)}
                    title="创建数据库"
                  >
                    ➕
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
                    <span className="db-database-icon">🗃️</span>
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
                      title="删除数据库"
                    >
                      🗑
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <div className="db-empty-databases">
                <p>暂无数据库</p>
                <button
                  className="db-create-db-btn"
                  onClick={() => handleCreateServerDatabase(connection.id)}
                >
                  ➕ 创建数据库
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
        <h3>🗄️ DATABASE</h3>
        <div className="db-header-actions">
          {warnings.length > 0 && (
            <button
              className={`db-warnings-btn ${showWarnings ? "active" : ""}`}
              onClick={() => setShowWarnings(!showWarnings)}
              title={`${warnings.length} 条警告`}
            >
              ⚠️ {warnings.length}
            </button>
          )}
          <button
            className="db-create-btn"
            onClick={handleCreateConnection}
            title="创建新连接"
          >
            ➕
          </button>
        </div>
      </div>

      {/* 警告面板 */}
      {showWarnings && warnings.length > 0 && (
        <div className="db-warnings-panel">
          <div className="db-warnings-header">
            <span>警告信息</span>
            <button className="db-clear-warnings-btn" onClick={clearWarnings}>
              清除
            </button>
          </div>
          <div className="db-warnings-list">
            {warnings.map((warning, index) => (
              <div
                key={index}
                className={`db-warning-item ${warning.type || "warning"}`}
              >
                <span className="db-warning-icon">
                  {warning.type === "error"
                    ? "❌"
                    : warning.type === "info"
                    ? "ℹ️"
                    : "⚠️"}
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
          <p>暂无数据库连接</p>
          <button
            className="db-create-connection-btn"
            onClick={handleCreateConnection}
          >
            ➕ Create Connection
          </button>
          <p className="db-hint">
            <a href="#" onClick={handleCreateConnection}>
              learn more
            </a>
          </p>
        </div>
      ) : (
        <div className="db-connections-list">
          {/* 已连接的数据库 */}
          {connectedList.length > 0 && (
            <div className="db-group">
              <div
                className="db-group-header"
                onClick={() => toggleGroup("connected")}
              >
                <span className="db-group-icon">
                  {expandedGroups["connected"] !== false ? "▼" : "▶"}
                </span>
                <span className="db-group-title">
                  已连接 ({connectedList.length})
                </span>
              </div>
              {expandedGroups["connected"] !== false && (
                <div className="db-group-content">
                  {connectedList.map((connection) =>
                    renderConnectionItem(connection, true)
                  )}
                </div>
              )}
            </div>
          )}

          {/* 未连接的数据库 */}
          {disconnectedList.length > 0 && (
            <div className="db-group">
              <div
                className="db-group-header"
                onClick={() => toggleGroup("disconnected")}
              >
                <span className="db-group-icon">
                  {expandedGroups["disconnected"] !== false ? "▼" : "▶"}
                </span>
                <span className="db-group-title">
                  已保存 ({disconnectedList.length})
                </span>
              </div>
              {expandedGroups["disconnected"] !== false && (
                <div className="db-group-content">
                  {disconnectedList.map((connection) =>
                    renderConnectionItem(connection, false)
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DatabaseConnections;
