import React, { useState, useEffect, useRef } from "react";
import { Database, AlertTriangle, X, Loader2 } from "lucide-react";
import "./index.css";

export type ModalMode = "create" | "delete";

interface DatabaseModalProps {
  isOpen: boolean;
  mode: ModalMode;
  databaseName?: string;
  onConfirm: (name?: string) => void;
  onCancel: () => void;
  loading?: boolean;
  /** 系统数据库列表，删除时会检查 */
  systemDatabases?: string[];
}

/**
 * DatabaseModal - 数据库新增/删除对话框组件
 * 遵循项目设计风格，使用 VSCode 主题变量
 */
const DatabaseModal: React.FC<DatabaseModalProps> = ({
  isOpen,
  mode,
  databaseName = "",
  onConfirm,
  onCancel,
  loading = false,
  systemDatabases = [
    "mysql",
    "information_schema",
    "oceanbase",
    "sys_external_tbs",
  ],
}) => {
  const [inputName, setInputName] = useState("");
  const [confirmInput, setConfirmInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时重置状态并聚焦
  useEffect(() => {
    if (isOpen) {
      setInputName("");
      setConfirmInput("");
      setError(null);
      // 延迟聚焦，确保 DOM 已渲染
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // 校验数据库名称
  const validateDatabaseName = (name: string): string | null => {
    if (!name.trim()) {
      return "Database name cannot be empty";
    }
    // 只允许字母、数字、下划线
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      return "Database name must start with a letter or underscore, and contain only letters, numbers, and underscores";
    }
    // 长度限制
    if (name.length > 64) {
      return "Database name cannot exceed 64 characters";
    }
    return null;
  };

  // 检查是否为系统数据库
  const isSystemDatabase = (name: string): boolean => {
    return systemDatabases.some(
      (db) => db.toLowerCase() === name.toLowerCase()
    );
  };

  const handleConfirm = () => {
    if (mode === "create") {
      const validationError = validateDatabaseName(inputName);
      if (validationError) {
        setError(validationError);
        return;
      }
      onConfirm(inputName.trim());
    } else {
      // 删除模式：要求输入数据库名称进行二次确认
      if (confirmInput !== databaseName) {
        setError("Please type the database name to confirm deletion");
        return;
      }
      onConfirm();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) {
      handleConfirm();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  if (!isOpen) return null;

  const isDeleteDisabled = mode === "delete" && isSystemDatabase(databaseName);

  return (
    <div className="db-modal-overlay" onClick={onCancel}>
      <div
        className="db-modal-container"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className={`db-modal-header ${mode === "delete" ? "danger" : ""}`}>
          <div className="db-modal-title-wrapper">
            {mode === "create" ? (
              <Database size={20} className="db-modal-icon" />
            ) : (
              <AlertTriangle size={20} className="db-modal-icon warning" />
            )}
            <h3 className="db-modal-title">
              {mode === "create" ? "Create Database" : "Delete Database"}
            </h3>
          </div>
          <button
            className="db-modal-close"
            onClick={onCancel}
            disabled={loading}
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="db-modal-body">
          {mode === "create" ? (
            <>
              <div className="db-modal-form-group">
                <label htmlFor="db-name-input">Database Name</label>
                <input
                  ref={inputRef}
                  id="db-name-input"
                  type="text"
                  className={`db-modal-input ${error ? "error" : ""}`}
                  placeholder="Enter database name..."
                  value={inputName}
                  onChange={(e) => {
                    setInputName(e.target.value);
                    setError(null);
                  }}
                  disabled={loading}
                  autoComplete="off"
                />
                <p className="db-modal-hint">
                  Name must start with a letter or underscore, contain only
                  letters, numbers, and underscores.
                </p>
              </div>
            </>
          ) : (
            <>
              {isDeleteDisabled ? (
                <div className="db-modal-warning-box error">
                  <AlertTriangle size={16} />
                  <span>
                    Cannot delete system database{" "}
                    <strong>"{databaseName}"</strong>
                  </span>
                </div>
              ) : (
                <>
                  <div className="db-modal-warning-box">
                    <AlertTriangle size={16} />
                    <span>This action cannot be undone!</span>
                  </div>
                  <p className="db-modal-message">
                    You are about to delete database{" "}
                    <strong className="db-name-highlight">
                      "{databaseName}"
                    </strong>
                    . All tables and data will be permanently removed.
                  </p>
                  <div className="db-modal-form-group">
                    <label htmlFor="db-confirm-input">
                      Type <strong>{databaseName}</strong> to confirm:
                    </label>
                    <input
                      ref={inputRef}
                      id="db-confirm-input"
                      type="text"
                      className={`db-modal-input ${error ? "error" : ""}`}
                      placeholder={databaseName}
                      value={confirmInput}
                      onChange={(e) => {
                        setConfirmInput(e.target.value);
                        setError(null);
                      }}
                      disabled={loading}
                      autoComplete="off"
                    />
                  </div>
                </>
              )}
            </>
          )}

          {/* Error message */}
          {error && (
            <div className="db-modal-error">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="db-modal-footer">
          <button
            className="db-modal-btn secondary"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          {!isDeleteDisabled && (
            <button
              className={`db-modal-btn ${
                mode === "delete" ? "danger" : "primary"
              }`}
              onClick={handleConfirm}
              disabled={
                loading ||
                (mode === "create" && !inputName.trim()) ||
                (mode === "delete" && confirmInput !== databaseName)
              }
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="spin" />
                  Processing...
                </>
              ) : mode === "create" ? (
                "Create"
              ) : (
                "Delete"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DatabaseModal;
