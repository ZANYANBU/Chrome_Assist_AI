# Launch and Community Playbook

This is a practical, step-by-step plan to launch ZANYSURF and drive early adoption in open source communities. Customize links and timings before posting.

---

## Step 0 - Repo readiness (non-negotiable)

Run locally (do not paste into issues or discussions):

```
git add .
git commit -m "feat: v2.3.0 - TabOrchestrator, MemorySystem v2, AsyncTaskEngine, 15/15 tests"
git tag v2.3.0
git push origin main --tags
```

Update the GitHub About box:
- Description: Autonomous AI browser agent - 6 LLM providers, runs locally with Ollama, async multi-tab, memory decay. Chrome and Edge.
- Topics: chrome-extension, browser-agent, ai-agent, ollama, openai, llm, autonomous-agent, manifest-v3, local-ai, privacy, automation, open-source

---

## Launch week - day by day

### Day 1 - Record a demo (90 seconds)

Record a short, focused demo (Loom works well). Suggested script:

```
0:00  Open ZANYSURF side panel and show clean UI
0:08  Type: "Research best mechanical keyboards under $100 on Reddit AND check Amazon prices simultaneously"
0:15  Show the plan card with parallel subtasks
0:20  Show two tabs opening (Reddit + Amazon)
0:40  Show Tab Registry panel with step counts
0:55  Show Memory panel recalling prior searches
1:10  Show final synthesized result
1:25  Show the UI accent color and overall polish
```

Upload to YouTube:
Title: ZANYSURF - AI Browser Agent: Parallel Multi-Tab Research (No Server, Runs Locally)

---

### Day 2 - Show HN post

Post at 6:00 AM EST / 3:30 PM IST. Respond quickly to comments.

Title:
Show HN: Open-source browser AI agent - async parallel tabs, memory decay, 6 LLMs, no server

Body:
I built ZANYSURF, an autonomous browser agent that runs as a Chrome/Edge extension. No server, no subscription. Everything runs in your browser.

What makes it different:
1) Async parallel task engine (multiple goals in separate tabs with a live registry)
2) Memory with decay (short and long term, exponential decay)
3) AES-GCM encrypted vault for API keys
4) 6 LLM providers (Ollama, Gemini, OpenAI, Claude, Groq, Mistral)

Architecture: ReAct + Plan-and-Execute + Reflexion, TabOrchestrator for cross-tab state, AsyncTaskEngine for priority dispatch.

I am a 2nd year CSE student. Built this to understand how browser agents work at the implementation level.

Demo: [YouTube link]
GitHub: https://github.com/ZANYANBU/Chrome_Assist_AI

---

### Day 2 - Subreddit posts

Post separately with unique titles and slight changes:

r/LocalLLaMA
- Title: Built a browser agent that runs in parallel using local Ollama
- Body: Emphasize local-first, zero API cost, and privacy

r/SideProject
- Title: 2nd year CS student - built an open-source browser AI agent
- Body: Ask for honest feedback and point to the demo

r/ChatGPT
- Title: Free alternative to ChatGPT Operator - runs locally, parallel tabs
- Body: Compare pricing and highlight local execution

r/artificial
- Title: Open-source browser agent with async multi-tab orchestration and memory decay
- Body: Technical angle and architecture summary

r/webdev
- Title: Built a Chrome extension with async task queue, memory embeddings, and AES-GCM vault
- Body: Share code references and ask for review

---

### Day 3 - X (Twitter) thread

Post at 9 AM IST:

1/ Most browser AI agents send your data to servers. ZANYSURF does not. Everything runs in your browser.
2/ It can run three browser goals simultaneously in parallel tabs.
3/ Memory decays over time and is boosted when used, just like a human.
4/ Architecture: ReAct + Plan-and-Execute + Reflexion -> AsyncTaskEngine -> TabOrchestrator -> MemorySystem -> AES-GCM vault
5/ 6 LLM providers, works fully offline with Ollama.
6/ Built by a 2nd year CSE student to understand browser agents end-to-end.
7/ GitHub link and request for stars and feedback.

---

### Day 4 - LinkedIn post

Draft:
Most browser AI agents claim privacy but still send data to servers.

ZANYSURF is different:
- Runs entirely in your browser
- Works offline with Ollama
- Encrypts API keys using AES-GCM
- Runs multiple tasks in parallel
- Memory decays like human memory

I am a 2nd year CSE student and would love technical feedback.

---

### Day 5 - Communities

Post in:
- Ollama Discord (#show-your-work)
- LangChain Discord (#show-and-tell)
- Hugging Face Discord
- AI Tinkerers (local chapter)

Write a Dev.to article:
Title: How I built async multi-tab orchestration in a Chrome MV3 extension

---

### Day 7 - Product Hunt

Submit at 12:01 AM PST on a Tuesday.

Name: ZANYSURF
Tagline: Autonomous browser AI agent - runs locally, no servers, parallel tabs

First comment:
Hey PH! I am Anbu, a 2nd year CSE student. I built ZANYSURF because I was frustrated that many browser agents either cost money or send data to servers.

ZANYSURF runs 100% in your browser. If you use Ollama, nothing leaves your machine.

What I am most proud of:
- Async parallel tab engine
- Memory with exponential decay
- AES-GCM encrypted vault

Would love your honest feedback on what is missing.

---

## Realistic expectations

Week 1:
- GitHub stars: 20-80
- Reddit upvotes: 50-300
- HN points: 5-30
- Real users: 10-50

Month 1:
- GitHub stars: 100-500
- Chrome installs: 50-200
- Repeat users: 10-30

Longer term (if you keep improving):
- GitHub stars: 500-2000
- Chrome installs: 500-2000

---

## Notes

- Always reply to early feedback fast.
- Keep demo video short and focused.
- Update screenshots and README before every launch.
