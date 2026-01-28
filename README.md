# seekdb Client

## Overview

**seekdb Client** is a VS Code extension toolkit built _for personal developers_, delivering powerful database management and development workflows. Deeply integrated with the **seekdb** database system—and fully compatible with **MySQL**—it unifies database operations under one intuitive interface.

---

## Key Features

| Feature                    | Description                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| **Multi‑Database Support** | Connect to and manage both **seekdb** and **MySQL** instances seamlessly.                  |
| **Visual UI**              | Modern React‑based WebView interface with intuitive navigation and actions.                |
| **Smart Code Completion**  | Hover and jump-to-definition for `getOrCreateCollection()` in your editor.                 |
| **Vector Search**          | Built‑in AI vectorization enables _semantic similarity search_—no raw embeddings required. |
| **SQL Execution**          | Run ad‑hoc SQL queries, inspect results, and benchmark execution time.                     |
| **Collection Browser**     | Browse, search, and inspect Collections without writing a single query.                    |
| **Update Notifications**   | Automatic version update notifications with beautiful changelog display (i18n support).    |
| **Environment Preflight**  | Docker and SeekDB instance health checks with detailed diagnostic reports.                 |

---

## Functionality

### 🗄️ Database Connection Management

- **Create connections** with host, port, username, password, etc.
- **Test connections** before saving.
- **Multi‑connection support**: manage & switch between numerous databases.
- **Persistent config**: connections auto‑saved across sessions.
- **Default presets**: host (`127.0.0.1`), port (`2881`), tenant (`sys`), DB (`test`), user (`root`)—configurable per project.

### 📊 Collection Browser

- **Tree view** of databases and Collections.
- **One‑click preview**: click a Collection to see its data instantly.
- **SQL pane**: write and run queries inline; results rendered in a sortable/filterable table.
- **Execution stats**: query latency + row count for performance profiling.

### 🔍 Smart Vector Search

- **Semantic queries**: search with natural language, not just keywords.
- **Cosine similarity**: accurate matching powered by vector embeddings.
- **Model flexibility**:
  - **Built‑in**: local, zero‑config (`Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers`)
  - **Auto-cached**: model downloads once (~87MB), then runs locally without network
  - **Model info display**: shows both Collection Model and Search Model with mismatch warnings
- **On‑the‑fly model switching** per search.
- **Relevance ranking**: results auto‑sorted by similarity score.

### 💡 Code Intelligence

- **Hover tooltips**: show Collection schema/data count when hovering `name` in `getOrCreateCollection(...)`.
- **Peek & jump**: ⌘+Click (or Ctrl+Click) to open the Collection in the browser.
- **File support**: `.ts`, `.js`, `.tsx`, `.jsx`.
- **Contextual awareness**: auto‑detects Collection names from code.

### ⚙️ Configuration

- Default connection parameters (host, port, tenant, DB, user)
- Vectorization backend selection (local vs. OpenAI)
- OpenAI API key management (encrypted at rest)
- Update notification settings (`seekdb.updateNotification.enabled`)
- HuggingFace mirror selection (`seekdb.database.embedding.huggingFaceMirror`)
- Environment preflight configuration (`seekdb.preflight.*`)
  - Enable/disable preflight checks
  - Toggle individual checks (Docker, image, instance)
  - Control progress notifications

### 🌍 Internationalization (i18n)

- **Automatic locale detection**: Detects VS Code language settings automatically.
- **Supported languages**: 
  - 简体中文 (zh-CN) - Simplified Chinese
  - English (en)
- **Localized content**:
  - All UI text and messages
  - Version update notifications
  - CHANGELOG documentation
- **Smart fallback**: Gracefully falls back to English for unsupported languages.
- **Zero configuration**: Works out of the box without manual setup.

### 🎨 UX Details

