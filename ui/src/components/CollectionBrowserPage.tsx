import React, { useState, useEffect } from "react";
import {
  Plug,
  RefreshCw,
  Plus,
  Settings,
  Database,
  FileText,
  List,
  File,
  ChevronDown,
  ChevronRight,
  Play,
  Search,
  Trash2,
  ArrowUp,
  ArrowDown,
  XCircle,
  BarChart3,
  Clock,
  Sparkles,
  Save,
  Pencil,
  Check,
  X,
} from "lucide-react";
import "./CollectionBrowserPage.css";

type EmbeddingType = "builtin" | "openai" | "ollama" | "anthropic" | "qwen";

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

/** 保存的查询接口 */
interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  createdAt: number;
  updatedAt: number;
}

declare global {
  interface Window {
    __VSCODE_CONNECTION_INFO__?: ConnectionInfo;
    __VSCODE_IS_SEEKDB__?: boolean;
  }
}

const CollectionBrowserPage: React.FC<CollectionBrowserPageProps> = ({
  vscode,
  connectionInfo: initialConnectionInfo,
  isSeekDB,
}) => {
  // 使用 state 管理 connectionInfo，支持动态更新
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo>(
    initialConnectionInfo
  );
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(
    null
  );
  const [query, setQuery] = useState<string>(
    isSeekDB
      ? "-- Select a collection on the left to view data, or enter a SQL query"
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

  // 向量搜索相关状态
  const [vectorSearchQuery, setVectorSearchQuery] = useState("");
  const [vectorSearchLimit, setVectorSearchLimit] = useState(10);
  const [embeddingType, setEmbeddingType] = useState<EmbeddingType>("builtin");
  const [vectorSearchLoading, setVectorSearchLoading] = useState(false);
  const [collectionModelName, setCollectionModelName] = useState<string | null>(
    null
  );
  const [searchModelName, setSearchModelName] = useState<string | null>(null);

  // 保存的查询相关状态
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [editingQueryId, setEditingQueryId] = useState<string | null>(null);
  const [editingQueryName, setEditingQueryName] = useState("");
  const [saveQueryName, setSaveQueryName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Listen for messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      console.log(
        "[CollectionBrowser] Received message:",
        message.type,
        message
      );

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
          console.error("[CollectionBrowser] Error:", message.data?.error);
          setError(message.data?.error || "Operation failed");
          setLoading(false);
          break;
        case "collectionsList":
          console.log(
            "[CollectionBrowser] Received collections:",
            message.data.collections
          );
          setCollections(message.data.collections || []);
          setLoading(false);
          break;
        case "databasesList":
          console.log("Received database list:", message.data.databases);
          break;
        case "databaseError":
          console.error("Database operation error:", message.data?.error);
          break;
        case "vectorSearchResult":
          setQueryResult(message.data);
          setVectorSearchLoading(false);
          setError(null);
          setRowCount(message.data?.rowCount || 0);
          setExecutionTime(message.data?.executionTime || "-");
          setCollectionModelName(message.data?.collectionModelName || null);
          setSearchModelName(message.data?.searchModelName || null);
          break;
        case "vectorSearchError":
          setError(message.data?.error || "Vector search failed");
          setVectorSearchLoading(false);
          break;
        case "connectionInfoUpdated":
          // 数据库切换时更新 connectionInfo
          console.log(
            "[CollectionBrowser] Connection info updated:",
            message.data
          );
          setConnectionInfo(message.data);
          // 清空当前选中的 collection
          setSelectedCollection(null);
          setQueryResult(null);
          break;
        case "savedQueriesList":
          // 收到已保存的查询列表
          console.log(
            "[CollectionBrowser] Saved queries:",
            message.data.queries
          );
          setSavedQueries(message.data.queries || []);
          break;
        case "querySaved":
          // 查询保存成功
          console.log("[CollectionBrowser] Query saved:", message.data);
          setShowSaveDialog(false);
          setSaveQueryName("");
          // 刷新查询列表
          vscode.postMessage({ type: "getSavedQueries" });
          break;
        case "queryDeleted":
          // 查询删除成功
          console.log("[CollectionBrowser] Query deleted:", message.data);
          // 刷新查询列表
          vscode.postMessage({ type: "getSavedQueries" });
          break;
        case "queryUpdated":
          // 查询更新成功
          console.log("[CollectionBrowser] Query updated:", message.data);
          setEditingQueryId(null);
          setEditingQueryName("");
          // 刷新查询列表
          vscode.postMessage({ type: "getSavedQueries" });
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Initialize: actively request collections list and saved queries
  useEffect(() => {
    // 请求已保存的查询列表
    setTimeout(() => {
      vscode.postMessage({ type: "getSavedQueries" });
    }, 50);

    if (isSeekDB) {
      // seekdb connection: actively request collections list
      console.log(
        "[CollectionBrowser] isSeekDB=true, requesting collections..."
      );
      setLoading(true);
      // Delay to ensure event listener is registered
      setTimeout(() => {
        console.log("[CollectionBrowser] Sending refreshCollections message");
        vscode.postMessage({ type: "refreshCollections" });
      }, 100);
    } else {
      // Non-seekdb connection: execute initial query
      console.log(
        "[CollectionBrowser] isSeekDB=false, executing initial query"
      );
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
    // 重置模型信息
    setCollectionModelName(null);
    setSearchModelName(null);
    vscode.postMessage({
      type: "loadCollectionData",
      data: { collectionName },
    });
  };

  // 向量相似度搜索
  const handleVectorSearch = () => {
    if (!vectorSearchQuery.trim()) return;
    if (!selectedCollection) {
      setError("Please select a collection first");
      return;
    }

    setVectorSearchLoading(true);
    setError(null);
    vscode.postMessage({
      type: "vectorSearch",
      data: {
        query: vectorSearchQuery,
        collectionName: selectedCollection,
        limit: vectorSearchLimit,
        embeddingType: embeddingType,
      },
    });
  };

  // 保存当前查询
  const handleSaveQuery = () => {
    const sql = query.trim();
    if (!sql || sql.startsWith("--")) {
      setError("Please enter a valid SQL query before saving");
      return;
    }
    setShowSaveDialog(true);
    setSaveQueryName("");
  };

  // 确认保存查询
  const handleConfirmSaveQuery = () => {
    const name = saveQueryName.trim();
    if (!name) {
      setError("Please enter a name for the query");
      return;
    }
    vscode.postMessage({
      type: "saveQuery",
      data: { name, sql: query.trim() },
    });
  };

  // 取消保存
  const handleCancelSaveQuery = () => {
    setShowSaveDialog(false);
    setSaveQueryName("");
  };

  // 加载保存的查询
  const handleLoadSavedQuery = (savedQuery: SavedQuery) => {
    setQuery(savedQuery.sql);
    setSelectedCollection(null);
  };

  // 开始编辑查询名称
  const handleStartEditQuery = (
    savedQuery: SavedQuery,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setEditingQueryId(savedQuery.id);
    setEditingQueryName(savedQuery.name);
  };

  // 确认编辑查询名称
  const handleConfirmEditQuery = (
    savedQuery: SavedQuery,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    const name = editingQueryName.trim();
    if (!name) {
      setEditingQueryId(null);
      setEditingQueryName("");
      return;
    }
    vscode.postMessage({
      type: "updateQuery",
      data: { id: savedQuery.id, name },
    });
  };

  // 取消编辑
  const handleCancelEditQuery = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingQueryId(null);
    setEditingQueryName("");
  };

  // 删除保存的查询
  const handleDeleteSavedQuery = (queryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    vscode.postMessage({
      type: "deleteQuery",
      data: { id: queryId },
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
        {/* Left sidebar */}
        <div className="sidebar">
          <div className="sidebar-header">
            <Plug size={16} className="icon" />
            <span>
              {connectionInfo.host}:{connectionInfo.port}
            </span>
            <div className="sidebar-actions">
              <button title="Refresh" onClick={handleRefreshCollections}>
                <RefreshCw size={14} />
              </button>
              {/* <button title="New query">
                <Plus size={14} />
              </button>
              <button title="Settings">
                <Settings size={14} />
              </button> */}
            </div>
          </div>
          <div className="tree-container">
            {/* Database node */}
            <div
              className="tree-item"
              onClick={() => toggleNode("db")}
              style={{ cursor: "pointer" }}
            >
              <span className="expand-icon">
                {expandedNodes.has("db") ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
              </span>
              <Database size={14} className="item-icon" />
              <span className="item-name">
                {connectionInfo.database || "information_schema"}
              </span>
            </div>

            {expandedNodes.has("db") && (
              <>
                {/* Query node - 可展开显示保存的查询 */}
                <div
                  className="tree-item level-1"
                  onClick={() => toggleNode("queries")}
                  style={{ cursor: "pointer" }}
                >
                  <span className="expand-icon">
                    {expandedNodes.has("queries") ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )}
                  </span>
                  <FileText size={14} className="item-icon" />
                  <span className="item-name">queries</span>
                  <span className="tree-group-count">
                    ({savedQueries.length})
                  </span>
                </div>

                {/* Saved queries list */}
                {expandedNodes.has("queries") && (
                  <div>
                    {savedQueries.length === 0 ? (
                      <div
                        className="empty-state"
                        style={{
                          padding: "8px 40px",
                          fontSize: "12px",
                          color: "var(--vscode-descriptionForeground)",
                          fontStyle: "italic",
                        }}
                      >
                        No saved queries
                      </div>
                    ) : (
                      savedQueries.map((savedQuery) => (
                        <div
                          key={savedQuery.id}
                          className="tree-item level-2 saved-query-item"
                          onClick={() => handleLoadSavedQuery(savedQuery)}
                          style={{ cursor: "pointer" }}
                        >
                          <span className="expand-icon">
                            <ChevronRight size={12} />
                          </span>
                          <File size={14} className="item-icon query-icon" />
                          {editingQueryId === savedQuery.id ? (
                            <div
                              className="query-edit-container"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="text"
                                className="query-edit-input"
                                value={editingQueryName}
                                onChange={(e) =>
                                  setEditingQueryName(e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    handleConfirmEditQuery(
                                      savedQuery,
                                      e as any
                                    );
                                  if (e.key === "Escape")
                                    handleCancelEditQuery(e as any);
                                }}
                                autoFocus
                              />
                              <button
                                className="query-action-btn"
                                onClick={(e) =>
                                  handleConfirmEditQuery(savedQuery, e)
                                }
                                title="Save"
                              >
                                <Check size={12} />
                              </button>
                              <button
                                className="query-action-btn"
                                onClick={handleCancelEditQuery}
                                title="Cancel"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span
                                className="item-name"
                                title={savedQuery.sql}
                              >
                                {savedQuery.name}
                              </span>
                              <div className="query-item-actions">
                                <button
                                  className="query-action-btn"
                                  onClick={(e) =>
                                    handleStartEditQuery(savedQuery, e)
                                  }
                                  title="Rename"
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  className="query-action-btn delete"
                                  onClick={(e) =>
                                    handleDeleteSavedQuery(savedQuery.id, e)
                                  }
                                  title="Delete"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Collections node */}
                <div
                  className="tree-item level-1"
                  onClick={() => toggleNode("collections")}
                  style={{ cursor: "pointer" }}
                >
                  <span className="expand-icon">
                    {expandedNodes.has("collections") ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )}
                  </span>
                  <List size={14} className="item-icon" />
                  <span className="item-name">collections</span>
                  <span className="tree-group-count">
                    {isSeekDB && loading && collections.length === 0
                      ? "(Loading...)"
                      : `(${collections.length})`}
                  </span>
                </div>

                {/* Collections list */}
                {expandedNodes.has("collections") && (
                  <div>
                    {isSeekDB && loading && collections.length === 0 ? (
                      <div className="loading" style={{ padding: "16px 28px" }}>
                        <div className="loading-spinner"></div>
                        Loading collections...
                      </div>
                    ) : collections.length === 0 ? (
                      <div
                        className="empty-state"
                        style={{
                          padding: "16px 28px",
                          fontSize: "12px",
                          color: "var(--vscode-descriptionForeground)",
                          fontStyle: "italic",
                        }}
                      >
                        No collections found
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
                          <span className="expand-icon">
                            <ChevronRight size={12} />
                          </span>
                          <File size={14} className="item-icon" />
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

        {/* Right main area */}
        <div className="main-content">
          {/* Query editor */}
          <div className="query-editor">
            <textarea
              className="query-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter SQL query..."
            />
            <div className="query-actions">
              <button className="btn btn-primary" onClick={handleExecuteQuery}>
                <Play size={14} /> Execute
              </button>
              <button className="btn btn-secondary" onClick={handleSaveQuery}>
                <Save size={14} /> Save
              </button>
            </div>
            {/* 保存查询对话框 */}
            {showSaveDialog && (
              <div className="save-query-dialog">
                <input
                  type="text"
                  className="save-query-input"
                  placeholder="Enter query name..."
                  value={saveQueryName}
                  onChange={(e) => setSaveQueryName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmSaveQuery();
                    if (e.key === "Escape") handleCancelSaveQuery();
                  }}
                  autoFocus
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleConfirmSaveQuery}
                >
                  <Check size={12} />
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleCancelSaveQuery}
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>

          {/* Vector Similarity Search - Only for seekdb */}
          {isSeekDB && (
            <div className="vector-search-section">
              <div className="vector-search-header">
                <Sparkles size={16} />
                <span>Similarity Search</span>
              </div>
              <div className="vector-search-form">
                <div className="vector-search-input-row">
                  <input
                    type="text"
                    className="vector-search-input"
                    placeholder="Enter search text..."
                    value={vectorSearchQuery}
                    onChange={(e) => setVectorSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleVectorSearch()}
                  />
                  <button
                    className="btn btn-success vector-search-btn"
                    onClick={handleVectorSearch}
                    disabled={vectorSearchLoading || !selectedCollection}
                  >
                    {vectorSearchLoading ? (
                      <RefreshCw size={14} className="spin" />
                    ) : (
                      <Search size={14} />
                    )}
                    Search
                  </button>
                </div>
                <div className="vector-search-options">
                  <select
                    className="vector-search-select"
                    value={embeddingType}
                    onChange={(e) =>
                      setEmbeddingType(e.target.value as EmbeddingType)
                    }
                  >
                    <option value="builtin">Built-in Model</option>
                  </select>
                  <input
                    type="number"
                    className="vector-search-limit"
                    min={1}
                    max={100}
                    value={vectorSearchLimit}
                    onChange={(e) =>
                      setVectorSearchLimit(parseInt(e.target.value) || 10)
                    }
                  />
                </div>
                {(collectionModelName || searchModelName) && (
                  <div className="vector-search-model-info">
                    <div className="model-info-row">
                      <span className="model-label">Collection Model:</span>
                      <span className="model-value">
                        {collectionModelName || "Unknown"}
                      </span>
                    </div>
                    <div className="model-info-row">
                      <span className="model-label">Search Model:</span>
                      <span className="model-value">
                        {searchModelName || "Unknown"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Results area */}
          <div className="result-area">
            <div className="result-header">
              <div className="search-box">
                <Search size={14} />
                <input
                  type="text"
                  placeholder="Search results"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="actions">
                <button title="Settings">
                  <Settings size={14} />
                </button>
                <button title="Add">
                  <Plus size={14} />
                </button>
                <button title="Delete">
                  <Trash2 size={14} />
                </button>
                <button title="Refresh">
                  <RefreshCw size={14} />
                </button>
                <button title="Move up">
                  <ArrowUp size={14} />
                </button>
                <button title="Move down">
                  <ArrowDown size={14} />
                </button>
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
                  <XCircle size={48} className="icon" />
                  <p style={{ color: "var(--danger-color, #dc3545)" }}>
                    {error}
                  </p>
                </div>
              ) : !queryResult || !queryResult.columns || !queryResult.rows ? (
                <div className="empty-state">
                  <BarChart3 size={48} className="icon" />
                  <p>Execute a query or select a collection to view data</p>
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

          {/* Status bar */}
          <div className="status-bar">
            <div className="status-item">
              <BarChart3 size={14} />
              <span>{filteredRows.length} rows</span>
            </div>
            <div className="status-item">
              <Clock size={14} />
              <span>{executionTime}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CollectionBrowserPage;
