<div align="center">

# ZANYSURF - Autonomous AI Browser Agent

Give it a goal. It does the work.

[![Manifest](https://img.shields.io/badge/Manifest-V3-2ea44f)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Chrome](https://img.shields.io/badge/Chrome-Extension-4285F4)](https://developer.chrome.com/docs/extensions/)
[![Edge](https://img.shields.io/badge/Edge-Compatible-0078D4)](https://microsoftedge.microsoft.com/addons/)
[![Version](https://img.shields.io/badge/Version-2.1.0-6f42c1)](manifest.json)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

</div>

ZANYSURF is a Chrome and Edge extension that turns any LLM into a private, autonomous web agent. Type what you want in plain English. It plans, browses, clicks, fills forms, and reports back with full transparency.

If ZANYSURF saves you time, please star the repo.

---

## Highlights

- Summarize YouTube: extract key takeaways from long videos and jump to timestamps.
- All-in-one models: OpenAI, Claude 4, Gemini, Llama, and more (bring your own keys).
- Chat with PDFs and pages: drop PDF, DOC, TXT, or XLS to get answers fast.
- Dive the web: research any site with answers and citations.
- Response faster: set tone and craft emails, replies, or tweets in seconds.
- Monitor prices: track price drops and back-in-stock alerts across marketplaces.
- Automate your work: navigate, extract, click, and fill forms.
- Integrate with 1000+ apps: Make.com and Zapier workflows.

---

## Quick Start

Option A - Free, local (recommended)
1. Install Ollama: https://ollama.com
2. Run: `ollama pull llama3.2`
3. Load the `extension/` folder in Chrome or Edge (developer mode)
4. Open the ZANYSURF side panel, select Ollama, type your goal

Option B - Cloud API
1. Load the `extension/` folder
2. Settings -> choose provider -> add API key
3. Type your goal and go

Option C - Edge built-in AI (if available)
1. Load the `extension/` folder in Edge
2. Select Edge Built-in AI

---

## Screenshots

Add screenshots here:

- docs/screenshots/overview.png
- docs/screenshots/agent-run.png
- docs/screenshots/price-compare.png
- docs/screenshots/settings.png

Example usage in README:

![Overview](docs/screenshots/overview.png)
![Agent Run](docs/screenshots/agent-run.png)

See the screenshot placeholder guide: [docs/screenshots/README.md](docs/screenshots/README.md)

---

## Features

Core agent
- Plan-and-execute with reflexion
- Multi-tab orchestration with dependency graphs
- Vision mode for sparse DOM pages
- Safe mode with approval gates
- Local memory and knowledge graph

Automation
- Scheduler for recurring goals
- Workflow replay and audit logs
- CSV export for extracted data

Price comparison
- Auto-open marketplace tabs
- Extract prices per tab
- Synthesize results and export CSV

---

## LLM Providers

| Provider | Notes |
|---|---|
| Ollama | Local and private, no server required |
| Gemini | Long context for research tasks |
| OpenAI | General purpose |
| Claude | Strong reasoning |
| Groq | Very fast |
| Mistral | Cost efficient |
| Edge Built-in | Zero-setup on Edge |

---

## Install (Chrome and Edge)

Chrome
1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked -> select `extension/`

Edge
1. Open `edge://extensions`
2. Enable Developer mode
3. Load unpacked -> select `extension/`

From source
```bash
git clone https://github.com/ZANYANBU/Chrome_Assist_AI.git
cd Chrome_Assist_AI
npm install
npm run build
```

---

## Configuration

Open the ZANYSURF side panel and click the settings icon.

| Setting | Description |
|---|---|
| Provider | Choose Ollama, Gemini, OpenAI, Claude, Groq, Mistral, or Edge Built-in |
| Ollama URL | Default: http://localhost:11434 |
| API Key | Encrypted in the local vault |
| Safe Mode | Require approval for risky actions |
| Memory | Toggle short-term and long-term memory |

---

## Permissions Explained

| Permission | Why it is needed |
|---|---|
| activeTab | Read and interact with the current page |
| scripting | Inject scripts for actions |
| storage | Save settings, memory, and vault |
| alarms | Run scheduled tasks |
| tabs | Multi-tab orchestration |
| downloads | CSV exports |
| sidePanel | Persistent UI in Chrome/Edge |

---

## Architecture (High Level)

Popup and side panel -> Service worker (agent loop) -> Content script (DOM + actions)

Key components:
- LLMGateway: provider routing
- MemorySystem: short/long memory + retrieval
- OrchestratorAgent: multi-agent pipelines
- Risk guards: approvals for critical actions

---

## Changelog

Mar 4, 2026
- Added price comparison planning and marketplace search URLs.
- Improved vision-mode click reliability.
- Reduced prompt bloat with context and DOM budgeting.
- Added chat vs task intent detection.
- Updated README and version to 2.1.0.

---

## Docs

- Privacy policy: [docs/index.md](docs/index.md)
- Launch playbook: [docs/LAUNCH.md](docs/LAUNCH.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)

---

## Repository Structure

```
byom-ai-browser-agent/
├─ extension/           # Load this folder in Chrome/Edge
│  ├─ background.js
│  ├─ content.js
│  ├─ popup.html
│  ├─ popup.js
│  ├─ popup.css
│  ├─ manifest.json
│  └─ icons/
├─ docs/                # Privacy policy and screenshots
├─ src/                 # Core modules
├─ background.js        # Root mirror (keep in sync)
├─ content.js           # Root mirror (keep in sync)
└─ README.md
```

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit: `git commit -m "feat: your feature"`
4. Push and open a Pull Request

---

## License

MIT License - see [LICENSE](LICENSE).

Privacy policy: [docs/index.md](docs/index.md)
