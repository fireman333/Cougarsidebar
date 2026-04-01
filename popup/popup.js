// popup.js — Settings page logic

const DEFAULT_PROMPT_TEMPLATE = `回答以下醫學考題。全部用條列式（- 開頭），禁止寫段落長文。禁止開場白、禁止「這是一題關於…」、禁止「參考資料」。數學公式一律用純文字表達，禁止使用LaTeX語法（例如寫「PaO2/FiO2」而非「$PaO_2/FiO_2$」）。嚴格遵守格式：

第一行：醫學主題分類（如：安寧緩和醫療）
#題目
（原封不動重述題幹與選項）
#正確答案
（選項代號與內容）
#解析
- 正確選項：（為何正確，條列關鍵理由）
- (A)：（為何錯，一句話）
- (B)：（為何錯，一句話）
- (C)：（為何錯，一句話）
- (D)：（為何錯，一句話）
（跳過正確選項，只列錯誤的）
#臨床重點
- （相關臨床知識，每點一行）

{text}`;

const gemUrlInput = document.getElementById('gem-url');
const promptTemplateInput = document.getElementById('prompt-template');
const resetTemplateBtn = document.getElementById('reset-template');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');
const shortcutsLink = document.getElementById('shortcuts-link');

const OLD_PROMPTS = [
  '請回答以下醫學考試題目。請依照以下格式輸出',
  '請回答以下醫學考試題目，直接回答，不要多餘的開場白。格式如下',
  '請回答以下醫學考試題目。嚴格遵守以下格式',
  '回答以下醫學考題。全部用條列式（- 開頭），禁止寫段落長文。禁止開場白、禁止「這是一題關於…」、禁止「參考資料」。嚴格遵守格式'
];

chrome.storage.sync.get(['gemUrl', 'promptTemplate'], (result) => {
  gemUrlInput.value = result.gemUrl || '';
  const stored = result.promptTemplate || '';
  // Auto-migrate old templates
  if (!stored || OLD_PROMPTS.some(old => stored.includes(old))) {
    promptTemplateInput.value = DEFAULT_PROMPT_TEMPLATE;
    chrome.storage.sync.set({ promptTemplate: DEFAULT_PROMPT_TEMPLATE });
  } else {
    promptTemplateInput.value = stored;
  }
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
