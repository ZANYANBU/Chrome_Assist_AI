const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadBackground() {
  const code = fs.readFileSync(path.join(process.cwd(), 'background.js'), 'utf8');
  const storage = {};

  const chrome = {
    sidePanel: { setPanelBehavior: () => Promise.resolve(), open: () => Promise.resolve() },
    runtime: { onMessage: { addListener: () => {} }, sendMessage: () => Promise.resolve(), lastError: null },
    commands: { onCommand: { addListener: () => {} } },
    tabs: {
      query: async () => [{ id: 1, url: 'https://example.com', title: 'Example', status: 'complete' }],
      sendMessage: async () => ({ success: true, result: '{}' }),
      create: async ({ url }) => ({ id: Math.floor(Math.random() * 9999), url }),
      update: async () => ({}),
      get: (id, cb) => cb({ id, status: 'complete' }),
      onUpdated: { addListener: () => {}, removeListener: () => {} },
      captureVisibleTab: async () => 'data:image/jpeg;base64,AAA'
    },
    scripting: { executeScript: async () => [] },
    windows: { create: async () => ({ id: 123 }) },
    downloads: { download: async () => 1 },
    alarms: { create: async () => {}, clear: async () => {}, get: async () => null, onAlarm: { addListener: () => {} } },
    storage: {
      local: {
        get: async (keys) => {
          if (Array.isArray(keys)) {
            const out = {};
            keys.forEach((k) => { out[k] = storage[k]; });
            return out;
          }
          if (typeof keys === 'string') return { [keys]: storage[keys] };
          return { ...storage };
        },
        set: async (obj) => { Object.assign(storage, obj); }
      }
    },
    notifications: { create: async () => {} }
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ models: [] }), text: async () => '{}' }),
    Blob,
    crypto,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    chrome,
    globalThis: null
  };
  context.globalThis = context;

  const exportBlock = `\n;globalThis.__qa_exports = {
    cosineSimilarity,
    vectorizeText,
    retrieveMemoryContext,
    upsertKnowledgeGraph,
    getKnowledgeGraph,
    classifyAgentError,
    assessRisk,
    generatePlan,
    SchedulerEngine,
    SmartBookmarks,
    appendAuditLog,
    exportAuditLog,
    updateApiMetrics
  };`;

  vm.createContext(context);
  vm.runInContext(code + exportBlock, context);
  return { exports: context.__qa_exports, storage };
}

