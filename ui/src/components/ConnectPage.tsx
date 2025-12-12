import React, { useState, useEffect } from "react";
import "./ConnectPage.css";

interface DefaultConfig {
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

type DbType = "seekdb" | "nero";
type ConfigTab = "main" | "ssh" | "socks" | "http";
type Scope = "advance" | "scope" | "global" | "workspace";

const ConnectPage: React.FC<ConnectPageProps> = ({ vscode, defaultConfig }) => {
  const [currentDbType, setCurrentDbType] = useState<DbType>("seekdb");
  const [currentConfigTab, setCurrentConfigTab] = useState<ConfigTab>("main");
  const [currentScope, setCurrentScope] = useState<Scope>("global");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // 表单状态
  const [formData, setFormData] = useState({
    connectionName: "",
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

  // 监听来自扩展的消息
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      setLoading(false);

      switch (msg.type) {
        case "connectionSuccess":
          showMessage("success", "连接成功！");
          break;
        case "connectionError":
          showMessage("error", msg.data?.error || "连接失败");
          break;
        case "testResult":
          showMessage(
            msg.data?.success ? "success" : "error",
            msg.data?.success ? "测试成功！" : "测试失败"
          );
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
      type: currentDbType,
      scope: currentScope,
      ...formData,
    };
  };

  const handleSave = () => {
    const data = getFormData();
    if (!data.connectionName) {
      showMessage("error", "请输入连接名称");
      return;
    }
    vscode.postMessage({ type: "save", data });
  };

  const handleConnect = () => {
    const data = getFormData();
    if (!data.host || !data.port) {
      showMessage("error", "请填写主机地址和端口");
      return;
    }
    setLoading(true);
    vscode.postMessage({ type: "connect", data });
  };

  const handleClose = () => {
    vscode.postMessage({ type: "close" });
  };

  const dbTypes: { type: DbType; label: string; icon: string }[] = [
    { type: "seekdb", label: "seekdb", icon: "🔍" },
    { type: "nero", label: "Nero", icon: "⚡" },
  ];

  const showTenant = currentDbType === "seekdb" || currentDbType === "nero";

  return (
    <div className="container">
      <div className="header">
        <div className="header-icon">🗄️</div>
        <div>
          <h1>Connect to Server</h1>
          <p>连接到 seekdb、Nero 或其他数据库服务器</p>
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
          ⚙️ Main
        </button>
        <button
          className={`config-tab ${currentConfigTab === "ssh" ? "active" : ""}`}
          onClick={() => setCurrentConfigTab("ssh")}
        >
          🔐 SSH
        </button>
        <button
          className={`config-tab ${
            currentConfigTab === "socks" ? "active" : ""
          }`}
          onClick={() => setCurrentConfigTab("socks")}
        >
          🧦 Socks Proxy
        </button>
        <button
          className={`config-tab ${
            currentConfigTab === "http" ? "active" : ""
          }`}
          onClick={() => setCurrentConfigTab("http")}
        >
          🌐 HTTP Proxy
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
                onChange={(e) => handleInputChange("password", e.target.value)}
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
                  onChange={(e) => handleInputChange("tenant", e.target.value)}
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
                placeholder="SSH 主机地址"
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
                placeholder="SSH 用户名"
                value={formData.sshUser}
                onChange={(e) => handleInputChange("sshUser", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>SSH Password / Key</label>
              <input
                type="password"
                id="sshPassword"
                placeholder="SSH 密码或密钥路径"
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
                placeholder="代理服务器地址"
                value={formData.socksHost}
                onChange={(e) => handleInputChange("socksHost", e.target.value)}
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
                    parseInt(e.target.value) || 1080
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
          💾 Save
        </button>
        <button className="btn btn-success" onClick={handleConnect}>
          ➕ Connect
        </button>
        <button className="btn btn-secondary" onClick={handleClose}>
          ✕ Close
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
  );
};

export default ConnectPage;
