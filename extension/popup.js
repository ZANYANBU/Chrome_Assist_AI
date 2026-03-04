/**
 * ZANYSURF AI Agent — Popup Controller v4
 * Full chain-of-thought UI: step cards, live status, page refs, reasoning display.
 */

document.addEventListener('DOMContentLoaded', async () => {

  // ── DOM refs ────────────────────────────────────────────────────
  const $  = id => document.getElementById(id);
  const connDot       = $('conn-dot');
  const settingsBtn   = $('settings-btn');
  const clearBtn      = $('clear-btn');
  const settingsPanel = $('settings-panel');
  const providerSel   = $('provider-select');
  const ollamaFields  = $('ollama-fields');
  const geminiFields  = $('gemini-fields');
  const ollamaUrl     = $('ollama-url');
  const ollamaModel   = $('ollama-model');
  const geminiKey     = $('gemini-key');
  const providerModelSelect = $('provider-model-select');
  const detectModelsBtn = $('detect-models-btn');
  const providerKeyInput = $('provider-key');
  const providerKeyToggle = $('provider-key-toggle');
  const providerKeyHelp = $('provider-key-help');
  const providerStats = $('provider-stats');
  const providerRecommendation = $('provider-recommendation');
  const ollamaInstallGuide = $('ollama-install-guide');
  const providerChips = [...document.querySelectorAll('.provider-chip')];
  const saveBtn       = $('save-btn');
  const testBtn       = $('test-btn');
  const testOut       = $('test-out');
  const liveBar       = $('live-bar');
  const liveStep      = $('live-step');
  const liveUrl       = $('live-url');
  const liveProgress  = $('live-progress');
  const stopBtn       = $('stop-btn');
  const addScheduleBtn = $('add-schedule-btn');
  const refreshScheduleBtn = $('refresh-schedule-btn');
  const refreshWorkflowsBtn = $('refresh-workflows-btn');
  const refreshBookmarksBtn = $('refresh-bookmarks-btn');
  const addBookmarkBtn = $('add-bookmark-btn');
  const saveCredentialBtn = $('save-credential-btn');
  const loginCredentialBtn = $('login-credential-btn');
  const listCredentialsBtn = $('list-credentials-btn');
  const scheduledList = $('scheduled-list');
  const workflowsList = $('workflows-list');
  const bookmarksList = $('bookmarks-list');
  const activityFeed = $('activity-feed');
  const todaySchedules = $('today-schedules');
  const memoryStats = $('memory-stats');
  const quickRunList = $('quick-run-list');
  const agentTree = $('agent-tree');
  const knowledgeGraph = $('knowledge-graph');
  const agentHealthPill = $('agent-health-pill');
  const exportAuditBtn = $('export-audit-btn');
  const replayReportBtn = $('replay-report-btn');
  const safeModeBtn = $('safe-mode-btn');
  const planModeBtn = $('plan-mode-btn');
  const replaySlider = $('replay-slider');
  const replayStep = $('replay-step');
  const onboarding = $('onboarding');
  const onboardTest = $('onboard-test');
  const onboardExample = $('onboard-example');
  const onboardBookmark = $('onboard-bookmark');
  const onboardFinish = $('onboard-finish');
  const openPanelBtn = $('open-panel-btn');
  const openPanelInlineBtn = $('open-panel-inline');
  const connLabel = $('conn-label');
  const recentTasksList = $('recent-tasks-list');
  const footerCount = $('footer-count');
  const storageFoot = $('storage-foot');
  const workflowRefreshAlt = $('workflow-refresh-alt');
  const memorySummary = $('memory-summary');
  const chat          = $('chat');
  const input         = $('input');
  const sendBtn       = $('send-btn');

  // ── State ───────────────────────────────────────────────────────
  let running     = false;
  let thinkingEl  = null;
  const stepCards = {};   // step# → { el, bodyEl, expandEl, statusDot, execDetailEl }
  const navButtons = [...document.querySelectorAll('.nav-item')];
  const views = [...document.querySelectorAll('.view')];
  const CLOUD_PROVIDERS = new Set(['gemini', 'openai', 'claude', 'groq', 'mistral']);

  setPanelMode();
  initNavigation();
  initTabs();
  initQuickActions();
  initOpenPanelButtons();
  renderRecentTasks();
  renderUsageMeta();

  // ── Load saved settings ─────────────────────────────────────────
  await loadSettingsState();

  // ── Connection ping ─────────────────────────────────────────────
  pingOllama();
  setInterval(pingOllama, 18000);

  async function pingOllama() {
    if (providerSel.value !== 'ollama') return;
    const url = (ollamaUrl.value || 'http://localhost:11434').replace(/\/$/, '');
    connDot.className = 'conn-dot checking';
    if (connLabel) connLabel.textContent = 'Checking';
    try {
      const r = await fetch(url + '/api/tags', { signal: AbortSignal.timeout(3500) });
      connDot.className = r.ok ? 'conn-dot on' : 'conn-dot off';
      connDot.title = r.ok ? 'Ollama connected ✓' : 'Ollama not responding';
      if (connLabel) connLabel.textContent = r.ok ? 'Connected' : 'Offline';
    } catch {
      connDot.className = 'conn-dot off';
      connDot.title = 'Ollama not reachable — is it running?';
      if (connLabel) connLabel.textContent = 'Offline';
    }
  }

  // ── Show welcome ────────────────────────────────────────────────
  showWelcome();
  initTier3Panel();
  initTier4Panel();

  // ── Settings panel events ───────────────────────────────────────
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
    testOut.classList.add('hidden');
  });

  providerSel.addEventListener('change', updateProvider);
  providerChips.forEach(chip => {
    chip.addEventListener('click', async () => {
      providerSel.value = chip.dataset.provider;
      await updateProvider();
    });
  });

  providerKeyToggle?.addEventListener('click', () => {
    if (!providerKeyInput) return;
    providerKeyInput.type = providerKeyInput.type === 'password' ? 'text' : 'password';
  });

  detectModelsBtn?.addEventListener('click', async () => {
    if (providerSel.value !== 'ollama') return;
    const response = await chrome.runtime.sendMessage({ action: 'DETECT_OLLAMA_MODELS', ollamaUrl: ollamaUrl.value }).catch(() => ({ success: false }));
    if (!response?.success) {
      if (ollamaInstallGuide) ollamaInstallGuide.classList.remove('hidden');
      testOut.className = 'test-out fail';
      testOut.textContent = '✗ Failed to detect models: ' + (response?.error || 'Connection failed.');
      testOut.classList.remove('hidden');
      return;
    }
    if (ollamaInstallGuide) ollamaInstallGuide.classList.add('hidden');
    populateModelSelect(response.models || []);
    testOut.className = 'test-out ok';
    testOut.textContent = '✓ Detected ' + (response.models || []).length + ' model(s).';
    testOut.classList.remove('hidden');
  });

  async function updateProvider() {
    const provider = providerSel.value || 'ollama';
    const isOllama = provider === 'ollama';
    ollamaFields.classList.toggle('hidden', !isOllama);
    geminiFields.classList.toggle('hidden', !CLOUD_PROVIDERS.has(provider));
    providerChips.forEach(chip => chip.classList.toggle('active', chip.dataset.provider === provider));

    if (providerKeyHelp) {
      const labels = {
        gemini: 'Gemini API Key · https://ai.google.dev',
        openai: 'OpenAI API Key · https://platform.openai.com/api-keys',
        claude: 'Anthropic API Key · https://console.anthropic.com',
        groq: 'Groq API Key · https://console.groq.com',
        mistral: 'Mistral API Key · https://console.mistral.ai'
      };
      providerKeyHelp.textContent = labels[provider] || 'Local provider does not require API key.';
    }

    await loadModelsForProvider(provider);
    await refreshProviderStats();
    if (isOllama) pingOllama();
  }

  saveBtn.addEventListener('click', async () => {
    const provider = providerSel.value;
    const model = providerModelSelect?.value || ollamaModel.value;
    let passphrase = null;

    if (CLOUD_PROVIDERS.has(provider) && providerKeyInput?.value?.trim()) {
      passphrase = window.prompt('Unlock vault passphrase to store API key securely', '') || '';
      if (!passphrase.trim()) {
        appendCard('error', '⚠ Save blocked', 'Vault passphrase is required for cloud API keys.');
        return;
      }
      const unlock = await chrome.runtime.sendMessage({ action: 'UNLOCK_CREDENTIAL_VAULT', passphrase: passphrase.trim() }).catch(() => ({ success: false }));
      if (!unlock?.success) {
        appendCard('error', '⚠ Vault unlock failed', unlock?.error || 'Cannot unlock vault.');
        return;
      }
      const keyStore = await chrome.runtime.sendMessage({ action: 'STORE_PROVIDER_KEY', provider, key: providerKeyInput.value.trim(), passphrase: passphrase.trim() }).catch(() => ({ success: false }));
      if (!keyStore?.success) {
        appendCard('error', '⚠ Key save failed', keyStore?.error || 'Unable to store API key securely.');
        return;
      }
      providerKeyInput.value = '';
    }

    await chrome.storage.local.set({
      provider,
      model,
      ollamaUrl:   ollamaUrl.value,
      ollamaModel: model,
      geminiModel: provider === 'gemini' ? model : undefined,
      openaiModel: provider === 'openai' ? model : undefined,
      claudeModel: provider === 'claude' ? model : undefined,
      groqModel: provider === 'groq' ? model : undefined,
      mistralModel: provider === 'mistral' ? model : undefined,
    });
    settingsPanel.classList.add('hidden');
    await updateProvider();
    appendCard('system', '✓ Settings saved');
  });

  testBtn.addEventListener('click', async () => {
    const provider = providerSel.value || 'ollama';
    testOut.className = 'test-out';
    testOut.textContent = 'Testing connection…';
    testOut.classList.remove('hidden');
    try {
      const result = await chrome.runtime.sendMessage({ action: 'TEST_PROVIDER_CONNECTION', provider }).catch(() => ({ ok: false }));
      if (!result?.ok) throw new Error(result?.error || 'Connection failed');
      if (provider === 'ollama' && Array.isArray(result.models)) {
        populateModelSelect(result.models);
      }
      testOut.className = 'test-out ok';
      testOut.textContent = '✓ Connected to ' + provider + (provider === 'ollama' ? ' · models detected: ' + ((result.models || []).length) : '');
    } catch (e) {
      testOut.className = 'test-out fail';
      testOut.textContent = '✗ Failed: ' + e.message;
      if (provider === 'ollama' && ollamaInstallGuide) ollamaInstallGuide.classList.remove('hidden');
    }
  });

  // ── Clear ───────────────────────────────────────────────────────
  clearBtn.addEventListener('click', () => {
    Object.keys(stepCards).forEach(k => delete stepCards[k]);
    showWelcome();
    chrome.runtime.sendMessage({ action: 'CLEAR_MEMORY' }).catch(() => {});
  });

  planModeBtn?.addEventListener('click', async () => {
    const enabled = !planModeBtn.classList.contains('is-on');
    planModeBtn.classList.toggle('is-on', enabled);
    planModeBtn.textContent = enabled ? '📋 Plan mode on' : '📋 Plan mode off';
    await chrome.storage.local.set({ zanysurf_plan_mode: enabled }).catch(() => {});
  });

  // ── Stop ────────────────────────────────────────────────────────
  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'STOP_AGENT' }).catch(() => {});
    setIdle();
    appendCard('system', '■ Agent stopped by user.');
  });

  // ── Send ────────────────────────────────────────────────────────
  sendBtn.addEventListener('click', doSend);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  async function doSend() {
    const text = input.value.trim();
    if (!text) return;

    if (running) {
      await chrome.runtime.sendMessage({ action: 'CANCEL_AND_CLEAR' }).catch(() => {
        chrome.runtime.sendMessage({ action: 'STOP_AGENT' }).catch(() => {});
      });
      showStatusToast('Old run cancelled', 'warning');
      appendCard('system', '■ Previous run cancelled. Starting new command…');
    }

    input.value = '';
    input.style.height = 'auto';

    // Clear previous run
    clearStepCards();
    appendUserMsg(text);
    setRunning();
    showThinking('Thinking…');
    rememberRecentTask(text);

    try {
      await chrome.runtime.sendMessage({ action: 'RUN_AGENT', prompt: text });
      showStatusToast('New run started', 'success');
    } catch (e) {
      removeThinking();
      setIdle();
      showStatusToast('Failed to start run', 'error');
      appendCard('error', '⚠ Failed to start agent', e.message);
    }
  }

  // ── Background message listener ─────────────────────────────────
  chrome.runtime.onMessage.addListener(msg => {
    switch (msg.action) {

      case 'AGENT_STATUS':
        if (msg.status === 'running') {
          liveStep.textContent = msg.message || 'Working…';
          updateThinking(msg.message);
          setHealth('Running');
          pushActivity('⚙ ' + (msg.message || 'Agent running'));
        }
        break;

      case 'AGENT_THINKING':
        liveStep.textContent = 'Step ' + msg.step + '/30 — asking model…';
        setProgress(msg.step);
        updateThinking('Step ' + msg.step + ': thinking…');
        break;

      case 'AGENT_PAGE_INFO':
        liveUrl.textContent  = trimUrl(msg.url || '');
        liveStep.textContent = 'Step ' + msg.step + '/30 — ' + (msg.title || msg.url || 'loading page');
        setProgress(msg.step);
        updateThinking('Step ' + msg.step + ': reading page');
        break;

      case 'AGENT_LOG': {
        removeThinking();
        const { step, thought, nextAction, value, element_id, url, title, dom_count } = msg;
        liveStep.textContent =
          'Step ' + step + '/30 — ' + nextAction.toUpperCase() +
          (value ? ': ' + value.substring(0, 35) : '');
        setProgress(step);

        const card = makeStepCard(step, nextAction, value, element_id, thought, url, title, dom_count);
        chat.appendChild(card.el);
        stepCards[step] = card;
        scroll();

        showThinking('Step ' + (step + 1) + ': executing ' + nextAction + '…');
        break;
      }

      case 'AGENT_PLAN': {
        const steps = (msg.plan?.steps || []).map((step, index) => {
          return '[' + (index + 1) + '] ' + step.task;
        }).join('\n');
        appendCard('system', msg.replanned ? '📋 Plan updated' : '📋 Execution plan', steps || 'No plan steps generated.');
        break;
      }

      case 'AGENT_PLAN_PROGRESS': {
        const icon = msg.status === 'completed' ? '✅' : (msg.status === 'failed' ? '❌' : '🔄');
        const detail = msg.detail ? ('\n' + msg.detail) : '';
        appendCard('system', icon + ' Plan step ' + msg.index + '/' + msg.total, (msg.task || 'Subtask') + detail);
        break;
      }

      case 'AGENT_EXEC_RESULT': {
        removeThinking();
        const { step, success, detail } = msg;
        const card = stepCards[step];
        if (card) {
          card.statusDot.className = 'step-status ' + (success ? 'ok' : 'fail');
          if (detail) {
            card.execDetailEl.textContent = (success ? '✓ ' : '✗ ') + detail;
            card.execDetailEl.className   = 'exec-detail ' + (success ? 'ok' : 'fail');
          }
        }
        break;
      }

      case 'AGENT_SCREENSHOT': {
        const card = stepCards[msg.step];
        if (card && msg.dataUrl) {
          const img = document.createElement('img');
          img.src       = msg.dataUrl;
          img.className = 'step-screenshot';
          img.alt       = 'Page screenshot';
          card.bodyEl.appendChild(img);
          chat.scrollTop = chat.scrollHeight;
        }
        break;
      }

      case 'AGENT_COMPLETE': {
        removeThinking();
        setIdle();
        setHealth('Idle');
        const n = Math.max(Number(msg.steps) || 1, 1);
        const stepLabel = n + ' step' + (n !== 1 ? 's' : '');
        appendCard('success',
          '✦ Done in ' + stepLabel,
          msg.result || 'Task completed successfully.'
        );
        renderRecentTasks();
        renderUsageMeta();
        break;
      }

      case 'AGENT_TREE': {
        renderAgentTree(msg.tree || []);
        break;
      }

      case 'AGENT_BUS_EVENT': {
        const env = msg.envelope || {};
        const text = (env.type || msg.type || 'EVENT') + ' ' +
          (env.from || msg.from || 'Agent') + '→' + (env.to || msg.to || 'Agent') +
          ' [' + (env.taskId || msg.taskId || 'global') + ']';
        pushActivity('🧩 ' + text.trim());
        break;
      }

      case 'AGENT_SYNTHESIS': {
        removeThinking();
        appendCard('system', '🧠 Cross-tab synthesis', msg.synthesis || 'Synthesis completed.');
        break;
      }

      case 'AGENT_SCHEDULED': {
        removeThinking();
        setIdle();
        appendCard('system', '📅 Scheduled task created', (msg.task?.schedule || '') + ' — ' + (msg.task?.goal || ''));
        renderScheduledTasks();
        break;
      }

      case 'AGENT_WARNING': {
        appendCard('system', '⚠ High-risk action', msg.message || 'Potentially risky action queued.');
        break;
      }

      case 'SUGGEST_AUTOMATION': {
        appendSuggestionCard(msg);
        break;
      }

      case 'APPROVAL_REQUEST': {
        removeThinking();
        appendApprovalCard(msg);
        break;
      }

      case 'AGENT_ERROR': {
        removeThinking();
        setIdle();
        setHealth('Error');
        appendCard('error', '⚠ Agent error', msg.error || 'Unknown error occurred.');
        break;
      }
    }
  });

  // ── UI builders ─────────────────────────────────────────────────

  function showWelcome() {
    chat.innerHTML = `
      <div class="welcome">
        <div class="welcome-icon">✦</div>
        <div class="welcome-body">
          <strong>ZANYSURF AI Agent</strong>
          <span>Autonomous browser assistant powered by local Ollama.<br>
          Watch me think step by step and control your browser.</span>
          <div class="welcome-examples">
            <span class="example-pill" data-q="Open YouTube and search for lo-fi music">Open YouTube</span>
            <span class="example-pill" data-q="Go to Amazon and search for wireless headphones">Search Amazon</span>
            <span class="example-pill" data-q="Open Reddit and browse top posts">Browse Reddit</span>
            <span class="example-pill" data-q="Go to GitHub and search for react projects">Search GitHub</span>
            <span class="example-pill" data-q="Go to Hacker News and find the top story">Hacker News</span>
            <span class="example-pill" data-q="Search Google for the latest AI news">Google AI News</span>
          </div>
        </div>
      </div>`;

    chat.querySelectorAll('.example-pill').forEach(p => {
      p.addEventListener('click', () => {
        input.value = p.dataset.q;
        input.focus();
      });
    });
  }

  function clearStepCards() {
    chat.querySelectorAll('.step-card,.thinking-card,.result-card').forEach(e => e.remove());
    Object.keys(stepCards).forEach(k => delete stepCards[k]);
  }

  function appendUserMsg(text) {
    const d = document.createElement('div');
    d.className = 'msg-user';
    d.innerHTML = '<div class="bubble">' + esc(text) + '</div>';
    chat.appendChild(d);
    scroll();
  }

  function makeStepCard(step, action, value, el_id, thought, url, title, domCount) {
    const card = document.createElement('div');
    card.className = 'step-card';

    const validActions = ['navigate','click','click_coords','type','key','scroll','wait','hover','select','done','new_tab'];
    const badgeClass = 'step-action-badge badge-' + (validActions.includes(action) ? action : 'unknown');

    const valueStr = value
      ? (action === 'navigate'
          ? value.replace(/^https?:\/\/(www\.)?/, '').substring(0, 35)
          : value.substring(0, 30) + (value.length > 30 ? '…' : ''))
      : (el_id !== null && el_id !== undefined ? 'elem [' + el_id + ']' : '');

    const cotHtml = esc(thought)
      .replace(/\b(navigate|click|type|search|open|go to|submit|press|scroll|find|look for|select|hover)\b/gi,
        '<em>$1</em>');

    card.innerHTML =
      '<div class="step-header">' +
        '<span class="step-num">#' + step + '</span>' +
        '<span class="' + badgeClass + '">' + esc(action) + '</span>' +
        '<span class="step-value">' + esc(valueStr) + '</span>' +
        '<span class="step-status pending"></span>' +
        '<span class="step-expand">▾</span>' +
      '</div>' +
      '<div class="step-body">' +
        (url ? (
          '<div class="page-ref">' +
            '<span class="page-ref-icon">🌐</span>' +
            '<div class="page-ref-info">' +
              '<div class="page-ref-title">' + esc(title || 'Untitled') + '</div>' +
              '<div class="page-ref-url">' + esc(trimUrl(url)) + '</div>' +
            '</div>' +
          '</div>'
        ) : '') +
        '<div class="cot-label">Chain of Thought</div>' +
        '<div class="cot-text">' + cotHtml + '</div>' +
        (domCount > 0
          ? '<div class="dom-badge">🔲 <span>' + domCount + '</span> elements mapped</div>'
          : '') +
        '<div class="exec-detail"></div>' +
      '</div>';

    const header     = card.querySelector('.step-header');
    const body       = card.querySelector('.step-body');
    const expandIcon = card.querySelector('.step-expand');
    const statusDot  = card.querySelector('.step-status');
    const execDetail = card.querySelector('.exec-detail');

    // Auto-expand latest, collapse previous
    body.classList.add('open');
    expandIcon.classList.add('open');
    const prev = stepCards[step - 1];
    if (prev) {
      prev.bodyEl.classList.remove('open');
      prev.expandEl.classList.remove('open');
    }

    header.addEventListener('click', () => {
      body.classList.toggle('open');
      expandIcon.classList.toggle('open');
    });

    return { el: card, bodyEl: body, expandEl: expandIcon, statusDot, execDetailEl: execDetail };
  }

  function appendCard(type, title, body) {
    const d = document.createElement('div');
    d.className = 'result-card ' + (
      type === 'success' ? 'success' :
      type === 'system'  ? 'system'  : 'error'
    );
    d.innerHTML = '<strong>' + esc(title) + '</strong>' + (body ? '<span>' + esc(body) + '</span>' : '');
    chat.appendChild(d);
    scroll();
  }

  function initTier3Panel() {
    if (!scheduledList || !workflowsList || !bookmarksList) return;

    addScheduleBtn?.addEventListener('click', createScheduledTaskFromPrompt);
    refreshScheduleBtn?.addEventListener('click', handleSchedulePromptAction);
    refreshWorkflowsBtn?.addEventListener('click', handleWorkflowPromptAction);
    workflowRefreshAlt?.addEventListener('click', handleWorkflowPromptAction);
    refreshBookmarksBtn?.addEventListener('click', handleBookmarkPromptAction);
    addBookmarkBtn?.addEventListener('click', saveCurrentBookmark);
    saveCredentialBtn?.addEventListener('click', saveCredentialFromPrompt);
    loginCredentialBtn?.addEventListener('click', loginWithSavedCredentialPrompt);
    listCredentialsBtn?.addEventListener('click', listCredentialsPrompt);

    renderScheduledTasks();
    renderWorkflows();
    renderBookmarks();
  }

  async function createScheduledTaskFromPrompt() {
    const goal = window.prompt('Schedule goal', 'Open Hacker News and summarize top story');
    if (!goal || !goal.trim()) return;
    const schedule = window.prompt('Schedule expression', 'every day at 9am');
    if (!schedule || !schedule.trim()) return;

    const response = await chrome.runtime.sendMessage({
      action: 'CREATE_SCHEDULED_TASK',
      goal: goal.trim(),
      schedule: schedule.trim()
    }).catch(() => ({ success: false, error: 'Failed to create schedule.' }));

    if (!response?.success) {
      appendCard('error', '⚠ Schedule failed', response?.error || 'Unable to create scheduled task.');
      return;
    }

    appendCard('system', '📅 Scheduled task created', schedule.trim() + ' — ' + goal.trim());
    renderScheduledTasks();
  }

  async function handleSchedulePromptAction() {
    const action = (window.prompt('Schedule action: list | create', 'list') || '').trim().toLowerCase();
    if (!action || action === 'list' || action === 'refresh') {
      renderScheduledTasks();
      return;
    }
    if (action === 'create' || action === 'add') {
      await createScheduledTaskFromPrompt();
      return;
    }
    appendCard('system', 'ℹ Unknown schedule action', 'Use "list" or "create".');
  }

  async function renderScheduledTasks() {
    if (!scheduledList) return;
    scheduledList.innerHTML = '';

    const response = await chrome.runtime.sendMessage({ action: 'LIST_SCHEDULED_TASKS' })
      .catch(() => ({ success: false, error: 'Failed to fetch scheduled tasks.' }));

    if (!response?.success) {
      setListMessage(scheduledList, 'Unable to load schedules.');
      return;
    }

    const tasks = response.tasks || [];
    if (!tasks.length) {
      setListMessage(scheduledList, 'No scheduled tasks yet.');
      return;
    }

    tasks.forEach(task => {
      const item = document.createElement('div');
      item.className = 'tier3-item';

      const title = document.createElement('strong');
      title.textContent = task.goal || 'Untitled task';
      item.appendChild(title);

      const meta = document.createElement('div');
      meta.textContent = (task.schedule || 'unspecified schedule') + ' • ' + (task.enabled ? 'enabled' : 'paused');
      item.appendChild(meta);

      const next = document.createElement('div');
      next.textContent = 'Next: ' + formatTimestamp(task.nextRun);
      item.appendChild(next);

      const actions = document.createElement('div');
      actions.className = 'tier3-actions';

      const runBtn = document.createElement('button');
      runBtn.className = 'btn-sec';
      runBtn.textContent = 'Run now';
      runBtn.addEventListener('click', async () => {
        const runResponse = await chrome.runtime.sendMessage({ action: 'RUN_SCHEDULED_TASK_NOW', taskId: task.id })
          .catch(() => ({ success: false, error: 'Failed to run scheduled task.' }));
        if (!runResponse?.success) {
          appendCard('error', '⚠ Run failed', runResponse?.error || 'Unable to run task.');
          return;
        }
        appendCard('system', '▶ Scheduled task started', task.goal || 'Task started.');
        renderScheduledTasks();
      });

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'btn-sec';
      toggleBtn.textContent = task.enabled ? 'Pause' : 'Enable';
      toggleBtn.addEventListener('click', async () => {
        const updateResponse = await chrome.runtime.sendMessage({
          action: 'UPDATE_SCHEDULED_TASK',
          taskId: task.id,
          patch: { enabled: !task.enabled }
        }).catch(() => ({ success: false, error: 'Failed to update task.' }));
        if (!updateResponse?.success) {
          appendCard('error', '⚠ Update failed', updateResponse?.error || 'Unable to update task.');
          return;
        }
        renderScheduledTasks();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-sec';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', async () => {
        const ok = window.confirm('Delete this scheduled task?');
        if (!ok) return;
        const deleteResponse = await chrome.runtime.sendMessage({ action: 'DELETE_SCHEDULED_TASK', taskId: task.id })
          .catch(() => ({ success: false, error: 'Failed to delete task.' }));
        if (!deleteResponse?.success) {
          appendCard('error', '⚠ Delete failed', deleteResponse?.error || 'Unable to delete task.');
          return;
        }
        renderScheduledTasks();
      });

      actions.appendChild(runBtn);
      actions.appendChild(toggleBtn);
      actions.appendChild(deleteBtn);
      item.appendChild(actions);
      scheduledList.appendChild(item);
    });
  }

  async function renderWorkflows() {
    if (!workflowsList) return;
    workflowsList.innerHTML = '';

    const response = await chrome.runtime.sendMessage({ action: 'LIST_WORKFLOWS' })
      .catch(() => ({ success: false, error: 'Failed to fetch workflows.' }));

    if (!response?.success) {
      setListMessage(workflowsList, 'Unable to load workflows.');
      return;
    }

    const workflows = response.workflows || [];
    if (!workflows.length) {
      setListMessage(workflowsList, 'No workflows recorded yet.');
      return;
    }

    workflows.slice(0, 6).forEach(workflow => {
      const item = document.createElement('div');
      item.className = 'tier3-item';

      const title = document.createElement('strong');
      title.textContent = workflow.goal || 'Untitled workflow';
      item.appendChild(title);

      const meta = document.createElement('div');
      meta.textContent = (workflow.steps?.length || 0) + ' steps • ' + (workflow.runCount || 0) + ' replays';
      item.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'tier3-actions';
      const replayBtn = document.createElement('button');
      replayBtn.className = 'btn-sec';
      replayBtn.textContent = 'Replay';
      replayBtn.addEventListener('click', async () => {
        const replayResponse = await chrome.runtime.sendMessage({ action: 'REPLAY_WORKFLOW', workflowId: workflow.id })
          .catch(() => ({ success: false, error: 'Failed to replay workflow.' }));
        if (!replayResponse?.success) {
          appendCard('error', '⚠ Replay failed', replayResponse?.error || 'Unable to replay workflow.');
          return;
        }
        appendCard('system', '📼 Workflow replayed', workflow.goal || 'Workflow replay complete.');
        renderWorkflows();
      });
      actions.appendChild(replayBtn);
      item.appendChild(actions);

      workflowsList.appendChild(item);
    });
  }

  async function handleWorkflowPromptAction() {
    const response = await chrome.runtime.sendMessage({ action: 'LIST_WORKFLOWS' })
      .catch(() => ({ success: false, error: 'Failed to fetch workflows.' }));

    if (!response?.success) {
      appendCard('error', '⚠ Workflow fetch failed', response?.error || 'Unable to fetch workflows.');
      renderWorkflows();
      return;
    }

    const workflows = response.workflows || [];
    renderWorkflows();

    if (!workflows.length) {
      appendCard('system', '📼 Workflows', 'No workflows recorded yet.');
      return;
    }

    const ask = (window.prompt('Workflow action: list or replay <number>', 'list') || '').trim().toLowerCase();
    if (!ask || ask === 'list' || ask === 'refresh') return;

    const replayMatch = ask.match(/^replay\s+(\d+)$/);
    if (!replayMatch) {
      appendCard('system', 'ℹ Unknown workflow action', 'Try: replay 1');
      return;
    }

    const index = Number(replayMatch[1]) - 1;
    if (index < 0 || index >= workflows.length) {
      appendCard('error', '⚠ Invalid workflow number', 'Choose a number from 1 to ' + workflows.length + '.');
      return;
    }

    const workflow = workflows[index];
    const replayResponse = await chrome.runtime.sendMessage({ action: 'REPLAY_WORKFLOW', workflowId: workflow.id })
      .catch(() => ({ success: false, error: 'Failed to replay workflow.' }));
    if (!replayResponse?.success) {
      appendCard('error', '⚠ Replay failed', replayResponse?.error || 'Unable to replay workflow.');
      return;
    }
    appendCard('system', '📼 Workflow replayed', workflow.goal || 'Workflow replay complete.');
    renderWorkflows();
  }

  async function renderBookmarks() {
    if (!bookmarksList) return;
    bookmarksList.innerHTML = '';

    const response = await chrome.runtime.sendMessage({ action: 'LIST_SMART_BOOKMARKS' })
      .catch(() => ({ success: false, error: 'Failed to fetch bookmarks.' }));

    if (!response?.success) {
      setListMessage(bookmarksList, 'Unable to load bookmarks.');
      return;
    }

    const bookmarks = response.bookmarks || [];
    if (!bookmarks.length) {
      setListMessage(bookmarksList, 'No smart bookmarks yet.');
      return;
    }

    bookmarks.slice(0, 6).forEach(bookmark => {
      const item = document.createElement('div');
      item.className = 'tier3-item';

      const title = document.createElement('strong');
      title.textContent = bookmark.name || 'Untitled bookmark';
      item.appendChild(title);

      const meta = document.createElement('div');
      meta.textContent = trimUrl(bookmark.url || '') + ' • visits: ' + (bookmark.visitCount || 0);
      item.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'tier3-actions';
      const openBtn = document.createElement('button');
      openBtn.className = 'btn-sec';
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', async () => {
        if (!bookmark.url) return;
        await chrome.tabs.create({ url: bookmark.url }).catch(() => {});
      });
      actions.appendChild(openBtn);
      item.appendChild(actions);

      bookmarksList.appendChild(item);
    });
  }

  async function saveCurrentBookmark() {
    const mode = (window.prompt('Bookmark mode: current | custom', 'current') || '').trim().toLowerCase();
    let url = '';
    let suggestedName = '';

    if (!mode || mode === 'current') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) {
        appendCard('error', '⚠ Bookmark failed', 'No active tab URL found.');
        return;
      }
      url = tab.url;
      suggestedName = tab.title || trimUrl(tab.url);
    } else if (mode === 'custom') {
      const customUrl = window.prompt('Enter URL to bookmark', 'https://');
      if (!customUrl || !customUrl.trim()) return;
      url = customUrl.trim();
      suggestedName = trimUrl(url);
    } else {
      appendCard('system', 'ℹ Unknown bookmark mode', 'Use "current" or "custom".');
      return;
    }

    const name = window.prompt('What should I bookmark as name?', suggestedName);
    if (!name || !name.trim()) return;
    const context = window.prompt('Bookmark context (optional)', 'Tier 3 quick save') || '';

    const response = await chrome.runtime.sendMessage({
      action: 'SAVE_SMART_BOOKMARK',
      name: name.trim(),
      url,
      context: context.trim()
    }).catch(() => ({ success: false, error: 'Failed to save bookmark.' }));

    if (!response?.success) {
      appendCard('error', '⚠ Bookmark failed', response?.error || 'Unable to save bookmark.');
      return;
    }

    appendCard('system', '🔖 Bookmark saved', name.trim());
    renderBookmarks();
  }

  async function handleBookmarkPromptAction() {
    const response = await chrome.runtime.sendMessage({ action: 'LIST_SMART_BOOKMARKS' })
      .catch(() => ({ success: false, error: 'Failed to fetch bookmarks.' }));

    if (!response?.success) {
      appendCard('error', '⚠ Bookmark fetch failed', response?.error || 'Unable to fetch bookmarks.');
      renderBookmarks();
      return;
    }

    const bookmarks = response.bookmarks || [];
    renderBookmarks();

    if (!bookmarks.length) {
      appendCard('system', '🔖 Bookmarks', 'No smart bookmarks yet.');
      return;
    }

    const ask = (window.prompt('Bookmark action: list | open <number> | add', 'list') || '').trim().toLowerCase();
    if (!ask || ask === 'list' || ask === 'refresh') return;

    if (ask === 'add' || ask === 'save') {
      await saveCurrentBookmark();
      return;
    }

    const openMatch = ask.match(/^open\s+(\d+)$/);
    if (!openMatch) {
      appendCard('system', 'ℹ Unknown bookmark action', 'Try: open 1');
      return;
    }

    const index = Number(openMatch[1]) - 1;
    if (index < 0 || index >= bookmarks.length) {
      appendCard('error', '⚠ Invalid bookmark number', 'Choose a number from 1 to ' + bookmarks.length + '.');
      return;
    }

    const bookmark = bookmarks[index];
    if (!bookmark?.url) {
      appendCard('error', '⚠ Bookmark open failed', 'Selected bookmark has no URL.');
      return;
    }
    await chrome.tabs.create({ url: bookmark.url }).catch(() => {});
  }

  async function ensureVaultUnlocked() {
    const passphrase = window.prompt('Enter master passphrase (stored only for this session)', '');
    if (!passphrase || !passphrase.trim()) return null;
    const unlock = await chrome.runtime.sendMessage({
      action: 'UNLOCK_CREDENTIAL_VAULT',
      passphrase: passphrase.trim()
    }).catch(() => ({ success: false }));
    if (!unlock?.success) {
      appendCard('error', '⚠ Vault unlock failed', unlock?.error || 'Unable to unlock vault.');
      return null;
    }
    return passphrase.trim();
  }

  async function saveCredentialFromPrompt() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const siteDefault = tab?.url || '';
    const site = window.prompt('Site/domain to save login for', siteDefault);
    if (!site || !site.trim()) return;

    const username = window.prompt('Username / Email', '');
    if (!username || !username.trim()) return;

    const password = window.prompt('Password', '');
    if (!password) return;

    const passphrase = await ensureVaultUnlocked();
    if (!passphrase) return;

    const response = await chrome.runtime.sendMessage({
      action: 'SAVE_CREDENTIAL',
      site: site.trim(),
      username: username.trim(),
      password,
      passphrase
    }).catch(() => ({ success: false, error: 'Failed to save credential.' }));

    if (!response?.success) {
      appendCard('error', '⚠ Save login failed', response?.error || 'Unable to save credential.');
      return;
    }
    appendCard('system', '🔐 Login saved securely', (response.entry?.site || site.trim()) + ' • ' + (response.entry?.usernameMask || 'user'));
  }

  async function listCredentialsPrompt() {
    const response = await chrome.runtime.sendMessage({ action: 'LIST_CREDENTIALS' })
      .catch(() => ({ success: false, error: 'Failed to list credentials.' }));
    if (!response?.success) {
      appendCard('error', '⚠ Credential list failed', response?.error || 'Unable to load credentials.');
      return;
    }
    const entries = response.entries || [];
    if (!entries.length) {
      appendCard('system', '📂 Credentials', 'No saved credentials.');
      return;
    }
    const preview = entries.slice(0, 8).map((entry, index) => (index + 1) + '. ' + entry.site + ' • ' + entry.usernameMask).join('\n');
    appendCard('system', '📂 Stored credentials', preview);

    const ask = (window.prompt('Credential action: login <number> | delete <number> | list', 'list') || '').trim().toLowerCase();
    if (!ask || ask === 'list') return;

    const loginMatch = ask.match(/^login\s+(\d+)$/);
    if (loginMatch) {
      const index = Number(loginMatch[1]) - 1;
      if (index < 0 || index >= entries.length) {
        appendCard('error', '⚠ Invalid credential number', 'Choose between 1 and ' + entries.length + '.');
        return;
      }
      await loginWithSavedCredentialPrompt(entries[index]);
      return;
    }

    const deleteMatch = ask.match(/^delete\s+(\d+)$/);
    if (deleteMatch) {
      const index = Number(deleteMatch[1]) - 1;
      if (index < 0 || index >= entries.length) {
        appendCard('error', '⚠ Invalid credential number', 'Choose between 1 and ' + entries.length + '.');
        return;
      }
      const selected = entries[index];
      const ok = window.confirm('Delete saved login for ' + selected.site + '?');
      if (!ok) return;
      const deletion = await chrome.runtime.sendMessage({ action: 'DELETE_CREDENTIAL', id: selected.id })
        .catch(() => ({ success: false }));
      appendCard(deletion?.success ? 'system' : 'error', deletion?.success ? '🗑 Credential deleted' : '⚠ Delete failed', selected.site);
      return;
    }
  }

  async function loginWithSavedCredentialPrompt(preselected = null) {
    let selected = preselected;
    if (!selected) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const site = window.prompt('Site/domain to login', tab?.url || '');
      if (!site || !site.trim()) return;
      selected = { site: site.trim() };
    }

    const passphrase = await ensureVaultUnlocked();
    if (!passphrase) return;

    const response = await chrome.runtime.sendMessage({
      action: 'LOGIN_WITH_CREDENTIAL',
      credentialId: selected.id,
      site: selected.site,
      passphrase
    }).catch(() => ({ success: false, error: 'Failed to login with credential.' }));

    if (!response?.success) {
      appendCard('error', '⚠ Login failed', response?.error || 'Unable to use saved login.');
      return;
    }
    appendCard('system', '🔓 Login autofill complete', response.result?.message || 'Credentials filled.');
  }

  function setListMessage(listEl, message) {
    listEl.innerHTML = '';
    const item = document.createElement('div');
    item.className = 'tier3-item';
    item.textContent = message;
    listEl.appendChild(item);
  }

  function formatTimestamp(ts) {
    if (!ts) return 'n/a';
    const dt = new Date(ts);
    if (Number.isNaN(dt.getTime())) return 'n/a';
    return dt.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function appendSuggestionCard(msg) {
    const card = document.createElement('div');
    card.className = 'result-card system';
    card.innerHTML =
      '<strong>💡 Automation Suggestion</strong>' +
      '<span>' + esc(msg.suggestion || 'Frequent pattern detected.') + '</span>' +
      '<span>' + esc((msg.schedule || '') + ' — ' + (msg.goal || '')) + '</span>' +
      '<div class="suggest-actions">' +
        '<button class="btn-sec suggest-accept">✅ Set it up</button>' +
        '<button class="btn-sec suggest-dismiss">✗ Dismiss</button>' +
      '</div>';

    card.querySelector('.suggest-accept')?.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        action: 'CREATE_SCHEDULED_TASK',
        goal: msg.goal,
        schedule: msg.schedule
      }).catch(() => {});
      card.remove();
      appendCard('system', '✅ Automation scheduled', (msg.schedule || '') + ' — ' + (msg.goal || ''));
    });

    card.querySelector('.suggest-dismiss')?.addEventListener('click', () => card.remove());
    chat.appendChild(card);
    scroll();
  }

  function appendApprovalCard(msg) {
    const card = document.createElement('div');
    card.className = 'result-card error';
    const preview = msg.preview
      ? '<img class="step-screenshot" src="' + esc(msg.preview) + '" alt="Approval preview" />'
      : '';
    card.innerHTML =
      '<strong>🛡 Approval Required</strong>' +
      '<span>' + esc(msg.payload?.message || 'Approve this action?') + '</span>' +
      preview +
      '<div class="suggest-actions">' +
        '<button class="btn-pri approve-yes">Approve</button>' +
        '<button class="btn-sec approve-no">Deny</button>' +
      '</div>';

    const respond = async (approved) => {
      await chrome.runtime.sendMessage({
        action: 'APPROVAL_RESPONSE',
        requestId: msg.requestId,
        approved
      }).catch(() => {});
      card.remove();
      appendCard('system', approved ? '✅ Approved' : '✋ Denied', msg.payload?.action?.thought || '');
    };

    card.querySelector('.approve-yes')?.addEventListener('click', () => respond(true));
    card.querySelector('.approve-no')?.addEventListener('click', () => respond(false));
    chat.appendChild(card);
    scroll();
  }

  function initTier4Panel() {
    if (!activityFeed || !todaySchedules || !memoryStats) return;

    exportAuditBtn?.addEventListener('click', async () => {
      const response = await chrome.runtime.sendMessage({ action: 'EXPORT_AUDIT_LOG' }).catch(() => ({ success: false }));
      appendCard(response?.success ? 'system' : 'error', response?.success ? '🧾 Audit exported' : '⚠ Audit export failed', response?.success ? '' : (response?.error || 'Unknown error'));
    });

    replayReportBtn?.addEventListener('click', async () => {
      const response = await chrome.runtime.sendMessage({ action: 'GENERATE_STEP_REPLAY_REPORT' }).catch(() => ({ success: false }));
      if (!response?.success || !response.html) {
        appendCard('error', '⚠ Replay export failed', response?.error || 'Unable to generate replay report.');
        return;
      }
      const blob = new Blob([response.html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const fileName = 'zanysurf-replay-' + Date.now() + '.html';
      await chrome.downloads.download({ url, filename: fileName, saveAs: true }).catch(() => {});
      appendCard('system', '🎞 Replay report exported', fileName);
    });

    safeModeBtn?.addEventListener('click', async () => {
      const currentText = (safeModeBtn.textContent || '').toLowerCase();
      const nextEnabled = !currentText.includes('on');
      const response = await chrome.runtime.sendMessage({ action: 'TOGGLE_SAFE_MODE', enabled: nextEnabled }).catch(() => ({ success: false }));
      if (response?.success) {
        safeModeBtn.textContent = response.enabled ? '🛡 Safe Mode: ON' : '🛡 Safe Mode: OFF';
      }
    });

    replaySlider?.addEventListener('input', () => renderReplayStep(Number(replaySlider.value || 1)));

    onboardTest?.addEventListener('click', () => testBtn?.click());
    onboardExample?.addEventListener('click', async () => {
      input.value = 'Research top AI browser agents and draft a summary report';
      await doSend();
    });
    onboardBookmark?.addEventListener('click', () => saveCurrentBookmark());
    onboardFinish?.addEventListener('click', async () => {
      onboarding?.classList.add('hidden');
      await chrome.storage.local.set({ zanysurf_onboarding_done: true });
    });

    loadOnboardingState();
    refreshTier4Dashboard();
    setInterval(refreshTier4Dashboard, 12000);
  }

  async function loadOnboardingState() {
    const state = await chrome.storage.local.get(['zanysurf_onboarding_done']).catch(() => ({}));
    if (!state.zanysurf_onboarding_done) onboarding?.classList.remove('hidden');
  }

  async function refreshTier4Dashboard() {
    const response = await chrome.runtime.sendMessage({ action: 'GET_AGENT_DASHBOARD' }).catch(() => ({ success: false }));
    if (response?.success && response.summary) {
      renderDashboard(response.summary);
    }

    const treeResponse = await chrome.runtime.sendMessage({ action: 'GET_AGENT_TREE' }).catch(() => ({ success: false }));
    if (treeResponse?.success) renderAgentTree(treeResponse.tree || []);

    const graphResponse = await chrome.runtime.sendMessage({ action: 'GET_KNOWLEDGE_GRAPH' }).catch(() => ({ success: false }));
    if (graphResponse?.success) renderKnowledgeGraph(graphResponse.graph || {});

    const memorySummaryResponse = await chrome.runtime.sendMessage({ action: 'GET_MEMORY_SUMMARY' }).catch(() => ({}));
    if (memorySummary && memorySummaryResponse?.summary) {
      setList(memorySummary, String(memorySummaryResponse.summary).split('\n').filter(Boolean).slice(0, 10));
    }

    renderReplaySlider();
  }

  function renderDashboard(summary) {
    setList(activityFeed, [
      'Run: ' + (summary.runId || '—'),
      'Now: ' + new Date(summary.now || Date.now()).toLocaleTimeString()
    ]);

    const scheduleLines = (summary.todayScheduled || []).map(item => {
      const next = formatTimestamp(item.nextRun);
      return (item.goal || 'Task') + ' • ' + next;
    });
    setList(todaySchedules, scheduleLines.length ? scheduleLines : ['No scheduled tasks']);

    setList(memoryStats, [
      'Memories: ' + (summary.memoryStats?.memories || 0),
      'Workflows: ' + (summary.memoryStats?.workflows || 0),
      'Bookmarks: ' + (summary.memoryStats?.bookmarks || 0),
      'Success: ' + (summary.health?.successRate || 0) + '%',
      'LLM Calls: ' + (summary.health?.llmCalls || 0),
      'Cost: $' + Number(summary.health?.estimatedCostUsd || 0).toFixed(4)
    ]);

    renderQuickRuns(summary.quickRuns || []);
    safeModeBtn.textContent = summary.health?.safeMode ? '🛡 Safe Mode: ON' : '🛡 Safe Mode: OFF';
    setHealth(summary.active ? 'Running' : 'Idle');
  }

  function renderQuickRuns(items) {
    quickRunList.innerHTML = '';
    if (!items.length) {
      setList(quickRunList, ['No quick runs yet']);
      return;
    }
    items.slice(0, 5).forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'btn-sec';
      btn.textContent = item.goal;
      btn.addEventListener('click', () => {
        input.value = item.goal;
        doSend();
      });
      quickRunList.appendChild(btn);
    });
  }

  function renderAgentTree(tree) {
    if (!agentTree) return;
    const lines = (tree || []).map(node => {
      const icon = node.status === 'completed' ? '✅' : (node.status === 'failed' ? '❌' : (node.status === 'running' ? '🔄' : '⏳'));
      return icon + ' [' + (node.type || 'agent') + '] ' + (node.task || node.id || 'step');
    });
    setList(agentTree, lines.length ? lines : ['No agent tree yet']);
  }

  function renderKnowledgeGraph(graph) {
    if (!knowledgeGraph) return;
    const nodes = Object.values(graph.nodes || {});
    const edges = Object.values(graph.edges || {});
    const lines = [
      'Nodes: ' + nodes.length,
      'Edges: ' + edges.length
    ];
    edges.slice(0, 8).forEach(edge => {
      const from = graph.nodes?.[edge.from]?.label || edge.from;
      const to = graph.nodes?.[edge.to]?.label || edge.to;
      lines.push(from + ' → ' + edge.relation + ' → ' + to);
    });
    setList(knowledgeGraph, lines);
  }

  function renderReplaySlider(steps = null) {
    const cards = steps && Array.isArray(steps) ? steps : chat.querySelectorAll('.step-card');
    const total = Math.max(cards.length, 1);
    replaySlider.max = String(total);
    replaySlider.value = String(total);
    renderReplayStep(total);
  }

  function showApprovalRequest(request) {
    appendApprovalCard(request || {});
  }

  function renderReplayStep(index) {
    const cards = [...chat.querySelectorAll('.step-card')];
    if (!cards.length) {
      setList(replayStep, ['No steps yet']);
      return;
    }
    const current = cards[Math.max(0, Math.min(cards.length - 1, index - 1))];
    const header = current.querySelector('.step-header')?.innerText || '';
    const thought = current.querySelector('.cot-text')?.innerText || '';
    const detail = current.querySelector('.exec-detail')?.innerText || '';
    setList(replayStep, [header, thought, detail].filter(Boolean));
  }

  function setList(container, lines) {
    if (!container) return;
    container.innerHTML = '';
    (lines || []).forEach(line => {
      const item = document.createElement('div');
      item.className = 'tier4-item';
      item.textContent = line;
      container.appendChild(item);
    });
  }

  function setHealth(text) {
    if (!agentHealthPill) return;
    agentHealthPill.textContent = text;
    agentHealthPill.className = 'badge badge-green';
    if (text === 'Error') agentHealthPill.className = 'badge badge-orange';
    if (text === 'Running') agentHealthPill.className = 'badge badge-blue';
  }

  async function loadSettingsState() {
    const s = await chrome.storage.local.get(['provider','ollamaUrl','ollamaModel','model']).catch(() => ({}));
    if (s.provider) providerSel.value = s.provider;
    if (s.ollamaUrl) ollamaUrl.value = s.ollamaUrl;
    const selectedModel = s.model || s.ollamaModel || 'llama3';
    ollamaModel.value = selectedModel;
    await updateProvider();
    providerModelSelect.value = selectedModel;
    await updateModelRecommendation();
  }

  async function loadModelsForProvider(provider) {
    const response = await chrome.runtime.sendMessage({ action: 'GET_MODELS_FOR_PROVIDER', provider }).catch(() => ({ success: false, models: [] }));
    const models = (response.models || []).map(item => typeof item === 'string' ? { name: item } : item);
    populateModelSelect(models);
  }

  function populateModelSelect(models) {
    if (!providerModelSelect) return;
    providerModelSelect.innerHTML = '';
    const normalized = (models || []).map(item => typeof item === 'string' ? { name: item } : item).filter(item => item?.name);
    normalized.forEach(item => {
      const option = document.createElement('option');
      const profile = item.profile;
      option.value = item.name;
      option.textContent = profile ? (item.name + ' — ' + profile.speed + '/' + profile.quality) : item.name;
      providerModelSelect.appendChild(option);
    });
    if (!normalized.length) {
      const fallback = document.createElement('option');
      fallback.value = providerSel.value === 'ollama' ? (ollamaModel.value || 'llama3') : 'default';
      fallback.textContent = fallback.value;
      providerModelSelect.appendChild(fallback);
    }
  }

  async function refreshProviderStats() {
    if (!providerStats) return;
    const response = await chrome.runtime.sendMessage({ action: 'GET_MODEL_PERFORMANCE' }).catch(() => ({ success: false, stats: {} }));
    const stats = response.stats || {};
    const provider = providerSel.value;
    const entries = Object.entries(stats).filter(([key]) => key.startsWith(provider + ':'));
    if (!entries.length) {
      providerStats.textContent = 'Avg latency: — · Success: — · Calls: —';
      return;
    }
    const totalCalls = entries.reduce((sum, [, val]) => sum + Number(val.calls || 0), 0);
    const totalFailures = entries.reduce((sum, [, val]) => sum + Number(val.failures || 0), 0);
    const totalAvg = Math.round(entries.reduce((sum, [, val]) => sum + Number(val.avgMs || 0), 0) / entries.length);
    const successRate = totalCalls ? Math.round(((totalCalls - totalFailures) / totalCalls) * 100) : 100;
    providerStats.textContent = 'Avg latency: ' + totalAvg + 'ms · Success: ' + successRate + '% · Calls: ' + totalCalls;
  }

  async function updateModelRecommendation() {
    if (!providerRecommendation) return;
    const goal = String(input?.value || '').trim() || 'general browsing task';
    const availableModels = [...providerModelSelect.options].map(option => option.value);
    const response = await chrome.runtime.sendMessage({ action: 'RECOMMEND_MODEL', provider: providerSel.value, goal, availableModels }).catch(() => ({ success: false }));
    const model = response?.recommendation || '—';
    providerRecommendation.textContent = '💡 Recommendation for current task: ' + model;
  }

  providerModelSelect?.addEventListener('change', () => {
    ollamaModel.value = providerModelSelect.value;
    updateModelRecommendation();
  });

  input?.addEventListener('input', () => {
    updateModelRecommendation();
  });

  function pushActivity(text) {
    if (!activityFeed) return;
    const line = document.createElement('div');
    line.className = 'tier4-item';
    line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + text;
    activityFeed.prepend(line);
    while (activityFeed.children.length > 24) activityFeed.lastChild?.remove();
  }

  let statusToastTimer = null;
  function showStatusToast(message, type = 'info') {
    let toast = document.getElementById('status-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'status-toast';
      toast.className = 'status-toast';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.className = 'status-toast ' + (type || 'info');
    requestAnimationFrame(() => toast.classList.add('show'));

    if (statusToastTimer) clearTimeout(statusToastTimer);
    statusToastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 1600);
  }

  function showThinking(text) {
    if (thinkingEl) {
      thinkingEl.querySelector('.thinking-text').textContent = text || '';
      return;
    }
    thinkingEl = document.createElement('div');
    thinkingEl.className = 'thinking-card';
    thinkingEl.innerHTML =
      '<div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>' +
      '<span class="thinking-text">' + esc(text || 'Thinking…') + '</span>';
    chat.appendChild(thinkingEl);
    scroll();
  }

  function updateThinking(text) {
    if (thinkingEl) thinkingEl.querySelector('.thinking-text').textContent = text || '';
  }

  function removeThinking() {
    if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
  }

  function setRunning() {
    running = true;
    sendBtn.disabled = true;
    input.disabled   = true;
    liveBar.classList.remove('hidden');
    liveStep.textContent = 'Starting agent…';
    liveUrl.textContent  = '';
    setProgress(0);
  }

  function setIdle() {
    running = false;
    sendBtn.disabled = false;
    input.disabled   = false;
    liveBar.classList.add('hidden');
    setProgress(0);
  }

  function setProgress(step) {
    if (!liveProgress) return;
    liveProgress.style.width = (Math.min(step / 30, 1) * 100) + '%';
  }

  function scroll() {
    setTimeout(() => { chat.scrollTop = chat.scrollHeight; }, 60);
  }

  function trimUrl(url) {
    try { return new URL(url).hostname + new URL(url).pathname.substring(0, 30); }
    catch (_) { return url.substring(0, 50); }
  }

  function esc(s) {
    return (s || '').toString()
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  function setPanelMode() {
    if (window.innerHeight >= 700) document.body.classList.add('sidepanel-mode');
  }

  function initNavigation() {
    navButtons.forEach(btn => {
      btn.addEventListener('click', () => activateView(btn.dataset.view));
    });
  }

  function activateView(viewId) {
    navButtons.forEach(item => item.classList.toggle('is-active', item.dataset.view === viewId));
    views.forEach(view => view.classList.toggle('is-active', view.id === viewId));
  }

  function initTabs() {
    document.querySelectorAll('[data-memory-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.memoryTab;
        document.querySelectorAll('[data-memory-tab]').forEach(t => t.classList.toggle('is-active', t === tab));
        $('memory-memories')?.classList.toggle('is-active', target === 'memories');
        $('memory-graph')?.classList.toggle('is-active', target === 'graph');
      });
    });

    document.querySelectorAll('[data-analytics-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.analyticsTab;
        document.querySelectorAll('[data-analytics-tab]').forEach(t => t.classList.toggle('is-active', t === tab));
        $('analytics-audit')?.classList.toggle('is-active', target === 'audit');
        $('analytics-metrics')?.classList.toggle('is-active', target === 'metrics');
      });
    });
  }

  function initQuickActions() {
    document.querySelectorAll('.quick-action[data-prompt]').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.dataset.prompt || '';
        doSend();
      });
    });

    document.querySelectorAll('.example-pill[data-q]').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.dataset.q || '';
        doSend();
      });
    });
  }

  function initOpenPanelButtons() {
    const openPanel = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      if (!tab?.id) return;
      await chrome.sidePanel?.open({ tabId: tab.id }).catch(() => {});
    };
    openPanelBtn?.addEventListener('click', openPanel);
    openPanelInlineBtn?.addEventListener('click', openPanel);
  }

  async function rememberRecentTask(goal) {
    const state = await chrome.storage.local.get(['zanysurf_ui_recent_tasks']).catch(() => ({}));
    const list = state.zanysurf_ui_recent_tasks || [];
    const next = [
      { goal, ts: Date.now() },
      ...list.filter(item => item.goal !== goal)
    ].slice(0, 4);
    await chrome.storage.local.set({ zanysurf_ui_recent_tasks: next }).catch(() => {});
    renderRecentTasks();
  }

  async function renderRecentTasks() {
    if (!recentTasksList) return;
    const state = await chrome.storage.local.get(['zanysurf_ui_recent_tasks']).catch(() => ({}));
    const list = state.zanysurf_ui_recent_tasks || [];
    recentTasksList.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'recent-item';
      empty.innerHTML = '<span class="recent-arrow">▸</span><span class="recent-goal">No recent tasks yet</span><span class="recent-time">—</span>';
      recentTasksList.appendChild(empty);
      return;
    }
    list.forEach(item => {
      const row = document.createElement('button');
      row.className = 'recent-item';
      row.innerHTML = '<span class="recent-arrow">▸</span><span class="recent-goal">' + esc(item.goal) + '</span><span class="recent-time">' + relativeTime(item.ts) + '</span>';
      row.addEventListener('click', () => {
        input.value = item.goal || '';
        doSend();
      });
      recentTasksList.appendChild(row);
    });
  }

  async function renderUsageMeta() {
    const state = await chrome.storage.local.get(['taskHistory']).catch(() => ({}));
    const count = (state.taskHistory || []).length;
    if (footerCount) footerCount.textContent = '◈ ' + count + ' tasks done';
    if (storageFoot) {
      const bytes = JSON.stringify(state || {}).length;
      storageFoot.textContent = (bytes / (1024 * 1024)).toFixed(1) + ' MB storage';
    }
  }

  function relativeTime(ts) {
    const delta = Math.max(1, Math.floor((Date.now() - Number(ts || 0)) / 1000));
    if (delta < 60) return delta + 's ago';
    if (delta < 3600) return Math.floor(delta / 60) + 'm ago';
    if (delta < 86400) return Math.floor(delta / 3600) + 'h ago';
    return Math.floor(delta / 86400) + 'd ago';
  }
});

