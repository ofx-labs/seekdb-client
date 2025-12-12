import React, { useState, useEffect } from "react";
import "./CollectionBrowserPage.css";

interface ConnectionInfo {
  name: string;
  host: string;
  port: number;
  database?: string;
}

interface CollectionBrowserPageProps {
  vscode: {
    postMessage: (message: any) => void;
  };
  connectionInfo: ConnectionInfo;
  isSeekDB: boolean;
}

interface Collection {
  name: string;
  type?: string;
}

interface QueryResult {
  columns: { name: string; type: string }[];
  rows: Record<string, any>[];
  rowCount: number;
  executionTime?: string;
}

declare global {
  interface Window {
    __VSCODE_CONNECTION_INFO__?: ConnectionInfo;
    __VSCODE_IS_SEEKDB__?: boolean;
  }
}

const CollectionBrowserPage: React.FC<CollectionBrowserPageProps> = ({
  vscode,
  connectionInfo,
  isSeekDB,
}) => {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(
    null
  );
  const [query, setQuery] = useState<string>(
    isSeekDB
      ? "-- 选择左侧集合查看数据，或输入 SQL 查询"
      : "SELECT * FROM `COLLATION_CHARACTER_SET_APPLICABILITY`"
  );
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    new Set(["db", "collections"])
  );
  const [, setRowCount] = useState(0);
  const [executionTime, setExecutionTime] = useState<string>("-");

  // 监听来自扩展的消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case "queryResult":
        case "collectionData":
          setQueryResult(message.data);
          setLoading(false);
          setError(null);
          setRowCount(message.data?.rowCount || 0);
          setExecutionTime(message.data?.executionTime || "-");
          break;
        case "queryError":
        case "collectionsError":
          setError(message.data?.error || "操作失败");
          setLoading(false);
          break;
        case "collectionsList":
          setCollections(message.data.collections || []);
          setLoading(false);
          break;
        case "databasesList":
          console.log("收到数据库列表:", message.data.databases);
          break;
        case "databaseError":
          console.error("数据库操作错误:", message.data?.error);
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // 初始化：主动请求集合列表
  useEffect(() => {
    if (isSeekDB) {
      // SeekDB 连接：主动请求集合列表
      setLoading(true);
      // 延迟一下确保事件监听器已注册
      setTimeout(() => {
        vscode.postMessage({ type: "refreshCollections" });
      }, 100);
    } else {
      // 非 SeekDB 连接：执行初始查询
      setTimeout(() => {
        handleExecuteQuery();
      }, 200);
    }
  }, [isSeekDB]);

  const handleExecuteQuery = () => {
    const sql = query.trim();
    if (!sql) return;

    setLoading(true);
    setError(null);
    vscode.postMessage({ type: "executeQuery", data: { sql } });
  };

  const handleRefreshCollections = () => {
    setLoading(true);
    vscode.postMessage({ type: "refreshCollections" });
  };

  const handleCollectionClick = (collectionName: string) => {
    setSelectedCollection(collectionName);
    const newQuery = `SELECT * FROM \`${collectionName}\``;
    setQuery(newQuery);
    setLoading(true);
    setError(null);
    vscode.postMessage({
      type: "loadCollectionData",
      data: { collectionName },
    });
  };

  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const formatCell = (value: any): { display: string; title: string } => {
    if (value === null || value === undefined) {
      return { display: "", title: "" };
    }

    if (typeof value === "object") {
      try {
        const compact = JSON.stringify(value);
        const pretty = JSON.stringify(value, null, 2);
        return {
          display: compact,
          title: pretty,
        };
      } catch (err) {
        return { display: "[object Object]", title: "" };
      }
    }

    const text = String(value);
    return { display: text, title: "" };
  };

  const filteredRows =
    queryResult?.rows.filter((row) => {
      if (!searchQuery) return true;
      const searchLower = searchQuery.toLowerCase();
      return Object.values(row).some((value) =>
        String(value).toLowerCase().includes(searchLower)
      );
    }) || [];

  return (
    <div className="collection-browser-page">
      <div className="container">
        {/* 左侧边栏 */}
        <div className="sidebar">
          <div className="sidebar-header">
            <span className="icon">🔌</span>
            <span>
              {connectionInfo.host}:{connectionInfo.port}
            </span>
            <div className="sidebar-actions">
              <button title="刷新" onClick={handleRefreshCollections}>
                🔄
              </button>
              <button title="新建查询">➕</button>
              <button title="设置">⚙️</button>
            </div>
          </div>
          <div className="tree-container">
            {/* 数据库节点 */}
            <div
              className="tree-item"
              onClick={() => toggleNode("db")}
              style={{ cursor: "pointer" }}
            >
              <span className="expand-icon">
                {expandedNodes.has("db") ? "▼" : "▶"}
              </span>
              <span className="item-icon">🗄️</span>
              <span className="item-name">
                {connectionInfo.database || "information_schema"}
              </span>
            </div>

            {expandedNodes.has("db") && (
              <>
                {/* Query 节点 */}
                <div className="tree-item level-1">
                  <span className="expand-icon">▶</span>
                  <span className="item-icon">📝</span>
                  <span className="item-name">query</span>
                </div>

                {/* Collections 节点 */}
                <div
                  className="tree-item level-1"
                  onClick={() => toggleNode("collections")}
                  style={{ cursor: "pointer" }}
                >
                  <span className="expand-icon">
                    {expandedNodes.has("collections") ? "▼" : "▶"}
                  </span>
                  <span className="item-icon">📋</span>
                  <span className="item-name">collections</span>
                  <span className="tree-group-count">
                    {isSeekDB && collections.length === 0
                      ? "(加载中...)"
                      : `(${collections.length})`}
                  </span>
                </div>

                {/* 集合列表 */}
                {expandedNodes.has("collections") && (
                  <div>
                    {isSeekDB && collections.length === 0 ? (
                      <div className="loading" style={{ padding: "16px 28px" }}>
                        <div className="loading-spinner"></div>
                        加载集合列表...
                      </div>
                    ) : (
                      collections.map((collection) => (
                        <div
                          key={collection.name}
                          className={`tree-item level-2 ${
                            selectedCollection === collection.name
                              ? "selected"
                              : ""
                          }`}
                          onClick={() => handleCollectionClick(collection.name)}
                          style={{ cursor: "pointer" }}
                        >
                          <span className="expand-icon">▶</span>
                          <span className="item-icon">📄</span>
                          <span className="item-name">{collection.name}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 右侧主区域 */}
        <div className="main-content">
          {/* 查询编辑器 */}
          <div className="query-editor">
            <textarea
              className="query-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入 SQL 查询语句..."
            />
            <div className="query-actions">
              <button className="btn btn-primary" onClick={handleExecuteQuery}>
                ▶ Execute
              </button>
              <button className="btn btn-secondary">💾 Save</button>
              <button className="btn btn-secondary">📋 Format</button>
            </div>
          </div>

          {/* 结果区域 */}
          <div className="result-area">
            <div className="result-header">
              <div className="search-box">
                <span>🔍</span>
                <input
                  type="text"
                  placeholder="Search results"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="actions">
                <button title="设置">⚙️</button>
                <button title="添加">➕</button>
                <button title="删除">🗑️</button>
                <button title="切换">🔄</button>
                <button title="上移">⬆️</button>
                <button title="下移">⬇️</button>
              </div>
            </div>

            <div className="table-container">
              {loading ? (
                <div className="empty-state">
                  <div className="loading">
                    <div className="loading-spinner"></div>
                    Loading...
                  </div>
                </div>
              ) : error ? (
                <div className="empty-state">
                  <div className="icon">❌</div>
                  <p style={{ color: "var(--danger-color, #dc3545)" }}>
                    {error}
                  </p>
                </div>
              ) : !queryResult || !queryResult.columns || !queryResult.rows ? (
                <div className="empty-state">
                  <div className="icon">📊</div>
                  <p>执行查询或选择集合查看数据</p>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="row-number">#</th>
                      {queryResult.columns.map((col) => (
                        <th key={col.name}>
                          <div className="column-info">
                            <span className="column-name">* {col.name}</span>
                            <span className="column-type">{col.type}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, index) => (
                      <tr key={index}>
                        <td className="row-number">{index + 1}</td>
                        {queryResult.columns.map((col) => {
                          const { display, title } = formatCell(row[col.name]);
                          return (
                            <td key={col.name} title={title}>
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* 状态栏 */}
          <div className="status-bar">
            <div className="status-item">
              <span>📊</span>
              <span>{filteredRows.length} rows</span>
            </div>
            <div className="status-item">
              <span>⏱️</span>
              <span>{executionTime}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CollectionBrowserPage;
