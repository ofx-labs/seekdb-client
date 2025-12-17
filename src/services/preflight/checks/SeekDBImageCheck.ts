/**
 * SeekDB 镜像检查器
 */

import { exec } from "child_process";
import { promisify } from "util";
import { IPreflightChecker, CheckResult } from "../types";

const execAsync = promisify(exec);

// SeekDB 相关镜像模式
const SEEKDB_IMAGE_PATTERNS = [
  "seekdb/seekdb",
  "seekdb",
  "oceanbase/oceanbase-ce", // OceanBase 兼容
  "oceanbase",
];

export class SeekDBImageCheck implements IPreflightChecker {
  id = "seekdb-image";
  name = "SeekDB 镜像检查";

  async check(): Promise<CheckResult> {
    // 首先检查 Docker 是否可用
    try {
      await execAsync("docker info", { timeout: 5000 });
    } catch {
      return {
        id: this.id,
        name: this.name,
        status: "skipped",
        message: "Docker 不可用，跳过镜像检查",
        suggestion: "请先安装并启动 Docker",
      };
    }

    try {
      // 获取所有镜像
      const { stdout } = await execAsync(
        'docker images --format "{{.Repository}}:{{.Tag}}|{{.Size}}|{{.CreatedSince}}"',
        {
          timeout: 10000,
        }
      );

      const lines = stdout.trim().split("\n").filter(Boolean);

      // 查找 SeekDB 相关镜像
      const seekdbImages = lines
        .map((line) => {
          const [fullTag, size, created] = line.split("|");
          const [repository, tag] = fullTag.split(":");
          return { repository, tag, size, created, fullTag };
        })
        .filter((img) =>
          SEEKDB_IMAGE_PATTERNS.some(
            (pattern) =>
              img.repository.includes(pattern) ||
              img.repository.toLowerCase().includes("seekdb") ||
              img.repository.toLowerCase().includes("oceanbase")
          )
        );

      if (seekdbImages.length > 0) {
        return {
          id: this.id,
          name: this.name,
          status: "success",
          message: `找到 ${seekdbImages.length} 个 SeekDB 相关镜像`,
          details: {
            images: seekdbImages.map((img) => ({
              name: img.fullTag,
              size: img.size,
              created: img.created,
            })),
          },
        };
      } else {
        return {
          id: this.id,
          name: this.name,
          status: "info",
          message: "未找到 SeekDB 相关镜像",
          suggestion:
            "可使用 docker pull seekdb/seekdb:latest 拉取 SeekDB 镜像",
          actionUrl: "https://hub.docker.com/r/seekdb/seekdb",
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        id: this.id,
        name: this.name,
        status: "warning",
        message: `镜像检查失败: ${errorMsg}`,
      };
    }
  }
}
