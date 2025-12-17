/**
 * SeekDB 实例检查器 - 检查 SeekDB 是否在运行
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as net from "net";
import { IPreflightChecker, CheckResult, DockerContainerInfo } from "../types";

const execAsync = promisify(exec);

// SeekDB 默认端口
const SEEKDB_DEFAULT_PORT = 2881;
// 备选检查端口 (MySQL 兼容端口)
const SEEKDB_ALT_PORTS = [3306, 2883];

export class SeekDBInstanceCheck implements IPreflightChecker {
  id = "seekdb-instance";
  name = "SeekDB 实例检查";

  /**
   * 检查端口是否可连接
   */
  private async checkPort(
    port: number,
    host: string = "127.0.0.1"
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(3000);

      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });

      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, host);
    });
  }

  /**
   * 获取 Docker 中的 SeekDB 容器
   */
  private async getSeekDBContainers(): Promise<DockerContainerInfo[]> {
    try {
      // 搜索包含 seekdb 或 oceanbase 关键字的容器
      const { stdout } = await execAsync(
        'docker ps -a --format "{{.Names}}|{{.Status}}|{{.Ports}}|{{.Image}}"',
        { timeout: 5000 }
      );

      const lines = stdout.trim().split("\n").filter(Boolean);
      const containers: DockerContainerInfo[] = [];

      for (const line of lines) {
        const [name, status, ports, image] = line.split("|");
        // 检查容器名或镜像名是否包含 seekdb/oceanbase
        if (
          name.toLowerCase().includes("seekdb") ||
          name.toLowerCase().includes("oceanbase") ||
          image.toLowerCase().includes("seekdb") ||
          image.toLowerCase().includes("oceanbase")
        ) {
          containers.push({ name, status, ports });
        }
      }

      return containers;
    } catch {
      return [];
    }
  }

  async check(): Promise<CheckResult> {
    const details: Record<string, any> = {};
    const portsStatus: { port: number; open: boolean }[] = [];

    // 1. 检查默认端口和备选端口
    const allPorts = [SEEKDB_DEFAULT_PORT, ...SEEKDB_ALT_PORTS];
    for (const port of allPorts) {
      const open = await this.checkPort(port);
      portsStatus.push({ port, open });
    }

    details.portChecks = portsStatus;

    const openPorts = portsStatus.filter((p) => p.open);
    const defaultPortOpen = portsStatus.find(
      (p) => p.port === SEEKDB_DEFAULT_PORT
    )?.open;

    // 2. 检查 Docker 容器中的 SeekDB 实例
    const containers = await this.getSeekDBContainers();
    details.containers = containers;

    const runningContainers = containers.filter((c) =>
      c.status.toLowerCase().includes("up")
    );
    const stoppedContainers = containers.filter(
      (c) => !c.status.toLowerCase().includes("up")
    );

    // 3. 综合判断（按优先级排序）

    // 3.1 有运行中的 SeekDB 容器 - 最佳状态
    if (runningContainers.length > 0) {
      return {
        id: this.id,
        name: this.name,
        status: "success",
        message: `发现 ${runningContainers.length} 个运行中的 SeekDB 容器`,
        details: {
          ...details,
          runningContainers: runningContainers.map((c) => ({
            name: c.name,
            status: c.status,
            ports: c.ports,
          })),
        },
      };
    }

    // 3.2 默认端口有服务 - 可能是本地安装的 SeekDB
    if (defaultPortOpen) {
      return {
        id: this.id,
        name: this.name,
        status: "success",
        message: `端口 ${SEEKDB_DEFAULT_PORT} 有服务监听（可能是本地 SeekDB 实例）`,
        details,
      };
    }

    // 3.3 有已停止的 SeekDB 容器 - 需要用户启动（优先于其他端口检查）
    if (stoppedContainers.length > 0) {
      return {
        id: this.id,
        name: this.name,
        status: "warning",
        message: `发现 ${stoppedContainers.length} 个已停止的 SeekDB 容器`,
        details: {
          ...details,
          stoppedContainers: stoppedContainers.map((c) => ({
            name: c.name,
            status: c.status,
          })),
        },
        suggestion: `使用 docker start ${stoppedContainers[0].name} 启动容器`,
      };
    }

    // 3.4 其他端口有服务但不是 SeekDB
    if (openPorts.length > 0) {
      return {
        id: this.id,
        name: this.name,
        status: "info",
        message: `检测到端口 ${openPorts
          .map((p) => p.port)
          .join(", ")} 有服务，但非 SeekDB 默认端口`,
        details,
        suggestion: `SeekDB 默认使用端口 ${SEEKDB_DEFAULT_PORT}，当前端口可能是其他服务`,
      };
    }

    // 3.5 没有发现任何 SeekDB 相关服务
    return {
      id: this.id,
      name: this.name,
      status: "info",
      message: "未检测到 SeekDB 实例",
      details,
      suggestion: "您可以通过 Docker 安装并启动 SeekDB 实例",
    };
  }
}
