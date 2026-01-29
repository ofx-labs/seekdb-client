import React, { useCallback, useState, useEffect, useMemo } from "react";
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  NodeTypes,
} from "reactflow";
import { Save, Trash2, Check, X } from "lucide-react";
import "reactflow/dist/style.css";
import "./index.css";

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

interface Collection {
  name: string;
  type?: string;
}

interface SavedStructure {
  name: string;
  tables: Table[];
}

interface TableStructureVisualizerProps {
  tables: Table[];
  connectionInfo: {
    name: string;
    host: string;
    port: number;
    database?: string;
  };
  collections?: Collection[];
  selectedCollection?: string | null;
  onCollectionChange?: (collectionName: string | null) => void;
  savedStructures?: SavedStructure[];
  onSaveStructure?: (name: string) => void;
  onApplyStructure?: (structure: SavedStructure) => void;
  onDeleteStructure?: (name: string) => void;
}

// 自定义表节点组件
const TableNode = ({ data }: { data: { table: Table } }) => {
  const { table } = data;

  return (
    <div className="table-node">
      <div className="table-node-header">
        <strong>{table.name}</strong>
      </div>
      <div className="table-node-body">
        {table.columns.map((column, index) => (
          <div key={index} className="table-column">
            <span className="column-name">
              {column.primaryKey && <span className="pk-icon">🔑</span>}
              {column.name}
            </span>
            <span className="column-type">{column.type}</span>
            {!column.nullable && <span className="not-null">NOT NULL</span>}
            {column.foreignKey && (
              <span className="fk-hint">
                → {column.foreignKey.table}.{column.foreignKey.column}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const nodeTypes: NodeTypes = {
  table: TableNode,
};

const TableStructureVisualizer: React.FC<TableStructureVisualizerProps> = ({
  tables,
  connectionInfo,
  collections = [],
  selectedCollection = null,
  onCollectionChange,
  savedStructures = [],
  onSaveStructure,
  onApplyStructure,
  onDeleteStructure,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveStructureName, setSaveStructureName] = useState("");
  const [showSavedStructures, setShowSavedStructures] = useState(false);

  // 根据选择的 collection 过滤表 - 使用 useMemo 避免不必要的重新计算
  const filteredTables = useMemo(() => {
    if (!selectedCollection) return tables;
    return tables.filter((table) => table.name === selectedCollection);
  }, [selectedCollection, tables]);

  // 初始化节点和边
  useEffect(() => {
    if (filteredTables.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    // 计算节点位置（网格布局）
    const cols = Math.ceil(Math.sqrt(filteredTables.length));
    const nodeWidth = 250;
    const nodeHeight = 200;
    const spacing = 300;

    const initialNodes: Node[] = filteredTables.map((table, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      return {
        id: `table-${table.name}`,
        type: "table",
        position: {
          x: col * spacing + 50,
          y: row * spacing + 50,
        },
        data: { table },
      };
    });

    // 创建外键关系边
    const initialEdges: Edge[] = [];
    filteredTables.forEach((table) => {
      table.columns.forEach((column) => {
        if (column.foreignKey) {
          const sourceId = `table-${table.name}`;
          const targetId = `table-${column.foreignKey.table}`;

          // 检查边是否已存在
          const edgeExists = initialEdges.some(
            (e) => e.source === sourceId && e.target === targetId,
          );

          if (!edgeExists) {
            initialEdges.push({
              id: `edge-${sourceId}-${targetId}`,
              source: sourceId,
              target: targetId,
              type: "smoothstep",
              animated: true,
              style: { stroke: "#6366f1", strokeWidth: 2 },
              label: `${column.name} → ${column.foreignKey.column}`,
            });
          }
        }
      });
    });

    setNodes(initialNodes);
    setEdges(initialEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTables]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (filteredTables.length === 0) {
    return (
      <div className="visualizer-empty">
        <p>暂无表结构数据</p>
        <p className="visualizer-empty-hint">
          {selectedCollection
            ? `Collection "${selectedCollection}" 没有表结构数据`
            : "请先连接到数据库并选择数据库"}
        </p>
      </div>
    );
  }

  const handleSaveStructure = () => {
    if (saveStructureName.trim() && onSaveStructure) {
      onSaveStructure(saveStructureName.trim());
      setSaveStructureName("");
      setShowSaveDialog(false);
    }
  };

  const handleApplyStructure = (structure: SavedStructure) => {
    if (onApplyStructure) {
      onApplyStructure(structure);
      setShowSavedStructures(false);
    }
  };

  const handleDeleteStructure = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDeleteStructure) {
      onDeleteStructure(name);
    }
  };

  return (
    <div className="table-structure-visualizer">
      <div className="visualizer-header">
        <h3>数据库表结构可视化</h3>
        <div className="visualizer-info">
          <span>{connectionInfo.database || "information_schema"}</span>
          <span className="table-count">
            {filteredTables.length} 个表
            {selectedCollection && ` (已过滤: ${selectedCollection})`}
          </span>
        </div>
        <div className="visualizer-actions">
          {/* Collection 选择 */}
          {collections.length > 0 && onCollectionChange && (
            <select
              className="visualizer-collection-select"
              value={selectedCollection || ""}
              onChange={(e) => onCollectionChange(e.target.value || null)}
            >
              <option value="">选择 Collection</option>
              {collections.map((collection) => (
                <option key={collection.name} value={collection.name}>
                  {collection.name}
                </option>
              ))}
            </select>
          )}
          {/* 保存数据结构 */}
          {onSaveStructure && (
            <button
              className="visualizer-action-btn"
              onClick={() => setShowSaveDialog(true)}
              title="保存当前数据结构"
            >
              <Save size={14} />
              保存结构
            </button>
          )}
          {/* 应用已保存的结构 */}
          {savedStructures.length > 0 && onApplyStructure && (
            <div className="visualizer-saved-structures">
              <button
                className="visualizer-action-btn"
                onClick={() => setShowSavedStructures(!showSavedStructures)}
                title="应用已保存的数据结构"
              >
                <Check size={14} />
                应用结构
              </button>
              {showSavedStructures && (
                <div className="visualizer-saved-list">
                  {savedStructures.map((structure) => (
                    <div
                      key={structure.name}
                      className="visualizer-saved-item"
                      onClick={() => handleApplyStructure(structure)}
                    >
                      <span>{structure.name}</span>
                      {onDeleteStructure && (
                        <button
                          className="visualizer-delete-btn"
                          onClick={(e) =>
                            handleDeleteStructure(structure.name, e)
                          }
                          title="删除"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {/* 保存对话框 */}
      {showSaveDialog && (
        <div className="visualizer-save-dialog-overlay">
          <div className="visualizer-save-dialog">
            <h4>保存数据结构</h4>
            <input
              type="text"
              className="visualizer-save-input"
              placeholder="输入结构名称..."
              value={saveStructureName}
              onChange={(e) => setSaveStructureName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveStructure();
                if (e.key === "Escape") {
                  setShowSaveDialog(false);
                  setSaveStructureName("");
                }
              }}
              autoFocus
            />
            <div className="visualizer-save-dialog-actions">
              <button
                className="visualizer-save-btn"
                onClick={handleSaveStructure}
                disabled={!saveStructureName.trim()}
              >
                <Check size={12} />
                保存
              </button>
              <button
                className="visualizer-cancel-btn"
                onClick={() => {
                  setShowSaveDialog(false);
                  setSaveStructureName("");
                }}
              >
                <X size={12} />
                取消
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="visualizer-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="bottom-left"
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
};

export default TableStructureVisualizer;
