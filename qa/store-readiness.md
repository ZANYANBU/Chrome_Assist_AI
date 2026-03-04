# Phase 5 — Chrome Web Store Readiness

## Policy Checklist
- [PASS] No remote code execution (`eval` / dynamic code):
  - `execute_js` now supports preset-only operations (`preset` + optional `args`) with a strict whitelist.
  - Arbitrary string execution has been removed from runtime action handling.
- [PASS] Minimal permissions present and explicit in manifest.
- [PASS] Permission justifications documented in `PERMISSIONS.md` (including store-ready snippet).
- [PARTIAL] Privacy policy file/URL not present yet.
- [PASS] Single purpose is clearly stated in manifest description.
- [PASS] No intentional obfuscation in editable source files.
- [PASS] Icons exist (16/48/128) in both root and extension folders.
- [PASS] Screenshot capture guidance added in `screenshot-guide.md` with 5 store capture recipes.
- [PASS] E2E validation runner added in `e2e-test-runner.html` with auto and manual evidence export.
- [PASS] Updated benchmark in `qa/performance-report.json` reports steady-state `domMappingMs` under 200ms.

## Store Listing Draft
- Name (<=45): ZANYSURF AI Browser Agent
- Short description (<=132): Autonomous Chrome AI agent for planning, research, and browser task execution with local or cloud LLM support.
- Category: Productivity

### Detailed Description
ZANYSURF is a production-grade Chrome MV3 extension that turns natural-language goals into reliable browser actions.

Core capabilities:
- Autonomous planning and execution loop
- Multi-agent orchestration (Research, Analysis, Writer, Action agents)
- DOM + vision fallback perception
- Structured extraction, synthesis, and workflow replay
- Scheduler, smart bookmarks, memory, and knowledge graph
- Human-in-the-loop approval gates for high-risk actions
- Audit log export and step replay viewer

Provider support:
- Ollama (local)
- Gemini API

Security and control:
- Permission-scoped MV3 architecture
- High-risk action classification and confirmation
- Local encrypted credential vault with session unlock

Use cases:
- Research and synthesis across tabs
- Form filling and data extraction
- Browser task automation and repetitive workflows

### Privacy Policy Template
Title: ZANYSURF Privacy Policy

1. Data Processing
- ZANYSURF processes webpage content necessary to execute user-requested tasks.
- Data is used only for extension functionality.

2. LLM Providers
- If Ollama is selected, data is processed locally on user infrastructure.
- If Gemini is selected, request content is sent to Google Gemini API.

3. Local Storage
- Settings, workflows, bookmarks, memory, and audit logs are stored in `chrome.storage.local`.
- Credential vault entries are encrypted locally (AES-GCM).

4. Data Sharing
- No sale of personal data.
- No third-party analytics by default.

5. User Controls
- Users can clear memory/history from the extension UI.
- Users can disable optional features and remove stored entries.

6. Contact
- Add maintainer email and repository URL.
