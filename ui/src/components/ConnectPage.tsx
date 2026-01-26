import React, { useState, useEffect, useRef } from "react";
import {
  Database,
  Search,
  Settings,
  KeyRound,
  Globe,
  Network,
  Save,
  PlugZap,
  X,
  Cloud,
  HelpCircle,
  ExternalLink,
} from "lucide-react";
import "./ConnectPage.css";

interface DefaultConfig {
  id?: string;
  connectionName?: string;
  type?: string;
  host: string;
  port: number;
  tenant: string;
  database: string;
  user: string;
  password: string;
}

interface ConnectPageProps {
  vscode: {
    postMessage: (message: any) => void;
  };
  defaultConfig: DefaultConfig;
}

type DbType = "seekdb" | "nero" | "oceanbase-cloud";
type ConfigTab = "main" | "ssh" | "socks" | "http";
type Scope = "advance" | "scope" | "global" | "workspace";

const ConnectPage: React.FC<ConnectPageProps> = ({ vscode, defaultConfig }) => {
  // Determine initial db type from saved connection or default to seekdb
  const initialDbType = (defaultConfig.type as DbType) || "seekdb";
  const [currentDbType, setCurrentDbType] = useState<DbType>(initialDbType);
  const [currentConfigTab, setCurrentConfigTab] = useState<ConfigTab>("main");
  const [currentScope, setCurrentScope] = useState<Scope>("global");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  // Store connection id for editing existing connections
  const [connectionId, setConnectionId] = useState<string | undefined>(
    defaultConfig.id,
  );

  // Tooltip 显示状态
  const [showHelpTooltip, setShowHelpTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const helpBtnRef = useRef<HTMLButtonElement>(null);

  // Form state - initialize from defaultConfig (may contain saved connection data)
  const [formData, setFormData] = useState({
    connectionName: defaultConfig.connectionName || "",
    group: "",
    host: defaultConfig.host,
    port: defaultConfig.port,
    user: defaultConfig.user,
    password: defaultConfig.password,
    tenant: defaultConfig.tenant,
    database: defaultConfig.database,
    useConnectionString: false,
    ssl: false,
    sshHost: "",
    sshPort: 22,
    sshUser: "",
    sshPassword: "",
    socksHost: "",
    socksPort: 1080,
    httpProxyUrl: "",
  });

  // 切换数据库类型时更新默认端口
  useEffect(() => {
    if (currentDbType === "oceanbase-cloud") {
      setFormData((prev) => ({ ...prev, port: 3306 }));
    } else {
      setFormData((prev) => ({ ...prev, port: defaultConfig.port }));
    }
  }, [currentDbType, defaultConfig.port]);

  // 点击外部关闭 tooltip
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        showHelpTooltip &&
        tooltipRef.current &&
        helpBtnRef.current &&
        !tooltipRef.current.contains(event.target as Node) &&
        !helpBtnRef.current.contains(event.target as Node)
      ) {
        setShowHelpTooltip(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showHelpTooltip]);

  // Listen for messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      setLoading(false);

      switch (msg.type) {
        case "connectionSuccess":
          showMessage("success", "Connection successful!");
          break;
        case "connectionError":
          showMessage("error", msg.data?.error || "Connection failed");
          break;
        case "testResult":
          showMessage(
            msg.data?.success ? "success" : "error",
            msg.data?.success ? "Test successful!" : "Test failed",
          );
          break;
        case "restoreConnection":
          // Restore saved connection data to form
          if (msg.data) {
            const conn = msg.data;
            setConnectionId(conn.id);
            setCurrentDbType((conn.type as DbType) || "seekdb");
            setFormData((prev) => ({
              ...prev,
              connectionName: conn.name || "",
              host: conn.host || "",
              port: conn.port || 2881,
              user: conn.user || "",
              password: conn.password || "",
              tenant: conn.tenant || "",
              database: conn.database || "",
            }));
          }
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const showMessage = (type: "success" | "error" | "info", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handlePortChange = (delta: number) => {
    setFormData((prev) => ({
      ...prev,
      port: Math.max(1, prev.port + delta),
    }));
  };

  const getFormData = () => {
    return {
      id: connectionId,
      type: currentDbType,
      scope: currentScope,
      ...formData,
    };
  };

  const handleSave = () => {
    const data = getFormData();
    if (!data.connectionName) {
      showMessage("error", "Please enter connection name");
      return;
    }
    vscode.postMessage({ type: "save", data });
  };

  const handleTestConnection = () => {
    const data = getFormData();
    if (!data.host || !data.port) {
      showMessage("error", "Please enter host and port");
      return;
    }
    setLoading(true);
    vscode.postMessage({ type: "testConnection", data });
  };

  const handleConnect = () => {
    const data = getFormData();
    if (!data.host || !data.port) {
      showMessage("error", "Please enter host and port");
      return;
    }
    setLoading(true);
    vscode.postMessage({ type: "connect", data });
  };

  const handleClose = () => {
    vscode.postMessage({ type: "close" });
  };

  const openExternalLink = (url: string) => {
    vscode.postMessage({ type: "openBrowser", data: { url } });
  };

  const dbTypes: { type: DbType; label: string; icon: React.ReactNode }[] = [
    { type: "seekdb", label: "seekdb", icon: <Search size={16} /> },
    {
      type: "oceanbase-cloud",
      label: "OceanBase Cloud",
      icon: <Cloud size={16} />,
    },
  ];

  const showTenant =
    currentDbType === "seekdb" ||
    currentDbType === "nero" ||
    currentDbType === "oceanbase-cloud";

  return (
    <div className="connect-page">
      <div className="container">
        <div className="header">
          <div className="header-icon">
            <Database size={32} />
          </div>
          <div>
            <h1>Connect to Server</h1>
            <p>Connect to seekdb, OceanBase Cloud, or other database servers</p>
          </div>
        </div>

        <div className="form-section">
          <div className="form-row">
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                id="connectionName"
                placeholder="Connection Name"
                value={formData.connectionName}
                onChange={(e) =>
                  handleInputChange("connectionName", e.target.value)
                }
              />
            </div>
            <div className="form-group">
              <label>Group</label>
              <input
                type="text"
                id="group"
                placeholder="Parent/Sub"
                value={formData.group}
                onChange={(e) => handleInputChange("group", e.target.value)}
              />
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div className="scope-buttons">
              <button
                className={`scope-btn ${
                  currentScope === "advance" ? "active" : ""
                }`}
                onClick={() => setCurrentScope("advance")}
              >
                Advance
              </button>
              <button
                className={`scope-btn ${
                  currentScope === "scope" ? "active" : ""
                }`}
                onClick={() => setCurrentScope("scope")}
              >
                Scope
              </button>
              <button
                className={`scope-btn ${
                  currentScope === "global" ? "active" : ""
                }`}
                onClick={() => setCurrentScope("global")}
              >
                Global
              </button>
              <button
                className={`scope-btn ${
                  currentScope === "workspace" ? "active" : ""
                }`}
                onClick={() => setCurrentScope("workspace")}
              >
                Workspace
              </button>
            </div>
          </div>
        </div>

        <div className="db-type-selector">
          <span className="db-type-label">Server Type</span>
          <div className="db-type-tabs">
            {dbTypes.map(({ type, label, icon }) => (
              <button
                key={type}
                className={`db-type-tab ${
                  currentDbType === type ? "active" : ""
                }`}
                onClick={() => setCurrentDbType(type)}
              >
                {icon} {label}
                {/* OceanBase Cloud 帮助图标 */}
                {type === "oceanbase-cloud" &&
                  currentDbType === "oceanbase-cloud" && (
                    <span className="help-icon-wrapper">
                      <button
                        ref={helpBtnRef}
                        className="help-icon-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowHelpTooltip(!showHelpTooltip);
                        }}
                        title="Connection Guide"
                      >
                        <HelpCircle size={14} />
                      </button>
                      {showHelpTooltip && (
                        <div ref={tooltipRef} className="help-tooltip">
                          <div className="tooltip-header">
                            <HelpCircle size={14} />
                            <span>OceanBase Cloud Connection Guide</span>
                          </div>
                          <div className="tooltip-content">
                            <div className="tooltip-step">
                              <span className="step-num">1</span>
                              <div>
                                <strong>Get Connection Info</strong>
                                <p>
                                  Log in to OceanBase Cloud console and get the
                                  Host and Port from the instance details page.
                                </p>
                              </div>
                            </div>
                            <div className="tooltip-step">
                              <span className="step-num">2</span>
                              <div>
                                <strong>Configure Username</strong>
                                <p>
                                  Username format: <code>username@tenant</code>{" "}
                                  (e.g., <code>root@tenant1</code>). Or fill
                                  Username and Tenant fields separately.
                                </p>
                              </div>
                            </div>
                            <div className="tooltip-step">
                              <span className="step-num">3</span>
                              <div>
                                <strong>Network Configuration</strong>
                                <p>
                                  Ensure network access to OceanBase Cloud.
                                  Configure PrivateLink, VPC, or IP allowlist if
                                  needed.
                                </p>
                              </div>
                            </div>
                          </div>
                          <div className="tooltip-links">
                            <button
                              className="tooltip-link"
                              onClick={() =>
                                openExternalLink(
                                  "https://en.oceanbase.com/docs/common-oceanbase-cloud-10000000000768633",
                                )
                              }
                            >
                              <ExternalLink size={12} />
                              Documentation
                            </button>
                            <button
                              className="tooltip-link"
                              onClick={() =>
                                openExternalLink(
                                  "https://en.oceanbase.com/docs/common-oceanbase-cloud-1000000001817313",
                                )
                              }
                            >
                              <ExternalLink size={12} />
                              MySQL Guide
                            </button>
                          </div>
                        </div>
                      )}
                    </span>
                  )}
              </button>
            ))}
          </div>
        </div>

        <div className="config-tabs">
          <button
            className={`config-tab ${
              currentConfigTab === "main" ? "active" : ""
            }`}
            onClick={() => setCurrentConfigTab("main")}
          >
            <Settings size={14} /> Main
          </button>
          <button
            className={`config-tab ${
              currentConfigTab === "ssh" ? "active" : ""
            }`}
            onClick={() => setCurrentConfigTab("ssh")}
          >
            <KeyRound size={14} /> SSH
          </button>
          <button
            className={`config-tab ${
              currentConfigTab === "socks" ? "active" : ""
            }`}
            onClick={() => setCurrentConfigTab("socks")}
          >
            <Network size={14} /> Socks Proxy
          </button>
          <button
            className={`config-tab ${
              currentConfigTab === "http" ? "active" : ""
            }`}
            onClick={() => setCurrentConfigTab("http")}
          >
            <Globe size={14} /> HTTP Proxy
          </button>
        </div>

        {currentConfigTab === "main" && (
          <div id="mainConfig" className="form-section">
            <div className="form-row">
              <div className="form-group">
                <label className="required">Host</label>
                <input
                  type="text"
                  id="host"
                  placeholder="127.0.0.1"
                  value={formData.host}
                  onChange={(e) => handleInputChange("host", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="required">Port</label>
                <div className="port-control">
                  <button
                    className="port-btn"
                    onClick={() => handlePortChange(-1)}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    id="port"
                    placeholder="2881"
                    value={formData.port}
                    onChange={(e) =>
                      handleInputChange("port", parseInt(e.target.value) || 0)
                    }
                  />
                  <button
                    className="port-btn"
                    onClick={() => handlePortChange(1)}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="required">Username</label>
                <input
                  type="text"
                  id="user"
                  placeholder="root"
                  value={formData.user}
                  onChange={(e) => handleInputChange("user", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="required">Password</label>
                <input
                  type="password"
                  id="password"
                  placeholder="Password"
                  value={formData.password}
                  onChange={(e) =>
                    handleInputChange("password", e.target.value)
                  }
                />
              </div>
            </div>

            {showTenant && (
              <div className="form-row" id="tenantRow">
                <div className="form-group">
                  <label>Tenant</label>
                  <input
                    type="text"
                    id="tenant"
                    placeholder="sys"
                    value={formData.tenant}
                    onChange={(e) =>
                      handleInputChange("tenant", e.target.value)
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Database</label>
                  <input
                    type="text"
                    id="database"
                    placeholder="Database"
                    value={formData.database}
                    onChange={(e) =>
                      handleInputChange("database", e.target.value)
                    }
                  />
                </div>
              </div>
            )}

            <div className="toggle-row">
              <div className="toggle-item">
                <label>Use Connection String</label>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    id="useConnectionString"
                    checked={formData.useConnectionString}
                    onChange={(e) =>
                      handleInputChange("useConnectionString", e.target.checked)
                    }
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
              <div className="toggle-item">
                <label>SSL</label>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    id="ssl"
                    checked={formData.ssl}
                    onChange={(e) => handleInputChange("ssl", e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>
        )}

        {currentConfigTab === "ssh" && (
          <div id="sshConfig" className="form-section">
            <div className="form-row">
              <div className="form-group">
                <label>SSH Host</label>
                <input
                  type="text"
                  id="sshHost"
                  placeholder="SSH host address"
                  value={formData.sshHost}
                  onChange={(e) => handleInputChange("sshHost", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>SSH Port</label>
                <input
                  type="number"
                  id="sshPort"
                  placeholder="22"
                  value={formData.sshPort}
                  onChange={(e) =>
                    handleInputChange("sshPort", parseInt(e.target.value) || 22)
                  }
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>SSH Username</label>
                <input
                  type="text"
                  id="sshUser"
                  placeholder="SSH username"
                  value={formData.sshUser}
                  onChange={(e) => handleInputChange("sshUser", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>SSH Password / Key</label>
                <input
                  type="password"
                  id="sshPassword"
                  placeholder="SSH password or key path"
                  value={formData.sshPassword}
                  onChange={(e) =>
                    handleInputChange("sshPassword", e.target.value)
                  }
                />
              </div>
            </div>
          </div>
        )}

        {currentConfigTab === "socks" && (
          <div id="socksConfig" className="form-section">
            <div className="form-row">
              <div className="form-group">
                <label>Proxy Host</label>
                <input
                  type="text"
                  placeholder="Proxy server address"
                  value={formData.socksHost}
                  onChange={(e) =>
                    handleInputChange("socksHost", e.target.value)
                  }
                />
              </div>
              <div className="form-group">
                <label>Proxy Port</label>
                <input
                  type="number"
                  placeholder="1080"
                  value={formData.socksPort}
                  onChange={(e) =>
                    handleInputChange(
                      "socksPort",
                      parseInt(e.target.value) || 1080,
                    )
                  }
                />
              </div>
            </div>
          </div>
        )}

        {currentConfigTab === "http" && (
          <div id="httpConfig" className="form-section">
            <div className="form-row single">
              <div className="form-group">
                <label>HTTP Proxy URL</label>
                <input
                  type="text"
                  placeholder="http://proxy:port"
                  value={formData.httpProxyUrl}
                  onChange={(e) =>
                    handleInputChange("httpProxyUrl", e.target.value)
                  }
                />
              </div>
            </div>
          </div>
        )}

        <div className="action-buttons">
          <button className="btn btn-secondary" onClick={handleSave}>
            <Save size={14} /> Save
          </button>
          <button className="btn btn-secondary" onClick={handleTestConnection}>
            <PlugZap size={14} /> Test Connection
          </button>
          <button className="btn btn-success" onClick={handleConnect}>
            <PlugZap size={14} /> Connect
          </button>
          <button className="btn btn-secondary" onClick={handleClose}>
            <X size={14} /> Close
          </button>
        </div>

        {message && (
          <div className={`message-toast ${message.type}`}>{message.text}</div>
        )}

        {loading && (
          <div className="loading-overlay">
            <div className="loading-spinner"></div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectPage;
