#!/usr/bin/env node

/**
 * 自动确保模型可用
 * 在 npm install 后运行，检查并恢复模型文件
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';
const CACHE_DIR = path.join(HOME_DIR, '.cache', 'huggingface', 'hub', 'models--Xenova--all-MiniLM-L6-v2');
const TARGET_DIR = path.join(__dirname, '..', 'node_modules', '@huggingface', 'transformers', '.cache', 'Xenova', 'all-MiniLM-L6-v2');

console.log('检查 HuggingFace 模型状态...');

// 检查目标目录是否已有模型
const targetExists = fs.existsSync(path.join(TARGET_DIR, 'onnx', 'model.onnx'));
if (targetExists) {
  console.log('✓ 模型已存在于 transformers.js 缓存中');
  process.exit(0);
}

// 检查备份缓存
const cacheExists = fs.existsSync(path.join(CACHE_DIR, 'onnx', 'model.onnx'));
if (cacheExists) {
  console.log(`✓ 发现备份缓存: ${CACHE_DIR}`);
  console.log('→ 复制模型到 transformers.js 缓存...');
  
  try {
    // 创建目标目录
    fs.mkdirSync(TARGET_DIR, { recursive: true });
    
    // 复制文件
    const copyRecursive = (src, dest) => {
      const exists = fs.existsSync(src);
      const stats = exists && fs.statSync(src);
      const isDirectory = exists && stats.isDirectory();
      
      if (isDirectory) {
        fs.mkdirSync(dest, { recursive: true });
        fs.readdirSync(src).forEach(childItemName => {
          copyRecursive(path.join(src, childItemName), path.join(dest, childItemName));
        });
      } else {
        fs.copyFileSync(src, dest);
      }
    };
    
    copyRecursive(CACHE_DIR, TARGET_DIR);
    console.log('✓ 模型文件复制成功');
    process.exit(0);
  } catch (error) {
    console.error('✗ 复制失败:', error.message);
    process.exit(1);
  }
}

console.log('⚠ 未找到模型缓存');
console.log('');
console.log('模型将在首次使用时自动下载。');
console.log('如果网络受限，请运行: npm run setup-model');
console.log('');
process.exit(0);
