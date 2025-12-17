/**
 * SeekDB Image Checker
 */

import { exec } from "child_process";
import { promisify } from "util";
import { IPreflightChecker, CheckResult } from "../types";

const execAsync = promisify(exec);

// SeekDB related image patterns
const SEEKDB_IMAGE_PATTERNS = [
  "seekdb/seekdb",
  "seekdb",
  "oceanbase/oceanbase-ce", // OceanBase compatible
  "oceanbase",
];

export class SeekDBImageCheck implements IPreflightChecker {
  id = "seekdb-image";
  name = "SeekDB Image Check";

  async check(): Promise<CheckResult> {
    // First check if Docker is available
    try {
      await execAsync("docker info", { timeout: 5000 });
    } catch {
      return {
        id: this.id,
        name: this.name,
        status: "skipped",
        message: "Docker unavailable, skipping image check",
        suggestion: "Please install and start Docker first",
      };
    }

    try {
      // Get all images
      const { stdout } = await execAsync(
        'docker images --format "{{.Repository}}:{{.Tag}}|{{.Size}}|{{.CreatedSince}}"',
        {
          timeout: 10000,
        }
      );

      const lines = stdout.trim().split("\n").filter(Boolean);

      // Find SeekDB related images
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
          message: `Found ${seekdbImages.length} SeekDB related image(s)`,
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
          message: "No SeekDB images found",
          suggestion:
            "Run docker pull seekdb/seekdb:latest to pull SeekDB image",
          actionUrl: "https://hub.docker.com/r/seekdb/seekdb",
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        id: this.id,
        name: this.name,
        status: "warning",
        message: `Image check failed: ${errorMsg}`,
      };
    }
  }
}
