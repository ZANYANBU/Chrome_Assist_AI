<div align="center">

# ¦ ZANYSURF Autonomous AI Browser Agent

### Give it a goal. It does the work.

ZANYSURF is a Chrome and Edge extension that turns any LLM into a fully autonomous web agent.<br>
Type what you want in plain English. It plans, browses, clicks, fills forms, and reports back â€” showing every reasoning step.

[![Manifest](https://img.shields.io/badge/Manifest-V3-2ea44f)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Chrome](https://img.shields.io/badge/Chrome-Extension-4285F4)](https://developer.chrome.com/docs/extensions/)
[![Edge](https://img.shields.io/badge/Edge-Compatible-0078D4)](https://microsoftedge.microsoft.com/addons/)
[![Version](https://img.shields.io/badge/Version-2.0.0-6f42c1)](manifest.json)
[![Tests](https://img.shields.io/badge/Tests-15%2F15-brightgreen)]()
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

â­ **If ZANYSURF saves you time, please star it!** â€” it makes a real difference for a 2nd-year student.

</div>

---

> **"Research the top 5 mechanical keyboards under $100 and write a comparison in Google Docs"**
>
> ZANYSURF opens Reddit, gathers recommendations, checks Amazon prices across 3 tabs, synthesizes the data, opens Google Docs, and writes the comparison. All while you watch.

> ðŸ“¹ **Demo video coming soon** â€” [watch this space]

**Runs 100% locally with Ollama. No servers. No subscriptions. Your data never leaves your browser.**

| | ZANYSURF | Other Agents |
|--|----------|--------------|
| Runs locally | âœ… Ollama | âŒ Cloud only |
| No server | âœ… | âŒ Sends your data |
| Free forever | âœ… | âŒ Subscription |
| LLM providers | âœ… 6 (Ollama/Gemini/OpenAI/Claude/Groq/Mistral) | âš  1â€“2 |
| Encrypted vault | âœ… AES-GCM | âŒ None |
| Plan-and-Execute | âœ… + Reflexion | âŒ Basic ReAct |
| Multi-agent | âœ… Research/Analysis/Writer/Action | âŒ Single agent |
| Open source | âœ… MIT | âŒ Closed |

---

## Quick Start

**Option A â€” Free, local (recommended)**
1. Download [Ollama](https://ollama.com) and run: `ollama pull llama3.2`
2. Load the `extension/` folder in Chrome/Edge (developer mode, see Install below)
3. Open the ZANYSURF side panel, select **Ollama**, type your goal, hit Enter

**Option B â€” Cloud API (no Ollama needed)**
1. Load the `extension/` folder in Chrome/Edge
2. Settings â†’ choose provider (OpenAI / Claude / Gemini / Groq / Mistral) â†’ add API key
3. Type your goal and go

**Option C â€” Edge with built-in AI (zero setup)**
1. Load the `extension/` folder in Edge
2. Select **Edge Built-in AI** â€” no key needed (uses Phi-3 if available in your Edge build)

---

## Table of Contents

- [What is ZANYSURF?](#what-is-zanysurf)
- [Quick Start](#quick-start)
- [All Features](#all-features)
- [System Architecture](#system-architecture)
- [LLM Providers](#llm-providers)
- [Edge Browser Support](#edge-browser-support)
- [Privacy First](#privacy-first)
- [Install (Chrome & Edge)](#install-chrome--edge)
- [Configuration](#configuration)
- [Permissions Explained](#permissions-explained)
- [Detailed Runtime Workflows](#detailed-runtime-workflows)
- [Testing and Quality Assurance](#testing-and-quality-assurance)
- [Repository Structure](#repository-structure)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License & Credits](#license--credits)

---

## What is ZANYSURF?

ZANYSURF is a production-grade autonomous browser agent implemented entirely inside the Chrome extension runtime (Manifest V3 service worker + content scripts). No proxy server, no backend, no subscription. It accepts plain-English goals, decomposes them into a plan, and executes browser actions step-by-step using a **Plan-and-Execute + Reflexion** loop â€” adapting when steps fail.

Unlike simple browser macros, ZANYSURF maintains **agent memory across sessions**, runs **multi-agent pipelines** for complex research tasks, and guards every high-risk action with a human-in-the-loop approval gate. Every reasoning step is surfaced live in the UI so you always know what it's doing and why.

---

## All Features

### Core Agent
- **ReAct loop** â€” perceive â†’ reason â†’ act â†’ observe â†’ repeat
- **Plan-and-Execute** â€” generates a dependency graph of subtasks before acting
- **Reflexion** â€” self-evaluates failures and replans automatically
- **Vision mode** â€” DOM tree mapping with screenshot fallback
- **Run lifecycle guards** â€” cancellation tokens invalidate stale runs instantly
- **30-step limit** with auto-replanning on exhaustion

### LLM Providers (6 total)
| Provider | Models | Cost | Best For |
|---|---|---|---|
| **Ollama** | Llama 3.2, Mistral, Phi-3 | Free | Privacy, offline |
| **Gemini** | 1.5 Pro, 1.5 Flash | Free tier + paid | Long context |
| **OpenAI** | GPT-4o, GPT-4o-mini | Pay per token | General purpose |
| **Claude** | 3.5 Sonnet, Haiku | Pay per token | Complex reasoning |
| **Groq** | Llama3, Mixtral | Free tier + paid | Ultra-fast inference |
| **Mistral** | Large, 8x22B | Pay per token | Cost-efficient |
| **Edge Built-in** | Phi-3 | Free (browser) | Zero-setup on Edge |

### Memory & Intelligence
- Short-term session context window
- Long-term persistent memory with relevance scoring
- Vector similarity retrieval (cosine)
- 30-day memory decay mechanism
- Knowledge graph with D3.js force visualization

### Privacy & Security
- AES-GCM encrypted credential vault (PBKDF2 key derivation)
- No ZANYSURF servers â€” API calls go directly from your browser to the provider
- Human-in-the-loop risk assessment gates
- Safe mode for isolated, no-persist execution

### Automation
- Task scheduler using Chrome Alarms API
- Workflow recorder + one-click replay
- Smart bookmarks with fuzzy natural language search

### Browser Control
- navigate, click, type, key, scroll, hover, select, wait
- Tab operations: open, activate, wait, multi-tab orchestration with dependency graphs
- Drag/drop, file upload, iframe enter/exit, context menu, keyboard shortcuts

### Power Features
- Multi-agent orchestration: Research / Analysis / Writer / Action agents
- Web extraction + CSV export to clipboard
- Form intelligence with CAPTCHA detection
- Calendar and booking agent integration
- In-extension self-test runner (`selftest.html`)
- 15/15 unit tests passing

---

## System Architecture

```
+â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€+   message   +â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€+   message   +â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€+
â”‚  Popup / SidePanel â”‚ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€> â”‚  Service Worker     â”‚ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€> â”‚  Content Script  â”‚
â”‚  (popup.js / html) â”‚ <â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ â”‚  (background.js)    â”‚ <â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ â”‚  (content.js)    â”‚
+â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€+             +â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€+             +â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€+
                                           â”‚
                     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                     â”‚                     â”‚                    â”‚
              +â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€+    +â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€+    +â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€+
              â”‚ LLMGateway  â”‚    â”‚   MemorySystem    â”‚    â”‚  AES Vault    â”‚
              â”‚ 6 providers â”‚    â”‚  short+long+decay â”‚    â”‚  PBKDF2 keys  â”‚
              +â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€+    +â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€+    +â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€+
                                 +â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€+
                                 â”‚              Chrome APIs                 â”‚
                                 â”‚  scripting Â· storage Â· alarms Â· tabs     â”‚
                                 +â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€+
```

---

## LLM Providers

### Ollama (local â€” recommended for privacy)
```bash
# Install Ollama from https://ollama.com
ollama pull llama3.2
# In ZANYSURF settings: Provider = ollama, URL = http://localhost:11434
```

### OpenAI
Settings â†’ Provider â†’ `openai` â†’ paste API key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

### Claude (Anthropic)
Settings â†’ Provider â†’ `claude` â†’ paste API key from [console.anthropic.com](https://console.anthropic.com)

### Gemini (Google)
Settings â†’ Provider â†’ `gemini` â†’ paste API key from [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)

### Groq
Settings â†’ Provider â†’ `groq` â†’ paste API key from [console.groq.com/keys](https://console.groq.com/keys)

### Mistral
Settings â†’ Provider â†’ `mistral` â†’ paste API key from [console.mistral.ai](https://console.mistral.ai)

---

## Edge Browser Support

ZANYSURF works in Microsoft Edge â€” same `extension/` folder, no code changes needed.

**Install on Edge:**
1. Open `edge://extensions`
2. Toggle **Developer mode** (bottom left)
3. Click **Load unpacked** â†’ select the `extension/` folder

**Edge Add-ons store:** Submission in progress. Link will appear here when live.

**Edge Built-in AI:** ZANYSURF already includes an `edge_builtin` provider that routes to `window.ai` (Phi-3/Phi-4). When Microsoft ships this stably, Edge users get a zero-setup, free, offline inference path â€” no API key, no Ollama, nothing to install.

---

## Privacy First

Your data is yours. Here is exactly where it goes:

| Situation | Where your data goes |
|---|---|
| Ollama provider | Stays on your machine only |
| Cloud provider (OpenAI, Claude, etc.) | Sent directly from your browser to the provider's API. ZANYSURF has no server in the middle. |
| Credentials / API keys | AES-GCM encrypted vault. Never written in plaintext. |
| Browsing actions / DOM content | Used only within your browser tab. Never sent to ZANYSURF. |
| Analytics / telemetry | None. Not present in the codebase. |

---

## Install (Chrome & Edge)

**Chrome:**
1. Download and unzip the latest [Release](https://github.com/ZANYANBU/Chrome_Assist_AI/releases)
2. Open `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** â†’ select the `extension/` folder

**Edge:**
1. Download and unzip the latest [Release](https://github.com/ZANYANBU/Chrome_Assist_AI/releases)
2. Open `edge://extensions`
3. Enable **Developer mode** (bottom left toggle)
4. Click **Load unpacked** â†’ select the `extension/` folder

**From source:**
```bash
git clone https://github.com/ZANYANBU/Chrome_Assist_AI.git
cd Chrome_Assist_AI
npm install && npm run build
# Then load the extension/ folder as above
```

---

## Configuration

Open the ZANYSURF side panel â†’ settings gear icon:

| Setting | What it does |
|---|---|
| Provider | Select Ollama, Gemini, OpenAI, Claude, Groq, Mistral, or Edge Built-in |
| Ollama URL | Change if Ollama runs on a non-default port (default: `http://localhost:11434`) |
| API Key | Enter your cloud provider key (encrypted before storage) |
| Safe Mode | Requires manual approval before any form submission or navigation |
| Memory | Toggle short-term / long-term retention per session |

---

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| `activeTab` | Read and interact with the current page for DOM mapping and actions |
| `scripting` | Inject content scripts to execute browser actions in the page context |
| `storage` | Save memory, vault, settings, and bookmarks locally in your browser |
| `alarms` | Power the task scheduler for recurring background goals |
| `tabs` | Open and activate tabs during multi-tab orchestration |
| `sidePanel` | Open ZANYSURF as a persistent side panel (Chrome/Edge MV3) |
| Host permissions | Make LLM API calls directly to the provider (no ZANYSURF proxy) |


---

## Detailed Runtime Workflows

### Single-agent execution
1. Goal arrives from popup `doSend` → `startNewRun()` creates exclusive run token
2. `runAgentWithPlanning()` generates subtask plan
3. `runAgentLoop()` repeatedly: resolve tab → gather context → LLM reason → safety gate → execute → persist → repeat
4. Terminates on `done` / error / abort / max steps / stale token

### Multi-agent orchestration
1. Goal decomposition via `OrchestratorAgent.decomposeGoal`
2. Dependency graph created — independent steps run in parallel, dependent steps sequential
3. Agent bus events emitted for each transition
4. Results synthesized into final summary

### Cancellation and restart
- `activeRunToken` increments on every cancel/replace
- Every loop iteration verifies token ownership (`isRunTokenCurrent`)
- Stale loops exit before touching the browser — no zombie actions

### Observability events streamed to UI
`AGENT_STATUS` · `AGENT_THINKING` · `AGENT_LOG` · `AGENT_EXEC_RESULT` · `AGENT_PLAN` · `AGENT_PLAN_PROGRESS` · `AGENT_TREE` · `AGENT_BUS_EVENT` · `AGENT_COMPLETE` · `AGENT_ERROR`

---

## Testing and Quality Assurance

```bash
npm test -- --runInBand
```

- **15/15** unit tests passing
- QA reports: [qa/static-validation-report.json](qa/static-validation-report.json)
- In-extension self-test runner: `selftest.html`

**Benchmark highlights:**
- DOM mapping: ~8.89 ms
- Memory retrieval: ~4.61 ms
- Extension load: ~1.20 ms

---

## Repository Structure

```
Chrome_Assist_AI/
├─ extension/           # Load this folder in Chrome/Edge
│   ├─ background.js    # MV3 service worker: agent loop, LLM gateway, scheduler
│   ├─ content.js       # Page context: DOM mapping, action execution, extraction
│   ├─ popup.html       # Side panel UI
│   ├─ popup.js         # UI logic, charts, config
│   ├─ popup.css        # Dark theme (#050505 bg, #00ff88 accent)
│   ├─ manifest.json    # MV3 manifest
│   └─ icons/
├─ src/
│   ├─ agent/           # gateway.js, perception.js, reasoning.js
│   └─ memory/          # rag.js
├─ qa/                  # Test reports and integration checklists
├─ docs/                # Privacy policy (GitHub Pages)
├─ background.js        # Root mirror (keep in sync with extension/)
├─ content.js           # Root mirror (keep in sync with extension/)
└─ README.md
```

**Contributor requirement:** keep `background.js`, `content.js`, `popup.js`, `popup.html`, `popup.css`, and `manifest.json` synchronized between root and `extension/` on every commit.

---

## Roadmap

**Coming in V2.1:**
- Native Edge `window.ai` / Phi-4 integration (zero-setup, offline, free)
- Firefox port
- Voice input for goals
- Mobile browser support

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit: `git commit -m 'feat: your feature'`
4. Push and open a Pull Request

---

## License & Credits

MIT License — see [LICENSE](LICENSE).

Built by **Anbu Chelvan Valavan** — 2nd Year CSE Student.

⭐ **Star this repo if you believe AI should stay on your machine.** ⭐
