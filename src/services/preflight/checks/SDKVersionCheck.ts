/**
 * SeekDB SDK Version Checker
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import { IPreflightChecker, CheckResult } from "../types";

export class SDKVersionCheck implements IPreflightChecker {
  id = "sdk-version";
  name = "SDK Version Check";

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Get latest version from npm registry
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
   * Compare version numbers
   */
  private compareVersions(v1: string, v2: string): number {
    // Clean version number prefixes
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
      // Read extension package.json to get current SDK version
      const extensionPackagePath = path.join(
        this.context.extensionPath,
        "package.json"
      );

      if (!fs.existsSync(extensionPackagePath)) {
        return {
          id: this.id,
          name: this.name,
          status: "warning",
          message: "Unable to read extension config file",
        };
      }

      const packageJson = JSON.parse(
        fs.readFileSync(extensionPackagePath, "utf-8")
      );
      const installedVersion = packageJson.dependencies?.seekdb || "unknown";
      const extensionVersion = packageJson.version || "unknown";

      // Try to get latest version
      const latestVersion = await this.getLatestVersion();

      const details: Record<string, any> = {
        installedVersion,
        extensionVersion,
        extensionName: packageJson.displayName || packageJson.name,
      };

      if (latestVersion) {
        details.latestVersion = latestVersion;

        // Compare versions
        const installedClean = installedVersion.replace(/[\^~>=<]/g, "");
        const comparison = this.compareVersions(installedClean, latestVersion);

        if (comparison < 0) {
          return {
            id: this.id,
            name: this.name,
            status: "info",
            message: `SDK Version: ${installedVersion} (Latest: ${latestVersion})`,
            details,
            suggestion:
              "New version available, consider updating for latest features",
          };
        }

        return {
          id: this.id,
          name: this.name,
          status: "success",
          message: `SDK Version: ${installedVersion} (Up to date)`,
          details,
        };
      }

      // Unable to get latest version info
      return {
        id: this.id,
        name: this.name,
        status: "success",
        message: `SDK Version: ${installedVersion}`,
        details,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        id: this.id,
        name: this.name,
        status: "warning",
        message: `Unable to get SDK version info: ${errorMsg}`,
      };
    }
  }
}
