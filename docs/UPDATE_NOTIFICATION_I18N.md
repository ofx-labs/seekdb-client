# 版本更新通知 - 国际化功能说明

## 功能概述

版本更新通知现在完全支持国际化（i18n），能够根据用户的 VS Code 语言设置自动显示对应语言的界面和更新日志。

## 支持的语言

- **中文（简体）**: `zh-CN`
- **English**: `en`

## 工作原理

### 1. 自动语言检测

系统会自动检测 VS Code 的语言设置（`vscode.env.language`）：

```typescript
private detectLocale(): string {
  const vscodeLocale = vscode.env.language;
  
  // 如果是中文相关的语言，统一返回 zh-CN
  if (vscodeLocale.startsWith("zh")) {
    return "zh-CN";
  }
  
  // 默认返回英文
  return "en";
}
```

### 2. 多语言 CHANGELOG 文件

项目现在包含三个 CHANGELOG 文件：

- `CHANGELOG.md` - 双语版本（作为入口，包含中英文链接）
- `CHANGELOG.zh-CN.md` - 中文完整版
- `CHANGELOG.en.md` - 英文完整版

### 3. 智能文件加载

系统会按照以下优先级加载 CHANGELOG：

```
1. CHANGELOG.{locale}.md（如：CHANGELOG.zh-CN.md）
   ↓ 如果不存在
2. CHANGELOG.md（默认版本）
```

### 4. UI 文本国际化

所有界面文本都通过 `I18nTexts` 接口进行管理：

```typescript
interface I18nTexts {
  title: string;              // 标题
  subtitle: string;           // 副标题
  versionFrom: string;        // 版本标签
  versionTo: string;          // 版本标签
  btnStart: string;           // 开始按钮
  btnChangelog: string;       // 查看日志按钮
  footerText: string;         // 页脚文本
  footerLink: string;         // 页脚链接
  panelTitle: string;         // 面板标题
  errorLoadVersion: string;   // 错误消息
  errorLoadChangelog: string; // 错误消息
  errorOpenChangelog: string; // 错误消息
  noChangelog: string;        // 无日志提示
}
```

## 界面对比

### 中文界面 (zh-CN)

```
┌─────────────────────────────────────┐
│     seekdb-client 更新说明          │
│  感谢您的使用！来看看新版本带来了什么。│
│                                     │
│    v0.0.2  →  v0.1.0               │
├─────────────────────────────────────┤
│  [更新内容...]                       │
├─────────────────────────────────────┤
│  [开始体验]  [完整日志]              │
│                                     │
│  遇到问题？访问 GitHub 反馈          │
└─────────────────────────────────────┘
```

### 英文界面 (en)

```
┌─────────────────────────────────────┐
│   seekdb-client Update Notes        │
│  Thank you for using! Let's see     │
│  what's new in this version.        │
│                                     │
│    v0.0.2  →  v0.1.0               │
├─────────────────────────────────────┤
│  [Update Content...]                │
├─────────────────────────────────────┤
│  [Get Started]  [Full Changelog]   │
│                                     │
│  Having issues? Visit GitHub        │
└─────────────────────────────────────┘
```

## 如何添加新语言

### 步骤 1: 添加语言支持

在 `UpdateNotificationService.ts` 的 `detectLocale()` 方法中添加新语言：

```typescript
private detectLocale(): string {
  const vscodeLocale = vscode.env.language;
  
  const supportedLocales = ["zh-CN", "zh-TW", "en", "ja", "ko"]; // 添加日语、韩语
  
  // ... 语言检测逻辑
}
```

### 步骤 2: 添加翻译文本

在 `getI18nTexts()` 方法中添加新语言的翻译：

```typescript
private getI18nTexts(locale: string): I18nTexts {
  const texts: { [key: string]: I18nTexts } = {
    "zh-CN": { /* 中文 */ },
    "en": { /* 英文 */ },
    "ja": {
      title: "seekdb-client アップデート情報",
      subtitle: "ご利用ありがとうございます！新バージョンの内容をご覧ください。",
      // ... 其他翻译
    },
  };
  
  return texts[locale] || texts["en"];
}
```

