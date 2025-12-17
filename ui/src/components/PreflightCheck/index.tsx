import React, { useState, useEffect } from "react";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  Loader,
  Monitor,
  Cpu,
  Box,
  Server,
  Package,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { vscode } from "../../utils/vscode";
import "./index.css";

/** 检查状态 */
type CheckStatus =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "skipped"
  | "pending"
  | "running";

/** 单项检查结果 */
interface CheckResult {
  id: string;
  name: string;
  status: CheckStatus;
  message: string;
  details?: Record<string, any>;
  suggestion?: string;
  actionUrl?: string;
}

/** 系统信息 */
interface SystemInfo {
  os: {
    platform: string;
    release: string;
    arch: string;
  };
  node: {
    version: string;
  };
  vscode: {
    version: string;
  };
}

/** 预检查报告 */
interface PreflightReport {
  timestamp: string;
  duration: number;
  system: SystemInfo;
  checks: CheckResult[];
  overallStatus: CheckStatus;
}

/** 预检查状态 */
type PreflightState = "idle" | "running" | "completed";

/** 状态图标映射 */
const StatusIcon: React.FC<{ status: CheckStatus; size?: number }> = ({
  status,
  size = 16,
}) => {
  switch (status) {
    case "success":
      return <CheckCircle size={size} className="status-icon success" />;
    case "error":
      return <XCircle size={size} className="status-icon error" />;
    case "warning":
      return <AlertTriangle size={size} className="status-icon warning" />;
    case "info":
      return <Info size={size} className="status-icon info" />;
    case "skipped":
      return <Info size={size} className="status-icon skipped" />;
    case "running":
    case "pending":
      return <Loader size={size} className="status-icon pending spinning" />;
    default:
      return <Info size={size} className="status-icon" />;
  }
};

/** 检查项图标映射 */
const CheckIcon: React.FC<{ checkId: string; size?: number }> = ({
  checkId,
  size = 16,
}) => {
  switch (checkId) {
    case "system":
      return <Monitor size={size} />;
    case "docker":
      return <Box size={size} />;
    case "seekdb-image":
      return <Package size={size} />;
    case "seekdb-instance":
      return <Server size={size} />;
    case "sdk-version":
      return <Cpu size={size} />;
    default:
      return <Info size={size} />;
  }
};

/**
 * PreflightCheck - 预检查视图组件
 */
