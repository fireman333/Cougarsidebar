// background.js — Service Worker
// Context menu, commands, message routing, and programmatic script injection

// Track which frames have content-script-ai.js injected
const injectedFrames = new Set();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'send-to-ai',
    title: '📝 送給 AI 解題',
    contexts: ['selection']
  });
});

// Programmatic injection: when AI platform loads in ANY frame (including nested iframes
// inside extension pages where manifest content_scripts won't auto-inject),
// use chrome.scripting.executeScript to inject content-script-ai.js.
chrome.webNavigation.onCompleted.addListener((details) => {
  const key = `${details.tabId}-${details.frameId}`;
  if (injectedFrames.has(key)) return;

  console.log('[解題心流 BG] AI platform frame loaded, injecting content-script-ai.js',
    'tab:', details.tabId, 'frame:', details.frameId, 'url:', details.url);

  chrome.scripting.executeScript({
    target: { tabId: details.tabId, frameIds: [details.frameId] },
    files: ['content-script-ai.js']
  }).then(() => {
    injectedFrames.add(key);
    console.log('[解題心流 BG] Successfully injected into frame', details.frameId);
  }).catch(err => {
    console.warn('[解題心流 BG] Failed to inject into frame:', err.message);
  });
}, {
  url: [
    { hostContains: 'gemini.google.com' },
    { hostContains: 'chatgpt.com' },
    { hostContains: 'claude.ai' }
  ]
});

// Clean up injected frames tracking when tab is removed
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const key of injectedFrames) {
    if (key.startsWith(`${tabId}-`)) {
      injectedFrames.delete(key);
    }
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'send-to-ai' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      type: 'SEND_TO_AI',
      text: info.selectionText
    });
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'send-to-ai') {
    chrome.tabs.sendMessage(tab.id, {
      type: 'TRIGGER_SEND_TO_AI'
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (message.type) {
    case 'SEND_PROMPT_TO_AI': {
      const targetTabId = tabId || null;
      console.log('[解題心流 BG] SEND_PROMPT_TO_AI received, tabId:', targetTabId);

      const sendToTab = (tid) => {
        chrome.tabs.sendMessage(tid, {
          type: 'FILL_AND_SUBMIT',
          prompt: message.prompt,
          platform: message.platform
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[解題心流 BG] FILL_AND_SUBMIT delivery issue:', chrome.runtime.lastError.message);
          }
        });
      };

      if (targetTabId) {
        sendToTab(targetTabId);
      } else {
        // Fallback: extension page iframe may not have sender.tab
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            console.log('[解題心流 BG] Using active tab fallback:', tabs[0].id);
            sendToTab(tabs[0].id);
          }
        });
      }
      break;
    }

    case 'AI_RESPONSE_CAPTURED':
      console.log('[解題心流 BG] AI_RESPONSE_CAPTURED, routing to tab', tabId);
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          type: 'AI_RESPONSE_CAPTURED',
          data: message.data
        }, () => { if (chrome.runtime.lastError) {} });
      } else {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'AI_RESPONSE_CAPTURED',
              data: message.data
            }, () => { if (chrome.runtime.lastError) {} });
          }
        });
      }
      break;

    case 'MANUAL_CAPTURE_REQUEST':
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          type: 'MANUAL_CAPTURE_REQUEST',
          platform: message.platform
        }, () => { if (chrome.runtime.lastError) {} });
      } else {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'MANUAL_CAPTURE_REQUEST',
              platform: message.platform
            }, () => { if (chrome.runtime.lastError) {} });
          }
        });
      }
      break;

    case 'DOWNLOAD_FILE':
      chrome.downloads.download({
        url: message.url,
        filename: message.filename,
        saveAs: true
      });
      break;

    case 'GET_SETTINGS':
      chrome.storage.sync.get(['gemUrl', 'promptTemplate', 'selectedPlatform'], (result) => {
        sendResponse(result);
      });
      return true;
  }
});
