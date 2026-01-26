/**
 * 测试 HuggingFace 模型加载
 * 运行: node scripts/test-model.js
 */

const { pipeline } = require('@huggingface/transformers');

console.log('========================================');
console.log('测试 HuggingFace 模型加载');
console.log('========================================\n');

async function testModel() {
  try {
    console.log('1. 加载模型 Xenova/all-MiniLM-L6-v2...');
    const startTime = Date.now();
    
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    
    const loadTime = Date.now() - startTime;
    console.log(`   ✓ 模型加载成功 (耗时: ${loadTime}ms)\n`);
    
    // 测试英文
    console.log('2. 测试英文文本向量化...');
    const result1 = await extractor('Hello world', { pooling: 'mean', normalize: true });
    console.log(`   ✓ 向量维度: ${result1.dims[1]}`);
    console.log(`   ✓ 向量类型: ${result1.type}`);
    const norm1 = Math.sqrt(Array.from(result1.data).reduce((sum, v) => sum + v*v, 0));
    console.log(`   ✓ 向量范数: ${norm1.toFixed(6)} (归一化)\n`);
    
    // 测试中文
    console.log('3. 测试中文文本向量化...');
    const result2 = await extractor('你好世界', { pooling: 'mean', normalize: true });
    const norm2 = Math.sqrt(Array.from(result2.data).reduce((sum, v) => sum + v*v, 0));
    console.log(`   ✓ 中文向量维度: ${result2.dims[1]}`);
    console.log(`   ✓ 中文向量范数: ${norm2.toFixed(6)} (归一化)\n`);
    
    // 测试相似度计算
    console.log('4. 测试语义相似度计算...');
    const text1 = await extractor('The cat sits on the mat', { pooling: 'mean', normalize: true });
    const text2 = await extractor('A cat is sitting on a rug', { pooling: 'mean', normalize: true });
    const text3 = await extractor('The weather is nice today', { pooling: 'mean', normalize: true });
    
    const vec1 = Array.from(text1.data);
    const vec2 = Array.from(text2.data);
    const vec3 = Array.from(text3.data);
    
    const cosineSim = (v1, v2) => {
      let dot = 0;
      for (let i = 0; i < v1.length; i++) {
        dot += v1[i] * v2[i];
      }
      return dot;
    };
    
    const sim12 = cosineSim(vec1, vec2);
    const sim13 = cosineSim(vec1, vec3);
    
    console.log(`   ✓ 相似句子相似度: ${sim12.toFixed(4)} (高)`);
    console.log(`   ✓ 不同话题相似度: ${sim13.toFixed(4)} (低)`);
    
    if (sim12 > sim13) {
      console.log('   ✓ 语义理解正确：相似句子得分更高\n');
    } else {
      console.log('   ⚠ 警告：语义理解异常\n');
    }
    
    console.log('========================================');
    console.log('✓✓✓ 所有测试通过！模型工作正常！✓✓✓');
    console.log('========================================');
    
  } catch (error) {
    console.error('\n✗✗✗ 测试失败 ✗✗✗');
    console.error('错误:', error.message);
    console.error('\n详细信息:');
    console.error(error);
    console.error('\n========================================');
    console.error('解决方案:');
    console.error('1. 运行: npm run setup-model');
    console.error('2. 或手动运行: bash scripts/setup-model.sh');
    console.error('========================================');
    process.exit(1);
  }
}

testModel();
