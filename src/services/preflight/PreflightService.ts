/**
 * Preflight Service - Manages all environment checks
 */

import * as vscode from "vscode";
import * as os from "os";
import {
  PreflightReport,
  CheckResult,
  CheckStatus,
  SystemInfo,
  IPreflightChecker,
  PreflightConfig,
} from "./types";
import {
  SystemCheck,
  DockerCheck,
  SeekDBImageCheck,
  SeekDBInstanceCheck,
  SDKVersionCheck,
} from "./checks";

export class PreflightService {
  private checkers: IPreflightChecker[] = [];
  private report: PreflightReport | null = null;
  private statusBarItem: vscode.StatusBarItem;
  private outputChannel: vscode.OutputChannel;

  constructor(private context: vscode.ExtensionContext) {
    // Initialize status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = "seekdb.showPreflightReport";
    this.context.subscriptions.push(this.statusBarItem);

    // Initialize output channel
    this.outputChannel = vscode.window.createOutputChannel("SeekDB Preflight");
    this.context.subscriptions.push(this.outputChannel);

    // Register all checkers
    this.registerCheckers();
  }

  /**
   * Register all checkers
   */
  private registerCheckers(): void {
    const config = this.getConfig();

    this.checkers = [
      // System check always runs
      new SystemCheck(),
    ];

    // Add optional checkers based on config
    if (config.checkDocker) {
      this.checkers.push(new DockerCheck());
    }

    if (config.checkSeekDBImage) {
      this.checkers.push(new SeekDBImageCheck());
    }

    if (config.checkSeekDBInstance) {
      this.checkers.push(new SeekDBInstanceCheck());
    }

    // SDK version check always runs
    this.checkers.push(new SDKVersionCheck(this.context));
  }

  /**
   * Get preflight configuration
   */
  private getConfig(): PreflightConfig {
    const config = vscode.workspace.getConfiguration("seekdb.preflight");
    return {
      enabled: config.get<boolean>("enabled", true),
      showProgress: config.get<boolean>("showProgress", true),
      checkDocker: config.get<boolean>("checkDocker", true),
      checkSeekDBImage: config.get<boolean>("checkSeekDBImage", true),
      checkSeekDBInstance: config.get<boolean>("checkSeekDBInstance", true),
    };
  }

