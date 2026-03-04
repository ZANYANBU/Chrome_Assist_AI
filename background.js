/**
 * ZANYSURF AI Browser Agent � Background Service Worker v4
 * Fully autonomous chain-of-thought browser agent with robust JSON parsing,
 * multi-provider LLM support, and reliable browser control.
 *
 * Supported providers: Ollama (local) | Gemini API | OpenAI | Claude | Groq | Mistral | Edge built-in AI
 * Actions: navigate, click, type, key, scroll, wait, select, hover, done
 */

'use strict';

// Open Side Panel on Icon Click
if (chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
}

// --- Global state ------------------------------------------------------------
let agentActive   = false;
let agentAbort    = false;
let actionHistory = [];
let sessionGoal   = '';
let globalMemoryContext = ''; // added for Long Context Memory
let sessionMemory = [];
let tabOrchestrationState = {
  nodes: {},
  dependencies: {},
  extracted: {},
  lastSynthesis: ''
};
const pendingApprovals = new Map();
let activeRunContext = { silent: false, trigger: 'manual' };
let currentAgentTree = [];
let currentAgentRunId = null;
let activeIframeContext = null;
let credentialVaultSessionPassphrase = null;
const recentEvents = [];
const modelStats = {};
let activeRunToken = 0;

// =============================================================================
// UPGRADE 1 — TAB ORCHESTRATOR v2
// Full tab lifecycle, dependency graph, health monitoring, cross-tab memory
// =============================================================================
class TabOrchestrator {
  constructor() {
    this.registry    = new Map();   // tabId → TabState
    this.dependencies = new Map();  // tabId → [dependsOnTabId]
    this.results     = new Map();   // tabId → extracted result
    this.orchestrationToken = null;
  }

  // ── Tab Lifecycle ──────────────────────────────────────────────────────────

  async openTab(url, options = {}) {
    try {
      const tab = await chrome.tabs.create({ url, active: false });
      await this.waitForTabReady(tab.id);
      const state = {
        tabId: tab.id,
        url,
        label: options.label || url,
        goal: options.goal || null,
        status: 'ready',
        openedAt: Date.now(),
        completedAt: null,
        runToken: options.runToken || null,
        result: null,
        errorMessage: null,
        stepCount: 0
      };
      this.registry.set(tab.id, state);
      if (Array.isArray(options.dependsOn) && options.dependsOn.length) {
        this.dependencies.set(tab.id, options.dependsOn);
      }
      this.broadcastRegistryUpdate();
      return this.registry.get(tab.id);
    } catch (err) {
      return { tabId: null, error: err.message };
    }
  }

