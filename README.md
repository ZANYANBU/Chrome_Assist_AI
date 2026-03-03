<div align="center">

# ✦ ZANYSURF AI Browser Agent

### Autonomous AI-powered Chrome Extension for intelligent browser control

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen?style=for-the-badge)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Ollama](https://img.shields.io/badge/Ollama-Local_LLM-black?style=for-the-badge&logo=ollama)](https://ollama.com)
[![Gemini](https://img.shields.io/badge/Google-Gemini-4285F4?style=for-the-badge&logo=google)](https://ai.google.dev)
[![License](https://img.shields.io/badge/License-MIT-purple?style=for-the-badge)](LICENSE)

> **ZANYSURF** is a fully autonomous AI browser agent that lives inside Chrome.  
> Give it a goal in plain English — it reasons step by step, maps the page,  
> clicks buttons, types into fields, navigates URLs, and shows you exactly  
> what it is thinking at every stage.

</div>

---

## 📖 Table of Contents

- [What is ZANYSURF?](#-what-is-ZANYSURF)
- [How It Works](#-how-it-works)
- [Features](#-features)
- [Architecture](#-architecture)
- [File Structure](#-file-structure)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Usage Guide](#-usage-guide)
- [Supported Actions](#-supported-actions)
- [Supported Sites](#-supported-sites-with-site-specific-hints)
- [LLM Providers](#-llm-providers)
- [Safety and Guards](#-safety--guards)
- [Technical Details](#-technical-details)
- [Troubleshooting](#-troubleshooting)
- [Permissions Explained](#-permissions-explained)
- [Contributing](#-contributing)

---

## 🚀 What is ZANYSURF?

**ZANYSURF** (Chain-of-thought Orchestrated Machine for Exploratory Tasks) is a  
Chrome Extension that turns any LLM — running locally via [Ollama](https://ollama.com)  
or in the cloud via [Google Gemini](https://ai.google.dev) — into a fully autonomous  
web agent.

Instead of clicking around the browser manually, you type a goal like:

> *"Go to GitHub and search for React projects"*

ZANYSURF takes over: navigates to GitHub, maps every interactive element on the page,  
constructs the correct search URL, submits the query, and reports back — showing  
chain-of-thought reasoning at every single step.

**No Python. No Selenium. No server.** Everything runs directly inside the browser  
extension using the Chrome Extensions Manifest V3 APIs.

---

## 💡 How It Works

The core idea draws from **ReAct-style agents** (Reason + Act loops):

```
PERCEIVE → THINK → ACT → OBSERVE → REPEAT
```

### The Loop

**1. PERCEIVE** — The content script scans the active tab's DOM, extracts every visible  
interactive element (links, buttons, inputs, selects, etc.) and assigns each a numbered  
ID `[0]`, `[1]`, `[2]`…

**2. THINK** — The background service worker builds a structured prompt containing:
- The current page URL and title
- The numbered DOM element map
- The full step history (what was done and whether it succeeded)
- Site-specific hints for popular websites
- The user's goal

**3. ACT** — The LLM responds with a JSON action:
```json
{
  "thought": "I see the search button. I will click it.",
  "action": "click",
  "element_id": 4,
  "value": null,
  "is_complete": false
}
```
The background script executes that action via the Chrome scripting API.

**4. OBSERVE** — The result is captured (success/failure, new URL, new page title),  
added to history, and the loop repeats.

**5. DONE** — The agent runs up to 30 steps. It stops when it outputs `action: "done"`,  
or when a goal-satisfaction check detects the task is clearly complete.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Chrome MV3 service worker | No persistent background page; works with modern Chrome |
| Content script DOM mapping | Gives the LLM a stable reference system (element IDs) instead of unreliable selectors |
| Direct search URL shortcuts | For search tasks, navigates straight to `?q=` URLs — skips DOM interaction entirely |
| Hedge-word guard | If LLM says `done` with "consider doing X" — blocked, loop continues |
| Retry on failure | Failed click/type/hover retries once automatically before moving on |
| Shadow DOM traversal | Up to 4 levels deep — handles modern web component frameworks |
| React/Vue/Angular compat | Uses `Object.getOwnPropertyDescriptor` native setter to trigger framework state updates |

---

## ✨ Features

### 🤖 Core Agent
- **Autonomous multi-step task execution** — up to 30 steps per task
- **Chain-of-thought reasoning** — every step shows the model's thinking
- **Step history context** — LLM sees what has been tried and whether it worked
- **Automatic retry** — failed element interactions retry once automatically
- **Goal satisfaction detection** — auto-completes when the URL confirms task is done
- **Hedge detection** — blocks vague "consider trying..." `done` responses

### 🔍 Smart Navigation
- **Direct search URL builder** — constructs search URLs for 16+ sites without touching the DOM
  - YouTube · GitHub · Google · Amazon · Reddit · Bing · DuckDuckGo
  - Stack Overflow · npm · PyPI · Wikipedia · Twitter/X
  - LinkedIn · HuggingFace · Spotify · Hacker News
- **Site-specific LLM hints** — injects expert knowledge about popular site structures
- **Automatic URL detection** — maps goal keywords to target URLs before the agent starts

### 🖥️ Browser Control Actions
| Action | Description |
|--------|-------------|
| Navigate | Load any URL |
| Click | Click any visible element |
| Type | Type text — React/Vue/Angular safe |
| Key press | Enter, Tab, Escape, ArrowDown, etc. |
| Scroll | Up, down, to top |
| Hover | Mouse hover |
| Select | Dropdown option selection |
| Wait | Configurable delay (500–8000 ms) |
| New tab | Open URL in new tab |
| Cookie dismiss | Auto-click "Accept all", "I agree", etc. |

### 📸 Visibility
- **Page screenshots** after every navigate action — shown in step cards
- **Visual DOM badges** — numbered overlays on every interactive element while agent scans
- **Live progress bar** — violet bar fills from 0 to 100% across 30 steps
- **Step cards** — action badge, chain-of-thought, page reference, execution result, screenshot
- **Keyword highlighting** — action words italicised in thought text

### 💾 Persistence
- **Task history** — last 50 tasks saved to `chrome.storage.local`
- **Settings** — provider, model, API key, Ollama URL saved across sessions

### 🎨 UI Design
- Dark theme: `#0a0a12` background, `#8b5cf6` violet accent
- Animated 3-dot thinking indicator
- Auto-expanding textarea (grows to 120 px)
- Example task pills with one-click fill
- Live Ollama connection status dot (pinged every 18 s)
- Stop button to abort at any time

---

## 🏗️ Architecture

```
+---------------------------------------------------------------+
|                        Chrome Browser                          |
|                                                                |
|  +--------------------+      +-----------------------------+  |
|  |  popup.html        |      |  background.js              |  |
|  |  popup.css         |<---->|  (Service Worker)           |  |
|  |  popup.js          |      |                             |  |
|  |                    |      |  runAgentLoop()             |  |
|  |  Step cards        |      |  getNextAction()            |  |
|  |  Progress bar      |      |  applyGuards()              |  |
|  |  Settings          |      |  callOllama()               |  |
|  |  Screenshots       |      |  callGemini()               |  |
|  +--------------------+      |  buildSearchUrl()           |  |
|                               |  getSiteHints()             |  |
|  Messages via                 |  captureAndBroadcast()      |  |
|  chrome.runtime               |  saveTaskHistory()          |  |
|                               +-------------|---------------+  |
|                                             | chrome.scripting |
|                               +-------------|---------------+  |
|                               |  content.js (per-tab)      |  |
|                               |  buildDomMap()             |  |
|                               |  executeAction()           |  |
|                               |  dismissCookieBanners()    |  |
|                               |  setNativeValue()          |  |
|                               +----------------------------+  |
+------|--------------------------------------------------------+
       | HTTP
+------v-----------+      +---------------------------+
| Ollama (local)   |  OR  | Google Gemini 1.5 Flash   |
| localhost:11434  |      | generativelanguage.       |
+------------------+      | googleapis.com            |
                          +---------------------------+
```

### Background Message Flow

```
User types goal
     |
popup.js --[RUN_AGENT]--> background.js
                               |
                         loop starts (max 30 steps)
                               |
      +------------------------v--------------------------+
      | 1.  chrome.tabs.query() — get active tab         |
      | 2.  waitForTabReady()                            |
      | 3.  chrome.scripting -> GET_DOM                  |
      |       --> content.js: buildDomMap()              |
      | 4.  chrome.storage.get(settings)                 |
      | 5.  getNextAction() -> Ollama / Gemini API       |
      | 6.  applyGuards() — safety checks                |
      | 7.  broadcast(AGENT_LOG)  -> popup step card     |
      | 8.  chrome.tabs.sendMessage(EXECUTE)             |
      |       --> content.js: executeAction()            |
      | 9.  broadcast(AGENT_EXEC_RESULT) -> status dot   |
      | 10. captureAndBroadcast() -> screenshot          |
      | 11. checkGoalSatisfied() — early exit check      |
      | 12. if action == 'done': break                   |
      +--------------------------------------------------+
                               |
              broadcast(AGENT_COMPLETE / AGENT_ERROR)
              saveTaskHistory()
```

---

## 📁 File Structure

```
Chrome_Assist_AI/
|
+-- extension/                     <-- Load THIS in Chrome
|   +-- manifest.json              Extension manifest (MV3 v4.0)
|   +-- background.js              Service worker / agent brain
|   +-- content.js                 DOM mapper + action executor
|   +-- popup.html                 Popup UI
|   +-- popup.css                  Dark theme stylesheet
|   +-- popup.js                   Popup controller + message handler
|   +-- icons/
|       +-- icon16.png
|       +-- icon48.png
|       +-- icon128.png
|
+-- background.js                  Source files (mirror extension/)
+-- content.js
+-- popup.html
+-- popup.css
+-- popup.js
+-- manifest.json
+-- App.tsx                        Vite/React dev playground (optional)
+-- vite.config.ts
+-- tsconfig.json
+-- package.json
+-- .env.example
+-- README.md
```

> **Important:** Always load the `extension/` folder in Chrome. Root source files  
> are the development originals — copy them to `extension/` after changes.

---

## 🔧 Installation

### Prerequisites

| Requirement | Notes |
|-------------|-------|
| Google Chrome 115+ | Required for Manifest V3 |
| [Ollama](https://ollama.com) *(recommended)* | Free, local, no API key needed |
| OR Google Gemini API key | Free tier at [ai.google.dev](https://ai.google.dev) |

### 1. Install Ollama (Local LLM)

Download from [ollama.com](https://ollama.com) and install, then pull a model:

```bash
ollama pull llama3.2       # Recommended — fast (~2 GB)
ollama pull llama3         # Higher quality (~4 GB)
ollama pull mistral        # Strong instruction following (~4 GB)
ollama pull qwen2.5:3b     # Reliable JSON output (~2 GB)
```

Start Ollama:
```bash
ollama serve
# Listening on 127.0.0.1:11434
```

### 2. Clone and Load

```bash
git clone https://github.com/ZANYANBU/Chrome_Assist_AI.git
cd Chrome_Assist_AI
```

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **"Load unpacked"**
4. Select the **`extension/`** folder inside the cloned repo
5. Click the 🧩 icon in Chrome and pin **ZANYSURF AI Agent**

---

## ⚙️ Configuration

Click the **⚙ gear icon** in the popup to open Settings.

### Ollama

| Setting | Default | Description |
|---------|---------|-------------|
| URL | `http://localhost:11434` | Ollama server address |
| Model | `llama3.2:1b` | Any model installed via `ollama pull` |

Click **"Test Connection"** to verify Ollama is reachable and list available models.

### Recommended Models

| Model | Size | Best For |
|-------|------|----------|
| `llama3.2:1b` | ~1 GB | Quick tasks, low RAM systems |
| `llama3.2` | ~2 GB | Good balance of speed vs accuracy |
| `llama3` | ~4 GB | Complex multi-step tasks |
| `mistral` | ~4 GB | Better instruction following |
| `qwen2.5:3b` | ~2 GB | Most reliable JSON output |

### Gemini

| Setting | Description |
|---------|-------------|
| API Key | Free key at [ai.google.dev/gemini-api](https://ai.google.dev/gemini-api) |

The extension uses **Gemini 1.5 Flash** — fast and within the free usage tier.

---

## 📖 Usage Guide

### Starting a Task

1. Click the **ZANYSURF** toolbar icon
2. Type your goal in the text box, or click an example pill
3. Press **Enter** (or Shift+Enter for newline) or click **✦**
4. Watch the agent work in the step cards below

### Example Goals

```
Simple navigation
  "Open YouTube"
  "Go to GitHub"
  "Open Hacker News"

Search tasks (use direct URL shortcut — fastest)
  "Search YouTube for lo-fi music"
  "Find React projects on GitHub"
  "Search Amazon for wireless headphones"
  "Look up async await on Stack Overflow"
  "Find the requests library on PyPI"

Multi-step browsing
  "Open Reddit and browse the top posts"
  "Go to Wikipedia and look up artificial intelligence"
  "Find trending GitHub repositories"

Specific URLs
  "Open https://news.ycombinator.com and read the top story"
```

### Reading a Step Card

```
#3  [NAVIGATE]  github.com/search?q=react      (●) ok
──────────────────────────────────────────────────────
🌐  github.com · GitHub · Search results
━━━ Chain of Thought ━━━
I can construct the search URL directly. I will navigate to
the GitHub search results for "react" immediately.
🔲 42 elements mapped
✓ Navigated to https://github.com/search?q=react&type=repositories
[screenshot of the page]
```

Each card:
- **#N** — Step number
- **[ACTION]** — Badge showing the action type
- **value** — Truncated URL or text value
- **(●) dot** — Yellow=pending, Green=success, Red=failed
- **Chain of Thought** — What the LLM reasoned
- **elements mapped** — How many interactive elements were found
- **✓/✗ detail** — What happened when the action ran
- **Screenshot** — Page state after navigation

### Live Status Bar

While running:
- Shows `Step N/30 — ACTION: value`
- Displays current page URL
- Fills a violet progress bar (steps 1–30)
- **■ Stop** button cancels the run immediately

---

## 🎬 Supported Actions

| Action | Description | Parameters |
|--------|-------------|------------|
| `navigate` | Load a URL in the active tab | `value`: full URL string |
| `click` | Click an element by ID | `element_id`: integer |
| `type` | Type text (React/Vue/Angular safe) | `element_id`: integer, `value`: text |
| `key` | Press a keyboard key | `element_id`: number or null, `value`: key name |
| `scroll` | Scroll the page | `value`: "down" / "up" / "top" |
| `hover` | Mouse hover over element | `element_id`: integer |
| `select` | Pick a `<select>` option | `element_id`: integer, `value`: option text |
| `wait` | Pause execution | `value`: milliseconds (500–8000) |
| `new_tab` | Open URL in a new tab | `value`: full URL |
| `done` | Signal task completion | `thought`: what was accomplished |

**Supported key values:** `Enter`, `Tab`, `Escape`, `ArrowDown`, `ArrowUp`,  
`ArrowLeft`, `ArrowRight`, `Backspace`, `Delete`, `Space`

---

## 🌐 Supported Sites with Site-Specific Hints

ZANYSURF injects tailored DOM knowledge into the LLM prompt for these sites,  
dramatically improving accuracy without needing to map every element:

| Site | Injected Knowledge |
|------|--------------------|
| **YouTube** | search box `aria-label`, results at `/results?search_query=` |
| **Google Search** | input `name="q"`, result anchor structure |
| **GitHub** | `data-testid="search-input"`, repo link pattern |
| **Amazon** | `id="twotabsearchtextbox"`, `.s-result-item` articles |
| **Reddit** | search placeholder, `/r/` link pattern, post structure |
| **Twitter / X** | `aria-label="Search query"`, tweet `<article>` elements |
| **Stack Overflow** | `name="q"`, `.question-hyperlink` class |
| **Wikipedia** | `id="searchInput"`, article `h1#firstHeading` |
| **LinkedIn** | search `aria-label`, `/search/results/all/?keywords=` URL |
| **npm** | search placeholder text, package `<a>` link structure |

---

## 🤖 LLM Providers

### Ollama API Calls

The extension tries `/api/chat` first (Ollama ≥ 0.1.14), then falls back to `/api/generate`:

```json
{
  "model": "llama3.2:1b",
  "messages": [{ "role": "user", "content": "<full prompt>" }],
  "stream": false,
  "format": {
    "type": "object",
    "required": ["thought", "action", "is_complete"],
    "properties": {
      "thought":     { "type": "string" },
      "action":      { "type": "string", "enum": ["navigate","click","type","key","scroll","hover","select","wait","done"] },
      "element_id":  { "type": ["integer","null"] },
      "value":       { "type": ["string","null"] },
      "is_complete": { "type": "boolean" }
    }
  },
  "options": { "temperature": 0.1, "num_predict": 600 }
}
```

### Gemini 1.5 Flash API Call

```json
{
  "contents": [{ "parts": [{ "text": "<full prompt>" }] }],
  "generationConfig": {
    "responseMimeType": "application/json",
    "temperature": 0.1,
    "maxOutputTokens": 600
  }
}
```

### Robust JSON Extraction (4 Strategies)

Even if the LLM adds text around its JSON response, ZANYSURF recovers it:

1. Direct `JSON.parse(rawText)`
2. Strip ` ```json ``` ` markdown fences, then parse
3. Slice first `{...}` block by brace index, then parse
4. Regex field-by-field extraction: `"action":"..."`, `"thought":"..."`, etc.

---

## 🛡️ Safety & Guards

Multiple layers prevent the LLM from making bad decisions:

| Guard | Behaviour |
|-------|-----------|
| **Chrome page guard** | Blocks click/type on `chrome://`, `about:`, `edge://` — navigates to target instead |
| **Unmappable DOM guard** | Empty DOM forces navigate to the target URL |
| **Step 1 guard** | On a new tab, immediately navigates to target or direct search URL |
| **Premature done guard** | Blocks `done` if fewer than 2 steps taken |
| **Hedge-word guard** | Blocks `done` if thought contains "consider", "you should", "you could", "perhaps", "suggest" |
| **Search shortcut guard** | Replaces click-then-search sequences with a direct `?q=` navigate |
| **element_id fallback** | `type` without element_id defaults to element `[0]` |
| **Hard step limit** | Maximum 30 steps per run — no infinite loops |
| **Auto-retry** | Failed click/type/hover/select retries once after 600 ms |
| **Auto-complete on arrival** | After navigate, `checkGoalSatisfied()` runs — exits early if URL confirms goal is met |

---

## 🔬 Technical Details

### DOM Mapping Algorithm

The content script queries these CSS selectors on every step:

```css
a[href], button, input:not([type="hidden"]), textarea, select,
[role="button"], [role="link"], [role="menuitem"], [role="option"],
[role="tab"], [role="textbox"], [role="searchbox"], [role="combobox"],
[contenteditable="true"], [onclick]:not(html):not(body)
```

Visibility checks:
- Bounding rect width AND height > 0
- Not `display:none`, `visibility:hidden`, or `opacity:0`
- Within vertical viewport (with 200 px buffer)

Shadow DOM traversal: up to **4 levels** deep.

Each element gets a visual badge overlay (`.__ZANYSURF_badge`) and is listed in  
the DOM map string as: `[ID] tag role "text description" (type) href/value`

### React / Vue / Angular Input Compatibility

Standard `element.value = text` does not trigger React's synthetic events.  
ZANYSURF uses the native HTMLInputElement prototype setter:

```javascript
const proto = (el.tagName === 'TEXTAREA')
  ? window.HTMLTextAreaElement.prototype
  : window.HTMLInputElement.prototype;
const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
descriptor.set.call(el, value);               // triggers React's internal tracking
el.dispatchEvent(new Event('input',  { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

### Cookie Banner Auto-Dismiss

Before building the DOM map each step, ZANYSURF clicks any visible button  
matching these exact texts (case-insensitive):

```
"accept all"  "accept all cookies"  "accept cookies"  "i agree"
"agree and proceed"  "allow all"  "allow all cookies"  "ok, got it"
"got it"  "allow cookies"  "agree"  "yes, i agree"  "continue"
"dismiss"  "close and accept"  "accept & continue"  "accept and continue"
```

### Screenshot Capture

After every `navigate` action:
```javascript
const dataUrl = await chrome.tabs.captureVisibleTab(null, {
  format: 'jpeg',
  quality: 55    // compact size, readable quality
});
broadcast({ action: 'AGENT_SCREENSHOT', step, dataUrl });
```

The popup receives the message and appends an `<img>` thumbnail to the step card.

---

## 🔍 Troubleshooting

| Problem | Solution |
|---------|---------|
| **Red connection dot** | Run `ollama serve` — check it prints `Listening on 127.0.0.1:11434` |
| **Extension not loading** | Load `extension/` subfolder, not the repo root |
| **"Done in ? steps"** | Fixed in current version; reload the extension at `chrome://extensions` |
| **Agent repeats same steps** | Use a better model: `llama3`, `mistral`, or `qwen2.5:3b` |
| **"Max steps (30) reached"** | Break goal into smaller tasks; be more specific |
| **JSON parse errors** | Switch to `mistral` or `qwen2.5` for better JSON reliability |
| **Ollama in WSL / Docker** | Use `http://127.0.0.1:11434` instead of `localhost` |
| **Page not responding to type** | The site may use a custom framework; try `scroll` first to focus the area |
| **No models in dropdown** | Run `ollama pull llama3.2` to download at least one model |

---

## 🔐 Permissions Explained

| Permission | Why It Is Needed |
|------------|-----------------|
| `activeTab` | Read the current tab's URL and title |
| `scripting` | Inject content.js to map DOM and execute actions |
| `storage` | Save settings and task history locally in the browser |
| `tabs` | Navigate tabs, create new tabs, monitor tab load state |
| `contextMenus` | Reserved for future right-click-to-run feature |
| `notifications` | Reserved for task-complete desktop notifications |
| `http://localhost:11434/*` | Communicate with local Ollama instance |
| `http://127.0.0.1:11434/*` | Alternative localhost address for Ollama |
| `https://generativelanguage.googleapis.com/*` | Communicate with Google Gemini API |
| `<all_urls>` | Map and interact with any webpage the agent needs to visit |

> **Privacy note:** Your page's DOM content is sent only to your local Ollama  
> (never leaves your machine) OR to the Google Gemini API (if that provider  
> is selected). No data is ever sent to any other third-party server.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

```bash
# Fork, then:
git clone https://github.com/YOUR_USERNAME/Chrome_Assist_AI.git
git checkout -b feature/my-feature
git commit -m "feat: describe what you added"
git push origin feature/my-feature
# Open a Pull Request on GitHub
```

### Ideas for Future Features

- [ ] Task history viewer panel in the popup
- [ ] Right-click context menu to set selected text as goal
- [ ] Export completed task as a replayable macro / script
- [ ] Firefox + Edge port
- [ ] Voice input via Web Speech API
- [ ] Vision mode: screenshot + bounding boxes instead of DOM mapping
- [ ] Parallel tab support (multi-tab agent tasks)

---

## 📄 License

Distributed under the [MIT License](LICENSE).

---

<div align="center">

Built with local AI, Chrome MV3, and zero external servers.

**[⭐ Star this repo](https://github.com/ZANYANBU/Chrome_Assist_AI) if ZANYSURF is useful to you!**

</div>

