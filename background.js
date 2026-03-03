/**
 * ZANYSURF AI Browser Agent � Background Service Worker v4
 * Fully autonomous chain-of-thought browser agent with robust JSON parsing,
 * multi-provider LLM support, and reliable browser control.
 *
 * Supported providers: Ollama (local) | Gemini API
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

// --- Message router ----------------------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'RUN_AGENT') {
    agentAbort = false;
    runAgentLoop(request.prompt);
    sendResponse({ status: 'started' });
    return true;
  }
  if (request.action === 'STOP_AGENT') {
    agentAbort = true;
    agentActive = false;
    sendResponse({ status: 'stopped' });
    return true;
  }
  if (request.action === 'CLEAR_MEMORY') {
    actionHistory = [];
    sessionGoal   = '';
    sendResponse({ status: 'cleared' });
    return true;
  }
  if (request.action === 'GET_STATUS') {
    sendResponse({ active: agentActive, steps: actionHistory.length });
    return true;
  }
});

// =============================================================================
// MAIN AGENT LOOP
// =============================================================================
async function runAgentLoop(userGoal) {
  agentActive   = true;
  agentAbort    = false;
  actionHistory = [];
  sessionGoal   = userGoal;
  let steps       = 0;
  let stuckCount  = 0;       // consecutive identical action fingerprints
  let lastFingerprint = ''; // action+value+element_id hash for loop detection
  const MAX_STEPS = 30;

  try {
    const allTabs = await chrome.tabs.query({});
    let memoryStr = '--- LONG CONTEXT MEMORY: OPEN TABS ---\n';
    for (const t of allTabs) {
      if (t.url && !t.url.startsWith('chrome')) {
        memoryStr += `[@${t.id}] Title: ${t.title || 'Untitled'} | URL: ${t.url}\n`;
      }
    }
    const pastMemory = await chrome.storage.local.get(['zanysurf_session_history']);
    if (pastMemory.zanysurf_session_history) {
      memoryStr += '\n--- PAST SESSION MEMORIES ---\n' + pastMemory.zanysurf_session_history;
    }
    globalMemoryContext = memoryStr;
  } catch(e) {}

  broadcast({ action: 'AGENT_STATUS', status: 'running', message: 'Agent starting�' });

  while (agentActive && !agentAbort && steps < MAX_STEPS) {
    steps++;

    try {
      // 1. Get active tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab  = tabs[0];
      if (!tab) { broadcast({ action: 'AGENT_ERROR', error: 'No active tab found.' }); break; }

      // 2. Wait for full load
      await waitForTabReady(tab.id);
      await sleep(300);

      const currentUrl   = tab.url   || '';
      const currentTitle = tab.title || '';
      const isSystemPage = isChromePage(currentUrl);

      broadcast({ action: 'AGENT_PAGE_INFO', url: currentUrl, title: currentTitle, step: steps });

      // 3. Build DOM map
      let domMap = '';
      if (isSystemPage) {
        domMap = 'UNMAPPABLE';
      } else {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id }, files: ['content.js']
          }).catch(() => {});
          await sleep(500);
          const r = await chrome.tabs.sendMessage(tab.id, { action: 'GET_DOM' });
          domMap = (r && r.dom) ? r.dom : 'EMPTY';
        } catch (_) {
          domMap = 'UNMAPPABLE';
        }
      }

      // 4. Load settings
      const settings = await chrome.storage.local.get([
        'provider', 'apiKey', 'ollamaUrl', 'ollamaModel'
      ]);

      broadcast({ action: 'AGENT_THINKING', step: steps });

      // 5. Ask LLM for next action
      let decision;
      try {
        decision = await getNextAction(
          userGoal, domMap, actionHistory, settings,
          currentUrl, currentTitle, steps
        );
      } catch (e) {
        broadcast({ action: 'AGENT_STATUS', status: 'running', message: 'LLM error, retrying�' });
        await sleep(2000);
        try {
          decision = await getNextAction(
            userGoal, domMap, actionHistory, settings,
            currentUrl, currentTitle, steps
          );
        } catch (e2) {
          broadcast({ action: 'AGENT_ERROR', error: 'LLM failed: ' + e2.message });
          break;
        }
      }

      // 6. Safety guards
      decision = applyGuards(decision, userGoal, currentUrl, currentTitle, steps, actionHistory, domMap);

      // 7. Broadcast thought
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

      // 8. Execute action
      let execResult = { success: true, detail: '' };

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
            await sleep(800);
            await waitForTabReady(newTab.id);
            execResult.detail = 'Opened new tab: ' + url;
          } catch (e) { execResult = { success: false, detail: e.message }; }
          break;
        }

        case 'click':
        case 'type':
        case 'key':
        case 'hover':
        case 'select': {
          try {
            const r = await chrome.tabs.sendMessage(tab.id, { action: 'EXECUTE', command: decision });
            execResult = { success: !!(r && r.success), detail: r?.result || r?.error || '' };
          } catch (e) { execResult = { success: false, detail: e.message }; }
          // Screenshot after key/click so the LLM sees results (e.g. search loaded after Enter)
          if (execResult.success && (decision.action === 'key' || decision.action === 'click' || decision.action === 'type')) {
            await sleep(900);
            captureAndBroadcast(tab.id, steps);
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

      // 9. Broadcast result
      broadcast({
        action:  'AGENT_EXEC_RESULT',
        step:    steps,
        success: execResult.success,
        detail:  execResult.detail
      });

      // 9b. Retry once if element interaction failed
      if (!execResult.success &&
          ['click','type','hover','select'].includes(decision.action) &&
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
          broadcast({ action: 'AGENT_COMPLETE', result: completionMsg, steps });
          await saveTaskHistory(userGoal, steps, true);
          agentActive = false;
          break;
        }
      }

      // 11. Check completion
      if (decision.action === 'done') {
        broadcast({ action: 'AGENT_COMPLETE', result: decision.thought, steps });
        await saveTaskHistory(userGoal, steps, true);
        break;
      }

      await sleep(900);

    } catch (err) {
      console.error('[ZANYSURF] Loop error:', err);
      broadcast({ action: 'AGENT_ERROR', error: err.message });
      await saveTaskHistory(userGoal, steps, false);
      break;
    }
  }

  if (steps >= MAX_STEPS && !agentAbort && agentActive) {
    broadcast({ action: 'AGENT_ERROR', error: 'Max steps (30) reached without completing goal.' });
    await saveTaskHistory(userGoal, steps, false);
  }
  agentActive = false;
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
  if ((decision.action === 'click' || decision.action === 'type' || decision.action === 'hover') && unmappable) {
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
async function getNextAction(goal, domMap, history, settings, currentUrl, pageTitle, stepNum) {
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
    '� type      � Type text. element_id=NUMBER, value="text"\n' +
    '� key       � Press key. element_id=NUMBER or null, value="Enter"|"Tab"|"Escape"|"ArrowDown"\n' +
    '� scroll    � Scroll. value="down"|"up"|"top"\n' +
    '� hover     � Hover. element_id=NUMBER\n' +
    '� select    � Pick dropdown. element_id=NUMBER, value="option text"\n' +
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
    '13. Scroll down to reveal more elements if the target is not visible.\n\n' +
    '??? RESPOND IN JSON ONLY � NO markdown, NO code fences, NO extra text ???\n' +
    'Example response:\n' +
    '{"thought":"I see the YouTube homepage. I will navigate directly to the search results for lo-fi music.","action":"navigate","element_id":null,"value":"https://www.youtube.com/results?search_query=lo-fi+music","is_complete":false}\n\n' +
    'Your response must be exactly one JSON object:\n' +
    '{\n' +
    '  "thought": "I see [observation]. I will [action].",\n' +
    '  "action": "navigate|click|type|key|scroll|hover|select|wait|done",\n' +
    '  "element_id": null_or_integer,\n' +
    '  "value": "string or null",\n' +
    '  "is_complete": true_if_done_else_false\n' +
    '}';

  if (settings.provider === 'gemini') return callGemini(prompt, settings);
  return callOllama(prompt, settings);
}

// =============================================================================
// OLLAMA � supports /api/chat (new) and /api/generate (legacy)
// =============================================================================
async function callOllama(prompt, settings) {
  const baseUrl = (settings.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
  const model   = settings.ollamaModel || 'llama3.2:latest';

  const jsonSchema = {
    type: 'object',
    required: ['thought', 'action', 'is_complete'],
    properties: {
      thought:     { type: 'string' },
      action:      { type: 'string', enum: ['navigate','click','type','key','scroll','hover','select','wait','done'] },
      element_id:  { type: ['integer', 'null'] },
      value:       { type: ['string', 'null'] },
      is_complete: { type: 'boolean' }
    }
  };

  let rawText = '';

  // Try /api/chat first (Ollama >= 0.1.14)
  try {
    const res = await fetch(baseUrl + '/api/chat', {
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
    }
  } catch (_) {}

  // Fallback to /api/generate
  if (!rawText) {
    const res = await fetch(baseUrl + '/api/generate', {
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
    if (!res.ok) {
      const err = await res.text();
      throw new Error('Ollama ' + res.status + ': ' + err.substring(0, 200));
    }
    const data = await res.json();
    rawText = data?.response || '';
  }

  if (!rawText) throw new Error('Ollama returned an empty response.');
  const parsed = extractJSON(rawText);
  if (!parsed) throw new Error('Could not parse JSON from Ollama: ' + rawText.substring(0, 150));
  return parsed;
}

// =============================================================================
// GEMINI
// =============================================================================
async function callGemini(prompt, settings) {
  const key = settings.apiKey;
  if (!key) throw new Error('Gemini API key not set. Open ? Settings.');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + key;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 600 }
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Gemini ' + res.status + ': ' + err.substring(0, 200));
  }
  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = extractJSON(rawText);
  if (!parsed) throw new Error('Could not parse JSON from Gemini: ' + rawText.substring(0, 150));
  return parsed;
}

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

  if (thoughtM && actionM) {
    return {
      thought:     thoughtM[1],
      action:      actionM[1],
      value:       valueM ? valueM[1] : null,
      element_id:  idM ? (idM[1] === 'null' ? null : parseInt(idM[1])) : null,
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
        if (steps_ < 3) return false;
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
  chrome.runtime.sendMessage({ ...msg, _ts: Date.now() }).catch(() => {});
}

async function captureAndBroadcast(tabId, step) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 55 });
    broadcast({ action: 'AGENT_SCREENSHOT', step, dataUrl });
  } catch (_) { /* captureVisibleTab may fail on some pages */ }
}

async function saveTaskHistory(goal, steps, success) {
  try {
    const stored = await chrome.storage.local.get(['taskHistory']);
    const history = stored.taskHistory || [];
    history.unshift({
      goal: goal.substring(0, 120),
      steps,
      success,
      ts: Date.now()
    });
    // Keep last 50 tasks
    await chrome.storage.local.set({ taskHistory: history.slice(0, 50) });
  } catch (_) {}
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

