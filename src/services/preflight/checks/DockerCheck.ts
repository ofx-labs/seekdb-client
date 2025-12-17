/**
 * Docker 环境检查器
 */

import { exec } from "child_process";
import { promisify } from "util";
import { IPreflightChecker, CheckResult } from "../types";

const execAsync = promisify(exec);

export class DockerCheck implements IPreflightChecker {
  id = "docker";
  name = "Docker 环境检查";

  async check(): Promise<CheckResult> {
    try {
      // 检查 Docker 是否安装
      const { stdout: versionOutput } = await execAsync("docker --version", {
        timeout: 5000,
      });

      const dockerVersion = versionOutput.trim();

      // 检查 Docker 是否运行
      try {
        const { stdout: infoOutput } = await execAsync(
          'docker info --format "{{.ServerVersion}}"',
          {
            timeout: 10000,
          }
        );

        const serverVersion = infoOutput.trim();

        // 获取更多 Docker 信息
        let dockerInfo: Record<string, string> = {};
        try {
          const { stdout: osType } = await execAsync(
            'docker info --format "{{.OSType}}"',
            { timeout: 5000 }
          );
          const { stdout: osArch } = await execAsync(
            'docker info --format "{{.Architecture}}"',
            { timeout: 5000 }
          );
          dockerInfo = {
            osType: osType.trim(),
            architecture: osArch.trim(),
          };
        } catch {
          // 忽略获取额外信息失败
        }

        return {
          id: this.id,
          name: this.name,
          status: "success",
          message: "Docker 已安装并正在运行",
          details: {
            clientVersion: dockerVersion,
            serverVersion,
            ...dockerInfo,
          },
        };
      } catch (infoError) {
        return {
          id: this.id,
          name: this.name,
          status: "warning",
          message: "Docker 已安装但未运行",
          details: {
            clientVersion: dockerVersion,
          },
          suggestion: "请启动 Docker Desktop 或 Docker 服务",
          actionUrl: "https://docs.docker.com/get-docker/",
        };
      }
    } catch (error) {
      return {
        id: this.id,
        name: this.name,
        status: "info",
        message: "Docker 未安装",
        suggestion: "如需使用 Docker 部署 SeekDB，请先安装 Docker",
        actionUrl: "https://docs.docker.com/get-docker/",
      };
    }
  }
}
