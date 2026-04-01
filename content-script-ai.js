// content-script-ai.js — Injected into Gemini pages
// Auto-fills input, submits, monitors response

(function () {
  if (window.__psfAiScriptLoaded) return;
  window.__psfAiScriptLoaded = true;

  let selectorConfig = null;
  let responseObserver = null;
  let lastResponseText = '';
  let lastResponseLength = 0;
  let stableCount = 0;
  let pollResponseInterval = null;
  let monitorTimer = null;
  let findTimer = null;
  let fillId = 0;
  let lastCapturedText = '';
  const STABLE_CHECKS_NEEDED = 3;
  const CHECK_INTERVAL_MS = 800;

  async function loadSelectors() {
    try {
      const url = chrome.runtime.getURL('selectors/gemini.json');
      const r = await fetch(url);
      selectorConfig = await r.json();
    } catch (e) {
      console.warn('[解題心流] Failed to load selectors', e);
    }
  }

  function qs(selectors) {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  // ── Editor activation (proven working) ──

  function activateEditor(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function selectAllContent(el) {
    el.focus();
    document.execCommand('selectAll', false, null);
    const sel = window.getSelection();
    if (!sel.rangeCount || !el.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function simulateInput(el, text) {
    console.log('[解題心流] simulateInput START, textLen:', text.length,
      'editorContent:', el.textContent.length,
      'editorTag:', el.tagName, 'editorClass:', el.className,
      'contentEditable:', el.contentEditable,
      'isConnected:', el.isConnected);

    activateEditor(el);
    console.log('[解題心流] activateEditor done');

    // Clear existing content (DO NOT use innerHTML — breaks Quill)
    if (el.textContent.trim().length > 0) {
      console.log('[解題心流] Clearing content...');
      selectAllContent(el);
      document.execCommand('delete', false, null);
      activateEditor(el);
      console.log('[解題心流] After clear:', el.textContent.length);
    }

    // Strategy 1: execCommand insertText
    el.focus();
    const s1 = document.execCommand('insertText', false, text);
    const s1len = el.textContent.trim().length;
    console.log('[解題心流] Strategy1 execCommand:', s1, 'contentAfter:', s1len);
    if (s1 && s1len > 0) return true;

    // Strategy 2: ClipboardEvent paste
    try {
      activateEditor(el);
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: dt
      }));
      const s2len = el.textContent.trim().length;
      console.log('[解題心流] Strategy2 paste, contentAfter:', s2len);
      if (s2len > 0) return true;
    } catch (e) { console.log('[解題心流] Strategy2 error:', e.message); }

    // Strategy 3: InputEvent
    try {
      activateEditor(el);
      const dt2 = new DataTransfer();
      dt2.setData('text/plain', text);
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertFromPaste', dataTransfer: dt2
      }));
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: false, inputType: 'insertFromPaste', dataTransfer: dt2
      }));
      const s3len = el.textContent.trim().length;
      console.log('[解題心流] Strategy3 inputEvent, contentAfter:', s3len);
      if (s3len > 0) return true;
    } catch (e) { console.log('[解題心流] Strategy3 error:', e.message); }

    // Strategy 4: Direct DOM (last resort)
    console.log('[解題心流] Strategy4 directDOM');
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    const s4len = el.textContent.trim().length;
    console.log('[解題心流] Strategy4 contentAfter:', s4len);
    return s4len > 0;
  }

  function clickSubmit() {
    const btn = qs(selectorConfig.submitSelectors);
    if (btn && !btn.disabled) { btn.click(); return true; }
    const input = qs(selectorConfig.inputSelectors);
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
      }));
      return true;
    }
    return false;
  }

  // ── Response monitoring (proven working) ──

  function startResponseMonitoring() {
    stopResponseMonitoring();
    lastResponseText = '';
    lastResponseLength = 0;
    stableCount = 0;
    const myId = fillId;

    monitorTimer = setTimeout(() => {
      if (fillId !== myId) return;
      const findResponse = () => {
        if (fillId !== myId) return;
        const el = qs(selectorConfig.responseSelectors);
        if (!el) { findTimer = setTimeout(findResponse, 300); return; }

        responseObserver = new MutationObserver(() => { stableCount = 0; });
        responseObserver.observe(el.parentElement || el, {
          childList: true, subtree: true, characterData: true
        });
        pollResponseInterval = setInterval(() => {
          if (fillId !== myId) { stopResponseMonitoring(); return; }
          checkStability();
        }, CHECK_INTERVAL_MS);
      };
      findResponse();
    }, 1000);
  }

  function getLatestResponseText() {
    let latest = null;
    for (const sel of selectorConfig.responseSelectors) {
      document.querySelectorAll(sel).forEach(el => { latest = el; });
    }
    return latest ? (latest.innerText || '').trim() : '';
  }

  function checkStability() {
    const text = getLatestResponseText();
    const len = text.length;

    const stopBtn = qs(selectorConfig.stopButtonSelectors || []);
    if (stopBtn && stopBtn.offsetParent !== null) {
      stableCount = 0; lastResponseLength = len; lastResponseText = text;
      return;
    }
    if (len === 0) { stableCount = 0; return; }

    if (len !== lastResponseLength || text !== lastResponseText) {
      stableCount = 0; lastResponseLength = len; lastResponseText = text;
    } else {
      stableCount++;
      if (stableCount >= STABLE_CHECKS_NEEDED) captureResponse(text);
    }
  }

  function cleanResponse(text) {
    return text
      .replace(/^Gemini\s*說了\s*\n*/i, '')
      .replace(/^Gemini\s*said\s*\n*/i, '')
      .replace(/\n*參考資料[：:]?\s*\n[\s\S]*$/m, '')
      .trim();
  }

  function captureResponse(text) {
    stopResponseMonitoring();
    const cleaned = cleanResponse(text);
    if (cleaned === lastCapturedText) return;
    lastCapturedText = cleaned;
    chrome.runtime.sendMessage({
      type: 'AI_RESPONSE_CAPTURED',
      data: { platform: 'gemini', responseText: cleaned, timestamp: Date.now() }
    });
    console.log('[解題心流] ✅ Captured, length:', cleaned.length);
  }

  function stopResponseMonitoring() {
    if (responseObserver) { responseObserver.disconnect(); responseObserver = null; }
    if (pollResponseInterval) { clearInterval(pollResponseInterval); pollResponseInterval = null; }
    clearTimeout(monitorTimer);
    clearTimeout(findTimer);
  }

  // ── Fill and submit (setTimeout-based retry, proven working) ──

  function fillAndSubmit(prompt, autoSubmit) {
    const myId = ++fillId;
    console.log('[解題心流] === fillAndSubmit START === fillId:', myId,
      'promptLen:', prompt?.length, 'autoSubmit:', autoSubmit);

    // If monitoring is active, capture current response before stopping
    if (pollResponseInterval) {
      const currentText = getLatestResponseText();
      if (currentText && currentText.length > 50) {
        console.log('[解題心流] Capturing previous response before new question');
        captureResponse(currentText);
      }
    }

    stopResponseMonitoring();
    lastResponseText = '';
    lastResponseLength = 0;
    stableCount = 0;

    if (!selectorConfig) {
      console.log('[解題心流] Loading selectors first...');
      loadSelectors().then(() => startFill(prompt, autoSubmit, myId, 0));
    } else {
      startFill(prompt, autoSubmit, myId, 0);
    }
  }

  function startFill(prompt, autoSubmit, myId, attempts) {
    if (fillId !== myId) { console.log('[解題心流] startFill CANCELLED (newer fillId)'); return; }
    if (attempts >= 15) { console.log('[解題心流] startFill GAVE UP after 15 attempts'); return; }

    console.log('[解題心流] startFill attempt:', attempts, 'fillId:', myId, 'autoSubmit:', autoSubmit);

    // Try all input selectors and log what we find
    for (const sel of selectorConfig.inputSelectors) {
      const found = document.querySelector(sel);
      console.log('[解題心流]   selector:', sel, '→', found ? `FOUND (${found.tagName}.${found.className})` : 'not found');
    }

    const inputEl = qs(selectorConfig.inputSelectors);
    if (!inputEl) {
      console.log('[解題心流] No input element, retrying in 500ms');
      setTimeout(() => startFill(prompt, autoSubmit, myId, attempts + 1), 500);
      return;
    }

    console.log('[解題心流] Editor found:', inputEl.tagName, inputEl.className,
      'contentEditable:', inputEl.contentEditable,
      'offsetParent:', !!inputEl.offsetParent);

    activateEditor(inputEl);

    setTimeout(() => {
      if (fillId !== myId) { console.log('[解題心流] CANCELLED before simulateInput'); return; }

      const ok = simulateInput(inputEl, prompt);
      console.log('[解題心流] simulateInput returned:', ok);

      setTimeout(() => {
        if (fillId !== myId) { console.log('[解題心流] CANCELLED after simulateInput'); return; }

        const freshEl = qs(selectorConfig.inputSelectors);
        const content = (freshEl || inputEl).textContent || '';
        console.log('[解題心流] Verify: contentLen:', content.length,
          'sameElement:', freshEl === inputEl);

        if (content.trim().length === 0 && attempts < 15) {
          console.log('[解題心流] Content empty, retrying in 800ms');
          setTimeout(() => startFill(prompt, autoSubmit, myId, attempts + 1), 800);
          return;
        }

        if (!autoSubmit) {
          console.log('[解題心流] ✅ Text filled, waiting for user to submit');
          startResponseMonitoring();
          return;
        }

        const submitted = clickSubmit();
        console.log('[解題心流] clickSubmit:', submitted);
        if (!submitted) {
          setTimeout(() => {
            if (fillId === myId) {
              const retry = clickSubmit();
              console.log('[解題心流] clickSubmit retry:', retry);
            }
          }, 800);
        }
        startResponseMonitoring();
      }, 500);
    }, 200);
  }

  // ── Message handling ──

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FILL_AND_SUBMIT') {
      fillAndSubmit(message.prompt, message.autoSubmit !== false);
      sendResponse({ received: true });
      return true;
    }
    if (message.type === 'MANUAL_CAPTURE_REQUEST') {
      const text = getLatestResponseText();
      if (text) { captureResponse(text); sendResponse({ success: true }); }
      else sendResponse({ success: false, error: 'No response' });
      return true;
    }
  });

  // ── postMessage listener (reliable cross-frame communication) ──
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'PSF_FILL_AND_SUBMIT') {
      console.log('[解題心流] PSF_FILL_AND_SUBMIT via postMessage, promptLen:',
        event.data.prompt?.length, 'autoSubmit:', event.data.autoSubmit);
      // Confirm receipt so main script stops retrying
      if (event.source) {
        event.source.postMessage({ type: 'PSF_RECEIVED' }, '*');
      }
      fillAndSubmit(event.data.prompt, event.data.autoSubmit !== false);
    }
  });

  // ── Init ──
  if (window.location.hostname.includes('gemini.google.com')) {
    console.log('[解題心流] Content script loaded on Gemini');
    loadSelectors().then(() => {
      chrome.runtime.sendMessage({ type: 'AI_FRAME_READY', platform: 'gemini' });
      // Notify parent frame via postMessage that we're ready
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'PSF_AI_READY' }, '*');
      }
    });
  }
})();
