/**
 * 系统检查器 - 检查操作系统和芯片类型
 */

import * as os from "os";
import { IPreflightChecker, CheckResult } from "../types";

export class SystemCheck implements IPreflightChecker {
  id = "system";
  name = "操作系统与芯片检查";

  async check(): Promise<CheckResult> {
    const platform = os.platform();
    const arch = os.arch();
    const release = os.release();

    // 支持的平台
    const supportedPlatforms = ["darwin", "linux", "win32"];
    const supportedArch = ["x64", "arm64"];

    // 获取平台友好名称
    const platformNames: Record<string, string> = {
      darwin: "macOS",
      linux: "Linux",
      win32: "Windows",
    };

    // 获取架构友好名称
    const archNames: Record<string, string> = {
      x64: "Intel/AMD 64-bit",
      arm64: "ARM 64-bit (Apple Silicon/ARM)",
      ia32: "Intel 32-bit",
      arm: "ARM 32-bit",
    };

    const details = {
      platform,
      platformName: platformNames[platform] || platform,
      arch,
      archName: archNames[arch] || arch,
      release,
      cpuModel: os.cpus()[0]?.model || "Unknown",
      cpuCores: os.cpus().length,
      totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
      freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
      hostname: os.hostname(),
      homeDir: os.homedir(),
    };

    // 检查平台支持
    if (!supportedPlatforms.includes(platform)) {
      return {
        id: this.id,
        name: this.name,
        status: "error",
        message: `不支持的操作系统: ${platform}`,
        details,
        suggestion: "SeekDB 目前支持 macOS, Linux 和 Windows",
      };
    }

    // 检查架构支持
    if (!supportedArch.includes(arch)) {
      return {
        id: this.id,
        name: this.name,
        status: "warning",
        message: `芯片架构 ${arch} 可能存在兼容性问题`,
        details,
        suggestion: "建议使用 x64 或 arm64 架构",
      };
    }

    // Apple Silicon 特殊提示
    if (platform === "darwin" && arch === "arm64") {
      return {
        id: this.id,
        name: this.name,
        status: "success",
        message: `${platformNames[platform]} - Apple Silicon (${archNames[arch]})`,
        details,
      };
    }

    // Intel Mac
    if (platform === "darwin" && arch === "x64") {
      return {
        id: this.id,
        name: this.name,
        status: "success",
        message: `${platformNames[platform]} - Intel (${archNames[arch]})`,
        details,
      };
    }

    return {
      id: this.id,
      name: this.name,
      status: "success",
      message: `${platformNames[platform] || platform} (${
        archNames[arch] || arch
      })`,
      details,
    };
  }
}