  async waitForTabReady(tabId, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('Tab load timeout after ' + timeoutMs + 'ms'));
      }, timeoutMs);
      chrome.tabs.get(tabId, tab => {
        if (chrome.runtime.lastError) {
          clearTimeout(deadline);
          return reject(new Error('Tab closed before ready'));
        }
        if (tab && tab.status === 'complete') {
          clearTimeout(deadline);
          return resolve();
        }
        const listener = (id, info) => {
          if (id === tabId && info.status === 'complete') {
            clearTimeout(deadline);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
    });
  }

  updateTabState(tabId, patch) {
    const existing = this.registry.get(tabId);
    if (!existing) return;
    this.registry.set(tabId, { ...existing, ...patch });
    this.broadcastRegistryUpdate();
  }

  async closeTab(tabId) {
    try { await chrome.tabs.remove(tabId); } catch (_) {}
    this.registry.delete(tabId);
    this.dependencies.delete(tabId);
    this.broadcastRegistryUpdate();
  }

  async closeAllOrchestratedTabs() {
    const ids = [...this.registry.keys()];
    await Promise.allSettled(ids.map(id => this.closeTab(id)));
  }

  // ── Dependency Resolution ──────────────────────────────────────────────────

  getReadyTabs() {
    return [...this.registry.entries()]
      .filter(([tabId, state]) => {
        if (state.status !== 'ready') return false;
        const deps = this.dependencies.get(tabId) || [];
        return deps.every(depId => this.registry.get(depId)?.status === 'done');
      })
      .map(([, state]) => state);
  }

  areDependenciesMet(tabId) {
    const deps = this.dependencies.get(tabId) || [];
    return deps.every(depId => this.registry.get(depId)?.status === 'done');
  }

  getDependencyResults(tabId) {
    const deps = this.dependencies.get(tabId) || [];
    return deps.map(depId => ({
      tabId: depId,
      label: this.registry.get(depId)?.label,
      result: this.results.get(depId)
    })).filter(d => d.result != null);
  }

  // ── Result Management ──────────────────────────────────────────────────────

  storeResult(tabId, result) {
    this.results.set(tabId, result);
    this.updateTabState(tabId, { status: 'done', completedAt: Date.now(), result });
  }

  storeError(tabId, errorMessage) {
    this.updateTabState(tabId, { status: 'error', completedAt: Date.now(), errorMessage });
  }

  getAllResults() {
    return Object.fromEntries(this.results);
  }

  // ── Health Monitoring ──────────────────────────────────────────────────────

  async auditTabHealth() {
    for (const [tabId, state] of this.registry) {
      if (state.status === 'done' || state.status === 'error') continue;
      try {
        await chrome.tabs.get(tabId);
      } catch (_) {
        this.updateTabState(tabId, { status: 'closed', errorMessage: 'Tab was closed externally' });
      }
    }
  }

  // ── Broadcast ─────────────────────────────────────────────────────────────

  broadcastRegistryUpdate() {
    const snapshot = {};
    for (const [id, s] of this.registry) {
      snapshot[id] = {
        tabId: s.tabId, label: s.label, url: s.url, status: s.status,
        goal: s.goal, stepCount: s.stepCount,
        openedAt: s.openedAt, completedAt: s.completedAt,
        errorMessage: s.errorMessage
      };
    }
    broadcast({ action: 'ORCHESTRATOR_UPDATE', registry: snapshot });
  }

  getSnapshot() {
    const snapshot = {};
    for (const [id, s] of this.registry) snapshot[id] = { ...s };
    return { registry: snapshot, dependencies: Object.fromEntries(this.dependencies) };
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async persist() {
    const serializable = {};
    for (const [id, state] of this.registry) serializable[id] = state;
    await chrome.storage.local.set({ zanysurf_tab_registry: serializable });
  }

  async restore() {
    try {
      const data = await chrome.storage.local.get('zanysurf_tab_registry');
      if (data.zanysurf_tab_registry) {
        for (const [id, state] of Object.entries(data.zanysurf_tab_registry)) {
          this.registry.set(Number(id), state);
        }
        await this.auditTabHealth();
      }
    } catch (_) {}
  }
}

const tabOrchestrator = new TabOrchestrator();

// =============================================================================
// UPGRADE 2 — MEMORY SYSTEM v2 WITH DECAY
// 64-dim embeddings, short/long-term isolation, promotion, exponential decay
// =============================================================================
class MemorySystem {
  constructor() {
    this.shortTerm = [];
    this.longTerm  = [];
    this.config = {
      shortTermLimit: 20,
      longTermLimit: 500,
      promotionThreshold: 3,
      decayHalfLifeDays: 14,
      similarityThreshold: 0.72,
      topK: 5
    };
  }

  // ── Embedding ──────────────────────────────────────────────────────────────

  embed(text) {
    const normalized = String(text || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, '').trim();
    const words = normalized.split(/\s+/).filter(Boolean);
    const vec = new Float32Array(64).fill(0);

    // Character bigram features → dimensions 0-31
    for (let i = 0; i < normalized.length - 1; i++) {
      const bigram = normalized.charCodeAt(i) * 31 + normalized.charCodeAt(i + 1);
      vec[bigram % 32] += 1;
    }
    // Word hash features → dimensions 32-63
    for (const word of words) {
      let h = 5381;
      for (let j = 0; j < word.length; j++) {
        h = ((h << 5) + h) + word.charCodeAt(j);
        h = h & h;
      }
      vec[32 + (Math.abs(h) % 32)] += 1;
    }
    // L2 normalize
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map(v => v / norm);
  }

  cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return Math.max(-1, Math.min(1, dot));
  }

  // ── Decay ──────────────────────────────────────────────────────────────────

  computeDecayWeight(memory) {
    const ageDays = Math.max(0, (Date.now() - (memory.timestamp || Date.now())) / 86_400_000);
    const decayWeight = Math.pow(2, -ageDays / this.config.decayHalfLifeDays);
    const accessBoost = Math.min(2.0, 1 + (memory.accessCount || 0) * 0.1);
    return decayWeight * accessBoost;
  }

  // ── Short-Term ─────────────────────────────────────────────────────────────

  addShortTerm(entry) {
    const memory = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + Math.random().toString(36)),
      ...entry,
      embedding: Array.from(this.embed(entry.goal || '')),
      accessCount: 0,
      promoted: false,
      source: 'short_term',
      timestamp: entry.timestamp || Date.now()
    };
    this.shortTerm.unshift(memory);
    if (this.shortTerm.length > this.config.shortTermLimit) {
      this.shortTerm = this.shortTerm.slice(0, this.config.shortTermLimit);
    }
    return memory;
  }

  getShortTerm() { return [...this.shortTerm]; }
  clearShortTerm() { this.shortTerm = []; }

  // ── Long-Term ──────────────────────────────────────────────────────────────

  async addLongTerm(entry) {
    const memory = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + Math.random().toString(36)),
      ...entry,
      embedding: Array.from(this.embed(entry.goal || '')),
      accessCount: 0,
      source: entry.source || 'long_term',
      timestamp: entry.timestamp || Date.now()
    };
    if (this._isDuplicate(memory, this.longTerm)) return null;
    this.longTerm.unshift(memory);
    await this._pruneAndPersist();
    return memory;
  }

  async _pruneAndPersist() {
    this.longTerm = this.longTerm.filter(m => this.computeDecayWeight(m) > 0.05);
    if (this.longTerm.length > this.config.longTermLimit) {
      this.longTerm = this.longTerm
        .map(m => ({ m, w: this.computeDecayWeight(m) }))
        .sort((a, b) => b.w - a.w)
        .slice(0, this.config.longTermLimit)
        .map(({ m }) => m);
    }
    await this.persist();
  }

  // ── Promotion ─────────────────────────────────────────────────────────────

  async promoteEligible() {
    const toPromote = this.shortTerm.filter(
      m => (m.accessCount || 0) >= this.config.promotionThreshold && !m.promoted
    );
    for (const memory of toPromote) {
      memory.promoted = true;
      memory.source = 'promoted';
      await this.addLongTerm({ ...memory });
    }
    this.shortTerm = this.shortTerm.filter(m => !m.promoted);
  }

  // ── Deduplication ─────────────────────────────────────────────────────────

  _isDuplicate(newMem, pool) {
    const embA = newMem.embedding instanceof Float32Array
      ? newMem.embedding
      : new Float32Array(newMem.embedding || []);
    return pool.some(existing => {
      const embB = existing.embedding instanceof Float32Array
        ? existing.embedding
        : new Float32Array(existing.embedding || []);
      return this.cosineSimilarity(embA, embB) >= this.config.similarityThreshold;
    });
  }

  // ── Retrieval ──────────────────────────────────────────────────────────────

  retrieve(queryGoal, options = {}) {
    const k = options.topK || this.config.topK;
    const queryEmb = this.embed(queryGoal || '');
    const pool = [...this.shortTerm, ...this.longTerm];
    if (!pool.length) return [];

    const scored = pool.map(memory => {
      const embB = memory.embedding instanceof Float32Array
        ? memory.embedding
        : new Float32Array(memory.embedding || []);
      const similarity = this.cosineSimilarity(queryEmb, embB);
      const decayWeight = this.computeDecayWeight(memory);
      const score = similarity * decayWeight;
      return { memory, score, similarity };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.filter(s => s.score > 0.1).slice(0, k);
    top.forEach(({ memory }) => { memory.accessCount = (memory.accessCount || 0) + 1; });
    this.promoteEligible().catch(() => {});

    return top.map(({ memory, score, similarity }) => ({
      id: memory.id,
      goal: memory.goal,
      result: memory.result,
      sites: memory.sites,
      timestamp: memory.timestamp,
      score: Math.round(score * 100) / 100,
      similarity: Math.round(similarity * 100) / 100,
      source: memory.source,
      accessCount: memory.accessCount
    }));
  }

  // ── Context Injection ──────────────────────────────────────────────────────

  buildContextString(queryGoal) {
    const memories = this.retrieve(queryGoal);
    if (!memories.length) return '';
    const lines = memories.map((m, i) =>
      `[Memory ${i + 1}] (relevance: ${m.score}) Goal: "${m.goal}" ` +
      `Sites: ${(m.sites || []).join(', ')} Result: ${m.result || 'completed'}`
    );
    return '\nRELEVANT PAST EXPERIENCE:\n' + lines.join('\n') + '\n';
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  getStats() {
    const activeLong = this.longTerm.filter(m => this.computeDecayWeight(m) > 0.1).length;
    const decayedLong = this.longTerm.length - activeLong;
    const avgDecayWeight = this.longTerm.length > 0
      ? Math.round((this.longTerm.reduce((s, m) => s + this.computeDecayWeight(m), 0) / this.longTerm.length) * 100) / 100
      : 0;
    return {
      shortTermCount: this.shortTerm.length,
      longTermCount: activeLong,
      decayedCount: decayedLong,
      totalCount: this.shortTerm.length + this.longTerm.length,
      avgDecayWeight,
      config: this.config
    };
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async persist() {
    await chrome.storage.local.set({
      zanysurf_memory_v2: { longTerm: this.longTerm, savedAt: Date.now() }
    });
  }

  async restore() {
    try {
      const data = await chrome.storage.local.get('zanysurf_memory_v2');
      if (data.zanysurf_memory_v2?.longTerm) {
        this.longTerm = data.zanysurf_memory_v2.longTerm.map(m => ({
          ...m,
          embedding: m.embedding ? new Float32Array(m.embedding) : Array.from(this.embed(m.goal || ''))
        }));
      }
    } catch (_) {}
  }

  async clear(scope = 'all') {
    if (scope === 'short' || scope === 'all') this.shortTerm = [];
    if (scope === 'long' || scope === 'all') {
      this.longTerm = [];
      await chrome.storage.local.remove('zanysurf_memory_v2');
    }
  }
}

const memorySystem = new MemorySystem();

// =============================================================================
// UPGRADE 3 — ASYNC TASK ENGINE
// Priority queue, dependency graph, concurrency control, progress aggregation
// =============================================================================
class AsyncTaskEngine {
  constructor() {
    this.queue       = [];
    this.active      = new Map();   // taskId → TaskRunner
    this.completed   = new Map();   // taskId → task object
    this.maxConcurrent = 3;
    this.running     = false;
  }

  createTask(config) {
    return {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + Math.random().toString(36)),
      goal: config.goal,
      tabId: config.tabId || null,
      priority: config.priority || 5,
      dependsOn: config.dependsOn || [],
      label: config.label || String(config.goal || '').slice(0, 40),
      metadata: config.metadata || {},
      status: 'queued',
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      progress: 0,
      stepCount: 0
    };
  }

  enqueue(config) {
    const task = this.createTask(config);
    const insertIdx = this.queue.findIndex(t => t.priority > task.priority);
    if (insertIdx === -1) { this.queue.push(task); } else { this.queue.splice(insertIdx, 0, task); }
    this.broadcastUpdate();
    this.tryDispatch();
    return task;
  }

  enqueueMany(configs) {
    return configs.map(c => this.enqueue(c));
  }

  cancel(taskId) {
    const qIdx = this.queue.findIndex(t => t.id === taskId);
    if (qIdx !== -1) { this.queue.splice(qIdx, 1); }
    if (this.active.has(taskId)) {
      this.active.get(taskId).cancel();
      this.active.delete(taskId);
    }
    this.broadcastUpdate();
  }

  cancelAll() {
    this.queue = [];
    for (const runner of this.active.values()) runner.cancel();
    this.active.clear();
    this.broadcastUpdate();
  }

  areDepsComplete(task) {
    return task.dependsOn.every(depId => this.completed.get(depId)?.status === 'done');
  }

  getDepsOutput(task) {
    return task.dependsOn.map(depId => this.completed.get(depId)).filter(Boolean);
  }

  tryDispatch() {
    if (this.active.size >= this.maxConcurrent) return;
    if (!this.queue.length) return;
    const readyIdx = this.queue.findIndex(task => this.areDepsComplete(task));
    if (readyIdx === -1) {
      this.queue.forEach(t => { if (!this.areDepsComplete(t)) t.status = 'waiting'; });
      this.broadcastUpdate();
      return;
    }
    const task = this.queue.splice(readyIdx, 1)[0];
    this.dispatch(task);
  }

  dispatch(task) {
    task.status = 'running';
    task.startedAt = Date.now();
    task.progress = 0;
    const depsOutput = this.getDepsOutput(task);
    const self = this;

    const runner = new ZanyTaskRunner(task, depsOutput, {
      onProgress: (step, total) => {
        task.stepCount = step;
        task.progress = total > 0 ? Math.round((step / total) * 100) : 0;
        self.broadcastUpdate();
      },
      onComplete: (result) => {
        task.status = 'done';
        task.result = result;
        task.completedAt = Date.now();
        task.progress = 100;
        self.completed.set(task.id, task);
        self.active.delete(task.id);
        // Store in memory system
        memorySystem.addShortTerm({
          goal: task.goal,
          result: typeof result === 'string' ? result.slice(0, 300) : JSON.stringify(result).slice(0, 300),
          sites: [],
          timestamp: Date.now()
        });
        self.broadcastUpdate();
        self.tryDispatch();
      },
      onError: (error) => {
        task.status = 'error';
        task.error = error.message;
        task.completedAt = Date.now();
        self.completed.set(task.id, task);
        self.active.delete(task.id);
        self.broadcastUpdate();
        self.tryDispatch();
      }
    });

    this.active.set(task.id, runner);
    this.broadcastUpdate();
    runner.run().catch(err => {
      task.status = 'error';
      task.error = err.message;
      this.active.delete(task.id);
      this.broadcastUpdate();
    });
  }

  getAggregatedProgress() {
    const allTasks = [
      ...this.queue,
      ...[...this.active.values()].map(r => r.task),
      ...[...this.completed.values()]
    ];
    if (!allTasks.length) return null;
    const done    = allTasks.filter(t => t.status === 'done' || t.status === 'error').length;
    const running = allTasks.filter(t => t.status === 'running').length;
    const progressSum = allTasks.reduce((s, t) => {
      if (t.status === 'done' || t.status === 'error') return s + 100;
      return s + (t.progress || 0);
    }, 0);
    return {
      total: allTasks.length,
      done,
      running,
      queued: this.queue.length,
      overallProgress: Math.round(progressSum / allTasks.length),
      isComplete: done === allTasks.length
    };
  }

  broadcastUpdate() {
    broadcast({
      action: 'TASK_ENGINE_UPDATE',
      queue: this.queue,
      active: [...this.active.values()].map(r => r.task),
      completed: [...this.completed.values()].slice(-20),
      aggregated: this.getAggregatedProgress()
    });
  }

  getSnapshot() {
    return {
      queue: this.queue,
      active: [...this.active.values()].map(r => r.task),
      completed: [...this.completed.values()].slice(-20),
      aggregated: this.getAggregatedProgress(),
      maxConcurrent: this.maxConcurrent
    };
  }
}

class ZanyTaskRunner {
  constructor(task, depsOutput, callbacks) {
    this.task        = task;
    this.depsOutput  = depsOutput;
    this.callbacks   = callbacks;
    this.cancelled   = false;
    this.runToken    = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36);
  }

  cancel() { this.cancelled = true; }

  async run() {
    try {
      let tabId = this.task.tabId;
      if (!tabId) {
        const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
        tabId = tab.id;
        this.task.tabId = tabId;
      }

      // Register in TabOrchestrator
      tabOrchestrator.registry.set(tabId, {
        tabId,
        url: 'about:blank',
        label: this.task.label,
        goal: this.task.goal,
        status: 'running',
        openedAt: this.task.startedAt || Date.now(),
        completedAt: null,
        runToken: this.runToken,
        result: null,
        errorMessage: null,
        stepCount: 0
      });
      tabOrchestrator.broadcastRegistryUpdate();

      // Enrich goal with dependency context
      let enrichedGoal = this.task.goal;
      if (this.depsOutput.length > 0) {
        enrichedGoal += '\n\nContext from prior tasks:\n' +
          this.depsOutput.map(d => `- ${d.label || d.goal}: ${JSON.stringify(d.result || '').slice(0, 200)}`).join('\n');
      }

      // Also inject memory context
      const memCtx = memorySystem.buildContextString(this.task.goal);
      if (memCtx) enrichedGoal += memCtx;

      const maxSteps = 30;
      let step = 0;
      const result = await runAgentLoopOnTab(tabId, enrichedGoal, this.runToken, (s) => {
        if (this.cancelled) throw new Error('Cancelled');
        step = s;
        this.callbacks.onProgress(s, maxSteps);
        tabOrchestrator.updateTabState(tabId, { stepCount: s, status: 'running' });
      });

      if (this.cancelled) { tabOrchestrator.storeError(tabId, 'Cancelled'); return; }
      tabOrchestrator.storeResult(tabId, result);
      this.callbacks.onComplete(result);
    } catch (err) {
      if (!this.cancelled) {
        tabOrchestrator.storeError(this.task.tabId || 0, err.message);
        this.callbacks.onError(err);
      }
    }
  }
}

const asyncTaskEngine = new AsyncTaskEngine();

// Startup: restore memory and tab registry
(async () => {
  try {
    await memorySystem.restore();
    await tabOrchestrator.restore();
  } catch (_) {}
})();

const MODEL_PROFILES = {
  'llama3.2:1b': { speed: 'fast', quality: 'basic', recommended: 'simple tasks' },
  'llama3.2': { speed: 'medium', quality: 'good', recommended: 'most tasks' },
  'llama3': { speed: 'slow', quality: 'best-local', recommended: 'complex reasoning' },
  'mistral': { speed: 'medium', quality: 'good', recommended: 'instruction following' },
  'qwen2.5:3b': { speed: 'fast', quality: 'good', recommended: 'reliable JSON output' },
  'deepseek-r1': { speed: 'slow', quality: 'excellent', recommended: 'complex multi-step planning' },
  'codellama': { speed: 'medium', quality: 'specialized', recommended: 'code-heavy tasks' }
};

const PROVIDER_MODELS = {
  ollama: ['llama3.2:1b','llama3.2','llama3','mistral','qwen2.5:3b','deepseek-r1','phi3','gemma2','codellama'],
  gemini: ['gemini-1.5-flash','gemini-1.5-pro','gemini-2.0-flash-exp','gemini-2.5-pro-preview'],
  openai: ['gpt-4o','gpt-4o-mini','gpt-4-turbo','gpt-3.5-turbo','o1-mini','o3-mini'],
  claude: ['claude-opus-4-5','claude-sonnet-4-5','claude-haiku-4-5'],
  groq: ['llama-3.3-70b-versatile','llama-3.1-8b-instant','mixtral-8x7b-32768','gemma2-9b-it'],
  mistral: ['mistral-large-latest','mistral-small-latest','open-mistral-7b','open-mixtral-8x7b'],
  edge_builtin: ['phi-3-mini']
};

const EXECUTE_JS_PRESETS = [
  'get_title',
  'get_url',
  'get_selection',
  'get_meta_description',
  'get_canonical_url',
  'get_page_language',
  'get_scroll_position',
  'get_form_count',
  'get_video_duration',
  'get_article_text',
  'is_logged_in',
  'get_react_version',
  'count_elements',
  'get_computed_style'
];

const STORAGE_KEYS = {
  AUDIT: 'zanysurf_audit_log',
  GRAPH: 'zanysurf_knowledge_graph',
  PROFILE: 'zanysurf_user_profile',
  QUICK_RUNS: 'zanysurf_quick_runs',
  BRIDGES: 'zanysurf_extension_bridges',
  SAFE_MODE: 'zanysurf_safe_mode',
  API_METRICS: 'zanysurf_api_metrics',
  NETWORK_CACHE: 'zanysurf_network_cache',
  LAST_SESSION: 'zanysurf_last_session_state',
  CREDENTIAL_VAULT: 'zanysurf_credential_vault'
};

async function getSettings() {
  const stored = await chrome.storage.local.get([
    'provider', 'model', 'ollamaUrl', 'ollamaModel', 'apiKey',
    'openaiModel', 'claudeModel', 'groqModel', 'mistralModel', 'geminiModel', 'edgeBuiltinModel'
  ]);
  const provider = String(stored.provider || 'ollama').toLowerCase();
  const providerModels = {
    ollama: stored.ollamaModel || stored.model || 'llama3',
    gemini: stored.geminiModel || stored.model || 'gemini-1.5-flash',
    openai: stored.openaiModel || stored.model || 'gpt-4o-mini',
    claude: stored.claudeModel || stored.model || 'claude-haiku-4-5',
    groq: stored.groqModel || stored.model || 'llama-3.1-8b-instant',
    mistral: stored.mistralModel || stored.model || 'mistral-small-latest',
    edge_builtin: stored.edgeBuiltinModel || stored.model || 'phi-3-mini'
  };
  const keyMap = await loadProviderApiKeys();
  const providerKey = keyMap[provider] || '';

  return {
    ...stored,
    provider,
    model: providerModels[provider] || stored.model || providerModels.ollama,
    providerKey,
    keyMap,
    apiKey: provider === 'gemini' ? (providerKey || stored.apiKey || '') : (stored.apiKey || ''),
    ollamaUrl: stored.ollamaUrl || 'http://localhost:11434'
  };
}

function recommendModel(goal, availableModels = []) {
  const goalLower = String(goal || '').toLowerCase();
  if (!Array.isArray(availableModels) || !availableModels.length) return null;

  if (goalLower.includes('code') || goalLower.includes('script')) {
    return findBestModel(availableModels, ['codellama', 'deepseek-r1', 'llama3']);
  }
  if (goalLower.includes('research') || goalLower.includes('analyze')) {
    return findBestModel(availableModels, ['deepseek-r1', 'llama3', 'mistral']);
  }
  if (goalLower.includes('form') || goalLower.includes('fill')) {
    return findBestModel(availableModels, ['qwen2.5:3b', 'mistral', 'llama3.2']);
  }
  return findBestModel(availableModels, ['llama3.2', 'mistral', 'llama3.2:1b']);
}

function findBestModel(availableModels, preferred) {
  const available = availableModels.map(item => typeof item === 'string' ? item : item?.name).filter(Boolean);
  for (const candidate of preferred) {
    const found = available.find(model => model === candidate || model.startsWith(candidate + ':') || model.includes(candidate));
    if (found) return found;
  }
  return available[0] || null;
}

function isRunTokenCurrent(runToken) {
  return Number(runToken || activeRunToken) === activeRunToken;
}

function cancelActiveRun(reason = 'cancelled', clearHistory = false) {
  activeRunToken += 1;
  agentAbort = true;
  agentActive = false;
  currentAgentTree = [];

  // Close all orchestrated tabs and cancel queued async tasks
  tabOrchestrator.closeAllOrchestratedTabs().catch(() => {});
  asyncTaskEngine.cancelAll();

  if (clearHistory) {
    actionHistory = [];
    sessionGoal = '';
    sessionMemory = [];
    tabOrchestrationState = { nodes: {}, dependencies: {}, extracted: {}, lastSynthesis: '' };
  }

  broadcast({
    action: 'AGENT_STATUS',
    status: 'stopped',
    message: 'Run cancelled: ' + reason
  });
  return activeRunToken;
}

function startNewRun(reason = 'manual') {
  const hadActiveRun = agentActive || actionHistory.length > 0 || !!sessionGoal || currentAgentTree.length > 0;
  if (!hadActiveRun) {
    activeRunToken += 1;
    agentAbort = false;
    return activeRunToken;
  }

  const nextToken = cancelActiveRun('superseded-' + reason, true);
  agentAbort = false;
  if (hadActiveRun) {
    broadcast({
      action: 'AGENT_STATUS',
      status: 'running',
      message: 'Starting fresh run (previous commands cleared).'
    });
  }
  return nextToken;
}

// --- Message router ----------------------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'RUN_AGENT') {
    const runToken = startNewRun('run-agent');
    runAgentEntry(request.prompt, { ...(request.options || {}), runToken });
    sendResponse({ status: 'started', runToken });
    return true;
  }
  if (request.action === 'PING') {
    sendResponse({ pong: true, ts: Date.now() });
    return true;
  }
  if (request.action === 'GET_SETTINGS') {
    getSettings().then(settings => {
      sendResponse({
        provider: settings.provider,
        model: settings.model,
        ollamaUrl: settings.ollamaUrl,
        hasKey: !!settings.providerKey,
        settings
      });
    }).catch(error => sendResponse({ error: error.message }));
    return true;
  }
  if (request.action === 'GET_PROVIDER_LIST') {
    sendResponse({ success: true, providers: Object.keys(PROVIDER_MODELS) });
    return true;
  }
  if (request.action === 'GET_MODELS_FOR_PROVIDER') {
    const provider = String(request.provider || '').toLowerCase();
    const models = (PROVIDER_MODELS[provider] || []).map(name => ({ name, profile: MODEL_PROFILES[name] || null }));
    sendResponse({ success: true, models });
    return true;
  }
  if (request.action === 'DETECT_OLLAMA_MODELS') {
    const url = String(request.ollamaUrl || 'http://localhost:11434');
    detectOllamaModels(url)
      .then(models => sendResponse({ success: true, models }))
      .catch(error => sendResponse({ success: false, error: error.message, models: [] }));
    return true;
  }
  if (request.action === 'TEST_PROVIDER_CONNECTION') {
    getSettings().then(settings => {
      const provider = String(request.provider || settings.provider || 'ollama');
      return LLMGateway.testConnection(provider, settings);
    }).then(result => sendResponse(result)).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (request.action === 'STORE_PROVIDER_KEY') {
    storeProviderApiKey(String(request.provider || ''), String(request.key || ''), String(request.passphrase || credentialVaultSessionPassphrase || ''))
      .then(() => sendResponse({ success: true, ok: true }))
      .catch(error => sendResponse({ success: false, ok: false, error: error.message }));
    return true;
  }
  if (request.action === 'GET_MODEL_PERFORMANCE') {
    sendResponse({ success: true, stats: modelStats });
    return true;
  }
  if (request.action === 'RECOMMEND_MODEL') {
    const provider = String(request.provider || 'ollama').toLowerCase();
    const available = Array.isArray(request.availableModels) && request.availableModels.length
      ? request.availableModels
      : (PROVIDER_MODELS[provider] || []);
    const recommendation = recommendModel(String(request.goal || ''), available);
    sendResponse({ success: true, recommendation });
    return true;
  }
  if (request.action === 'RUN_MULTI_AGENT') {
    // When goals[] is provided → parallel async execution via AsyncTaskEngine
    if (Array.isArray(request.goals) && request.goals.length > 0) {
      const tasks = request.goals.map(g => ({
        goal    : typeof g === 'string' ? g : (g.goal || ''),
        priority: (typeof g === 'object' && g.priority) || 5,
        dependsOn: (typeof g === 'object' && Array.isArray(g.dependsOn) ? g.dependsOn : []),
        label   : (typeof g === 'object' && g.label) || String(typeof g === 'string' ? g : g.goal || '').slice(0, 40)
      }));
      asyncTaskEngine.enqueueMany(tasks);
      sendResponse({ success: true, status: 'enqueued', count: tasks.length });
      return true;
    }
    // Legacy / single-goal path → sequential runAgentEntry
    const runToken = startNewRun('run-multi-agent');
    runAgentEntry(request.prompt, { ...(request.options || {}), multiAgent: true, runToken });
    sendResponse({ status: 'started', runToken });
    return true;
  }
  if (request.action === 'GET_AGENT_TREE') {
    sendResponse({ success: true, runId: currentAgentRunId, tree: currentAgentTree });
    return true;
  }
  if (request.action === 'GET_AGENT_DASHBOARD') {
    buildAgentDashboardSummary()
      .then(summary => sendResponse({ success: true, summary }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'EXPORT_AUDIT_LOG') {
    exportAuditLog().then(result => sendResponse(result)).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'GET_KNOWLEDGE_GRAPH') {
    getKnowledgeGraph().then(graph => sendResponse({ success: true, graph })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'SET_USER_PROFILE') {
    setUserProfile(request.profile || {}).then(profile => sendResponse({ success: true, profile })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'GET_USER_PROFILE') {
    getUserProfile().then(profile => sendResponse({ success: true, profile })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'LIST_QUICKRUNS') {
    listQuickRuns().then(goals => sendResponse({ success: true, goals })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'SAVE_GOAL_QUICKRUN') {
    saveQuickRunGoal(request.goal || '').then(goals => sendResponse({ success: true, goals })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'TOGGLE_SAFE_MODE') {
    toggleSafeMode(!!request.enabled).then(enabled => sendResponse({ success: true, enabled })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'SET_EXTENSION_BRIDGES') {
    setExtensionBridges(request.bridges || []).then(bridges => sendResponse({ success: true, bridges })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'LIST_EXTENSION_BRIDGES') {
    listExtensionBridges().then(bridges => sendResponse({ success: true, bridges })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'GENERATE_STEP_REPLAY_REPORT') {
    generateStepReplayHtml().then(html => sendResponse({ success: true, html })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'UNLOCK_CREDENTIAL_VAULT') {
    unlockCredentialVault(request.passphrase || '').then(result => sendResponse(result)).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'VAULT_UNLOCK') {
    unlockCredentialVault(request.passphrase || '')
      .then(() => sendResponse({ ok: true, success: true }))
      .catch(error => sendResponse({ ok: false, success: false, error: error.message }));
    return true;
  }
  if (request.action === 'VAULT_LOCK') {
    lockCredentialVault();
    sendResponse({ ok: true, success: true });
    return true;
  }
  if (request.action === 'SAVE_CREDENTIAL') {
    saveCredentialEntry({
      site: request.site,
      username: request.username,
      password: request.password,
      passphrase: request.passphrase,
      notes: request.notes || ''
    }).then(result => sendResponse({ success: true, entry: result })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'LIST_CREDENTIALS') {
    listCredentialEntries().then(entries => sendResponse({ success: true, entries })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'DELETE_CREDENTIAL') {
    deleteCredentialEntry(request.id).then(() => sendResponse({ success: true })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'LOGIN_WITH_CREDENTIAL') {
    loginWithSavedCredential(request).then(result => sendResponse({ success: true, result })).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'CREATE_SCHEDULED_TASK') {
    SchedulerEngine.createTask({ goal: request.goal, schedule: request.schedule })
      .then(task => sendResponse({ success: true, task }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'CREATE_SCHEDULE') {
    SchedulerEngine.createTask({ goal: request.goal, schedule: request.schedule })
      .then(task => sendResponse({ success: true, task, id: task.id }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'GET_SCHEDULES') {
    SchedulerEngine.listTasks()
      .then(schedules => sendResponse({ success: true, schedules }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'DELETE_SCHEDULE') {
    SchedulerEngine.deleteTask(request.id)
      .then(() => sendResponse({ success: true, ok: true }))
      .catch(error => sendResponse({ success: false, ok: false, error: error.message }));
    return true;
  }
  if (request.action === 'LIST_SCHEDULED_TASKS') {
    SchedulerEngine.listTasks()
      .then(tasks => sendResponse({ success: true, tasks }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'UPDATE_SCHEDULED_TASK') {
    SchedulerEngine.updateTask(request.taskId, request.patch || {})
      .then(task => sendResponse({ success: true, task }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'DELETE_SCHEDULED_TASK') {
    SchedulerEngine.deleteTask(request.taskId)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'RUN_SCHEDULED_TASK_NOW') {
    SchedulerEngine.runTaskNow(request.taskId)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'APPROVAL_RESPONSE') {
    const resolver = pendingApprovals.get(request.requestId);
    if (resolver) {
      pendingApprovals.delete(request.requestId);
      resolver(!!request.approved);
    }
    sendResponse({ success: true });
    return true;
  }
  if (request.action === 'SAVE_SMART_BOOKMARK') {
    SmartBookmarks.save(request.name, request.url, request.context || '')
      .then(bookmark => sendResponse({ success: true, bookmark, id: bookmark.id }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'SAVE_BOOKMARK') {
    SmartBookmarks.save(request.name, request.url, request.context || '')
      .then(bookmark => sendResponse({ success: true, bookmark, id: bookmark.id }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'LIST_SMART_BOOKMARKS') {
    SmartBookmarks.list()
      .then(bookmarks => sendResponse({ success: true, bookmarks }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'REPLAY_WORKFLOW') {
    replayWorkflow(request.workflowId)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'LIST_WORKFLOWS') {
    listWorkflows().then(workflows => sendResponse({ success: true, workflows }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'GET_WORKFLOWS') {
    listWorkflows().then(workflows => sendResponse({ success: true, workflows }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'GET_BOOKMARKS') {
    SmartBookmarks.list()
      .then(bookmarks => sendResponse({ success: true, bookmarks }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'GET_MEMORY_CONTEXT') {
    retrieveMemoryContext(String(request.goal || request.prompt || 'session'))
      .then(context => {
        const lines = String(context || '').split('\n').map(s => s.trim()).filter(Boolean);
        sendResponse({ success: true, memory: lines, memories: lines });
      })
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'APPEND_AUDIT_LOG') {
    appendAuditLog(request.entry || {})
      .then(() => sendResponse({ ok: true, success: true }))
      .catch(error => sendResponse({ ok: false, success: false, error: error.message }));
    return true;
  }
  if (request.action === 'GET_SESSION_STATE') {
    chrome.storage.local.get([STORAGE_KEYS.LAST_SESSION])
      .then(stored => {
        const state = stored[STORAGE_KEYS.LAST_SESSION] || null;
        sendResponse({ success: true, state, ...(state || {}) });
      })
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'GET_API_METRICS') {
    chrome.storage.local.get([STORAGE_KEYS.API_METRICS])
      .then(stored => {
        const metrics = stored[STORAGE_KEYS.API_METRICS] || {};
        const payload = { ...metrics, callCount: Number(metrics.calls || 0) };
        sendResponse({ success: true, metrics: payload, ...payload });
      })
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'CHECK_RATE_LIMIT') {
    const callCount = Number(request.callCount || 0);
    sendResponse({ success: true, exceeded: callCount > 100, provider: request.provider || 'unknown', callCount });
    return true;
  }
  if (request.action === 'SET_SAFE_MODE') {
    toggleSafeMode(!!request.enabled)
      .then(enabled => sendResponse({ success: true, enabled, safeMode: enabled }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'GET_SAFE_MODE') {
    getSafeMode()
      .then(enabled => sendResponse({ success: true, enabled, safeMode: enabled }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'TEST_ERROR_CLASSIFICATION') {
    const probe = classifyAgentError(new Error(String(request.errorMessage || request.message || 'network timeout')));
    sendResponse({ success: true, classification: probe, type: probe.type, message: probe.message });
    return true;
  }
  if (request.action === 'DELETE_BOOKMARK') {
    SmartBookmarks.deleteById(request.id)
      .then(() => sendResponse({ success: true, ok: true }))
      .catch(error => sendResponse({ success: false, ok: false, error: error.message }));
    return true;
  }
  if (request.action === 'GET_RECENT_EVENTS') {
    sendResponse({ success: true, events: recentEvents.slice(-200) });
    return true;
  }
  if (request.action === 'STOP_AGENT') {
    cancelActiveRun('stop-agent', false);
    sendResponse({ status: 'stopped', runToken: activeRunToken });
    return true;
  }
  if (request.action === 'CANCEL_AND_CLEAR') {
    cancelActiveRun('cancel-and-clear', true);
    sendResponse({ status: 'cancelled', runToken: activeRunToken });
    return true;
  }
  if (request.action === 'CLEAR_MEMORY') {
    cancelActiveRun('clear-memory', true);
    actionHistory = [];
    sessionGoal   = '';
    sessionMemory = [];
    tabOrchestrationState = { nodes: {}, dependencies: {}, extracted: {}, lastSynthesis: '' };
    memorySystem.clear('all').catch(() => {});
    sendResponse({ status: 'cleared' });
    return true;
  }
  if (request.action === 'GET_MEMORY_SUMMARY') {
    getMemorySummary().then(summary => sendResponse({ summary })).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (request.action === 'EXPORT_LAST_CSV') {
    exportLatestCsv().then(result => sendResponse(result)).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request.action === 'GET_STATUS') {
    sendResponse({ active: agentActive, steps: actionHistory.length });
    return true;
  }

  // ── Tab Orchestrator v2 ──────────────────────────────────────────────────
  if (request.action === 'GET_TAB_REGISTRY') {
    sendResponse(tabOrchestrator.getSnapshot());
    return true;
  }
  if (request.action === 'CLOSE_TAB') {
    tabOrchestrator.closeTab(request.tabId)
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }
  if (request.action === 'CLOSE_ALL_TABS') {
    tabOrchestrator.closeAllOrchestratedTabs()
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  // ── Memory System v2 ────────────────────────────────────────────────────
  if (request.action === 'GET_MEMORY_STATS') {
    sendResponse({ success: true, stats: memorySystem.getStats() });
    return true;
  }
  if (request.action === 'GET_SHORT_TERM') {
    sendResponse({ success: true, memories: memorySystem.shortTerm });
    return true;
  }
  if (request.action === 'SEARCH_MEMORY') {
    const results = memorySystem.retrieve(request.query || '', { topK: Math.min(20, Number(request.topK) || 10) });
    sendResponse({ success: true, results });
    return true;
  }
  if (request.action === 'GET_LONG_TERM') {
    sendResponse({ success: true, memories: memorySystem.longTerm });
    return true;
  }
  if (request.action === 'CLEAR_MEMORY_V2') {
    memorySystem.clear(request.scope || 'all')
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  // ── Async Task Engine ───────────────────────────────────────────────────
  if (request.action === 'GET_TASK_ENGINE') {
    sendResponse({ success: true, ...asyncTaskEngine.getSnapshot() });
    return true;
  }
  if (request.action === 'CANCEL_TASK') {
    asyncTaskEngine.cancel(request.taskId);
    sendResponse({ success: true });
    return true;
  }
  if (request.action === 'CANCEL_ALL_TASKS') {
    asyncTaskEngine.cancelAll();
    sendResponse({ success: true });
    return true;
  }
  if (request.action === 'SET_MAX_CONCURRENT') {
    asyncTaskEngine.maxConcurrent = Math.max(1, Math.min(5, Number(request.max || 3)));
    sendResponse({ success: true, maxConcurrent: asyncTaskEngine.maxConcurrent });
    return true;
  }
  if (request.action === 'ENQUEUE_TASKS') {
    // request.tasks: Array<{ id, goal, priority, dependencies }>
    const tasks = (request.tasks || []).map(t => ({
      id          : t.id || crypto.randomUUID(),
      goal        : t.goal,
      priority    : t.priority || 5,
      dependencies: t.dependencies || [],
      runner      : new ZanyTaskRunner(t.goal, t.priority || 5)
    }));
    asyncTaskEngine.enqueueMany(tasks);
    sendResponse({ success: true, queued: tasks.length });
    return true;
  }
});

chrome.commands?.onCommand.addListener((command) => {
  if (command === 'toggle-sidepanel') {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return;
      chrome.sidePanel?.open({ tabId: tab.id }).catch(() => {});
    }).catch(() => {});
  }
});

// =============================================================================
// TASK SCHEDULER (CHROME ALARMS)
// =============================================================================
const SchedulerEngine = {
  storageKey: 'zanysurf_scheduled_tasks',

  async createTask(config) {
    const task = {
      id: crypto.randomUUID(),
      goal: config.goal,
      schedule: config.schedule,
      lastRun: null,
      nextRun: this.calculateNextRun(config.schedule),
      enabled: true,
      runCount: 0,
      results: []
    };
    const tasks = await this.listTasks();
    tasks.push(task);
    await chrome.storage.local.set({ [this.storageKey]: tasks });
    await this.registerAlarm(task);
    return task;
  },

  async listTasks() {
    const stored = await chrome.storage.local.get([this.storageKey]);
    return stored[this.storageKey] || [];
  },

  async getTask(taskId) {
    const tasks = await this.listTasks();
    return tasks.find(task => task.id === taskId) || null;
  },

  async updateTask(taskId, patch) {
    const tasks = await this.listTasks();
    const index = tasks.findIndex(task => task.id === taskId);
    if (index === -1) throw new Error('Scheduled task not found.');

    tasks[index] = { ...tasks[index], ...patch };
    if (patch.schedule) {
      tasks[index].nextRun = this.calculateNextRun(patch.schedule);
    }
    await chrome.storage.local.set({ [this.storageKey]: tasks });

    if (tasks[index].enabled) {
      await this.registerAlarm(tasks[index]);
    } else {
      chrome.alarms.clear('scheduled_' + taskId);
    }
    return tasks[index];
  },

  async deleteTask(taskId) {
    const tasks = await this.listTasks();
    const filtered = tasks.filter(task => task.id !== taskId);
    await chrome.storage.local.set({ [this.storageKey]: filtered });
    chrome.alarms.clear('scheduled_' + taskId);
  },

  async registerAlarm(task) {
    if (!task.enabled) return;
    const periodInMinutes = this.getPeriodMinutes(task.schedule);
    const alarm = {
      when: task.nextRun
    };
    if (periodInMinutes) {
      alarm.periodInMinutes = periodInMinutes;
    }
    chrome.alarms.create('scheduled_' + task.id, alarm);
  },

  getPeriodMinutes(schedule) {
    const text = String(schedule || '').toLowerCase();
    if (text.startsWith('interval@')) {
      const raw = text.replace('interval@', '').trim();
      if (raw.endsWith('m')) return Number(raw.replace('m', ''));
      if (raw.endsWith('h')) return Number(raw.replace('h', '')) * 60;
      return Number(raw) || null;
    }
    if (text.startsWith('daily@')) return 1440;
    if (text.startsWith('weekly@')) return 10080;
    return null;
  },

  calculateNextRun(schedule) {
    const now = new Date();
    const text = String(schedule || '').toLowerCase().trim();

    if (text.startsWith('interval@')) {
      const raw = text.replace('interval@', '').trim();
      const minutes = raw.endsWith('h')
        ? Number(raw.replace('h', '')) * 60
        : Number(raw.replace('m', ''));
      return Date.now() + (Math.max(minutes || 30, 1) * 60000);
    }

    if (text.startsWith('daily@')) {
      const [hours, minutes] = parseTimeToHourMinute(text.replace('daily@', ''));
      const next = new Date(now);
      next.setHours(hours, minutes, 0, 0);
      if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
      return next.getTime();
    }

    if (text.startsWith('weekly@')) {
      const value = text.replace('weekly@', '').trim();
      const parts = value.split(/\s+/).filter(Boolean);
      const dayToken = parts[0] || 'mon';
      const [hours, minutes] = parseTimeToHourMinute(parts[1] || '9am');
      const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
      const targetDay = dayMap[dayToken.substring(0, 3)] ?? 1;
      const next = new Date(now);
      next.setHours(hours, minutes, 0, 0);
      const delta = (targetDay - next.getDay() + 7) % 7;
      next.setDate(next.getDate() + (delta === 0 && next.getTime() <= Date.now() ? 7 : delta));
      return next.getTime();
    }

    return Date.now() + (30 * 60000);
  },

  async updateLastRun(taskId, result) {
    const tasks = await this.listTasks();
    const index = tasks.findIndex(task => task.id === taskId);
    if (index === -1) return;

    const current = tasks[index];
    const snapshot = {
      ts: Date.now(),
      success: !!result.success,
      summary: result.summary || result.message || 'Completed',
      duration: result.duration || 0
    };
    current.lastRun = snapshot.ts;
    current.runCount = (current.runCount || 0) + 1;
    current.results = [snapshot, ...(current.results || [])].slice(0, 20);
    current.nextRun = this.calculateNextRun(current.schedule);

    tasks[index] = current;
    await chrome.storage.local.set({ [this.storageKey]: tasks });
    await this.registerAlarm(current);
  },

  async runTaskNow(taskId) {
    const task = await this.getTask(taskId);
    if (!task) throw new Error('Task not found.');
    const result = await runAgentWithPlanning(task.goal, { silent: true, trigger: 'schedule' });
    await this.updateLastRun(taskId, result || {});
    return result;
  }
};

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('scheduled_')) return;
  const taskId = alarm.name.replace('scheduled_', '');
  const task = await SchedulerEngine.getTask(taskId);
  if (!task || !task.enabled) return;

  const result = await runAgentWithPlanning(task.goal, { silent: true, trigger: 'schedule' });
  await SchedulerEngine.updateLastRun(taskId, result || {});
  chrome.notifications.create({
    type: 'basic',
    title: 'ZANYSURF — Scheduled Task Complete',
    message: (result && (result.summary || result.message)) || 'Scheduled task completed.',
    iconUrl: 'icons/icon48.png'
  });
});

async function parseScheduleFromGoal(input, settings) {
  const text = String(input || '').trim();
  const lower = text.toLowerCase();

  const intervalMatch = lower.match(/every\s+(\d+)\s*(minute|minutes|hour|hours)/i);
  if (intervalMatch) {
    const amount = Number(intervalMatch[1]);
    const unit = intervalMatch[2].toLowerCase().startsWith('hour') ? 'h' : 'm';
    return {
      hasSchedule: true,
      schedule: unit === 'h' ? ('interval@' + amount + 'h') : ('interval@' + amount + 'm'),
      goal: stripScheduleLanguage(text)
    };
  }

  const dailyMatch = lower.match(/every\s+(morning|afternoon|evening|night)|daily\s+at\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/i);
  if (dailyMatch) {
    const slot = (dailyMatch[1] || '').toLowerCase();
    const time = dailyMatch[2] || (slot === 'morning' ? '9am' : slot === 'afternoon' ? '2pm' : slot === 'evening' ? '7pm' : '9pm');
    return { hasSchedule: true, schedule: 'daily@' + normalizeTimeToken(time), goal: stripScheduleLanguage(text) };
  }

  const weeklyMatch = lower.match(/weekly\s+@?\s*(sun|mon|tue|wed|thu|fri|sat)(?:\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?))?/i);
  if (weeklyMatch) {
    return {
      hasSchedule: true,
      schedule: 'weekly@' + weeklyMatch[1] + ' ' + normalizeTimeToken(weeklyMatch[2] || '9am'),
      goal: stripScheduleLanguage(text)
    };
  }

  if (settings?.provider && /every|daily|weekly|each morning|each evening/i.test(lower)) {
    try {
      const prompt = 'Extract schedule and task from: "' + text + '". Return JSON: {"schedule":"daily@9am|weekly@mon 9am|interval@30m","goal":"task goal","hasSchedule":true|false}';
      const response = await callPlanningLLM(prompt, settings);
      const parsed = parseMaybeJson(response) || extractJSON(response);
      if (parsed && parsed.hasSchedule && parsed.schedule && parsed.goal) {
        return parsed;
      }
    } catch (_) {}
  }

  return { hasSchedule: false, schedule: null, goal: text };
}

function stripScheduleLanguage(text) {
  return text
    .replace(/every\s+(morning|afternoon|evening|night)/ig, '')
    .replace(/every\s+\d+\s*(minute|minutes|hour|hours)/ig, '')
    .replace(/daily\s+at\s+[0-9: ]+(am|pm)?/ig, '')
    .replace(/weekly\s+@?\s*(sun|mon|tue|wed|thu|fri|sat)(?:\s+[0-9: ]+(am|pm)?)?/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTimeToken(value) {
  const text = String(value || '9am').trim().toLowerCase();
  if (/^\d{1,2}(?::\d{2})?(am|pm)$/.test(text)) return text;
  if (/^\d{1,2}$/.test(text)) return text + 'am';
  return text.replace(/\s+/g, '');
}

function parseTimeToHourMinute(token) {
  const value = normalizeTimeToken(token);
  const match = value.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i);
  if (!match) return [9, 0];
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridian = (match[3] || '').toLowerCase();
  if (meridian === 'pm' && hours < 12) hours += 12;
  if (meridian === 'am' && hours === 12) hours = 0;
  return [hours % 24, Math.min(Math.max(minutes, 0), 59)];
}

async function runAgentEntry(prompt, options = {}) {
  const safePrompt = String(prompt || '').trim();
  if (!safePrompt) {
    broadcast({ action: 'AGENT_ERROR', error: 'Please provide a goal.' });
    return;
  }

  currentAgentRunId = crypto.randomUUID();
  const runToken = Number(options.runToken || activeRunToken);
  if (!isRunTokenCurrent(runToken)) return;
  currentAgentTree = [];
  const resumed = await detectGoalContinuation(safePrompt);
  if (!isRunTokenCurrent(runToken) || agentAbort) return;
  if (resumed?.isContinuation) {
    broadcast({
      action: 'AGENT_STATUS',
      status: 'running',
      message: 'Resume mode: continuing prior context from ' + (resumed.lastUrl || 'previous session')
    });
  }

  try {
    await saveQuickRunGoal(safePrompt);
    let result;
    const shouldUseOrchestrator = !!options.multiAgent || /research|compare|analyze|summary|report|draft|write/i.test(safePrompt);
    if (shouldUseOrchestrator) {
      result = await OrchestratorAgent.run(safePrompt, { ...options, runId: currentAgentRunId, runToken });
    } else {
      result = await runAgentWithPlanning(safePrompt, { ...options, runToken });
    }
    if (!isRunTokenCurrent(runToken) || agentAbort) return;
    await persistSessionState({ prompt: safePrompt, result, completed: true });
  } catch (error) {
    if (!isRunTokenCurrent(runToken)) return;
    const classified = classifyAgentError(error);
    broadcast({ action: 'AGENT_ERROR', error: classified.message });
    await persistSessionState({ prompt: safePrompt, completed: false, error: classified.type });
  }
}

const AgentBus = (() => {
  const TYPES = new Set(['RESULT', 'ERROR', 'PROGRESS']);

  function normalizeEnvelope(envelope = {}) {
    return {
      from: String(envelope.from || 'UnknownAgent'),
      to: String(envelope.to || 'OrchestratorAgent'),
      type: TYPES.has(String(envelope.type || 'PROGRESS')) ? String(envelope.type) : 'PROGRESS',
      taskId: String(envelope.taskId || 'global'),
      payload: envelope.payload ?? null
    };
  }

  function publish(envelope = {}) {
    const env = normalizeEnvelope(envelope);
    const ts = Date.now();
    broadcast({
      action: 'AGENT_BUS_EVENT',
      runId: currentAgentRunId,
      ts,
      envelope: env,
      from: env.from,
      to: env.to,
      type: env.type,
      taskId: env.taskId,
      payload: env.payload
    });
    appendAuditLog({ kind: 'agent_bus', envelope: env, ts }).catch(() => {});
    return env;
  }

  function progress(from, to, taskId, payload) {
    return publish({ from, to, type: 'PROGRESS', taskId, payload });
  }

  function result(from, to, taskId, payload) {
    return publish({ from, to, type: 'RESULT', taskId, payload });
  }

  function error(from, to, taskId, payload) {
    return publish({ from, to, type: 'ERROR', taskId, payload });
  }

  return { publish, progress, result, error };
})();

const InterAgentBus = {
  send(envelope = {}) {
    return AgentBus.publish(envelope);
  }
};

async function triggerLazyLoadScroll(tabId) {
  if (!tabId) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch(() => {});
    await chrome.tabs.sendMessage(tabId, { action: 'GET_DOM', options: { lazyLoad: true } }).catch(() => {});
    return true;
  } catch (_) {
    return false;
  }
}

const ActionAgent = {
  async run(subtask, context = {}) {
    const goal = typeof subtask === 'string' ? subtask : (subtask.task || subtask.goal || 'Execute browser task');
    const result = await runAgentLoop(goal + (context.parentGoal ? ('\nParent goal: ' + context.parentGoal) : ''), {
      silentSubtask: true,
      maxSteps: Math.min(context.maxSteps || 10, 20),
      subtask,
      parentGoal: context.parentGoal || goal,
      runToken: context.runToken
    });
    const sitesVisited = [...new Set((actionHistory || []).map(item => trimHost(item.url || '')).filter(Boolean))];
    return {
      success: !!result.success,
      result: result.message || result.summary || '',
      stepsUsed: result.steps || 0,
      siteVisited: sitesVisited
    };
  }
};

const ResearchAgent = {
  async run(task, context = {}) {
    const goal = task.task || task.goal || '';
    const seeds = extractResearchUrls(goal);
    const tabs = await Promise.all(seeds.map(async (url) => {
      try {
        const tab = await chrome.tabs.create({ url, active: false });
        await waitForTabReady(tab.id);
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
        const page = await chrome.tabs.sendMessage(tab.id, { action: 'READ_PAGE' }).catch(() => ({ text: '', title: '', url }));
        const extract = await chrome.tabs.sendMessage(tab.id, { action: 'EXECUTE', command: { action: 'extract_data', value: 'research' } }).catch(() => null);
        return {
          tabId: tab.id,
          url,
          title: page?.title || '',
          text: (page?.text || '').substring(0, 2000),
          extract: parseMaybeJson(extract?.result || ''),
          credibility: scoreDomainCredibility(url)
        };
      } catch (_) {
        return { tabId: null, url, title: '', text: '', extract: null, credibility: scoreDomainCredibility(url) * 0.5 };
      }
    }));

    const dedupedFacts = dedupeFacts(
      tabs.flatMap(item => collectFactsFromResearchItem(item))
    );
    const avgCred = tabs.length ? tabs.reduce((sum, item) => sum + (item.credibility || 0), 0) / tabs.length : 0;

    AgentBus.result('ResearchAgent', 'OrchestratorAgent', task.id || 'research', {
      sources: tabs.length,
      facts: dedupedFacts.length
    });
    return {
      facts: dedupedFacts,
      sources: tabs.map(item => ({ url: item.url, title: item.title, credibility: item.credibility })),
      confidence: Number(Math.max(0.2, Math.min(0.95, avgCred)).toFixed(2))
    };
  }
};

const AnalysisAgent = {
  async run(task, context = {}) {
    const settings = await getSettings();
    const payload = context.research || task.input || {};
    const claims = (payload.facts || []).slice(0, 20);
    const prompt = [
      'You are AnalysisAgent. Synthesize claims and detect contradictions.',
      'Return JSON only: {"summary":"...","claims":[{"text":"...","confidence":0-1,"sourceCount":number}],"contradictions":[{"a":"...","b":"...","reason":"..."}]}',
      JSON.stringify({ claims, sources: payload.sources || [] }, null, 2)
    ].join('\n\n');

    let parsed = { summary: '', claims: [], contradictions: [] };
    try {
      const raw = await LLMGateway.callText(prompt, settings.provider, settings.model, settings, { mode: 'summary' });
      parsed = parseMaybeJson(raw) || parsed;
    } catch (_) {}

    const fallbackClaims = claims.slice(0, 8).map(text => ({ text, confidence: 0.62, sourceCount: 1 }));
    const contradictions = detectContradictionsFromClaims(claims);
    const report = {
      summary: parsed.summary || ('Analyzed ' + claims.length + ' claims across ' + ((payload.sources || []).length) + ' sources.'),
      claims: (parsed.claims && parsed.claims.length ? parsed.claims : fallbackClaims).map(item => ({
        text: item.text,
        confidence: Number(Math.max(0, Math.min(1, Number(item.confidence || 0.6))).toFixed(2)),
        sourceCount: Number(item.sourceCount || 1)
      })),
      contradictions: (parsed.contradictions && parsed.contradictions.length) ? parsed.contradictions : contradictions
    };
    AgentBus.result('AnalysisAgent', 'OrchestratorAgent', task.id || 'analysis', {
      claims: report.claims.length,
      contradictions: report.contradictions.length
    });
    return report;
  }
};

const WriterAgent = {
  async run(task, context = {}) {
    const destination = inferWriterDestination(task.task || task.goal || '');
    const content = buildStructuredWriteContent(context.analysis || {}, context.research || {});
    const tab = await chrome.tabs.create({ url: destination, active: true });
    await waitForTabReady(tab.id);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
    await sleep(450);

    const sections = splitMarkdownSections(content);
    let written = 0;
    for (const section of sections) {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'EXECUTE',
        command: {
          action: 'fill_form',
          value: JSON.stringify({
            body: section.plain,
            content: section.plain,
            title: (context.analysis?.summary || task.task || '').substring(0, 80)
          })
        }
      }).catch(() => {});
      written++;
      AgentBus.progress('WriterAgent', 'OrchestratorAgent', task.id || 'writer', {
        written,
        total: sections.length
      });
      await sleep(180);
    }

    return { success: true, destination, sectionsWritten: written, contentLength: content.length };
  }
};

const OrchestratorAgent = {
  async run(goal, options = {}) {
    const runToken = Number(options.runToken || activeRunToken);
    if (!isRunTokenCurrent(runToken) || agentAbort) {
      return { success: false, summary: 'Run cancelled.', outputs: {} };
    }

    const plan = await this.decomposeGoal(goal);
    currentAgentTree = plan.steps.map(step => ({
      id: step.id,
      task: step.task,
      type: step.agent,
      status: 'pending',
      dependsOn: step.dependsOn || []
    }));
    broadcast({ action: 'AGENT_TREE', runId: options.runId || currentAgentRunId, tree: currentAgentTree });

    const outputs = {};
    const completed = new Set();
    let guard = 0;

    while (completed.size < plan.steps.length && guard < 12 && isRunTokenCurrent(runToken) && !agentAbort) {
      guard++;
      const ready = plan.steps.filter(step => !completed.has(step.id) && (step.dependsOn || []).every(dep => completed.has(dep)));
      if (!ready.length) break;

      const independent = ready.filter(step => !(step.dependsOn || []).length);
      const dependent = ready.filter(step => (step.dependsOn || []).length);

      if (independent.length) {
        await Promise.all(independent.map(async (step) => {
          if (!isRunTokenCurrent(runToken) || agentAbort) return;
          const output = await this.runStep(step, goal, outputs, runToken);
          outputs[step.id] = output;
          completed.add(step.id);
        }));
      }

      for (const step of dependent) {
        if (!isRunTokenCurrent(runToken) || agentAbort) break;
        const output = await this.runStep(step, goal, outputs, runToken);
        outputs[step.id] = output;
        completed.add(step.id);
      }
    }

    if (!isRunTokenCurrent(runToken) || agentAbort) {
      return { success: false, summary: 'Run cancelled.', outputs };
    }

    const finalSummary = await synthesizePlanResults(goal, Object.values(outputs), await getSettings());
    broadcast({ action: 'AGENT_COMPLETE', result: finalSummary, steps: actionHistory.length });
    return { success: true, summary: finalSummary, outputs };
  },

  async decomposeGoal(goal) {
    const researchHeavy = /research|compare|sources|claims|report|brief/i.test(goal);
    if (researchHeavy) {
      return {
        steps: [
          { id: 'a1', agent: 'research', task: 'Research across multiple sources for: ' + goal, dependsOn: [] },
          { id: 'a2', agent: 'analysis', task: 'Analyze and detect contradictions', dependsOn: ['a1'] },
          { id: 'a3', agent: 'writer', task: 'Draft structured output document', dependsOn: ['a2'] }
        ]
      };
    }
    return {
      steps: [
        { id: 'a1', agent: 'action', task: goal, dependsOn: [] }
      ]
    };
  },

  async runStep(step, goal, outputs, runToken) {
    if (!isRunTokenCurrent(runToken) || agentAbort) {
      return { success: false, message: 'Run cancelled.', result: null, steps: 0 };
    }
    updateAgentTreeNode(step.id, { status: 'running' });
    AgentBus.progress('OrchestratorAgent', step.agent + 'Agent', step.id, {
      phase: 'start',
      task: step.task,
      agent: step.agent
    });
    try {
      let output;
      if (step.agent === 'research') output = await ResearchAgent.run(step, { goal });
      else if (step.agent === 'analysis') output = await AnalysisAgent.run(step, { goal, research: outputs.a1 || outputs[(step.dependsOn || [])[0]] });
      else if (step.agent === 'writer') output = await WriterAgent.run(step, { goal, analysis: outputs.a2 || outputs[(step.dependsOn || [])[0]], research: outputs.a1 });
      else output = await ActionAgent.run(step, { parentGoal: goal, maxSteps: 16, runToken });

      if (!isRunTokenCurrent(runToken) || agentAbort) {
        return { success: false, message: 'Run cancelled.', result: null, steps: 0 };
      }

      updateAgentTreeNode(step.id, { status: 'completed', outputPreview: JSON.stringify(output).substring(0, 240) });
      AgentBus.result(step.agent + 'Agent', 'OrchestratorAgent', step.id, { success: true });
      return { success: true, message: step.task, result: output, steps: output?.stepsUsed || 0 };
    } catch (error) {
      updateAgentTreeNode(step.id, { status: 'failed', error: error.message });
      AgentBus.error(step.agent + 'Agent', 'OrchestratorAgent', step.id, {
        success: false,
        error: error.message
      });
      return { success: false, message: error.message, result: null, steps: 0 };
    }
  }
};

function updateAgentTreeNode(stepId, patch) {
  currentAgentTree = currentAgentTree.map(node => node.id === stepId ? { ...node, ...patch } : node);
  broadcast({ action: 'AGENT_TREE', runId: currentAgentRunId, tree: currentAgentTree });
}

// =============================================================================
// PLANNING LAYER (PLAN-AND-EXECUTE)
// =============================================================================
async function runAgentWithPlanning(goal, options = {}) {
  const startedAt = Date.now();
  const runToken = Number(options.runToken || activeRunToken);
  if (!isRunTokenCurrent(runToken) || agentAbort) {
    return { success: false, summary: 'Run cancelled.', message: 'Run cancelled.', duration: 0, steps: 0, results: [] };
  }

  activeRunContext = { silent: !!options.silent, trigger: options.trigger || 'manual' };
  const settings = await getSettings();
  if (!isRunTokenCurrent(runToken) || agentAbort) {
    return { success: false, summary: 'Run cancelled.', message: 'Run cancelled.', duration: Date.now() - startedAt, steps: 0, results: [] };
  }
  const scheduleIntent = await parseScheduleFromGoal(goal, settings);
  if (scheduleIntent.hasSchedule && !options.ignoreScheduleIntent) {
    const task = await SchedulerEngine.createTask({ goal: scheduleIntent.goal || goal, schedule: scheduleIntent.schedule });
    broadcast({ action: 'AGENT_SCHEDULED', task });
    return {
      success: true,
      summary: 'Scheduled task created: ' + task.schedule,
      message: 'Scheduled task created.',
      duration: Date.now() - startedAt
    };
  }

  const plan = await generatePlan(goal, settings);
  if (!options.silent) {
    broadcast({ action: 'AGENT_PLAN', goal, plan });
  }

  const results = [];
  let currentSteps = [...(plan.steps || [])];

  for (let index = 0; index < currentSteps.length; index++) {
    if (agentAbort || !isRunTokenCurrent(runToken)) break;

    const step = currentSteps[index];
    if (!options.silent) {
      broadcast({ action: 'AGENT_PLAN_PROGRESS', status: 'running', stepId: step.id, task: step.task, index: index + 1, total: currentSteps.length });
    }

    const subtaskGoal = 'Subtask ' + (index + 1) + '/' + currentSteps.length + ': ' + step.task + '\nParent goal: ' + goal;
    const result = await runAgentLoop(subtaskGoal, {
      silentSubtask: true,
      maxSteps: 10,
      subtask: step,
      parentGoal: goal,
      runToken
    });
    results.push({ ...result, subtask: step });

    if (agentAbort || !isRunTokenCurrent(runToken)) break;

    if (!options.silent) {
      broadcast({
        action: 'AGENT_PLAN_PROGRESS',
        status: result.success ? 'completed' : 'failed',
        stepId: step.id,
        task: step.task,
        detail: result.message,
        index: index + 1,
        total: currentSteps.length
      });
    }

    if (!result.success && !agentAbort) {
      const replanned = await replan(goal, { steps: currentSteps }, results, settings);
      if (replanned && replanned.steps && replanned.steps.length) {
        const completedPrefix = currentSteps.slice(0, index + 1);
        currentSteps = [...completedPrefix, ...replanned.steps.filter(item => !completedPrefix.some(done => done.id === item.id))];
        if (!options.silent) {
          broadcast({ action: 'AGENT_PLAN', goal, plan: { steps: currentSteps }, replanned: true });
        }
      }
    }
  }

  const wasCancelled = agentAbort || !isRunTokenCurrent(runToken);
  const summary = wasCancelled ? 'Run cancelled by user.' : await synthesizePlanResults(goal, results, settings);
  const totalSteps = results.reduce((sum, item) => sum + (item.steps || 0), 0);
  const duration = Date.now() - startedAt;
  const success = !wasCancelled && results.every(item => item.success);

  await saveWorkflow(goal, actionHistory, { success, duration, summary });
  await PersonalizationEngine.observe(goal, actionHistory, { success, duration, summary });

  if (!options.silent) {
    broadcast({ action: 'AGENT_COMPLETE', result: summary, steps: totalSteps });
  }

  return {
    success,
    summary,
    message: summary,
    duration,
    steps: totalSteps,
    results
  };
}

async function generatePlan(goal, settings) {
  const memory = await retrieveMemoryContext(goal);
  // v2: also inject semantic memory context
  const memV2 = memorySystem.buildContextString(goal);
  const combinedMemory = [memory, memV2].filter(Boolean).join('\n');
  const prompt = [
    'Goal: ' + goal,
    combinedMemory ? ('Memory:\n' + combinedMemory) : 'Memory: (none)',
    '',
    'Break this into 3-7 sequential subtasks.',
    'Each subtask should be completable in under 10 browser actions.',
    'Return JSON only in this shape:',
    '{"steps":[{"id":"s1","task":"...","dependsOn":[],"expectedOutcome":"..."}]}'
  ].join('\n');

  try {
    const raw = await callPlanningLLM(prompt, settings);
    const parsed = parsePlanResponse(raw);
    if (parsed.steps && parsed.steps.length) return parsed;
  } catch (_) {}

  return {
    steps: [{ id: 's1', task: goal, dependsOn: [], expectedOutcome: 'Goal completed' }]
  };
}

async function replan(goal, originalPlan, results, settings) {
  const prompt = [
    'Original goal: ' + goal,
    'Original plan JSON: ' + JSON.stringify(originalPlan),
    'Executed results JSON: ' + JSON.stringify(results.map(item => ({
      subtask: item.subtask?.task,
      success: item.success,
      message: item.message
    }))),
    '',
    'Generate a revised remaining plan only.',
    'Return JSON: {"steps":[{"id","task","dependsOn","expectedOutcome"}]}'
  ].join('\n');

  try {
    const raw = await callPlanningLLM(prompt, settings);
    const parsed = parsePlanResponse(raw);
    return parsed;
  } catch (_) {
    return { steps: [] };
  }
}

async function callPlanningLLM(prompt, settings) {
  return LLMGateway.callText(prompt, settings.provider, settings.model, settings, { mode: 'planning' });
}

function parsePlanResponse(raw) {
  const parsed = extractJSON(raw);
  if (!parsed || !Array.isArray(parsed.steps)) return { steps: [] };
  const normalized = parsed.steps
    .map((step, index) => ({
      id: step.id || ('s' + (index + 1)),
      task: String(step.task || '').trim(),
      dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
      expectedOutcome: String(step.expectedOutcome || '').trim() || 'Subtask completed'
    }))
    .filter(step => step.task);
  return { steps: normalized.slice(0, 10) };
}

async function synthesizePlanResults(goal, results, settings) {
  const failed = results.filter(item => !item.success);
  if (!results.length) return 'No subtasks were executed.';
  if (!failed.length) {
    return 'Completed planned workflow for: ' + goal;
  }

  const prompt = [
    'Goal: ' + goal,
    'Summarize these subtask outcomes in 4-6 concise lines:',
    JSON.stringify(results.map(item => ({ task: item.subtask?.task, success: item.success, message: item.message })))
  ].join('\n');

  try {
    const summary = await callPlanningLLM(prompt, settings);
    const parsed = parseMaybeJson(summary);
    if (typeof parsed === 'string') return parsed;
  } catch (_) {}

  return 'Completed with ' + failed.length + ' failed subtask(s).';
}

// =============================================================================
// MAIN AGENT LOOP
// =============================================================================
async function runAgentLoop(userGoal, options = {}) {
  const isSubtaskRun = !!options.silentSubtask;
  const runToken = Number(options.runToken || activeRunToken);
  if (!isRunTokenCurrent(runToken) || agentAbort) {
    return { success: false, steps: 0, message: 'Run cancelled.', finalUrl: '' };
  }

  const safeMode = await getSafeMode().catch(() => false);
  let safeWindowId = null;
  if (safeMode && !isSubtaskRun) {
    try {
      const safeWindow = await chrome.windows.create({
        url: extractTargetUrl(userGoal) || 'https://www.google.com',
        focused: true,
        type: 'normal'
      });
      safeWindowId = safeWindow?.id || null;
      broadcast({ action: 'AGENT_STATUS', status: 'running', message: 'Safe mode enabled: running in isolated window.' });
    } catch (_) {}
  }
  agentActive   = true;
  agentAbort    = false;
  actionHistory = [];
  if (!isSubtaskRun) {
    sessionMemory = [];
    tabOrchestrationState = { nodes: {}, dependencies: {}, extracted: {}, lastSynthesis: '' };
  }
  sessionGoal   = userGoal;
  let steps       = 0;
  let stuckCount  = 0;       // consecutive identical action fingerprints
  let lastFingerprint = ''; // action+value+element_id hash for loop detection
  const MAX_STEPS = options.maxSteps || 30;
  let finalResult = { success: false, steps: 0, message: '', finalUrl: '' };

  try {
    const allTabs = await chrome.tabs.query({});
    let memoryStr = '--- LONG CONTEXT MEMORY: OPEN TABS ---\n';
    for (const t of allTabs) {
      if (t.url && !t.url.startsWith('chrome')) {
        memoryStr += `[@${t.id}] Title: ${t.title || 'Untitled'} | URL: ${t.url}\n`;
      }
    }
    const memoryContext = await retrieveMemoryContext(userGoal);
    if (memoryContext) {
      memoryStr += '\n--- VECTOR MEMORY RECALL ---\n' + memoryContext;
    }
    globalMemoryContext = memoryStr;
  } catch(e) {}

  broadcast({
    action: 'AGENT_STATUS',
    status: 'running',
    message: isSubtaskRun
      ? ('Working subtask: ' + (options.subtask?.task || userGoal).substring(0, 90))
      : 'Agent starting…'
  });

  while (agentActive && !agentAbort && steps < MAX_STEPS && isRunTokenCurrent(runToken)) {
    steps++;

    try {
      // 1. Get active tab
      const tabs = safeWindowId
        ? await chrome.tabs.query({ active: true, windowId: safeWindowId })
        : await chrome.tabs.query({ active: true, currentWindow: true });
      const tab  = tabs[0];
      if (!tab) { broadcast({ action: 'AGENT_ERROR', error: 'No active tab found.' }); break; }

      // 2. Wait for full load
      await waitForTabReady(tab.id);
      await sleep(300);
      await chrome.tabs.sendMessage(tab.id, { action: 'INSTALL_NETWORK_MONITOR' }).catch(() => {});

      const currentUrl   = tab.url   || '';
      const currentTitle = tab.title || '';
      const isSystemPage = isChromePage(currentUrl);
      observeTabVisit(currentUrl, currentTitle);

      // Early completion check: if current page already satisfies the goal, stop immediately.
      if (steps >= 2 && checkGoalSatisfied(userGoal, currentUrl, currentTitle, actionHistory, steps)) {
        const completionMsg = 'Goal accomplished. Reached ' + currentUrl + ' as required.';
        finalResult = { success: true, steps: steps - 1, message: completionMsg, finalUrl: currentUrl };
        if (!isSubtaskRun) {
          broadcast({ action: 'AGENT_COMPLETE', result: completionMsg, steps: steps - 1 });
        }
        await saveTaskHistory(userGoal, steps - 1, true);
        agentActive = false;
        break;
      }

      broadcast({ action: 'AGENT_PAGE_INFO', url: currentUrl, title: currentTitle, step: steps });

      // 3. Build context (DOM first, Vision fallback when sparse)
      const pageContext = await getPageContext(tab.id, isSystemPage);
      const domMap = pageContext.mode === 'dom'
        ? pageContext.domMap
        : (pageContext.mode === 'vision' ? 'VISION_MODE' : 'UNMAPPABLE');
      if (pageContext.mode === 'vision') {
        broadcast({ action: 'AGENT_STATUS', status: 'running', message: 'Vision mode active (DOM sparse).' });
      }

      // 4. Load settings
      const settings = await chrome.storage.local.get([
        'provider', 'apiKey', 'ollamaUrl', 'ollamaModel'
      ]);

      let decision;

      // 5. Fast path: direct navigation goals should act instantly
      decision = await getBookmarkFastPathDecision(userGoal, currentUrl, steps, actionHistory);
      if (!decision) {
        decision = getFastPathDecision(userGoal, currentUrl, steps, actionHistory);
      }

      // 6. Ask LLM for next action when fast path does not apply
      if (!decision) {
        broadcast({ action: 'AGENT_THINKING', step: steps });
        globalMemoryContext = await buildRuntimeMemoryContext(userGoal, currentUrl);
        try {
          decision = await getNextAction(
            userGoal, domMap, actionHistory, settings,
            currentUrl, currentTitle, steps, pageContext
          );
        } catch (e) {
          broadcast({ action: 'AGENT_STATUS', status: 'running', message: 'LLM error, retrying�' });
          await sleep(2000);
          try {
            decision = await getNextAction(
              userGoal, domMap, actionHistory, settings,
              currentUrl, currentTitle, steps, pageContext
            );
          } catch (e2) {
            broadcast({ action: 'AGENT_ERROR', error: 'LLM failed: ' + e2.message });
            break;
          }
        }
      }

      // 7. Safety guards
      decision = applyGuards(decision, userGoal, currentUrl, currentTitle, steps, actionHistory, domMap);

      if (!isRunTokenCurrent(runToken) || agentAbort) {
        finalResult = { success: false, steps: steps - 1, message: 'Run cancelled.', finalUrl: currentUrl };
        agentActive = false;
        break;
      }

      // 8. Broadcast thought
      broadcast({
        action:     'AGENT_LOG',
        step:       steps,
        thought:    decision.thought,
        nextAction: decision.action,
        value:      decision.value      || '',
        element_id: decision.element_id ?? null,
        url:        currentUrl,
        title:      currentTitle,
        dom_count:  countDomElements(domMap)
      });

      // 9. Execute action
      let execResult = { success: true, detail: '' };

      const approvalGate = await executeWithRiskCheck(decision, {
        url: currentUrl,
        title: currentTitle,
        tabId: tab.id,
        step: steps
      });
      if (!isRunTokenCurrent(runToken) || agentAbort) {
        finalResult = { success: false, steps: steps - 1, message: 'Run cancelled.', finalUrl: currentUrl };
        agentActive = false;
        break;
      }
      if (!approvalGate.allowed) {
        execResult = {
          success: false,
          detail: approvalGate.reason || 'Blocked by safety policy.'
        };
      } else {

      switch (decision.action) {

        case 'navigate': {
          let url = (decision.value || '').trim();
          if (!url) { execResult = { success: false, detail: 'No URL provided' }; break; }
          if (!url.startsWith('http')) url = 'https://' + url;
          try {
            await chrome.tabs.update(tab.id, { url });
            broadcast({ action: 'AGENT_STATUS', status: 'running', message: 'Navigating to ' + url + '�' });
            await sleep(800);
            await waitForTabReady(tab.id);
            await sleep(700);
            execResult.detail = 'Navigated to ' + url;
            // Capture screenshot after navigation
            captureAndBroadcast(tab.id, steps);
          } catch (e) { execResult = { success: false, detail: e.message }; }
          break;
        }

        case 'new_tab': {
          let url = (decision.value || 'about:blank').trim();
          if (!url.startsWith('http') && url !== 'about:blank') url = 'https://' + url;
          try {
            const newTab = await chrome.tabs.create({ url, active: true });
            tabOrchestrationState.nodes[newTab.id] = {
              status: 'opened',
              url,
              title: '',
              updatedAt: Date.now()
            };
            await sleep(800);
            await waitForTabReady(newTab.id);
            execResult.detail = 'Opened new tab: ' + url;
          } catch (e) { execResult = { success: false, detail: e.message }; }
          break;
        }

        case 'open_tabs': {
          try {
            const urls = parseMultiUrls(decision.value);
            if (!urls.length) throw new Error('No URLs provided for open_tabs');
            const openedIds = [];
            for (const url of urls.slice(0, 8)) {
              const created = await chrome.tabs.create({ url, active: false });
              openedIds.push(created.id);
              tabOrchestrationState.nodes[created.id] = {
                status: 'opened',
                url,
                title: '',
                updatedAt: Date.now()
              };
            }
            registerDependencies(openedIds, decision.depends_on);
            execResult.detail = 'Opened ' + openedIds.length + ' tabs: ' + openedIds.join(', ');
          } catch (e) {
            execResult = { success: false, detail: e.message };
          }
          break;
        }

        case 'activate_tab': {
          try {
            const targetTabId = resolveTargetTabId(decision.value);
            if (!targetTabId) throw new Error('Unable to resolve target tab id for activate_tab');
            if (!dependenciesMet(targetTabId)) {
              throw new Error('Dependencies not met for tab ' + targetTabId + '. Required: ' + (tabOrchestrationState.dependencies[targetTabId] || []).join(', '));
            }
            await chrome.tabs.update(targetTabId, { active: true });
            tabOrchestrationState.nodes[targetTabId] = {
              ...(tabOrchestrationState.nodes[targetTabId] || {}),
              status: 'active',
              updatedAt: Date.now()
            };
            execResult.detail = 'Activated tab ' + targetTabId;
          } catch (e) {
            execResult = { success: false, detail: e.message };
          }
          break;
        }

        case 'wait_tab': {
          try {
            const targetTabId = resolveTargetTabId(decision.value);
            if (!targetTabId) throw new Error('No tab provided for wait_tab');
            await waitForTabReady(targetTabId);
            tabOrchestrationState.nodes[targetTabId] = {
              ...(tabOrchestrationState.nodes[targetTabId] || {}),
              status: 'ready',
              updatedAt: Date.now()
            };
            execResult.detail = 'Tab ' + targetTabId + ' is ready';
          } catch (e) {
            execResult = { success: false, detail: e.message };
          }
          break;
        }

        case 'open_gmail_compose': {
          try {
            const gmailUrl = buildGmailComposeUrl(decision.value);
            await chrome.tabs.update(tab.id, { url: gmailUrl });
            await sleep(700);
            await waitForTabReady(tab.id);
            execResult.detail = 'Opened Gmail compose window';
            captureAndBroadcast(tab.id, steps);
          } catch (e) {
            execResult = { success: false, detail: e.message };
          }
          break;
        }

        case 'schedule_calendar': {
          try {
            const calendarUrl = buildCalendarCreateUrl(decision.value);
            await chrome.tabs.update(tab.id, { url: calendarUrl });
            await sleep(700);
            await waitForTabReady(tab.id);
            execResult.detail = 'Opened Google Calendar event editor';
            captureAndBroadcast(tab.id, steps);
          } catch (e) {
            execResult = { success: false, detail: e.message };
          }
          break;
        }

        case 'click':
        case 'click_coords':
        case 'type':
        case 'key':
        case 'hover':
        case 'select':
        case 'drag_drop':
        case 'upload_file':
        case 'enter_iframe':
        case 'exit_iframe':
        case 'context_click':
        case 'shortcut':
        case 'execute_js':
        case 'compose_email':
        case 'book_slot':
        case 'fill_form':
        case 'inspect_form':
        case 'extract_text':
        case 'extract_data': {
          try {
            const r = await chrome.tabs.sendMessage(tab.id, { action: 'EXECUTE', command: decision });
            execResult = { success: !!(r && r.success), detail: r?.result || r?.error || '' };
            if (execResult.success && (decision.action === 'extract_data' || decision.action === 'extract_text')) {
              const extracted = parseMaybeJson(execResult.detail);
              if (extracted) {
                await upsertKnowledgeGraph(extracted).catch(() => {});
                if (decision.action === 'extract_text') {
                  await chrome.storage.local.set({ zanysurf_last_text_extract: extracted }).catch(() => {});
                }
                tabOrchestrationState.extracted[tab.id] = {
                  tabId: tab.id,
                  url: currentUrl,
                  title: currentTitle,
                  extractedAt: Date.now(),
                  data: extracted
                };
                tabOrchestrationState.nodes[tab.id] = {
                  ...(tabOrchestrationState.nodes[tab.id] || {}),
                  status: 'extracted',
                  url: currentUrl,
                  title: currentTitle,
                  updatedAt: Date.now()
                };
              }
            }
          } catch (e) { execResult = { success: false, detail: e.message }; }
          // Screenshot after key/click so the LLM sees results (e.g. search loaded after Enter)
          if (execResult.success && (decision.action === 'key' || decision.action === 'click' || decision.action === 'type')) {
            await sleep(900);
            captureAndBroadcast(tab.id, steps);
          }
          break;
        }

        case 'bridge_extension': {
          try {
            const payload = parseMaybeJson(decision.value) || {};
            const bridgeName = payload.name || payload.bridge || '1Password';
            const result = await bridgeMessage(bridgeName, payload.message || { action: 'ping' });
            execResult = { success: !!result.success, detail: result.success ? ('Bridge response from ' + bridgeName) : (result.message || 'Bridge failed') };
          } catch (e) {
            execResult = { success: false, detail: e.message };
          }
          break;
        }

        case 'login_saved': {
          try {
            const payload = parseMaybeJson(decision.value) || {};
            const result = await loginWithSavedCredential({
              tabId: tab.id,
              credentialId: payload.credentialId || payload.id,
              site: payload.site || currentUrl,
              passphrase: payload.passphrase || null
            });
            execResult = { success: !!result.success, detail: result.message || 'Filled login form from secure vault.' };
          } catch (e) {
            execResult = { success: false, detail: e.message };
          }
          break;
        }

        case 'synthesize': {
          try {
            const synthesis = await synthesizeExtractedData(userGoal, tabOrchestrationState.extracted, settings);
            tabOrchestrationState.lastSynthesis = synthesis;
            broadcast({ action: 'AGENT_SYNTHESIS', step: steps, synthesis });
            execResult.detail = 'Synthesis complete across ' + Object.keys(tabOrchestrationState.extracted).length + ' tab(s)';
          } catch (e) {
            execResult = { success: false, detail: e.message };
          }
          break;
        }

        case 'export_csv': {
          try {
            const csv = buildCsvFromExtraction(tabOrchestrationState.extracted);
            if (!csv) throw new Error('No extracted data available to export');
            await chrome.storage.local.set({ zanysurf_last_export_csv: csv });
            try {
              await chrome.downloads.download({
                url: 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv),
                filename: 'zanysurf-export-' + Date.now() + '.csv',
                saveAs: false
              });
              execResult.detail = 'CSV exported to Downloads';
            } catch (_) {
              execResult.detail = 'CSV prepared and saved in memory key zanysurf_last_export_csv';
            }
          } catch (e) {
            execResult = { success: false, detail: e.message };
          }
          break;
        }

        case 'copy_clipboard': {
          try {
            const csv = buildCsvFromExtraction(tabOrchestrationState.extracted);
            if (!csv) throw new Error('No extracted data available to copy');
            await chrome.storage.local.set({ zanysurf_last_export_csv: csv });
            const copied = await attemptClipboardWrite(tab.id, csv);
            execResult.detail = copied
              ? 'Copied extracted CSV to clipboard'
              : 'Clipboard write blocked. CSV saved in memory key zanysurf_last_export_csv';
          } catch (e) {
            execResult = { success: false, detail: e.message };
          }
          break;
        }

        case 'scroll': {
          try {
            const r = await chrome.tabs.sendMessage(tab.id, { action: 'EXECUTE', command: decision });
            execResult = { success: !!(r && r.success), detail: r?.result || 'Scrolled' };
          } catch (_) { execResult = { success: true, detail: 'Scrolled' }; }
          break;
        }

        case 'wait': {
          const ms = Math.min(Math.max(parseInt(decision.value) || 1500, 500), 8000);
          await sleep(ms);
          execResult.detail = 'Waited ' + ms + 'ms';
          break;
        }

        case 'done': {
          execResult.detail = 'Goal complete';
          break;
        }

        default: {
          execResult = { success: false, detail: 'Unknown action: ' + decision.action };
        }
      }
      }

      // 9. Broadcast result
      broadcast({
        action:  'AGENT_EXEC_RESULT',
        step:    steps,
        success: execResult.success,
        detail:  execResult.detail
      });

      // 9b. Retry once if element interaction failed
      if (!execResult.success &&
          ['click','type','hover','select','fill_form'].includes(decision.action) &&
          decision.element_id !== null && decision.element_id !== undefined) {
        await sleep(600);
        try {
          const rr = await chrome.tabs.sendMessage(tab.id, { action: 'EXECUTE', command: decision });
          if (rr && rr.success) {
            execResult = { success: true, detail: (rr.result || 'Retried OK') };
            broadcast({ action: 'AGENT_EXEC_RESULT', step: steps, success: true, detail: '? ' + execResult.detail });
          }
        } catch (_) {}
      }

      // 10. Record step
      actionHistory.push({
        step:       steps,
        url:        currentUrl,
        thought:    decision.thought,
        action:     decision.action,
        value:      decision.value      || '',
        element_id: decision.element_id ?? null,
        success:    execResult.success
      });
      await appendAuditLog({
        kind: 'action',
        goal: userGoal.substring(0, 180),
        step: steps,
        tabId: tab.id,
        url: currentUrl,
        action: decision.action,
        value: decision.value || '',
        success: execResult.success,
        result: String(execResult.detail || '').substring(0, 400)
      });
      sessionMemory.push({
        ts: Date.now(),
        step: steps,
        goal: userGoal,
        url: currentUrl,
        action: decision.action,
        value: decision.value || '',
        thought: decision.thought || '',
        success: execResult.success,
        vector: vectorizeText([userGoal, currentTitle, decision.action, decision.value || '', decision.thought || ''].join(' '))
      });

      const net = await chrome.tabs.sendMessage(tab.id, { action: 'READ_NETWORK_CACHE' }).catch(() => null);
      if (net?.success && Array.isArray(net.entries) && net.entries.length) {
        await chrome.storage.local.set({ [STORAGE_KEYS.NETWORK_CACHE]: net.entries.slice(-120) }).catch(() => {});
      }

      // 10b. Stuck / infinite-loop detection
      // If the agent keeps taking the exact same action + value + element_id, it is stuck.
      const fingerprint = decision.action + '|' + (decision.value || '') + '|' + (decision.element_id ?? '');
      if (fingerprint === lastFingerprint) {
        stuckCount++;
      } else {
        stuckCount = 0;
        lastFingerprint = fingerprint;
      }
      if (stuckCount >= 2) {
        // 2 identical steps in a row ? force an escape
        stuckCount = 0;
        lastFingerprint = '';
        const escapeUrl = buildSearchUrl(userGoal);
        const escapeDecision = escapeUrl
          ? { thought: 'I am stuck repeating the same action. Navigating directly to the search results URL to break the loop.', action: 'navigate', value: escapeUrl, element_id: null, is_complete: false }
          : { thought: 'I am stuck. Scrolling down to reveal new content.', action: 'scroll', value: 'down', element_id: null, is_complete: false };
        broadcast({ action: 'AGENT_STATUS', status: 'running', message: '? Loop detected � escaping�' });
        await chrome.tabs.sendMessage(tab.id, { action: 'EXECUTE', command: escapeDecision }).catch(() => {});
        if (escapeDecision.action === 'navigate') {
          await chrome.tabs.update(tab.id, { url: escapeDecision.value });
          await waitForTabReady(tab.id);
        }
        continue;
      }

      // 10c. Auto-complete: re-query tab for real post-redirect URL, then check satisfaction
      if (execResult.success && decision.action === 'navigate' && steps >= 2) {
        const freshTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const realUrl   = freshTabs[0]?.url || decision.value || '';
        if (checkGoalSatisfied(userGoal, realUrl, freshTabs[0]?.title || currentTitle, actionHistory, steps)) {
          const completionMsg = 'Goal accomplished. Reached ' + realUrl + ' as required.';
          finalResult = { success: true, steps, message: completionMsg, finalUrl: realUrl };
          if (!isSubtaskRun) {
            broadcast({ action: 'AGENT_COMPLETE', result: completionMsg, steps });
          }
          await saveTaskHistory(userGoal, steps, true);
          agentActive = false;
          break;
        }
      }

      // 11. Check completion
      if (decision.action === 'done') {
        finalResult = { success: true, steps, message: decision.thought, finalUrl: currentUrl };
        if (!isSubtaskRun) {
          broadcast({ action: 'AGENT_COMPLETE', result: decision.thought, steps });
        }
        await saveTaskHistory(userGoal, steps, true);
        agentActive = false;
        break;
      }

      await sleep(900);

    } catch (err) {
      console.error('[ZANYSURF] Loop error:', err);
      if (!isSubtaskRun) {
        broadcast({ action: 'AGENT_ERROR', error: err.message });
      }
      await saveTaskHistory(userGoal, steps, false);
      finalResult = { success: false, steps, message: err.message, finalUrl: '' };
      break;
    }
  }

  if (steps >= MAX_STEPS && !agentAbort && agentActive) {
    const maxStepError = 'Max steps (' + MAX_STEPS + ') reached without completing goal.';
    if (!isSubtaskRun) {
      broadcast({ action: 'AGENT_ERROR', error: maxStepError });
    }
    await saveTaskHistory(userGoal, steps, false);
    finalResult = { success: false, steps, message: maxStepError, finalUrl: '' };
  }
  agentActive = false;
  if (!finalResult.message) {
    finalResult = {
      success: !agentAbort,
      steps,
      message: agentAbort ? 'Aborted by user.' : 'Run finished.',
      finalUrl: ''
    };
  }
  return finalResult;
}

// =============================================================================
// MULTI-TAB ENGINE ENTRY POINT
// Runs the agent loop on a specific tab (called by AsyncTaskEngine / ZanyTaskRunner).
// Unlike runAgentLoop() this function does NOT touch agentActive / agentAbort globals —
// each tab-bound run is self-contained and communicates progress via onProgress callback.
// =============================================================================
async function runAgentLoopOnTab(tabId, goal, runToken, onProgress) {
  // Bring the tab into a known-good state without stealing focus
  try { await chrome.tabs.update(tabId, { active: false }); } catch (_) {}
  await waitForTabReady(tabId).catch(() => {});

  const MAX_STEPS = 30;
  let steps = 0;
  let agentDone = false;
  const localAbort = () => Number(runToken) !== activeRunToken;

  while (!agentDone && steps < MAX_STEPS && !localAbort()) {
    steps++;
    if (typeof onProgress === 'function') onProgress(steps);

    try {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) break;

      await waitForTabReady(tabId).catch(() => {});
      await sleep(300);

      const currentUrl   = tab.url   || '';
      const currentTitle = tab.title || '';
      if (isChromePage(currentUrl)) break;

      const pageContext = await getPageContext(tabId, false);
      const domMap      = pageContext.mode === 'dom' ? pageContext.domMap : 'VISION_MODE';

      const settings    = await getSettings();
      const memCtx      = memorySystem.buildContextString(goal);
      const historyLines= actionHistory.slice(-6)
        .map(h => `${h.action}(${h.value || ''}) on ${h.url || ''}`)
        .join('\n');

      const extraContext = memCtx
        + '\n[Tab-specific run | tabId=' + tabId + ' | token=' + runToken + ']';

      const prompt   = buildAgentPrompt(
        goal, domMap, currentUrl, currentTitle, historyLines, extraContext
      );
      const raw      = await LLMGateway.callText(
        prompt, settings.provider, settings.model, settings, {}
      );
      const decision = parseAgentDecision(raw);
      if (!decision) continue;

      if (decision.action === 'done') {
        agentDone = true;
        break;
      }

      const execResult = await chrome.tabs.sendMessage(tabId, {
        action: 'EXECUTE_ACTION', ...decision
      }).catch(e => ({ success: false, detail: e.message }));

      actionHistory.push({
        action : decision.action,
        value  : decision.value || '',
        url    : currentUrl,
        ts     : Date.now(),
        success: !!execResult?.success
      });

      if (execResult?.navigated || decision.action === 'navigate') {
        await sleep(1200);
        await waitForTabReady(tabId).catch(() => {});
      }
    } catch (err) {
      if (localAbort()) break;
      if (err.message === 'Cancelled') break;
      // transient errors — continue to next step
    }
  }

  const finalTab = await chrome.tabs.get(tabId).catch(() => null);
  return {
    success  : agentDone,
    steps,
    message  : agentDone
      ? 'Task completed in ' + steps + ' steps'
      : 'Reached step limit or was stopped',
    finalUrl : finalTab?.url || ''
  };
}

// =============================================================================
// DONE ACTION VALIDATOR
// Strictly checks whether a "done" decision is genuinely a completion.
// Returns true only if the thought is a real accomplishment summary and the
// current page / history confirms the task is actually finished.
// =============================================================================
function validateDoneAction(decision, goal, currentUrl, history) {
  const thought = (decision.thought || '').toLowerCase();
  const gl      = goal.toLowerCase();
  const ul      = currentUrl.toLowerCase();

  // 1. Thought must have meaningful content
  if (decision.thought.length < 25) return false;

  // 2. Thought must NOT describe a page element or suggest a next action
  //    These are dead giveaways that the LLM is confused about what "done" means.
  const badPhrases = [
    'could be', 'could be the', 'can be', 'is currently', 'currently visible', 'is visible',
    'next action', 'next single', 'the next action', 'would be the next', 'could be the next',
    'the element', 'button with id', 'element with id', 'element id', 'id \'',
    'might be', 'might be the', 'next step', 'the next step',
    'you could', 'you should', 'consider', 'perhaps', 'suggest',
    'try ', 'would be', 'needs to', 'need to', 'should be',
    'click on', 'type into', 'navigate to', 'you can',
    'to complete', 'to finish', 'to accomplish', 'action to take',
    'action would be', 'further action', 'could also',
    'is the next', 'takes you', 'will take',
    'appears to be', 'seems to be', 'it appears', 'it seems',
  ];
  if (badPhrases.some(p => thought.includes(p))) return false;

  // 3. Thought must NOT be purely forward-looking (future tense about the task)
  //    A completion thought describes what WAS done, not what TO do.
  const futureVerbs = [
    'i will ', 'i need to ', 'i should ', 'i can ', 'i must ',
    'we need to', 'the agent should', 'the next',
  ];
  if (futureVerbs.some(v => thought.startsWith(v) || thought.includes('. ' + v))) return false;

  // 4. For search tasks: current URL must confirm the search was performed
  const isSearchTask = /search|find|look for|query|browse/i.test(gl);
  if (isSearchTask) {
    const searchUrlPatterns = ['search', 'q=', 'query=', 'results', 's?k=', '/search/', 'find='];
    const urlConfirmsSearch = searchUrlPatterns.some(p => ul.includes(p));
    // Also check history � maybe we navigated to a search URL in a prior step
    const historyConfirmsSearch = history.some(h =>
      h.action === 'navigate' && h.value &&
      searchUrlPatterns.some(p => h.value.toLowerCase().includes(p))
    );
    if (!urlConfirmsSearch && !historyConfirmsSearch) return false;

    // Verify we are on the right site
    const siteChecks = [
      ['youtube', 'youtube.com'], ['github', 'github.com'], ['amazon', 'amazon.com'],
      ['google', 'google.com'],   ['reddit', 'reddit.com'], ['stackoverflow', 'stackoverflow.com'],
      ['wikipedia', 'wikipedia.org'], ['npm', 'npmjs.com'], ['twitter', 'twitter.com'],
      ['linkedin', 'linkedin.com'], ['bing', 'bing.com'], ['spotify', 'spotify.com'],
    ];
    for (const [keyword, domain] of siteChecks) {
      if (gl.includes(keyword)) {
        const onSite = ul.includes(domain) ||
          history.some(h => h.action === 'navigate' && h.value && h.value.includes(domain));
        if (!onSite) return false;
      }
    }
  }

  // 5. For navigation goals: must be on the right site
  const navSiteChecks = [
    ['youtube', 'youtube.com'], ['github', 'github.com'], ['amazon', 'amazon.com'],
    ['google', 'google.com'],   ['reddit', 'reddit.com'], ['stackoverflow', 'stackoverflow.com'],
    ['wikipedia', 'wikipedia.org'], ['npm', 'npmjs.com'], ['twitter', 'twitter.com'],
    ['linkedin', 'linkedin.com'], ['hacker news', 'ycombinator.com'], ['netflix', 'netflix.com'],
  ];
  for (const [keyword, domain] of navSiteChecks) {
    if (gl.includes(keyword) && !ul.includes(domain)) {
      // Allow if history shows we navigated there
      const visited = history.some(h =>
        h.action === 'navigate' && h.value && h.value.includes(domain)
      );
      if (!visited) return false;
    }
  }

  return true;
}

// =============================================================================
// SAFETY GUARDS
// =============================================================================
function applyGuards(decision, goal, url, title, step, history, domMap) {
  const isSystemPage = isChromePage(url);
  const unmappable = domMap === 'UNMAPPABLE' || domMap === 'EMPTY';

  // Cannot interact with chrome:// pages
  if (['click','type','hover','select','fill_form','inspect_form','extract_data','extract_text','drag_drop','upload_file','enter_iframe','context_click','shortcut','execute_js','compose_email','book_slot','login_saved'].includes(decision.action) && unmappable) {
    const targetUrl = extractTargetUrl(goal);
    return {
      thought: 'Page is unmappable. I must navigate to a website first.',
      action: 'navigate',
      value: targetUrl || 'https://www.google.com',
      element_id: null,
      is_complete: false
    };
  }

  // Step 1 on new tab ? navigate immediately
  if (step === 1 && isSystemPage) {
    // If the goal is a search task, jump directly to the search URL
    const searchUrl = buildSearchUrl(goal);
    if (searchUrl) {
      return {
        thought: 'I can construct the search URL directly: ' + searchUrl + '. This is faster than opening the site and finding the search box.',
        action: 'navigate',
        value: searchUrl,
        element_id: null,
        is_complete: false
      };
    }
    const targetUrl = extractTargetUrl(goal);
    if (targetUrl) {
      return {
        thought: 'I am on a new tab page. I need to navigate to ' + targetUrl + ' to begin the task.',
        action: 'navigate',
        value: targetUrl,
        element_id: null,
        is_complete: false
      };
    }
  }

  // Even mid-task: if next step is "navigate to X then search", shortcut to search URL
  if (step <= 2 && (decision.action === 'navigate' || decision.action === 'click')) {
    const searchUrl = buildSearchUrl(goal);
    if (searchUrl) {
      // Only shortcut if we haven't already tried this exact search URL
      const alreadyTriedSearch = history.some(h =>
        h.action === 'navigate' && h.value &&
        (h.value.includes('search') || h.value.includes('q=') || h.value.includes('search_query') || h.value === searchUrl)
      );
      if (!alreadyTriedSearch) {
        return {
          thought: 'I can skip typing in a search box and navigate directly to the search results URL: ' + searchUrl,
          action: 'navigate',
          value: searchUrl,
          element_id: null,
          is_complete: false
        };
      }
    }
  }

  // Premature done guard � need minimum steps based on task type
  if (decision.action === 'done') {
    const isSearchTask = /search|find|look for|query/i.test(goal);
    const minSteps = isSearchTask ? 3 : 2;
    if (history.length < minSteps) {
      const targetUrl = extractTargetUrl(goal);
      return {
        thought: 'Too few steps taken to complete this goal. Continuing task.',
        action: targetUrl ? 'navigate' : 'scroll',
        value: targetUrl || 'down',
        element_id: null,
        is_complete: false
      };
    }
  }

  // Comprehensive done validation � rejects any thought that isn't a genuine completion summary
  if (decision.action === 'done') {
    if (!validateDoneAction(decision, goal, url, history)) {
      // Figure out the best recovery action
      const searchUrl = buildSearchUrl(goal);
      const alreadySearched = history.some(h =>
        (h.action === 'navigate' && h.value && (h.value.includes('search') || h.value.includes('q='))) ||
        (h.action === 'type' && h.success)
      );
      if (searchUrl && !alreadySearched) {
        return {
          thought: 'Task is not yet complete. Navigating directly to the search results.',
          action: 'navigate',
          value: searchUrl,
          element_id: null,
          is_complete: false
        };
      }
      return {
        thought: 'Task is not yet complete. Continuing to work toward the goal.',
        action: 'scroll',
        value: 'down',
        element_id: null,
        is_complete: false
      };
    }
  }

  // element_id fallback for type action
  if (decision.action === 'type' &&
      (decision.element_id === null || decision.element_id === undefined) &&
      decision.value) {
    return { ...decision, element_id: 0 };
  }

  return decision;
}

// =============================================================================
// LLM PROMPT
// =============================================================================
async function getNextAction(goal, domMap, history, settings, currentUrl, pageTitle, stepNum, pageContext = null) {
  const MAX_DOM  = 3200;
  const unmappable = domMap === 'UNMAPPABLE' || domMap === 'EMPTY';
  const trimmedDom = !unmappable && domMap.length > MAX_DOM
    ? domMap.substring(0, MAX_DOM) + '\n� [DOM truncated � use scroll to see more elements]'
    : domMap;

  const hist = history.slice(-8).map(h =>
    '  Step ' + h.step + ': [' + h.action.toUpperCase() + '] ' +
    (h.value ? '"' + h.value.substring(0, 50) + '"' : '') +
    (h.element_id !== null && h.element_id !== undefined ? ' elem=' + h.element_id : '') +
    ' � ' + (h.success ? '? ok' : '? failed') +
    ' | ' + h.thought.substring(0, 80)
  ).join('\n') || '  (none � this is step 1)';

  const domSection = unmappable
    ? '? PAGE STATUS: Not accessible (new tab / browser page).\n? You MUST use "navigate" immediately. Do NOT use click or type.'
    : 'INTERACTIVE ELEMENTS (use element_id numbers from this list only):\n' + trimmedDom;
  const orchestrationSection = buildOrchestrationContext();
  const visionSection = pageContext && pageContext.mode === 'vision'
    ? [
      'VISION MODE ACTIVE: DOM is sparse/unreliable on this page.',
      'You are given a screenshot of the page.',
      'Prefer coordinate actions when element ids are not available.',
      'Use action "click_coords" with numeric x and y in viewport pixels.'
    ].join('\n')
    : '';

  // Site-specific hints � greatly improve accuracy on popular sites
  const siteHints = getSiteHints(currentUrl);

  // Goal-completion hint � tells the LLM exactly what "done" looks like for this task
  const completionHint = buildCompletionHint(goal, currentUrl);

  const prompt = 'You are ZANYSURF, an autonomous AI browser agent. Complete web tasks step by step.\n\n' +
    '??? CURRENT PAGE ???\n' +
    'URL:   ' + currentUrl + '\n' +
      (globalMemoryContext ? globalMemoryContext + '\n\n' : '') +
    'TITLE: ' + pageTitle + '\n' +
    'STEP:  ' + stepNum + ' of 30\n\n' +
    domSection + '\n\n' +
    (visionSection ? '??? VISION CONTEXT ???\n' + visionSection + '\n\n' : '') +
    (orchestrationSection ? '??? MULTI-TAB ORCHESTRATION ???\n' + orchestrationSection + '\n\n' : '') +
    (siteHints ? '??? SITE HINTS ???\n' + siteHints + '\n\n' : '') +
    '??? STEP HISTORY ???\n' +
    hist + '\n\n' +
    '??? GOAL ???\n' +
    goal + '\n\n' +
    '??? TASK COMPLETE WHEN ???\n' +
    completionHint + '\n\n' +
    '??? AVAILABLE ACTIONS ???\n' +
    '� navigate  � Load URL. value="https://..."\n' +
    '� click     � Click element. element_id=NUMBER\n' +
    '� click_coords � Click by coordinates from vision. x=NUMBER, y=NUMBER\n' +
    '� type      � Type text. element_id=NUMBER, value="text"\n' +
    '� key       � Press key. element_id=NUMBER or null, value="Enter"|"Tab"|"Escape"|"ArrowDown"\n' +
    '� scroll    � Scroll. value="down"|"up"|"top"\n' +
    '� hover     � Hover. element_id=NUMBER\n' +
    '� select    � Pick dropdown. element_id=NUMBER, value="option text"\n' +
    '� open_tabs � Open multiple tabs in background. value="https://a.com|https://b.com|..."\n' +
    '� wait_tab  � Wait for a tab to load. value="tabId"\n' +
    '� activate_tab � Switch to tab when dependencies are met. value="tabId"\n' +
    '� extract_data � Extract structured data from current page. value="prices|table|emails|names"\n' +
    '� extract_text � Extract clean readable text + headings from current page. value may be null\n' +
    '� open_gmail_compose � Open Gmail compose with optional value JSON {to,subject,body}\n' +
    '� schedule_calendar � Open Google Calendar event editor with optional value JSON {title,details,location,dates}\n' +
    '� synthesize � Merge extracted data from all tabs into one result. value may be null\n' +
    '� export_csv � Export extracted data to CSV file. value may be null\n' +
    '� copy_clipboard � Copy extracted CSV to clipboard. value may be null\n' +
    '� inspect_form � Inspect visible form fields and validation requirements\n' +
    '� fill_form � Fill visible form fields intelligently. value should be JSON string/object\n' +
    '� wait      � Wait. value="2000" (ms)\n' +
    '� done      � ONLY when goal is 100% confirmed complete.\n\n' +
    '??? RULES ???\n' +
    '1. Be DECISIVE. Choose ONE concrete action. Never describe what could/should happen.\n' +
    '2. "thought" = confident present-tense: "I see X, so I will Y." Max 2 sentences.\n' +
    '3. "done" means THE TASK IS VISIBLY FINISHED on the current page RIGHT NOW.\n' +
    '4. NEVER use "done" if your thought describes a page element, button, or next action.\n' +
    '5. NEVER use "done" if your thought uses words like: could, should, might, consider, perhaps, next, element, visible, button, click, type, navigate.\n' +
    '6. VALID "done" thought example: "I have navigated to YouTube and the search results for lo-fi music are now displayed on screen."\n' +
    '7. INVALID "done" thought example: "The search button is currently visible and could be the next action." � this is NOT done, take the action!\n' +
    '8. Step 1: if not on the right site, navigate there immediately.\n' +
    '9. After typing in a search box, press key "Enter" on the VERY NEXT step.\n' +
    '10. Only use element_id numbers from the list above � never invent them.\n' +
    '11. If a step failed, try a different element_id or navigate to a direct search URL.\n' +
    '12. Never repeat the same failed action+element_id.\n' +
    '13. Scroll down to reveal more elements if the target is not visible.\n' +
    '14. For compare/research tasks, use open_tabs -> wait_tab/activate_tab -> extract_data per tab -> synthesize -> export_csv/copy_clipboard.\n' +
    '15. Respect tab dependency graphs: do not activate a dependent tab before required tabs are extracted.\n' +
    '16. For forms, call inspect_form first, then fill_form, then re-check for validation errors before done.\n\n' +
    '17. In vision mode, prefer click_coords with clear x,y values from visible UI.\n' +
    '18. For Gmail tasks, use open_gmail_compose first, then compose_email/fill_form.\n' +
    '19. For calendar tasks, use schedule_calendar first, then fill_form/book_slot.\n\n' +
    '??? RESPOND IN JSON ONLY � NO markdown, NO code fences, NO extra text ???\n' +
    'Example response:\n' +
    '{"thought":"I see the YouTube homepage. I will navigate directly to the search results for lo-fi music.","action":"navigate","element_id":null,"value":"https://www.youtube.com/results?search_query=lo-fi+music","is_complete":false}\n\n' +
    'Your response must be exactly one JSON object:\n' +
    '{\n' +
    '  "thought": "I see [observation]. I will [action].",\n' +
    '  "action": "navigate|click|click_coords|type|key|scroll|hover|select|wait|done|new_tab|open_tabs|wait_tab|activate_tab|extract_data|extract_text|open_gmail_compose|schedule_calendar|synthesize|export_csv|copy_clipboard|inspect_form|fill_form|drag_drop|upload_file|enter_iframe|exit_iframe|context_click|shortcut|execute_js|compose_email|book_slot|bridge_extension|login_saved",\n' +
    '  "element_id": null_or_integer,\n' +
    '  "x": optional_number,\n' +
    '  "y": optional_number,\n' +
    '  "value": "string or null",\n' +
    '  "preset": "required only for execute_js; one of: ' + EXECUTE_JS_PRESETS.join('|') + '",\n' +
    '  "args": ["optional execute_js args"],\n' +
    '  "depends_on": [optional_tab_ids],\n' +
    '  "is_complete": true_if_done_else_false\n' +
    '}';

  return LLMGateway.call(prompt, settings.provider, settings.model, settings, { pageContext, mode: 'agent' });
}

// =============================================================================
// OLLAMA � supports /api/chat (new) and /api/generate (legacy)
// =============================================================================
const OLLAMA_REQUEST_TIMEOUT_MS = 25000;

async function fetchWithTimeout(url, options = {}, timeoutMs = OLLAMA_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function listOllamaModels(baseUrl) {
  try {
    const res = await fetchWithTimeout(baseUrl + '/api/tags', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    }, 6000);
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.models || []).map(m => m?.name).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function buildOllamaCandidates(requestedModel, installedModels) {
  const preferred = [
    requestedModel,
    'llama3.2:latest',
    'llama3:latest',
    'llama3',
    'mistral:latest',
    'mistral',
    'llama3.1:latest',
    'llama3.1'
  ].filter(Boolean);

  const installedSet = new Set(installedModels || []);
  const candidates = [];

  for (const model of preferred) {
    if (installedSet.has(model)) candidates.push(model);
  }
  for (const model of installedModels || []) {
    if (!candidates.includes(model)) candidates.push(model);
  }

  if (!candidates.length && requestedModel) candidates.push(requestedModel);
  if (!candidates.length) candidates.push('llama3');
  return candidates;
}

async function callOllama(prompt, settings) {
  const baseUrl = (settings.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
  const requestedModel = (settings.ollamaModel || '').trim() || 'llama3';
  const installedModels = await listOllamaModels(baseUrl);
  const modelCandidates = buildOllamaCandidates(requestedModel, installedModels);

  const jsonSchema = {
    type: 'object',
    required: ['thought', 'action', 'is_complete'],
    properties: {
      thought:     { type: 'string' },
      action:      { type: 'string', enum: ['navigate','click','click_coords','type','key','scroll','hover','select','wait','done','new_tab','open_tabs','wait_tab','activate_tab','extract_data','extract_text','open_gmail_compose','schedule_calendar','synthesize','export_csv','copy_clipboard','inspect_form','fill_form','drag_drop','upload_file','enter_iframe','exit_iframe','context_click','shortcut','execute_js','compose_email','book_slot','bridge_extension','login_saved'] },
      element_id:  { type: ['integer', 'null'] },
      x:           { type: ['number', 'integer', 'null'] },
      y:           { type: ['number', 'integer', 'null'] },
      value:       { type: ['string', 'null'] },
      preset:      { type: ['string', 'null'], enum: [...EXECUTE_JS_PRESETS, null] },
      args:        { type: ['array', 'null'], items: { type: ['string', 'number', 'boolean', 'null'] } },
      depends_on:  { type: ['array', 'null'], items: { type: ['integer', 'string'] } },
      is_complete: { type: 'boolean' }
    }
  };

  let rawText = '';
  let lastError = '';

  for (const model of modelCandidates) {
    // Try /api/chat first (Ollama >= 0.1.14)
    try {
      const res = await fetchWithTimeout(baseUrl + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are ZANYSURF, a precise browser automation agent. Always respond with valid JSON only. Never include markdown, code fences, or explanation outside the JSON object.' },
            { role: 'user', content: prompt }
          ],
          stream: false,
          format: jsonSchema,
          options: { temperature: 0, num_predict: 800 }
        })
      });

      if (res.ok) {
        const data = await res.json();
        rawText = data?.message?.content || data?.response || '';
      } else {
        const err = await res.text();
        lastError = 'Ollama ' + res.status + ': ' + err.substring(0, 200);
      }
    } catch (e) {
      lastError = e?.message || 'Ollama /api/chat request failed';
    }

    // Fallback to /api/generate
    if (!rawText) {
      try {
        const res = await fetchWithTimeout(baseUrl + '/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt,
            stream: false,
            format: jsonSchema,
            options: { temperature: 0, num_predict: 800 }
          })
        });
        if (res.ok) {
          const data = await res.json();
          rawText = data?.response || '';
        } else {
          const err = await res.text();
          lastError = 'Ollama ' + res.status + ': ' + err.substring(0, 200);
        }
      } catch (e) {
        lastError = e?.message || 'Ollama /api/generate request failed';
      }
    }

    if (rawText) {
      await updateApiMetrics({ provider: 'ollama', promptChars: prompt.length, outputChars: rawText.length });
      if (settings.ollamaModel !== model) {
        chrome.storage.local.set({ ollamaModel: model }).catch(() => {});
      }
      break;
    }
  }

  if (!rawText) {
    throw new Error(
      (lastError || 'Ollama returned an empty response.') +
      ' | Try: ollama pull llama3'
    );
  }
  const parsed = extractJSON(rawText);
  if (!parsed) {
    throw new Error(
      'Could not parse JSON from Ollama: ' + rawText.substring(0, 150) +
      (lastError ? ' | Last error: ' + lastError : '')
    );
  }
  return parsed;
}

// =============================================================================
// GEMINI
// =============================================================================
async function callGemini(prompt, settings, pageContext = null) {
  const key = settings.apiKey;
  if (!key) throw new Error('Gemini API key not set. Open ? Settings.');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + key;
  const isVision = pageContext && pageContext.mode === 'vision' && pageContext.screenshot;
  let parts = [{ text: prompt }];

  if (isVision) {
    const base64 = (pageContext.screenshot.split(',')[1] || '').trim();
    if (base64) {
      parts = [
        { text: (pageContext.visionPrompt || 'Analyze this browser screenshot and identify actionable UI controls with relative positions.\n\n') + prompt },
        { inline_data: { mime_type: 'image/jpeg', data: base64 } }
      ];
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 600 }
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Gemini ' + res.status + ': ' + err.substring(0, 200));
  }
  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  await updateApiMetrics({ provider: 'gemini', promptChars: prompt.length, outputChars: rawText.length });
  const parsed = extractJSON(rawText);
  if (!parsed) throw new Error('Could not parse JSON from Gemini: ' + rawText.substring(0, 150));
  return parsed;
}

async function detectOllamaModels(url) {
  const baseUrl = String(url || 'http://localhost:11434').replace(/\/$/, '');
  const res = await fetchWithTimeout(baseUrl + '/api/tags', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  }, 6000);
  if (!res.ok) throw new Error('Cannot connect to ' + baseUrl);
  const data = await res.json();
  return (data.models || []).map(model => ({
    name: model.name,
    size: formatBytes(Number(model.size || 0)),
    modified: model.modified_at,
    profile: MODEL_PROFILES[model.name] || null
  }));
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value || value < 1024) return value + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return size.toFixed(1) + ' ' + units[unitIndex];
}

function trackModelPerformance(provider, model, latencyMs, success) {
  const key = provider + ':' + model;
  const stats = modelStats[key] || { calls: 0, totalMs: 0, failures: 0, avgMs: 0 };
  stats.calls += 1;
  stats.totalMs += Number(latencyMs || 0);
  stats.avgMs = Math.round(stats.totalMs / Math.max(stats.calls, 1));
  if (!success) stats.failures += 1;
  modelStats[key] = stats;
}

function getProviderConfig(provider) {
  const normalized = String(provider || 'ollama').toLowerCase();
  const configs = {
    ollama: { requiresKey: false, defaultModel: 'llama3', models: PROVIDER_MODELS.ollama },
    gemini: { requiresKey: true, defaultModel: 'gemini-1.5-flash', models: PROVIDER_MODELS.gemini },
    openai: { requiresKey: true, defaultModel: 'gpt-4o-mini', models: PROVIDER_MODELS.openai },
    claude: { requiresKey: true, defaultModel: 'claude-haiku-4-5', models: PROVIDER_MODELS.claude },
    groq: { requiresKey: true, defaultModel: 'llama-3.1-8b-instant', models: PROVIDER_MODELS.groq },
    mistral: { requiresKey: true, defaultModel: 'mistral-small-latest', models: PROVIDER_MODELS.mistral },
    edge_builtin: { requiresKey: false, defaultModel: 'phi-3-mini', models: PROVIDER_MODELS.edge_builtin }
  };
  return configs[normalized] || configs.ollama;
}

async function callEdgeBuiltinText(prompt, options = {}) {
  const tabId = options.tabId || await getActiveTabId();
  if (!tabId) {
    throw new Error('Edge built-in AI requires an active browser tab.');
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const tabUrl = String(tab?.url || '');
  if (!tabUrl || isChromePage(tabUrl)) {
    throw new Error('Edge AI cannot run on browser internal pages. Open a normal website tab and retry.');
  }

  const sendEdgePrompt = async () => {
    return chrome.tabs.sendMessage(tabId, {
      action: 'EXECUTE',
      command: {
        action: 'edge_ai_prompt',
        value: String(prompt || '')
      }
    }).catch(error => ({ success: false, error: error?.message || 'Edge AI call failed' }));
  };

  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch(() => {});
  let response = await sendEdgePrompt();

  const message = String(response?.error || '').toLowerCase();
  if (!response?.success && (message.includes('receiving end does not exist') || message.includes('could not establish connection'))) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch(() => {});
    await sleep(120);
    response = await sendEdgePrompt();
  }

  if (!response?.success) {
    throw new Error(response?.error || 'Edge built-in AI is not available in this tab/session.');
  }
  return String(response.result || '').trim();
}

async function callOpenAICompatible({ url, apiKey, model, prompt, temperature = 0.1, max_tokens = 600 }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens,
      response_format: { type: 'json_object' }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(data?.error?.message || ('HTTP ' + response.status));
  return data?.choices?.[0]?.message?.content || '';
}

const LLMGateway = {
  async call(prompt, overrideProvider, overrideModel, existingSettings = null, options = {}) {
    const settings = existingSettings || await getSettings();
    const provider = String(overrideProvider || settings.provider || 'ollama').toLowerCase();
    const config = getProviderConfig(provider);
    const model = String(overrideModel || settings.model || config.defaultModel || '').trim();

    if (config.requiresKey && !settings.providerKey) {
      throw new Error('Vault is locked or API key missing for provider: ' + provider);
    }

    const startedAt = Date.now();
    try {
      let parsed;
      if (provider === 'ollama') parsed = await callOllama(prompt, { ...settings, ollamaModel: model, provider });
      else if (provider === 'gemini') parsed = await callGemini(prompt, { ...settings, apiKey: settings.providerKey || settings.apiKey }, options.pageContext);
      else {
        const text = await this.callText(prompt, provider, model, settings, options);
        parsed = extractJSON(text) || parseMaybeJson(text);
      }
      if (!parsed || typeof parsed !== 'object') throw new Error('Provider returned non-JSON payload');
      trackModelPerformance(provider, model, Date.now() - startedAt, true);
      return parsed;
    } catch (error) {
      trackModelPerformance(provider, model, Date.now() - startedAt, false);
      throw error;
    }
  },

  async callText(prompt, provider, model, existingSettings = null, options = {}) {
    const settings = existingSettings || await getSettings();
    const useProvider = String(provider || settings.provider || 'ollama').toLowerCase();
    const useModel = String(model || settings.model || getProviderConfig(useProvider).defaultModel || '').trim();
    const startedAt = Date.now();
    try {
      let text = '';
      if (useProvider === 'ollama') {
        text = await callOllamaSummary(prompt, { ...settings, ollamaModel: useModel });
      } else if (useProvider === 'gemini') {
        text = await callGeminiSummary(prompt, { ...settings, apiKey: settings.providerKey || settings.apiKey });
      } else if (useProvider === 'openai') {
        text = await callOpenAICompatible({
          url: 'https://api.openai.com/v1/chat/completions',
          apiKey: settings.providerKey,
          model: useModel,
          prompt,
          max_tokens: options.mode === 'planning' ? 900 : 600
        });
      } else if (useProvider === 'groq') {
        text = await callOpenAICompatible({
          url: 'https://api.groq.com/openai/v1/chat/completions',
          apiKey: settings.providerKey,
          model: useModel,
          prompt,
          max_tokens: options.mode === 'planning' ? 900 : 600
        });
      } else if (useProvider === 'mistral') {
        const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + settings.providerKey
          },
          body: JSON.stringify({
            model: useModel,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: options.mode === 'planning' ? 900 : 600,
            response_format: { type: 'json_object' }
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.error) throw new Error(data?.error?.message || ('Mistral HTTP ' + response.status));
        text = data?.choices?.[0]?.message?.content || '';
      } else if (useProvider === 'claude') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': settings.providerKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: useModel,
            max_tokens: options.mode === 'planning' ? 900 : 600,
            messages: [{ role: 'user', content: prompt }]
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.error) throw new Error(data?.error?.message || ('Claude HTTP ' + response.status));
        text = data?.content?.[0]?.text || '';
      } else if (useProvider === 'edge_builtin') {
        text = await callEdgeBuiltinText(prompt);
      } else {
        throw new Error('Unknown provider: ' + useProvider);
      }

      trackModelPerformance(useProvider, useModel, Date.now() - startedAt, true);
      return String(text || '').trim();
    } catch (error) {
      trackModelPerformance(useProvider, useModel, Date.now() - startedAt, false);
      throw error;
    }
  },

  async testConnection(provider, settings = null) {
    const cfg = getProviderConfig(provider);
    const resolved = settings || await getSettings();
    try {
      if (provider === 'ollama') {
        const models = await detectOllamaModels(resolved.ollamaUrl || 'http://localhost:11434');
        return { ok: true, models };
      }
      if (cfg.requiresKey && !resolved.providerKey) return { ok: false, error: 'Missing API key (vault locked or not configured).' };
      if (provider === 'gemini') {
        const probe = await callGeminiSummary('Reply with plain text: ok', { ...resolved, apiKey: resolved.providerKey });
        return { ok: !!probe, preview: probe.substring(0, 24) };
      }
      if (provider === 'openai') {
        const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + resolved.providerKey } });
        return { ok: response.ok };
      }
      if (provider === 'groq') {
        const response = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + resolved.providerKey } });
        return { ok: response.ok };
      }
      if (provider === 'mistral') {
        const response = await fetch('https://api.mistral.ai/v1/models', { headers: { Authorization: 'Bearer ' + resolved.providerKey } });
        return { ok: response.ok };
      }
      if (provider === 'claude') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': resolved.providerKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] })
        });
        return { ok: response.ok };
      }
      if (provider === 'edge_builtin') {
        const probe = await callEdgeBuiltinText('Reply with plain text: ok');
        return { ok: !!probe, models: PROVIDER_MODELS.edge_builtin };
      }
      return { ok: false, error: 'Unknown provider' };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
};

// =============================================================================
// ROBUST JSON EXTRACTOR
// =============================================================================
function extractJSON(text) {
  if (!text) return null;
  const t = text.trim();

  try { return JSON.parse(t); } catch (_) {}

  // Strip markdown code fence
  const fence = t.match(/```(?:json)?\s*([\s\S]+?)```/i);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch (_) {} }

  // First { ... } block
  const start = t.indexOf('{');
  const end   = t.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(t.substring(start, end + 1)); } catch (_) {}
  }

  // Regex fallback
  const thoughtM = t.match(/"thought"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const actionM  = t.match(/"action"\s*:\s*"([^"]+)"/);
  const valueM   = t.match(/"value"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const idM      = t.match(/"element_id"\s*:\s*(\d+|null)/);
  const xM       = t.match(/"x"\s*:\s*(-?\d+(?:\.\d+)?)/);
  const yM       = t.match(/"y"\s*:\s*(-?\d+(?:\.\d+)?)/);

  if (thoughtM && actionM) {
    return {
      thought:     thoughtM[1],
      action:      actionM[1],
      value:       valueM ? valueM[1] : null,
      element_id:  idM ? (idM[1] === 'null' ? null : parseInt(idM[1])) : null,
      x:           xM ? Number(xM[1]) : null,
      y:           yM ? Number(yM[1]) : null,
      is_complete: false
    };
  }
  return null;
}

// =============================================================================
// GOAL SATISFACTION CHECK
// =============================================================================
function checkGoalSatisfied(goal, url, title, history, steps) {
  const gl    = goal.toLowerCase();
  const ul    = url.toLowerCase();
  const steps_ = steps || 0;

  const siteMap = [
    ['youtube', 'youtube.com'], ['amazon', 'amazon.com'], ['google', 'google.com'],
    ['twitter', 'twitter.com'], ['reddit', 'reddit.com'], ['github', 'github.com'],
    ['wikipedia', 'wikipedia.org'], ['netflix', 'netflix.com'],
    ['instagram', 'instagram.com'], ['facebook', 'facebook.com'],
    ['linkedin', 'linkedin.com'], ['gmail', 'mail.google.com'],
    ['stackoverflow', 'stackoverflow.com'], ['twitch', 'twitch.tv'],
    ['spotify', 'spotify.com'], ['bing', 'bing.com'],
    ['duckduckgo', 'duckduckgo.com'], ['huggingface', 'huggingface.co'],
  ];

  const isSearchGoal = /search|find|look for|query/i.test(gl);

  for (const [keyword, domain] of siteMap) {
    if (gl.includes(keyword) && ul.includes(domain)) {
      // Search tasks: need search URL AND at least 3 steps (navigate + search action + results)
      if (isSearchGoal) {
        if (steps_ < 2) return false;
        const searchUrlPatterns = ['search', 'q=', 'query=', 'results', 's?k=', '/search/', 'search_query', 'find='];
        // URL must confirm search results are being shown � not just the site homepage
        if (searchUrlPatterns.some(p => ul.includes(p))) return true;
        // Also check history for a prior navigate to a search URL
        const histSearched = history.some(h =>
          h.action === 'navigate' && h.value &&
          searchUrlPatterns.some(p => h.value.toLowerCase().includes(p))
        );
        return histSearched;
      }
      // Navigation-only tasks � just being on the right site is enough
      // But require the URL to NOT be a generic browser page and steps >= 2
      if (steps_ >= 2 && ul.includes(domain)) return true;
      return false;
    }
  }
  const rawUrl = goal.match(/https?:\/\/[^\s]+/);
  if (rawUrl) { try { return ul.includes(new URL(rawUrl[0]).hostname); } catch (_) {} }
  return false;
}

function getFastPathDecision(goal, currentUrl, step, history) {
  if (step !== 1 || (history && history.length > 0)) return null;

  const rawGoal = (goal || '').trim();
  const gl = rawGoal.toLowerCase();
  if (!gl) return null;

  const directUrlMatch = rawGoal.match(/https?:\/\/[^\s]+/i);
  if (directUrlMatch) {
    const targetUrl = directUrlMatch[0];
    if (!currentUrl || !currentUrl.startsWith(targetUrl)) {
      return {
        thought: 'I will navigate directly to the requested URL first.',
        action: 'navigate',
        element_id: null,
        value: targetUrl,
        is_complete: false
      };
    }
  }

  const siteMap = [
    { keys: ['youtube'], url: 'https://www.youtube.com' },
    { keys: ['amazon'], url: 'https://www.amazon.com' },
    { keys: ['reddit'], url: 'https://www.reddit.com' },
    { keys: ['github'], url: 'https://github.com' },
    { keys: ['hacker news', 'hn'], url: 'https://news.ycombinator.com' },
    { keys: ['google'], url: 'https://www.google.com' },
    { keys: ['microsoft partner', 'partner.microsoft.com'], url: 'https://partner.microsoft.com' }
  ];

  const navigationIntent = /(open|go to|visit|navigate to|take me to|launch)/i.test(gl);
  if (!navigationIntent) return null;

  for (const site of siteMap) {
    if (site.keys.some(key => gl.includes(key))) {
      if (!currentUrl || !currentUrl.includes(new URL(site.url).hostname)) {
        return {
          thought: 'I will navigate to the requested site first.',
          action: 'navigate',
          element_id: null,
          value: site.url,
          is_complete: false
        };
      }
    }
  }

  return null;
}

async function getBookmarkFastPathDecision(goal, currentUrl, step, history) {
  if (step !== 1 || (history && history.length > 0)) return null;
  if (!/open|go to|visit|navigate|take me/i.test(goal || '')) return null;

  const bookmark = await SmartBookmarks.find(goal);
  if (!bookmark) return null;

  const host = trimHost(bookmark.url || '');
  if (host && currentUrl.includes(host)) return null;

  await SmartBookmarks.touch(bookmark.id);
  return {
    thought: 'I matched your request to the smart bookmark "' + bookmark.name + '" and will open it now.',
    action: 'navigate',
    element_id: null,
    value: bookmark.url,
    is_complete: false
  };
}

// =============================================================================
// SITE-SPECIFIC HINTS � injected into LLM prompt for popular sites
// =============================================================================
function getSiteHints(url) {
  const u = url.toLowerCase();
  if (u.includes('youtube.com')) {
    return 'On YouTube: the search box has aria-label "Search". Search results appear at /results?search_query=. Video thumbnails are <a> links. If you want to search, use navigate with the search URL directly.';
  }
  if (u.includes('google.com/search') || u.includes('google.com/?')) {
    return 'On Google Search: results are <a> tags. The search box is input[name="q"]. To open a result, click on its <a> element.';
  }
  if (u.includes('github.com')) {
    return 'On GitHub: the search box is input[data-testid="search-input"] or has placeholder "Search". Repository links are <a> tags. Code results and repo names are links.';
  }
  if (u.includes('amazon.com')) {
    return 'On Amazon: the search box has id="twotabsearchtextbox". Search results are article or div.s-result-item elements. Product titles are <a> tags.';
  }
  if (u.includes('reddit.com')) {
    return 'On Reddit: posts are <a> tags with titles. The search box has placeholder "Search Reddit". Subreddit links start with /r/. Upvoted/hot posts are at the top.';
  }
  if (u.includes('twitter.com') || u.includes('x.com')) {
    return 'On Twitter/X: the search box has aria-label "Search query" or placeholder "Search". Tweets are article elements. For navigation, prefer the search URL directly.';
  }
  if (u.includes('stackoverflow.com')) {
    return 'On Stack Overflow: the search box has name="q". Questions are <a> tags with .question-hyperlink class. Answers are divid answers section.';
  }
  if (u.includes('wikipedia.org')) {
    return 'On Wikipedia: the search box has id="searchInput" or aria-label "Search Wikipedia". Article heading is h1#firstHeading. Sections have h2/h3 headings.';
  }
  if (u.includes('linkedin.com')) {
    return 'On LinkedIn: the search box has aria-label "Search". Job listings and profiles are <a> tags. To search, use the search URL: /search/results/all/?keywords=query.';
  }
  if (u.includes('npmjs.com')) {
    return 'On npm: the search box has placeholder "Search packages". Package results are <a> tags with package names.';
  }
  return '';
}

// =============================================================================
// COMPLETION HINT BUILDER
// Generates a concrete, task-specific "done" description injected into the prompt.
// This tells the LLM exactly what the page should look like when ready to call done.
// =============================================================================
function buildCompletionHint(goal, currentUrl) {
  const gl = goal.toLowerCase();
  const ul = currentUrl.toLowerCase();

  const isSearch  = /search|find|look for|query/i.test(gl);
  const isOpen    = /open|go to|navigate|visit/i.test(gl) && !isSearch;
  const isClick   = /click|press|tap/i.test(gl);
  const isType    = /type|enter|fill|write/i.test(gl);
  const isScroll  = /scroll|read|view/i.test(gl);

  // Extract site name from common patterns
  const siteMatch = gl.match(/(?:on|to|at|open)\s+([\w\s]+?)(?:\s+and|\s+for|\s*$)/i);
  const siteName  = siteMatch ? siteMatch[1].trim() : '';

  if (isSearch) {
    const queryMatch = goal.match(/(?:for|about)\s+["']?(.+?)["']?(?:\s+on|\s+in|\s+at|$)/i);
    const query = queryMatch ? queryMatch[1].trim() : 'the topic';
    const site  = siteName || 'the site';
    return `The search results page for "${query}" is visible on ${site}. ` +
           `The URL contains "search", "q=", or similar. ` +
           `Result items/videos/links are displayed on screen. ` +
           `Example done thought: "I have searched for ${query} on ${site} and the results page is now showing."`;
  }

  if (isOpen) {
    const site = siteName || 'the website';
    return `The browser has loaded ${site}. ` +
           `The page title/URL confirms the correct site. ` +
           `Example done thought: "I have navigated to ${site} and the page has loaded successfully."`;
  }

  if (isClick) {
    return `The button/link has been clicked and the resulting page or action is visible. ` +
           `Example done thought: "I clicked the requested element and the page responded as expected."`;
  }

  if (isType) {
    return `The text has been entered into the field and any required submission has been performed. ` +
           `Example done thought: "I have typed the required text and submitted the form / pressed Enter."`;
  }

  if (isScroll) {
    return `The requested content is now visible on screen after scrolling. ` +
           `Example done thought: "I scrolled down and the content requested is now visible on screen."`;
  }

  return `The goal "${goal}" is fully completed and the result is visible on the current page.`;
}

// =============================================================================
// DIRECT SEARCH URL BUILDER
// Constructs a search URL immediately from the goal � no DOM interaction needed.
// Returns null if no search intent is detected.
// =============================================================================
function buildSearchUrl(goal) {
  const gl = goal.toLowerCase();

  // Extract quoted or after-keyword terms: "search X for Y", "find Y on X", "look for Y on X"
  const searchPatterns = [
    /(?:search|find|look for|query)\s+(?:for\s+)?["']?([^"']+?)["']?\s+(?:on|at|in)\s+(\w[\w.\s]+)/i,
    /(?:on|go to|open)\s+(\w[\w.\s]+?)\s+and\s+(?:search|find|look)\s+(?:for\s+)?["']?([^"'.,]+)/i,
    /(?:search|find)\s+["']?([^"']+?)["']?\s+(?:on|at|in)\s+(\w[\w.\s]+)/i,
  ];

  let site = '', query = '';

  for (const pat of searchPatterns) {
    const m = goal.match(pat);
    if (m) {
      if (pat.source.startsWith('(?:search|find|look')) {
        query = m[1].trim(); site = m[2].trim();
      } else {
        site = m[1].trim(); query = m[2].trim();
      }
      break;
    }
  }

  // Fallback: detect known site in goal + extract query from "for X" pattern
  if (!query) {
    const forMatch = goal.match(/(?:for|about)\s+["']?(.+?)["']?(?:\s+on|\s+in|\s+at|$)/i);
    if (forMatch) query = forMatch[1].trim();
  }
  if (!site) site = goal;

  if (!query) return null;

  const sl = site.toLowerCase();
  const q  = encodeURIComponent(query);

  if (sl.includes('youtube'))      return 'https://www.youtube.com/results?search_query=' + q;
  if (sl.includes('github'))       return 'https://github.com/search?q=' + q + '&type=repositories';
  if (sl.includes('google'))       return 'https://www.google.com/search?q=' + q;
  if (sl.includes('amazon'))       return 'https://www.amazon.com/s?k=' + q;
  if (sl.includes('reddit'))       return 'https://www.reddit.com/search/?q=' + q;
  if (sl.includes('bing'))         return 'https://www.bing.com/search?q=' + q;
  if (sl.includes('duckduckgo'))   return 'https://duckduckgo.com/?q=' + q;
  if (sl.includes('stackoverflow'))return 'https://stackoverflow.com/search?q=' + q;
  if (sl.includes('npm'))          return 'https://www.npmjs.com/search?q=' + q;
  if (sl.includes('pypi'))         return 'https://pypi.org/search/?q=' + q;
  if (sl.includes('wikipedia'))    return 'https://en.wikipedia.org/w/index.php?search=' + q;
  if (sl.includes('twitter') || sl.includes(' x ') || sl.includes('x.com'))
                                   return 'https://twitter.com/search?q=' + q;
  if (sl.includes('linkedin'))     return 'https://www.linkedin.com/search/results/all/?keywords=' + q;
  if (sl.includes('huggingface'))  return 'https://huggingface.co/search/full-text?q=' + q;
  if (sl.includes('spotify'))      return 'https://open.spotify.com/search/' + q;
  if (sl.includes('hackernews') || sl.includes('hacker news'))
                                   return 'https://hn.algolia.com/?q=' + q;

  return null;
}

// =============================================================================
// URL EXTRACTOR
// =============================================================================
function extractTargetUrl(goal) {
  const gl = goal.toLowerCase();
  const urlMap = {
    'youtube': 'https://www.youtube.com', 'amazon': 'https://www.amazon.com',
    'google': 'https://www.google.com', 'twitter': 'https://www.twitter.com',
    'reddit': 'https://www.reddit.com', 'github': 'https://www.github.com',
    'wikipedia': 'https://www.wikipedia.org', 'netflix': 'https://www.netflix.com',
    'instagram': 'https://www.instagram.com', 'facebook': 'https://www.facebook.com',
    'linkedin': 'https://www.linkedin.com', 'gmail': 'https://mail.google.com',
    'maps': 'https://maps.google.com', 'stackoverflow': 'https://stackoverflow.com',
    'twitch': 'https://www.twitch.tv', 'spotify': 'https://www.spotify.com',
    'bing': 'https://www.bing.com', 'duckduckgo': 'https://www.duckduckgo.com',
    'yahoo': 'https://www.yahoo.com', 'x.com': 'https://www.x.com',
    'hackernews': 'https://news.ycombinator.com', 'hacker news': 'https://news.ycombinator.com',
    'producthunt': 'https://www.producthunt.com', 'medium': 'https://www.medium.com',
    'dev.to': 'https://www.dev.to', 'npm': 'https://www.npmjs.com',
    'huggingface': 'https://huggingface.co', 'openai': 'https://www.openai.com',
    'vercel': 'https://vercel.com',
  };
  for (const [kw, url] of Object.entries(urlMap)) {
    if (gl.includes(kw)) return url;
  }
  const rawUrl = goal.match(/https?:\/\/[^\s]+/);
  if (rawUrl) return rawUrl[0];
  const domain = goal.match(/([a-z0-9-]+\.(com|org|net|io|co|dev|ai)[^\s]*)/i);
  if (domain) return 'https://' + domain[0];
  return 'https://www.google.com';
}

// =============================================================================
// PAGE CONTEXT (DOM + VISION)
// =============================================================================
async function getPageContext(tabId, isSystemPage = false) {
  const dom = await getDomContext(tabId, isSystemPage);
  const domCount = countDomElements(dom.domMap);

  if (!isSystemPage && domCount < 5) {
    const vision = await getVisionContext(tabId);
    if (vision) return vision;
  }

  return {
    mode: 'dom',
    domMap: dom.domMap,
    domCount,
    title: dom.title,
    url: dom.url,
    semantic: dom.meta?.pageType || 'generic',
    sections: dom.meta?.sections || {},
    primaryCTA: dom.meta?.primaryCTA || null,
    media: dom.meta?.media || {}
  };
}

async function getDomContext(tabId, isSystemPage = false) {
  if (isSystemPage) {
    return { domMap: 'UNMAPPABLE', title: '', url: '', meta: {} };
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch(() => {});
    await sleep(350);
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'GET_DOM',
      options: { lazyLoad: true }
    });
    return {
      domMap: (response && response.dom) ? response.dom : 'EMPTY',
      title: response?.title || '',
      url: response?.url || '',
      meta: response?.meta || {}
    };
  } catch (_) {
    return { domMap: 'UNMAPPABLE', title: '', url: '', meta: {} };
  }
}

async function getVisionContext(tabId) {
  try {
    const shots = await captureScrollableScreenshots(tabId);
    const screenshot = shots[0] || await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 70 });
    if (!screenshot) return null;
    return {
      mode: 'vision',
      screenshot,
      stitchedScreens: shots,
      visionPrompt: buildVisionPrompt()
    };
  } catch (_) {
    return null;
  }
}

async function captureScrollableScreenshots(tabId) {
  const captures = [];
  try {
    const dims = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        innerHeight: window.innerHeight,
        totalHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        startY: window.scrollY
      })
    });
    const info = dims?.[0]?.result;
    if (!info || !info.innerHeight || !info.totalHeight) return captures;
    const pages = Math.min(5, Math.ceil(info.totalHeight / info.innerHeight));
    for (let i = 0; i < pages; i++) {
      await chrome.scripting.executeScript({ target: { tabId }, func: (y) => window.scrollTo(0, y), args: [i * info.innerHeight] }).catch(() => {});
      await sleep(180);
      const frame = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 62 });
      if (frame) captures.push(frame);
    }
    await chrome.scripting.executeScript({ target: { tabId }, func: (y) => window.scrollTo(0, y), args: [info.startY] }).catch(() => {});
  } catch (_) {}
  return captures;
}

function buildVisionPrompt() {
  return [
    'You are in browser vision mode.',
    'Identify the most relevant interactive UI controls from the screenshot.',
    'Estimate click coordinates in viewport pixels.',
    'When needed, return action click_coords with x and y.'
  ].join(' ');
}

// =============================================================================
// MEMORY + ORCHESTRATION HELPERS
// =============================================================================
function tokenizeText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t && t.length > 2)
    .slice(0, 120);
}

function vectorizeText(text, dims = 48) {
  const vector = Array(dims).fill(0);
  const tokens = tokenizeText(text);
  for (const token of tokens) {
    let hash = 0;
    for (let index = 0; index < token.length; index++) {
      hash = ((hash << 5) - hash) + token.charCodeAt(index);
      hash |= 0;
    }
    const slot = Math.abs(hash) % dims;
    vector[slot] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0)) || 1;
  return vector.map(value => value / norm);
}

function cosineSimilarity(vecA = [], vecB = []) {
  if (!vecA.length || !vecB.length || vecA.length !== vecB.length) return 0;
  let score = 0;
  for (let index = 0; index < vecA.length; index++) score += vecA[index] * vecB[index];
  return score;
}

async function retrieveMemoryContext(goal) {
  try {
    const stored = await chrome.storage.local.get(['zanysurf_short_memory', 'zanysurf_long_memory']);
    const shortMem = stored.zanysurf_short_memory || [];
    const longMem = stored.zanysurf_long_memory || { preferences: {}, frequentSites: {}, taskPatterns: [] };
    const queryVector = vectorizeText(goal);

    const similarShort = shortMem
      .map(item => {
        const ageDays = Math.max(0, (Date.now() - (item.ts || Date.now())) / (1000 * 60 * 60 * 24));
        const decay = ageDays > 30 ? Math.exp(-(ageDays - 30) / 30) : 1;
        return { item, score: cosineSimilarity(queryVector, item.vector || []) * decay };
      })
      .filter(entry => entry.score > 0.18)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map(entry => '- Recent step: ' + (entry.item.action || 'action') + ' on ' + trimHost(entry.item.url || '') + ' (' + Math.round(entry.score * 100) + '% similar)');

    const similarPatterns = (longMem.taskPatterns || [])
      .map(item => {
        const ageDays = Math.max(0, (Date.now() - (item.ts || Date.now())) / (1000 * 60 * 60 * 24));
        const decay = ageDays > 30 ? Math.exp(-(ageDays - 30) / 45) : 1;
        return { item, score: cosineSimilarity(queryVector, item.vector || []) * decay };
      })
      .filter(entry => entry.score > 0.2)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map(entry => '- Pattern: ' + entry.item.summary + ' (' + Math.round(entry.score * 100) + '% match)');

    const topSites = Object.entries(longMem.frequentSites || {})
      .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
      .slice(0, 5)
      .map(([site, data]) => '- Frequent site: ' + site + ' (' + data.count + ' visits)');

    const prefLines = Object.entries(longMem.preferences || {})
      .slice(0, 6)
      .map(([key, value]) => '- Preference: ' + key + ' = ' + value);

    return [...similarShort, ...similarPatterns, ...topSites, ...prefLines].join('\n');
  } catch (_) {
    return '';
  }
}

async function buildRuntimeMemoryContext(goal, currentUrl) {
  const recalled = await retrieveMemoryContext(goal + ' ' + currentUrl);
  const orchestration = buildOrchestrationContext();
  return [recalled, orchestration ? ('--- TAB GRAPH ---\n' + orchestration) : ''].filter(Boolean).join('\n\n');
}

function observeTabVisit(url, title) {
  if (!url || isChromePage(url)) return;
  const domain = trimHost(url);
  if (!domain) return;
  chrome.storage.local.get(['zanysurf_long_memory']).then((stored) => {
    const longMem = stored.zanysurf_long_memory || { preferences: {}, frequentSites: {}, taskPatterns: [] };
    const current = longMem.frequentSites[domain] || { count: 0, lastTitle: '', lastVisited: 0 };
    longMem.frequentSites[domain] = {
      count: current.count + 1,
      lastTitle: (title || '').substring(0, 80),
      lastVisited: Date.now()
    };
    chrome.storage.local.set({ zanysurf_long_memory: longMem }).catch(() => {});
  }).catch(() => {});
}

function learnPreferencesFromGoalAndHistory(goal, history, longMem) {
  const gl = (goal || '').toLowerCase();
  if (gl.includes('amazon') && /price|lowest|cheapest|sort/i.test(gl)) {
    longMem.preferences['amazon.defaultSort'] = 'price-ascending';
  }
  if (gl.includes('github') && /stars|popular/i.test(gl)) {
    longMem.preferences['github.defaultSort'] = 'stars';
  }
  const usedSites = history
    .map(item => trimHost(item.url || item.value || ''))
    .filter(Boolean);
  if (usedSites.length) {
    longMem.preferences['recent.siteAffinity'] = usedSites.slice(-3).join(',');
  }
}

function registerDependencies(tabIds, dependsOn) {
  if (!Array.isArray(tabIds) || !tabIds.length) return;
  if (!dependsOn || !Array.isArray(dependsOn) || !dependsOn.length) {
    for (const tabId of tabIds) {
      if (!tabOrchestrationState.dependencies[tabId]) tabOrchestrationState.dependencies[tabId] = [];
    }
    return;
  }
  const normalizedDeps = dependsOn.map(dep => resolveTargetTabId(dep)).filter(Boolean);
  for (const tabId of tabIds) {
    tabOrchestrationState.dependencies[tabId] = normalizedDeps;
  }
}

function dependenciesMet(tabId) {
  const required = tabOrchestrationState.dependencies[tabId] || [];
  if (!required.length) return true;
  return required.every(depId => {
    const node = tabOrchestrationState.nodes[depId];
    return node && ['extracted', 'done', 'ready', 'active'].includes(node.status);
  });
}

function resolveTargetTabId(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const numeric = Number(raw);
  if (!Number.isNaN(numeric) && tabOrchestrationState.nodes[numeric]) return numeric;

  const value = String(raw).trim().toLowerCase();
  if (value.startsWith('tab-')) {
    const parsed = Number(value.replace('tab-', ''));
    if (!Number.isNaN(parsed) && tabOrchestrationState.nodes[parsed]) return parsed;
  }

  const ids = Object.keys(tabOrchestrationState.nodes).map(Number);
  if (!ids.length) return null;
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= ids.length) {
    return ids[numeric - 1];
  }
  return null;
}

function parseMultiUrls(value) {
  if (Array.isArray(value)) {
    return value
      .map(url => normalizeUrl(url))
      .filter(Boolean);
  }
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) {
    return parsed.map(url => normalizeUrl(url)).filter(Boolean);
  }
  return String(value || '')
    .split(/[\n,|]+/)
    .map(url => normalizeUrl(url.trim()))
    .filter(Boolean);
}

function normalizeUrl(url) {
  if (!url) return '';
  const value = String(url).trim();
  if (!value) return '';
  return value.startsWith('http') ? value : ('https://' + value.replace(/^\/+/, ''));
}

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function buildGmailComposeUrl(raw) {
  const parsed = parseMaybeJson(raw);
  const payload = parsed && typeof parsed === 'object' ? parsed : {};
  const textValue = typeof raw === 'string' && !parsed ? raw : '';
  const to = String(payload.to || payload.recipient || '').trim();
  const subject = String(payload.subject || '').trim();
  const body = String(payload.body || payload.message || textValue || '').trim();
  const qs = new URLSearchParams();
  if (to) qs.set('to', to);
  if (subject) qs.set('su', subject);
  if (body) qs.set('body', body);
  const suffix = qs.toString();
  return 'https://mail.google.com/mail/u/0/?view=cm&fs=1&tf=1' + (suffix ? ('&' + suffix) : '');
}

function buildCalendarCreateUrl(raw) {
  const parsed = parseMaybeJson(raw);
  const payload = parsed && typeof parsed === 'object' ? parsed : {};
  const textValue = typeof raw === 'string' && !parsed ? raw : '';
  const title = String(payload.title || payload.event || payload.summary || 'Scheduled task').trim();
  const details = String(payload.details || payload.description || textValue || '').trim();
  const location = String(payload.location || '').trim();
  const dates = String(payload.dates || payload.when || '').trim();
  const qs = new URLSearchParams();
  qs.set('action', 'TEMPLATE');
  qs.set('text', title || 'Scheduled task');
  if (details) qs.set('details', details);
  if (location) qs.set('location', location);
  if (dates) qs.set('dates', dates);
  return 'https://calendar.google.com/calendar/u/0/r/eventedit?' + qs.toString();
}

function buildOrchestrationContext() {
  const ids = Object.keys(tabOrchestrationState.nodes);
  if (!ids.length) return '';
  return ids.map((id) => {
    const node = tabOrchestrationState.nodes[id] || {};
    const deps = tabOrchestrationState.dependencies[id] || [];
    const depText = deps.length ? (' depends_on=' + deps.join('|')) : '';
    return '- tab ' + id + ': ' + (node.status || 'opened') + ' ' + (trimHost(node.url || '') || '') + depText;
  }).join('\n');
}

async function synthesizeExtractedData(goal, extractedByTab, settings) {
  const entries = Object.values(extractedByTab || {});
  if (!entries.length) throw new Error('No extracted data to synthesize');

  const compact = entries.map(entry => ({
    tabId: entry.tabId,
    url: entry.url,
    title: entry.title,
    prices: (entry.data?.prices || []).slice(0, 10),
    names: (entry.data?.names || []).slice(0, 10),
    emails: (entry.data?.emails || []).slice(0, 10),
    rows: (entry.data?.tables || []).reduce((count, table) => count + ((table.rows || []).length), 0)
  }));

  const prompt = 'Synthesize this extracted data for the user goal: ' + goal + '\n\n' +
    'Return concise plain text with key comparisons and best match.\n\n' +
    JSON.stringify(compact, null, 2);

  try {
    const result = await LLMGateway.callText(prompt, settings.provider, settings.model, settings, { mode: 'summary' });
    return result || buildFallbackSynthesis(compact);
  } catch (_) {
    return buildFallbackSynthesis(compact);
  }
}

async function callOllamaSummary(prompt, settings) {
  const baseUrl = (settings.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
  const model = (settings.ollamaModel || 'llama3').trim();
  const response = await fetchWithTimeout(baseUrl + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0.2, num_predict: 500 } })
  }, 18000);
  if (!response.ok) return '';
  const data = await response.json();
  return (data?.response || '').trim();
}

async function callGeminiSummary(prompt, settings) {
  const key = settings.apiKey;
  if (!key) return '';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + key;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'text/plain', temperature: 0.2, maxOutputTokens: 500 }
    })
  });
  if (!response.ok) return '';
  const data = await response.json();
  return (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

function buildFallbackSynthesis(compact) {
  const lines = ['Compared ' + compact.length + ' sources:'];
  for (const item of compact) {
    lines.push('- ' + (trimHost(item.url || '') || ('tab ' + item.tabId)) + ': ' +
      (item.prices[0] || item.names[0] || ('rows=' + item.rows)));
  }
  return lines.join('\n');
}

function buildCsvFromExtraction(extractedByTab) {
  const entries = Object.values(extractedByTab || {});
  if (!entries.length) return '';

  const rows = [['tabId', 'site', 'title', 'name', 'price', 'email', 'tableRow']];
  for (const entry of entries) {
    const site = trimHost(entry.url || '');
    const names = entry.data?.names || [];
    const prices = entry.data?.prices || [];
    const emails = entry.data?.emails || [];
    const tableRows = (entry.data?.tables || []).flatMap(table => table.rows || []);
    const maxLen = Math.max(names.length, prices.length, emails.length, tableRows.length, 1);

    for (let index = 0; index < maxLen; index++) {
      rows.push([
        String(entry.tabId),
        site,
        entry.title || '',
        names[index] || '',
        prices[index] || '',
        emails[index] || '',
        Array.isArray(tableRows[index]) ? tableRows[index].join(' | ') : (tableRows[index] || '')
      ]);
    }
  }

  return rows.map(columns => columns.map(csvEscape).join(',')).join('\n');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

async function attemptClipboardWrite(tabId, text) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (payload) => {
        try {
          await navigator.clipboard.writeText(payload);
          return true;
        } catch (_) {
          return false;
        }
      },
      args: [text]
    });
    return !!(result && result[0] && result[0].result);
  } catch (_) {
    return false;
  }
}

function trimHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

async function getMemorySummary() {
  const stored = await chrome.storage.local.get(['zanysurf_short_memory', 'zanysurf_long_memory']);
  const shortMem = stored.zanysurf_short_memory || [];
  const longMem = stored.zanysurf_long_memory || { preferences: {}, frequentSites: {}, taskPatterns: [] };
  return {
    shortTermEntries: shortMem.length,
    longTermPreferences: Object.keys(longMem.preferences || {}).length,
    frequentSites: Object.keys(longMem.frequentSites || {}).length,
    learnedPatterns: (longMem.taskPatterns || []).length
  };
}

async function exportLatestCsv() {
  const stored = await chrome.storage.local.get(['zanysurf_last_export_csv']);
  const csv = stored.zanysurf_last_export_csv || '';
  if (!csv) return { success: false, error: 'No CSV data available in memory.' };
  try {
    await chrome.downloads.download({
      url: 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv),
      filename: 'zanysurf-export-' + Date.now() + '.csv',
      saveAs: true
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// =============================================================================
// HUMAN-IN-THE-LOOP SAFETY
// =============================================================================
const RISK_LEVELS = {
  LOW: new Set(['navigate', 'scroll', 'click', 'hover', 'wait', 'open_tabs', 'wait_tab', 'activate_tab', 'shortcut', 'context_click', 'exit_iframe', 'open_gmail_compose', 'schedule_calendar']),
  MEDIUM: new Set(['type', 'select', 'key', 'extract_data', 'extract_text', 'inspect_form', 'drag_drop', 'enter_iframe', 'compose_email', 'book_slot', 'bridge_extension', 'login_saved']),
  HIGH: new Set(['fill_form', 'click_coords', 'copy_clipboard', 'export_csv', 'upload_file', 'execute_js']),
  CRITICAL: new Set(['submit', 'purchase', 'delete', 'send_email', 'post'])
};

function assessRisk(action, context = {}) {
  const actionName = String(action?.action || '').toLowerCase();
  const thought = String(action?.thought || '').toLowerCase();
  const value = String(action?.value || '').toLowerCase();

  if (RISK_LEVELS.CRITICAL.has(actionName)) return 'CRITICAL';
  if (RISK_LEVELS.HIGH.has(actionName)) return 'HIGH';
  if (RISK_LEVELS.MEDIUM.has(actionName)) return 'MEDIUM';
  if (RISK_LEVELS.LOW.has(actionName)) {
    if (actionName === 'click' && /(buy|purchase|checkout|place order|delete|remove|send)/i.test(thought + ' ' + value)) {
      return 'CRITICAL';
    }
    return 'LOW';
  }
  return 'MEDIUM';
}

async function executeWithRiskCheck(action, context) {
  if (activeRunContext.silent) {
    return { allowed: true };
  }

  const risk = assessRisk(action, context);

  if (risk === 'CRITICAL') {
    const approved = await requestHumanApproval({
      action,
      context,
      message: "I'm about to " + (action.thought || action.action) + '. This may be irreversible. Proceed?'
    });
    if (!approved) return { allowed: false, reason: 'User declined critical action.' };
  }

  if (risk === 'HIGH') {
    broadcast({ action: 'AGENT_WARNING', message: 'High-risk action in 3s: ' + (action.thought || action.action) });
    await sleep(3000);
    if (agentAbort) return { allowed: false, reason: 'Action cancelled.' };
  }

  return { allowed: true };
}

async function requestHumanApproval(payload) {
  const requestId = crypto.randomUUID();
  const preview = await captureScreenshotForApproval();
  broadcast({
    action: 'APPROVAL_REQUEST',
    requestId,
    payload,
    preview,
    ts: Date.now()
  });

  return new Promise((resolve) => {
    pendingApprovals.set(requestId, resolve);
    setTimeout(() => {
      if (pendingApprovals.has(requestId)) {
        pendingApprovals.delete(requestId);
        resolve(false);
      }
    }, 45000);
  });
}

async function captureScreenshotForApproval() {
  try {
    return await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 55 });
  } catch (_) {
    return null;
  }
}

// =============================================================================
// WORKFLOWS (RECORD + REPLAY)
// =============================================================================
async function saveWorkflow(goal, steps, result) {
  if (!result?.success) return null;

  const workflow = {
    id: crypto.randomUUID(),
    goal,
    steps: (steps || [])
      .filter(step => step.success)
      .map(step => ({
        action: step.action,
        value: step.value,
        urlPattern: trimHost(step.url || ''),
        element_id: step.element_id,
        thought: step.thought,
        expectedText: String(step.value || '').substring(0, 60)
      })),
    createdAt: Date.now(),
    runCount: 0,
    avgDuration: result.duration || 0,
    tags: extractTagsLocal(goal),
    shareCode: 'ZW-' + String(Math.floor(Math.random() * 9000) + 1000)
  };

  if (!workflow.steps.length) return null;

  const stored = await chrome.storage.local.get(['zanysurf_workflows']);
  const workflows = stored.zanysurf_workflows || [];
  workflows.unshift(workflow);
  await chrome.storage.local.set({ zanysurf_workflows: workflows.slice(0, 80) });
  return workflow;
}

async function listWorkflows() {
  const stored = await chrome.storage.local.get(['zanysurf_workflows']);
  return stored.zanysurf_workflows || [];
}

async function replayWorkflow(workflowId) {
  const workflows = await listWorkflows();
  const workflow = workflows.find(item => item.id === workflowId);
  if (!workflow) throw new Error('Workflow not found.');

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) throw new Error('No active tab found.');

  for (const step of workflow.steps) {
    if (step.action === 'navigate') {
      await chrome.tabs.update(tab.id, { url: normalizeUrl(step.value || '') });
      await waitForTabReady(tab.id);
      continue;
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
    await sleep(250);
    await chrome.tabs.sendMessage(tab.id, {
      action: 'EXECUTE',
      command: {
        action: step.action,
        value: step.value,
        element_id: step.element_id
      }
    }).catch(() => {});
    await sleep(500);
  }

  workflow.runCount = (workflow.runCount || 0) + 1;
  await chrome.storage.local.set({
    zanysurf_workflows: workflows.map(item => item.id === workflow.id ? workflow : item)
  });

  return { success: true, message: 'Workflow replayed.', runCount: workflow.runCount };
}

// =============================================================================
// SMART BOOKMARKS
// =============================================================================
const SmartBookmarks = {
  storageKey: 'zanysurf_smart_bookmarks',

  async save(name, url, context = '') {
    const bookmark = {
      id: crypto.randomUUID(),
      name,
      url,
      tags: extractTagsLocal(name + ' ' + url + ' ' + context),
      visitCount: 0,
      lastVisited: null
    };
    const bookmarks = await this.list();
    bookmarks.unshift(bookmark);
    await chrome.storage.local.set({ [this.storageKey]: bookmarks.slice(0, 200) });
    return bookmark;
  },

  async list() {
    const stored = await chrome.storage.local.get([this.storageKey]);
    return stored[this.storageKey] || [];
  },

  async find(query) {
    const bookmarks = await this.list();
    if (!bookmarks.length) return null;
    const queryVec = vectorizeText(query);
    const scored = bookmarks.map(bookmark => {
      const text = bookmark.name + ' ' + (bookmark.tags || []).join(' ') + ' ' + bookmark.url;
      return {
        bookmark,
        score: cosineSimilarity(queryVec, vectorizeText(text)) + ((bookmark.visitCount || 0) * 0.01)
      };
    }).sort((a, b) => b.score - a.score);

    return scored[0]?.score > 0.2 ? scored[0].bookmark : null;
  },

  async touch(bookmarkId) {
    const bookmarks = await this.list();
    const updated = bookmarks.map(bookmark => {
      if (bookmark.id !== bookmarkId) return bookmark;
      return {
        ...bookmark,
        visitCount: (bookmark.visitCount || 0) + 1,
        lastVisited: Date.now()
      };
    });
    await chrome.storage.local.set({ [this.storageKey]: updated });
  },

  async deleteById(bookmarkId) {
    const bookmarks = await this.list();
    const updated = bookmarks.filter(bookmark => bookmark.id !== bookmarkId);
    await chrome.storage.local.set({ [this.storageKey]: updated });
  }
};

// =============================================================================
// PERSONALIZATION ENGINE
// =============================================================================
const PersonalizationEngine = {
  async observe(goal, steps, result) {
    const pattern = {
      goal,
      goalEmbedding: vectorizeText(goal),
      timeOfDay: new Date().getHours(),
      dayOfWeek: new Date().getDay(),
      sites: [...new Set((steps || []).map(step => trimHost(step.url || '')).filter(Boolean))],
      duration: result.duration || 0,
      success: !!result.success,
      ts: Date.now()
    };

    const stored = await chrome.storage.local.get(['zanysurf_patterns']);
    const patterns = stored.zanysurf_patterns || [];
    patterns.unshift(pattern);
    await chrome.storage.local.set({ zanysurf_patterns: patterns.slice(0, 200) });
    await this.detectRepetition(patterns.slice(0, 40));
  },

  async detectRepetition(recentPatterns) {
    const clusters = clusterBySimilarity(recentPatterns || []);
    for (const cluster of clusters) {
      if (cluster.count >= 3) {
        await this.suggestAutomation(cluster);
      }
    }
  },

  async suggestAutomation(cluster) {
    const suggestion = {
      suggestion: 'You repeat this task often. Schedule it daily?',
      schedule: 'daily@9am',
      goal: cluster.sampleGoal
    };
    broadcast({ action: 'SUGGEST_AUTOMATION', ...suggestion });
  }
};

function clusterBySimilarity(patterns) {
  const clusters = [];
  for (const pattern of patterns) {
    let assigned = false;
    for (const cluster of clusters) {
      const score = cosineSimilarity(pattern.goalEmbedding || [], cluster.embedding || []);
      if (score > 0.72) {
        cluster.count++;
        cluster.goals.push(pattern.goal);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      clusters.push({
        count: 1,
        embedding: pattern.goalEmbedding,
        goals: [pattern.goal],
        sampleGoal: pattern.goal,
        avgTime: pattern.timeOfDay + ':00'
      });
    }
  }
  return clusters;
}

function extractTagsLocal(text) {
  return [...new Set(tokenizeText(text))].slice(0, 12);
}

// =============================================================================
// UTILITIES
// =============================================================================
function isChromePage(url) {
  return !url || url === '' ||
    url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
    url.startsWith('about:') || url.startsWith('edge://') || url.startsWith('brave://') ||
    url === 'chrome://newtab/';
}

function countDomElements(domMap) {
  if (!domMap || domMap === 'EMPTY' || domMap === 'UNMAPPABLE') return 0;
  return (domMap.match(/^\[\d+\]/gm) || []).length;
}

function broadcast(msg) {
  const payload = { ...msg, _ts: Date.now() };
  recentEvents.push(payload);
  if (recentEvents.length > 500) recentEvents.shift();
  chrome.runtime.sendMessage(payload).catch(() => {});
}

async function captureAndBroadcast(tabId, step) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 55 });
    broadcast({ action: 'AGENT_SCREENSHOT', step, dataUrl });
  } catch (_) { /* captureVisibleTab may fail on some pages */ }
}

