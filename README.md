# 解題心流 (Problem-Solving Flow)

Chrome 瀏覽器插件：選取考試題目送給 AI 解答，自動記錄並匯出 Markdown 筆記。

## 安裝

1. 下載或 clone 此專案
2. 開啟 `chrome://extensions/`
3. 開啟「開發人員模式」
4. 點擊「載入未封裝項目」→ 選擇 `problem-solving-flow/` 目錄

## 使用方式

1. 在任何網頁選取題目文字
2. 右鍵選擇「📝 送給 AI 解題」或按 `Ctrl+Shift+Q`（Mac: `⌘+Shift+Q`）
3. 右側自動開啟 AI 側邊欄，AI 會自動回答
4. 回答自動記錄在插件中
5. 做完一回合後按「📥 匯出」下載 Markdown 筆記

## 設定

點擊工具列的插件圖示，可設定：
- **Gem URL**：Gemini 的 Gem 網址（開啟 Gemini 時自動導航）
- **Prompt 模板**：自訂送給 AI 的 prompt 格式

## 支援的 AI 平台

- Google Gemini（含 Gem）
- ChatGPT
- Claude
- Google AI 搜尋

## 功能

- 📝 右鍵選單 / 快捷鍵觸發
- 🤖 右側 AI 分割視窗（iframe 嵌入）
- 🔄 自動填入 prompt 並送出
- 📡 自動監聽 AI 回答（MutationObserver）
- ✓ 手動記錄按鈕（自動監聽失效時的 fallback）
- 📥 匯出 Markdown 筆記（.md 檔案 + 剪貼簿）
- ⚙️ 可自訂 Gem URL 和 Prompt 模板

## 技術架構

- Chrome Extension Manifest V3
- 使用 `declarativeNetRequest` 移除 X-Frame-Options 限制
- Content Script + MutationObserver 監聽 AI 回答
- `chrome.storage` 記錄管理
