import * as vscode from "vscode";
import { pipeline, env } from "@huggingface/transformers";
import * as path from "path";
import * as fs from "fs";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2"; // 默认模型名称

/**
 * 向量化服务接口
 */
export interface EmbeddingService {
  /**
   * 将文本转换为向量
   * @param text 要向量化的文本
   * @returns 向量数组
   */
  embed(text: string): Promise<number[]>;

  /**
   * 获取模型名称
   * @returns 模型名称字符串
   */
  getModelName(): string;
}

/**
 * OpenAI 向量化服务
 */
export class OpenAIEmbeddingService implements EmbeddingService {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(
    apiKey: string,
    model: string = "text-embedding-3-small",
    baseUrl: string = "https://api.openai.com/v1",
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, ""); // 移除末尾斜杠
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key 未配置");
    }

    try {
      const url = `${this.baseUrl}/embeddings`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          `OpenAI API 错误: ${error.error?.message || response.statusText}`,
        );
      }

      const data = await response.json();
      return data.data[0].embedding;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`向量化失败: ${String(error)}`);
    }
  }

  getModelName(): string {
    return `OpenAI ${this.model}`;
  }
}

/**
 * Ollama 向量化服务（本地模型）
 */
export class OllamaEmbeddingService implements EmbeddingService {
  private baseUrl: string;
  private model: string;

  constructor(
    baseUrl: string = "http://localhost:11434",
    model: string = "nomic-embed-text",
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // 移除末尾斜杠
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    try {
      const url = `${this.baseUrl}/api/embeddings`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Ollama API 错误: ${response.statusText} - ${errorText}`,
        );
      }

      const data = await response.json();
      if (!data.embedding || !Array.isArray(data.embedding)) {
        throw new Error("Ollama API 返回格式错误：缺少 embedding 字段");
      }

      return data.embedding;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Ollama 向量化失败: ${String(error)}`);
    }
  }

  getModelName(): string {
    return `Ollama ${this.model}`;
  }
}

/**
 * Anthropic 向量化服务
 */