async function saveTaskHistory(goal, steps, success) {
  try {
    const stored = await chrome.storage.local.get(['taskHistory', 'zanysurf_short_memory', 'zanysurf_long_memory']);
    const history = stored.taskHistory || [];
    history.unshift({
      goal: goal.substring(0, 120),
      steps,
      success,
      ts: Date.now()
    });

    const shortMemoryStored = stored.zanysurf_short_memory || [];
    const mergedShort = [...sessionMemory, ...shortMemoryStored].slice(0, 180);

    const longMemory = stored.zanysurf_long_memory || { preferences: {}, frequentSites: {}, taskPatterns: [] };
    learnPreferencesFromGoalAndHistory(goal, actionHistory, longMemory);
    const summary = success
      ? 'Completed: ' + goal.substring(0, 90) + ' in ' + steps + ' steps'
      : 'Attempted: ' + goal.substring(0, 90) + ' (' + steps + ' steps, not completed)';
    longMemory.taskPatterns = longMemory.taskPatterns || [];
    longMemory.taskPatterns.unshift({
      summary,
      success,
      steps,
      ts: Date.now(),
      vector: vectorizeText(summary + ' ' + goal)
    });
    longMemory.taskPatterns = longMemory.taskPatterns.slice(0, 80);

    await chrome.storage.local.set({
      taskHistory: history.slice(0, 50),
      zanysurf_short_memory: mergedShort,
      zanysurf_long_memory: longMemory
    });

    // Also persist to MemorySystem v2 for vector retrieval
    const visitedSites = actionHistory
      .map(h => { try { return new URL(h.url || h.value || '').hostname; } catch (_) { return ''; } })
      .filter(Boolean);
    memorySystem.addShortTerm({
      goal: goal.substring(0, 200),
      result: summary,
      sites: [...new Set(visitedSites)],
      timestamp: Date.now()
    });
    await memorySystem.promoteEligible();
  } catch (_) {}
}

