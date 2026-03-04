# ZANYSURF Permission Justification

| Permission | Why Needed | User Benefit |
|---|---|---|
| `activeTab` | Executes actions only on the user’s active page during explicit tasks. | Keeps automation scoped and user-driven. |
| `scripting` | Injects/controls content logic for DOM mapping and action execution. | Enables reliable click/type/extract operations. |
| `storage` | Stores settings, workflows, bookmarks, memory, metrics, and encrypted credential vault metadata. | Persists user preferences and continuity between sessions. |
| `tabs` | Multi-tab orchestration for research and workflow execution across pages. | Supports compare/synthesize and tab-aware automation. |
| `alarms` | Scheduler for user-created recurring tasks. | Enables autonomous timed routines. |
| `downloads` | Exports audit logs and CSV extraction outputs. | Allows evidence/report and data export flows. |
| `clipboardWrite` | Copies generated CSV/text outputs on user request. | Faster transfer of extracted results. |
| `contextMenus` | Optional quick-trigger actions from context menu. | One-click access to agent tasks. |
| `notifications` | Task completion/warning alerts. | Improves awareness for background runs. |
| `sidePanel` | Hosts the persistent ZANYSURF control panel UI. | Better UX for long-running automation. |
| `declarativeNetRequest` | Uses rule-based network controls for safe interception/constraints (no remote script execution). | Safer and policy-compliant browsing automation controls. |

## Host Permissions
- `<all_urls>`: required because users can ask the agent to operate on arbitrary sites.
- `http://localhost:11434/*` and `http://127.0.0.1:11434/*`: local Ollama endpoint support.
- `https://generativelanguage.googleapis.com/*`: Gemini API endpoint support.
- `https://api.openai.com/*`: OpenAI chat/model endpoints.
- `https://api.anthropic.com/*`: Claude message endpoint.
- `https://api.groq.com/*`: Groq OpenAI-compatible endpoint.
- `https://api.mistral.ai/*`: Mistral model/chat endpoints.

## Chrome Web Store Description Snippet
ZANYSURF requires tab, scripting, and storage permissions to perform user-requested browser automation (click, type, extract, and workflow replay) and to preserve local settings/workflows. Optional model-provider host permissions enable local Ollama or selected cloud providers (Gemini, OpenAI, Claude, Groq, Mistral). Sensitive credentials and API keys are encrypted locally before storage.
