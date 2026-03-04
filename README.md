# ZANYSURF AI Browser Agent

Production-grade, Manifest V3 Chrome extension for autonomous browser execution, multi-agent research workflows, and auditable AI-assisted automation.

---

## 1) Project Overview

ZANYSURF is an AI browser agent that runs fully inside Chrome extension runtime (MV3 service worker + content scripts). You provide a natural-language goal, and the agent plans, executes, observes, and iterates through browser actions (navigate, click, type, extract, synthesize, etc.) until completion or guard stop.

### Core Value
- Local-first autonomous browser automation (Ollama support)
- Optional cloud-provider execution (Gemini/OpenAI/Claude/Groq/Mistral)
- Multi-agent orchestration for research and writing workflows
- Memory + knowledge graph + workflow replay + scheduler
- Safety gates, approvals, and auditability

---

## 2) Current Release Snapshot

- Version: `1.0.1`
- Manifest: V3
- Unit tests: `15/15` passing
- Store readiness status: `YES` (privacy policy URL still needs final publication)
- Recent reliability fix: stale-run cancellation with explicit run tokens + force-cancel-and-restart UX
- Recent UX fix: in-UI status toast for:
  - `Old run cancelled`
  - `New run started`

---

## 3) Architecture (High-Level)

### Runtime Components
- `background.js`
  - Main orchestration engine and message router
  - ReAct-style run loop and planning layer
  - Multi-agent coordinator (`OrchestratorAgent`, `ResearchAgent`, `AnalysisAgent`, `WriterAgent`, `ActionAgent`)
  - Scheduling, workflows, bookmarks, vault, metrics, audit log, safety
- `content.js`
  - DOM perception, interaction execution, extraction, network hooks
  - Page actions (click/type/scroll/hover/select/forms/etc.)
  - Preset-only `execute_js` policy-safe execution mode
- `popup.js`, `popup.html`, `popup.css`
  - Command center UI + side panel views
  - Provider/model management
  - Live run telemetry + progress + cards + replay support

### Mirrored Extension Build Folder
- `extension/`
  - Runtime mirror used for extension packaging/load-unpacked flow
  - `background.js`, `content.js`, `popup.*`, `manifest.json`, `icons/`

### Data + Control Flows
1. User enters goal in popup
2. Popup sends `RUN_AGENT` / `RUN_MULTI_AGENT` message
3. Background starts tokenized run lifecycle
4. Background queries tab context from content script
5. LLM decides action
6. Content executes action and returns result
7. Background updates memory/log/tree/progress and loops
8. Completion/error/cancel events stream back to popup

---

## 3.1) Detailed Workflow (End-to-End)

This section documents exact runtime behavior from user input to completion, including cancellation semantics, orchestration, persistence, and observability.

### A) Single-Agent Execution Workflow

1. **Goal submission**
  - UI entry point: `popup.js::doSend()`
  - Message: `RUN_AGENT { prompt }`

2. **Run lifecycle start**
  - Background calls `startNewRun('run-agent')`
  - Any previous active run is invalidated using token bump + abort flags
  - New run receives a `runToken` and `currentAgentRunId`

3. **Session bootstrap**
  - `runAgentEntry(prompt, options)` validates prompt
  - Goal continuation context is checked (`detectGoalContinuation`)
  - Quick-run state/session metadata is persisted

4. **Planning stage**
  - `runAgentWithPlanning(goal, options)` creates plan (`generatePlan`)
  - If schedule intent is detected, run may short-circuit into scheduler creation

5. **Execution loop (`runAgentLoop`)**
  - Active tab resolution + load wait + content script readiness
  - Context gather from DOM/vision + history/memory
  - LLM action decision (`getNextAction`) or fast-path decision
  - Safety guards + risk gate (`executeWithRiskCheck`)
  - Action dispatch to content script (`EXECUTE`)
  - Step result persisted to action history / memory / audit stream
  - Repeat until success, done, abort, max-steps, or stale token

