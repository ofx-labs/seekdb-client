import * as vscode from "vscode";
import { ExtensionManager } from "./core/ExtensionManager.js";

// 全局扩展管理器实例
let extensionManager: ExtensionManager;

export async function activate(context: vscode.ExtensionContext) {
  try {
    // 创建扩展管理器
    extensionManager = new ExtensionManager(context);

    // 激活扩展
    await extensionManager.activate();
  } catch (error) {
    vscode.window.showErrorMessage(`seekdb-client 扩展激活失败: ${error}`);
  }
}

export function deactivate() {
  if (extensionManager) {
    extensionManager.deactivate();
  }
}
