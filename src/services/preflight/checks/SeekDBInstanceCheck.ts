/**
 * SeekDB Instance Checker - Check if SeekDB is running
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as net from "net";
import { IPreflightChecker, CheckResult, DockerContainerInfo } from "../types";

const execAsync = promisify(exec);

// SeekDB default port
const SEEKDB_DEFAULT_PORT = 2881;
// Alternative ports (MySQL compatible)
const SEEKDB_ALT_PORTS = [3306, 2883];

export class SeekDBInstanceCheck implements IPreflightChecker {
  id = "seekdb-instance";
  name = "SeekDB Instance Check";

  /**
   * Check if port is connectable
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
   * Get SeekDB containers from Docker
   */
  private async getSeekDBContainers(): Promise<DockerContainerInfo[]> {
    try {
      // Search containers with seekdb or oceanbase keywords
      const { stdout } = await execAsync(
        'docker ps -a --format "{{.Names}}|{{.Status}}|{{.Ports}}|{{.Image}}"',
        { timeout: 5000 }
      );

      const lines = stdout.trim().split("\n").filter(Boolean);
      const containers: DockerContainerInfo[] = [];

      for (const line of lines) {
        const [name, status, ports, image] = line.split("|");
        // Check if container name or image contains seekdb/oceanbase
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

    // 1. Check default and alternative ports
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

    // 2. Check SeekDB instances in Docker containers
    const containers = await this.getSeekDBContainers();
    details.containers = containers;

    const runningContainers = containers.filter((c) =>
      c.status.toLowerCase().includes("up")
    );
    const stoppedContainers = containers.filter(
      (c) => !c.status.toLowerCase().includes("up")
    );

    // 3. Evaluate (by priority)

    // 3.1 Running SeekDB containers - best state
    if (runningContainers.length > 0) {
      return {
        id: this.id,
        name: this.name,
        status: "success",
        message: `Found ${runningContainers.length} running SeekDB container(s)`,
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

    // 3.2 Default port has service - may be local SeekDB
    if (defaultPortOpen) {
      return {
        id: this.id,
        name: this.name,
        status: "success",
        message: `Port ${SEEKDB_DEFAULT_PORT} has service listening (possibly local SeekDB)`,
        details,
      };
    }

    // 3.3 Stopped SeekDB containers - needs user to start (priority over other ports)
    if (stoppedContainers.length > 0) {
      return {
        id: this.id,
        name: this.name,
        status: "warning",
        message: `Found ${stoppedContainers.length} stopped SeekDB container(s)`,
        details: {
          ...details,
          stoppedContainers: stoppedContainers.map((c) => ({
            name: c.name,
            status: c.status,
          })),
        },
        suggestion: `Run docker start ${stoppedContainers[0].name} to start the container`,
      };
    }

    // 3.4 Other ports have services but not SeekDB
    if (openPorts.length > 0) {
      return {
        id: this.id,
        name: this.name,
        status: "info",
        message: `Detected services on port(s) ${openPorts
          .map((p) => p.port)
          .join(", ")}, but not SeekDB default port`,
        details,
        suggestion: `SeekDB uses port ${SEEKDB_DEFAULT_PORT} by default, current ports may be other services`,
      };
    }

    // 3.5 No SeekDB related services found
    return {
      id: this.id,
      name: this.name,
      status: "info",
      message: "No SeekDB instance detected",
      details,
      suggestion: "You can install and start SeekDB using Docker",
    };
  }
}
