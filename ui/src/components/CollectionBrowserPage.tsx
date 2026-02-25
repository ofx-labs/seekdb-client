import React, { useState, useEffect, useRef } from "react";
import {
  Plug,
  RefreshCw,
  Plus,
  Database,
  FileText,
  List,
  File,
  Table as TableIcon,
  Grid,
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
  Network,
  GitBranch,
  ArrowUp,
  Diff,
  FlaskConical,
  GitFork,
  Shield,
  MoreHorizontal,
} from "lucide-react";
import "./CollectionBrowserPage.css";
import TableStructureVisualizer from "./TableStructureVisualizer";

type EmbeddingType = "builtin" | "openai" | "ollama" | "anthropic" | "qwen";
type CodeSnippetType = "nodejs-seekdb" | "python-pyseekdb" | "nodejs-fork" | "python-fork";

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

/** 表结构接口 */
interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey?: boolean;
  foreignKey?: {
    table: string;
    column: string;
  };
}

interface Table {
  name: string;
  columns: TableColumn[];
}

/** Schema diff entry */
interface SchemaDiffEntry {
  field: string;
  status: "unchanged" | "modified" | "added" | "removed";
  tableA: { field: string; type: string; null: string; key: string; default: any; extra: string } | null;
  tableB: { field: string; type: string; null: string; key: string; default: any; extra: string } | null;
}

/** A/B test variant */
interface ABTestVariant {
  name: string;
  elapsed: number;
}

/** A/B test query result */
interface ABTestQueryResultEntry {
  variant: string;
  elapsed: number;
  rowCount: number;
  error?: string;
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
  const [tablesList, setTablesList] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(
    null,
  );
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
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
    new Set(["db", "collections", "tables"]),
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

  // Visualizer 相关状态
  const [currentView, setCurrentView] = useState<"collection" | "visualizer">(
    "collection",
  );
  const [tables, setTables] = useState<Table[]>([]);
  const [visualizerLoading, setVisualizerLoading] = useState(false);
  const [selectedVisualizerCollection, setSelectedVisualizerCollection] =
    useState<string | null>(null);
  const [savedTableStructures, setSavedTableStructures] = useState<
    { name: string; tables: Table[] }[]
  >([]);

  // Fork Table 相关状态
  const [showForkDialog, setShowForkDialog] = useState(false);
  const [forkSourceTable, setForkSourceTable] = useState("");
  const [forkTargetTable, setForkTargetTable] = useState("");
  const [forkLoading, setForkLoading] = useState(false);

  // Collection 操作菜单状态
  const [collectionActionMenu, setCollectionActionMenu] = useState<{
    visible: boolean;
    collectionName: string;
    x: number;
    y: number;
  }>({ visible: false, collectionName: "", x: 0, y: 0 });
  const collectionActionMenuRef = useRef<HTMLDivElement>(null);

  // Safe Change 工作流状态
  const [safeChangeMode, setSafeChangeMode] = useState(false);
  const [safeChangeSource, setSafeChangeSource] = useState("");
  const [safeChangeFork, setSafeChangeFork] = useState("");

  // Schema Diff 状态
  const [showSchemaDiff, setShowSchemaDiff] = useState(false);
  const [schemaDiffData, setSchemaDiffData] = useState<{
    tableA: string;
    tableB: string;
    rowCountA: number;
    rowCountB: number;
    diff: SchemaDiffEntry[];
  } | null>(null);
  const [schemaDiffLoading, setSchemaDiffLoading] = useState(false);
  const [schemaDiffTableA, setSchemaDiffTableA] = useState("");
  const [schemaDiffTableB, setSchemaDiffTableB] = useState("");

  // Fork 血缘图状态
  const [showForkLineage, setShowForkLineage] = useState(false);
  const [forkLineageData, setForkLineageData] = useState<{
    tableName: string;
    baseName: string;
    relatedTables: string[];
  } | null>(null);