function PreflightCheck() {
  const [state, setState] = useState<PreflightState>("idle");
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [expandedChecks, setExpandedChecks] = useState<Set<string>>(new Set());
  const [currentCheck, setCurrentCheck] = useState<string>("");

  useEffect(() => {
    // 监听来自扩展的消息
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case "preflightStart":
          // 开始预检查
          setState("running");
          setChecks([]);
          setReport(null);
          break;

        case "preflightProgress":
          // 更新检查进度
          if (message.data) {
            setCurrentCheck(message.data.currentCheck || "");
            if (message.data.checks) {
              setChecks(message.data.checks);
            }
          }
          break;

        case "preflightCheckResult":
          // 单项检查完成
          if (message.data?.result) {
            setChecks((prev) => {
              const existing = prev.find(
                (c) => c.id === message.data.result.id
              );
              if (existing) {
                return prev.map((c) =>
                  c.id === message.data.result.id ? message.data.result : c
                );
              }
              return [...prev, message.data.result];
            });
          }
          break;

        case "preflightComplete":
          // 检查完成
          setState("completed");
          if (message.data?.report) {
            setReport(message.data.report);
            setChecks(message.data.report.checks || []);
          }
          break;

        case "preflightReport":
          // 接收完整报告（初始加载或刷新）
          setState("completed");
          if (message.data?.report) {
            setReport(message.data.report);
            setChecks(message.data.report.checks || []);
          }
          break;
      }
    };

    window.addEventListener("message", handleMessage);

    // 请求初始预检查状态
    vscode.postMessage({ type: "getPreflightStatus" });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  // 重新运行检查
  const handleRerunChecks = () => {
    setState("running");
    setChecks([]);
    vscode.postMessage({ type: "runPreflight" });
  };

  // 切换检查项展开状态
  const toggleCheckExpand = (checkId: string) => {
    setExpandedChecks((prev) => {
      const next = new Set(prev);
      if (next.has(checkId)) {
        next.delete(checkId);
      } else {
        next.add(checkId);
      }
      return next;
    });
  };

  // 打开外部链接
  const openExternalLink = (url: string) => {
    vscode.postMessage({
      type: "openBrowser",
      data: { url },
    });
  };

  // 继续到数据库连接页面
  const handleContinue = () => {
    vscode.postMessage({ type: "preflightContinue" });
  };

  // 获取总体状态文本
  const getOverallStatusText = (status: CheckStatus): string => {
    switch (status) {
      case "success":
        return "所有检查通过";
      case "warning":
        return "检查完成，有警告";
      case "error":
        return "检查发现问题";
      default:
        return "检查完成";
    }
  };

  // 渲染单个检查项
  const renderCheckItem = (check: CheckResult) => {
    const isExpanded = expandedChecks.has(check.id);
    const hasDetails = check.details && Object.keys(check.details).length > 0;
    const hasSuggestion = !!check.suggestion;
    const hasActionUrl = !!check.actionUrl;
    const isExpandable = hasDetails || hasSuggestion || hasActionUrl;

    return (
      <div key={check.id} className={`preflight-check-item ${check.status}`}>
        <div
          className={`preflight-check-header ${
            isExpandable ? "expandable" : ""
          }`}
          onClick={isExpandable ? () => toggleCheckExpand(check.id) : undefined}
        >
          {isExpandable && (
            <span className="preflight-expand-icon">
              {isExpanded ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
            </span>
          )}
          <span className="preflight-check-icon">
            <CheckIcon checkId={check.id} size={16} />
          </span>
          <span className="preflight-check-name">{check.name}</span>
          <span className="preflight-check-status">
            <StatusIcon status={check.status} size={14} />
          </span>
        </div>
        <div className="preflight-check-message">{check.message}</div>

        {isExpanded && (
          <div className="preflight-check-details">
            {hasSuggestion && (
              <div className="preflight-suggestion">
                <Info size={12} />
                <span>{check.suggestion}</span>
              </div>
            )}
            {hasActionUrl && (
              <div className="preflight-action">
                <button
                  className="preflight-action-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    openExternalLink(check.actionUrl!);
                  }}
                >
                  <ExternalLink size={12} />
                  <span>查看文档</span>
                </button>
              </div>
            )}
            {hasDetails && (
              <div className="preflight-details-content">
                {Object.entries(check.details!).map(([key, value]) => (
                  <div key={key} className="preflight-detail-row">
                    <span className="preflight-detail-key">{key}:</span>
                    <span className="preflight-detail-value">
                      {typeof value === "object"
                        ? JSON.stringify(value, null, 2)
                        : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // 渲染运行中状态
  const renderRunningState = () => (
    <div className="preflight-running">
      <div className="preflight-running-header">
        <Loader size={24} className="spinning" />
        <span>正在检查环境...</span>
      </div>
      {currentCheck && (
        <div className="preflight-current-check">当前检查: {currentCheck}</div>
      )}
      <div className="preflight-progress">
        {checks.map((check) => (
          <div
            key={check.id}
            className={`preflight-progress-item ${check.status}`}
          >
            <StatusIcon status={check.status} size={14} />
            <span>{check.name}</span>
          </div>
        ))}
      </div>
    </div>
  );

  // 渲染完成状态
  const renderCompletedState = () => {
    if (!report) {
      return (
        <div className="preflight-empty">
          <p>暂无检查结果</p>
          <button className="preflight-run-btn" onClick={handleRerunChecks}>
            <RefreshCw size={14} />
            <span>运行检查</span>
          </button>
        </div>
      );
    }

    const canContinue = report.overallStatus !== "error";

    return (
      <div className="preflight-completed">
        {/* 总体状态 */}
        <div className={`preflight-overall-status ${report.overallStatus}`}>
          <StatusIcon status={report.overallStatus} size={20} />
          <span>{getOverallStatusText(report.overallStatus)}</span>
        </div>

        {/* 系统信息 */}
        <div className="preflight-system-info">
          <div className="preflight-system-item">
            <Monitor size={14} />
            <span>
              {report.system.os.platform === "darwin"
                ? "macOS"
                : report.system.os.platform === "win32"
                ? "Windows"
                : "Linux"}{" "}
              ({report.system.os.arch})
            </span>
          </div>
          <div className="preflight-system-item">
            <Package size={14} />
            <span>VS Code {report.system.vscode.version}</span>
          </div>
        </div>

        {/* 检查列表 */}
        <div className="preflight-checks-list">
          {checks.map(renderCheckItem)}
        </div>

        {/* 操作按钮 */}
        <div className="preflight-actions">
          <button
            className="preflight-rerun-btn"
            onClick={handleRerunChecks}
            title="重新检查"
          >
            <RefreshCw size={14} />
            <span>重新检查</span>
          </button>
          {canContinue && (
            <button className="preflight-continue-btn" onClick={handleContinue}>
              <span>继续</span>
              <ChevronRight size={14} />
            </button>
          )}
        </div>

        {/* 检查时间 */}
        <div className="preflight-meta">检查耗时: {report.duration}ms</div>
      </div>
    );
  };

  // 渲染空闲状态（首次加载）
  const renderIdleState = () => (
    <div className="preflight-idle">
      <div className="preflight-idle-icon">
        <Monitor size={32} />
      </div>
      <h3>环境预检查</h3>
      <p>在使用 SeekDB 之前，我们需要检查您的环境配置</p>
      <button className="preflight-start-btn" onClick={handleRerunChecks}>
        <RefreshCw size={14} />
        <span>开始检查</span>
      </button>
    </div>
  );

  return (
    <div className="preflight-container">
      {/* 头部 */}
      <div className="preflight-header">
        <h3>
          <Monitor size={16} /> 环境检查
        </h3>
      </div>

      {/* 内容区 */}
      <div className="preflight-content">
        {state === "idle" && renderIdleState()}
        {state === "running" && renderRunningState()}
        {state === "completed" && renderCompletedState()}
      </div>
    </div>
  );
}

export default PreflightCheck;
