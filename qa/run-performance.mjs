import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { JSDOM } from 'jsdom';
import { performance } from 'perf_hooks';

const root = process.cwd();

function loadBackgroundWithMockStorage(memoryCount = 1000) {
  const code = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  const storage = {
    zanysurf_short_memory: Array.from({ length: memoryCount }).map((_, i) => ({
      ts: Date.now() - (i * 1000),
      action: 'click',
      url: 'https://example.com/' + i,
      vector: Array.from({ length: 48 }).map((__, j) => ((i + j) % 7) / 7)
    })),
    zanysurf_long_memory: {
      preferences: {},
      frequentSites: {},
      taskPatterns: Array.from({ length: memoryCount }).map((_, i) => ({
        ts: Date.now() - (i * 1000),
        summary: 'pattern ' + i,
        vector: Array.from({ length: 48 }).map((__, j) => ((i + j + 1) % 9) / 9)
      }))
    }
  };

  const chrome = {
    sidePanel: { setPanelBehavior: () => Promise.resolve(), open: () => Promise.resolve() },
    runtime: { onMessage: { addListener: () => {} }, sendMessage: () => Promise.resolve(), lastError: null },
    commands: { onCommand: { addListener: () => {} } },
    tabs: {
      query: async () => [{ id: 1, url: 'https://example.com', title: 'Example', status: 'complete' }],
      sendMessage: async () => ({ success: true, result: '{}' }),
      create: async ({ url }) => ({ id: 1, url }),
      update: async () => ({}),
      get: (id, cb) => cb({ id, status: 'complete' }),
      onUpdated: { addListener: () => {}, removeListener: () => {} },
      captureVisibleTab: async () => 'data:image/jpeg;base64,AAA'
    },
    scripting: { executeScript: async () => [] },
    windows: { create: async () => ({ id: 1 }) },
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
          return { ...storage };
        },
        set: async (obj) => Object.assign(storage, obj)
      }
    },
    notifications: { create: async () => {} }
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' }),
    Blob,
    crypto,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    chrome,
    globalThis: null
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code + '\n;globalThis.__qa_perf = { retrieveMemoryContext };', context);
  return context.__qa_perf;
}

async function benchmarkDomMap() {
  const html = '<!doctype html><html><body>' + Array.from({ length: 40 }).map((_, i) => `<button id="b${i}">Button ${i}</button>`).join('') + '</body></html>';
  const dom = new JSDOM(html, { url: 'https://example.com' });
  const contentCode = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  let listener = null;
  const chrome = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } };

  dom.window.chrome = chrome;
  dom.window.console = console;
  const script = new vm.Script(contentCode);
  const context = vm.createContext(dom.window);
  script.runInContext(context);

  await new Promise((resolve) => {
    listener({ action: 'GET_DOM', options: { lazyLoad: false, cleanup: false, showBadges: false, maxElements: 150 } }, {}, () => resolve());
  });

  const start = performance.now();
  await new Promise((resolve) => {
    listener({ action: 'GET_DOM', options: { lazyLoad: false, cleanup: false, showBadges: false, maxElements: 150 } }, {}, () => resolve());
  });
  const end = performance.now();
  return end - start;
}

async function benchmarkMemoryRetrieval() {
  const perf = loadBackgroundWithMockStorage(1000);
  const start = performance.now();
  await perf.retrieveMemoryContext('research ai browser agent');
  const end = performance.now();
  return end - start;
}

function benchmarkLoadTime() {
  const files = ['manifest.json', 'background.js', 'content.js', 'popup.js', 'popup.html', 'popup.css'];
  const start = performance.now();
  files.forEach((f) => fs.readFileSync(path.join(root, f), 'utf8'));
  const end = performance.now();
  return end - start;
}

function estimateStorageBytes() {
  const files = ['background.js', 'content.js', 'popup.js', 'popup.html', 'popup.css', 'manifest.json'];
  const total = files.reduce((sum, f) => sum + fs.statSync(path.join(root, f)).size, 0);
  return total;
}

const domMapMs = await benchmarkDomMap();
const memoryMs = await benchmarkMemoryRetrieval();
const loadMs = benchmarkLoadTime();
const storageBytes = estimateStorageBytes();

const result = {
  domMappingMs: domMapMs,
  memoryRetrievalMs: memoryMs,
  knowledgeGraphRenderMs: null,
  stepLatencyExcludingLlmMs: null,
  extensionLoadMs: loadMs,
  storageBytesEstimate: storageBytes
};

fs.writeFileSync(path.join(root, 'qa', 'performance-report.json'), JSON.stringify(result, null, 2));
console.log('Wrote qa/performance-report.json');
