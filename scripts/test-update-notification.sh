#!/bin/bash

# 版本更新通知测试脚本
# 用于测试插件的版本更新通知功能

echo "========================================"
echo "seekdb-client 版本更新通知测试脚本"
echo "========================================"
echo ""

# 获取当前版本
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "当前版本: $CURRENT_VERSION"
echo ""

# 提示用户选择操作
echo "请选择测试操作："
echo "1. 模拟小版本更新 (patch: 0.1.0 -> 0.1.1)"
echo "2. 模拟中版本更新 (minor: 0.1.0 -> 0.2.0)"
echo "3. 模拟大版本更新 (major: 0.1.0 -> 1.0.0)"
echo "4. 恢复原始版本"
echo "5. 退出"
echo ""

read -p "请输入选项 (1-5): " choice

case $choice in
  1)
    # 小版本更新
    NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{print $1"."$2"."$3+1}')
    echo "更新版本号为: $NEW_VERSION"
    sed -i.bak "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
    echo "✅ 版本号已更新为 $NEW_VERSION"
    echo "📝 原版本已备份为 package.json.bak"
    ;;
  2)
    # 中版本更新
    NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{print $1"."$2+1".0"}')
    echo "更新版本号为: $NEW_VERSION"
    sed -i.bak "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
    echo "✅ 版本号已更新为 $NEW_VERSION"
    echo "📝 原版本已备份为 package.json.bak"
    ;;
  3)
    # 大版本更新
    NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{print $1+1".0.0"}')
    echo "更新版本号为: $NEW_VERSION"
    sed -i.bak "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
    echo "✅ 版本号已更新为 $NEW_VERSION"
    echo "📝 原版本已备份为 package.json.bak"
    ;;
  4)
    # 恢复原始版本
    if [ -f "package.json.bak" ]; then
      mv package.json.bak package.json
      echo "✅ 已恢复原始版本"
    else
      echo "❌ 未找到备份文件 package.json.bak"
    fi
    ;;
  5)
    echo "👋 退出测试脚本"
    exit 0
    ;;
  *)
    echo "❌ 无效选项"
    exit 1
    ;;
esac

echo ""
echo "下一步操作："
echo "1. 运行 'npm run compile' 编译代码"
echo "2. 按 F5 启动调试会话"
echo "3. 查看是否显示版本更新通知"
echo ""
echo "如需恢复原始版本，请重新运行此脚本并选择选项 4"
echo ""
