## Changelog

> 📖 **语言 / Language**: [中文](./CHANGELOG.zh-CN.md) | [English](./CHANGELOG.en.md)

### `v0.1.0` — 2025‑01‑26

#### ✨ New / 新功能

- **Version Update Notifications / 版本更新通知**
  - Automatically displays changelog after plugin updates / 插件更新后自动展示更新日志
  - Beautiful WebView interface showing version changes / 美观的 WebView 界面展示版本变化
  - Support for viewing complete CHANGELOG documentation / 支持查看完整 CHANGELOG 文档
  - Automatic version change detection / 自动检测版本变更并提示用户
  - Multi-language support (Chinese and English) / 多语言支持（中文和英文）

#### 🐛 Fixes / 问题修复

- _No fixes yet / 暂无修复_.

#### 📝 Improvements / 功能改进

- _No improvements yet / 暂无改进_.

---

### `v0.0.2` — 2025‑12‑10

#### ✨ New

- **Connection Manager**
  - Create/edit/test seekdb & MySQL connections
  - CRUD for connection profiles (add/delete/edit)
- **Collection Browser**
  - Tree‑based navigation
  - One‑click data preview
  - Inline SQL execution & result table
  - Query latency & row count metrics
- **Vector Search**
  - Local embeddings via `@huggingface/transformers`
  - OpenAI API integration
  - Semantic similarity scoring & ranked results
- **Code Intelligence**
  - Hover info for `getOrCreateCollection(...)`
  - Jump to Collection viewer
  - TS/JS/TSX/JSX support
- **Settings UI**
  - Default DB parameters (host, port, tenant, etc.)
  - Embedding model selector + OpenAI key input
- **UI**
  - React‑powered WebView
  - Theme‑aware styling
  - Fully responsive layout

#### 🐛 Fixes

- _Initial release_ — no fixes yet.

#### 📝 Improvements

- _Initial release_ — no enhancements yet.

---

> **Tip for U.S. devs**: This extension _doesn’t override_ your existing workflows—it _augments_ them. Use SQL when you want full control; use vector search when you want semantic intent. All data stays local unless you explicitly opt into cloud APIs.