async function appendAuditLog(entry) {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.AUDIT]);
    const log = stored[STORAGE_KEYS.AUDIT] || [];
    const record = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      runId: currentAgentRunId,
      ...entry
    };
    log.push(record);
    await chrome.storage.local.set({ [STORAGE_KEYS.AUDIT]: log.slice(-5000) });
  } catch (_) {}
}

async function exportAuditLog() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.AUDIT]);
  const log = stored[STORAGE_KEYS.AUDIT] || [];
  const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({
    url,
    filename: 'zanysurf/audit-log-' + Date.now() + '.json',
    saveAs: true
  });
  return { success: true, count: log.length };
}

async function buildAgentDashboardSummary() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.AUDIT,
    STORAGE_KEYS.QUICK_RUNS,
    STORAGE_KEYS.API_METRICS,
    STORAGE_KEYS.SAFE_MODE,
    'zanysurf_short_memory',
    'zanysurf_workflows',
    'zanysurf_smart_bookmarks'
  ]);
  const audit = stored[STORAGE_KEYS.AUDIT] || [];
  const successCount = audit.filter(item => item.kind === 'action' && item.success).length;
  const totalActions = audit.filter(item => item.kind === 'action').length;
  const successRate = totalActions ? Math.round((successCount / totalActions) * 100) : 100;

  const tasks = await SchedulerEngine.listTasks().catch(() => []);
  return {
    active: agentActive,
    runId: currentAgentRunId,
    now: Date.now(),
    todayScheduled: tasks.filter(task => task.enabled).slice(0, 8),
    memoryStats: {
      memories: (stored.zanysurf_short_memory || []).length,
      workflows: (stored.zanysurf_workflows || []).length,
      bookmarks: (stored.zanysurf_smart_bookmarks || []).length
    },
    quickRuns: (stored[STORAGE_KEYS.QUICK_RUNS] || []).slice(0, 5),
    health: {
      successRate,
      llmCalls: (stored[STORAGE_KEYS.API_METRICS]?.calls || 0),
      estimatedCostUsd: Number((stored[STORAGE_KEYS.API_METRICS]?.estimatedCostUsd || 0).toFixed(4)),
      safeMode: !!stored[STORAGE_KEYS.SAFE_MODE]
    }
  };
}

