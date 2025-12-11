import { pipeline, env } from "@huggingface/transformers";
import * as assert from "assert";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

/**
 * 测试模型下载功能
 * 参考: https://hf-mirror.com/Xenova/all-MiniLM-L6-v2
 */
suite("模型下载测试", () => {
  test("应该能够从 HF Mirror 下载模型", async function (this: Mocha.Context) {
    // 设置超时时间（模型下载可能需要较长时间）
    this.timeout(120000); // 2 分钟

    // 清除可能导致问题的代理环境变量
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    delete process.env.ALL_PROXY;
    delete process.env.all_proxy;

    // 配置 HuggingFace 镜像地址（支持中国用户）
    // 优先使用环境变量，避免直接修改 env 对象导致代理问题
    if (!process.env.HF_ENDPOINT) {
      process.env.HF_ENDPOINT = "https://hf-mirror.com";
    }
    // 如果 env 对象存在且支持 remoteHost，也设置它
    try {
      if (env && typeof env === "object" && "remoteHost" in env) {
        env.remoteHost = process.env.HF_ENDPOINT;
        console.log(`配置 HuggingFace 镜像地址: ${env.remoteHost}`);
      } else {
        console.log(`使用环境变量 HF_ENDPOINT: ${process.env.HF_ENDPOINT}`);
      }
    } catch (error) {
      // 如果设置 env.remoteHost 失败，仅使用环境变量
      console.log(`使用环境变量 HF_ENDPOINT: ${process.env.HF_ENDPOINT}`);
    }

    try {
      console.log(`开始下载模型: ${MODEL_NAME}`, env);

      // 创建特征提取 pipeline
      const extractor = await pipeline("feature-extraction", MODEL_NAME);

      console.log("模型下载成功");

      // 验证 pipeline 是否创建成功
      assert.ok(extractor, "Pipeline 应该被成功创建");
      assert.ok(typeof extractor === "function", "Pipeline 应该是一个函数");

      // 测试模型功能：计算句子嵌入向量
      const sentences = [
        "This is an example sentence",
        "Each sentence is converted",
      ];

      console.log("测试模型功能：计算句子嵌入向量");
      const output = await extractor(sentences, {
        pooling: "mean",
        normalize: true,
      });

      // 验证输出格式
      assert.ok(output, "输出应该存在");
      assert.ok(output.dims, "输出应该包含 dims 属性");
      assert.ok(output.data, "输出应该包含 data 属性");
      assert.ok(output.type, "输出应该包含 type 属性");

      // 验证维度：2 个句子，每个 384 维
      assert.strictEqual(output.dims[0], 2, "第一个维度应该是句子数量 (2)");
      assert.strictEqual(output.dims[1], 384, "第二个维度应该是向量维度 (384)");

      // 验证数据类型
      assert.strictEqual(output.type, "float32", "数据类型应该是 float32");

      // 验证数据大小
      assert.strictEqual(
        output.size,
        768, // 2 * 384
        "数据大小应该是 768 (2 * 384)"
      );

      // 转换为数组并验证
      const embeddings = output.tolist();
      assert.ok(Array.isArray(embeddings), "嵌入向量应该是数组");
      assert.strictEqual(embeddings.length, 2, "应该有 2 个嵌入向量");
      assert.strictEqual(
        embeddings[0].length,
        384,
        "每个嵌入向量应该有 384 维"
      );
      assert.strictEqual(
        embeddings[1].length,
        384,
        "每个嵌入向量应该有 384 维"
      );

      // 验证向量已归一化（L2 范数应该接近 1）
      const norm1 = Math.sqrt(
        embeddings[0].reduce((sum, val) => sum + val * val, 0)
      );
      const norm2 = Math.sqrt(
        embeddings[1].reduce((sum, val) => sum + val * val, 0)
      );

      assert.ok(
        Math.abs(norm1 - 1.0) < 0.1,
        "第一个向量应该已归一化（L2 范数接近 1）"
      );
      assert.ok(
        Math.abs(norm2 - 1.0) < 0.1,
        "第二个向量应该已归一化（L2 范数接近 1）"
      );

      console.log("模型功能测试通过");
      console.log(`第一个句子嵌入向量维度: ${embeddings[0].length}`);
      console.log(`第二个句子嵌入向量维度: ${embeddings[1].length}`);
      console.log(`第一个向量 L2 范数: ${norm1.toFixed(4)}`);
      console.log(`第二个向量 L2 范数: ${norm2.toFixed(4)}`);

      // 测试单个句子
      console.log("测试单个句子处理");
      const singleOutput = await extractor("Hello, world!", {
        pooling: "mean",
        normalize: true,
      });

      const singleEmbedding = singleOutput.tolist();
      assert.ok(Array.isArray(singleEmbedding), "单个句子输出应该是数组");
      assert.strictEqual(
        singleEmbedding.length,
        1,
        "单个句子应该返回一个嵌入向量"
      );
      assert.strictEqual(
        singleEmbedding[0].length,
        384,
        "单个嵌入向量应该有 384 维"
      );

      console.log("所有测试通过！");
    } catch (error) {
      console.error("模型下载或测试失败:", error);
      throw error;
    }
  });

  test("应该能够处理中文文本", async function (this: Mocha.Context) {
    this.timeout(120000);

    // 清除可能导致问题的代理环境变量
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy;
    delete process.env.https_proxy;
    delete process.env.ALL_PROXY;
    delete process.env.all_proxy;

    // 配置镜像地址
    if (!process.env.HF_ENDPOINT) {
      process.env.HF_ENDPOINT = "https://hf-mirror.com";
    }
    try {
      if (env && typeof env === "object" && "remoteHost" in env) {
        env.remoteHost = process.env.HF_ENDPOINT;
      }
    } catch (error) {
      // 忽略错误，仅使用环境变量
    }

    try {
      const extractor = await pipeline("feature-extraction", MODEL_NAME);

      const chineseSentences = ["这是一个测试句子", "这是另一个测试句子"];
      const output = await extractor(chineseSentences, {
        pooling: "mean",
        normalize: true,
      });

      const embeddings = output.tolist();
      assert.strictEqual(embeddings.length, 2, "应该有 2 个中文嵌入向量");
      assert.strictEqual(
        embeddings[0].length,
        384,
        "中文嵌入向量应该有 384 维"
      );

      console.log("中文文本处理测试通过");
    } catch (error) {
      console.error("中文文本处理测试失败:", error);
      throw error;
    }
  });
});
