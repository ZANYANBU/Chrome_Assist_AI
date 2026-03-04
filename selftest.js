const state = { results: [], startedAt: null, endedAt: null };

function msg(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      resolve(response || {});
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const SMOKE_TESTS = [
  { id: 'core_1', name: 'Background service worker alive', run: async () => { const r = await msg({ action: 'PING' }); assert(r?.pong === true, 'No pong from background'); } },
  { id: 'core_2', name: 'LLM provider config readable', run: async () => { const r = await msg({ action: 'GET_SETTINGS' }); assert(r?.provider, 'No provider in settings'); } },
  { id: 'core_3', name: 'Memory system readable', run: async () => { const r = await msg({ action: 'GET_MEMORY_CONTEXT', goal: 'test' }); assert(Array.isArray(r?.memories), 'Memory did not return array'); } },
  { id: 'core_4', name: 'Knowledge graph readable', run: async () => { const r = await msg({ action: 'GET_KNOWLEDGE_GRAPH' }); assert(typeof r?.graph === 'object', 'Knowledge graph not returned'); } },
  { id: 'core_5', name: 'Audit log appendable', run: async () => { const r = await msg({ action: 'APPEND_AUDIT_LOG', entry: { action: 'selftest', tabId: 0 } }); assert(r?.ok, 'Audit log append failed'); } },
  { id: 'sched_1', name: 'Create scheduled task', run: async () => { const r = await msg({ action: 'CREATE_SCHEDULE', goal: 'selftest task', schedule: 'daily@9am' }); assert(r?.id, 'Schedule not created'); await msg({ action: 'DELETE_SCHEDULE', id: r.id }); } },
  { id: 'sched_2', name: 'List scheduled tasks', run: async () => { const r = await msg({ action: 'GET_SCHEDULES' }); assert(Array.isArray(r?.schedules), 'Schedules not array'); } },
  { id: 'wf_1', name: 'Get workflows list', run: async () => { const r = await msg({ action: 'GET_WORKFLOWS' }); assert(Array.isArray(r?.workflows), 'Workflows not array'); } },
  { id: 'bm_1', name: 'Save and retrieve bookmark', run: async () => { const r = await msg({ action: 'SAVE_BOOKMARK', name: 'selftest bookmark', url: 'https://example.com', context: 'test' }); assert(r?.id, 'Bookmark not saved'); const list = await msg({ action: 'GET_BOOKMARKS' }); const found = (list.bookmarks || []).some(b => b.id === r.id); assert(found, 'Bookmark not in list'); await msg({ action: 'DELETE_BOOKMARK', id: r.id }); } },
  { id: 'vault_1', name: 'Vault lock/unlock cycle', run: async () => { const unlock = await msg({ action: 'VAULT_UNLOCK', passphrase: 'selftest123' }); assert(unlock?.ok, 'Vault unlock failed'); const lock = await msg({ action: 'VAULT_LOCK' }); assert(lock?.ok, 'Vault lock failed'); } },
  { id: 'agent_1', name: 'Session state readable', run: async () => { const r = await msg({ action: 'GET_SESSION_STATE' }); assert(typeof r === 'object', 'Session state not object'); } },
  { id: 'agent_2', name: 'Safe mode toggleable', run: async () => { await msg({ action: 'SET_SAFE_MODE', enabled: true }); const on = await msg({ action: 'GET_SAFE_MODE' }); assert(on?.safeMode === true, 'Safe mode did not turn on'); await msg({ action: 'SET_SAFE_MODE', enabled: false }); } },
  { id: 'agent_3', name: 'Error classifier works', run: async () => { const r = await msg({ action: 'TEST_ERROR_CLASSIFICATION', errorMessage: 'Failed to fetch' }); assert(r?.type === 'network', `Expected network, got ${r?.type}`); } },
  { id: 'agent_4', name: 'API metrics readable', run: async () => { const r = await msg({ action: 'GET_API_METRICS' }); assert(typeof r?.callCount === 'number', 'callCount not a number'); } },
  { id: 'agent_5', name: 'Rate limit detection at 101 calls', run: async () => { const r = await msg({ action: 'CHECK_RATE_LIMIT', callCount: 101, provider: 'gemini' }); assert(r?.exceeded === true, 'Rate limit not triggered at 101'); } },
  { id: 'llm_1', name: 'Provider list returns all models', run: async () => { const r = await msg({ action: 'GET_PROVIDER_LIST' }); const required = ['ollama','gemini','openai','claude','groq','mistral']; required.forEach(p => assert(r?.providers?.includes(p), `Missing provider: ${p}`)); } },
  { id: 'llm_2', name: 'Model list returns per provider', run: async () => { const r = await msg({ action: 'GET_MODELS_FOR_PROVIDER', provider: 'openai' }); assert(Array.isArray(r?.models), 'Models not array'); assert(r.models.length > 0, 'No models returned'); } }
];

function render() {
  const root = document.getElementById('results');
  root.innerHTML = '';
  state.results.forEach(item => {
    const row = document.createElement('div');
    row.className = 'item';
    const stateClass = item.status === 'PASS' ? 'pass' : item.status === 'FAIL' ? 'fail' : 'run';
    row.innerHTML = `
      <div class="id">${item.id}</div>
      <div class="name">${item.name}</div>
      <div class="state ${stateClass}">${item.status === 'RUNNING' ? '<span class="spinner"></span>RUNNING' : item.status}</div>
      ${item.error ? `<div class="error">${item.error}</div>` : ''}
    `;
    root.appendChild(row);
  });

  const passed = state.results.filter(r => r.status === 'PASS').length;
  const failed = state.results.filter(r => r.status === 'FAIL').length;
  const total = state.results.length || SMOKE_TESTS.length;
  document.getElementById('summary').innerHTML = `<strong>${passed}/${total}</strong> tests passing · <span class="fail">${failed} failed</span>`;

  const started = state.startedAt ? new Date(state.startedAt).toLocaleTimeString() : 'n/a';
  const ended = state.endedAt ? new Date(state.endedAt).toLocaleTimeString() : 'running';
  document.getElementById('run-meta').textContent = `Started: ${started} · Ended: ${ended}`;
}

async function runTests(filterFailedOnly = false) {
  state.startedAt = Date.now();
  state.endedAt = null;
  const tests = filterFailedOnly
    ? SMOKE_TESTS.filter(t => state.results.find(r => r.id === t.id && r.status === 'FAIL'))
    : SMOKE_TESTS;

  if (!tests.length) return;

  if (!filterFailedOnly) {
    state.results = tests.map(t => ({ id: t.id, name: t.name, status: 'PENDING', error: '' }));
  }

  for (const test of tests) {
    const existing = state.results.find(r => r.id === test.id);
    if (existing) {
      existing.status = 'RUNNING';
      existing.error = '';
    }
    render();

    try {
      await test.run();
      const row = state.results.find(r => r.id === test.id);
      if (row) row.status = 'PASS';
    } catch (error) {
      const row = state.results.find(r => r.id === test.id);
      if (row) {
        row.status = 'FAIL';
        row.error = error.message;
      }
    }

    render();
    await new Promise(r => setTimeout(r, 100));
  }

  state.endedAt = Date.now();
  render();
}

function exportReport() {
  const passed = state.results.filter(r => r.status === 'PASS').length;
  const failed = state.results.filter(r => r.status === 'FAIL').length;
  const payload = {
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    passed,
    failed,
    total: state.results.length,
    results: state.results
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'zanysurf-selftest-report.json';
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('run-all').addEventListener('click', () => runTests(false));
document.getElementById('rerun-failed').addEventListener('click', () => runTests(true));
document.getElementById('export-json').addEventListener('click', exportReport);

state.results = SMOKE_TESTS.map(t => ({ id: t.id, name: t.name, status: 'PENDING', error: '' }));
render();
