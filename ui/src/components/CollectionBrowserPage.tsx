import React, { useState, useEffect, useRef } from "react";
import {
  Plug,
  RefreshCw,
  Plus,
  Database,
  FileText,
  List,
  File,
  ChevronDown,
  ChevronRight,
  Play,
  Search,
  Trash2,
  XCircle,
  BarChart3,
  Clock,
  Sparkles,
  Save,
  Pencil,
  Check,
  X,
  Eye,
  Code2,
  Copy,
  Settings2,
} from "lucide-react";
import "./CollectionBrowserPage.css";

type EmbeddingType = "builtin" | "openai" | "ollama" | "anthropic" | "qwen";
type CodeSnippetType = "nodejs-seekdb" | "python-pyseekdb";

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
  isOceanBaseCloud?: boolean;
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
    __VSCODE_IS_OCEANBASE_CLOUD__?: boolean;
  }
}

// 集合名称前缀常量
const COLLECTION_PREFIX = "c$v1$";

const CollectionBrowserPage: React.FC<CollectionBrowserPageProps> = ({
  vscode,
  connectionInfo: initialConnectionInfo,
  isSeekDB,
  isOceanBaseCloud: initialIsOceanBaseCloud,
}) => {
  // 从 window 对象获取配置（如果通过 HTML 注入）
  const isOceanBaseCloud =
    initialIsOceanBaseCloud ?? window.__VSCODE_IS_OCEANBASE_CLOUD__ ?? false;
  // 使用 state 管理 connectionInfo，支持动态更新
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo>(
    initialConnectionInfo,
  );

  // 术语差异化：SeekDB 使用 collection/document，云数据库使用 table/row
  const terminology = {
    collection: isOceanBaseCloud ? "table" : "collection",
    collections: isOceanBaseCloud ? "tables" : "collections",
    document: isOceanBaseCloud ? "row" : "document",
    documents: isOceanBaseCloud ? "rows" : "documents",
    Collection: isOceanBaseCloud ? "Table" : "Collection",
    Collections: isOceanBaseCloud ? "Tables" : "Collections",
    Document: isOceanBaseCloud ? "Row" : "Document",
    Documents: isOceanBaseCloud ? "Rows" : "Documents",
  };
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(
    null,
  );
  const [query, setQuery] = useState<string>(
    isSeekDB || isOceanBaseCloud
      ? "-- Select a table on the left to view data, or enter a SQL query"
      : "SELECT * FROM `COLLATION_CHARACTER_SET_APPLICABILITY`",
  );
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    new Set(["db", "collections"]),
  );
  const [, setRowCount] = useState(0);
  const [executionTime, setExecutionTime] = useState<string>("-");

  // 向量搜索相关状态
  const [vectorSearchQuery, setVectorSearchQuery] = useState("");
  const [vectorSearchLimit, setVectorSearchLimit] = useState(10);
  const [embeddingType, setEmbeddingType] = useState<EmbeddingType>("builtin");
  const [vectorSearchLoading, setVectorSearchLoading] = useState(false);
  const [collectionModelName, setCollectionModelName] = useState<string | null>(
    null,
  );
  const [searchModelName, setSearchModelName] = useState<string | null>(null);
  const [modelWarning, setModelWarning] = useState<string | null>(null);

  // 保存的查询相关状态
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [editingQueryId, setEditingQueryId] = useState<string | null>(null);
  const [editingQueryName, setEditingQueryName] = useState("");
  const [saveQueryName, setSaveQueryName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // 集合管理相关状态
  const [showCreateCollectionDialog, setShowCreateCollectionDialog] =
    useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [editingCollectionName, setEditingCollectionName] = useState<
    string | null
  >(null);
  const [editingCollectionNewName, setEditingCollectionNewName] = useState("");
  const [collectionToDelete, setCollectionToDelete] = useState<string | null>(
    null,
  );
  const [collectionOperationLoading, setCollectionOperationLoading] =
    useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 文档行选中和右键菜单相关状态
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    rowIndex: number | null;
    rowData: Record<string, any> | null;
  }>({ visible: false, x: 0, y: 0, rowIndex: null, rowData: null });
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [currentRowData, setCurrentRowData] = useState<Record<
    string,
    any
  > | null>(null);
  const [editRowData, setEditRowData] = useState<Record<string, any> | null>(
    null,
  );
  const [documentOperationLoading, setDocumentOperationLoading] =
    useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // 新增文档相关状态
  const [showAddDocumentDialog, setShowAddDocumentDialog] = useState(false);
  const [newDocumentData, setNewDocumentData] = useState<
    Record<string, string>
  >({});

  // 代码片段侧边栏相关状态
  const [showCodeSnippet, setShowCodeSnippet] = useState(false);
  const [codeSnippetType, setCodeSnippetType] =
    useState<CodeSnippetType>("nodejs-seekdb");
  const [codeCopied, setCodeCopied] = useState(false);

  // 侧边栏宽度拖动相关状态
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(280);
  const [rightPanelWidth, setRightPanelWidth] = useState(420);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 侧边栏宽度限制常量
  const LEFT_SIDEBAR_MIN_WIDTH = 200;
  const LEFT_SIDEBAR_MAX_WIDTH = 500;
  const RIGHT_PANEL_MIN_WIDTH = 300;
  const RIGHT_PANEL_MAX_WIDTH = 600;

  // Listen for messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const message = event.data;
        console.log(
          "[CollectionBrowser] Received message:",
          message.type,
          message,
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
              message.data.collections,
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
            setModelWarning(message.data?.modelWarning || null);
            break;
          case "vectorSearchError":
            setError(message.data?.error || "Vector search failed");
            setVectorSearchLoading(false);
            break;
          case "connectionInfoUpdated":
            // 数据库切换时更新 connectionInfo
            console.log(
              "[CollectionBrowser] Connection info updated:",
              message.data,
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
              message.data.queries,
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
          case "collectionCreated":
            // 集合创建成功
            console.log(
              "[CollectionBrowser] Collection created:",
              message.data,
            );
            setShowCreateCollectionDialog(false);
            setNewCollectionName("");
            setCollectionOperationLoading(false);
            setError(null);
            // 显示成功消息
            setSuccessMessage(
              `Collection "${message.data?.name || ""}" created successfully`,
            );
            setTimeout(() => setSuccessMessage(null), 3000);
            // 刷新集合列表
            vscode.postMessage({ type: "refreshCollections" });
            break;
          case "collectionDeleted":
            // 集合删除成功
            console.log(
              "[CollectionBrowser] Collection deleted:",
              message.data,
            );
            setCollectionToDelete(null);
            setCollectionOperationLoading(false);
            setError(null);
            // 显示成功消息
            setSuccessMessage(
              `Collection "${message.data?.name || ""}" deleted successfully`,
            );
            setTimeout(() => setSuccessMessage(null), 3000);
            // 如果删除的是当前选中的集合，清空选择
            if (selectedCollection === message.data?.name) {
              setSelectedCollection(null);
              setQueryResult(null);
            }
            // 刷新集合列表
            vscode.postMessage({ type: "refreshCollections" });
            break;
          case "collectionRenamed":
            // 集合重命名成功
            console.log(
              "[CollectionBrowser] Collection renamed:",
              message.data,
            );
            setEditingCollectionName(null);
            setEditingCollectionNewName("");
            setCollectionOperationLoading(false);
            setError(null);
            // 显示成功消息
            setSuccessMessage(
              `Collection renamed to "${
                message.data?.newName || ""
              }" successfully`,
            );
            setTimeout(() => setSuccessMessage(null), 3000);
            // 如果重命名的是当前选中的集合，更新选择
            if (
              selectedCollection === message.data?.oldName &&
              message.data?.newName
            ) {
              setSelectedCollection(message.data.newName);
            }
            // 刷新集合列表
            vscode.postMessage({ type: "refreshCollections" });
            break;
          case "collectionError":
            // 集合操作失败
            console.error(
              "[CollectionBrowser] Collection operation error:",
              message.data?.error,
            );
            setError(message.data?.error || "Collection operation failed");
            setCollectionOperationLoading(false);
            break;
          case "tableCreated":
            // 表创建成功（云数据库）
            console.log("[CollectionBrowser] Table created:", message.data);
            setShowCreateCollectionDialog(false);
            setNewCollectionName("");
            setCollectionOperationLoading(false);
            setError(null);
            setSuccessMessage(
              `Table "${message.data?.name || ""}" created successfully`,
            );
            setTimeout(() => setSuccessMessage(null), 3000);
            vscode.postMessage({ type: "refreshCollections" });
            break;
          case "tableDeleted":
            // 表删除成功（云数据库）
            console.log("[CollectionBrowser] Table deleted:", message.data);
            setCollectionToDelete(null);
            setCollectionOperationLoading(false);
            setError(null);
            setSuccessMessage(
              `Table "${message.data?.name || ""}" deleted successfully`,
            );
            setTimeout(() => setSuccessMessage(null), 3000);
            if (selectedCollection === message.data?.name) {
              setSelectedCollection(null);
              setQueryResult(null);
            }
            vscode.postMessage({ type: "refreshCollections" });
            break;
          case "tableError":
            // 表操作失败（云数据库）
            console.error(
              "[CollectionBrowser] Table operation error:",
              message.data?.error,
            );
            setError(message.data?.error || "Table operation failed");
            setCollectionOperationLoading(false);
            break;
          case "documentDeleted":
            // 文档删除成功
            console.log("[CollectionBrowser] Document deleted:", message.data);
            setShowDeleteConfirm(false);
            setCurrentRowData(null);
            setSelectedRowIndex(null);
            setDocumentOperationLoading(false);
            setSuccessMessage("Document deleted successfully");
            setTimeout(() => setSuccessMessage(null), 3000);
            // 刷新当前集合数据
            if (selectedCollection) {
              vscode.postMessage({
                type: "loadCollectionData",
                data: { collectionName: selectedCollection },
              });
            }
            break;
          case "documentUpdated":
            // 文档更新成功
            console.log("[CollectionBrowser] Document updated:", message.data);
            setShowEditDialog(false);
            setEditRowData(null);
            setCurrentRowData(null);
            setSelectedRowIndex(null);
            setDocumentOperationLoading(false);
            setSuccessMessage("Document updated successfully");
            setTimeout(() => setSuccessMessage(null), 3000);
            // 刷新当前集合数据
            if (selectedCollection) {
              vscode.postMessage({
                type: "loadCollectionData",
                data: { collectionName: selectedCollection },
              });
            }
            break;
          case "documentError":
            // 文档操作失败
            console.error(
              "[CollectionBrowser] Document operation error:",
              message.data?.error,
            );
            setError(message.data?.error || "Document operation failed");
            setDocumentOperationLoading(false);
            // 关闭所有文档操作对话框
            setShowDeleteConfirm(false);
            setShowEditDialog(false);
            setShowAddDocumentDialog(false);
            setCurrentRowData(null);
            setEditRowData(null);
            break;
          case "documentCreated":
            // 文档创建成功
            console.log("[CollectionBrowser] Document created:", message.data);
            setShowAddDocumentDialog(false);
            setNewDocumentData({});
            setDocumentOperationLoading(false);
            setSuccessMessage("Document created successfully");
            setTimeout(() => setSuccessMessage(null), 3000);
            // 刷新当前集合数据
            if (selectedCollection) {
              vscode.postMessage({
                type: "loadCollectionData",
                data: { collectionName: selectedCollection },
              });
            }
            break;
          case "rowCreated":
            // 行创建成功（云数据库）
            console.log("[CollectionBrowser] Row created:", message.data);
            setShowAddDocumentDialog(false);
            setNewDocumentData({});
            setDocumentOperationLoading(false);
            setSuccessMessage("Row inserted successfully");
            setTimeout(() => setSuccessMessage(null), 3000);
            if (selectedCollection) {
              vscode.postMessage({
                type: "loadCollectionData",
                data: { collectionName: selectedCollection },
              });
            }
            break;
          case "rowUpdated":
            // 行更新成功（云数据库）
            console.log("[CollectionBrowser] Row updated:", message.data);
            setShowEditDialog(false);
            setEditRowData(null);
            setCurrentRowData(null);
            setSelectedRowIndex(null);
            setDocumentOperationLoading(false);
            setSuccessMessage("Row updated successfully");
            setTimeout(() => setSuccessMessage(null), 3000);
            if (selectedCollection) {
              vscode.postMessage({
                type: "loadCollectionData",
                data: { collectionName: selectedCollection },
              });
            }
            break;
          case "rowDeleted":
            // 行删除成功（云数据库）
            console.log("[CollectionBrowser] Row deleted:", message.data);
            setShowDeleteConfirm(false);
            setCurrentRowData(null);
            setSelectedRowIndex(null);
            setDocumentOperationLoading(false);
            setSuccessMessage("Row deleted successfully");
            setTimeout(() => setSuccessMessage(null), 3000);
            if (selectedCollection) {
              vscode.postMessage({
                type: "loadCollectionData",
                data: { collectionName: selectedCollection },
              });
            }
            break;
          case "rowError":
            // 行操作失败（云数据库）
            console.error(
              "[CollectionBrowser] Row operation error:",
              message.data?.error,
            );
            setError(message.data?.error || "Row operation failed");
            setDocumentOperationLoading(false);
            setShowDeleteConfirm(false);
            setShowEditDialog(false);
            setShowAddDocumentDialog(false);
            setCurrentRowData(null);
            setEditRowData(null);
            break;
        }
      } catch (err) {
        console.error("[CollectionBrowser] Error handling message:", err);
        setError(err instanceof Error ? err.message : "An error occurred");
        setLoading(false);
        setDocumentOperationLoading(false);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [selectedCollection]);

  // 点击外部关闭右键菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(event.target as Node)
      ) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    if (contextMenu.visible) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [contextMenu.visible]);

  // 侧边栏拖动逻辑
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingLeft && containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const newWidth = e.clientX - containerRect.left;
        setLeftSidebarWidth(
          Math.max(
            LEFT_SIDEBAR_MIN_WIDTH,
            Math.min(LEFT_SIDEBAR_MAX_WIDTH, newWidth),
          ),
        );
      }
      if (isDraggingRight && containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const newWidth = containerRect.right - e.clientX;
        setRightPanelWidth(
          Math.max(
            RIGHT_PANEL_MIN_WIDTH,
            Math.min(RIGHT_PANEL_MAX_WIDTH, newWidth),
          ),
        );
      }
    };

    const handleMouseUp = () => {
      setIsDraggingLeft(false);
      setIsDraggingRight(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    if (isDraggingLeft || isDraggingRight) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingLeft, isDraggingRight]);

  // 开始拖动左侧边栏
  const handleLeftResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingLeft(true);
  };

  // 开始拖动右侧面板
  const handleRightResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingRight(true);
  };

  // Initialize: actively request collections list and saved queries
  useEffect(() => {
    // 请求已保存的查询列表
    setTimeout(() => {
      vscode.postMessage({ type: "getSavedQueries" });
    }, 50);

    if (isSeekDB || isOceanBaseCloud) {
      // seekdb or oceanbase-cloud connection: actively request collections/tables list
      console.log(
        `[CollectionBrowser] isSeekDB=${isSeekDB}, isOceanBaseCloud=${isOceanBaseCloud}, requesting collections/tables...`,
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
        "[CollectionBrowser] isSeekDB=false, executing initial query",
      );
      setTimeout(() => {
        handleExecuteQuery();
      }, 200);
    }
  }, [isSeekDB, isOceanBaseCloud]);

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
    setModelWarning(null);
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
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    setEditingQueryId(savedQuery.id);
    setEditingQueryName(savedQuery.name);
  };

  // 确认编辑查询名称
  const handleConfirmEditQuery = (
    savedQuery: SavedQuery,
    e: React.MouseEvent,
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

  // 创建集合/表
  const handleCreateCollection = () => {
    const name = newCollectionName.trim();
    if (!name) {
      setError(`Please enter a ${terminology.collection} name`);
      return;
    }
    setCollectionOperationLoading(true);
    setError(null);

    if (isOceanBaseCloud) {
      // 云数据库：创建表
      vscode.postMessage({
        type: "createTable",
        data: { name },
      });
    } else {
      // SeekDB：自动添加前缀
      vscode.postMessage({
        type: "createCollection",
        data: { name },
      });
    }
  };

  // 取消创建集合
  const handleCancelCreateCollection = () => {
    setShowCreateCollectionDialog(false);
    setNewCollectionName("");
  };

  // 开始重命名集合
  const handleStartRenameCollection = (
    collectionName: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    setEditingCollectionName(collectionName);
    // 去除前缀，只显示后半部分供用户编辑
    const nameWithoutPrefix = collectionName.startsWith(COLLECTION_PREFIX)
      ? collectionName.slice(COLLECTION_PREFIX.length)
      : collectionName;
    setEditingCollectionNewName(nameWithoutPrefix);
  };

  // 确认重命名集合
  const handleConfirmRenameCollection = (
    oldName: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    const inputName = editingCollectionNewName.trim();
    if (!inputName) {
      setEditingCollectionName(null);
      setEditingCollectionNewName("");
      return;
    }
    // 自动添加前缀
    const newName = `${COLLECTION_PREFIX}${inputName}`;
    if (newName === oldName) {
      setEditingCollectionName(null);
      setEditingCollectionNewName("");
      return;
    }
    setCollectionOperationLoading(true);
    setError(null);
    vscode.postMessage({
      type: "renameCollection",
      data: { oldName, newName },
    });
  };

  // 取消重命名集合
  const handleCancelRenameCollection = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCollectionName(null);
    setEditingCollectionNewName("");
  };

  // 删除集合（显示确认对话框）
  const handleShowDeleteCollection = (
    collectionName: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    setCollectionToDelete(collectionName);
  };

  // 确认删除集合/表
  const handleConfirmDeleteCollection = () => {
    if (!collectionToDelete) return;
    setCollectionOperationLoading(true);
    setError(null);

    if (isOceanBaseCloud) {
      // 云数据库：删除表
      vscode.postMessage({
        type: "deleteTable",
        data: { name: collectionToDelete },
      });
    } else {
      // SeekDB：删除集合
      vscode.postMessage({
        type: "deleteCollection",
        data: { name: collectionToDelete },
      });
    }
  };

  // 取消删除集合
  const handleCancelDeleteCollection = () => {
    setCollectionToDelete(null);
  };

  // 文档行右键菜单
  const handleRowContextMenu = (
    event: React.MouseEvent,
    rowIndex: number,
    rowData: Record<string, any>,
  ) => {
    event.preventDefault();
    setSelectedRowIndex(rowIndex);
    setContextMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      rowIndex,
      rowData,
    });
  };

  // 文档行单击选中
  const handleRowClick = (rowIndex: number) => {
    setSelectedRowIndex(rowIndex === selectedRowIndex ? null : rowIndex);
  };

  // 查看文档
  const handleViewDocument = () => {
    try {
      if (contextMenu.rowData) {
        setCurrentRowData({ ...contextMenu.rowData });
        setShowViewDialog(true);
      }
      setContextMenu((prev) => ({ ...prev, visible: false }));
    } catch (err) {
      console.error("[CollectionBrowser] Error in handleViewDocument:", err);
      setError(err instanceof Error ? err.message : "Failed to view document");
    }
  };

  // 编辑文档
  const handleEditDocument = () => {
    try {
      if (contextMenu.rowData) {
        setCurrentRowData({ ...contextMenu.rowData });
        setEditRowData({ ...contextMenu.rowData });
        setShowEditDialog(true);
      }
      setContextMenu((prev) => ({ ...prev, visible: false }));
    } catch (err) {
      console.error("[CollectionBrowser] Error in handleEditDocument:", err);
      setError(err instanceof Error ? err.message : "Failed to edit document");
    }
  };

  // 删除文档（显示确认对话框）
  const handleShowDeleteDocument = () => {
    try {
      console.log(
        "[CollectionBrowser] handleShowDeleteDocument:",
        contextMenu.rowData,
      );
      if (contextMenu.rowData) {
        setCurrentRowData({ ...contextMenu.rowData });
        setShowDeleteConfirm(true);
      }
      setContextMenu((prev) => ({ ...prev, visible: false }));
    } catch (err) {
      console.error(
        "[CollectionBrowser] Error in handleShowDeleteDocument:",
        err,
      );
      setError(
        err instanceof Error ? err.message : "Failed to show delete dialog",
      );
    }
  };

  // 确认删除文档/行
  const handleConfirmDeleteDocument = () => {
    try {
      if (!currentRowData || !selectedCollection) {
        console.warn(
          "[CollectionBrowser] handleConfirmDeleteDocument: missing data",
          { currentRowData, selectedCollection },
        );
        return;
      }
      setDocumentOperationLoading(true);
      setError(null);

      if (isOceanBaseCloud) {
        // 云数据库：删除行
        console.log("[CollectionBrowser] Deleting row:", {
          tableName: selectedCollection,
          rowData: currentRowData,
        });

        vscode.postMessage({
          type: "deleteRow",
          data: {
            tableName: selectedCollection,
            rowData: currentRowData,
            columns: queryResult?.columns,
          },
        });
      } else {
        // SeekDB：删除文档
        const documentId = currentRowData._id || currentRowData.id;
        console.log("[CollectionBrowser] Deleting document:", {
          collectionName: selectedCollection,
          documentId,
        });

        vscode.postMessage({
          type: "deleteDocument",
          data: {
            collectionName: selectedCollection,
            documentId,
            rowData: currentRowData,
          },
        });
      }
    } catch (err) {
      console.error(
        "[CollectionBrowser] Error in handleConfirmDeleteDocument:",
        err,
      );
      setDocumentOperationLoading(false);
      setError(
        err instanceof Error
          ? err.message
          : `Failed to delete ${terminology.document}`,
      );
    }
  };

  // 取消删除文档
  const handleCancelDeleteDocument = () => {
    setShowDeleteConfirm(false);
    setCurrentRowData(null);
  };

  // 确认更新文档/行
  const handleConfirmUpdateDocument = () => {
    if (!editRowData || !currentRowData || !selectedCollection) return;
    setDocumentOperationLoading(true);
    setError(null);

    if (isOceanBaseCloud) {
      // 云数据库：更新行
      vscode.postMessage({
        type: "updateRow",
        data: {
          tableName: selectedCollection,
          originalData: currentRowData,
          updatedData: editRowData,
          columns: queryResult?.columns,
        },
      });
    } else {
      // SeekDB：更新文档
      const documentId = currentRowData._id || currentRowData.id;
      vscode.postMessage({
        type: "updateDocument",
        data: {
          collectionName: selectedCollection,
          documentId,
          originalData: currentRowData,
          updatedData: editRowData,
        },
      });
    }
  };

  // 取消编辑文档
  const handleCancelEditDocument = () => {
    setShowEditDialog(false);
    setEditRowData(null);
    setCurrentRowData(null);
  };

  // 更新编辑中的字段值
  const handleEditFieldChange = (fieldName: string, value: string) => {
    if (!editRowData) return;

    // 尝试解析 JSON
    let parsedValue: any = value;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      // 如果不是有效的 JSON，保持字符串
      parsedValue = value;
    }

    setEditRowData({
      ...editRowData,
      [fieldName]: parsedValue,
    });
  };

  // 刷新当前集合数据
  const handleRefreshData = () => {
    if (!selectedCollection) {
      setError("Please select a collection first");
      return;
    }
    setLoading(true);
    setError(null);
    vscode.postMessage({
      type: "loadCollectionData",
      data: { collectionName: selectedCollection },
    });
  };

  // 打开新增文档/行对话框
  const handleShowAddDocument = () => {
    if (!selectedCollection) {
      setError(`Please select a ${terminology.collection} first`);
      return;
    }

    if (isOceanBaseCloud) {
      // 云数据库：根据表结构初始化空字段
      const initialData: Record<string, string> = {};
      if (queryResult?.columns) {
        queryResult.columns.forEach((col) => {
          initialData[col.name] = "";
        });
      }
      setNewDocumentData(initialData);
    } else {
      // SeekDB：使用 SeekDB Collection 标准字段
      // document: 文档内容（用于向量化）
      // metadata: 元数据（JSON 格式）
      const initialData: Record<string, string> = {
        document: "",
        metadata: "{}",
      };
      setNewDocumentData(initialData);
    }
    setShowAddDocumentDialog(true);
  };

  // 更新新增文档字段值
  const handleNewDocumentFieldChange = (fieldName: string, value: string) => {
    setNewDocumentData({
      ...newDocumentData,
      [fieldName]: value,
    });
  };

  // 确认新增文档/行
  const handleConfirmAddDocument = () => {
    if (!selectedCollection) return;
    setDocumentOperationLoading(true);
    setError(null);

    // 处理字段值，尝试解析 JSON
    const processedData: Record<string, any> = {};
    Object.entries(newDocumentData).forEach(([key, value]) => {
      if (value === "") {
        processedData[key] = null;
      } else {
        try {
          processedData[key] = JSON.parse(value);
        } catch {
          processedData[key] = value;
        }
      }
    });

    if (isOceanBaseCloud) {
      // 云数据库：插入行
      vscode.postMessage({
        type: "createRow",
        data: {
          tableName: selectedCollection,
          rowData: processedData,
          columns: queryResult?.columns,
        },
      });
    } else {
      // SeekDB：创建文档
      vscode.postMessage({
        type: "createDocument",
        data: {
          collectionName: selectedCollection,
          documentData: processedData,
        },
      });
    }
  };

  // 取消新增文档
  const handleCancelAddDocument = () => {
    setShowAddDocumentDialog(false);
    setNewDocumentData({});
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

  // 生成代码片段
  const generateCodeSnippet = (type: CodeSnippetType): string => {
    const host = connectionInfo.host || "localhost";
    const port = connectionInfo.port || 2881;
    const database = connectionInfo.database || "test";
    const collection = selectedCollection || "your_collection";
    const queryText = vectorSearchQuery || "your search query";

    switch (type) {
      case "nodejs-seekdb":
        return `const { Client } = require('seekdb');

// Connect to SeekDB
const client = new Client({
  host: "${host}",
  port: ${port}
});

async function main() {
  // Get database
  const db = client.getDatabase("${database}");

  // Get collection
  const collection = db.getCollection("${collection}");

  // Perform vector similarity search
  const results = await collection.query({
    queryTexts: ["${queryText}"],
    nResults: ${vectorSearchLimit}
  });

  // Print results
  results.documents[0].forEach((doc, i) => {
    console.log(\`Result \${i + 1}:\`);
    console.log(\`  Document: \${doc}\`);
    console.log(\`  Distance: \${results.distances[0][i]}\`);
    if (results.metadatas) {
      console.log(\`  Metadata: \${JSON.stringify(results.metadatas[0][i])}\`);
    }
    console.log();
  });
}

main().catch(console.error);`;

      case "python-pyseekdb":
        return `from pyseekdb import Client

# Connect to SeekDB
client = Client(
    host="${host}",
    port=${port}
)

# Get database
db = client.get_database("${database}")

# Get or create collection
collection = db.get_collection("${collection}")

# Perform vector similarity search
results = collection.query(
    query_texts=["${queryText}"],
    n_results=${vectorSearchLimit}
)

# Print results
for i, doc in enumerate(results['documents'][0]):
    print(f"Result {i + 1}:")
    print(f"  Document: {doc}")
    print(f"  Distance: {results['distances'][0][i]}")
    if results.get('metadatas'):
        print(f"  Metadata: {results['metadatas'][0][i]}")
    print()`;

      default:
        return "";
    }
  };

  // 复制代码到剪贴板
  const handleCopyCode = async () => {
    const code = generateCodeSnippet(codeSnippetType);
    try {
      await navigator.clipboard.writeText(code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  // 切换代码片段侧边栏
  const handleToggleCodeSnippet = () => {
    setShowCodeSnippet(!showCodeSnippet);
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
        String(value).toLowerCase().includes(searchLower),
      );
    }) || [];

  return (
    <div
      className={`collection-browser-page ${
        isDraggingLeft || isDraggingRight ? "resizing" : ""
      }`}
    >
      {/* 成功消息提示 */}
      {successMessage && (
        <div className="success-toast">
          <Check size={14} />
          <span>{successMessage}</span>
          <button
            className="toast-close-btn"
            onClick={() => setSuccessMessage(null)}
          >
            <X size={12} />
          </button>
        </div>
      )}
      <div className="container" ref={containerRef}>
        {/* Left sidebar */}
        <div className="sidebar" style={{ width: leftSidebarWidth }}>
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
                                      e as any,
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

                {/* Collections/Tables node */}
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
                  <span className="item-name">{terminology.collections}</span>
                  <span className="tree-group-count">
                    {(isSeekDB || isOceanBaseCloud) &&
                    loading &&
                    collections.length === 0
                      ? "(Loading...)"
                      : `(${collections.length})`}
                  </span>
                  {(isSeekDB || isOceanBaseCloud) && (
                    <div className="tree-item-actions">
                      <button
                        className="tree-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowCreateCollectionDialog(true);
                        }}
                        title={`Create ${terminology.collection}`}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Collections/Tables list */}
                {expandedNodes.has("collections") && (
                  <div>
                    {(isSeekDB || isOceanBaseCloud) &&
                    loading &&
                    collections.length === 0 ? (
                      <div className="loading" style={{ padding: "16px 28px" }}>
                        <div className="loading-spinner"></div>
                        Loading {terminology.collections}...
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
                        No {terminology.collections} found
                      </div>
                    ) : (
                      collections.map((collection) => (
                        <div
                          key={collection.name}
                          className={`tree-item level-2 collection-item ${
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
                          {editingCollectionName === collection.name &&
                          isSeekDB ? (
                            <div
                              className="collection-edit-container"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="collection-prefix-inline">
                                {COLLECTION_PREFIX}
                              </span>
                              <input
                                type="text"
                                className="collection-edit-input with-prefix"
                                value={editingCollectionNewName}
                                onChange={(e) =>
                                  setEditingCollectionNewName(e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    handleConfirmRenameCollection(
                                      collection.name,
                                      e as any,
                                    );
                                  if (e.key === "Escape")
                                    handleCancelRenameCollection(e as any);
                                }}
                                autoFocus
                                disabled={collectionOperationLoading}
                              />
                              <button
                                className="collection-action-btn"
                                onClick={(e) =>
                                  handleConfirmRenameCollection(
                                    collection.name,
                                    e,
                                  )
                                }
                                title="Save"
                                disabled={collectionOperationLoading}
                              >
                                <Check size={12} />
                              </button>
                              <button
                                className="collection-action-btn"
                                onClick={handleCancelRenameCollection}
                                title="Cancel"
                                disabled={collectionOperationLoading}
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="item-name">
                                {collection.name}
                              </span>
                              {(isSeekDB || isOceanBaseCloud) && (
                                <div className="collection-item-actions">
                                  {isSeekDB && (
                                    <button
                                      className="collection-action-btn"
                                      onClick={(e) =>
                                        handleStartRenameCollection(
                                          collection.name,
                                          e,
                                        )
                                      }
                                      title="Rename"
                                    >
                                      <Pencil size={12} />
                                    </button>
                                  )}
                                  <button
                                    className="collection-action-btn delete"
                                    onClick={(e) =>
                                      handleShowDeleteCollection(
                                        collection.name,
                                        e,
                                      )
                                    }
                                    title={`Delete ${terminology.collection}`}
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 创建集合/表对话框 */}
          {showCreateCollectionDialog && (
            <div className="collection-dialog-overlay">
              <div className="collection-dialog">
                <h4>Create {terminology.Collection}</h4>
                {isSeekDB ? (
                  <div className="collection-input-with-prefix">
                    <span className="collection-prefix-label">
                      {COLLECTION_PREFIX}
                    </span>
                    <input
                      type="text"
                      className="collection-dialog-input with-prefix"
                      placeholder={`Enter ${terminology.collection} name...`}
                      value={newCollectionName}
                      onChange={(e) => setNewCollectionName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateCollection();
                        if (e.key === "Escape") handleCancelCreateCollection();
                      }}
                      autoFocus
                      disabled={collectionOperationLoading}
                    />
                  </div>
                ) : (
                  <input
                    type="text"
                    className="collection-dialog-input"
                    placeholder={`Enter ${terminology.collection} name...`}
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateCollection();
                      if (e.key === "Escape") handleCancelCreateCollection();
                    }}
                    autoFocus
                    disabled={collectionOperationLoading}
                  />
                )}
                <div className="collection-dialog-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleCreateCollection}
                    disabled={collectionOperationLoading}
                  >
                    {collectionOperationLoading ? (
                      <RefreshCw size={12} className="spin" />
                    ) : (
                      <Check size={12} />
                    )}
                    Create
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleCancelCreateCollection}
                    disabled={collectionOperationLoading}
                  >
                    <X size={12} />
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 删除集合/表确认对话框 */}
          {collectionToDelete && (
            <div className="collection-dialog-overlay">
              <div className="collection-dialog delete-dialog">
                <h4>Delete {terminology.Collection}</h4>
                <p className="delete-warning">
                  Are you sure you want to delete {terminology.collection} "
                  <strong>{collectionToDelete}</strong>"? This action cannot be
                  undone.
                </p>
                <div className="collection-dialog-actions">
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={handleConfirmDeleteCollection}
                    disabled={collectionOperationLoading}
                  >
                    {collectionOperationLoading ? (
                      <RefreshCw size={12} className="spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                    Delete
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleCancelDeleteCollection}
                    disabled={collectionOperationLoading}
                  >
                    <X size={12} />
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Left sidebar resize handle */}
        <div
          className={`resize-handle resize-handle-left ${
            isDraggingLeft ? "active" : ""
          }`}
          onMouseDown={handleLeftResizeStart}
        />

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
              {isSeekDB && (
                <button
                  className={`btn btn-secondary ${
                    showCodeSnippet ? "active" : ""
                  }`}
                  onClick={handleToggleCodeSnippet}
                  title="Show code snippet"
                >
                  <Code2 size={14} /> Code
                </button>
              )}
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
                    {modelWarning && (
                      <div
                        className="model-warning"
                        style={{
                          backgroundColor:
                            "var(--vscode-inputValidation-warningBackground)",
                          border:
                            "1px solid var(--vscode-inputValidation-warningBorder)",
                          color: "var(--vscode-inputValidation-warningForeground)",
                          padding: "8px 12px",
                          borderRadius: "4px",
                          marginBottom: "8px",
                          fontSize: "12px",
                          lineHeight: "1.4",
                        }}
                      >
                        {modelWarning}
                      </div>
                    )}
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
                <button
                  title="Add Document"
                  onClick={handleShowAddDocument}
                  disabled={!selectedCollection || loading}
                >
                  <Plus size={14} />
                </button>
                <button
                  title="Refresh"
                  onClick={handleRefreshData}
                  disabled={!selectedCollection || loading}
                >
                  <RefreshCw size={14} className={loading ? "spin" : ""} />
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
                      <tr
                        key={index}
                        className={selectedRowIndex === index ? "selected" : ""}
                        onClick={() => handleRowClick(index)}
                        onContextMenu={(e) =>
                          handleRowContextMenu(e, index, row)
                        }
                      >
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

        {/* 代码片段侧边栏 */}
        {showCodeSnippet && (
          <>
            {/* Right panel resize handle */}
            <div
              className={`resize-handle resize-handle-right ${
                isDraggingRight ? "active" : ""
              }`}
              onMouseDown={handleRightResizeStart}
            />
            <div
              className="code-snippet-panel"
              style={{ width: rightPanelWidth }}
            >
              <div className="code-snippet-header">
                <h4>Code snippet</h4>
                <button
                  className="code-snippet-close"
                  onClick={() => setShowCodeSnippet(false)}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="code-snippet-toolbar">
                <select
                  className="code-snippet-select"
                  value={codeSnippetType}
                  onChange={(e) =>
                    setCodeSnippetType(e.target.value as CodeSnippetType)
                  }
                >
                  <option value="nodejs-seekdb">NodeJs - seekdb</option>
                  <option value="python-pyseekdb">Python - pyseekdb</option>
                </select>
                <div className="code-snippet-actions">
                  <button
                    className={`code-snippet-action-btn ${
                      codeCopied ? "copied" : ""
                    }`}
                    onClick={handleCopyCode}
                    title={codeCopied ? "Copied!" : "Copy code"}
                  >
                    {codeCopied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
              </div>
              <div className="code-snippet-content">
                <pre className="code-snippet-code">
                  <code>
                    {generateCodeSnippet(codeSnippetType)
                      .split("\n")
                      .map((line, index) => (
                        <div key={index} className="code-line">
                          <span className="line-number">{index + 1}</span>
                          <span className="line-content">{line}</span>
                        </div>
                      ))}
                  </code>
                </pre>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 右键上下文菜单 */}
      {contextMenu.visible && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
          }}
        >
          <div className="context-menu-item" onClick={handleViewDocument}>
            <Eye size={14} />
            <span>View</span>
          </div>
          <div className="context-menu-item" onClick={handleEditDocument}>
            <Pencil size={14} />
            <span>Edit</span>
          </div>
          <div className="context-menu-divider" />
          <div
            className="context-menu-item danger"
            onClick={handleShowDeleteDocument}
          >
            <Trash2 size={14} />
            <span>Delete</span>
          </div>
        </div>
      )}

      {/* 查看文档/行对话框 */}
      {showViewDialog && currentRowData && (
        <div className="document-dialog-overlay">
          <div className="document-dialog view-dialog">
            <div className="document-dialog-header">
              <h4>View {terminology.Document}</h4>
              <button
                className="dialog-close-btn"
                onClick={() => {
                  setShowViewDialog(false);
                  setCurrentRowData(null);
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="document-dialog-content">
              {queryResult?.columns.map((col) => (
                <div key={col.name} className="document-field">
                  <label className="document-field-label">
                    {col.name}
                    <span className="document-field-type">{col.type}</span>
                  </label>
                  <div className="document-field-value">
                    {formatCell(currentRowData[col.name]).display}
                  </div>
                </div>
              ))}
            </div>
            <div className="document-dialog-actions">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowViewDialog(false);
                  setCurrentRowData(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑文档/行对话框 */}
      {showEditDialog && editRowData && (
        <div className="document-dialog-overlay">
          <div className="document-dialog edit-dialog">
            <div className="document-dialog-header">
              <h4>Edit {terminology.Document}</h4>
              <button
                className="dialog-close-btn"
                onClick={handleCancelEditDocument}
                disabled={documentOperationLoading}
              >
                <X size={16} />
              </button>
            </div>
            <div className="document-dialog-content">
              {isOceanBaseCloud ? (
                /* 云数据库：根据表结构动态显示所有字段 */
                queryResult?.columns.map((col) => (
                  <div key={col.name} className="document-field">
                    <label className="document-field-label">
                      {col.name}
                      <span className="document-field-type">{col.type}</span>
                    </label>
                    <input
                      type="text"
                      className="document-field-input"
                      style={{ minHeight: "36px" }}
                      value={
                        typeof editRowData[col.name] === "object"
                          ? JSON.stringify(editRowData[col.name])
                          : String(editRowData[col.name] ?? "")
                      }
                      onChange={(e) =>
                        handleEditFieldChange(col.name, e.target.value)
                      }
                      disabled={documentOperationLoading}
                    />
                  </div>
                ))
              ) : (
                /* SeekDB：固定的 _id, document, metadata 字段 */
                <>
                  {/* 显示文档 ID（只读） */}
                  {(editRowData._id || editRowData.id) && (
                    <div className="document-field">
                      <label className="document-field-label">
                        _id
                        <span className="document-field-type">
                          STRING (readonly)
                        </span>
                      </label>
                      <div className="document-field-value">
                        {editRowData._id || editRowData.id}
                      </div>
                    </div>
                  )}
                  {/* 编辑 document 字段 */}
                  <div className="document-field">
                    <label className="document-field-label">
                      document
                      <span className="document-field-type">
                        TEXT (for vectorization)
                      </span>
                    </label>
                    <textarea
                      className="document-field-input"
                      value={
                        typeof editRowData.document === "object"
                          ? JSON.stringify(editRowData.document, null, 2)
                          : String(editRowData.document ?? "")
                      }
                      onChange={(e) =>
                        handleEditFieldChange("document", e.target.value)
                      }
                      disabled={documentOperationLoading}
                      rows={4}
                    />
                  </div>
                  {/* 编辑 metadata 字段 */}
                  <div className="document-field">
                    <label className="document-field-label">
                      metadata
                      <span className="document-field-type">
                        JSON (optional)
                      </span>
                    </label>
                    <textarea
                      className="document-field-input"
                      value={
                        typeof editRowData.metadata === "object"
                          ? JSON.stringify(editRowData.metadata, null, 2)
                          : String(editRowData.metadata ?? "{}")
                      }
                      onChange={(e) =>
                        handleEditFieldChange("metadata", e.target.value)
                      }
                      disabled={documentOperationLoading}
                      rows={3}
                    />
                  </div>
                  <div className="document-field-hint">
                    <p>
                      💡 Embedding will be automatically updated when document
                      changes.
                    </p>
                  </div>
                </>
              )}
            </div>
            <div className="document-dialog-actions">
              <button
                className="btn btn-primary"
                onClick={handleConfirmUpdateDocument}
                disabled={documentOperationLoading}
              >
                {documentOperationLoading ? (
                  <RefreshCw size={14} className="spin" />
                ) : (
                  <Check size={14} />
                )}
                Save
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleCancelEditDocument}
                disabled={documentOperationLoading}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除文档/行确认对话框 */}
      {showDeleteConfirm && currentRowData && (
        <div className="document-dialog-overlay">
          <div className="document-dialog delete-dialog">
            <h4>Delete {terminology.Document}</h4>
            <p className="delete-warning">
              Are you sure you want to delete this {terminology.document}
              {currentRowData?._id || currentRowData?.id ? (
                <>
                  {" "}
                  (ID:{" "}
                  <strong>
                    {String(currentRowData._id || currentRowData.id)}
                  </strong>
                  )
                </>
              ) : null}
              ? This action cannot be undone.
            </p>
            <div className="document-dialog-actions">
              <button
                className="btn btn-danger"
                onClick={handleConfirmDeleteDocument}
                disabled={documentOperationLoading}
              >
                {documentOperationLoading ? (
                  <RefreshCw size={14} className="spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                Delete
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleCancelDeleteDocument}
                disabled={documentOperationLoading}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增文档/行对话框 */}
      {showAddDocumentDialog && (
        <div className="document-dialog-overlay">
          <div className="document-dialog add-dialog">
            <div className="document-dialog-header">
              <h4>Add {terminology.Document}</h4>
              <button
                className="dialog-close-btn"
                onClick={handleCancelAddDocument}
                disabled={documentOperationLoading}
              >
                <X size={16} />
              </button>
            </div>
            <div className="document-dialog-content">
              {isOceanBaseCloud ? (
                /* 云数据库：根据表结构动态显示字段 */
                queryResult?.columns ? (
                  queryResult.columns.map((col) => (
                    <div key={col.name} className="document-field">
                      <label className="document-field-label">
                        {col.name}
                        <span className="document-field-type">{col.type}</span>
                      </label>
                      <input
                        type="text"
                        className="document-field-input"
                        style={{ minHeight: "36px" }}
                        placeholder={`Enter ${col.name}...`}
                        value={newDocumentData[col.name] || ""}
                        onChange={(e) =>
                          handleNewDocumentFieldChange(col.name, e.target.value)
                        }
                        disabled={documentOperationLoading}
                      />
                    </div>
                  ))
                ) : (
                  <div className="empty-fields-hint">
                    <p>No table structure available.</p>
                    <p>Please select a table first.</p>
                  </div>
                )
              ) : (
                /* SeekDB：固定的 document 和 metadata 字段 */
                <>
                  <div className="document-field">
                    <label className="document-field-label">
                      document
                      <span className="document-field-type">
                        TEXT (for vectorization)
                      </span>
                    </label>
                    <textarea
                      className="document-field-input"
                      placeholder="Enter document content for vectorization..."
                      value={newDocumentData.document || ""}
                      onChange={(e) =>
                        handleNewDocumentFieldChange("document", e.target.value)
                      }
                      disabled={documentOperationLoading}
                      rows={4}
                    />
                  </div>
                  <div className="document-field">
                    <label className="document-field-label">
                      metadata
                      <span className="document-field-type">
                        JSON (optional)
                      </span>
                    </label>
                    <textarea
                      className="document-field-input"
                      placeholder='{"key": "value"}'
                      value={newDocumentData.metadata || "{}"}
                      onChange={(e) =>
                        handleNewDocumentFieldChange("metadata", e.target.value)
                      }
                      disabled={documentOperationLoading}
                      rows={3}
                    />
                  </div>
                  <div className="document-field-hint">
                    <p>💡 Document content will be automatically vectorized.</p>
                  </div>
                </>
              )}
            </div>
            <div className="document-dialog-actions">
              <button
                className="btn btn-primary"
                onClick={handleConfirmAddDocument}
                disabled={documentOperationLoading}
              >
                {documentOperationLoading ? (
                  <RefreshCw size={14} className="spin" />
                ) : (
                  <Plus size={14} />
                )}
                {isOceanBaseCloud ? "Insert" : "Add"}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleCancelAddDocument}
                disabled={documentOperationLoading}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CollectionBrowserPage;