export class AnthropicEmbeddingService implements EmbeddingService {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = "https://api.anthropic.com") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, ""); // 移除末尾斜杠
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error("Anthropic API key 未配置");
    }

    try {
      // Anthropic 本身不直接提供 embedding API，但可以通过兼容 OpenAI 格式的代理服务使用
      // 如果 baseUrl 指向兼容 OpenAI 格式的服务（如某些代理服务），则使用 OpenAI 格式
      // 否则尝试 Anthropic 原生格式（虽然可能不支持）
      const url = `${this.baseUrl}/v1/embeddings`;

      // 首先尝试 OpenAI 兼容格式（适用于代理服务）
      let response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-ada-002", // 使用兼容的模型名
          input: text,
        }),
      });

      // 如果失败，尝试使用 Anthropic 格式
      if (!response.ok && response.status === 404) {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-3-opus-20240229",
            input: text,
          }),
        });
      }

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: { message: response.statusText } }));
        throw new Error(
          `Anthropic API 错误: ${error.error?.message || response.statusText}`,
        );
      }

      const data = await response.json();
      // OpenAI 兼容格式
      if (data.data && Array.isArray(data.data) && data.data[0]?.embedding) {
        return data.data[0].embedding;
      }
      // Anthropic 格式（如果支持）
      if (data.embedding && Array.isArray(data.embedding)) {
        return data.embedding;
      }

      throw new Error("Anthropic API 返回格式错误：无法解析 embedding");
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Anthropic 向量化失败: ${String(error)}`);
    }
  }

  getModelName(): string {
    return "Anthropic Claude";
  }
}

/**
 * 千问（Qwen）向量化服务
 */
export class QwenEmbeddingService implements EmbeddingService {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(
    apiKey: string,
    baseUrl: string = "https://dashscope.aliyuncs.com",
    model: string = "text-embedding-v2",
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, ""); // 移除末尾斜杠
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error("千问 API key 未配置");
    }

    try {
      const url = `${this.baseUrl}/api/v1/services/embeddings/text-embedding/text-embedding`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: {
            texts: [text],
          },
        }),
      });

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: { message: response.statusText } }));
        throw new Error(
          `千问 API 错误: ${
            error.error?.message || error.message || response.statusText
          }`,
        );
      }

      const data = await response.json();
      if (
        data.output &&
        data.output.embeddings &&
        Array.isArray(data.output.embeddings) &&
        data.output.embeddings[0]
      ) {
        return data.output.embeddings[0].embedding;
      }
      if (data.data && Array.isArray(data.data) && data.data[0]?.embedding) {
        return data.data[0].embedding;
      }

      throw new Error("千问 API 返回格式错误：缺少 embedding 字段");
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`千问向量化失败: ${String(error)}`);
    }
  }

  getModelName(): string {
    return `千问 ${this.model}`;
  }
}

/**
 * 内置向量化服务（使用本地模型）
 * 使用 @huggingface/transformers 库
 */
export class BuiltinEmbeddingService implements EmbeddingService {
  private pipeline: any = null;
  private initialized: boolean = false;
  private mirrorUrl: string;

  async embed(text: string): Promise<number[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      // 检查是否是 SimpleEmbeddingPipeline 实例（有 embed 方法）
      if (this.pipeline && typeof (this.pipeline as any).embed === "function") {
        return await (this.pipeline as any).embed(text);
      }

      // 使用 @huggingface/transformers pipeline（函数调用）
      if (typeof this.pipeline === "function") {
        const result = await this.pipeline(text, {
          pooling: "mean",
          normalize: true,
        });
        return Array.from(result.data);
      }

      throw new Error("Pipeline 未正确初始化");
    } catch (error) {
      throw new Error(
        `内置模型向量化失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  constructor(mirrorUrl: string = "https://hf-mirror.com") {
    this.mirrorUrl = mirrorUrl;
  }

  /**
   * 检查模型是否已缓存在本地
   */
  private checkModelCache(): boolean {
    try {
      // HuggingFace 缓存目录通常在 ~/.cache/huggingface/hub/models--Xenova--all-MiniLM-L6-v2
      const homeDir = process.env.HOME || process.env.USERPROFILE || "";
      if (!homeDir) {
        return false;
      }

      // 构建缓存路径
      const cacheDir = path.join(
        homeDir,
        ".cache",
        "huggingface",
        "hub",
        `models--Xenova--all-MiniLM-L6-v2`,
      );

      // 检查目录是否存在
      if (fs.existsSync(cacheDir)) {
        // 检查是否有模型文件（通常包含 .onnx 或 .bin 文件）
        const files = fs.readdirSync(cacheDir, { recursive: true });
        const hasModelFiles = files.some(
          (file: string | Buffer) => {
            const fileName = typeof file === "string" ? file : file.toString();
            return (
              fileName.endsWith(".onnx") ||
              fileName.endsWith(".bin") ||
              fileName.endsWith(".json")
            );
          },
        );
        if (hasModelFiles) {
          console.log(`检测到本地模型缓存: ${cacheDir}`);
          return true;
        }
      }
    } catch (error) {
      // 忽略检查错误，继续尝试加载
      console.warn("检查模型缓存时出错:", error);
    }
    return false;
  }

  private async initialize(): Promise<void> {
    try {
      // 动态导入 @huggingface/transformers
      // 注意：在 VS Code 扩展环境中，ESM 模块的动态导入可能需要特殊处理
      // const transformersModule = await import("@huggingface/transformers");
      // const pipeline =
      //   transformersModule.pipeline ||
      //   (transformersModule as any).default?.pipeline;
      // const env =
      //   transformersModule.env || (transformersModule as any).default?.env;

      if (!pipeline) {
        throw new Error(
          "无法从 @huggingface/transformers 中获取 pipeline 函数",
        );
      }

      // 检查本地缓存
      const hasCache = this.checkModelCache();

      // 配置 HuggingFace 镜像地址（支持中国用户）
      // Set HuggingFace mirror for Chinese users, matching reference code
      if (env && typeof env === "object") {
        env.remoteHost = this.mirrorUrl;
        console.log(`配置 HuggingFace 镜像地址: ${env.remoteHost}`);
      }

      // 如果本地有缓存，优先使用本地缓存（不需要网络）
      // 如果没有缓存，需要从网络下载
      let retries = hasCache ? 1 : 3; // 有缓存时只重试1次，无缓存时重试3次
      let lastError: Error | null = null;

      while (retries > 0) {
        try {
          if (hasCache) {
            console.log(`从本地缓存加载模型 ${MODEL_NAME}...`);
          } else {
            console.log(
              `正在从 ${this.mirrorUrl} 下载/加载模型 ${MODEL_NAME}...`,
            );
            console.log(
              "提示: 模型首次下载需要网络连接，下载后会缓存在 ~/.cache/huggingface 目录",
            );
          }

          // 设置超时时间（有缓存时30秒，无缓存时120秒）
          const timeout = hasCache ? 30000 : 120000;
          const pipelinePromise = pipeline("feature-extraction", MODEL_NAME);

          this.pipeline = await Promise.race([
            pipelinePromise,
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("模型加载超时")),
                timeout,
              ),
            ),
          ]) as any;

          console.log("模型加载成功");
          this.initialized = true;
          return; // 成功，退出
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          retries--;

          const isNetworkError =
            lastError.message.includes("fetch failed") ||
            lastError.message.includes("network") ||
            lastError.message.includes("ECONNREFUSED") ||
            lastError.message.includes("ETIMEDOUT") ||
            lastError.message.includes("ENOTFOUND") ||
            lastError.message.includes("ECONNRESET");

          // 如果是网络错误且还有重试次数，等待后重试
          if (retries > 0 && isNetworkError) {
            const waitTime = hasCache ? 1000 : 2000; // 有缓存时等待1秒，无缓存时等待2秒
            console.warn(
              `模型加载失败（网络错误），${retries} 次重试剩余...`,
              lastError.message,
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          }

          // 如果是其他错误或没有重试次数，抛出异常
          throw lastError;
        }
      }
    } catch (error) {
      // 如果导入失败，使用简单的 TF-IDF 替代方案
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      // 诊断信息
      let modulePath: string | null = null;
      try {
        modulePath = require.resolve("@huggingface/transformers");
      } catch (resolveError) {
        modulePath = null;
      }

      const isNetworkError =
        errorMessage.includes("fetch failed") ||
        errorMessage.includes("network") ||
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("ETIMEDOUT") ||
        errorMessage.includes("ENOTFOUND") ||
        errorMessage.includes("ECONNRESET");

      const hasCache = this.checkModelCache();

      let hint = "";
      if (!modulePath) {
        hint = "模块未找到，请运行 npm install @huggingface/transformers";
      } else if (isNetworkError) {
        if (hasCache) {
          hint =
            "检测到本地缓存，但加载失败。可能是缓存损坏，请删除 ~/.cache/huggingface/hub/models--Xenova--all-MiniLM-L6-v2 目录后重试。";
        } else {
          hint =
            "网络连接失败，无法从 Hugging Face Hub 下载模型。\n" +
            "解决方案：\n" +
            "1. 检查网络连接或配置代理\n" +
            "2. 确保可以访问 " +
            this.mirrorUrl +
            "\n" +
            "3. 模型首次下载后会缓存在 ~/.cache/huggingface 目录\n" +
            "4. 如果网络受限，可以手动下载模型到缓存目录";
        }
      } else {
        hint =
          "模型初始化失败。错误: " +
          errorMessage +
          "\n请检查控制台日志获取更多信息。";
      }

      console.warn("无法加载 HuggingFace 模型，使用简单向量化方案", {
        message: errorMessage,
        stack: errorStack,
        nodeVersion: process.version,
        platform: process.platform,
        modulePath: modulePath || "未找到模块路径",
        hasCache,
        hint,
      });

      // 显示用户友好的警告
      if (isNetworkError && !hasCache) {
        vscode.window.showWarningMessage(
          `无法下载模型 ${MODEL_NAME}。使用简单向量化方案（准确度较低）。\n${hint}`,
          "查看详情",
        ).then((action) => {
          if (action === "查看详情") {
            vscode.window.showInformationMessage(
              `模型下载失败详情:\n${hint}\n\n错误信息: ${errorMessage}`,
            );
          }
        });
      }

      this.pipeline = new SimpleEmbeddingPipeline();
      this.initialized = true;
    }
  }

  getModelName(): string {
    if (!this.initialized) {
      return "Builtin (未初始化)";
    }
    // 检查是否是 SimpleEmbeddingPipeline 实例
    if (this.pipeline && typeof (this.pipeline as any).embed === "function") {
      return "Builtin (Simple TF-IDF)";
    }
    // 使用 @huggingface/transformers
    return "Builtin (Xenova/all-MiniLM-L6-v2)";
  }
}

