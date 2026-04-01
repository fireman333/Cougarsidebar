# 解題心流 CougarSidebar

Chromium 瀏覽器擴充功能：在考古豹 (cougarbot.cc) 選取醫學考題，一鍵送給 Gemini 解答，自動記錄並匯出結構化筆記。

> **注意**：因使用 iframe 嵌入 Gemini 並修改安全標頭，本擴充功能無法上架 Chrome Web Store，需以開發人員模式手動載入。

## 安裝

1. 從 [Releases](https://github.com/fireman333/Cougarsidebar/releases) 下載最新版本（.zip）
2. 解壓縮到固定位置（安裝後請勿移動）
3. 開啟擴充功能頁面：
   - Chrome：`chrome://extensions`
   - Edge：`edge://extensions`
   - Brave：`brave://extensions`
4. 開啟右上角「**開發人員模式**」
5. 點擊「**載入未封裝項目**」→ 選擇解壓縮的資料夾

## 使用方式

1. 先在瀏覽器登入 [gemini.google.com](https://gemini.google.com)
2. 到考古豹選取題目文字，**選取範圍須包含「題號：N」**，這樣匯出時才會自動帶入題號
3. **右鍵** →「📝 送給 Gemini 解題」，或按快捷鍵：
   - Mac：`Ctrl+Shift+Q`（注意是 Ctrl 不是 Cmd）
   - Windows：`Ctrl+Shift+Q`
4. 右側開啟 Gemini 側邊欄，自動填入並送出
5. 回答完成後自動記錄
6. 點擊「📥 .md」或「📄 .txt」匯出筆記

### 含圖片的題目

若題目包含圖片，文字會填入 Gemini 但**不會自動送出**。請手動複製圖片貼到 Gemini 對話框，再自行按送出。

## 匯出格式

```
【題號 42 — 115-1 醫學三 第1次 — 2026】
安寧緩和醫療/內科概論(Original)
#題目
（題幹與選項）
#正確答案
（答案）
#解析
- 各選項分析
#臨床重點
- 相關知識

#安寧緩和醫療 #內科概論

---
```

## 功能

- 📝 右鍵選單 / 快捷鍵一鍵觸發
- 🤖 右側 Gemini 側邊欄（iframe）
- 🔄 自動填入 prompt 並送出（postMessage 通訊）
- 📡 自動偵測回答完成並記錄（MutationObserver + 穩定性檢查）
- 📝 編輯記錄：刪除/恢復（✕/↩），按儲存才生效
- 📥 匯出 .md / .txt，含題號、年份、分類 hashtag
- ⚙️ 可自訂 Gem URL 和 Prompt 模板
- 🏷️ 自動擷取考古豹 metadata（題號、考試資訊、年份、科目分類）

## 技術架構

- Chrome Extension Manifest V3
- `declarativeNetRequest` 移除 X-Frame-Options 限制
- Shadow DOM 側邊欄 + Light DOM iframe（支援 content script 注入）
- `postMessage` 跨 iframe 通訊（解決 Chrome messaging SPA 導航斷線問題）
- iframe ready 握手機制（PSF_AI_READY / PSF_RECEIVED）
- 穩定性偵測：3 次連續 800ms 無變化 → 擷取回答
- Prompt 模板自動遷移（偵測舊版 prompt 並替換）

## 設定

點擊工具列的擴充功能圖示：
- **Gem URL**：指定 Gemini Gem 網址
- **Prompt 模板**：自訂送給 Gemini 的格式
