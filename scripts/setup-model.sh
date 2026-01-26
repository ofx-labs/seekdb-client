#!/bin/bash

# 自动化脚本：确保 HuggingFace 模型可用
# 用途：在 npm install 后恢复模型文件

set -e

MODEL_NAME="Xenova/all-MiniLM-L6-v2"
MIRROR_URL="https://hf-mirror.com"
CACHE_DIR="$HOME/.cache/huggingface/hub/models--Xenova--all-MiniLM-L6-v2"
TARGET_DIR="node_modules/@huggingface/transformers/.cache/Xenova/all-MiniLM-L6-v2"

echo "=========================================="
echo "HuggingFace 模型自动配置脚本"
echo "模型: $MODEL_NAME"
echo "=========================================="
echo ""

# 检查是否已有备份缓存
if [ -d "$CACHE_DIR" ] && [ -f "$CACHE_DIR/onnx/model.onnx" ]; then
    echo "✓ 检测到备份缓存: $CACHE_DIR"
    
    # 检查目标目录
    if [ ! -d "$TARGET_DIR" ]; then
        echo "→ 创建 transformers.js 缓存目录..."
        mkdir -p "$TARGET_DIR"
    fi
    
    # 复制文件
    echo "→ 复制模型文件到 transformers.js 缓存..."
    cp -r "$CACHE_DIR"/* "$TARGET_DIR/"
    
    echo "✓ 模型文件已复制"
    echo ""
    echo "测试模型加载..."
    node -e "
const {pipeline} = require('@huggingface/transformers');
pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
  .then(() => console.log('✓✓✓ 模型加载测试成功！✓✓✓'))
  .catch(err => {
    console.error('✗ 模型加载失败:', err.message);
    process.exit(1);
  });
"
    
else
    echo "⚠ 未找到备份缓存，需要下载模型"
    echo ""
    echo "下载模型文件（约 87MB）..."
    echo "镜像地址: $MIRROR_URL"
    echo ""
    
    # 创建目录
    mkdir -p "$CACHE_DIR/onnx"
    mkdir -p "$TARGET_DIR/onnx"
    
    # 下载文件
    echo "→ 下载 config.json..."
    curl -L -o "$CACHE_DIR/config.json" "$MIRROR_URL/$MODEL_NAME/resolve/main/config.json"
    
    echo "→ 下载 tokenizer.json..."
    curl -L -o "$CACHE_DIR/tokenizer.json" "$MIRROR_URL/$MODEL_NAME/resolve/main/tokenizer.json"
    
    echo "→ 下载 tokenizer_config.json..."
    curl -L -o "$CACHE_DIR/tokenizer_config.json" "$MIRROR_URL/$MODEL_NAME/resolve/main/tokenizer_config.json"
    
    echo "→ 下载 special_tokens_map.json..."
    curl -L -o "$CACHE_DIR/special_tokens_map.json" "$MIRROR_URL/$MODEL_NAME/resolve/main/special_tokens_map.json"
    
    echo "→ 下载 vocab.txt..."
    curl -L -o "$CACHE_DIR/vocab.txt" "$MIRROR_URL/$MODEL_NAME/resolve/main/vocab.txt"
    
    echo "→ 下载 model.onnx (86MB，可能需要1-2分钟)..."
    curl -L -o "$CACHE_DIR/onnx/model.onnx" "$MIRROR_URL/$MODEL_NAME/resolve/main/onnx/model.onnx"
    
    # 复制到 transformers.js 缓存
    echo "→ 复制到 transformers.js 缓存..."
    cp -r "$CACHE_DIR"/* "$TARGET_DIR/"
    
    echo ""
    echo "✓ 所有文件下载并配置完成"
    echo ""
    echo "测试模型加载..."
    node -e "
const {pipeline} = require('@huggingface/transformers');
pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
  .then(() => console.log('✓✓✓ 模型配置成功！✓✓✓'))
  .catch(err => {
    console.error('✗ 模型加载失败:', err.message);
    process.exit(1);
  });
"
fi

echo ""
echo "=========================================="
echo "✓ 配置完成！"
echo "=========================================="
