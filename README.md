<div align="center">

# ZANYSURF AI Browser Agent

### Enterprise-grade autonomous browser agent (Chrome MV3)

Run natural-language goals as auditable browser workflows with local or cloud LLMs, multi-agent orchestration, strict safety controls, and full operator visibility.

[![Manifest](https://img.shields.io/badge/Manifest-V3-2ea44f)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Platform](https://img.shields.io/badge/Platform-Chrome_Extension-4285F4)](https://developer.chrome.com/docs/extensions/)
[![Version](https://img.shields.io/badge/Version-1.0.1-6f42c1)](manifest.json)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

</div>

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Capability Matrix](#capability-matrix)
- [System Architecture](#system-architecture)
- [Detailed Runtime Workflows](#detailed-runtime-workflows)
- [Feature Specification](#feature-specification)
- [Provider and Model Support](#provider-and-model-support)
- [Setup and Runbook](#setup-and-runbook)
- [Security and Compliance](#security-and-compliance)
- [Testing and Quality Assurance](#testing-and-quality-assurance)
- [Repository Structure](#repository-structure)
- [Operations and Release Workflow](#operations-and-release-workflow)
- [Known Limits and Recovery](#known-limits-and-recovery)
- [License](#license)

---

## Executive Summary

ZANYSURF is a production-grade autonomous browser agent implemented entirely in Chrome extension runtime (Manifest V3 service worker + content scripts). It accepts plain-English goals, plans and executes browser actions, adapts via looped observation, and exposes every major decision through a live operator UI.

### Primary outcomes
- Local-first AI automation with Ollama support
- Cloud provider flexibility (Gemini/OpenAI/Claude/Groq/Mistral)
- Multi-agent research-to-analysis-to-writing pipeline
- Strong governance via risk gates, approvals, audit logs, and encrypted vault
- Deterministic run lifecycle with stale-run invalidation and cancel/restart safety

### Current status
- Release version: `1.0.1`
- Test baseline: `15/15` unit tests passing
- Store readiness: ready with final privacy-policy URL pending publication

---

## Capability Matrix

| Domain | Included |
|---|---|
| Agentic Loop | ReAct-style perceive/reason/act/observe/repeat |
| Planning | Plan-and-execute with replanning on failure |
| Multi-Agent | Research, Analysis, Writer, Action agents |
| Browser Control | Navigate, click, type, select, key, scroll, form actions, tab orchestration |
| Advanced Actions | drag/drop, upload, iframe enter/exit, context click, shortcuts |
| Memory | Short-term context + long-term retrieval |
| Knowledge | Entity graph extraction and retrieval |
| Safety | Risk classification + human approval + safe mode |
| Auditability | Event stream, action log export, replay support |
| Scheduling | Alarm-backed recurring tasks |
| Secrets | AES-GCM encrypted provider key/credential vault |

---

## System Architecture

### Runtime components

- [background.js](background.js)
  - Message router and orchestration core
  - Planning engine + run lifecycle management
  - Multi-agent coordinator
  - Scheduler, memory, bookmarks, vault, metrics, audit

- [content.js](content.js)
  - DOM perception and interaction executor
  - Extraction and page-context synthesis
  - Network/console signal capture hooks
  - Preset-only `execute_js` mode (policy-safe)

- [popup.js](popup.js), [popup.html](popup.html), [popup.css](popup.css)
  - Operator command center and side panel UX
  - Live status, progress, step cards, plan updates, activity feed
  - Provider/model setup and secure key workflows

- [extension/](extension)
  - Packaging/runtime mirror for unpacked extension load path

### Core runtime flow
1. UI submits `RUN_AGENT` or `RUN_MULTI_AGENT`
2. Background starts tokenized run lifecycle
3. Content returns page context and executes actions
4. Background updates memory/state/logs and repeats loop
5. Completion/error/cancel events are streamed to UI

---

## Detailed Runtime Workflows

### 1) Single-agent execution

1. Goal arrives from popup (`doSend`)
2. `startNewRun()` creates exclusive run token ownership
3. `runAgentEntry()` validates and bootstraps session state
4. `runAgentWithPlanning()` generates subtask plan
5. `runAgentLoop()` repeatedly:
   - resolves active tab + readiness
   - gathers context (DOM/vision/history/memory)
   - obtains next action from fast path or LLM
   - applies safety/risk gates
   - executes via content script
   - persists result and emits telemetry
6. Terminates on complete/error/abort/max steps/stale token

### 2) Multi-agent orchestration

1. Goal decomposition via `OrchestratorAgent.decomposeGoal`
2. DAG-like step graph created (dependencies respected)
3. Independent steps run parallel; dependent steps sequential
4. Agent bus events emitted for each transition/result
5. Results synthesized into final operator-facing summary

### 3) Cancellation and restart semantics

Run ownership is tokenized:
- `activeRunToken` increments on cancellation/replacement
- Loops and critical execution points verify ownership (`isRunTokenCurrent`)
- Stale loops exit before further browser actions

User experience when replacing a running goal:
- Old run cancelled and cleared
- Toast shown: `Old run cancelled`
- New run starts immediately
- Toast shown: `New run started`

### 4) Scheduler workflow

1. Goal + schedule captured via UI or parsed intent
2. `SchedulerEngine.createTask` stores normalized task metadata
3. Chrome alarm triggers run
4. Runtime updates `lastRun` and computes `nextRun`

### 5) Memory and knowledge workflow

1. Action traces are recorded during run
2. Retrieval computes relevant top-K memory context
3. Extracted entities update graph store
4. Future prompts incorporate memory and graph context

### 6) Secret management workflow

1. User enters provider key or credential
2. User unlocks vault session with passphrase
3. Data encrypted (AES-GCM) before storage
4. Runtime resolves only provider-relevant key at call time

### 7) Observability workflow

UI consumes event stream:
- `AGENT_STATUS`
- `AGENT_THINKING`
- `AGENT_LOG`
- `AGENT_EXEC_RESULT`
- `AGENT_PLAN` / `AGENT_PLAN_PROGRESS`
- `AGENT_TREE`
- `AGENT_BUS_EVENT`
- `AGENT_COMPLETE` / `AGENT_ERROR`

---

## Feature Specification

### Agent intelligence
- ReAct loop with adaptive fallback
- Planning + replanning
- Multi-agent decomposition and execution

### Browser action coverage
- Core: navigate/click/type/key/hover/select/scroll/wait
- Tab ops: open/activate/wait/open_tabs
- Forms: inspect/fill/login-assisted
- Extraction/synthesis: structured parse + CSV/clipboard export
- Advanced ops: drag_drop/upload/iframe/context menu/shortcuts

### Reliability controls
- Stale-run invalidation via token ownership
- Explicit cancellation APIs (`STOP_AGENT`, `CANCEL_AND_CLEAR`, `CLEAR_MEMORY`)
- Loop-stuck escape behavior and guarded completion checks

---

## Provider and Model Support

### Providers
- Local: `ollama`
- Cloud: `gemini`, `openai`, `claude`, `groq`, `mistral`

### Model operations
- Provider-specific model selectors
- Ollama model auto-detection
- Goal-based recommendation helper
- Per-provider call/latency/success metrics in UI

---

## Setup and Runbook

### Prerequisites
- Node.js 20+
- npm
- Chrome (Developer Mode)

### Install and build
```bash
npm install
npm run build
```

### Load unpacked extension
1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Choose [extension/](extension)

### Local model (Ollama)
```bash
ollama serve
ollama pull llama3.2
```

UI settings:
1. Provider = `ollama`
2. URL = `http://localhost:11434`
3. Select model
4. Click `Test Connection`

### Cloud model setup
1. Choose provider in settings
2. Enter API key
3. Unlock vault session
4. Select model
5. Test connection

Host endpoints are declared in [manifest.json](manifest.json).

---

## Security and Compliance

### Security controls
- AES-GCM encrypted local vault for secrets
- Risk-scored actions with approval gates
- Safe mode isolated execution option
- Policy-safe execution model (no arbitrary remote code execution)

### Permissions and rationale
See [PERMISSIONS.md](PERMISSIONS.md) for full matrix and store-ready justification.

---

## Testing and Quality Assurance

### Unit tests
```bash
npm test -- --runInBand
```

### QA artifacts
- [qa/static-validation-report.json](qa/static-validation-report.json)
- [qa/performance-report.json](qa/performance-report.json)
- [qa/integration-checklist.md](qa/integration-checklist.md)
- [qa/store-readiness.md](qa/store-readiness.md)

### Latest benchmark highlights
- DOM mapping: ~8.89 ms
- Memory retrieval: ~4.61 ms
- Extension load sample: ~1.20 ms

---

## Repository Structure

- [background.js](background.js) — orchestration core
- [content.js](content.js) — browser execution layer
- [popup.js](popup.js) — operator UX controller
- [manifest.json](manifest.json) — extension runtime contract
- [extension/](extension) — mirrored runtime package
- [qa/](qa) — validation/test/report tooling
- [store-readiness.md](store-readiness.md) — publish checklist summary
- [screenshot-guide.md](screenshot-guide.md) — store capture runbook

---

## Operations and Release Workflow

### Development commands
```bash
npm run dev
npm run build
npm run preview
npm run lint
npm test -- --runInBand
```

### Git workflow
```bash
git status
git add .
git commit -m "<message>"
git push origin <branch>
```

### Contributor requirement
Keep root and [extension/](extension) runtime files synchronized for:
- `background.js`
- `content.js`
- `popup.js`
- `popup.html`
- `popup.css`
- `manifest.json`

---

## Known Limits and Recovery

- `chrome://` and restricted pages may block script injection
- Provider/network failures are classified and surfaced to user
- High-risk actions can be blocked by policy gate
- Stuck-loop behavior attempts guided escape
- Concurrent stale runs are terminated by token mismatch

---

## License

MIT — see [LICENSE](LICENSE).
