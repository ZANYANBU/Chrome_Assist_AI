# 2-Minute Demo Video Script (Multi-Agent Research End-to-End)

## Goal
Show ZANYSURF completing a research task using Orchestrator + Research + Analysis + Writer agents, then export/share results.

## Setup (Before recording)
- Turn on screen recording at 1080p.
- Open Chrome with the unpacked extension loaded from extension/.
- Pin extension icon.
- In extension settings, confirm LLM provider works (Ollama or Gemini).
- Prepare one clean browser window.

## Suggested Task Prompt
"Research top AI browser agents, compare claims across sources, detect contradictions, and draft a report in Google Docs."

## Shot List + Voiceover (120s)

### 0:00–0:10 — Hook
On screen:
- Open extension panel.
- Show title and Tier controls.

Voiceover:
"I built ZANYSURF, an autonomous Chrome AI agent that can research, analyze, and write across the web."

### 0:10–0:25 — Enter goal
On screen:
- Paste the suggested task prompt.
- Click Run.

Voiceover:
"I give one high-level goal, and the orchestrator breaks it into specialized subtasks."

### 0:25–0:50 — Show multi-agent orchestration
On screen:
- Highlight Agent Tree and Activity Feed.
- Show bus events flowing (PROGRESS/RESULT).

Voiceover:
"ResearchAgent opens multiple sources in parallel, AnalysisAgent synthesizes claims and contradictions, and WriterAgent drafts structured output."

### 0:50–1:15 — Show research quality
On screen:
- Show facts/sources confidence cards or activity feed updates.
- Mention credibility scoring and deduped facts.

Voiceover:
"It deduplicates facts, applies source credibility heuristics, and returns confidence-scored claims."

### 1:15–1:35 — Show writing output
On screen:
- Switch to generated Google Docs tab.
- Scroll the produced sections.

Voiceover:
"Then it writes a structured report section by section into a browser editor."

### 1:35–1:50 — Show reliability + observability
On screen:
- Open dashboard metrics, audit export button, step replay slider.

Voiceover:
"Every action is auditable. I can replay steps, export logs, and inspect what each agent communicated."

### 1:50–2:00 — CTA
On screen:
- Back to extension panel.
- Show repo URL and one-line value prop overlay.

Voiceover:
"I’m a second-year student building this in public. If you want to try or contribute, links are in the post."

## Editing Notes
- Add captions for every key feature callout.
- Speed up waiting/loading segments 1.25x–1.5x.
- Keep final cut <= 2:00.
