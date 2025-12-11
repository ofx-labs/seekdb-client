import { createRoot } from "react-dom/client";
import ConnectPage from "../components/ConnectPage";

// 获取 VS Code API
declare function acquireVsCodeApi(): {
  postMessage: (message: any) => void;
};

// 声明全局配置类型
declare global {
  interface Window {
    __VSCODE_DEFAULT_CONFIG__?: {
      host: string;
      port: number;
      tenant: string;
      database: string;
      user: string;
      password: string;
    };
  }
}

const vscode = acquireVsCodeApi();

// 从注入的配置或默认值获取配置
const defaultConfig = window.__VSCODE_DEFAULT_CONFIG__ || {
  host: "127.0.0.1",
  port: 2881,
  tenant: "sys",
  database: "test",
  user: "root",
  password: "",
};

const root = createRoot(document.getElementById("root")!);
root.render(<ConnectPage vscode={vscode} defaultConfig={defaultConfig} />);
