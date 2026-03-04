# Phase 3 — Integration Checklist (Manual)

Legend: PASS / FAIL / PARTIAL / NOT RUN

## TIER 1-2 REGRESSION
- [PARTIAL] T1.1 Goal: Search GitHub for React projects
  - URL: https://github.com
  - Steps: Run goal from popup; observe direct/search navigation
  - Expected: github.com/search?q=react
  - Notes: Requires live browser execution.

- [PARTIAL] T1.2 Goal: Open YouTube and search lo-fi music
  - URL: https://www.youtube.com
  - Steps: Run goal; verify type + enter + results
  - Expected: search results loaded

- [PARTIAL] T2.1 Vision fallback on canvas-heavy page
  - URL: https://www.figma.com
  - Steps: Run a click/search goal on sparse DOM
  - Expected: switches to vision mode automatically

- [PARTIAL] T2.2 Planning with compare goal
  - URL: https://www.google.com
  - Steps: Run “Research and compare 3 mechanical keyboards”
  - Expected: plan card 3-5 subtasks before execution

## TIER 3 REGRESSION
- [PARTIAL] T3.1 Scheduler create daily task
- [PARTIAL] T3.2 Workflow auto-save + replay
- [PARTIAL] T3.3 Bookmark save/open

## TIER 4A — MULTI-AGENT
- [PARTIAL] T4A.1 Research→Analysis→Writer chain writes doc
- [PARTIAL] T4A.2 ResearchAgent opens parallel tabs + dedup facts

## TIER 4B — PERCEPTION
- [PARTIAL] T4B.1 Reading mode clean extraction on news article
- [PARTIAL] T4B.2 Infinite scroll preload on reddit.com
- [PARTIAL] T4B.3 YouTube media metadata detection

## TIER 4C — ACTIONS
- [PARTIAL] T4C.1 drag_drop on Trello/Notion board
- [PARTIAL] T4C.2 upload_file on file input form
- [PARTIAL] T4C.3 shortcut Ctrl+K on GitHub
- [PARTIAL] T4C.4 context_click and menu capture

## TIER 4D — MEMORY
- [PARTIAL] T4D.1 memory reuse on repeated goal
- [PARTIAL] T4D.2 knowledge graph panel visualization
- [PARTIAL] T4D.3 interrupted task resume on reopen

## TIER 4E — COMMUNICATION
- [PARTIAL] T4E.1 compose_email in Gmail/Outlook
- [PARTIAL] T4E.2 book_slot in Calendly-like flow
- [PARTIAL] T4E.3 CAPTCHA pause/resume behavior

## TIER 4F — DEVELOPER
- [PARTIAL] T4F.1 execute_js returns page title
- [PARTIAL] T4F.2 network cache captures JSON responses
- [PARTIAL] T4F.3 JS page error surfaced in plain English

## TIER 4G — UI
- [PARTIAL] T4G.1 Alt+Z side panel toggle
- [PARTIAL] T4G.2 replay scrubber thought+screenshot
- [PARTIAL] T4G.3 onboarding shown on fresh storage

## TIER 4H — SECURITY
- [PARTIAL] T4H.1 safe mode isolated window
- [PARTIAL] T4H.2 CRITICAL risk approval gate
- [PARTIAL] T4H.3 offline retry + plain-English error
- [PASS] T4H.4 101-call warning logic covered by unit test

## Issues found during automated QA
- None blocking from static/unit automation.

## Fixes applied during QA
- Added `InterAgentBus.send` compatibility wrapper over `AgentBus`.
- Added `triggerLazyLoadScroll(tabId)` compatibility wrapper in background.
- Added `showApprovalRequest(request)` compatibility wrapper in popup.
- Improved permission classification for chrome:// access errors.
