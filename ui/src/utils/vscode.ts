/* eslint-disable no-undef */
/// <reference lib="dom" />
import { WebviewMessage } from "../types/WebviewMessage";
import type { WebviewApi } from "vscode-webview";

/**
 * A utility wrapper around the acquireVsCodeApi() function, which enables
 * message passing and state management between the webview and extension
 * contexts.
 *
 * This utility also enables webview code to be run in a web browser-based
 * dev server by using native web browser features that mock the functionality
 * enabled by acquireVsCodeApi.
 */
class VSCodeAPIWrapper {
  private readonly vsCodeApi: WebviewApi<unknown> | undefined;

  constructor() {
    // Check if the acquireVsCodeApi function exists in the current development
    // context (i.e. VS Code development window or web browser)
    if (
      typeof window !== "undefined" &&
      // @ts-ignore
      typeof window.acquireVsCodeApi === "function"
    ) {
      // @ts-ignore
      this.vsCodeApi = window.acquireVsCodeApi();
    }
  }

  /**
   * Post a message to the owner of the webview.
   *
   * @param message The message to post
   */
  public postMessage(message: WebviewMessage) {
    if (this.vsCodeApi) {
      console.log("VSCode API发送消息:", message);
      try {
        this.vsCodeApi.postMessage(message);
      } catch (error) {
        console.error("发送消息失败:", error);
      }
    } else {
      // 如果在浏览器环境中，只记录消息
      console.log("浏览器环境中接收到消息:", message);
    }
  }

  /**
   * Get the persistent state stored for this webview.
   *
   * @returns The current state
   */
  public getState(): unknown | undefined {
    if (this.vsCodeApi) {
      return this.vsCodeApi.getState();
    } else {
      // 检查 localStorage 是否存在（在浏览器环境中）
      if (typeof window !== "undefined" && window.localStorage) {
        const state = window.localStorage.getItem("vscodeState");
        return state ? JSON.parse(state) : undefined;
      }
      return undefined;
    }
  }

  /**
   * Set the persistent state stored for this webview.
   *
   * @param newState The new state to set
   * @returns The new state
   */
  public setState<T extends unknown | undefined>(newState: T): T {
    if (this.vsCodeApi) {
      this.vsCodeApi.setState(newState);
      return newState;
    } else {
      // 检查 localStorage 是否存在（在浏览器环境中）
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("vscodeState", JSON.stringify(newState));
      }
      return newState;
    }
  }
}

// Export a singleton instance of the API wrapper
export const vscode = new VSCodeAPIWrapper();