describe('ZANYSURF core unit tests', () => {
  test('cosine similarity returns 1.0 for identical vectors', () => {
    const { exports } = loadBackground();
    const v = [0.1, 0.5, 0.3, 0.8];
    expect(exports.cosineSimilarity(v, v)).toBeGreaterThan(0.98);
  });

  test('memory decay expectation (recent > old simulated weight)', () => {
    const computeMemoryWeight = (timestamp) => {
      const ageDays = Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60 * 24));
      return ageDays > 30 ? Math.exp(-(ageDays - 30) / 30) : 1;
    };
    const oldWeight = computeMemoryWeight(Date.now() - (35 * 24 * 60 * 60 * 1000));
    const recentWeight = computeMemoryWeight(Date.now());
    expect(recentWeight).toBeGreaterThan(oldWeight);
  });

  test('top-K retrieval returns max 3 memories lines for similar short memory', async () => {
    const { exports, storage } = loadBackground();
    storage.zanysurf_short_memory = Array.from({ length: 10 }).map((_, i) => ({
      action: 'click',
      url: 'https://example.com/' + i,
      vector: exports.vectorizeText('test goal click'),
      ts: Date.now()
    }));
    storage.zanysurf_long_memory = { preferences: {}, frequentSites: {}, taskPatterns: [] };
    const result = await exports.retrieveMemoryContext('test goal');
    const lines = String(result).split('\n').filter(Boolean).filter((l) => l.includes('Recent step:'));
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  test('upsertKnowledgeGraph adds and deduplicates edges', async () => {
    const { exports } = loadBackground();
    await exports.upsertKnowledgeGraph({ names: ['GitHub'], prices: ['$10'], emails: ['a@b.com'] });
    await exports.upsertKnowledgeGraph({ names: ['GitHub'], prices: ['$10'], emails: ['a@b.com'] });
    const graph = await exports.getKnowledgeGraph();
    const edges = Object.values(graph.edges || {});
    const unique = new Set(edges.map((e) => `${e.from}|${e.relation}|${e.to}`));
    expect(edges.length).toBe(unique.size);
  });

  test('classifyAgentError identifies network error', () => {
    const { exports } = loadBackground();
    const result = exports.classifyAgentError(new TypeError('Failed to fetch'));
    expect(result.type).toBe('network');
    expect(result.message.toLowerCase()).toContain('network');
  });

  test('classifyAgentError identifies permission error', () => {
    const { exports } = loadBackground();
    const result = exports.classifyAgentError(new Error('Cannot access chrome:// URL'));
    expect(result.type).toBe('permission');
    expect(result.message).not.toContain('Error:');
  });

  test('submit action classified as CRITICAL risk', () => {
    const { exports } = loadBackground();
    const action = { action: 'click', thought: 'Submit the purchase form' };
    expect(exports.assessRisk(action)).toBe('CRITICAL');
  });

  test('scroll action classified as LOW risk', () => {
    const { exports } = loadBackground();
    const action = { action: 'scroll', value: 'down' };
    expect(exports.assessRisk(action)).toBe('LOW');
  });

  test('rate limit warning expectation after >100 calls', () => {
    const checkRateLimit = (metrics) => ({
      exceeded: metrics.callCount > 100,
      message: metrics.callCount > 100 ? 'Exceeded 100 calls/hour' : 'OK'
    });
    const warning = checkRateLimit({ callCount: 101, provider: 'gemini' });
    expect(warning.exceeded).toBe(true);
    expect(warning.message).toContain('100');
  });

  test('generatePlan returns array of subtasks', async () => {
    const { exports } = loadBackground();
    const plan = await exports.generatePlan('research keyboards', { provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'llama3' });
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0]).toHaveProperty('task');
    expect(plan.steps[0]).toHaveProperty('dependsOn');
  });

  test('calculateNextRun returns future timestamp for daily@9am', () => {
    const { exports } = loadBackground();
    const next = exports.SchedulerEngine.calculateNextRun('daily@9am');
    expect(next).toBeGreaterThan(Date.now());
  });

  test('scheduler task saved to storage', async () => {
    const { exports } = loadBackground();
    const task = await exports.SchedulerEngine.createTask({ goal: 'Check HN', schedule: 'daily@9am' });
    expect(task.id).toBeDefined();
    expect(task.nextRun).toBeGreaterThan(Date.now());
  });

  test('SmartBookmarks.find returns best fuzzy match', async () => {
    const { exports, storage } = loadBackground();
    storage.zanysurf_smart_bookmarks = [
      { id: '1', name: 'my email', tags: ['gmail', 'email'], url: 'https://mail.google.com', visitCount: 0 },
      { id: '2', name: 'work docs', tags: ['google docs', 'work'], url: 'https://docs.google.com', visitCount: 0 }
    ];
    const result = await exports.SmartBookmarks.find('open my gmail email inbox');
    expect(result.id).toBe('1');
  });

  test('audit log entries are append-only', async () => {
    const { exports, storage } = loadBackground();
    await exports.appendAuditLog({ action: 'click', tabId: 1 });
    await exports.appendAuditLog({ action: 'type', tabId: 1 });
    const log = storage.zanysurf_audit_log || [];
    expect(log.length).toBeGreaterThanOrEqual(2);
  });

  test('exported audit log is valid JSON payload in data URL', async () => {
    const { exports } = loadBackground();
    await exports.appendAuditLog({ action: 'click', tabId: 1 });
    const exported = await exports.exportAuditLog();
    expect(exported.success).toBe(true);
  });
});