async function saveQuickRunGoal(goal) {
  const value = String(goal || '').trim();
  if (!value) return [];
  const stored = await chrome.storage.local.get([STORAGE_KEYS.QUICK_RUNS]);
  const items = stored[STORAGE_KEYS.QUICK_RUNS] || [];
  const filtered = items.filter(item => item.goal !== value);
  filtered.unshift({ goal: value, ts: Date.now() });
  await chrome.storage.local.set({ [STORAGE_KEYS.QUICK_RUNS]: filtered.slice(0, 20) });
  return filtered.slice(0, 20);
}

async function listQuickRuns() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.QUICK_RUNS]);
  return stored[STORAGE_KEYS.QUICK_RUNS] || [];
}

async function setUserProfile(profile) {
  const merged = {
    name: String(profile.name || ''),
    email: String(profile.email || ''),
    address: String(profile.address || ''),
    tone: String(profile.tone || 'formal'),
    bookingPreference: String(profile.bookingPreference || 'morning')
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.PROFILE]: merged });
  return merged;
}

async function getUserProfile() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.PROFILE]);
  return stored[STORAGE_KEYS.PROFILE] || { tone: 'formal', bookingPreference: 'morning' };
}

async function setExtensionBridges(bridges) {
  const normalized = (Array.isArray(bridges) ? bridges : [])
    .map(item => ({
      name: String(item.name || '').trim(),
      extensionId: String(item.extensionId || '').trim(),
      enabled: item.enabled !== false
    }))
    .filter(item => item.name && item.extensionId)
    .slice(0, 20);
  await chrome.storage.local.set({ [STORAGE_KEYS.BRIDGES]: normalized });
  return normalized;
}

