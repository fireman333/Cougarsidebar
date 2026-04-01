// background.js — Service Worker (Gemini only)
// Context menu, commands, message routing, programmatic script injection

const injectedFrames = new Set();
// Prompt queue: tabId -> { prompt, platform, timestamp }
const pendingPrompts = new Map();
// Ready AI frames: tabId -> frameId
const readyFrames = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'send-to-ai',
    title: '📝 送給 Gemini 解題',
    contexts: ['selection']
  });
});

// Inject content-script-ai.js into Gemini frames
chrome.webNavigation.onCompleted.addListener((details) => {
  const key = `${details.tabId}-${details.frameId}`;
  if (readyFrames.get(details.tabId) === details.frameId) {
    readyFrames.delete(details.tabId);
  }
  injectedFrames.delete(key);

  console.log('[解題心流 BG] Gemini frame loaded, injecting content-script-ai.js',
    'tab:', details.tabId, 'frame:', details.frameId, 'url:', details.url);

  chrome.scripting.executeScript({
    target: { tabId: details.tabId, frameIds: [details.frameId] },
    files: ['content-script-ai.js']
  }).then(() => {
    injectedFrames.add(key);
    console.log('[解題心流 BG] Injected into frame', details.frameId);
  }).catch(err => {
    console.warn('[解題心流 BG] Injection failed:', err.message);
  });
}, {
  url: [{ hostContains: 'gemini.google.com' }]
});

// Clean up on tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const key of injectedFrames) {
    if (key.startsWith(`${tabId}-`)) injectedFrames.delete(key);
  }
  pendingPrompts.delete(tabId);
  readyFrames.delete(tabId);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'send-to-ai' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, { type: 'SEND_TO_AI', text: info.selectionText });
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'send-to-ai') {
    chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_SEND_TO_AI' });
  }
});

// Deliver prompt to Gemini frame with retries
function deliverPrompt(tabId, attempt) {
  const pending = pendingPrompts.get(tabId);
  if (!pending) return;
  if (Date.now() - pending.timestamp > 30000) {
    console.warn('[解題心流 BG] Delivery timed out for tab', tabId);
    pendingPrompts.delete(tabId);
    return;
  }

  const frameId = readyFrames.get(tabId);
  const opts = frameId !== undefined ? { frameId } : {};

  console.log(`[解題心流 BG] deliverPrompt attempt ${attempt}, tab:${tabId}, frameId:${frameId}`);

  chrome.tabs.sendMessage(tabId, {
    type: 'FILL_AND_SUBMIT',
    prompt: pending.prompt,
    platform: 'gemini',
    autoSubmit: pending.autoSubmit
  }, opts, (response) => {
    if (chrome.runtime.lastError) {
      console.log('[解題心流 BG] Delivery failed:', chrome.runtime.lastError.message);
      if (attempt < 20) {
        setTimeout(() => deliverPrompt(tabId, attempt + 1), 1500);
      } else {
        pendingPrompts.delete(tabId);
      }
    } else if (response && response.received) {
      console.log('[解題心流 BG] ✅ Prompt delivered');
      pendingPrompts.delete(tabId);
    } else {
      if (attempt < 20) {
        setTimeout(() => deliverPrompt(tabId, attempt + 1), 1500);
      }
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (message.type) {
    case 'SEND_PROMPT_TO_AI': {
      const resolveTab = (cb) => {
        if (tabId) { cb(tabId); return; }
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) cb(tabs[0].id);
        });
      };
      resolveTab((tid) => {
        console.log('[解題心流 BG] SEND_PROMPT_TO_AI, tab:', tid);
        pendingPrompts.set(tid, {
          prompt: message.prompt, platform: 'gemini',
          autoSubmit: message.autoSubmit !== false,
          timestamp: Date.now()
        });
        deliverPrompt(tid, 0);
      });
      break;
    }

    case 'AI_FRAME_READY': {
      console.log('[解題心流 BG] AI_FRAME_READY, tab:', tabId, 'frame:', sender.frameId);
      if (tabId) {
        readyFrames.set(tabId, sender.frameId);
        if (pendingPrompts.has(tabId)) {
          console.log('[解題心流 BG] Delivering pending prompt to ready frame');
          deliverPrompt(tabId, 0);
        }
      }
      break;
    }

    case 'AI_RESPONSE_CAPTURED': {
      const tid = tabId || null;
      console.log('[解題心流 BG] AI_RESPONSE_CAPTURED, routing to tab', tid);
      const sendTo = (id) => {
        chrome.tabs.sendMessage(id, { type: 'AI_RESPONSE_CAPTURED', data: message.data },
          () => { if (chrome.runtime.lastError) {} });
      };
      if (tid) sendTo(tid);
      else chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => { if (tabs[0]) sendTo(tabs[0].id); });
      break;
    }

    case 'MANUAL_CAPTURE_REQUEST': {
      const sendTo = (id) => {
        chrome.tabs.sendMessage(id, { type: 'MANUAL_CAPTURE_REQUEST', platform: 'gemini' },
          () => { if (chrome.runtime.lastError) {} });
      };
      if (tabId) sendTo(tabId);
      else chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => { if (tabs[0]) sendTo(tabs[0].id); });
      break;
    }

    case 'DOWNLOAD_FILE':
      chrome.downloads.download({ url: message.url, filename: message.filename, saveAs: true });
      break;

    case 'GET_SETTINGS':
      chrome.storage.sync.get(['gemUrl', 'promptTemplate'], (result) => { sendResponse(result); });
      return true;
  }
});