/**
 * 简单的向量化管道（TF-IDF 风格，作为后备方案）
 */
class SimpleEmbeddingPipeline {
  private vocabulary: Map<string, number> = new Map();
  private vocabSize: number = 0;

  async embed(text: string): Promise<number[]> {
    // 简单的词频向量化
    const words = text.toLowerCase().split(/\s+/);
    const vector: number[] = new Array(384).fill(0); // 384 维向量（与 all-MiniLM-L6-v2 相同）

    // 简单的哈希向量化
    words.forEach((word, index) => {
      const hash = this.simpleHash(word);
      const pos = hash % 384;
      vector[pos] += 1 / (words.length || 1);
    });

    // 归一化
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return norm > 0 ? vector.map((val) => val / norm) : vector;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
}

/**
 * 向量化服务工厂
 */
export class EmbeddingServiceFactory {
  /**
   * 创建向量化服务
   * @param type 服务类型
   * @param options 配置选项
   * @returns 向量化服务实例
   */
  static create(
    type: "openai" | "builtin" | "ollama" | "anthropic" | "qwen",
    options?: {
      apiKey?: string;
      model?: string;
      baseUrl?: string;
      ollamaBaseUrl?: string;
      ollamaModel?: string;
      mirrorUrl?: string;
    },
  ): EmbeddingService {
    switch (type) {
      case "openai":
        if (!options?.apiKey) {
          throw new Error("使用 OpenAI 服务需要提供 API key");
        }
        return new OpenAIEmbeddingService(
          options.apiKey,
          options.model || "text-embedding-3-small",
          options.baseUrl || "https://api.openai.com/v1",
        );

      case "ollama":
        return new OllamaEmbeddingService(
          options?.ollamaBaseUrl || "http://localhost:11434",
          options?.ollamaModel || "nomic-embed-text",
        );

      case "anthropic":
        if (!options?.apiKey) {
          throw new Error("使用 Anthropic 服务需要提供 API key");
        }
        return new AnthropicEmbeddingService(
          options.apiKey,
          options.baseUrl || "https://api.anthropic.com",
        );

      case "qwen":
        if (!options?.apiKey) {
          throw new Error("使用千问服务需要提供 API key");
        }
        return new QwenEmbeddingService(
          options.apiKey,
          options.baseUrl || "https://dashscope.aliyuncs.com",
          options.model || "text-embedding-v2",
        );

      case "builtin":
      default:
        return new BuiltinEmbeddingService(
          options?.mirrorUrl || "https://hf-mirror.com",
        );
    }
  }

