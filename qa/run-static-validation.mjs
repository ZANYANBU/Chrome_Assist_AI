import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

const root = process.cwd();
const files = {
  js: ['background.js', 'content.js', 'popup.js', 'extension/background.js', 'extension/content.js', 'extension/popup.js'],
  json: ['manifest.json', 'metadata.json', 'extension/manifest.json'],
  html: ['popup.html', 'extension/popup.html']
};

function checkJsSyntax(file) {
  try {
    execSync(`node --check "${file}"`, { stdio: 'pipe' });
    return { file, ok: true };
  } catch (error) {
    return { file, ok: false, error: String(error.stderr || error.message) };
  }
}

function checkJson(file) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    return { file, ok: true };
  } catch (error) {
    return { file, ok: false, error: error.message };
  }
}

function checkHtml(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const ok = /<html[\s>]/i.test(text) && /<\/html>/i.test(text) && /<body[\s>]/i.test(text) && /<\/body>/i.test(text);
  return { file, ok, error: ok ? '' : 'Missing html/body closing structure' };
}

function hashFile(file) {
  const data = fs.readFileSync(path.join(root, file));
  return crypto.createHash('sha256').update(data).digest('hex');
}

function syncCheck(a, b) {
  const ah = hashFile(a);
  const bh = hashFile(b);
  return { pair: `${a} ↔ ${b}`, ok: ah === bh, hashA: ah, hashB: bh };
}

function grep(file, needleRegex) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  return needleRegex.test(text);
}

const requiredPermissions = [
  'sidePanel','declarativeNetRequest','notifications','downloads','clipboardWrite','alarms','storage','scripting','activeTab','tabs','contextMenus'
];

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const manifestChecks = {
  manifestVersion3: manifest.manifest_version === 3,
  sidePanelConfig: manifest.side_panel?.default_path === 'popup.html',
  commandAltZ: manifest.commands?.['toggle-sidepanel']?.suggested_key?.default === 'Alt+Z',
  bgServiceWorker: manifest.background?.service_worker === 'background.js',
  contentScriptAllUrls: Array.isArray(manifest.content_scripts) && manifest.content_scripts.some((c) => (c.js || []).includes('content.js') && (c.matches || []).includes('<all_urls>'),),
  hostAllUrls: Array.isArray(manifest.host_permissions) && manifest.host_permissions.includes('<all_urls>'),
  permissions: requiredPermissions.map((p) => ({ perm: p, ok: (manifest.permissions || []).includes(p) }))
};

const functionChecks = {
  background: [
    'runAgentEntry','OrchestratorAgent','ResearchAgent','AnalysisAgent','WriterAgent','ActionAgent','InterAgentBus','triggerLazyLoadScroll','generatePlan','runAgentWithPlanning','retrieveMemoryContext','detectGoalContinuation','persistSessionState','upsertKnowledgeGraph','getKnowledgeGraph','appendAuditLog','exportAuditLog','updateApiMetrics','classifyAgentError','toggleSafeMode','buildAgentDashboardSummary','generateStepReplayHtml','SchedulerEngine','PersonalizationEngine','SmartBookmarks'
  ].map((name) => ({ name, ok: grep('background.js', new RegExp(name)) })),
  content: [
    'buildDomMap','executeAction','detectPageType','extractSemanticSections','findPrimaryCTA','extractCleanArticleText','extractMediaContext','installNetworkHooks','composeEmail','bookPreferredSlot','resolveFieldValue'
  ].map((name) => ({ name, ok: grep('content.js', new RegExp(name)) })),
  popup: [
    'initTier4Panel','refreshTier4Dashboard','renderDashboard','renderKnowledgeGraph','renderReplaySlider','loadOnboardingState','showApprovalRequest'
  ].map((name) => ({ name, ok: grep('popup.js', new RegExp(name)) }))
};

const result = {
  syntax: {
    js: files.js.map(checkJsSyntax),
    json: files.json.map(checkJson),
    html: files.html.map(checkHtml)
  },
  manifest: manifestChecks,
  sync: [
    syncCheck('background.js', 'extension/background.js'),
    syncCheck('content.js', 'extension/content.js'),
    syncCheck('popup.js', 'extension/popup.js'),
    syncCheck('popup.html', 'extension/popup.html'),
    syncCheck('popup.css', 'extension/popup.css'),
    syncCheck('manifest.json', 'extension/manifest.json')
  ],
  functions: functionChecks
};

const outFile = path.join(root, 'qa', 'static-validation-report.json');
fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log('Wrote', outFile);