### 步骤 3: 创建对应的 CHANGELOG 文件

```bash
# 创建日语版本
cp CHANGELOG.en.md CHANGELOG.ja.md
# 然后翻译内容
```

### 步骤 4: 更新主 CHANGELOG.md

在主 CHANGELOG.md 文件顶部添加新语言链接：

```markdown
## Changelog

> 📖 **语言 / Language**: [中文](./CHANGELOG.zh-CN.md) | [English](./CHANGELOG.en.md) | [日本語](./CHANGELOG.ja.md)
```

## 测试国际化功能

### 测试中文界面

1. 打开 VS Code 设置
2. 搜索 "Display Language"
3. 选择 "中文（简体）"
4. 重启 VS Code
5. 触发更新通知

### 测试英文界面

1. 打开 VS Code 设置
2. 搜索 "Display Language"
3. 选择 "English"
4. 重启 VS Code
5. 触发更新通知

### 手动测试特定语言

在代码中临时修改：

```typescript
constructor(context: vscode.ExtensionContext) {
  this.context = context;
  this.locale = "en"; // 强制使用英文
  this.i18n = this.getI18nTexts(this.locale);
}
```

## 文件结构

```
devkit-vscode-ext/
├── CHANGELOG.md           # 双语入口版本
├── CHANGELOG.zh-CN.md     # 中文完整版
├── CHANGELOG.en.md        # 英文完整版
└── src/
    └── services/
        └── UpdateNotificationService.ts  # 国际化实现
```

## 国际化最佳实践

### 1. 保持翻译一致性

- 所有语言版本的 CHANGELOG 结构应保持一致
- 使用相同的版本号和日期格式
- 保持段落和列表项的对应关系

### 2. 文化适配

- 注意日期格式的差异（如：2025-01-26 vs 26/01/2025）
- 考虑不同语言的阅读习惯
- 使用符合当地文化的表达方式

### 3. 维护便捷性

- 使用自动化工具同步 CHANGELOG 结构
- 考虑使用 i18n 管理工具
- 建立翻译审核流程

## 常见问题

### Q1: 为什么我看到的还是英文？

A: 检查以下几点：
1. VS Code 的语言设置是否正确
2. 是否存在对应语言的 CHANGELOG 文件
3. 是否重新编译了代码（`npm run compile`）

### Q2: 如何强制使用特定语言？

A: 可以通过修改 VS Code 的 `locale` 设置：

```json
// settings.json
{
  "locale": "zh-CN"
}
```

### Q3: 支持自动翻译吗？

A: 目前不支持。所有翻译都需要手动维护，以确保质量和准确性。

### Q4: 可以添加区域变体吗（如 en-US, en-GB）？

A: 可以。只需在 `detectLocale()` 和 `getI18nTexts()` 中添加对应的处理逻辑。

## 贡献翻译

欢迎贡献其他语言的翻译！

### 贡献步骤

1. Fork 项目
2. 创建新的 CHANGELOG 文件（如 `CHANGELOG.ja.md`）
3. 在 `UpdateNotificationService.ts` 中添加语言支持
4. 测试翻译效果
5. 提交 Pull Request

### 翻译指南

- 保持专业术语的一致性
- 遵循目标语言的语法习惯
- 保留代码片段和命令不翻译
- 注意上下文的连贯性

## 技术细节

### 语言检测流程

```
用户打开 VS Code
    ↓
检测 vscode.env.language
    ↓
映射到支持的语言代码
    ↓
加载对应的 i18n 文本
    ↓
查找对应的 CHANGELOG 文件
    ↓
渲染界面
```

### 性能考虑

- 语言检测只在服务初始化时进行一次
- CHANGELOG 文件按需加载
- 翻译文本存储在内存中，无需重复读取

## 未来改进

- [ ] 支持更多语言（日语、韩语、法语等）
- [ ] 添加语言切换按钮（允许用户手动选择）
- [ ] 支持从远程加载翻译文件
- [ ] 添加翻译质量检查工具
- [ ] 集成自动翻译 API（可选）

---

**最后更新**: 2025-01-26  
**版本**: v0.1.0  
**支持语言**: 中文（zh-CN）、英文（en）