  /**
   * 从配置创建向量化服务
   */
  static createFromConfig(
    config: vscode.WorkspaceConfiguration,
  ): EmbeddingService {
    const embeddingType = config.get<string>(
      "database.embedding.type",
      "builtin",
    );

    // 获取 HuggingFace 镜像配置
    const mirrorType = config.get<string>(
      "database.embedding.huggingFaceMirror",
      "china",
    );
    const mirrorUrl =
      mirrorType === "china"
        ? "https://hf-mirror.com"
        : "https://huggingface.co";

    switch (embeddingType) {
      case "openai": {
        const apiKey = config.get<string>(
          "database.embedding.openaiApiKey",
          "",
        );
        const baseUrl = config.get<string>(
          "database.embedding.openaiBaseUrl",
          "https://api.openai.com/v1",
        );
        return this.create("openai", { apiKey, baseUrl });
      }

      case "ollama": {
        const ollamaBaseUrl = config.get<string>(
          "database.embedding.ollamaBaseUrl",
          "http://localhost:11434",
        );
        const ollamaModel = config.get<string>(
          "database.embedding.ollamaModel",
          "nomic-embed-text",
        );
        return this.create("ollama", { ollamaBaseUrl, ollamaModel });
      }

      case "anthropic": {
        const apiKey = config.get<string>(
          "database.embedding.anthropicApiKey",
          "",
        );
        const baseUrl = config.get<string>(
          "database.embedding.anthropicBaseUrl",
          "https://api.anthropic.com",
        );
        return this.create("anthropic", { apiKey, baseUrl });
      }

      case "qwen": {
        const apiKey = config.get<string>("database.embedding.qwenApiKey", "");
        const baseUrl = config.get<string>(
          "database.embedding.qwenBaseUrl",
          "https://dashscope.aliyuncs.com",
        );
        return this.create("qwen", { apiKey, baseUrl });
      }

      case "builtin":
      default:
        return this.create("builtin", { mirrorUrl });
    }
  }
}

/**
 * 计算余弦相似度
 */
export function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error("向量维度不匹配");
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
