---
layout: default
title: ZANYSURF — Privacy Policy
description: Privacy policy for the ZANYSURF AI Browser Agent Chrome and Edge extension.
---

<style>
  body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1.5rem; color: #1a1a1a; line-height: 1.7; }
  h1 { color: #050505; border-bottom: 3px solid #00ff88; padding-bottom: 0.4rem; }
  h2 { color: #1a1a1a; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: 0.6rem 0.9rem; text-align: left; }
  th { background: #f4f4f4; }
  .summary-box { background: #f0fff8; border-left: 4px solid #00cc6a; padding: 1rem 1.5rem; margin: 1.5rem 0; border-radius: 4px; }
  .summary-box ul { margin: 0.5rem 0; }
  footer { margin-top: 3rem; font-size: 0.85rem; color: #666; border-top: 1px solid #eee; padding-top: 1rem; }
</style>

# ZANYSURF — Privacy Policy

**Extension:** ZANYSURF AI Browser Agent  
**Effective Date:** March 4, 2026  
**Last Updated:** March 4, 2026

---

<div class="summary-box">

### Privacy in plain English

- **We have no servers.** ZANYSURF cannot see, collect, or sell your data — there is no backend.
- **Your data stays in your browser.** If you use Ollama, nothing ever leaves your machine.
- **We encrypt your passwords.** API keys and credentials are locked behind AES-GCM encryption before being saved.

</div>

---

## What data is collected?

**None sent to ZANYSURF.**

ZANYSURF does not collect, log, aggregate, or transmit any of the following:

- Browsing history
- Page content or extracted text
- Goals or instructions you type
- Form data, usernames, or passwords
- Crash reports or error logs
- Usage analytics or session data
- Device identifiers

There is no ZANYSURF server. There is no ZANYSURF analytics pipeline. This is not a data company.

---

## What is stored locally?

ZANYSURF uses `chrome.storage.local` (stored only on your device) to save:

| What is stored | Why |
|---|---|
| Extension settings (provider, model, Ollama URL) | Remember your configuration between sessions |
| Short-term agent memory | Help the agent recall recent actions within a session |
| Long-term memory and knowledge graph | Improve future task performance across sessions |
| Smart bookmarks | Let you search your saved pages naturally |
| Scheduled tasks | Run recurring goals at the right time |
| Encrypted vault entries | Securely store API keys and credentials |

You can clear all local data at any time from the extension settings → **Clear Memory**.

---

## How does data flow to LLM providers?

Your choice of provider determines exactly what leaves your browser.

### Ollama (local model)
Your prompts and page context are sent to `localhost` only — the Ollama server running on your own computer. Nothing leaves your machine. No internet connection is required.

### Cloud providers (OpenAI, Claude, Gemini, Groq, Mistral)
If you choose a cloud provider and enter an API key, ZANYSURF sends your goal and relevant page context **directly from your browser to the provider's API** (e.g., `api.openai.com`). This communication does **not** pass through any ZANYSURF server or proxy — it is a direct browser-to-API request.

The data transmitted to cloud providers is governed by each provider's own privacy policy:
- [OpenAI Privacy Policy](https://openai.com/privacy)
- [Anthropic Privacy Policy](https://www.anthropic.com/privacy)
- [Google Privacy Policy](https://policies.google.com/privacy)
- [Groq Privacy Policy](https://groq.com/privacy-policy/)
- [Mistral Privacy Policy](https://mistral.ai/terms/#privacy-policy)

### Edge Built-in AI (window.ai / Phi-3)
When using the Edge Built-in AI provider, inference runs inside the browser itself using Microsoft's Edge runtime. No data is sent to ZANYSURF. Microsoft's privacy policy governs the built-in AI feature.

---

## Credential vault security

The ZANYSURF vault encrypts your API keys and login credentials before saving them to `chrome.storage.local`.

**Technical details:**
- Encryption: **AES-GCM 256-bit**
- Key derivation: **PBKDF2** with SHA-256 and a random salt
- Master key: derived at runtime from your passphrase — never stored on disk or in memory beyond your active session
- Without your master passphrase, the stored ciphertext is computationally unreadable

If you forget your vault passphrase, your encrypted data cannot be recovered (by you or by ZANYSURF). You would need to clear the vault and re-enter your credentials.

---

## No analytics

ZANYSURF contains zero analytics, telemetry, error reporting, or crash logging code. There is no Google Analytics, Mixpanel, Sentry, or equivalent SDK included.

---

## No advertising

ZANYSURF contains no advertising, no affiliate tracking, and no sponsored content. It is a free, open-source utility. There is no business model built on your data.

---

## Children's privacy

ZANYSURF is not directed at children under 13 and does not knowingly collect data from children. It is a developer-focused productivity tool with no user accounts.

---

## Changes to this policy

If this policy changes, the updated version will be published at this URL with a new "Last Updated" date. Continued use of the extension after a policy change constitutes acceptance of the updated terms.

---

## Contact

If you have questions about privacy, please open an issue on the public GitHub repository:

**[github.com/ZANYANBU/Chrome_Assist_AI/issues](https://github.com/ZANYANBU/Chrome_Assist_AI/issues)**

---

<footer>
ZANYSURF is built and maintained by Anbu Chelvan Valavan. Licensed under MIT.
</footer>
