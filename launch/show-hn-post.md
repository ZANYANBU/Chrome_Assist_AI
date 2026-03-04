# Show HN Draft

Title:
Show HN: I built an autonomous browser AI agent as a 2nd year student (Chrome extension)

Body:
Hi HN,

I’m a 2nd-year student and I built ZANYSURF, a Manifest V3 Chrome extension that runs an autonomous browser AI agent.

What it does:
- Takes one goal in plain English
- Plans multi-step execution
- Performs browser actions (click/type/navigate/forms/extract)
- Uses multi-agent orchestration for research workflows:
  - ResearchAgent (parallel source gathering)
  - AnalysisAgent (synthesis + contradiction detection)
  - WriterAgent (drafts structured output in browser editors)
  - ActionAgent (general execution layer)
- Includes memory, scheduling, workflow replay, human approvals, and audit logs

Why I built it:
I wanted a practical way to turn LLM reasoning into reliable browser automation without external servers.

Tech stack:
- Chrome Extension (Manifest V3)
- Background service worker + content scripts
- Ollama (local) and Gemini support
- Structured JSON action loop + safety guards

Demo:
[insert 2-minute demo video link]

Repo:
[insert GitHub repo link]

I’d love feedback on:
1) Reliability in real-world sites
2) Safety/permission model
3) Multi-agent architecture design choices

Thanks for reading.
