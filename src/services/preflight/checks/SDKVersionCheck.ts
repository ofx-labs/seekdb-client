/**
 * SeekDB SDK 版本检查器
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import { IPreflightChecker, CheckResult } from "../types";

export class SDKVersionCheck implements IPreflightChecker {
  id = "sdk-version";
  name = "SeekDB SDK 版本检查";

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * 从 npm registry 获取最新版本
   */
  private async getLatestVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      const options = {
        hostname: "registry.npmjs.org",
        port: 443,
        path: "/seekdb/latest",
        method: "GET",
        timeout: 5000,
        headers: {
          Accept: "application/json",
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const npmData = JSON.parse(data);
            resolve(npmData.version || null);
          } catch {
            resolve(null);
          }
        });
      });

      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });

      req.end();
    });
  }

  /**
   * 比较版本号
   */
  private compareVersions(v1: string, v2: string): number {
    // 清理版本号中的前缀符号
    const clean1 = v1.replace(/[\^~>=<]/g, "").split("-")[0];
    const clean2 = v2.replace(/[\^~>=<]/g, "").split("-")[0];

    const parts1 = clean1.split(".").map(Number);
    const parts2 = clean2.split(".").map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  async check(): Promise<CheckResult> {
    try {
      // 读取扩展的 package.json 获取当前使用的 SDK 版本
      const extensionPackagePath = path.join(
        this.context.extensionPath,
        "package.json"
      );

      if (!fs.existsSync(extensionPackagePath)) {
        return {
          id: this.id,
          name: this.name,
          status: "warning",
          message: "无法读取扩展配置文件",
        };
      }

      const packageJson = JSON.parse(
        fs.readFileSync(extensionPackagePath, "utf-8")
      );
      const installedVersion = packageJson.dependencies?.seekdb || "unknown";
      const extensionVersion = packageJson.version || "unknown";

      // 尝试获取最新版本
      const latestVersion = await this.getLatestVersion();

      const details: Record<string, any> = {
        installedVersion,
        extensionVersion,
        extensionName: packageJson.displayName || packageJson.name,
      };

      if (latestVersion) {
        details.latestVersion = latestVersion;

        // 比较版本
        const installedClean = installedVersion.replace(/[\^~>=<]/g, "");
        const comparison = this.compareVersions(installedClean, latestVersion);

        if (comparison < 0) {
          return {
            id: this.id,
            name: this.name,
            status: "info",
            message: `SDK 版本: ${installedVersion} (最新: ${latestVersion})`,
            details,
            suggestion: "有新版本可用，建议更新扩展以获取最新功能",
          };
        }

        return {
          id: this.id,
          name: this.name,
          status: "success",
          message: `SDK 版本: ${installedVersion} (已是最新)`,
          details,
        };
      }

      // 无法获取最新版本信息
      return {
        id: this.id,
        name: this.name,
        status: "success",
        message: `SDK 版本: ${installedVersion}`,
        details,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        id: this.id,
        name: this.name,
        status: "warning",
        message: `无法获取 SDK 版本信息: ${errorMsg}`,
      };
    }
  }
}
