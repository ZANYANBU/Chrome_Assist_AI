/**
 * ZANYSURF AI Browser Agent - Content Script v4
 * DOM annotation, element mapping, and robust action execution.
 * Handles vanilla JS, React, Vue, Angular, and Shadow DOM.
 */

if (!window.__ZANYSURF_agent_initialized) {
  window.__ZANYSURF_agent_initialized = true;

  let elementMap = [];

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_DOM') {
      try {
        const result = buildDomMap();
        sendResponse({ dom: result.domString, title: document.title, url: window.location.href });
      } catch (e) {
        sendResponse({ dom: '', title: document.title, url: window.location.href });
      }
      return true;
    }
    if (request.action === 'EXECUTE') {
      executeAction(request.command)
        .then(result => sendResponse({ success: true, result }))
        .catch(err   => sendResponse({ success: false, error: err.message }));
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

  // ── Element description ─────────────────────────────────────────
  function getElementDescription(el) {
    const tag  = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || '';

    let labelText = '';
    if (el.id) {
      const lbl = document.querySelector('label[for=' + JSON.stringify(el.id) + ']');
      if (lbl) labelText = lbl.innerText.trim();
    }

    const text = (
      el.getAttribute('aria-label')    ||
      el.getAttribute('data-testid')   ||
      el.getAttribute('placeholder')   ||
      labelText                        ||
      el.getAttribute('title')         ||
      el.getAttribute('alt')           ||
      el.getAttribute('name')          ||
      (el.innerText || '').replace(/\s+/g, ' ').trim() ||
      el.getAttribute('value')         ||
      ''
    ).trim().substring(0, 60);

    return '<' + tag + (type ? ' type="' + type + '"' : '') + '> "' + text + '"';
  }

  // ── Build DOM map ───────────────────────────────────────────────
  function buildDomMap() {
    clearBadges();
    dismissCookieBanners();
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
    const elements = [...document.querySelectorAll(selectors.join(','))];

    // Shadow DOM traversal (up to depth 4)
    function collectShadow(root, depth) {
      if (depth > 4) return;
      try {
        root.querySelectorAll('*').forEach(el => {
          if (el.shadowRoot) {
            collectShadow(el.shadowRoot, depth + 1);
            try {
              el.shadowRoot.querySelectorAll(selectors.join(',')).forEach(s => elements.push(s));
            } catch (_) {}
          }
        });
      } catch (_) {}
    }
    collectShadow(document, 0);

    elements.forEach(el => {
      if (seen.has(el)) return;
      seen.add(el);
      if (!isVisible(el)) return;

      const rect = el.getBoundingClientRect();
      const id   = idCounter++;
      elementMap[id] = el;

      // Visual badge overlay
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

      domString += '[' + id + '] ' + getElementDescription(el) + '\n';
    });

    return { domString: domString.trim(), count: idCounter };
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

      default:
        throw new Error('Unknown action: ' + action);
    }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

