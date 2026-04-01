// background.js — Service Worker
// Context menu, commands, and complete message routing

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'send-to-ai',
    title: '📝 送給 AI 解題',
    contexts: ['selection']
  });
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
    case 'SEND_PROMPT_TO_AI':
      console.log('[解題心流 BG] SEND_PROMPT_TO_AI received, tabId:', tabId, 'platform:', message.platform);
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          type: 'FILL_AND_SUBMIT',
          prompt: message.prompt,
          platform: message.platform
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[解題心流 BG] Failed to send FILL_AND_SUBMIT:', chrome.runtime.lastError.message);
          }
        });
      } else {
        // Fallback: try active tab if sender.tab is undefined (extension page in iframe)
        console.warn('[解題心流 BG] No tabId from sender, trying active tab');
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'FILL_AND_SUBMIT',
              prompt: message.prompt,
              platform: message.platform
            });
          }
        });
      }
      break;

    case 'AI_RESPONSE_CAPTURED':
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          type: 'AI_RESPONSE_CAPTURED',
          data: message.data
        });
      }
      break;

    case 'MANUAL_CAPTURE_REQUEST':
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          type: 'MANUAL_CAPTURE_REQUEST',
          platform: message.platform
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
