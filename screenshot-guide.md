# Chrome Web Store Screenshot Guide

Capture all screenshots at the same browser zoom and with production extension build loaded.

## 1) Main Command Center (Popup/Side Panel)
- Open ZANYSURF panel.
- Show goal input + Run button + status area.
- Include one completed run in history list.
- Suggested caption: "Natural-language goals to browser actions."

## 2) Multi-Agent Plan + Progress
- Start a run that triggers plan mode.
- Capture visible plan steps and progress events.
- Ensure AGENT_PLAN/AGENT_PLAN_PROGRESS are visible in UI.
- Caption: "Structured planning and step-by-step execution."

## 3) Data Extraction + Export
- Run extraction on a table/list page.
- Show extracted output with export/copy controls.
- If available, include generated CSV confirmation.
- Caption: "Extract, synthesize, and export web data."

## 4) Safety + Approvals
- Trigger a high-risk action requiring approval.
- Capture approval dialog/prompt and audit indicator.
- Show safe mode toggle state.
- Caption: "Human-in-the-loop controls for sensitive actions."

## 5) Credential Vault + Login Assist
- Open vault panel with sample masked entries (no real credentials).
- Show unlock state and site selection.
- Capture login assistance action result on a test page.
- Caption: "Encrypted local credential vault and assisted login."

## Capture Checklist
- Use realistic but non-sensitive sample data.
- No personal accounts, secrets, or private URLs.
- Keep window chrome minimal so extension UI is clear.
- Save files as `store-shot-1.png` ... `store-shot-5.png`.
