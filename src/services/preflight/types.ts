/**
 * 预检查服务类型定义
 */

/**
 * 检查结果状态
 */
export type CheckStatus = "success" | "warning" | "error" | "info" | "skipped";

/**
 * 单项检查结果
 */
export interface CheckResult {
  /** 检查项唯一标识 */
  id: string;
  /** 检查项名称 */
  name: string;
  /** 检查状态 */
  status: CheckStatus;
  /** 结果消息 */
  message: string;
  /** 详细信息 */
  details?: Record<string, any>;
  /** 建议操作 */
  suggestion?: string;
  /** 操作链接（如安装文档） */
  actionUrl?: string;
}

/**
 * 系统信息
 */
export interface SystemInfo {
  os: {
    /** 操作系统平台 darwin | win32 | linux */
    platform: NodeJS.Platform;
    /** 系统版本 */
    release: string;
    /** 芯片架构 x64 | arm64 */
    arch: string;
  };
  node: {
    /** Node.js 版本 */
    version: string;
  };
  vscode: {
    /** VS Code 版本 */
    version: string;
  };
}

/**
 * 预检查完整报告
 */
export interface PreflightReport {
  /** 检查时间戳 */
  timestamp: Date;
  /** 检查耗时(ms) */
  duration: number;
  /** 系统信息 */
  system: SystemInfo;
  /** 所有检查结果 */
  checks: CheckResult[];
  /** 总体状态 */
  overallStatus: CheckStatus;
}

/**
 * 检查器接口
 */
export interface IPreflightChecker {
  /** 检查器唯一标识 */
  id: string;
  /** 检查器名称 */
  name: string;
  /** 执行检查 */
  check(): Promise<CheckResult>;
}

/**
 * Docker 容器信息
 */
export interface DockerContainerInfo {
  name: string;
  status: string;
  ports: string;
}

/**
 * 预检查配置
 */
export interface PreflightConfig {
  /** 是否启用预检查 */
  enabled: boolean;
  /** 是否显示进度 */
  showProgress: boolean;
  /** 是否检查 Docker */
  checkDocker: boolean;
  /** 是否检查 SeekDB 镜像 */
  checkSeekDBImage: boolean;
  /** 是否检查 SeekDB 实例 */
  checkSeekDBInstance: boolean;
}
