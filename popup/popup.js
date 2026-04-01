// popup.js — Settings page logic

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

const gemUrlInput = document.getElementById('gem-url');
const promptTemplateInput = document.getElementById('prompt-template');
const resetTemplateBtn = document.getElementById('reset-template');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');
const shortcutsLink = document.getElementById('shortcuts-link');

chrome.storage.sync.get(['gemUrl', 'promptTemplate'], (result) => {
  gemUrlInput.value = result.gemUrl || '';
  promptTemplateInput.value = result.promptTemplate || DEFAULT_PROMPT_TEMPLATE;
});

resetTemplateBtn.addEventListener('click', () => {
  promptTemplateInput.value = DEFAULT_PROMPT_TEMPLATE;
});

saveBtn.addEventListener('click', () => {
  chrome.storage.sync.set({
    gemUrl: gemUrlInput.value.trim(),
    promptTemplate: promptTemplateInput.value
  }, () => {
    saveStatus.textContent = '✓ 已儲存';
    setTimeout(() => { saveStatus.textContent = ''; }, 2000);
  });
});

shortcutsLink.addEventListener('click', (e) => {
  e.preventDefault();
  navigator.clipboard.writeText('chrome://extensions/shortcuts');
  shortcutsLink.textContent = '已複製到剪貼簿！';
  setTimeout(() => { shortcutsLink.textContent = 'chrome://extensions/shortcuts'; }, 2000);
});
