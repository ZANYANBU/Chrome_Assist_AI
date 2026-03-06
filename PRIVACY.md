# Privacy Policy — ZANYSURF AI Browser Agent

**Effective date:** March 4, 2026  
**Last updated:** March 6, 2026

---

## The short version

ZANYSURF has no servers, no accounts, and no analytics. It cannot see your data, and neither can we. Everything stays on your device.

---

## What data is stored

The extension saves the following to `chrome.storage.local` **on your device only**:

- Your chosen LLM provider and model name (e.g. "Ollama", "llama3.2")
- Your API key, if you add one — stored encrypted using AES-GCM
- The last 50 task history entries (goal text + action steps)

None of this is ever sent to ZANYSURF or any third party. It lives in your browser and goes nowhere unless you clear it.

---

## What leaves your device

It depends on which AI provider you choose:

**Ollama (local model)**
The page text and your goal are sent to `http://localhost:11434` — your own machine. Nothing leaves your computer. This is the most private option.

**Gemini API**
The page text and your goal are sent to Google's Gemini API (`generativelanguage.googleapis.com`). Your API key is included in the request header. This is covered by [Google's privacy policy](https://policies.google.com/privacy). ZANYSURF does not see or log these requests — they go directly from your browser to Google.

If you use any other provider (OpenAI, Claude, Groq, Mistral), the same rule applies: requests go directly from your browser to that provider's API. ZANYSURF is not in the middle.

---

## Why the extension needs `<all_urls>` permission

This permission lets the extension's content script run on any page you visit so the agent can read the page structure, click buttons, fill forms, and navigate — all on pages *you* actively direct it to.

It does **not** mean the extension is watching your browsing in the background, recording visited URLs, or sending your history anywhere. The content script only activates when you start a task.

---

## No tracking, no ads, no analytics

- No third-party analytics (no Google Analytics, Mixpanel, Amplitude, or similar)
- No advertising of any kind
- No telemetry or crash reporting sent anywhere
- No use of your data to train any model

---

## Contact

Questions? Open an issue on GitHub:  
[github.com/ZANYANBU/Chrome_Assist_AI/issues](https://github.com/ZANYANBU/Chrome_Assist_AI/issues)