  // A/B 测试状态
  const [showABTestDialog, setShowABTestDialog] = useState(false);
  const [abTestSource, setAbTestSource] = useState("");
  const [abTestVariantCount, setAbTestVariantCount] = useState(2);
  const [abTestVariants, setAbTestVariants] = useState<ABTestVariant[]>([]);
  const [abTestLoading, setAbTestLoading] = useState(false);
  const [abTestQuery, setAbTestQuery] = useState("SELECT COUNT(*) FROM `{table}`");
  const [abTestResults, setAbTestResults] = useState<ABTestQueryResultEntry[]>([]);
  const [abTestRunning, setAbTestRunning] = useState(false);
  const [abTestVariantSQLs, setAbTestVariantSQLs] = useState<Record<string, string>>({});
  const [abTestApplyingSQL, setAbTestApplyingSQL] = useState<string | null>(null);
  const [abTestStep, setAbTestStep] = useState<"create" | "configure" | "benchmark">("create");

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
              "tables:",
              message.data.tables,
            );
            setCollections(message.data.collections || []);
            setTablesList(message.data.tables || []);
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
          case "tableStructures":
            // 收到表结构数据
            console.log(
              "[CollectionBrowser] Received table structures:",
              message.data.tables,
            );
            setTables(message.data.tables || []);
            setVisualizerLoading(false);
            setError(null);
            break;
          // Fork Table responses
          case "forkCreated":
            console.log("[CollectionBrowser] Fork created:", message.data);
            setForkLoading(false);
            setShowForkDialog(false);
            setForkSourceTable("");
            setForkTargetTable("");
            setSuccessMessage(
              `Fork created in ${message.data?.elapsed}ms: ${message.data?.sourceTable} → ${message.data?.targetTable}`,
            );
            setTimeout(() => setSuccessMessage(null), 5000);
            if (safeChangeMode) {
              setSafeChangeFork(message.data?.targetTable || "");
            }
            vscode.postMessage({ type: "refreshCollections" });
            break;
          case "forkPromoted":
            console.log("[CollectionBrowser] Fork promoted:", message.data);
            setSafeChangeMode(false);
            setSafeChangeSource("");
            setSafeChangeFork("");
            setSuccessMessage(
              `Fork promoted! Old table backed up as "${message.data?.backupName}"`,
            );
            setTimeout(() => setSuccessMessage(null), 5000);
            vscode.postMessage({ type: "refreshCollections" });
            break;
          case "forkDiscarded":
            console.log("[CollectionBrowser] Fork discarded:", message.data);
            setSafeChangeMode(false);
            setSafeChangeFork("");
            setSuccessMessage(`Fork "${message.data?.forkTable}" discarded`);
            setTimeout(() => setSuccessMessage(null), 3000);
            vscode.postMessage({ type: "refreshCollections" });
            break;
          case "compareResult":
            console.log("[CollectionBrowser] Compare result:", message.data);
            setSchemaDiffLoading(false);
            setSchemaDiffData(message.data);
            setShowSchemaDiff(true);
            break;
          case "forkInfo":
            console.log("[CollectionBrowser] Fork info:", message.data);
            setForkLineageData(message.data);
            setShowForkLineage(true);
            break;
          case "abTestCreated":
            console.log("[CollectionBrowser] A/B test created:", message.data);
            setAbTestLoading(false);
            setAbTestVariants(message.data?.variants || []);
            setAbTestStep("configure");
            {
              const initSQLs: Record<string, string> = {};
              (message.data?.variants || []).forEach((v: ABTestVariant, idx: number) => {
                initSQLs[v.name] = idx === 0
                  ? "-- Variant A: e.g. ALTER TABLE `{table}` ADD INDEX idx_col1 (col1);"
                  : "-- Variant B: e.g. ALTER TABLE `{table}` ADD INDEX idx_col1_col2 (col1, col2);";
              });
              setAbTestVariantSQLs(initSQLs);
            }
            setSuccessMessage(
              `A/B test: ${message.data?.variants?.length} variants created. Now configure each variant.`,
            );
            setTimeout(() => setSuccessMessage(null), 5000);
            vscode.postMessage({ type: "refreshCollections" });
            break;
          case "abTestQueryResult":
            console.log("[CollectionBrowser] A/B test results:", message.data);
            setAbTestRunning(false);
            setAbTestResults(message.data?.results || []);
            break;
          case "abTestCleanedUp":
            console.log("[CollectionBrowser] A/B test cleaned up:", message.data);
            setAbTestVariants([]);
            setAbTestResults([]);
            setShowABTestDialog(false);
            setSuccessMessage("A/B test variants cleaned up");
            setTimeout(() => setSuccessMessage(null), 3000);
            vscode.postMessage({ type: "refreshCollections" });
            break;
          case "forkError":
            console.error("[CollectionBrowser] Fork error:", message.data?.error);
            setForkLoading(false);
            setSchemaDiffLoading(false);
            setAbTestLoading(false);
            setAbTestRunning(false);
            setError(message.data?.error || "Fork operation failed");
            break;

          case "tableStructuresError":
            // 获取表结构失败
            console.error(
              "[CollectionBrowser] Table structures error:",
              message.data?.error,
            );
            setError(message.data?.error || "Failed to load table structures");
            setVisualizerLoading(false);
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

  // 点击外部关闭 collection 操作菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        collectionActionMenuRef.current &&
        !collectionActionMenuRef.current.contains(event.target as Node)
      ) {
        setCollectionActionMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    if (collectionActionMenu.visible) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [collectionActionMenu.visible]);

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

    // Determine context for execution
    let context = undefined;
    if (selectedCollection) {
      context = {
        kind: "collection",
        cleanName: selectedCollection,
      };
    } else if (selectedTable) {
      context = {
        kind: "table",
        tableName: selectedTable,
      };
    }

    vscode.postMessage({
      type: "executeQuery",
      data: { sql, context },
    });
  };

  const handleRefreshCollections = () => {
    setLoading(true);
    vscode.postMessage({ type: "refreshCollections" });
  };

  const handleCollectionClick = (collectionName: string) => {
    setCurrentView("collection");
    setSelectedCollection(collectionName);
    setSelectedTable(null);
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

  const handleTableClick = (tableName: string) => {
    setCurrentView("collection");
    setSelectedCollection(null);
    setSelectedTable(tableName);
    const newQuery = `SELECT * FROM \`${tableName}\``;
    setQuery(newQuery);
    setLoading(true);
    setError(null);
    // 重置模型信息
    setCollectionModelName(null);
    setSearchModelName(null);
    setModelWarning(null);
    vscode.postMessage({
      type: "loadTableData",
      data: { tableName },
    });
  };

  const handleVisualizerClick = () => {
    setCurrentView("visualizer");
    setSelectedCollection(null);
    setQueryResult(null);
    setSelectedVisualizerCollection(null);
    setVisualizerLoading(true);
    setError(null);
    // 请求表结构数据
    vscode.postMessage({ type: "getTableStructures" });
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

  // ============================================
  // Fork Table Handlers
  // ============================================

  const handleShowForkDialog = (tableName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setForkSourceTable(tableName);
    setForkTargetTable(`${tableName}_fork_${Date.now()}`);
    setShowForkDialog(true);
  };

  const handleConfirmFork = () => {
    if (!forkSourceTable || !forkTargetTable.trim()) {
      setError("Please enter a target table name");
      return;
    }
    setForkLoading(true);
    setError(null);
    vscode.postMessage({
      type: "forkTable",
      data: { sourceTable: forkSourceTable, targetTable: forkTargetTable.trim() },
    });
  };

  const handleCancelFork = () => {
    setShowForkDialog(false);
    setForkSourceTable("");
    setForkTargetTable("");
  };

  // Safe Change workflow
  const handleStartSafeChange = (tableName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const forkName = `${tableName}_safe_${Date.now()}`;
    setSafeChangeSource(tableName);
    setSafeChangeMode(true);
    setForkLoading(true);
    setError(null);
    vscode.postMessage({
      type: "forkTable",
      data: { sourceTable: tableName, targetTable: forkName },
    });
  };

  const handlePromoteFork = () => {
    if (!safeChangeSource || !safeChangeFork) return;
    vscode.postMessage({
      type: "promoteFork",
      data: { sourceTable: safeChangeSource, forkTable: safeChangeFork },
    });
  };

  const handleDiscardFork = () => {
    if (!safeChangeFork) return;
    vscode.postMessage({
      type: "discardFork",
      data: { forkTable: safeChangeFork },
    });
  };

  // Schema Diff
  const handleShowSchemaDiff = (tableA?: string, tableB?: string) => {
    const a = tableA || schemaDiffTableA;
    const b = tableB || schemaDiffTableB;
    if (!a || !b) {
      setError("Please select two tables to compare");
      return;
    }
    setSchemaDiffLoading(true);
    setError(null);
    vscode.postMessage({
      type: "compareTables",
      data: { tableA: a, tableB: b },
    });
  };

  // Fork Lineage
  const handleShowForkLineage = (tableName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    vscode.postMessage({
      type: "getForkInfo",
      data: { tableName },
    });
  };

  // A/B Test
  const handleStartABTest = (tableName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAbTestSource(tableName);
    setAbTestVariantCount(2);
    setAbTestVariants([]);
    setAbTestResults([]);
    setAbTestQuery(`SELECT COUNT(*) FROM \`{table}\``);
    setAbTestStep("create");
    setAbTestVariantSQLs({});
    setAbTestApplyingSQL(null);
    setShowABTestDialog(true);
  };

  const handleCreateABTest = () => {
    if (!abTestSource) return;
    setAbTestLoading(true);
    setError(null);
    vscode.postMessage({
      type: "abTestCreate",
      data: { sourceTable: abTestSource, variantCount: abTestVariantCount },
    });
  };

  const handleApplyVariantSQL = (variantName: string) => {
    const sql = abTestVariantSQLs[variantName]?.trim();
    if (!sql) return;
    setAbTestApplyingSQL(variantName);
    setError(null);
    const actualSql = sql.replace(/\{table\}/g, variantName);
    vscode.postMessage({
      type: "executeQuery",
      data: { sql: actualSql },
    });
    setTimeout(() => {
      setAbTestApplyingSQL(null);
      setSuccessMessage(`SQL applied to ${variantName}`);
      setTimeout(() => setSuccessMessage(null), 3000);
    }, 1000);
  };

  const handleRunABTestQuery = () => {
    if (abTestVariants.length === 0 || !abTestQuery.trim()) return;
    setAbTestRunning(true);
    setError(null);
    vscode.postMessage({
      type: "abTestRunQuery",
      data: {
        variants: abTestVariants.map((v) => v.name),
        sql: abTestQuery,
      },
    });
  };

  const handleCleanupABTest = () => {
    if (abTestVariants.length === 0) return;
    vscode.postMessage({
      type: "abTestCleanup",
      data: { variants: abTestVariants.map((v) => v.name) },
    });
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

      case "nodejs-fork":
        return `const mysql = require('mysql2/promise');

async function forkTableWorkflow() {
  const conn = await mysql.createConnection({
    host: "${host}",
    port: ${port},
    user: "root@sys",
    database: "${database}",
  });

  const source = "${collection}";
  const fork = "${collection}_fork_" + Date.now();

  // 1. Fork table (milliseconds, zero-copy)
  await conn.execute(\`FORK TABLE \\\`\${source}\\\` TO \\\`\${fork}\\\`\`);
  console.log("Fork created:", fork);

  // 2. Safely modify the fork
  // await conn.execute(\`ALTER TABLE \\\`\${fork}\\\` ADD COLUMN tags VARCHAR(255)\`);

  // 3. Validate changes
  const [rows] = await conn.execute(\`SELECT COUNT(*) AS cnt FROM \\\`\${fork}\\\`\`);
  console.log("Fork row count:", rows[0].cnt);

  // 4. Promote fork to replace source (atomic swap)
  // await conn.execute(\`RENAME TABLE \\\`\${source}\\\` TO \\\`\${source}_old\\\`, \\\`\${fork}\\\` TO \\\`\${source}\\\`\`);

  // Or discard the fork
  // await conn.execute(\`DROP TABLE IF EXISTS \\\`\${fork}\\\`\`);

  await conn.end();
}

forkTableWorkflow().catch(console.error);`;

      case "python-fork":
        return `import pymysql

def fork_table_workflow():
    conn = pymysql.connect(
        host="${host}",
        port=${port},
        user="root@sys",
        db="${database}",
    )
    cursor = conn.cursor()

    source = "${collection}"
    fork = f"${collection}_fork_{int(__import__('time').time())}"

    # 1. Fork table (milliseconds, zero-copy)
    cursor.execute(f"FORK TABLE \`{source}\` TO \`{fork}\`")
    print(f"Fork created: {fork}")

    # 2. Safely modify the fork
    # cursor.execute(f"ALTER TABLE \`{fork}\` ADD COLUMN tags VARCHAR(255)")

    # 3. Validate changes
    cursor.execute(f"SELECT COUNT(*) FROM \`{fork}\`")
    print(f"Fork row count: {cursor.fetchone()[0]}")

    # 4. Promote fork (atomic swap)
    # cursor.execute(f"RENAME TABLE \`{source}\` TO \`{source}_old\`, \`{fork}\` TO \`{source}\`")

    # Or discard
    # cursor.execute(f"DROP TABLE IF EXISTS \`{fork}\`")

    conn.commit()
    conn.close()

fork_table_workflow()`;

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
              className="tree-item level-1"
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
              <div className="tree-item-actions">
                <button
                  className="tree-action-btn delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      confirm(
                        `Are you sure you want to delete database "${connectionInfo.database}"? This cannot be undone.`,
                      )
                    ) {
                      vscode.postMessage({
                        type: "deleteDatabase",
                        data: { name: connectionInfo.database },
                      });
                    }
                  }}
                  title="Delete Database"
                >
                  <Trash2 size={12} />
                </button>
              </div>
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

                {/* Visualizer node - same level as collections */}
                <div
                  className={`tree-item level-1 ${
                    currentView === "visualizer" ? "selected" : ""
                  }`}
                  onClick={handleVisualizerClick}
                  style={{ cursor: "pointer" }}
                >
                  <span className="expand-icon" style={{ width: "16px" }}>
                    {/* No expand icon - visualizer has no children */}
                  </span>
                  <Network size={14} className="item-icon" />
                  <span className="item-name">visualizer</span>
                </div>

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
                          {collection.name.includes("_fork_") ||
                          collection.name.includes("_safe_") ||
                          collection.name.includes("_variant_") ? (
                            <GitFork size={14} className="item-icon" style={{ color: "var(--vscode-charts-yellow)" }} />
                          ) : collection.name.includes("_backup_") ? (
                            <File size={14} className="item-icon" style={{ opacity: 0.5 }} />
                          ) : (
                            <File size={14} className="item-icon" />
                          )}
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
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const rect = (e.target as HTMLElement).closest('button')!.getBoundingClientRect();
                                        setCollectionActionMenu({
                                          visible: true,
                                          collectionName: collection.name,
                                          x: rect.left,
                                          y: rect.bottom + 2,
                                        });
                                      }}
                                      title="More actions..."
                                    >
                                      <MoreHorizontal size={12} />
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

                {/* Tables node (only for SeekDB mode when we want to distinguish) */}
                {isSeekDB && tablesList.length > 0 && (
                  <>
                    <div
                      className="tree-item level-1"
                      onClick={() => toggleNode("tables")}
                      style={{ cursor: "pointer" }}
                    >
                      <span className="expand-icon">
                        {expandedNodes.has("tables") ? (
                          <ChevronDown size={12} />
                        ) : (
                          <ChevronRight size={12} />
                        )}
                      </span>
                      <TableIcon size={14} className="item-icon" />
                      <span className="item-name">tables</span>
                      <span className="tree-group-count">
                        ({tablesList.length})
                      </span>
                    </div>

                    {expandedNodes.has("tables") && (
                      <div>
                        {tablesList.map((table) => (
                          <div
                            key={table.name}
                            className={`tree-item level-2 collection-item ${
                              selectedTable === table.name ? "selected" : ""
                            }`}
                            onClick={() => handleTableClick(table.name)}
                            style={{ cursor: "pointer" }}
                          >
                            <span className="expand-icon">
                              <ChevronRight size={12} />
                            </span>
                            {table.name.includes("_fork_") ||
                            table.name.includes("_safe_") ||
                            table.name.includes("_variant_") ? (
                              <GitFork size={14} className="item-icon" style={{ color: "var(--vscode-charts-yellow)" }} />
                            ) : table.name.includes("_backup_") ? (
                              <Grid size={14} className="item-icon" style={{ opacity: 0.5 }} />
                            ) : (
                              <Grid size={14} className="item-icon" />
                            )}
                            <span className="item-name">{table.name}</span>
                            <div className="collection-item-actions">
                              <button
                                className="collection-action-btn"
                                onClick={(e) =>
                                  handleShowForkDialog(table.name, e)
                                }
                                title="Fork Table"
                              >
                                <GitBranch size={12} />
                              </button>
                              <button
                                className="collection-action-btn"
                                onClick={(e) =>
                                  handleShowForkLineage(table.name, e)
                                }
                                title="View Fork Lineage"
                              >
                                <Network size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* 创建集合/表对话框 */}
          {showCreateCollectionDialog && (
            <div className="collection-dialog-overlay">
              <div className="collection-dialog">
                <h4>Create {terminology.Collection}</h4>
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

          {/* Collection 操作菜单 (浮动下拉) */}
          {collectionActionMenu.visible && (
            <div
              ref={collectionActionMenuRef}
              className="collection-action-dropdown"
              style={{
                position: "fixed",
                top: collectionActionMenu.y,
                left: collectionActionMenu.x,
                zIndex: 1000,
                background: "var(--sidebar-bg)",
                border: "1px solid var(--border-color)",
                borderRadius: 6,
                boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                padding: "4px 0",
                minWidth: 200,
                fontSize: 12,
              }}
            >
              <div
                className="dropdown-item"
                onClick={(e) => {
                  handleShowForkDialog(collectionActionMenu.collectionName, e);
                  setCollectionActionMenu((prev) => ({ ...prev, visible: false }));
                }}
              >
                <GitBranch size={14} /> Fork Table
              </div>
              <div
                className="dropdown-item"
                onClick={(e) => {
                  handleStartSafeChange(collectionActionMenu.collectionName, e);
                  setCollectionActionMenu((prev) => ({ ...prev, visible: false }));
                }}
              >
                <Shield size={14} /> Safe Change (Fork & Edit)
              </div>
              <div
                className="dropdown-item"
                onClick={(e) => {
                  handleShowForkLineage(collectionActionMenu.collectionName, e);
                  setCollectionActionMenu((prev) => ({ ...prev, visible: false }));
                }}
              >
                <Network size={14} /> View Fork Lineage
              </div>
              <div
                className="dropdown-item"
                onClick={(e) => {
                  handleStartABTest(collectionActionMenu.collectionName, e);
                  setCollectionActionMenu((prev) => ({ ...prev, visible: false }));
                }}
              >
                <FlaskConical size={14} /> A/B Test
              </div>
              <div style={{ borderTop: "1px solid var(--border-color)", margin: "4px 0" }} />
              <div
                className="dropdown-item"
                onClick={(e) => {
                  handleStartRenameCollection(collectionActionMenu.collectionName, e);
                  setCollectionActionMenu((prev) => ({ ...prev, visible: false }));
                }}
              >
                <Pencil size={14} /> Rename
              </div>
            </div>
          )}

          {/* Fork Table 对话框 */}
          {showForkDialog && (
            <div className="collection-dialog-overlay">
              <div className="collection-dialog" style={{ minWidth: 360 }}>
                <h4 style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <GitBranch size={16} /> Fork Table
                </h4>
                <p style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)", margin: "4px 0 12px" }}>
                  Creates a zero-copy clone using Copy-on-Write. Completes in milliseconds regardless of data size.
                </p>
                <label style={{ fontSize: 12, marginBottom: 4, display: "block", color: "var(--vscode-descriptionForeground)" }}>
                  Source Table
                </label>
                <input
                  type="text"
                  className="collection-dialog-input"
                  value={forkSourceTable}
                  disabled
                  style={{ marginBottom: 8, opacity: 0.7 }}
                />
                <label style={{ fontSize: 12, marginBottom: 4, display: "block", color: "var(--vscode-descriptionForeground)" }}>
                  Target Table Name
                </label>
                <input
                  type="text"
                  className="collection-dialog-input"
                  placeholder="Enter target table name..."
                  value={forkTargetTable}
                  onChange={(e) => setForkTargetTable(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmFork();
                    if (e.key === "Escape") handleCancelFork();
                  }}
                  autoFocus
                  disabled={forkLoading}
                />
                <div className="collection-dialog-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleConfirmFork}
                    disabled={forkLoading}
                  >
                    {forkLoading ? (
                      <RefreshCw size={12} className="spin" />
                    ) : (
                      <GitBranch size={12} />
                    )}
                    Fork
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleCancelFork}
                    disabled={forkLoading}
                  >
                    <X size={12} /> Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Schema Diff 对话框 */}
          {showSchemaDiff && schemaDiffData && (
            <div className="collection-dialog-overlay">
              <div className="collection-dialog" style={{ minWidth: 520, maxWidth: 640, maxHeight: "80vh", overflow: "auto" }}>
                <h4 style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Diff size={16} /> Schema Diff
                </h4>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, fontSize: 12 }}>
                  <div>
                    <strong>{schemaDiffData.tableA}</strong>
                    <span style={{ color: "var(--vscode-descriptionForeground)", marginLeft: 6 }}>
                      {schemaDiffData.rowCountA} rows
                    </span>
                  </div>
                  <span style={{ color: "var(--vscode-descriptionForeground)" }}>vs</span>
                  <div>
                    <strong>{schemaDiffData.tableB}</strong>
                    <span style={{ color: "var(--vscode-descriptionForeground)", marginLeft: 6 }}>
                      {schemaDiffData.rowCountB} rows
                    </span>
                  </div>
                </div>
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                      <th style={{ textAlign: "left", padding: "4px 8px" }}>Status</th>
                      <th style={{ textAlign: "left", padding: "4px 8px" }}>Column</th>
                      <th style={{ textAlign: "left", padding: "4px 8px" }}>{schemaDiffData.tableA}</th>
                      <th style={{ textAlign: "left", padding: "4px 8px" }}>{schemaDiffData.tableB}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schemaDiffData.diff.map((d) => (
                      <tr
                        key={d.field}
                        style={{
                          borderBottom: "1px solid var(--border-color)",
                          background:
                            d.status === "added"
                              ? "rgba(0,180,0,0.08)"
                              : d.status === "removed"
                                ? "rgba(255,0,0,0.08)"
                                : d.status === "modified"
                                  ? "rgba(255,180,0,0.08)"
                                  : "transparent",
                        }}
                      >
                        <td style={{ padding: "4px 8px" }}>
                          {d.status === "unchanged" && "✅"}
                          {d.status === "modified" && "⚠️"}
                          {d.status === "added" && "➕"}
                          {d.status === "removed" && "➖"}
                        </td>
                        <td style={{ padding: "4px 8px", fontWeight: 500 }}>{d.field}</td>
                        <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>
                          {d.tableA ? `${d.tableA.type} ${d.tableA.null === "YES" ? "NULL" : "NOT NULL"}` : "—"}
                        </td>
                        <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>
                          {d.tableB ? `${d.tableB.type} ${d.tableB.null === "YES" ? "NULL" : "NOT NULL"}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--vscode-descriptionForeground)" }}>
                  {schemaDiffData.diff.filter((d) => d.status !== "unchanged").length === 0
                    ? "No schema differences found."
                    : `${schemaDiffData.diff.filter((d) => d.status !== "unchanged").length} difference(s) found.`}
                  {" "}Row count diff: {schemaDiffData.rowCountA} vs {schemaDiffData.rowCountB}
                  {schemaDiffData.rowCountA !== schemaDiffData.rowCountB &&
                    ` (${schemaDiffData.rowCountB - schemaDiffData.rowCountA > 0 ? "+" : ""}${schemaDiffData.rowCountB - schemaDiffData.rowCountA})`}
                </div>
                <div className="collection-dialog-actions" style={{ marginTop: 12 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setShowSchemaDiff(false); setSchemaDiffData(null); }}
                  >
                    <X size={12} /> Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Fork 血缘图 */}
          {showForkLineage && forkLineageData && (
            <div className="collection-dialog-overlay">
              <div className="collection-dialog" style={{ minWidth: 400 }}>
                <h4 style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Network size={16} /> Fork Lineage
                </h4>
                <p style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)", margin: "4px 0 8px" }}>
                  Related tables for <strong>{forkLineageData.baseName}</strong>
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {forkLineageData.relatedTables.map((t) => {
                    const isBase = t === forkLineageData.baseName;
                    const isFork = t.includes("_fork_") || t.includes("_safe_") || t.includes("_variant_");
                    const isBackup = t.includes("_backup_");
                    return (
                      <div
                        key={t}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "6px 10px",
                          borderRadius: 4,
                          background: isBase
                            ? "rgba(0,120,255,0.1)"
                            : isFork
                              ? "rgba(255,180,0,0.1)"
                              : isBackup
                                ? "rgba(128,128,128,0.1)"
                                : "transparent",
                          border: "1px solid var(--border-color)",
                          fontSize: 12,
                        }}
                      >
                        {isBase ? (
                          <Database size={14} />
                        ) : isFork ? (
                          <GitFork size={14} style={{ color: "var(--vscode-charts-yellow)" }} />
                        ) : (
                          <Grid size={14} style={{ opacity: 0.5 }} />
                        )}
                        <span style={{ flex: 1, fontFamily: "monospace" }}>{t}</span>
                        {isBase && (
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: "rgba(0,120,255,0.2)" }}>
                            source
                          </span>
                        )}
                        {isFork && (
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: "rgba(255,180,0,0.2)" }}>
                            fork
                          </span>
                        )}
                        {isBackup && (
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: "rgba(128,128,128,0.2)" }}>
                            backup
                          </span>
                        )}
                        {!isBase && (
                          <button
                            className="collection-action-btn"
                            onClick={() => {
                              setSchemaDiffTableA(forkLineageData.baseName);
                              setSchemaDiffTableB(t);
                              handleShowSchemaDiff(forkLineageData.baseName, t);
                              setShowForkLineage(false);
                            }}
                            title="Compare with source"
                            style={{ padding: 2 }}
                          >
                            <Diff size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {forkLineageData.relatedTables.length === 0 && (
                    <p style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)", fontStyle: "italic" }}>
                      No related forks found.
                    </p>
                  )}
                </div>
                <div className="collection-dialog-actions" style={{ marginTop: 12 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setShowForkLineage(false); setForkLineageData(null); }}
                  >
                    <X size={12} /> Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* A/B 测试对话框 */}
          {showABTestDialog && (
            <div className="collection-dialog-overlay">
              <div className="collection-dialog" style={{ minWidth: 560, maxWidth: 680, maxHeight: "85vh", overflow: "auto" }}>
                <h4 style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <FlaskConical size={16} /> A/B Test Manager
                </h4>
                <p style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)", margin: "4px 0 8px" }}>
                  Source: <strong>{abTestSource}</strong>
                </p>

                {/* Step indicator */}
                <div style={{ display: "flex", gap: 0, marginBottom: 16, fontSize: 11, borderBottom: "1px solid var(--border-color)" }}>
                  {[
                    { key: "create" as const, label: "1. Create Variants", icon: <FlaskConical size={12} /> },
                    { key: "configure" as const, label: "2. Configure", icon: <Shield size={12} /> },
                    { key: "benchmark" as const, label: "3. Benchmark", icon: <Play size={12} /> },
                  ].map((s) => (
                    <div
                      key={s.key}
                      style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "6px 12px",
                        fontWeight: abTestStep === s.key ? 600 : 400,
                        color: abTestStep === s.key ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
                        borderBottom: abTestStep === s.key ? "2px solid var(--vscode-focusBorder)" : "2px solid transparent",
                        cursor: s.key === "create" ? "default" : abTestVariants.length > 0 ? "pointer" : "default",
                        opacity: s.key !== "create" && abTestVariants.length === 0 ? 0.4 : 1,
                      }}
                      onClick={() => {
                        if (s.key !== "create" && abTestVariants.length > 0) setAbTestStep(s.key);
                      }}
                    >
                      {s.icon} {s.label}
                    </div>
                  ))}
                </div>

                {/* Step 1: Create */}
                {abTestStep === "create" && (
                  <>
                    <p style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)", marginBottom: 8 }}>
                      Fork the source table into multiple variants for independent testing.
                    </p>
                    <label style={{ fontSize: 12, marginBottom: 4, display: "block", color: "var(--vscode-descriptionForeground)" }}>
                      Number of variants
                    </label>
                    <input
                      type="number"
                      className="collection-dialog-input"
                      min={2}
                      max={10}
                      value={abTestVariantCount}
                      onChange={(e) => setAbTestVariantCount(Math.max(2, Math.min(10, parseInt(e.target.value) || 2)))}
                      disabled={abTestLoading}
                      style={{ marginBottom: 8 }}
                    />
                    <div className="collection-dialog-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleCreateABTest}
                        disabled={abTestLoading}
                      >
                        {abTestLoading ? <RefreshCw size={12} className="spin" /> : <FlaskConical size={12} />}
                        Create Variants
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setShowABTestDialog(false)}
                        disabled={abTestLoading}
                      >
                        <X size={12} /> Cancel
                      </button>
                    </div>
                  </>
                )}

                {/* Step 2: Configure — apply different SQL to each variant */}
                {abTestStep === "configure" && (
                  <>
                    <p style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)", marginBottom: 8 }}>
                      Apply different modifications to each variant to create the differences you want to test.
                      Use <code style={{ background: "var(--vscode-textCodeBlock-background)", padding: "1px 4px", borderRadius: 3 }}>{"{table}"}</code> as a placeholder for the variant table name.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {abTestVariants.map((v, idx) => (
                        <div
                          key={v.name}
                          style={{
                            border: "1px solid var(--border-color)",
                            borderRadius: 6,
                            padding: 10,
                            background: "var(--vscode-editor-background)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                            <GitFork size={12} style={{ color: "var(--vscode-charts-yellow)" }} />
                            <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600 }}>
                              Variant {String.fromCharCode(65 + idx)}
                            </span>
                            <span style={{ fontSize: 10, color: "var(--vscode-descriptionForeground)", fontFamily: "monospace" }}>
                              {v.name}
                            </span>
                            <span style={{ fontSize: 10, color: "var(--vscode-descriptionForeground)", marginLeft: "auto" }}>
                              forked in {v.elapsed}ms
                            </span>
                          </div>
                          <label style={{ fontSize: 11, color: "var(--vscode-descriptionForeground)", display: "block", marginBottom: 4 }}>
                            Modification SQL (e.g., ADD INDEX, ALTER COLUMN, INSERT/UPDATE data):
                          </label>
                          <textarea
                            className="collection-dialog-input"
                            value={abTestVariantSQLs[v.name] || ""}
                            onChange={(e) =>
                              setAbTestVariantSQLs((prev) => ({ ...prev, [v.name]: e.target.value }))
                            }
                            rows={3}
                            style={{ fontFamily: "monospace", fontSize: 11, resize: "vertical", marginBottom: 6 }}
                            placeholder={`-- e.g., ALTER TABLE \`{table}\` ADD INDEX idx_example (column_name);`}
                            disabled={abTestApplyingSQL === v.name}
                          />
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleApplyVariantSQL(v.name)}
                            disabled={
                              abTestApplyingSQL === v.name ||
                              !(abTestVariantSQLs[v.name]?.trim())
                            }
                            style={{ fontSize: 11 }}
                          >
                            {abTestApplyingSQL === v.name ? (
                              <><RefreshCw size={11} className="spin" /> Applying...</>
                            ) : (
                              <><Play size={11} /> Apply SQL</>
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="collection-dialog-actions" style={{ marginTop: 12 }}>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setAbTestStep("benchmark")}
                      >
                        Next: Benchmark →
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setAbTestStep("create")}
                      >
                        ← Back
                      </button>
                    </div>
                  </>
                )}

                {/* Step 3: Benchmark */}
                {abTestStep === "benchmark" && (
                  <>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: 12, marginBottom: 4, display: "block", color: "var(--vscode-descriptionForeground)" }}>
                        Variants ({abTestVariants.length})
                      </label>
                      {abTestVariants.map((v, idx) => {
                        const appliedSQL = abTestVariantSQLs[v.name]?.trim();
                        return (
                          <div
                            key={v.name}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "4px 8px",
                              fontSize: 12,
                              borderBottom: "1px solid var(--border-color)",
                            }}
                          >
                            <GitFork size={12} style={{ color: "var(--vscode-charts-yellow)" }} />
                            <span style={{ fontWeight: 600, minWidth: 20 }}>{String.fromCharCode(65 + idx)}</span>
                            <span style={{ flex: 1, fontFamily: "monospace" }}>{v.name}</span>
                            <span style={{
                              fontSize: 10,
                              color: appliedSQL
                                ? "var(--vscode-charts-green)"
                                : "var(--vscode-descriptionForeground)",
                              fontStyle: appliedSQL ? "normal" : "italic",
                            }}>
                              {appliedSQL ? "modified" : "unmodified"}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <label style={{ fontSize: 12, marginBottom: 4, display: "block", color: "var(--vscode-descriptionForeground)" }}>
                      Benchmark Query (use <code>{"{table}"}</code> as table placeholder)
                    </label>
                    <textarea
                      className="collection-dialog-input"
                      value={abTestQuery}
                      onChange={(e) => setAbTestQuery(e.target.value)}
                      rows={3}
                      style={{ fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
                      disabled={abTestRunning}
                    />

                    <div className="collection-dialog-actions" style={{ marginTop: 8 }}>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleRunABTestQuery}
                        disabled={abTestRunning}
                      >
                        {abTestRunning ? <RefreshCw size={12} className="spin" /> : <Play size={12} />}
                        Run Benchmark
                      </button>
                    </div>

                    {abTestResults.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <label style={{ fontSize: 12, marginBottom: 4, display: "block", color: "var(--vscode-descriptionForeground)" }}>
                          Results
                        </label>
                        {(() => {
                          const maxElapsed = Math.max(...abTestResults.map((r) => r.elapsed), 1);
                          const minElapsed = Math.min(...abTestResults.filter((r) => !r.error).map((r) => r.elapsed));
                          return abTestResults.map((r, idx) => (
                            <div
                              key={r.variant}
                              style={{
                                padding: "6px 8px",
                                fontSize: 12,
                                borderBottom: "1px solid var(--border-color)",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <span style={{ fontWeight: 600, minWidth: 20 }}>{String.fromCharCode(65 + idx)}</span>
                                <span style={{ fontFamily: "monospace", flex: 1 }}>{r.variant}</span>
                                <span style={{ fontWeight: 600 }}>{r.elapsed}ms</span>
                                <span style={{ fontSize: 10, color: "var(--vscode-descriptionForeground)" }}>
                                  {r.rowCount} rows
                                </span>
                                {!r.error && r.elapsed === minElapsed && (
                                  <span style={{
                                    fontSize: 9, fontWeight: 600,
                                    color: "var(--vscode-charts-green)",
                                    border: "1px solid var(--vscode-charts-green)",
                                    borderRadius: 3, padding: "1px 4px",
                                  }}>
                                    FASTEST
                                  </span>
                                )}
                              </div>
                              <div
                                style={{
                                  height: 6,
                                  borderRadius: 3,
                                  background: "var(--border-color)",
                                  overflow: "hidden",
                                }}
                              >
                                <div
                                  style={{
                                    height: "100%",
                                    width: `${(r.elapsed / maxElapsed) * 100}%`,
                                    borderRadius: 3,
                                    background: r.error
                                      ? "var(--vscode-errorForeground)"
                                      : r.elapsed === minElapsed
                                        ? "var(--vscode-charts-green)"
                                        : "var(--vscode-charts-blue)",
                                    transition: "width 0.3s ease",
                                  }}
                                />
                              </div>
                              {r.error && (
                                <div style={{ fontSize: 10, color: "var(--vscode-errorForeground)", marginTop: 2 }}>
                                  {r.error}
                                </div>
                              )}
                            </div>
                          ));
                        })()}
                      </div>
                    )}

                    <div className="collection-dialog-actions" style={{ marginTop: 12 }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setAbTestStep("configure")}
                      >
                        ← Back to Configure
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={handleCleanupABTest}
                      >
                        <Trash2 size={12} /> Cleanup All Variants
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setShowABTestDialog(false)}
                      >
                        <X size={12} /> Close
                      </button>
                    </div>
                  </>
                )}
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
          {/* Safe Change Mode Banner */}
          {safeChangeMode && safeChangeFork && (
            <div
              className="safe-change-banner"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                background: "rgba(255,180,0,0.12)",
                borderBottom: "2px solid var(--vscode-charts-yellow)",
                fontSize: 12,
              }}
            >
              <Shield size={14} style={{ color: "var(--vscode-charts-yellow)", flexShrink: 0 }} />
              <span style={{ flex: 1 }}>
                <strong>Safe Change Mode:</strong> Editing fork <code style={{ fontSize: 11 }}>{safeChangeFork}</code> of{" "}
                <code style={{ fontSize: 11 }}>{safeChangeSource}</code>. Changes won't affect the original table.
              </span>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setSchemaDiffTableA(safeChangeSource);
                  setSchemaDiffTableB(safeChangeFork);
                  handleShowSchemaDiff(safeChangeSource, safeChangeFork);
                }}
                style={{ fontSize: 11, padding: "2px 8px" }}
                disabled={schemaDiffLoading}
              >
                {schemaDiffLoading ? <RefreshCw size={12} className="spin" /> : <Diff size={12} />} Compare
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handlePromoteFork}
                style={{ fontSize: 11, padding: "2px 8px" }}
              >
                <ArrowUp size={12} /> Apply to Source
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={handleDiscardFork}
                style={{ fontSize: 11, padding: "2px 8px" }}
              >
                <Trash2 size={12} /> Discard
              </button>
            </div>
          )}

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

          {/* Vector Similarity Search - Only for seekdb, hide in visualizer view */}
          {isSeekDB && currentView !== "visualizer" && (
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
                          color:
                            "var(--vscode-inputValidation-warningForeground)",
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
          {currentView === "visualizer" ? (
            <div className="result-area visualizer-area">
              {visualizerLoading ? (
                <div className="empty-state">
                  <div className="loading">
                    <div className="loading-spinner"></div>
                    Loading table structures...
                  </div>
                </div>
              ) : error ? (
                <div className="empty-state">
                  <XCircle size={48} className="icon" />
                  <p style={{ color: "var(--danger-color, #dc3545)" }}>
                    {error}
                  </p>
                </div>
              ) : (
                <TableStructureVisualizer
                  tables={tables}
                  connectionInfo={connectionInfo}
                  collections={collections}
                  selectedCollection={selectedVisualizerCollection}
                  onCollectionChange={setSelectedVisualizerCollection}
                  savedStructures={savedTableStructures}
                  onSaveStructure={(name: string) => {
                    setSavedTableStructures((prev) => [
                      ...prev,
                      { name, tables },
                    ]);
                  }}
                  onApplyStructure={(structure: {
                    name: string;
                    tables: Table[];
                  }) => {
                    setTables(structure.tables);
                  }}
                  onDeleteStructure={(name: string) => {
                    setSavedTableStructures((prev) =>
                      prev.filter((s) => s.name !== name),
                    );
                  }}
                />
              )}
            </div>
          ) : (
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
                ) : !queryResult ||
                  !queryResult.columns ||
                  !queryResult.rows ? (
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
                          className={
                            selectedRowIndex === index ? "selected" : ""
                          }
                          onClick={() => handleRowClick(index)}
                          onContextMenu={(e) =>
                            handleRowContextMenu(e, index, row)
                          }
                        >
                          <td className="row-number">{index + 1}</td>
                          {queryResult.columns.map((col) => {
                            const { display, title } = formatCell(
                              row[col.name],
                            );
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
          )}

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
                  <option value="nodejs-fork">NodeJs - Fork Table</option>
                  <option value="python-fork">Python - Fork Table</option>
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
