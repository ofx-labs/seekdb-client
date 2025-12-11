import * as vscode from "vscode";
import { pipeline, env } from "@huggingface/transformers";

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

  constructor(apiKey: string, model: string = "text-embedding-3-small") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key 未配置");
    }

    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
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
          `OpenAI API 错误: ${error.error?.message || response.statusText}`
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
 * 内置向量化服务（使用本地模型）
 * 使用 @huggingface/transformers 库
 */
export class BuiltinEmbeddingService implements EmbeddingService {
  private pipeline: any = null;
  private initialized: boolean = false;

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
        }`
      );
    }
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
          "无法从 @huggingface/transformers 中获取 pipeline 函数"
        );
      }

      // 配置 HuggingFace 镜像地址（支持中国用户）
      // Set HuggingFace mirror for Chinese users, matching reference code
      if (env && typeof env === "object") {
        env.remoteHost = process.env.HF_ENDPOINT || "https://hf-mirror.com";
        console.log(`配置 HuggingFace 镜像地址: ${env.remoteHost}`);
      }

      // 尝试加载 pipeline，使用重试机制
      let retries = 2;
      let lastError: Error | null = null;

      while (retries > 0) {
        try {
          console.log(`正在下载/加载模型 ${MODEL_NAME}...`);
          this.pipeline = await pipeline("feature-extraction", MODEL_NAME);
          console.log("模型加载成功");

          this.initialized = true;
          return; // 成功，退出
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          retries--;

          // 如果是网络错误且还有重试次数，等待后重试
          if (
            retries > 0 &&
            (lastError.message.includes("fetch failed") ||
              lastError.message.includes("network") ||
              lastError.message.includes("ECONNREFUSED") ||
              lastError.message.includes("ETIMEDOUT"))
          ) {
            console.warn(
              `模型加载失败，${retries} 次重试剩余...`,
              lastError.message
            );
            // 等待 1 秒后重试
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
          }
          throw lastError; // 没有重试次数或不是网络错误，抛出异常
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

      console.warn("无法加载 @huggingface/transformers，使用简单向量化方案", {
        message: errorMessage,
        stack: errorStack,
        nodeVersion: process.version,
        platform: process.platform,
        modulePath: modulePath || "未找到模块路径",
        // 常见原因提示
        hint: modulePath
          ? errorMessage.includes("fetch failed")
            ? "网络连接失败，无法从 Hugging Face Hub 下载模型。请检查网络连接或配置代理。模型会缓存在 ~/.cache/huggingface 目录。"
            : "模块已安装，但初始化失败。可能是网络问题或模型下载失败。"
          : "模块未找到，请运行 npm install",
      });

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
   * @param type 服务类型：'openai' | 'builtin'
   * @param apiKey OpenAI API key（仅当 type 为 'openai' 时需要）
   * @param model OpenAI 模型名称（可选）
   * @returns 向量化服务实例
   */
  static create(
    type: "openai" | "builtin",
    apiKey?: string,
    model?: string
  ): EmbeddingService {
    if (type === "openai") {
      if (!apiKey) {
        throw new Error("使用 OpenAI 服务需要提供 API key");
      }
      return new OpenAIEmbeddingService(apiKey, model);
    } else {
      return new BuiltinEmbeddingService();
    }
  }

  /**
   * 从配置创建向量化服务
   */
  static createFromConfig(
    config: vscode.WorkspaceConfiguration
  ): EmbeddingService {
    const embeddingType = config.get<string>(
      "database.embedding.type",
      "builtin"
    );
    const apiKey = config.get<string>("database.embedding.openaiApiKey", "");

    if (embeddingType === "openai") {
      return this.create("openai", apiKey);
    } else {
      return this.create("builtin");
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
