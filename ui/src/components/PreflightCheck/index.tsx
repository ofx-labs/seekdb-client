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

/** Check status */
type CheckStatus =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "skipped"
  | "pending"
  | "running";

/** Single check result */
interface CheckResult {
  id: string;
  name: string;
  status: CheckStatus;
  message: string;
  details?: Record<string, any>;
  suggestion?: string;
  actionUrl?: string;
}

/** System information */
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

/** Preflight report */
interface PreflightReport {
  timestamp: string;
  duration: number;
  system: SystemInfo;
  checks: CheckResult[];
  overallStatus: CheckStatus;
}

/** Preflight state */
type PreflightState = "idle" | "running" | "completed";

/** Status icon mapping */
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

/** Check icon mapping */
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
 * PreflightCheck - Preflight check view component
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
          // Start preflight check
          setState("running");
          setChecks([]);
          setReport(null);
          break;

        case "preflightProgress":
          // Update check progress
          if (message.data) {
            setCurrentCheck(message.data.currentCheck || "");
            if (message.data.checks) {
              setChecks(message.data.checks);
            }
          }
          break;

        case "preflightCheckResult":
          // Single check completed
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
          // Check completed
          setState("completed");
          if (message.data?.report) {
            setReport(message.data.report);
            setChecks(message.data.report.checks || []);
          }
          break;

        case "preflightReport":
          // Receive full report (initial load or refresh)
          setState("completed");
          if (message.data?.report) {
            setReport(message.data.report);
            setChecks(message.data.report.checks || []);
          }
          break;
      }
    };

    window.addEventListener("message", handleMessage);

    // Request initial preflight status
    vscode.postMessage({ type: "getPreflightStatus" });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  // Re-run checks
  const handleRerunChecks = () => {
    setState("running");
    setChecks([]);
    vscode.postMessage({ type: "runPreflight" });
  };

  // Toggle check item expand state
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

  // Open external link
  const openExternalLink = (url: string) => {
    vscode.postMessage({
      type: "openBrowser",
      data: { url },
    });
  };

  // Continue to database connection page
  const handleContinue = () => {
    vscode.postMessage({ type: "preflightContinue" });
  };

  // Get overall status text
  const getOverallStatusText = (status: CheckStatus): string => {
    switch (status) {
      case "success":
        return "All checks passed";
      case "warning":
        return "Checks completed with warnings";
      case "error":
        return "Checks found issues";
      default:
        return "Checks completed";
    }
  };

  // Render single check item
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
                  <span>View Docs</span>
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

  // Render running state
  const renderRunningState = () => (
    <div className="preflight-running">
      <div className="preflight-running-header">
        <Loader size={24} className="spinning" />
        <span>Checking environment...</span>
      </div>
      {currentCheck && (
        <div className="preflight-current-check">Current: {currentCheck}</div>
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

  // Render completed state
  const renderCompletedState = () => {
    if (!report) {
      return (
        <div className="preflight-empty">
          <p>No check results</p>
          <button className="preflight-run-btn" onClick={handleRerunChecks}>
            <RefreshCw size={14} />
            <span>Run Check</span>
          </button>
        </div>
      );
    }

    const canContinue = report.overallStatus !== "error";

    return (
      <div className="preflight-completed">
        {/* Overall status */}
        <div className={`preflight-overall-status ${report.overallStatus}`}>
          <StatusIcon status={report.overallStatus} size={20} />
          <span>{getOverallStatusText(report.overallStatus)}</span>
        </div>

        {/* System info */}
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

        {/* Check list */}
        <div className="preflight-checks-list">
          {checks.map(renderCheckItem)}
        </div>

        {/* Action buttons */}
        <div className="preflight-actions">
          <button
            className="preflight-rerun-btn"
            onClick={handleRerunChecks}
            title="Re-run checks"
          >
            <RefreshCw size={14} />
            <span>Re-run</span>
          </button>
          {canContinue && (
            <button className="preflight-continue-btn" onClick={handleContinue}>
              <span>Continue</span>
              <ChevronRight size={14} />
            </button>
          )}
        </div>

        {/* Check duration */}
        <div className="preflight-meta">Duration: {report.duration}ms</div>
      </div>
    );
  };

  // Render idle state (first load)
  const renderIdleState = () => (
    <div className="preflight-idle">
      <div className="preflight-idle-icon">
        <Monitor size={32} />
      </div>
      <h3>Environment Preflight</h3>
      <p>
        Before using SeekDB, we need to check your environment configuration
      </p>
      <button className="preflight-start-btn" onClick={handleRerunChecks}>
        <RefreshCw size={14} />
        <span>Start Check</span>
      </button>
    </div>
  );

  return (
    <div className="preflight-container">
      {/* Header */}
      <div className="preflight-header">
        <h3>
          <Monitor size={16} /> Preflight Check
        </h3>
      </div>

      {/* Content */}
      <div className="preflight-content">
        {state === "idle" && renderIdleState()}
        {state === "running" && renderRunningState()}
        {state === "completed" && renderCompletedState()}
      </div>
    </div>
  );
}

export default PreflightCheck;