6. **Completion/termination**
  - Success emits `AGENT_COMPLETE`
  - Errors emit `AGENT_ERROR`
  - Abort/cancel returns `Run cancelled` semantics
  - Task history/workflow personalization updated

### B) Multi-Agent Orchestration Workflow

1. **Trigger path**
  - Message: `RUN_MULTI_AGENT` or goal pattern requiring orchestration

2. **Goal decomposition**
  - `OrchestratorAgent.decomposeGoal(goal)` creates step graph
  - Typical chain:
    - `a1` research
    - `a2` analysis (depends on `a1`)
    - `a3` writer (depends on `a2`)

3. **Execution model**
  - Dependency-free tasks can run in parallel (`Promise.all`)
  - Dependent tasks run sequentially
  - Tree state updates (`pending/running/completed/failed`) emitted via `AGENT_TREE`

4. **Inter-agent communication**
  - Bus envelopes emitted through `AgentBus` / `InterAgentBus`
  - UI receives `AGENT_BUS_EVENT` for observability

5. **Final synthesis**
  - Outputs merged and summarized (`synthesizePlanResults`)
  - Final completion emitted with overall summary

### C) Cancellation, Restart, and Stale-Run Protection

ZANYSURF uses a **token ownership model** for robust cancellation:

- `activeRunToken` is incremented whenever a run is cancelled/replaced.
- All critical loops/steps validate ownership with `isRunTokenCurrent(runToken)`.
- Any stale run exits early instead of executing additional actions.

#### UI behavior when user submits a new goal during active run
- Popup sends `CANCEL_AND_CLEAR`
- Toast: `Old run cancelled`
- Popup immediately starts new run via `RUN_AGENT`
- Toast: `New run started`

#### Stop/Clear actions
- `STOP_AGENT`: abort active run (no full memory wipe)
- `CANCEL_AND_CLEAR`: abort + clear run-context state
- `CLEAR_MEMORY`: cancellation first, then memory structures reset

### D) Scheduler Workflow

1. User creates schedule from prompt/UI
2. Background parses schedule intent (`parseScheduleFromGoal`)
3. `SchedulerEngine.createTask` stores normalized task + next run
4. Chrome alarms trigger execution at runtime
5. Task run updates `lastRun` / `nextRun`

### E) Memory and Knowledge Workflow

1. During each step, relevant action context is embedded/recorded
2. `retrieveMemoryContext(goal)` computes top-K relevant memory snippets
3. Knowledge entities from extraction are upserted to graph
4. Future plans/prompts include recalled memory + graph-derived signals

### F) Vault and Provider-Key Workflow

1. User enters provider key in settings
2. UI requests passphrase to unlock session vault
3. Background encrypts and stores provider key (AES-GCM)
4. At runtime, settings resolve provider key for selected provider only
5. Keys are not persisted as plaintext in extension storage

### G) Observability Workflow

The UI consumes runtime events for live insight:

- `AGENT_STATUS` (state transitions)
- `AGENT_THINKING` (reasoning phase)
- `AGENT_LOG` (decision + chosen action)
- `AGENT_EXEC_RESULT` (execution outcome)
- `AGENT_PLAN` / `AGENT_PLAN_PROGRESS` (planner trace)
- `AGENT_TREE` (orchestrator structure)
- `AGENT_BUS_EVENT` (inter-agent event stream)
- `AGENT_COMPLETE` / `AGENT_ERROR` (terminal state)

### H) Data Persistence Map (Primary Keys)

- `zanysurf_audit_log` — immutable-like execution trace
- `zanysurf_knowledge_graph` — extracted entity graph
- `zanysurf_quick_runs` — recent run goals
- `zanysurf_scheduled_tasks` — scheduler task state
- `zanysurf_safe_mode` — safe mode toggle
- `zanysurf_api_metrics` — provider call metrics
- `zanysurf_last_session_state` — resumable session info
- `zanysurf_credential_vault` — encrypted secret vault

