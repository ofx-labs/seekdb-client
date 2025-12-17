/**
 * 预检查服务 - 管理所有环境检查
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
    // 初始化状态栏项
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = "seekdb.showPreflightReport";
    this.context.subscriptions.push(this.statusBarItem);

    // 初始化输出通道
    this.outputChannel = vscode.window.createOutputChannel("SeekDB 环境检查");
    this.context.subscriptions.push(this.outputChannel);

    // 注册所有检查器
    this.registerCheckers();
  }

  /**
   * 注册所有检查器
   */
  private registerCheckers(): void {
    const config = this.getConfig();

    this.checkers = [
      // 系统检查始终执行
      new SystemCheck(),
    ];

    // 根据配置添加可选检查器
    if (config.checkDocker) {
      this.checkers.push(new DockerCheck());
    }

    if (config.checkSeekDBImage) {
      this.checkers.push(new SeekDBImageCheck());
    }

    if (config.checkSeekDBInstance) {
      this.checkers.push(new SeekDBInstanceCheck());
    }

    // SDK 版本检查始终执行
    this.checkers.push(new SDKVersionCheck(this.context));
  }

  /**
   * 获取预检查配置
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
   * 获取系统信息
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
   * 运行所有预检查
   */
  async runAllChecks(showProgress: boolean = true): Promise<PreflightReport> {
    const startTime = Date.now();
    const results: CheckResult[] = [];

    // 重新注册检查器（配置可能已更改）
    this.registerCheckers();

    if (showProgress) {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "SeekDB 环境检查",
          cancellable: false,
        },
        async (progress) => {
          const total = this.checkers.length;
          for (let i = 0; i < this.checkers.length; i++) {
            const checker = this.checkers[i];
            progress.report({
              increment: 100 / total,
              message: `正在检查: ${checker.name}...`,
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
                message: `检查失败: ${errorMsg}`,
              });
            }
          }
        }
      );
    } else {
      // 静默检查
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
            message: `检查失败: ${errorMsg}`,
          });
        }
      }
    }

    // 计算总体状态
    const overallStatus = this.calculateOverallStatus(results);

    this.report = {
      timestamp: new Date(),
      duration: Date.now() - startTime,
      system: this.getSystemInfo(),
      checks: results,
      overallStatus,
    };

    // 更新状态栏
    this.updateStatusBar(overallStatus);

    // 缓存报告
    await this.cacheReport();

    return this.report;
  }

  /**
   * 计算总体状态
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
   * 更新状态栏显示
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
      success: "就绪",
      warning: "警告",
      error: "错误",
      info: "信息",
      skipped: "跳过",
    };

    this.statusBarItem.text = `${icons[status]} SeekDB`;
    this.statusBarItem.tooltip = `SeekDB 环境状态: ${statusText[status]}\n点击查看详细报告`;

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
   * 缓存检查报告
   */
  private async cacheReport(): Promise<void> {
    if (this.report) {
      // 转换 Date 为 ISO 字符串以便序列化
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
   * 获取缓存的报告
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
   * 获取最新报告
   */
  getReport(): PreflightReport | null {
    return this.report;
  }

  /**
   * 显示报告面板
   */
  async showReportPanel(): Promise<void> {
    const report = this.report || this.getCachedReport();
    if (!report) {
      const action = await vscode.window.showInformationMessage(
        "暂无检查报告，是否立即运行检查？",
        "运行检查",
        "取消"
      );
      if (action === "运行检查") {
        await this.runAllChecks();
        await this.showReportPanel();
      }
      return;
    }

    this.outputChannel.clear();
    this.outputChannel.appendLine(
      "═══════════════════════════════════════════════════════════════"
    );
    this.outputChannel.appendLine("                    SeekDB 环境预检查报告");
    this.outputChannel.appendLine(
      "═══════════════════════════════════════════════════════════════"
    );
    this.outputChannel.appendLine("");
    this.outputChannel.appendLine(
      `📅 检查时间: ${report.timestamp.toLocaleString()}`
    );
    this.outputChannel.appendLine(`⏱️  耗时: ${report.duration}ms`);
    this.outputChannel.appendLine("");
    this.outputChannel.appendLine(
      "───────────────────────────────────────────────────────────────"
    );
    this.outputChannel.appendLine("                        系统信息");
    this.outputChannel.appendLine(
      "───────────────────────────────────────────────────────────────"
    );
    this.outputChannel.appendLine(
      `  🖥️  操作系统: ${this.getPlatformName(report.system.os.platform)} ${
        report.system.os.release
      }`
    );
    this.outputChannel.appendLine(
      `  💻 芯片架构: ${this.getArchName(report.system.os.arch)}`
    );
    this.outputChannel.appendLine(
      `  📦 Node 版本: ${report.system.node.version}`
    );
    this.outputChannel.appendLine(
      `  🔷 VS Code 版本: ${report.system.vscode.version}`
    );
    this.outputChannel.appendLine("");
    this.outputChannel.appendLine(
      "───────────────────────────────────────────────────────────────"
    );
    this.outputChannel.appendLine("                        检查结果");
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
      success: "通过",
      warning: "警告",
      error: "错误",
      info: "信息",
      skipped: "跳过",
    };

    for (const check of report.checks) {
      this.outputChannel.appendLine("");
      this.outputChannel.appendLine(
        `  ${statusIcons[check.status]} ${check.name}`
      );
      this.outputChannel.appendLine(`     状态: ${statusNames[check.status]}`);
      this.outputChannel.appendLine(`     消息: ${check.message}`);

      if (check.suggestion) {
        this.outputChannel.appendLine(`     💡 建议: ${check.suggestion}`);
      }

      if (check.actionUrl) {
        this.outputChannel.appendLine(`     🔗 链接: ${check.actionUrl}`);
      }

      if (check.details) {
        this.outputChannel.appendLine(`     📋 详情:`);
        this.formatDetails(check.details, "        ");
      }
    }

    this.outputChannel.appendLine("");
    this.outputChannel.appendLine(
      "═══════════════════════════════════════════════════════════════"
    );
    this.outputChannel.appendLine(
      `                总体状态: ${
        statusIcons[report.overallStatus]
      } ${statusNames[report.overallStatus].toUpperCase()}`
    );
    this.outputChannel.appendLine(
      "═══════════════════════════════════════════════════════════════"
    );

    this.outputChannel.show();
  }

  /**
   * 格式化详情输出
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
   * 获取平台友好名称
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
   * 获取架构友好名称
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
   * 隐藏状态栏
   */
  hideStatusBar(): void {
    this.statusBarItem.hide();
  }

  /**
   * 显示状态栏
   */
  showStatusBar(): void {
    this.statusBarItem.show();
  }

  /**
   * 销毁服务
   */
  dispose(): void {
    this.statusBarItem.dispose();
    this.outputChannel.dispose();
  }
}
