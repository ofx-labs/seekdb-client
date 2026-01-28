# 版本更新通知 - 快速开始

## 5 分钟快速上手

### 1. 功能已自动启用

✅ 无需任何配置，版本更新通知功能已默认启用！

### 2. 体验更新通知

#### 选项 A：等待真实更新
当插件发布新版本时，VS Code 会自动更新，然后显示更新日志。

#### 选项 B：立即测试（开发者）

```bash
# 1. 运行测试脚本
cd /Users/qianzhang/Downloads/files/devkit-vscode-ext
./scripts/test-update-notification.sh

# 2. 选择 "1" 模拟小版本更新

# 3. 编译
npm run compile

# 4. 按 F5 启动调试

# 5. 查看更新日志面板
```

### 3. 手动查看更新日志

随时查看：

1. 按 `Cmd+Shift+P` (macOS) 或 `Ctrl+Shift+P` (Windows/Linux)
2. 输入 `seekdb: 查看更新日志`
3. 回车

### 4. 自定义配置（可选）

如果不想看到自动通知：

```json
// settings.json
{
  "seekdb.updateNotification.enabled": false
}
```

## 界面预览

更新日志界面包含：

```
┌────────────────────────────────────┐
│     🗄️                             │
│  seekdb-client 已更新              │
│                                    │
│  v0.0.2  →  v0.1.0                │
├────────────────────────────────────┤
│                                    │
│  ## Changelog                      │
│                                    │
│  ### ✨ New                        │
│  - 版本更新通知                     │
│  - 自动检测版本变化                 │
│                                    │
│  ### 🐛 Fixes                      │
│  - 暂无修复                         │
│                                    │
├────────────────────────────────────┤
│  [开始使用]  [查看完整日志]         │
└────────────────────────────────────┘
```

## 下一步

- 📖 阅读[完整文档](./UPDATE_NOTIFICATION.md)
- 📝 查看[使用指南](./UPDATE_NOTIFICATION_GUIDE.md)
- 🔧 浏览[源代码](../src/services/UpdateNotificationService.ts)

## 常见操作

### 查看当前版本
```bash
node -p "require('./package.json').version"
```

### 查看 CHANGELOG
```bash
cat CHANGELOG.md
```

### 清除版本记录（开发测试用）
1. 命令面板 → `Developer: Open Extension Host Storage`
2. 删除 `seekdb.lastVersion`

---

**提示**: 如有任何问题，请查看[常见问题](./UPDATE_NOTIFICATION_GUIDE.md#常见问题)部分。