### I) QA + Release Workflow

1. Run unit tests:
  - `npm test -- --runInBand`
2. Run static/performance checks from `qa/`
3. Validate root ↔ `extension/` parity for runtime files
4. Capture store screenshots and checklist artifacts
5. Package `extension/` for upload

### J) Failure Modes and Recovery

- **No active tab / inaccessible URL**: run exits with classification + user message
- **Network/provider errors**: classified into user-facing categories
- **Permission blocked action**: safety gate blocks execution and reports reason
- **Stuck action loop**: loop fingerprint detection triggers escape strategy
- **Stale concurrent run**: token mismatch forces old loop termination

---

## 4) Functional Specification

### 4.1 Agent Execution
- ReAct loop: perceive → reason → act → observe → repeat
- Plan-and-execute layer for multi-step decomposition
- Auto replan on failed subtasks
- Max-step protections and loop-break heuristics

### 4.2 Multi-Agent Mode
- `ResearchAgent`: multi-source collection + dedupe facts
- `AnalysisAgent`: claim synthesis + contradiction detection
- `WriterAgent`: structured drafting in browser editors
- `ActionAgent`: general browser task execution
- Agent tree + bus events exposed in UI

### 4.3 Browser Actions
- Navigation and tab operations
- Element interaction: click/type/key/hover/select
- Scroll/wait/new-tab/open-tabs/activate-tab/wait-tab
- Form utilities: inspect/fill/login flows
- Extraction + synthesis + CSV export + clipboard copy
- Advanced actions: drag_drop/upload_file/iframe/context_click/shortcut

### 4.4 Memory + Knowledge
- Short-term memory for run context
- Long-term memory with vector-style retrieval
- Cross-session continuation hints
- Knowledge graph entity linking and retrieval

### 4.5 Workflow + Scheduler
- Natural language schedule intent parsing
- Alarm-backed recurring automation
- Workflow persistence and replay
- Smart bookmarks (fuzzy match + quick open)

### 4.6 Safety + Governance
- Action risk classification (`LOW` to `CRITICAL`)
- Human approval gates for risky operations
- Safe mode isolated run window
- Policy-safe runtime (no arbitrary remote code execution)
- Encrypted local vault for credentials/API keys (AES-GCM)

### 4.7 Reliability Controls (Implemented)
- Tokenized active run ownership
- New run invalidates stale in-flight run
- `CANCEL_AND_CLEAR` action support
- Popup force-cancel + immediate new run start
- UI timing feedback toasts:
  - `Old run cancelled`
  - `New run started`

---

## 5) Provider Support

### Supported Providers
- Local: `ollama`
- Cloud: `gemini`, `openai`, `claude`, `groq`, `mistral`

### Model Handling
- Provider-specific model selectors in popup
- Auto-detect models for Ollama endpoint
- Goal-aware recommendation helper
- Provider metrics surfaced in UI

---

## 6) How to Run (Local Development)

## Prerequisites
- Node.js 20+
- npm
- Chrome/Chromium (Developer Mode)

### Install
```bash
npm install
```

### Build
```bash
npm run build
```

### Load Extension (Unpacked)
1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `extension/` folder

---

## 7) Local Model Setup (Ollama)

### Start Ollama
```bash
ollama serve
```

### Pull a model (example)
```bash
ollama pull llama3.2
```

### Configure in ZANYSURF UI
1. Open popup settings
2. Provider = `ollama`
3. URL = `http://localhost:11434`
4. Select detected model
5. Click `Test Connection`

Notes:
- If running Ollama on another machine, set URL to that host
- Ensure host is reachable and allowed by local firewall

---

## 8) Cloud Model Setup (Gemini/OpenAI/Claude/Groq/Mistral)

### Configure in ZANYSURF UI
1. Open popup settings
2. Select cloud provider
3. Enter API key
4. Unlock vault passphrase when prompted
5. Pick model
6. Click `Test Connection`

