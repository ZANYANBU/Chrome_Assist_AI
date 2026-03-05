/**
 * ZANYSURF AI Browser Agent - Content Script v4
 * DOM annotation, element mapping, and robust action execution.
 * Handles vanilla JS, React, Vue, Angular, and Shadow DOM.
 */

if (!window.__ZANYSURF_agent_initialized) {
  window.__ZANYSURF_agent_initialized = true;

  let elementMap = [];
  let isRecordingMacro = false;

  let currentIframe = null;
  const networkBuffer = [];
  let networkHookInstalled = false;
  const MAX_ELEMENTS = 150;
  const DOM_TEXT_WORKER_URL = chrome.runtime?.getURL ? chrome.runtime.getURL('dom-text-worker.js') : null;

  const JS_PRESETS = {
    get_title: () => document.title,
    get_url: () => window.location.href,
    get_selection: () => String(window.getSelection?.() || ''),
    get_meta_description: () => document.querySelector('meta[name="description"]')?.content ?? '',
    get_canonical_url: () => document.querySelector('link[rel="canonical"]')?.href ?? '',
    get_page_language: () => document.documentElement.lang,
    get_scroll_position: () => ({ x: window.scrollX, y: window.scrollY }),
    get_form_count: () => document.forms.length,
    get_video_duration: () => document.querySelector('video')?.duration ?? null,
    get_article_text: () => document.querySelector('article')?.innerText ?? (document.body?.innerText || '').slice(0, 2000),
    is_logged_in: () => !!document.querySelector('[data-testid="user-avatar"], .user-avatar, #user-menu'),
    get_react_version: () => window.React?.version ?? window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.get?.(1)?.version ?? null,
    count_elements: (selector = '*') => document.querySelectorAll(String(selector || '*')).length,
    get_computed_style: (selector = 'body', prop = 'display') => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element)[prop] : null;
    }
  };

  async function waitForDomStable(timeout = 3000) {
    return new Promise((resolve) => {
      let lastCount = 0;
      let stableFor = 0;
      const interval = setInterval(() => {
        const count = document.querySelectorAll('a,button,input').length;
        if (count === lastCount) {
          stableFor += 200;
          if (stableFor >= 600) { // stable for 600ms = ready
            clearInterval(interval);
            resolve();
          }
        } else {
          stableFor = 0;
          lastCount = count;
        }
      }, 200);
      setTimeout(() => { clearInterval(interval); resolve(); }, timeout);
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function waitForDomChange(timeout = 2000) {
    return new Promise((resolve) => {
      const observer = new MutationObserver((mutations) => {
        const significant = mutations.some(m => 
          m.addedNodes.length > 3 || m.removedNodes.length > 3
        );
        if (significant) {
          observer.disconnect();
          resolve(true);
        }
      });
      observer.observe(document.body, { 
        childList: true, 
        subtree: true 
      });
      setTimeout(() => { observer.disconnect(); resolve(false); }, timeout);
    });
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'SET_MACRO_RECORDING') {
      isRecordingMacro = request.state;
      sendResponse({ success: true });
      return true;
    }
    if (request.action === 'GET_DOM') {
      waitForDomStable().then(() => {
        return buildDomMap(request.options || {});
      })
        .then(result => sendResponse({ dom: result.domString, title: document.title, url: window.location.href, meta: result.meta || {} }))
        .catch(() => sendResponse({ dom: '', title: document.title, url: window.location.href, meta: {} }));
      return true;
    }
    if (request.action === 'EXECUTE') {
      executeAction(request.command)
        .then(async (result) => {
          const changed = await waitForDomChange();
          if (changed) await sleep(400); // let React finish re-rendering
          sendResponse({ success: true, result });
        })
        .catch(err   => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if (request.action === 'READ_PAGE') {
      try {
        const text = (document.body?.innerText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 12000);
        sendResponse({
          text,
          title: document.title,
          url: window.location.href,
          semantic: analyzePageSemantics(),
          media: extractMediaContext(),
          readingMode: extractCleanArticleText()
        });
      } catch (_) {
        sendResponse({ text: '', title: document.title, url: window.location.href });
      }
      return true;
    }
    if (request.action === 'INSTALL_NETWORK_MONITOR') {
      try {
        installNetworkHooks();
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return true;
    }
    if (request.action === 'READ_NETWORK_CACHE') {
      sendResponse({ success: true, entries: networkBuffer.slice(-80) });
      return true;
    }
    if (request.action === 'CLEAR_BADGES') {
      clearBadges();
      sendResponse({ success: true });
      return true;
    }
  });

  // ── Visibility ──────────────────────────────────────────────────
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect  = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.bottom > 0 && rect.top < window.innerHeight &&
      rect.right  > 0 && rect.left < window.innerWidth &&
      rect.width  > 4 && rect.height > 4 &&
      style.visibility !== 'hidden' &&
      style.display    !== 'none'  &&
      parseFloat(style.opacity)    > 0.05
    );
  }

  function isInteractableRect(rect) {
    if (!rect) return false;
    return rect.width > 4 && rect.height > 4;
  }

  // ── Element description ─────────────────────────────────────────
  function serializeElementForDescription(el) {
    const tag = String(el.tagName || '').toLowerCase();
    const type = el.getAttribute?.('type') || '';

    return {
      tag,
      type,
      ariaLabel: el.getAttribute?.('aria-label') || '',
      testId: el.getAttribute?.('data-testid') || '',
      placeholder: el.getAttribute?.('placeholder') || '',
      labelText: '',
      title: el.getAttribute?.('title') || '',
      alt: el.getAttribute?.('alt') || '',
      name: el.getAttribute?.('name') || '',
      value: (el.getAttribute?.('value') || el.value || ''),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 120)
    };
  }

  // ── Build DOM map ───────────────────────────────────────────────
  async function buildDomMap(options = {}) {
    const maxElements = Math.min(Number(options.maxElements) || MAX_ELEMENTS, MAX_ELEMENTS);
    const includeBadges = !!options.showBadges;
    if (options.lazyLoad !== false) await triggerLazyLoadScroll();
    clearBadges();
    if (options.cleanup !== false) dismissCookieBanners();
    elementMap = [];
    let idCounter = 0;
    let domString = '';

    const selectors = [
      'a[href]', 'button', 'input:not([type="hidden"])',
      'textarea', 'select',
      '[role="button"]', '[role="link"]', '[role="menuitem"]',
      '[role="option"]', '[role="tab"]', '[role="textbox"]',
      '[role="searchbox"]', '[role="combobox"]',
      '[contenteditable="true"]',
      '[onclick]:not(html):not(body)',
    ];

    const seen     = new Set();
    const root = currentIframe?.contentDocument || document;

    function collectAllElements(rootNode, depth = 0) {
      if (depth > 6) return []; // increased from 4 to 6
      
      const elements = [];
      const walker = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_ELEMENT,
        null
      );
      
      let node;
      while (node = walker.nextNode()) {
        if (node.matches && node.matches(selectors.join(','))) {
          elements.push(node);
        } else if (node.tagName === 'IFRAME') {
          elements.push(node);
        }
        
        // Pierce shadow roots
        if (node.shadowRoot) {
          elements.push(...collectAllElements(node.shadowRoot, depth + 1));
        }
        // Also check open iframes (same origin only)
        if (node.tagName === 'IFRAME') {
          try {
            if (node.contentDocument) {
              elements.push(...collectAllElements(node.contentDocument.body, depth + 1));
            }
          } catch(e) {} // cross-origin iframes will throw, ignore
        }
      }
      return elements;
    }
    
    // Get the root itself if it matches (tree walker doesn't always yield root)
    let elements = collectAllElements(root, 0);
    if (root.matches && root.matches(selectors.join(','))) {
      elements.unshift(root);
    }

    const measured = [];
    const scanLimit = Math.min(elements.length, Math.max(maxElements * 2, 220));
    for (let i = 0; i < scanLimit; i++) {
      const el = elements[i];
      if (seen.has(el)) continue;
      seen.add(el);
      measured.push({ el, rect: el.getBoundingClientRect() });
    }

    const viewport = [];
    const belowFold = [];
    for (const item of measured) {
      if (!isInteractableRect(item.rect)) continue;
      const inViewport = item.rect.bottom > -200 && item.rect.top < window.innerHeight + (window.innerHeight * 2);
      if (inViewport) viewport.push(item);
      else belowFold.push(item);
    }

    const ordered = viewport.concat(belowFold);
    const selected = ordered.slice(0, maxElements);
    
    function describeElement(el) {
      const tag = String(el.tagName || '').toLowerCase();
      
      const text = (
        el.getAttribute?.('aria-label') ||
        el.getAttribute?.('title') ||
        el.getAttribute?.('placeholder') ||
        el.getAttribute?.('alt') ||
        el.getAttribute?.('name') ||
        el.getAttribute?.('data-testid') ||
        el.innerText?.trim() ||
        el.textContent?.trim() ||
        el.value ||
        ''
      ).slice(0, 80);
      
      const role = el.getAttribute?.('role') || '';
      const type = el.getAttribute?.('type') || '';
      let href = '';
      try {
        if (el.href) href = ` → ${new URL(el.href).pathname}`;
      } catch(e) {}
      
      const nearbyHeading = el.closest?.('section, article, nav, header, main')
        ?.querySelector('h1,h2,h3')?.innerText?.slice(0, 30) || '';
      const context = nearbyHeading ? ` [in: ${nearbyHeading}]` : '';
      
      return `[${tag}${type ? ':'+type : ''}${role ? ' role='+role : ''}] "${text}"${href}${context}`;
    }

    const descriptionLines = selected.map(item => describeElement(item.el));

    selected.forEach((item, index) => {
      const rect = item.rect;
      const id = idCounter++;
      const el = item.el;
      elementMap[id] = el;

      const foldState = (rect.top >= 0 && rect.bottom <= window.innerHeight) ? '[visible]' : '[below-fold]';
      const iframeLabel = String(el.tagName || '').toLowerCase() === 'iframe'
        ? (' [iframe:' + safeHost(el.src || '') + ']')
        : '';

      if (includeBadges) {
        try {
          const badge = document.createElement('div');
          badge.className = '__ZANYSURF_badge';
          badge.textContent = id;
          Object.assign(badge.style, {
            position: 'fixed',
            left: Math.max(0, Math.round(rect.left)) + 'px',
            top:  Math.max(0, Math.round(rect.top))  + 'px',
            background: '#6366f1',
            color: '#fff',
            fontSize: '9px',
            fontWeight: 'bold',
            padding: '1px 3px',
            borderRadius: '3px',
            zIndex: '2147483647',
            pointerEvents: 'none',
            lineHeight: '1',
            border: '1px solid rgba(255,255,255,0.6)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
            userSelect: 'none',
          });
          document.body.appendChild(badge);
        } catch (_) {}
      }

      domString += '[' + id + '] ' + foldState + iframeLabel + ' ' + (descriptionLines[index] || '<unknown> ""') + '\n';
    });

    return {
      domString: domString.trim(),
      count: idCounter,
      meta: {
        pageType: detectPageType(),
        sections: extractSemanticSections(),
        primaryCTA: findPrimaryCTA(),
        media: extractMediaContext(),
        mappedCount: idCounter,
        totalCandidates: measured.length,
        maxElements
      }
    };
  }

  async function buildDescriptionLines(serialized, totalCandidates) {
    const fallback = (serialized || []).map(item => toDescriptionLine(item));
    if (!serialized?.length) return fallback;
    if (totalCandidates <= 300 || !DOM_TEXT_WORKER_URL || typeof Worker === 'undefined') return fallback;

    try {
      const worker = new Worker(DOM_TEXT_WORKER_URL);
      const result = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          worker.terminate();
          resolve(null);
        }, 450);
        worker.onmessage = (event) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve(event.data?.lines || null);
        };
        worker.onerror = () => {
          clearTimeout(timeout);
          worker.terminate();
          resolve(null);
        };
        worker.postMessage({ items: serialized });
      });
      return Array.isArray(result) && result.length === serialized.length ? result : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function toDescriptionLine(item) {
    const tag = item.tag || 'div';
    const type = item.type ? (' type="' + item.type + '"') : '';
    const text = (
      item.ariaLabel ||
      item.testId ||
      item.placeholder ||
      item.labelText ||
      item.title ||
      item.alt ||
      item.name ||
      item.text ||
      item.value ||
      ''
    ).trim().substring(0, 60);
    return '<' + tag + type + '> "' + text + '"';
  }

  function dismissCookieBanners() {
    const patterns = [
      'accept all','accept all cookies','accept cookies','i agree',
      'agree and proceed','allow all','allow all cookies','ok, got it',
      'got it','allow cookies','agree','yes, i agree','continue','dismiss',
      'close and accept','accept & continue','accept and continue'
    ];
    try {
      document.querySelectorAll('button, a[role="button"], [role="button"]').forEach(el => {
        if (!isVisible(el)) return;
        const text = (el.innerText || el.textContent || '').toLowerCase().replace(/\s+/g,' ').trim();
        if (patterns.some(p => text === p || text.startsWith(p + ' '))) {
          el.click();
        }
      });
    } catch (_) {}
  }

  function clearBadges() {
    document.querySelectorAll('.__ZANYSURF_badge').forEach(b => b.remove());
  }

  async function triggerLazyLoadScroll() {
    const startY = window.scrollY;
    let lastHeight = document.body?.scrollHeight || 0;
    for (let i = 0; i < 5; i++) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
      await sleep(220);
      const currentHeight = document.body?.scrollHeight || 0;
      if (currentHeight <= lastHeight + 32) break;
      lastHeight = currentHeight;
    }
    window.scrollTo({ top: startY, behavior: 'auto' });
    await sleep(120);
  }

  // ── React-compatible value setter ───────────────────────────────
  function setNativeValue(el, value) {
    const proto    = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Action executor ─────────────────────────────────────────────
  async function executeAction(command) {
    const { action, element_id, value } = command;
    const el = elementMap[element_id];

    switch (action) {

      case 'click': {
        if (!el) throw new Error('Element ' + element_id + ' not found in current DOM map');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);
        el.focus();
        const events = ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'];
        events.forEach(type =>
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
        );
        el.click();
        return 'clicked element ' + element_id;
      }

      case 'drag_drop': {
        const from = el || elementMap[command.fromId];
        const to = elementMap[command.toId];
        const fromX = Number.isFinite(Number(command.fromX)) ? Number(command.fromX) : null;
        const fromY = Number.isFinite(Number(command.fromY)) ? Number(command.fromY) : null;
        const toX = Number.isFinite(Number(command.toX)) ? Number(command.toX) : null;
        const toY = Number.isFinite(Number(command.toY)) ? Number(command.toY) : null;

        const startPoint = from ? centerOf(from) : { x: fromX, y: fromY };
        const endPoint = to ? centerOf(to) : { x: toX, y: toY };
        if (!Number.isFinite(startPoint?.x) || !Number.isFinite(startPoint?.y) || !Number.isFinite(endPoint?.x) || !Number.isFinite(endPoint?.y)) {
          throw new Error('drag_drop requires from/to IDs or coordinates');
        }

        const startTarget = document.elementFromPoint(startPoint.x, startPoint.y);
        const endTarget = document.elementFromPoint(endPoint.x, endPoint.y) || startTarget;
        if (!startTarget || !endTarget) throw new Error('Unable to resolve drag targets');

        const dataTransfer = new DataTransfer();
        startTarget.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer, clientX: startPoint.x, clientY: startPoint.y }));
        startTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: startPoint.x, clientY: startPoint.y }));
        endTarget.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX: endPoint.x, clientY: endPoint.y }));
        endTarget.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: endPoint.x, clientY: endPoint.y }));
        endTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: endPoint.x, clientY: endPoint.y }));
        endTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: endPoint.x, clientY: endPoint.y }));
        startTarget.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer, clientX: endPoint.x, clientY: endPoint.y }));
        return 'drag_drop completed';
      }

      case 'click_coords': {
        const x = Number(command.x);
        const y = Number(command.y);
        if (Number.isNaN(x) || Number.isNaN(y)) throw new Error('click_coords requires numeric x and y');

        const clampedX = Math.max(1, Math.min(window.innerWidth - 1, Math.round(x)));
        const clampedY = Math.max(1, Math.min(window.innerHeight - 1, Math.round(y)));
        const target = document.elementFromPoint(clampedX, clampedY);
        if (!target) throw new Error('No element found at coordinates (' + clampedX + ',' + clampedY + ')');

        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        await sleep(200);
        ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'].forEach(type => {
          target.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: clampedX,
            clientY: clampedY
          }));
        });
        target.click?.();
        return 'clicked coordinates (' + clampedX + ', ' + clampedY + ')';
      }

      case 'type': {
        if (!el) throw new Error('Element ' + element_id + ' not found in current DOM map');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(250);
        el.focus();
        el.select && el.select();

        // Clear first
        setNativeValue(el, '');

        // Type char by char for frameworks
        for (const char of (value || '')) {
          const kp = { key: char, bubbles: true, cancelable: true };
          el.dispatchEvent(new KeyboardEvent('keydown',  kp));
          el.dispatchEvent(new KeyboardEvent('keypress', kp));
          setNativeValue(el, (el.value || '') + char);
          el.dispatchEvent(new KeyboardEvent('keyup', kp));
          await sleep(12);
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'typed "' + (value || '').substring(0, 40) + '" into element ' + element_id;
      }

      case 'key': {
        const target = el || document.activeElement || document.body;
        const key    = value || 'Enter';
        const keyMap = { Enter: 13, Tab: 9, Escape: 27, ArrowDown: 40, ArrowUp: 38, Space: 32, Backspace: 8 };
        const keyCode = keyMap[key] || key.charCodeAt(0);

        ['keydown', 'keypress', 'keyup'].forEach(type =>
          target.dispatchEvent(new KeyboardEvent(type, {
            key, keyCode, which: keyCode, code: 'Key' + key,
            bubbles: true, cancelable: true
          }))
        );

        // Submit form on Enter
        if (key === 'Enter') {
          const form = (el || document.activeElement)?.closest('form');
          if (form) {
            try { form.requestSubmit(); } catch (_) {
              try { form.submit(); } catch (_) {}
            }
          }
        }
        return 'pressed key ' + key;
      }

      case 'select': {
        if (!el) throw new Error('Element ' + element_id + ' not found');
        if (el.tagName.toLowerCase() !== 'select') throw new Error('Element is not a <select>');
        const options = Array.from(el.options);
        const opt = options.find(o =>
          o.text.toLowerCase().includes((value || '').toLowerCase()) ||
          o.value.toLowerCase().includes((value || '').toLowerCase())
        );
        if (!opt) throw new Error('Option "' + value + '" not found. Available: ' + options.map(o => o.text).join(', '));
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        return 'selected "' + opt.text + '" in element ' + element_id;
      }

      case 'hover': {
        if (!el) throw new Error('Element ' + element_id + ' not found');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(200);
        ['mouseenter', 'mouseover', 'mousemove'].forEach(type =>
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
        );
        return 'hovered over element ' + element_id;
      }

      case 'scroll': {
        if (value === 'top') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (value === 'up') {
          window.scrollBy({ top: -700, behavior: 'smooth' });
        } else {
          window.scrollBy({ top: 700, behavior: 'smooth' });
        }
        return 'scrolled ' + (value || 'down');
      }

      case 'wait': {
        await sleep(Math.min(parseInt(value) || 1000, 8000));
        return 'waited';
      }

      case 'extract_data': {
        const extracted = extractStructuredData(String(value || ''));
        return JSON.stringify(extracted);
      }

      case 'extract_text': {
        const cleanText = extractCleanArticleText();
        const headings = [...document.querySelectorAll('h1, h2, h3')]
          .map(node => (node.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 40);
        const words = cleanText ? cleanText.split(/\s+/).filter(Boolean) : [];
        const payload = {
          mode: 'text',
          url: window.location.href,
          title: document.title,
          headings,
          wordCount: words.length,
          text: cleanText.substring(0, 24000),
          extractedAt: Date.now()
        };
        return JSON.stringify(payload);
      }

      case 'upload_file': {
        const target = el || elementMap[command.element_id];
        if (!target) throw new Error('upload_file target not found');
        if (String(target.tagName || '').toLowerCase() !== 'input' || String(target.type || '').toLowerCase() !== 'file') {
          throw new Error('Target element is not a file input');
        }
        const fileName = String(command.fileName || 'upload.txt');
        const mimeType = String(command.mimeType || 'text/plain');
        const base64 = String(command.fileBase64 || '').replace(/^data:[^;]+;base64,/, '');
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const file = new File([bytes], fileName, { type: mimeType });
        const dt = new DataTransfer();
        dt.items.add(file);
        target.files = dt.files;
        target.dispatchEvent(new Event('change', { bubbles: true }));
        target.dispatchEvent(new Event('input', { bubbles: true }));
        return 'uploaded file ' + fileName;
      }

      case 'enter_iframe': {
        const frame = el || elementMap[command.element_id];
        if (!frame || String(frame.tagName || '').toLowerCase() !== 'iframe') {
          throw new Error('enter_iframe requires iframe element');
        }
        try {
          if (!frame.contentDocument) throw new Error('Cross-origin iframe');
          currentIframe = frame;
          return 'entered iframe context';
        } catch (_) {
          throw new Error('Cross-origin iframe cannot be scripted directly. Use fallback actions.');
        }
      }

      case 'exit_iframe': {
        currentIframe = null;
        return 'exited iframe context';
      }

      case 'context_click': {
        if (!el) throw new Error('Element ' + element_id + ' not found');
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, buttons: 2 }));
        return 'context click opened';
      }

      case 'shortcut': {
        const keys = Array.isArray(command.keys) ? command.keys : String(command.value || '').split('+').map(k => k.trim());
        const normalized = keys.map(k => k.toLowerCase());
        const main = keys.find(k => !['ctrl', 'control', 'alt', 'shift', 'meta', 'cmd', 'command'].includes(k.toLowerCase())) || 'k';
        const ctrlKey = normalized.includes('ctrl') || normalized.includes('control');
        const altKey = normalized.includes('alt');
        const shiftKey = normalized.includes('shift');
        const metaKey = normalized.includes('meta') || normalized.includes('cmd') || normalized.includes('command');
        const target = document.activeElement || document.body;
        ['keydown', 'keyup'].forEach(type => {
          target.dispatchEvent(new KeyboardEvent(type, {
            key: main,
            code: main.length === 1 ? ('Key' + main.toUpperCase()) : main,
            bubbles: true,
            cancelable: true,
            ctrlKey,
            altKey,
            shiftKey,
            metaKey
          }));
        });
        return 'shortcut executed: ' + keys.join('+');
      }

      case 'compose_email': {
        const payload = parseFormPayload(value);
        const result = composeEmail(payload);
        return JSON.stringify(result);
      }

      case 'book_slot': {
        const payload = parseFormPayload(value);
        const booking = bookPreferredSlot(payload);
        return JSON.stringify(booking);
      }

      case 'edge_ai_prompt': {
        const output = await callEdgeBuiltinPrompt(String(value || ''));
        return output;
      }

      case 'execute_js': {
        const preset = String(command.preset || '').trim();
        const args = Array.isArray(command.args) ? command.args : [];
        if (!preset) throw new Error('execute_js requires preset');
        if (!Object.prototype.hasOwnProperty.call(JS_PRESETS, preset)) {
          throw new Error('Preset not found. Available: ' + Object.keys(JS_PRESETS).join(', '));
        }
        const handler = JS_PRESETS[preset];
        const result = handler(...args);
        return JSON.stringify({ ok: true, result });
      }

      case 'inspect_form': {
        const inspection = inspectVisibleForm();
        return JSON.stringify(inspection);
      }

      case 'fill_form': {
        const payload = parseFormPayload(value);
        const result = fillVisibleForm(payload);
        return JSON.stringify(result);
      }

      default:
        throw new Error('Unknown action: ' + action);
    }
  }

  function composeEmail(payload) {
    const to = payload.to || payload.recipient || '';
    const subject = payload.subject || '';
    const body = payload.body || payload.message || '';
    const profileTone = (payload.tone || 'formal').toLowerCase();
    fillVisibleForm({
      to,
      recipient: to,
      subject,
      body: applyTone(body, profileTone),
      message: applyTone(body, profileTone)
    });
    return { success: true, to, subject, tone: profileTone };
  }

  function applyTone(text, tone) {
    const msg = String(text || '');
    if (tone === 'casual') return 'Hi there,\n\n' + msg;
    if (tone === 'assertive') return 'Please action the following:\n\n' + msg;
    return 'Dear Team,\n\n' + msg;
  }

  function bookPreferredSlot(payload) {
    const slots = [...document.querySelectorAll('[data-testid*="slot"], button, [role="button"]')]
      .filter(node => isVisible(node))
      .map(node => ({
        text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
        node
      }))
      .filter(item => /am|pm|:\d{2}|\d{1,2}\s?(am|pm)/i.test(item.text));
    const pref = String(payload.preference || 'morning').toLowerCase();
    const match = slots.find(item => pref === 'morning' ? /am/i.test(item.text) : /pm/i.test(item.text)) || slots[0];
    if (!match) return { success: false, message: 'No visible booking slots found' };
    match.node.click();
    return { success: true, selected: match.text };
  }

  async function callEdgeBuiltinPrompt(prompt) {
    const edgeAi = window.ai;
    if (!edgeAi || typeof edgeAi.createTextSession !== 'function') {
      throw new Error('Edge built-in AI not available. Use a supported Edge build and enable AI APIs in edge://flags.');
    }
    const session = await edgeAi.createTextSession();
    try {
      const result = await session.prompt(String(prompt || ''));
      if (typeof result === 'string') return result;
      if (result?.text) return String(result.text);
      return JSON.stringify(result || {});
    } finally {
      try { await session.destroy?.(); } catch (_) {}
    }
  }

  function centerOf(node) {
    const rect = node.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2)
    };
  }

  function safeHost(url) {
    try { return new URL(url).hostname; } catch (_) { return 'unknown'; }
  }

  function detectPageType() {
    const url = window.location.href;
    if (document.querySelector('article') && document.querySelectorAll('p').length > 12) return 'article';
    if (document.querySelector('input[type="search"], [role="searchbox"]') && /search|q=/.test(url)) return 'search-results';
    if (document.querySelector('[itemprop="price"], [class*="price" i]')) return 'product';
    if (document.querySelectorAll('form input, form select, form textarea').length > 3) return 'form';
    if (document.querySelectorAll('[role="feed"], article').length > 10) return 'social-feed';
    if (/github\.com/.test(url) && document.querySelector('[data-testid="repository-container-header"]')) return 'code-repo';
    if (document.querySelector('[class*="dashboard" i], [data-dashboard]')) return 'dashboard';
    return 'generic';
  }

  function extractSemanticSections() {
    const sections = {
      header: !!document.querySelector('header, [role="banner"]'),
      main: !!document.querySelector('main, [role="main"]'),
      sidebar: !!document.querySelector('aside, [role="complementary"]'),
      footer: !!document.querySelector('footer, [role="contentinfo"]'),
      modals: document.querySelectorAll('[role="dialog"], .modal, [aria-modal="true"]').length,
      overlays: document.querySelectorAll('[class*="overlay" i], [class*="backdrop" i]').length
    };
    return sections;
  }

  function findPrimaryCTA() {
    const candidates = [...document.querySelectorAll('button, a[role="button"], [role="button"]')]
      .filter(node => isVisible(node))
      .map(node => ({
        text: (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
        score: computeCtaScore(node)
      }))
      .sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }

  function computeCtaScore(node) {
    const text = (node.innerText || '').toLowerCase();
    let score = 0;
    if (/buy|checkout|submit|start|continue|book|apply|sign up|get started/.test(text)) score += 3;
    const style = window.getComputedStyle(node);
    if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)') score += 1;
    const rect = node.getBoundingClientRect();
    if (rect.width > 90 && rect.height > 28) score += 1;
    return score;
  }

  function extractCleanArticleText() {
    const article = document.querySelector('article, main') || document.body;
    const clone = article.cloneNode(true);
    clone.querySelectorAll('nav, footer, aside, [role="navigation"], [class*="ad" i], script, style').forEach(node => node.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 18000);
  }

  function extractMediaContext() {
    const videos = [...document.querySelectorAll('video')];
    const audios = [...document.querySelectorAll('audio')];
    const youtubeMeta = {
      title: (document.querySelector('h1.ytd-watch-metadata, h1.title')?.textContent || document.title || '').trim(),
      channel: (document.querySelector('#owner #channel-name a, ytd-channel-name a')?.textContent || '').trim(),
      duration: (document.querySelector('.ytp-time-duration')?.textContent || '').trim()
    };
    return {
      hasMedia: videos.length + audios.length > 0,
      videoCount: videos.length,
      audioCount: audios.length,
      youtube: youtubeMeta,
      transcriptionHint: videos.length ? 'Video detected: captions/transcript may be needed.' : ''
    };
  }

  function installNetworkHooks() {
    if (networkHookInstalled) return;
    networkHookInstalled = true;
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const startedAt = Date.now();
      try {
        const response = await originalFetch.apply(this, args);
        const clone = response.clone();
        const contentType = clone.headers.get('content-type') || '';
        let bodySnippet = '';
        if (/json|text/.test(contentType)) {
          bodySnippet = (await clone.text()).substring(0, 1200);
        }
        networkBuffer.push({
          type: 'fetch',
          url: String(args[0] || ''),
          status: response.status,
          durationMs: Date.now() - startedAt,
          bodySnippet,
          ts: Date.now()
        });
        if (networkBuffer.length > 240) networkBuffer.splice(0, networkBuffer.length - 240);
        return response;
      } catch (error) {
        networkBuffer.push({ type: 'fetch_error', url: String(args[0] || ''), error: error.message, ts: Date.now() });
        throw error;
      }
    };

    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__zanysurf_meta = { method, url, startedAt: Date.now() };
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      this.addEventListener('loadend', () => {
        const meta = this.__zanysurf_meta || {};
        let responseSnippet = '';
        try {
          responseSnippet = String(this.responseText || '').substring(0, 1200);
        } catch (_) {}
        networkBuffer.push({
          type: 'xhr',
          method: meta.method,
          url: meta.url,
          status: this.status,
          durationMs: Date.now() - (meta.startedAt || Date.now()),
          bodySnippet: responseSnippet,
          ts: Date.now()
        });
        if (networkBuffer.length > 240) networkBuffer.splice(0, networkBuffer.length - 240);
      });
      return send.apply(this, arguments);
    };

    window.addEventListener('error', (event) => {
      networkBuffer.push({ type: 'console_error', message: String(event.message || 'Unknown page error'), ts: Date.now() });
      if (networkBuffer.length > 240) networkBuffer.splice(0, networkBuffer.length - 240);
    });
  }

  function extractStructuredData(mode) {
    const rawText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const modeText = (mode || '').toLowerCase();

    const prices = [...new Set((rawText.match(/(?:\$|£|€)\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g) || []).slice(0, 40))];
    const emails = [...new Set((rawText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).slice(0, 40))];

    const nameCandidates = [];
    document.querySelectorAll('h1, h2, h3, [itemprop="name"], [data-testid*="title"], a, strong').forEach(el => {
      if (!isVisible(el)) return;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 4 && text.length <= 80 && /[A-Za-z]/.test(text)) {
        nameCandidates.push(text);
      }
    });
    const names = [...new Set(nameCandidates)].slice(0, 40);

    const tables = [];
    document.querySelectorAll('table').forEach((tableEl, tableIndex) => {
      if (!isVisible(tableEl)) return;
      const rows = [];
      tableEl.querySelectorAll('tr').forEach(row => {
        const cols = [...row.querySelectorAll('th,td')].map(cell => (cell.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (cols.length) rows.push(cols);
      });
      if (rows.length) {
        tables.push({ index: tableIndex, rows: rows.slice(0, 60) });
      }
    });

    return {
      mode: modeText || 'general',
      url: window.location.href,
      title: document.title,
      prices: modeText && !modeText.includes('price') ? prices.slice(0, 10) : prices,
      emails,
      names,
      tables,
      extractedAt: Date.now()
    };
  }

  function inspectVisibleForm() {
    const fields = [];
    const candidates = [...document.querySelectorAll('input, textarea, select')];
    candidates.forEach((el, index) => {
      if (!isVisible(el)) return;
      const descriptor = getFieldDescriptor(el, index);
      fields.push(descriptor);
    });

    const invalid = fields.filter(field => field.required && !field.value);
    return {
      url: window.location.href,
      title: document.title,
      totalFields: fields.length,
      requiredMissing: invalid.map(f => f.key),
      fields: fields.slice(0, 120)
    };
  }

  function getFieldDescriptor(el, index) {
    const labelText = readLabelText(el);
    const key = (
      el.name ||
      el.id ||
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      (labelText || 'field_' + index)
    ).toLowerCase().replace(/\s+/g, '_');

    return {
      key,
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute('type') || '').toLowerCase() || 'text',
      required: !!(el.required || el.getAttribute('aria-required') === 'true'),
      label: labelText,
      placeholder: el.getAttribute('placeholder') || '',
      name: el.name || '',
      id: el.id || '',
      value: el.value || ''
    };
  }

  function parseFormPayload(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(value);
    } catch (_) {
      return {};
    }
  }

  function fillVisibleForm(payload) {
    const errors = [];
    let filledCount = 0;
    const candidates = [...document.querySelectorAll('input, textarea, select')];

    candidates.forEach((el, index) => {
      if (!isVisible(el) || el.disabled || el.readOnly) return;
      const descriptor = getFieldDescriptor(el, index);
      const value = resolveFieldValue(descriptor, payload);
      if (value === undefined || value === null || value === '') return;

      try {
        if (el.tagName.toLowerCase() === 'select') {
          const options = Array.from(el.options || []);
          const target = options.find(option =>
            option.value.toLowerCase() === String(value).toLowerCase() ||
            option.text.toLowerCase().includes(String(value).toLowerCase())
          );
          if (target) {
            el.value = target.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            filledCount++;
          }
        } else if ((descriptor.type === 'checkbox' || descriptor.type === 'radio')) {
          const shouldCheck = ['true', 'yes', '1', 'on'].includes(String(value).toLowerCase());
          el.checked = shouldCheck;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          filledCount++;
        } else {
          setNativeValue(el, String(value));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          filledCount++;
        }

        if (typeof el.checkValidity === 'function' && !el.checkValidity()) {
          errors.push({ field: descriptor.key, message: el.validationMessage || 'Invalid value' });
        }
      } catch (error) {
        errors.push({ field: descriptor.key, message: error.message });
      }
    });

    document.querySelectorAll('[aria-invalid="true"], .error, .field-error, .invalid-feedback').forEach((node) => {
      if (!isVisible(node)) return;
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) errors.push({ field: 'ui', message: text });
    });

    return {
      filledCount,
      validationErrors: [...new Map(errors.map(err => [err.field + '|' + err.message, err])).values()],
      success: errors.length === 0
    };
  }

  function resolveFieldValue(descriptor, payload) {
    const keys = [
      descriptor.key,
      descriptor.name,
      descriptor.id,
      descriptor.label,
      descriptor.placeholder,
      descriptor.type
    ]
      .filter(Boolean)
      .map(key => String(key).toLowerCase().replace(/\s+/g, '_'));

    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) return payload[key];
    }

    const semanticDefaults = {
      email: 'user@example.com',
      first_name: 'Alex',
      last_name: 'Taylor',
      fullname: 'Alex Taylor',
      full_name: 'Alex Taylor',
      phone: '+15551234567',
      city: 'San Francisco',
      country: 'United States',
      company: 'ZANYSURF',
      website: 'https://example.com',
      linkedin: 'https://www.linkedin.com/in/alex-taylor',
      github: 'https://github.com/alextaylor'
    };

    for (const [semanticKey, semanticValue] of Object.entries(semanticDefaults)) {
      if (keys.some(key => key.includes(semanticKey))) return semanticValue;
    }

    return undefined;
  }

  function readLabelText(el) {
    try {
      if (el.id) {
        const label = document.querySelector('label[for=' + JSON.stringify(el.id) + ']');
        if (label) return (label.textContent || '').replace(/\s+/g, ' ').trim();
      }
      const wrapLabel = el.closest('label');
      if (wrapLabel) return (wrapLabel.textContent || '').replace(/\s+/g, ' ').trim();
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel;
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const joined = labelledBy
          .split(/\s+/)
          .map(id => document.getElementById(id)?.textContent || '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (joined) return joined;
      }
    } catch (_) {}
    return '';
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}