async function listExtensionBridges() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.BRIDGES]);
  const existing = stored[STORAGE_KEYS.BRIDGES];
  if (Array.isArray(existing) && existing.length) return existing;
  const defaults = [
    { name: '1Password', extensionId: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa', enabled: false },
    { name: 'Grammarly', extensionId: 'kbfnbcaeplbcioakkpcpgfkobkghlhen', enabled: false },
    { name: 'uBlock Origin', extensionId: 'cjpalhdlnbpafiamejdnhcphjbkeiagm', enabled: false }
  ];
  await chrome.storage.local.set({ [STORAGE_KEYS.BRIDGES]: defaults });
  return defaults;
}

async function bridgeMessage(name, payload = {}) {
  const bridges = await listExtensionBridges();
  const target = bridges.find(item => item.enabled && item.name.toLowerCase() === String(name || '').toLowerCase());
  if (!target) return { success: false, message: 'Bridge not enabled for ' + name };
  try {
    const response = await chrome.runtime.sendMessage(target.extensionId, payload);
    return { success: true, response };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function toggleSafeMode(enabled) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SAFE_MODE]: !!enabled });
  return !!enabled;
}

async function getSafeMode() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.SAFE_MODE]);
  return !!stored[STORAGE_KEYS.SAFE_MODE];
}