### API Endpoints Allowed by Manifest
- Gemini: `https://generativelanguage.googleapis.com/*`
- OpenAI: `https://api.openai.com/*`
- Anthropic: `https://api.anthropic.com/*`
- Groq: `https://api.groq.com/*`
- Mistral: `https://api.mistral.ai/*`

---

## 9) Tooling and Stack

### Runtime
- Chrome Extension MV3
- Service worker + content scripts + side panel

### JavaScript/Frontend
- Vanilla extension runtime JS
- Vite-based project tooling
- React dependencies are present for workspace/web assets

### AI/ML and Integration Libraries
- `@google/genai`
- `@xenova/transformers`

### QA/Testing
- `jest`
- `playwright`
- `jsdom`

### Useful Scripts
```bash
npm run dev
npm run build
npm run preview
npm run lint
npm test -- --runInBand
```

---

## 10) Repository Layout (Key Files)

- `background.js` — orchestration + planning + routing + safety + memory
- `content.js` — page perception + action execution + extraction
- `popup.js` — operator UI logic
- `popup.html` / `popup.css` — command center UI
- `manifest.json` — extension permissions and runtime config
- `extension/` — packaged runtime mirror
- `qa/` — unit/static/performance/smoke docs and runners
- `PERMISSIONS.md` — permission and host-permission rationale
- `store-readiness.md` — publish-readiness summary
- `screenshot-guide.md` — CWS screenshot capture checklist

---

## 11) Security and Permission Model

Permissions and rationale are documented in `PERMISSIONS.md`.

Highlights:
- `activeTab`, `scripting`, `tabs`, `storage`, `alarms`, `downloads`, `clipboardWrite`, `notifications`, `sidePanel`, `declarativeNetRequest`
- `<all_urls>` host permission for user-directed arbitrary site automation
- Local encrypted vault for sensitive key/credential material

Policy safety:
- Arbitrary dynamic code execution removed from runtime action handling
- `execute_js` constrained to a strict preset model

---

## 12) QA and Validation

### Current Benchmarks
From `qa/performance-report.json`:
- `domMappingMs`: ~8.89 ms
- `memoryRetrievalMs`: ~4.61 ms
- `extensionLoadMs`: ~1.20 ms

### Validation Assets
- `qa/static-validation-report.json`
- `qa/integration-checklist.md`
- `qa/store-readiness.md`
- `qa/qa-summary.md`

### Unit Tests
```bash
npm test -- --runInBand
```

---

## 13) Operating Guide (Typical Usage)

1. Open popup
2. Enter goal
3. Observe live status/progress
4. Stop or replace run as needed
5. Review cards/tree/logs
6. Export artifacts (audit, CSV, replay) when required

### Run Replacement UX
If a run is active and you submit another goal:
- Existing run is cancelled and cleared
- Toast appears: `Old run cancelled`
- New run starts immediately
- Toast appears: `New run started`

---

## 14) Deployment / GitHub Workflow

### Local commit workflow
```bash
git status
git add .
git commit -m "docs: professionalize README with full spec and runbook"
```

### Push
```bash
git push origin <your-branch>
```

If push fails due to auth, configure one of:
- GitHub CLI auth: `gh auth login`
- PAT-based HTTPS credentials
- SSH key with GitHub

---

## 15) Store Submission Readiness

Status is tracked in `store-readiness.md`.

Ready items include:
- Policy-safe runtime behavior
- Permission rationale
- QA artifacts and tests
- Screenshot and launch docs

Pending item:
- Final privacy policy URL publication and listing link

---

## 16) Contributor Notes

When changing runtime files, keep root and `extension/` mirrors aligned for:
- `background.js`
- `content.js`
- `popup.js`
- `popup.html`
- `popup.css`
- `manifest.json`

Recommended before PR:
1. `npm test -- --runInBand`
2. Static/smoke checks in `qa/`
3. Manual run replacement/cancellation flow check
4. Verify popup + sidepanel UX parity

---

## 17) License

MIT — see `LICENSE`.