  /**
   * Get system information
   */
  private getSystemInfo(): SystemInfo {
    return {
      os: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
      },
      node: {
        version: process.version,
      },
      vscode: {
        version: vscode.version,
      },
    };
  }

  /**
   * Run all preflight checks
   */
  async runAllChecks(showProgress: boolean = true): Promise<PreflightReport> {
    const startTime = Date.now();
    const results: CheckResult[] = [];

    // Re-register checkers (config may have changed)
    this.registerCheckers();

    if (showProgress) {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "SeekDB Preflight Check",
          cancellable: false,
        },
        async (progress) => {
          const total = this.checkers.length;
          for (let i = 0; i < this.checkers.length; i++) {
            const checker = this.checkers[i];
            progress.report({
              increment: 100 / total,
              message: `Checking: ${checker.name}...`,
            });

            try {
              const result = await checker.check();
              results.push(result);
            } catch (error) {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              results.push({
                id: checker.id,
                name: checker.name,
                status: "error",
                message: `Check failed: ${errorMsg}`,
              });
            }
          }
        }
      );
    } else {
      // Silent check
      for (const checker of this.checkers) {
        try {
          const result = await checker.check();
          results.push(result);
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          results.push({
            id: checker.id,
            name: checker.name,
            status: "error",
            message: `Check failed: ${errorMsg}`,
          });
        }
      }
    }

    // Calculate overall status
    const overallStatus = this.calculateOverallStatus(results);

    this.report = {
      timestamp: new Date(),
      duration: Date.now() - startTime,
      system: this.getSystemInfo(),
      checks: results,
      overallStatus,
    };

    // Update status bar
    this.updateStatusBar(overallStatus);

    // Cache report
    await this.cacheReport();

    return this.report;
  }

  /**
   * Calculate overall status
   */
  private calculateOverallStatus(results: CheckResult[]): CheckStatus {
    if (results.some((r) => r.status === "error")) {
      return "error";
    }
    if (results.some((r) => r.status === "warning")) {
      return "warning";
    }
    return "success";
  }

  /**
   * Update status bar display
   */
  private updateStatusBar(status: CheckStatus): void {
    const icons: Record<CheckStatus, string> = {
      success: "$(check)",
      warning: "$(warning)",
      error: "$(error)",
      info: "$(info)",
      skipped: "$(circle-slash)",
    };

    const statusText: Record<CheckStatus, string> = {
      success: "Ready",
      warning: "Warning",
      error: "Error",
      info: "Info",
      skipped: "Skipped",
    };

    this.statusBarItem.text = `${icons[status]} SeekDB`;
    this.statusBarItem.tooltip = `SeekDB Status: ${statusText[status]}\nClick to view report`;

    // 设置背景色
    if (status === "error") {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground"
      );
    } else if (status === "warning") {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
    } else {
      this.statusBarItem.backgroundColor = undefined;
    }

    this.statusBarItem.show();
  }

  /**
   * Cache check report
   */
  private async cacheReport(): Promise<void> {
    if (this.report) {
      // Convert Date to ISO string for serialization
      const serializedReport = {
        ...this.report,
        timestamp: this.report.timestamp.toISOString(),
      };
      await this.context.globalState.update(
        "preflightReport",
        serializedReport
      );
    }
  }

  /**
   * Get cached report
   */
  getCachedReport(): PreflightReport | null {
    const cached = this.context.globalState.get<any>("preflightReport");
    if (cached) {
      return {
        ...cached,
        timestamp: new Date(cached.timestamp),
      };
    }
    return null;
  }

  /**
   * Get latest report
   */
  getReport(): PreflightReport | null {
    return this.report;
  }

  /**
   * Show report panel
   */
  async showReportPanel(): Promise<void> {
    const report = this.report || this.getCachedReport();
    if (!report) {
      const action = await vscode.window.showInformationMessage(
        "No check report available. Run check now?",
        "Run Check",
        "Cancel"
      );
      if (action === "Run Check") {
        await this.runAllChecks();
        await this.showReportPanel();
      }
      return;
    }

    this.outputChannel.clear();
    this.outputChannel.appendLine(
      "═══════════════════════════════════════════════════════════════"
    );
    this.outputChannel.appendLine(
      "                    SeekDB Preflight Report"
    );
    this.outputChannel.appendLine(
      "═══════════════════════════════════════════════════════════════"
    );
    this.outputChannel.appendLine("");
    this.outputChannel.appendLine(
      `📅 Check Time: ${report.timestamp.toLocaleString()}`
    );
    this.outputChannel.appendLine(`⏱️  Duration: ${report.duration}ms`);
    this.outputChannel.appendLine("");
    this.outputChannel.appendLine(
      "───────────────────────────────────────────────────────────────"
    );
    this.outputChannel.appendLine("                      System Information");
    this.outputChannel.appendLine(
      "───────────────────────────────────────────────────────────────"
    );
    this.outputChannel.appendLine(
      `  🖥️  OS: ${this.getPlatformName(report.system.os.platform)} ${
        report.system.os.release
      }`
    );
    this.outputChannel.appendLine(
      `  💻 Architecture: ${this.getArchName(report.system.os.arch)}`
    );
    this.outputChannel.appendLine(
      `  📦 Node Version: ${report.system.node.version}`
    );
    this.outputChannel.appendLine(
      `  🔷 VS Code Version: ${report.system.vscode.version}`
    );
    this.outputChannel.appendLine("");
    this.outputChannel.appendLine(
      "───────────────────────────────────────────────────────────────"
    );
    this.outputChannel.appendLine("                        Check Results");
    this.outputChannel.appendLine(
      "───────────────────────────────────────────────────────────────"
    );

    const statusIcons: Record<CheckStatus, string> = {
      success: "✅",
      warning: "⚠️",
      error: "❌",
      info: "ℹ️",
      skipped: "⏭️",
    };

    const statusNames: Record<CheckStatus, string> = {
      success: "Passed",
      warning: "Warning",
      error: "Error",
      info: "Info",
      skipped: "Skipped",
    };

    for (const check of report.checks) {
      this.outputChannel.appendLine("");
      this.outputChannel.appendLine(
        `  ${statusIcons[check.status]} ${check.name}`
      );
      this.outputChannel.appendLine(
        `     Status: ${statusNames[check.status]}`
      );
      this.outputChannel.appendLine(`     Message: ${check.message}`);

      if (check.suggestion) {
        this.outputChannel.appendLine(
          `     💡 Suggestion: ${check.suggestion}`
        );
      }

      if (check.actionUrl) {
        this.outputChannel.appendLine(`     🔗 Link: ${check.actionUrl}`);
      }

      if (check.details) {
        this.outputChannel.appendLine(`     📋 Details:`);
        this.formatDetails(check.details, "        ");
      }
    }

    this.outputChannel.appendLine("");
    this.outputChannel.appendLine(
      "═══════════════════════════════════════════════════════════════"
    );
    this.outputChannel.appendLine(
      `                Overall Status: ${
        statusIcons[report.overallStatus]
      } ${statusNames[report.overallStatus].toUpperCase()}`
    );
    this.outputChannel.appendLine(
      "═══════════════════════════════════════════════════════════════"
    );

    this.outputChannel.show();
  }

  /**
   * Format details output
   */
  private formatDetails(details: Record<string, any>, indent: string): void {
    for (const [key, value] of Object.entries(details)) {
      if (Array.isArray(value)) {
        this.outputChannel.appendLine(`${indent}${key}:`);
        for (const item of value) {
          if (typeof item === "object") {
            this.outputChannel.appendLine(
              `${indent}  - ${JSON.stringify(item)}`
            );
          } else {
            this.outputChannel.appendLine(`${indent}  - ${item}`);
          }
        }
      } else if (typeof value === "object" && value !== null) {
        this.outputChannel.appendLine(`${indent}${key}:`);
        this.formatDetails(value, indent + "  ");
      } else {
        this.outputChannel.appendLine(`${indent}${key}: ${value}`);
      }
    }
  }

  /**
   * Get platform friendly name
   */
  private getPlatformName(platform: string): string {
    const names: Record<string, string> = {
      darwin: "macOS",
      linux: "Linux",
      win32: "Windows",
    };
    return names[platform] || platform;
  }

  /**
   * Get architecture friendly name
   */
  private getArchName(arch: string): string {
    const names: Record<string, string> = {
      x64: "x64 (Intel/AMD 64-bit)",
      arm64: "arm64 (Apple Silicon/ARM)",
      ia32: "x86 (32-bit)",
      arm: "ARM (32-bit)",
    };
    return names[arch] || arch;
  }

  /**
   * Hide status bar
   */
  hideStatusBar(): void {
    this.statusBarItem.hide();
  }

  /**
   * Show status bar
   */
  showStatusBar(): void {
    this.statusBarItem.show();
  }

  /**
   * Dispose service
   */
  dispose(): void {
    this.statusBarItem.dispose();
    this.outputChannel.dispose();
  }
}