- **Theme sync**: automatically matches VS Code’s light/dark mode.
- **Responsive layout**: adapts to sidebar width and window resizing.
- **Clear error feedback**: actionable messages for misconfigurations.
- **Loading indicators**: progress bars for long operations.
- **Native keybindings**: respects standard VS Code shortcuts (e.g., `Esc`, `Cmd+P`).

---


### 🔔 Version Updates

- **Automatic update detection**: Detects when the extension is updated to a new version.
- **Beautiful changelog display**: Shows what's new in a clean, themed WebView panel with version comparison.
- **Multi-language support**: Full i18n support (Chinese & English) with automatic locale detection.
- **Smart content loading**: Automatically loads localized CHANGELOG files with graceful fallback.
- **Manual access**: View update logs anytime via Command Palette (`seekdb: 查看更新日志`).
- **Configurable**: Can be disabled in settings (`seekdb.updateNotification.enabled`).
- **Theme-aware**: Uses VS Code's native color scheme for consistency.

---

### 🏥 Environment Preflight

- **Docker verification**: Automatically checks if Docker is installed and running.
- **SeekDB image detection**: Verifies seekdb Docker image availability.
- **Instance health check**: Confirms seekdb instance is running and accessible.
- **Smart execution**: Runs on startup and on-demand via UI or Command Palette.
- **Detailed diagnostics**: Shows comprehensive reports with actionable recommendations.
- **Configurable checks**: Fine-tune which checks to run via settings (`seekdb.preflight.*`).
- **Progress indicators**: Real-time feedback during environment validation.
- **Manual trigger**: Run checks anytime via Command Palette (`seekdb: 运行环境检查`).

---

## Available Commands

Access these commands via Command Palette (`Cmd/Ctrl+Shift+P`):

| Command | Description |
| ------- | ----------- |
| `seekdb: Database Management` | Open database connection manager |
| `seekdb: Open Collection Browser` | Browse database collections |
| `seekdb: Open Settings` | Configure extension settings |
| `seekdb: Open Documentation` | View documentation |
| `seekdb: 查看更新日志` | View version update changelog |
| `seekdb: 运行环境检查` | Run environment preflight checks |
| `seekdb: 查看环境检查报告` | View preflight diagnostics report |

---

## Getting Started

1. **Install the extension** from VS Code Marketplace
2. **Open Command Palette** (`Cmd/Ctrl+Shift+P`)
3. **Run** `seekdb: Database Management` to create your first connection
4. **Explore** collections, run queries, and leverage vector search!

The extension will automatically check your environment on startup and guide you through any setup requirements.

---

## Documentation

Comprehensive documentation is available in the `/docs` folder:

- **Update Notifications**: 
  - [UPDATE_NOTIFICATION.md](./docs/UPDATE_NOTIFICATION.md) - Feature overview
  - [UPDATE_NOTIFICATION_I18N.md](./docs/UPDATE_NOTIFICATION_I18N.md) - Internationalization guide
  - [UPDATE_NOTIFICATION_GUIDE.md](./docs/UPDATE_NOTIFICATION_GUIDE.md) - Usage guide

- **Quick References**:
  - [I18N_QUICK_REFERENCE.md](./docs/I18N_QUICK_REFERENCE.md) - i18n quick reference
  - [UPDATE_NOTIFICATION_QUICKSTART.md](./docs/UPDATE_NOTIFICATION_QUICKSTART.md) - Quick start guide

---

## Version History

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.

Language-specific changelogs:
- [中文版本历史](./CHANGELOG.zh-CN.md)
- [English Changelog](./CHANGELOG.en.md)

---

## Requirements

- **VS Code**: Version 1.96.0 or higher
- **Node.js**: For local embedding support (optional if using OpenAI)
- **Docker**: For running SeekDB instances (verified by preflight checks)

---

## Contributing

We welcome contributions! Please feel free to:

- Report bugs via [GitHub Issues](https://github.com/ofx-labs/seekdb-client/issues)
- Submit feature requests
- Contribute translations for additional languages

---

## License

See LICENSE file for details.

---

**Made with ❤️ for developers who value powerful, integrated database tools.**

