/**
 * COMET AI Agent — Popup Controller v4
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
  const saveBtn       = $('save-btn');
  const testBtn       = $('test-btn');
  const testOut       = $('test-out');
  const liveBar       = $('live-bar');
  const liveStep      = $('live-step');
  const liveUrl       = $('live-url');
  const liveProgress  = $('live-progress');
  const stopBtn       = $('stop-btn');
  const chat          = $('chat');
  const input         = $('input');
  const sendBtn       = $('send-btn');

  // ── State ───────────────────────────────────────────────────────
  let running     = false;
  let thinkingEl  = null;
  const stepCards = {};   // step# → { el, bodyEl, expandEl, statusDot, execDetailEl }

  // ── Load saved settings ─────────────────────────────────────────
  const s = await chrome.storage.local.get(['provider','apiKey','ollamaUrl','ollamaModel']);
  if (s.provider)    providerSel.value  = s.provider;
  if (s.apiKey)      geminiKey.value    = s.apiKey;
  if (s.ollamaUrl)   ollamaUrl.value    = s.ollamaUrl;
  if (s.ollamaModel) ollamaModel.value  = s.ollamaModel;
  updateProvider();

  // ── Connection ping ─────────────────────────────────────────────
  pingOllama();
  setInterval(pingOllama, 18000);

  async function pingOllama() {
    if (providerSel.value !== 'ollama') return;
    const url = (ollamaUrl.value || 'http://localhost:11434').replace(/\/$/, '');
    connDot.className = 'conn-dot checking';
    try {
      const r = await fetch(url + '/api/tags', { signal: AbortSignal.timeout(3500) });
      connDot.className = r.ok ? 'conn-dot on' : 'conn-dot off';
      connDot.title = r.ok ? 'Ollama connected ✓' : 'Ollama not responding';
    } catch {
      connDot.className = 'conn-dot off';
      connDot.title = 'Ollama not reachable — is it running?';
    }
  }

  // ── Show welcome ────────────────────────────────────────────────
  showWelcome();

  // ── Settings panel events ───────────────────────────────────────
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
    testOut.classList.add('hidden');
  });

  providerSel.addEventListener('change', updateProvider);

  function updateProvider() {
    const isOllama = providerSel.value === 'ollama';
    ollamaFields.classList.toggle('hidden', !isOllama);
    geminiFields.classList.toggle('hidden',  isOllama);
    pingOllama();
  }

  saveBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({
      provider: providerSel.value,
      apiKey:   geminiKey.value,
      ollamaUrl:   ollamaUrl.value,
      ollamaModel: ollamaModel.value,
    });
    settingsPanel.classList.add('hidden');
    pingOllama();
    appendCard('system', '✓ Settings saved');
  });

  testBtn.addEventListener('click', async () => {
    const url = (ollamaUrl.value || 'http://localhost:11434').replace(/\/$/, '');
    testOut.className = 'test-out';
    testOut.textContent = 'Testing connection…';
    testOut.classList.remove('hidden');
    try {
      const r = await fetch(url + '/api/tags', { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d  = await r.json();
      const models = (d.models || []).map(m => m.name).join(', ') || '(no models found)';
      testOut.className = 'test-out ok';
      testOut.textContent = '✓ Connected! Available models: ' + models;
    } catch (e) {
      testOut.className = 'test-out fail';
      testOut.textContent = '✗ Failed: ' + e.message + '. Make sure Ollama is running.';
    }
  });

  // ── Clear ───────────────────────────────────────────────────────
  clearBtn.addEventListener('click', () => {
    Object.keys(stepCards).forEach(k => delete stepCards[k]);
    showWelcome();
    chrome.runtime.sendMessage({ action: 'CLEAR_MEMORY' }).catch(() => {});
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
    if (!text || running) return;
    input.value = '';

    // Clear previous run
    clearStepCards();
    appendUserMsg(text);
    setRunning();
    showThinking('Thinking…');

    try {
      await chrome.runtime.sendMessage({ action: 'RUN_AGENT', prompt: text });
    } catch (e) {
      removeThinking();
      setIdle();
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
        const n = Math.max(Number(msg.steps) || 1, 1);
        const stepLabel = n + ' step' + (n !== 1 ? 's' : '');
        appendCard('success',
          '✦ Done in ' + stepLabel,
          msg.result || 'Task completed successfully.'
        );
        break;
      }

      case 'AGENT_ERROR': {
        removeThinking();
        setIdle();
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
          <strong>COMET AI Agent</strong>
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

    const validActions = ['navigate','click','type','key','scroll','wait','hover','select','done','new_tab'];
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
});
