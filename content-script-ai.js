// content-script-ai.js — Injected into AI platform pages
// Auto-fills input, submits, monitors response via MutationObserver

(function () {
  if (window.__psfAiScriptLoaded) return;
  window.__psfAiScriptLoaded = true;

  let selectorConfig = null;
  let responseObserver = null;
  let lastResponseText = '';
  let debounceTimer = null;
  let pollResponseInterval = null;
  const COMPLETION_DELAY_MS = 2000;

  function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes('gemini.google.com')) return 'gemini';
    if (host.includes('chatgpt.com')) return 'chatgpt';
    if (host.includes('claude.ai')) return 'claude';
    if (host.includes('google.com')) return 'google-ai';
    return null;
  }

  async function loadSelectors(platform) {
    try {
      const url = chrome.runtime.getURL(`selectors/${platform}.json`);
      const response = await fetch(url);
      selectorConfig = await response.json();
    } catch (e) {
      console.warn('[解題心流] Failed to load selectors for', platform, e);
    }
  }

  function querySelector(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function simulateInput(element, text) {
    element.focus();

    if (selectorConfig.inputMethod === 'value') {
      // Standard input/textarea
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Contenteditable div (Gemini, ChatGPT, Claude)
      // Strategy 1: Clipboard paste simulation (most reliable for rich editors)
      try {
        element.focus();
        element.innerHTML = '';
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt
        });
        const handled = element.dispatchEvent(pasteEvent);
        // Check if paste was handled by the editor framework
        if (handled && element.textContent.length > 0) {
          console.log('[解題心流] Paste simulation succeeded');
          return;
        }
      } catch (e) {
        console.log('[解題心流] Paste simulation failed, trying fallback', e);
      }

      // Strategy 2: execCommand insertText
      try {
        element.focus();
        element.innerHTML = '';
        const result = document.execCommand('insertText', false, text);
        if (result && element.textContent.length > 0) {
          console.log('[解題心流] execCommand succeeded');
          element.dispatchEvent(new InputEvent('input', {
            bubbles: true, cancelable: true, inputType: 'insertText', data: text
          }));
          return;
        }
      } catch (e) {
        console.log('[解題心流] execCommand failed, trying fallback', e);
      }

      // Strategy 3: Direct innerHTML + input event (last resort)
      console.log('[解題心流] Using direct innerHTML fallback');
      element.focus();
      element.textContent = text;
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text
      }));
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function clickSubmit() {
    const submitBtn = querySelector(selectorConfig.submitSelectors);
    if (submitBtn) {
      submitBtn.click();
      return true;
    }

    const inputEl = querySelector(selectorConfig.inputSelectors);
    if (inputEl) {
      inputEl.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
      }));
      return true;
    }

    return false;
  }

  function startResponseMonitoring() {
    stopResponseMonitoring();
    lastResponseText = '';

    setTimeout(() => {
      const checkResponse = () => {
        const responseEl = querySelector(selectorConfig.responseSelectors);
        if (!responseEl) {
          setTimeout(checkResponse, 500);
          return;
        }

        responseObserver = new MutationObserver(() => {
          onResponseChange();
        });

        responseObserver.observe(responseEl.parentElement || responseEl, {
          childList: true,
          subtree: true,
          characterData: true
        });

        pollResponseInterval = setInterval(onResponseChange, 1000);
      };

      checkResponse();
    }, 1000);
  }

  function onResponseChange() {
    const allResponses = [];
    for (const selector of selectorConfig.responseSelectors) {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => allResponses.push(el));
    }

    if (allResponses.length === 0) return;

    const latestResponse = allResponses[allResponses.length - 1];
    const currentText = latestResponse.textContent || '';

    if (currentText !== lastResponseText && currentText.length > 0) {
      lastResponseText = currentText;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        checkIfComplete(latestResponse);
      }, COMPLETION_DELAY_MS);
    }
  }

  function checkIfComplete(responseEl) {
    const stopBtn = querySelector(selectorConfig.stopButtonSelectors || []);
    if (stopBtn && stopBtn.offsetParent !== null) {
      debounceTimer = setTimeout(() => checkIfComplete(responseEl), 1000);
      return;
    }

    const responseText = responseEl.innerText || responseEl.textContent || '';
    if (responseText.trim().length > 0) {
      captureResponse(responseText.trim());
    }
  }

  function captureResponse(text) {
    stopResponseMonitoring();

    chrome.runtime.sendMessage({
      type: 'AI_RESPONSE_CAPTURED',
      data: {
        platform: detectPlatform(),
        responseText: text,
        timestamp: Date.now()
      }
    });
  }

  function stopResponseMonitoring() {
    if (responseObserver) {
      responseObserver.disconnect();
      responseObserver = null;
    }
    if (pollResponseInterval) {
      clearInterval(pollResponseInterval);
      pollResponseInterval = null;
    }
    clearTimeout(debounceTimer);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FILL_AND_SUBMIT') {
      console.log('[解題心流] Received FILL_AND_SUBMIT, prompt length:', message.prompt?.length);
      const { prompt } = message;
      fillAndSubmit(prompt);
    }

    if (message.type === 'MANUAL_CAPTURE_REQUEST') {
      const allResponses = [];
      if (selectorConfig) {
        for (const selector of selectorConfig.responseSelectors) {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => allResponses.push(el));
        }
      }
      if (allResponses.length > 0) {
        const latest = allResponses[allResponses.length - 1];
        const text = latest.innerText || latest.textContent || '';
        if (text.trim()) {
          captureResponse(text.trim());
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No response content found' });
        }
      } else {
        sendResponse({ success: false, error: 'No response element found' });
      }
      return true;
    }
  });

  async function fillAndSubmit(prompt) {
    stopResponseMonitoring();
    lastResponseText = '';

    if (!selectorConfig) {
      const platform = detectPlatform();
      if (platform) await loadSelectors(platform);
    }
    if (!selectorConfig) return;

    let attempts = 0;
    const maxAttempts = 20;

    const tryFill = () => {
      const inputEl = querySelector(selectorConfig.inputSelectors);
      if (!inputEl) {
        attempts++;
        console.log(`[解題心流] Input not found, attempt ${attempts}/${maxAttempts}`);
        if (attempts < maxAttempts) {
          setTimeout(tryFill, 500);
        } else {
          console.warn('[解題心流] Max attempts reached, input element not found');
        }
        return;
      }

      console.log('[解題心流] Input found:', inputEl.tagName, inputEl.className);
      simulateInput(inputEl, prompt);

      setTimeout(() => {
        const submitted = clickSubmit();
        console.log('[解題心流] Submit clicked:', submitted);
        startResponseMonitoring();
      }, 500);
    };

    tryFill();
  }

  const platform = detectPlatform();
  if (platform) {
    console.log('[解題心流] AI content script loaded for platform:', platform);
    loadSelectors(platform);
  } else {
    console.log('[解題心流] AI content script loaded but no platform detected, host:', window.location.hostname);
  }
})();
