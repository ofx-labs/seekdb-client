# 版本更新通知功能

## 概述

seekdb-client 插件现在支持自动检测版本更新并展示更新日志。每次插件更新后，会自动打开一个美观的 WebView 页面展示本次版本的更新特性。

## 功能特性

### 1. 自动检测版本更新

- 插件在激活时会自动检测版本变化
- 如果检测到版本更新，会自动展示更新日志页面
- 首次安装时不会显示更新通知

### 2. 美观的更新日志界面

- 使用 VS Code 原生主题样式
- 清晰展示版本变化（从旧版本 → 新版本）
- 分类展示更新内容：
  - ✨ 新功能（New Features）
  - 🐛 Bug 修复（Bug Fixes）
  - 📝 改进（Improvements）
- 支持 Markdown 格式的更新日志解析

### 3. 国际化支持 (新增)

- **自动语言检测**: 根据 VS Code 语言设置自动显示对应语言
- **支持语言**: 中文（zh-CN）和英文（en）
- **多语言 CHANGELOG**: 支持加载不同语言的更新日志文件
- **完整 UI 翻译**: 所有界面文本都经过本地化
- **智能回退**: 如果没有对应语言的文件，自动使用默认版本

### 4. 用户操作

更新日志页面提供两个操作按钮：

- **开始使用**：关闭更新日志，开始使用新版本
- **查看完整日志**：在编辑器中打开 CHANGELOG.md 文件

### 4. 手动查看更新日志

用户可以随时通过命令面板查看更新日志：

1. 按 `Cmd+Shift+P` (macOS) 或 `Ctrl+Shift+P` (Windows/Linux)
2. 输入 `seekdb: 查看更新日志`
3. 回车执行命令

## 配置选项

可以在 VS Code 设置中配置是否启用更新通知：

```json
{
  "seekdb.updateNotification.enabled": true
}
```

- `true`（默认）：启用自动更新通知
- `false`：禁用自动更新通知（仍可手动查看）

## 实现细节

### 文件结构

```
src/
├── services/
│   └── UpdateNotificationService.ts  # 更新通知服务
└── core/
    └── ExtensionManager.ts            # 扩展管理器（集成更新检测）
```

### 工作流程

1. **版本检测**
   - 读取 `package.json` 获取当前版本
   - 从 VS Code 全局状态读取上次记录的版本
   - 比较两个版本，判断是否有更新

2. **更新通知**
   - 如果版本变化，创建 WebView 面板
   - 读取并解析 `CHANGELOG.md` 文件
   - 将 Markdown 转换为 HTML 并应用样式
   - 显示更新日志页面

3. **版本记录**
   - 显示更新日志后，更新全局状态中的版本记录
   - 下次启动时使用新版本号进行比较

### 样式设计

更新日志页面完全遵循项目的设计风格：

- 使用 VS Code 原生 CSS 变量
- 深色主题优先
- 响应式布局，支持移动端查看
- 平滑的过渡动画
- 清晰的信息层次

## 更新日志格式

为确保更新通知正确解析和显示，建议在 `CHANGELOG.md` 中使用以下格式：

```markdown
## Changelog

### `v1.0.0` — 2025‑01‑26

#### ✨ New

- **功能标题**
  - 功能描述1
  - 功能描述2

#### 🐛 Fixes

- 修复描述1
- 修复描述2

#### 📝 Improvements

- 改进描述1
- 改进描述2

---
```

支持的 Markdown 语法：

- 标题：`##`、`###`、`####`
- 列表：`- 项目`
- 粗体：`**粗体文本**`
- 分隔线：`---`
- 引用：`> 引用内容`

## 测试

### 本地测试

1. 修改 `package.json` 中的版本号
2. 重新编译：`npm run compile`
3. 按 F5 启动调试
4. 插件会检测到版本变化并显示更新日志

### 清除版本记录

如果需要重新测试首次安装或版本更新，可以：

1. 在扩展开发主机中打开命令面板
2. 输入 `Developer: Open Extension Host Storage`
3. 找到并删除 `seekdb.lastVersion` 键

## 未来改进

- [ ] 支持更丰富的 Markdown 语法
- [ ] 添加更新日志搜索功能
- [ ] 支持多语言版本的更新日志
- [ ] 添加更新统计（如查看次数）
- [ ] 支持从远程服务器获取更新日志

## 相关命令

- `seekdb.showUpdateLog` - 查看更新日志

## 相关配置

- `seekdb.updateNotification.enabled` - 启用/禁用更新通知

## 参考

- [CHANGELOG.md](../CHANGELOG.md) - 完整的更新日志
- [VS Code API - WebView](https://code.visualstudio.com/api/extension-guides/webview)
- [VS Code API - GlobalState](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext)
