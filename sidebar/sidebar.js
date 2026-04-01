// sidebar.js — Sidebar UI logic
// Tab switching, record management, export

(function () {
  const AI_URLS = {
    gemini: 'https://gemini.google.com/app',
    chatgpt: 'https://chatgpt.com/',
    claude: 'https://claude.ai/new',
    'google-ai': 'https://www.google.com/search?q=&udm=50'
  };

  let currentPlatform = 'gemini';
  let records = [];
  let gemUrl = '';
  let promptTemplate = '';

  const DEFAULT_PROMPT_TEMPLATE = `請回答以下醫學考試題目。請依照以下格式輸出：

## 題目
（完整重述題目與所有選項）

## 正確答案
（選項代號與內容）

## 解析
（詳細解釋為什麼這個答案正確，以及其他選項為什麼錯誤）

---

以下是題目：
{text}`;

  const tabBar = document.getElementById('tab-bar');
  const tabs = document.querySelectorAll('.tab');
  const closeBtn = document.getElementById('close-btn');
  const gemBar = document.getElementById('gem-bar');
  const gemUrlDisplay = document.getElementById('gem-url-display');
  const aiIframe = document.getElementById('ai-iframe');
  const aiLoading = document.getElementById('ai-loading');
  const recordBtn = document.getElementById('record-btn');
  const exportBtn = document.getElementById('export-btn');
  const countNumber = document.getElementById('count-number');

  function loadSettings() {
    chrome.storage.sync.get(['gemUrl', 'promptTemplate', 'selectedPlatform'], (result) => {
      gemUrl = result.gemUrl || '';
      promptTemplate = result.promptTemplate || DEFAULT_PROMPT_TEMPLATE;
      if (result.selectedPlatform) {
        switchPlatform(result.selectedPlatform);
      } else {
        switchPlatform('gemini');
      }
    });
  }

  function loadRecords() {
    chrome.storage.local.get(['records'], (result) => {
      records = result.records || [];
      updateRecordCount();
    });
  }

  function saveRecords() {
    chrome.storage.local.set({ records });
    updateRecordCount();
    flashRecordCount();
  }

  function updateRecordCount() {
    countNumber.textContent = records.length;
  }

  function flashRecordCount() {
    countNumber.style.transition = 'transform 0.2s, color 0.2s';
    countNumber.style.transform = 'scale(1.5)';
    countNumber.style.color = '#f5a623';
    setTimeout(() => {
      countNumber.style.transform = 'scale(1)';
      countNumber.style.color = '#4ecdc4';
    }, 300);
  }

  function switchPlatform(platform) {
    currentPlatform = platform;
    tabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.platform === platform);
    });

    if (platform === 'gemini' && gemUrl) {
      gemBar.classList.add('visible');
      gemUrlDisplay.textContent = gemUrl;
    } else {
      gemBar.classList.remove('visible');
    }

    let url = AI_URLS[platform];
    if (platform === 'gemini' && gemUrl) {
      url = gemUrl;
    }

    aiLoading.classList.add('visible');
    aiIframe.src = url;
    aiIframe.onload = () => {
      aiLoading.classList.remove('visible');
    };

    chrome.storage.sync.set({ selectedPlatform: platform });
  }

  tabBar.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) {
      switchPlatform(tab.dataset.platform);
    }
  });

  closeBtn.addEventListener('click', () => {
    window.parent.postMessage({ type: 'CLOSE_SIDEBAR' }, '*');
  });

  recordBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'MANUAL_CAPTURE_REQUEST',
      platform: currentPlatform
    });
  });

  exportBtn.addEventListener('click', () => {
    if (records.length === 0) {
      alert('還沒有記錄可以匯出');
      return;
    }
    exportRecords();
  });

  function exportRecords() {
    const now = new Date();
    const dateStr = now.toLocaleString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });

    const sources = [...new Set(records.map(r => r.sourceUrl))];
    const sourceStr = sources.length === 1 ? sources[0] : sources.join('\n> ');

    let markdown = `# 解題記錄\n`;
    markdown += `> 匯出時間：${dateStr}\n`;
    markdown += `> 來源：${sourceStr}\n`;
    markdown += `> 題數：${records.length} 題\n\n---\n\n`;

    records.forEach((record, index) => {
      markdown += `## 第 ${index + 1} 題\n\n`;
      markdown += record.formattedMarkdown || record.aiResponse;
      markdown += `\n\n---\n\n`;
    });

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const filename = `解題記錄_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.md`;

    // Convert to data URL for download (blob URLs are not accessible from background service worker)
    const reader = new FileReader();
    reader.onload = () => {
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_FILE',
        url: reader.result,
        filename: filename
      });
    };
    reader.readAsDataURL(blob);

    navigator.clipboard.writeText(markdown).then(() => {
      if (confirm(`已匯出 ${records.length} 題並複製到剪貼簿。\n要清除當前記錄嗎？`)) {
        records = [];
        saveRecords();
      }
    });
  }

  function addRecord(data) {
    const record = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      sourceUrl: window.__lastSourceUrl || '',
      selectedText: window.__lastSelectedText || '',
      aiPlatform: data.platform,
      aiResponse: data.responseText,
      formattedMarkdown: data.responseText
    };
    records.push(record);
    saveRecords();
  }

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'SELECTED_TEXT') {
      const text = event.data.text;
      const fullPrompt = promptTemplate.replace('{text}', text);
      window.__lastSelectedText = text;
      window.__lastSourceUrl = event.data.sourceUrl || '';

      chrome.runtime.sendMessage({
        type: 'SEND_PROMPT_TO_AI',
        platform: currentPlatform,
        prompt: fullPrompt,
        selectedText: text
      });
    }

  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'AI_RESPONSE_CAPTURED') {
      addRecord(message.data);
    }
  });

  loadSettings();
  loadRecords();
})();
