/**
 * System Checker - Check OS and CPU architecture
 */

import * as os from "os";
import { IPreflightChecker, CheckResult } from "../types";

export class SystemCheck implements IPreflightChecker {
  id = "system";
  name = "System Check";

  async check(): Promise<CheckResult> {
    const platform = os.platform();
    const arch = os.arch();
    const release = os.release();

    // Supported platforms
    const supportedPlatforms = ["darwin", "linux", "win32"];
    const supportedArch = ["x64", "arm64"];

    // Get platform friendly names
    const platformNames: Record<string, string> = {
      darwin: "macOS",
      linux: "Linux",
      win32: "Windows",
    };

    // Get architecture friendly names
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

    // Check platform support
    if (!supportedPlatforms.includes(platform)) {
      return {
        id: this.id,
        name: this.name,
        status: "error",
        message: `Unsupported OS: ${platform}`,
        details,
        suggestion: "SeekDB currently supports macOS, Linux and Windows",
      };
    }

    // Check architecture support
    if (!supportedArch.includes(arch)) {
      return {
        id: this.id,
        name: this.name,
        status: "warning",
        message: `Architecture ${arch} may have compatibility issues`,
        details,
        suggestion: "Recommended to use x64 or arm64 architecture",
      };
    }

    // Apple Silicon special case
    if (platform === "darwin" && arch === "arm64") {
      return {
        id: this.id,
        name: this.name,
        status: "success",
        message: `${platformNames[platform]} - Apple Silicon (${archNames[arch]})`,
        details,
      };
    }

    // Intel Mac case
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
