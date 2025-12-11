# SeekDB Client

## Overview

**SeekDB Client** is a VS Code extension toolkit built _for personal developers_, delivering powerful database management and development workflows. Deeply integrated with the **SeekDB** database system—and fully compatible with **MySQL**—it unifies database operations under one intuitive interface.

---

## Key Features

| Feature                    | Description                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| **Multi‑Database Support** | Connect to and manage both **SeekDB** and **MySQL** instances seamlessly.                  |
| **Visual UI**              | Modern React‑based WebView interface with intuitive navigation and actions.                |
| **Smart Code Completion**  | Hover and jump-to-definition for `getOrCreateCollection()` in your editor.                 |
| **Vector Search**          | Built‑in AI vectorization enables _semantic similarity search_—no raw embeddings required. |
| **SQL Execution**          | Run ad‑hoc SQL queries, inspect results, and benchmark execution time.                     |
| **Collection Browser**     | Browse, search, and inspect Collections without writing a single query.                    |

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
  - **Built‑in**: local, zero‑config (`@huggingface/transformers`).
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

### 🎨 UX Details

- **Theme sync**: automatically matches VS Code’s light/dark mode.
- **Responsive layout**: adapts to sidebar width and window resizing.
- **Clear error feedback**: actionable messages for misconfigurations.
- **Loading indicators**: progress bars for long operations.
- **Native keybindings**: respects standard VS Code shortcuts (e.g., `Esc`, `Cmd+P`).

---
