import * as vscode from "vscode";
import { FfProvider } from "../providers/FfProvider.js";

export class ViewManager {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * 注册所有视图
   */
  public registerAllViews(ffProvider: FfProvider): void {
    this.registerWebviewProvider(ffProvider);
  }

  /**
   * 注册WebView提供器
   */
  private registerWebviewProvider(ffProvider: FfProvider): void {
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        "seekdb.webviewProvider",
        ffProvider,
        {
          webviewOptions: { retainContextWhenHidden: true },
        }
      )
    );
  }
}
