/**
 * Docker Environment Checker
 */

import { exec } from "child_process";
import { promisify } from "util";
import { IPreflightChecker, CheckResult } from "../types";

const execAsync = promisify(exec);

export class DockerCheck implements IPreflightChecker {
  id = "docker";
  name = "Docker Check";

  async check(): Promise<CheckResult> {
    try {
      // Check if Docker is installed
      const { stdout: versionOutput } = await execAsync("docker --version", {
        timeout: 5000,
      });

      const dockerVersion = versionOutput.trim();

      // Check if Docker is running
      try {
        const { stdout: infoOutput } = await execAsync(
          'docker info --format "{{.ServerVersion}}"',
          {
            timeout: 10000,
          }
        );

        const serverVersion = infoOutput.trim();

        // Get more Docker info
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
          // Ignore extra info fetch failure
        }

        return {
          id: this.id,
          name: this.name,
          status: "success",
          message: "Docker is installed and running",
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
          message: "Docker is installed but not running",
          details: {
            clientVersion: dockerVersion,
          },
          suggestion: "Please start Docker Desktop or Docker service",
          actionUrl: "https://docs.docker.com/get-docker/",
        };
      }
    } catch (error) {
      return {
        id: this.id,
        name: this.name,
        status: "info",
        message: "Docker is not installed",
        suggestion: "To deploy SeekDB with Docker, please install Docker first",
        actionUrl: "https://docs.docker.com/get-docker/",
      };
    }
  }
}
