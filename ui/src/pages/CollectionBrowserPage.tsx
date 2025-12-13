import { createRoot } from "react-dom/client";
import CollectionBrowserPage from "../components/CollectionBrowserPage";

// 获取 VS Code API
declare function acquireVsCodeApi(): {
  postMessage: (message: any) => void;
};

const vscode = acquireVsCodeApi();

// 从注入的配置获取连接信息
const connectionInfo = window.__VSCODE_CONNECTION_INFO__ || {
  name: "Unknown",
  host: "127.0.0.1",
  port: 2881,
  database: "test",
};

const isSeekDB = window.__VSCODE_IS_SEEKDB__ || false;

console.log('[CollectionBrowserPage Entry] connectionInfo:', connectionInfo);
console.log('[CollectionBrowserPage Entry] isSeekDB:', isSeekDB);

const root = createRoot(document.getElementById("root")!);
root.render(
  <CollectionBrowserPage
    vscode={vscode}
    connectionInfo={connectionInfo}
    isSeekDB={isSeekDB}
  />
);
