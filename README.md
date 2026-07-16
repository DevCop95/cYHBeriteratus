# cYHBer Console 💀

![Cover](public/img/wrong.png)

A local, cyberpunk / hacker-style web interface wired to `Ollama` that supports **Autonomous Agents (Tool Calling)**, **abliterated models** (uncensored), smooth real-time streaming, and a secure "Zero-Dependency" architecture (no external npm modules).

## 🔥 Features

- **Chat UI (Termux-style):** A messaging-app layout with left/right chat bubbles, live Markdown rendering (headings, lists, links, code blocks with copy buttons), a blood-drip welcome screen, typing indicator, toast notifications, and a live clock — all in a black-and-blood-red terminal aesthetic.
- **Agent Engine (Tools):** The model can run real actions on your machine when agent mode is enabled:
  - `web_fetch`: read articles from the internet (60s cache to avoid duplicate requests).
  - `web_search`: search the web via DuckDuckGo (60s cache, redirect handling, link-extraction fallback).
  - `read_file` / `write_file` / `list_directory`: operate on your filesystem (sandboxed).
  - `run_command`: run commands in PowerShell (non-blocking, via `execFile`).
- **Session persistence:** Conversation history is stored on the server (in memory, 24h TTL). Opening a new tab restores the context automatically from the server without losing any messages.
- **Agent rounds control:** A numeric input (1–20) in the toolbar controls how many tool rounds the agent may run per response, without editing files.
- **Security (Sandboxing):**
  - Directory-traversal prevention (the model cannot escape the project directory).
  - SSRF blocking for IPv4 and IPv6 (the model cannot scan your local network via `web_fetch`).
  - Rate limiting with automatic memory cleanup and protection against oversized payloads.
  - Type validation on every message field (`role` and `content`).
  - CSP headers to prevent XSS.
- **Live selector:** Switch models on the fly from the interface without restarting the server.
- **Efficient streaming:** The agent loop and chat mode share the same streaming core (`ollamaStreamRound`) — no duplicated code.
- **Memory management:** Sliding history window (last 20 messages) to avoid context overflow in long sessions.
- **Disconnect cleanup:** If the client closes the tab mid-response, the agent loop and the Ollama request are cancelled immediately.
- **Built-in test suite:** 59 tests with `npm test` using the native Node.js runner — no external dependencies.

---

## 🛠 Quick Install

### 1. Install prerequisites
Make sure you have installed:
- **[Node.js](https://nodejs.org/en/)** v18 or newer.
- **[Ollama](https://ollama.com/download)**.

### 2. Configure environment variables (optional)
Copy `.env.example` to `.env` and adjust the values for your setup:

```powershell
copy .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `APP_PORT` | `4000` | Web interface port |
| `OLLAMA_HOST` | `127.0.0.1` | Ollama host |
| `OLLAMA_PORT` | `11434` | Ollama port |
| `OLLAMA_MODEL` | `richardyoung/qwen2.5-3b-instruct-abliterated` | Default model |
| `OLLAMA_NUM_GPU` | `null` (auto) | GPU layers. `0` = force CPU |
| `LOG_LEVEL` | `INFO` | Log level: `DEBUG`, `INFO`, `WARN`, `ERROR` |

### 3. Download the models
Open your terminal (PowerShell or CMD) and pull the recommended models. The system auto-detects the ones you have installed.

```powershell
# Option 1: Qwen3 8B abliterated — reasoning + tool calling, most complete (~6 GB VRAM)
ollama pull huihui_ai/qwen3-abliterated:8b

# Option 2: Josiefied-Qwen3 8B — uncensored without losing tool calling (~6 GB VRAM)
ollama pull goekdenizguelmez/JOSIEFIED-Qwen3:8b

# Option 3: Granite 4.1 3B abliterated — modern, with tools, ideal for standard PCs
ollama pull huihui_ai/granite4.1-abliterated:3b

# Option 4: NeuralDaredevil 8B — best classic 8B on the Open LLM Leaderboard (chat only, no tools)
ollama pull closex/neuraldaredevil-8b-abliterated

# Option 5: Abliterated 3B — for very low-resource PCs (default model)
ollama pull richardyoung/qwen2.5-3b-instruct-abliterated
```

> **Important for Agent Mode:** tools only work with models that support *tool calling* (Qwen2.5/Qwen3, Granite, Gemma families with a `tools` tag). Classic Llama 3–based models like NeuralDaredevil work in chat mode only.

*(Note: make sure Ollama is running in the background, by default on port `11434`.)*

### 4. Start the cYHBer Console server

```powershell
node server.js
```

### 5. Enter the system
Open your web browser and go to:
👉 **[http://127.0.0.1:4000](http://127.0.0.1:4000)**

---

## 🧪 Tests

```powershell
npm test
```

Covers: message validation, rate limiter, log levels, SSRF protection (21 IPv4/IPv6 cases), path sandboxing, file operations and command execution. No external dependencies — uses the native `node:test` runner.

---

## 🏗 Project Architecture

This project does not require `npm install` because it uses only native Node modules (`http`, `fs`, `path`, etc.) for maximum speed and security.

```text
cYHBeriteratus/
├─ server.js              # HTTP routes, ollamaStreamRound, agent loop, sessions
├─ tools.js               # Agent tools: sandboxing, cache, IPv4/IPv6 SSRF
├─ src/
│  ├─ config.js           # Global config and environment variables
│  ├─ utils/
│  │  └─ logger.js        # Structured logging, level via LOG_LEVEL
│  └─ middlewares/
│     ├─ security.js      # Rate-limiting (with auto-cleanup) and CSP headers
│     └─ validator.js     # role/content validation on messages
├─ public/
│  ├─ index.html          # Chat UI (Termux-style)
│  ├─ styles.css          # Terminal / blood-red styling
│  ├─ app.js              # Frontend orchestrator (ES modules)
│  └─ modules/
│     ├─ session.js       # Session handling: localStorage + server sync
│     ├─ ui.js            # DOM refs, chat bubbles, tool cards, status
│     ├─ stream.js        # NDJSON streaming parser with callbacks
│     └─ markdown.js      # Dependency-free, CSP-safe Markdown renderer
├─ tests/
│  ├─ validator.test.js
│  ├─ security.test.js
│  ├─ logger.test.js
│  ├─ tools.isPrivateIP.test.js
│  ├─ tools.ssrf.test.js
│  ├─ tools.files.test.js
│  └─ tools.command.test.js
├─ detect-abliterated.py  # Detects abliterated models via Ollama's REST API
└─ .env.example           # Environment variable template
```

## 🔒 Agent Mode (Tool Calling)
At the top of the screen you'll find a **toggle** to enable "AGENT" mode and a **numeric input** to control the max rounds (1–20).

- **OFF:** The model acts as a standard chatbot (normal, fast text responses).
- **ON:** The model reasons before answering and may decide to use system tools (search the web, run scripts, etc.) to fulfill your request.

> **Warning:** The model can modify files inside the project. Use it at your own risk!

## 🔍 Detect Abliterated Models

```powershell
python detect-abliterated.py
```

Queries Ollama's REST API (`/api/tags`) and lists all installed abliterated models with their real size in GB/MB.