async function ensureSafeExecutionWindow() {
  const safeMode = await getSafeMode();
  if (!safeMode) return null;
  const windowRef = await chrome.windows.create({ url: 'about:blank', focused: false, type: 'normal' });
  return windowRef;
}

async function persistSessionState(state) {
  const payload = {
    ts: Date.now(),
    active: !!agentActive,
    runId: currentAgentRunId,
    lastGoal: String(state.prompt || ''),
    completed: !!state.completed,
    error: state.error || null,
    lastUrl: actionHistory[actionHistory.length - 1]?.url || null,
    extracted: tabOrchestrationState.extracted || {}
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_SESSION]: payload });
}

async function detectGoalContinuation(goal) {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.LAST_SESSION]);
  const last = stored[STORAGE_KEYS.LAST_SESSION];
  if (!last || !last.lastGoal) return { isContinuation: false };
  const similarity = cosineSimilarity(vectorizeText(goal), vectorizeText(last.lastGoal));
  return {
    isContinuation: similarity > 0.42 || /continue|resume|again/i.test(goal),
    similarity,
    lastUrl: last.lastUrl,
    state: last
  };
}

function classifyAgentError(error) {
  const message = String(error?.message || 'Unknown agent error');
  const lowered = message.toLowerCase();
  if (/network|fetch|failed to fetch|timeout/.test(lowered)) {
    return { type: 'network', message: 'Network issue detected. Retrying with backoff may help.' };
  }
  if (/dom|element|not found|unmappable/.test(lowered)) {
    return { type: 'dom', message: 'Page structure issue detected. Switched to vision/alternative mode.' };
  }
  if (/api key|llm|gemini|ollama|model/.test(lowered)) {
    return { type: 'llm', message: 'Model provider issue detected. Check provider settings or fallback provider.' };
  }
  if (/permission|not allowed|denied|cannot access|chrome:\/\//.test(lowered)) {
    return { type: 'permission', message: 'Permission issue detected. Please reload extension and verify permissions.' };
  }
  return { type: 'timeout', message: 'Task interrupted unexpectedly. Please retry with a narrower goal.' };
}

function extractResearchUrls(goal) {
  const explicit = String(goal || '').match(/https?:\/\/[^\s]+/g) || [];
  if (explicit.length) return explicit.slice(0, 4);
  const g = encodeURIComponent(goal || 'latest updates');
  return [
    'https://www.google.com/search?q=' + g,
    'https://www.bing.com/search?q=' + g,
    'https://duckduckgo.com/?q=' + g,
    'https://news.ycombinator.com'
  ];
}

function scoreDomainCredibility(url) {
  const host = trimHost(url || '');
  if (!host) return 0.4;
  if (/\.gov$|\.edu$|wikipedia\.org$|github\.com$|stackoverflow\.com$/.test(host)) return 0.9;
  if (/\.org$|reuters\.com$|bbc\.com$|nytimes\.com$/.test(host)) return 0.82;
  if (/medium\.com$|substack\.com$/.test(host)) return 0.65;
  return 0.55;
}

function collectFactsFromResearchItem(item) {
  const facts = [];
  if (item.text) {
    const chunks = item.text.split(/[.\n]/).map(value => value.trim()).filter(Boolean).slice(0, 18);
    chunks.forEach(chunk => facts.push(chunk));
  }
  const names = item.extract?.names || [];
  const prices = item.extract?.prices || [];
  names.slice(0, 8).forEach(name => facts.push('Name: ' + name));
  prices.slice(0, 8).forEach(price => facts.push('Price: ' + price));
  return facts;
}

function dedupeFacts(facts) {
  const seen = new Set();
  const out = [];
  for (const fact of (facts || [])) {
    const key = String(fact || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(fact).substring(0, 240));
    if (out.length >= 80) break;
  }
  return out;
}

function detectContradictionsFromClaims(claims = []) {
  const contradictions = [];
  const normalized = claims.map(item => String(item || '').toLowerCase());
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i];
      const b = normalized[j];
      if ((a.includes('not') && !b.includes('not')) || (!a.includes('not') && b.includes('not'))) {
        if (tokenOverlap(a, b) > 0.45) {
          contradictions.push({ a: claims[i], b: claims[j], reason: 'Polarity mismatch around similar statement.' });
          if (contradictions.length >= 8) return contradictions;
        }
      }
    }
  }
  return contradictions;
}

function tokenOverlap(a, b) {
  const aa = new Set(tokenizeText(a));
  const bb = new Set(tokenizeText(b));
  const union = new Set([...aa, ...bb]);
  let common = 0;
  aa.forEach(token => { if (bb.has(token)) common++; });
  return union.size ? (common / union.size) : 0;
}

function inferWriterDestination(goal) {
  const text = String(goal || '').toLowerCase();
  if (text.includes('notion')) return 'https://www.notion.so';
  if (text.includes('docs') || text.includes('google doc')) return 'https://docs.google.com/document/u/0/';
  return 'https://docs.new';
}

function buildStructuredWriteContent(analysis = {}, research = {}) {
  const lines = [];
  lines.push('# Agent Report');
  lines.push('');
  lines.push('## Summary');
  lines.push(analysis.summary || 'No summary generated.');
  lines.push('');
  lines.push('## Claims');
  (analysis.claims || []).slice(0, 10).forEach((claim, index) => {
    lines.push((index + 1) + '. ' + claim.text + ' (confidence ' + claim.confidence + ')');
  });
  lines.push('');
  lines.push('## Sources');
  (research.sources || []).slice(0, 10).forEach((source, index) => {
    lines.push('- [' + (index + 1) + '] ' + source.url + ' (credibility ' + source.credibility + ')');
  });
  return lines.join('\n');
}

function splitMarkdownSections(content) {
  const chunks = String(content || '').split(/\n##\s+/g).map((chunk, index) => ({
    heading: index === 0 ? 'Intro' : chunk.split('\n')[0],
    plain: chunk.replace(/^#\s+/gm, '').replace(/^##\s+/gm, '').replace(/\*\*/g, '').trim()
  })).filter(item => item.plain);
  return chunks.length ? chunks : [{ heading: 'Content', plain: String(content || '') }];
}

async function generateStepReplayHtml() {
  const steps = actionHistory || [];
  const rows = steps.map((step, index) => '<tr><td>' + (index + 1) + '</td><td>' + escHtml(step.thought || '') + '</td><td>' + escHtml(step.action || '') + '</td><td>' + escHtml(step.success ? '✓' : '✗') + '</td></tr>').join('');
  return '<!doctype html><html><head><meta charset="utf-8"><title>ZANYSURF Replay</title><style>body{font-family:system-ui;background:#0a0a12;color:#e5e7eb;padding:20px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #1f2937;padding:8px}th{background:#111827}</style></head><body><h1>Step Replay</h1><table><thead><tr><th>#</th><th>Thought</th><th>Action</th><th>Result</th></tr></thead><tbody>' + rows + '</tbody></table></body></html>';
}

function escHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function getKnowledgeGraph() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.GRAPH]);
  return stored[STORAGE_KEYS.GRAPH] || { nodes: {}, edges: {} };
}

async function upsertKnowledgeGraph(extracted = {}) {
  const graph = await getKnowledgeGraph();
  const nodes = graph.nodes || {};
  const edges = graph.edges || {};

  (extracted.names || []).slice(0, 20).forEach((name) => {
    const personId = 'person:' + name.toLowerCase();
    nodes[personId] = { id: personId, label: name, type: 'Person' };
    (extracted.emails || []).slice(0, 3).forEach((email) => {
      const emailId = 'email:' + email.toLowerCase();
      nodes[emailId] = { id: emailId, label: email, type: 'Contact' };
      edges[personId + '->' + emailId] = { from: personId, to: emailId, relation: 'hasContact' };
    });
  });

  (extracted.prices || []).slice(0, 20).forEach((price, index) => {
    const productId = 'product:' + index + ':' + String(price).toLowerCase();
    const priceId = 'price:' + String(price).toLowerCase();
    nodes[productId] = { id: productId, label: 'Product ' + (index + 1), type: 'Product' };
    nodes[priceId] = { id: priceId, label: price, type: 'Price' };
    edges[productId + '->' + priceId] = { from: productId, to: priceId, relation: 'hasPrice' };
  });

  await chrome.storage.local.set({ [STORAGE_KEYS.GRAPH]: { nodes, edges } });
}

async function unlockCredentialVault(passphrase) {
  const value = String(passphrase || '').trim();
  if (!value || value.length < 8) {
    throw new Error('Master passphrase must be at least 8 characters.');
  }
  credentialVaultSessionPassphrase = value;
  await ensureCredentialVaultInitialized();
  return { success: true };
}

async function ensureCredentialVaultInitialized() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.CREDENTIAL_VAULT]);
  const vault = stored[STORAGE_KEYS.CREDENTIAL_VAULT];
  if (vault && vault.version === 1 && vault.salt) {
    if (!vault.providerKeys) {
      const upgraded = { ...vault, providerKeys: {} };
      await chrome.storage.local.set({ [STORAGE_KEYS.CREDENTIAL_VAULT]: upgraded });
      return upgraded;
    }
    return vault;
  }
  const initialized = {
    version: 1,
    salt: toBase64(randomBytes(16)),
    entries: [],
    providerKeys: {}
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.CREDENTIAL_VAULT]: initialized });
  return initialized;
}

function lockCredentialVault() {
  credentialVaultSessionPassphrase = null;
}

function providerToVaultField(provider) {
  const normalized = String(provider || '').toLowerCase();
  const map = {
    gemini: 'geminiKey',
    openai: 'openaiKey',
    claude: 'claudeKey',
    groq: 'groqKey',
    mistral: 'mistralKey'
  };
  return map[normalized] || '';
}

async function loadProviderApiKeys() {
  const vault = await ensureCredentialVaultInitialized();
  const encryptedMap = vault.providerKeys || {};
  if (!credentialVaultSessionPassphrase) return {};
  const key = await deriveVaultKey(credentialVaultSessionPassphrase, fromBase64(vault.salt));
  const result = {};
  for (const [provider, encrypted] of Object.entries(encryptedMap)) {
    try {
      result[provider] = await decryptStringAesGcm(encrypted, key);
    } catch (_) {}
  }
  return result;
}

async function storeProviderApiKey(provider, plainKey, passphrase) {
  const normalized = String(provider || '').toLowerCase();
  if (!providerToVaultField(normalized)) throw new Error('Provider does not require cloud API key.');
  const value = String(plainKey || '').trim();
  if (!value) throw new Error('API key is empty.');

  const master = String(passphrase || credentialVaultSessionPassphrase || '').trim();
  if (!master) throw new Error('Vault is locked. Unlock first.');

  const vault = await ensureCredentialVaultInitialized();
  const key = await deriveVaultKey(master, fromBase64(vault.salt));
  const encrypted = await encryptStringAesGcm(value, key);
  const providerKeys = { ...(vault.providerKeys || {}), [normalized]: encrypted };
  await chrome.storage.local.set({ [STORAGE_KEYS.CREDENTIAL_VAULT]: { ...vault, providerKeys } });
  credentialVaultSessionPassphrase = master;
  await appendAuditLog({ kind: 'provider_key_save', provider: normalized });
}

async function saveCredentialEntry({ site, username, password, passphrase, notes }) {
  const normalizedSite = normalizeCredentialSite(site);
  if (!normalizedSite) throw new Error('Valid site/domain is required.');
  const user = String(username || '').trim();
  const pass = String(password || '');
  if (!user || !pass) throw new Error('Username and password are required.');

  const master = String(passphrase || credentialVaultSessionPassphrase || '').trim();
  if (!master) throw new Error('Unlock vault first or provide passphrase.');

  const vault = await ensureCredentialVaultInitialized();
  const key = await deriveVaultKey(master, fromBase64(vault.salt));
  const payload = JSON.stringify({ username: user, password: pass, notes: String(notes || '') });
  const encrypted = await encryptStringAesGcm(payload, key);

  const entry = {
    id: crypto.randomUUID(),
    site: normalizedSite,
    usernameMask: maskUsername(user),
    cipher: encrypted.cipher,
    iv: encrypted.iv,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastUsed: null
  };

  const entries = (vault.entries || []).filter(item => !(item.site === normalizedSite && item.usernameMask === maskUsername(user)));
  entries.unshift(entry);
  await chrome.storage.local.set({ [STORAGE_KEYS.CREDENTIAL_VAULT]: { ...vault, entries: entries.slice(0, 120) } });
  await appendAuditLog({ kind: 'credential_save', site: normalizedSite, usernameMask: entry.usernameMask });
  credentialVaultSessionPassphrase = master;
  return redactCredentialEntry(entry);
}

async function listCredentialEntries() {
  const vault = await ensureCredentialVaultInitialized();
  return (vault.entries || []).map(redactCredentialEntry);
}

async function deleteCredentialEntry(id) {
  const vault = await ensureCredentialVaultInitialized();
  const entries = (vault.entries || []).filter(item => item.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.CREDENTIAL_VAULT]: { ...vault, entries } });
  await appendAuditLog({ kind: 'credential_delete', credentialId: id });
}

async function loginWithSavedCredential({ credentialId, site, passphrase, tabId }) {
  const vault = await ensureCredentialVaultInitialized();
  const entry = selectCredentialEntry(vault.entries || [], credentialId, site);
  if (!entry) throw new Error('No saved credential found for this site.');

  const master = String(passphrase || credentialVaultSessionPassphrase || '').trim();
  if (!master) throw new Error('Vault is locked. Provide passphrase to login.');

  const key = await deriveVaultKey(master, fromBase64(vault.salt));
  let decrypted;
  try {
    decrypted = await decryptStringAesGcm({ cipher: entry.cipher, iv: entry.iv }, key);
  } catch (_) {
    throw new Error('Incorrect passphrase or vault data is invalid.');
  }
  const creds = parseMaybeJson(decrypted) || {};
  if (!creds.username || !creds.password) throw new Error('Saved credential is incomplete.');

  const targetTabId = tabId || (await getActiveTabId());
  if (!targetTabId) throw new Error('No active tab found for login.');

  await chrome.scripting.executeScript({ target: { tabId: targetTabId }, files: ['content.js'] }).catch(() => {});
  await chrome.tabs.sendMessage(targetTabId, {
    action: 'EXECUTE',
    command: {
      action: 'fill_form',
      value: JSON.stringify({
        username: creds.username,
        email: creds.username,
        login: creds.username,
        user: creds.username,
        password: creds.password,
        pass: creds.password
      })
    }
  }).catch(() => {});

  await chrome.tabs.sendMessage(targetTabId, {
    action: 'EXECUTE',
    command: {
      action: 'key',
      value: 'Enter'
    }
  }).catch(() => {});

  await touchCredentialEntry(entry.id);
  await appendAuditLog({ kind: 'credential_login', site: entry.site, credentialId: entry.id, tabId: targetTabId });
  credentialVaultSessionPassphrase = master;
  return { success: true, message: 'Filled login form for ' + entry.site };
}

async function touchCredentialEntry(id) {
  const vault = await ensureCredentialVaultInitialized();
  const entries = (vault.entries || []).map(item => item.id === id ? { ...item, lastUsed: Date.now(), updatedAt: Date.now() } : item);
  await chrome.storage.local.set({ [STORAGE_KEYS.CREDENTIAL_VAULT]: { ...vault, entries } });
}

function normalizeCredentialSite(site) {
  const raw = String(site || '').trim();
  if (!raw) return '';
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).hostname.toLowerCase();
    return new URL('https://' + raw).hostname.toLowerCase();
  } catch (_) {
    return raw.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  }
}

function selectCredentialEntry(entries, credentialId, site) {
  if (credentialId) return entries.find(item => item.id === credentialId) || null;
  const normalized = normalizeCredentialSite(site);
  if (!normalized) return null;
  return entries.find(item => item.site === normalized) || entries.find(item => normalized.endsWith(item.site)) || null;
}

function redactCredentialEntry(entry) {
  return {
    id: entry.id,
    site: entry.site,
    usernameMask: entry.usernameMask,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastUsed: entry.lastUsed
  };
}

function maskUsername(username) {
  const value = String(username || '').trim();
  if (!value) return '***';
  if (value.length <= 2) return value[0] + '*';
  return value[0] + '*'.repeat(Math.max(1, value.length - 2)) + value[value.length - 1];
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  return tabs[0]?.id || null;
}

function randomBytes(size) {
  const array = new Uint8Array(size);
  crypto.getRandomValues(array);
  return array;
}

function toBase64(uint8) {
  let binary = '';
  uint8.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(base64) {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveVaultKey(passphrase, saltBytes) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltBytes,
      iterations: 180000
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptStringAesGcm(plainText, key) {
  const iv = randomBytes(12);
  const data = new TextEncoder().encode(String(plainText || ''));
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return {
    iv: toBase64(iv),
    cipher: toBase64(new Uint8Array(cipherBuffer))
  };
}

async function decryptStringAesGcm(encrypted, key) {
  const iv = fromBase64(String(encrypted.iv || ''));
  const cipher = fromBase64(String(encrypted.cipher || ''));
  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(plainBuffer);
}

async function updateApiMetrics({ provider, promptChars, outputChars }) {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.API_METRICS]);
  const metrics = stored[STORAGE_KEYS.API_METRICS] || {
    calls: 0,
    callsByProvider: { gemini: 0, ollama: 0, edge_builtin: 0 },
    hourly: [],
    estimatedCostUsd: 0,
    ollamaChars: 0
  };

  metrics.calls += 1;
  metrics.callsByProvider[provider] = (metrics.callsByProvider[provider] || 0) + 1;
  metrics.hourly.push(Date.now());
  metrics.hourly = metrics.hourly.filter(ts => Date.now() - ts < (60 * 60 * 1000));

  const totalChars = Number(promptChars || 0) + Number(outputChars || 0);
  if (provider === 'gemini') {
    metrics.estimatedCostUsd += (totalChars / 1_000_000) * 0.35;
  }
  if (provider === 'ollama') {
    metrics.ollamaChars += totalChars;
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.API_METRICS]: metrics });
  if ((metrics.hourly || []).length > 100) {
    broadcast({ action: 'AGENT_WARNING', message: 'Rate limit warning: more than 100 model calls in the last hour.' });
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForTabReady(tabId) {
  return new Promise(resolve => {
    chrome.tabs.get(tabId, tab => {
      if (chrome.runtime.lastError || !tab) { resolve(); return; }
      if (tab.status === 'complete') { resolve(); return; }
      const fn = (id, info) => {
        if (id === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(fn);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(fn);
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, 15000);
    });
  });
}

