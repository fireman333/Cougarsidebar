// content-script-main.js — Injected into all pages
// Builds sidebar UI with Shadow DOM. AI iframe (Gemini) lives in light DOM for content script injection.
// Extracts metadata (題號, 年份, 分類) from cougarbot.cc for structured export.

(function () {
  if (window.__problemSolvingFlowLoaded) return;
  window.__problemSolvingFlowLoaded = true;

  const SIDEBAR_MIN_WIDTH = 300;
  const SIDEBAR_DEFAULT_WIDTH = 420;
  const DEFAULT_GEMINI_URL = 'https://gemini.google.com/app';
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

  let container = null;
  let aiIframe = null;
  let countEl = null;
  let isOpen = false;
  let isResizing = false;
  let records = [];
  let gemUrl = '';
  let promptTemplate = DEFAULT_PROMPT_TEMPLATE;

  // Old prompts that should be auto-replaced with the new default
  const OLD_PROMPTS = [
    '請回答以下醫學考試題目。請依照以下格式輸出',
    '請回答以下醫學考試題目，直接回答，不要多餘的開場白。格式如下',
    '請回答以下醫學考試題目。嚴格遵守以下格式',
    '回答以下醫學考題。全部用條列式（- 開頭），禁止寫段落長文。禁止開場白、禁止「這是一題關於…」、禁止「參考資料」。嚴格遵守格式'
  ];

  // ── Settings & Records ──
  function loadSettings() {
    chrome.storage.sync.get(['gemUrl', 'promptTemplate'], r => {
      gemUrl = r.gemUrl || '';
      const stored = r.promptTemplate || '';
      // Auto-migrate: if stored prompt is an old default, replace with new one
      if (!stored || OLD_PROMPTS.some(old => stored.includes(old))) {
        promptTemplate = DEFAULT_PROMPT_TEMPLATE;
        chrome.storage.sync.set({ promptTemplate: DEFAULT_PROMPT_TEMPLATE });
        console.log('[解題心流] Prompt template migrated to new version');
      } else {
        promptTemplate = stored;
      }
    });
  }
  function loadRecords() {
    chrome.storage.local.get(['records'], r => {
      records = r.records || [];
      if (countEl) countEl.textContent = records.length;
    });
  }
  function saveRecords() {
    chrome.storage.local.set({ records });
    if (countEl) {
      countEl.textContent = records.length;
      countEl.style.transform = 'scale(1.4)';
      countEl.style.color = '#f5a623';
      setTimeout(() => { countEl.style.transform = ''; countEl.style.color = '#4ecdc4'; }, 300);
    }
  }

  // ── Extract cougarbot metadata ──
  function extractCougarbotMetadata() {
    const meta = { questionNum: '', examInfo: '', year: '', categories: [] };
    if (!location.hostname.includes('cougarbot')) return meta;

    try {
      const sel = window.getSelection();
      const selText = sel.toString() || '';

      // 1. Find 題號 — first try from selected text, then DOM
      const selMatch = selText.match(/題號[:：\s]*(\d+)/);
      if (selMatch) {
        meta.questionNum = selMatch[1];
      }

      if (sel.rangeCount) {
        let node = sel.anchorNode;
        if (node && node.nodeType === 3) node = node.parentElement;

        // If not found in selected text, walk up DOM to find it
        let card = node;
        if (!meta.questionNum) {
          for (let i = 0; i < 15 && card && card !== document.body; i++) {
            const t = card.textContent || '';
            if (/題號[:：\s]*\d+/.test(t)) {
              const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
              let textNode;
              while ((textNode = walker.nextNode())) {
                const m = textNode.textContent.match(/題號[:：\s]*(\d+)/);
                if (m) { meta.questionNum = m[1]; break; }
              }
              break;
            }
            card = card.parentElement;
          }
        } else {
          // Still walk up to find the card container for categories
          for (let i = 0; i < 15 && card && card !== document.body; i++) {
            const t = card.textContent || '';
            if (/題號/.test(t) || card.querySelectorAll('[class*="tag"], [class*="badge"]').length > 0) break;
            card = card.parentElement;
          }
        }

        // 2. Find categories — look for tag/badge elements near the question
        // On cougarbot, "內科概論" appears as a small colored tag at bottom
        if (card && card !== document.body) {
          const seen = new Set();
          // Strategy A: look for elements with tag/badge/chip/category in class
          card.querySelectorAll('[class*="tag"], [class*="badge"], [class*="chip"], [class*="category"], [class*="label"], [class*="subject"]').forEach(el => {
            const txt = el.textContent.trim();
            if (txt.length >= 2 && txt.length <= 20 && !seen.has(txt)) {
              seen.add(txt);
              meta.categories.push(txt);
            }
          });

          // Strategy B: if nothing found, look for leaf elements with short CJK text
          // that are NOT part of the question/options
          if (meta.categories.length === 0) {
            const questionText = card.textContent || '';
            card.querySelectorAll('a, button, span').forEach(el => {
              const txt = el.textContent.trim();
              if (txt.length >= 2 && txt.length <= 15
                  && el.children.length === 0
                  && /^[\u4e00-\u9fff]+$/.test(txt)
                  && !txt.includes('題號') && !txt.includes('顯示')
                  && !txt.includes('查看') && !txt.includes('答案')
                  && !txt.includes('詳解') && !txt.includes('原檔')
                  && !seen.has(txt)) {
                // Check it's styled differently (small font, rounded, colored bg)
                const cs = window.getComputedStyle(el);
                const bg = cs.backgroundColor;
                const br = parseFloat(cs.borderRadius);
                const fs = parseFloat(cs.fontSize);
                if (bg !== 'rgba(0, 0, 0, 0)' || br > 4 || fs <= 14) {
                  seen.add(txt);
                  meta.categories.push(txt);
                }
              }
            });
          }
        }
      }

      // 3. Extract exam info — use multiple sources
      // Source A: document.title (e.g., "115-1 醫學三 醫師考古題")
      const title = document.title || '';
      const titleMatch = title.match(/(\d{3}-\d)\s*([\u4e00-\u9fff\w]+)/);
      if (titleMatch) {
        meta.examInfo = titleMatch[1] + ' ' + titleMatch[2];
      }

      // Source B: scan visible heading elements for year/session
      const headings = document.querySelectorAll('h1, h2, h3, [class*="title"], [class*="header"], [class*="exam"]');
      const visibleTexts = [];
      headings.forEach(el => {
        const t = el.innerText || el.textContent || '';
        if (t.length < 200) visibleTexts.push(t);
      });
      // Also check the first few large-text elements
      document.querySelectorAll('span, div, p').forEach(el => {
        if (visibleTexts.length > 50) return;
        const t = (el.innerText || '').trim();
        if (t.length > 0 && t.length < 100 && /\d{3}-\d|20\d{2}|第\d+次/.test(t)) {
          visibleTexts.push(t);
        }
      });

      const allHeaderText = visibleTexts.join(' ');

      // Extract exam code if not found from title
      if (!meta.examInfo) {
        const codeMatch = allHeaderText.match(/(\d{3}-\d)\s*[※\s]*([\u4e00-\u9fff]+[\u4e00-\u9fff\d]*)/);
        if (codeMatch) meta.examInfo = codeMatch[1] + ' ' + codeMatch[2];
      }

      // Extract year
      const yearMatch = allHeaderText.match(/(20\d{2})/);
      if (yearMatch) meta.year = yearMatch[1];
      if (!meta.year) {
        const titleYear = title.match(/(20\d{2})/);
        if (titleYear) meta.year = titleYear[1];
      }

      // Extract session (第1次, 第2次)
      const sessionMatch = allHeaderText.match(/(第\s*\d+\s*次)/);
      if (sessionMatch && meta.examInfo) {
        meta.examInfo += ' ' + sessionMatch[1].replace(/\s/g, '');
      }

    } catch (e) {
      console.warn('[解題心流] Metadata extraction error:', e);
    }

    console.log('[解題心流] Extracted metadata:', JSON.stringify(meta));
    return meta;
  }

  // ── Build sidebar ──
  function buildSidebar() {
    if (container) return;

    container = document.createElement('div');
    container.id = 'psf-ext-root';
    container.style.cssText = `
      position:fixed; top:0; right:0; width:${SIDEBAR_DEFAULT_WIDTH}px; height:100vh;
      z-index:2147483647; display:none; flex-direction:row;
      box-shadow:-2px 0 12px rgba(0,0,0,.35); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    `;

    const shadow = container.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host{all:initial;display:flex;flex-direction:row;width:100%;height:100%;}
        *{box-sizing:border-box;margin:0;padding:0;}
        #wrap{display:flex;flex-direction:column;flex:1;height:100%;overflow:hidden;}
        #header{display:flex;align-items:center;background:#16213e;padding:8px 12px;border-bottom:1px solid #1a1a4e;flex-shrink:0;}
        #title{color:#4ecdc4;font-size:13px;font-weight:700;flex:1;}
        #close{background:none;border:none;color:#888;font-size:16px;cursor:pointer;padding:4px 8px;}
        #close:hover{color:#e94560;}
        #gem{background:rgba(78,205,196,.1);padding:4px 12px;font-size:10px;color:#4ecdc4;border-bottom:1px solid #1a1a4e;display:none;align-items:center;gap:6px;flex-shrink:0;}
        #gem.on{display:flex;}
        #gem-url{opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        #ai-box{flex:1;position:relative;overflow:hidden;background:#fff;}
        ::slotted(iframe){width:100%!important;height:100%!important;border:none!important;}
        #footer{display:flex;justify-content:space-between;align-items:center;background:#16213e;padding:8px 12px;border-top:1px solid #1a1a4e;flex-shrink:0;flex-wrap:wrap;gap:4px;}
        #rec{font-size:12px;color:#a8a8a8;}
        #cnt{color:#4ecdc4;font-weight:700;font-size:14px;transition:transform .2s,color .2s;}
        #acts{display:flex;gap:6px;}
        .btn{border:none;padding:5px 14px;border-radius:6px;font-size:11px;cursor:pointer;transition:opacity .15s;}
        .btn:hover{opacity:.85;}
        .btn-s{background:rgba(78,205,196,.2);color:#4ecdc4;}
        .btn-p{background:#4ecdc4;color:#000;font-weight:700;}
        .btn-e{background:rgba(233,69,96,.2);color:#e94560;}
        #resize{width:6px;height:100%;cursor:col-resize;background:#2a2a4a;flex-shrink:0;}

        /* ── Editor overlay ── */
        #editor-overlay{display:none;position:absolute;top:0;left:0;right:0;bottom:0;background:#1a1a2e;z-index:10;flex-direction:column;padding:12px;}
        #editor-overlay.on{display:flex;}
        #editor-overlay h3{color:#4ecdc4;font-size:13px;margin-bottom:8px;}
        #editor-list{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;}
        .edit-card{background:#2a2a4a;border-radius:8px;padding:10px;position:relative;}
        .edit-card textarea{width:100%;background:#16213e;color:#ccc;border:1px solid #3a3a5a;border-radius:4px;padding:8px;font-size:11px;resize:vertical;min-height:80px;font-family:inherit;}
        .edit-card .edit-label{font-size:10px;color:#888;margin-bottom:4px;}
        .edit-card .del-btn{position:absolute;top:6px;right:6px;background:none;border:none;color:#e94560;cursor:pointer;font-size:14px;}
        #editor-actions{display:flex;gap:8px;margin-top:8px;justify-content:flex-end;}
        #editor-actions .btn{padding:6px 16px;}
      </style>

      <div id="resize"></div>
      <div id="wrap">
        <div id="header">
          <div id="title">✨ 解題心流 — Gemini</div>
          <button id="close" title="關閉">✕</button>
        </div>
        <div id="gem"><span>🔗 Gem:</span><span id="gem-url"></span></div>
        <div id="ai-box"><slot></slot></div>
        <div id="editor-overlay">
          <h3>📝 編輯記錄</h3>
          <div id="editor-list"></div>
          <div id="editor-actions">
            <button class="btn btn-s" id="editor-cancel">取消</button>
            <button class="btn btn-p" id="editor-save">儲存</button>
          </div>
        </div>
        <div id="footer">
          <div id="rec"><span id="cnt">0</span> 題已記錄</div>
          <div id="acts">
            <button class="btn btn-s" id="recbtn">✓ 記錄</button>
            <button class="btn btn-e" id="editbtn">📝 編輯</button>
            <button class="btn btn-s" id="exp-txt-btn">📄 .txt</button>
            <button class="btn btn-p" id="exp-md-btn">📥 .md</button>
          </div>
        </div>
      </div>
    `;

    aiIframe = document.createElement('iframe');
    aiIframe.id = 'psf-ai-iframe';
    aiIframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
    container.appendChild(aiIframe);
    document.body.appendChild(container);

    const sr = shadow;
    countEl = sr.getElementById('cnt');
    const gemBar = sr.getElementById('gem');
    const gemUrlEl = sr.getElementById('gem-url');

    const editorOverlay = sr.getElementById('editor-overlay');
    const editorList = sr.getElementById('editor-list');

    sr.getElementById('close').addEventListener('click', () => closeSidebar());
    sr.getElementById('recbtn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'MANUAL_CAPTURE_REQUEST', platform: 'gemini' });
    });
    sr.getElementById('exp-md-btn').addEventListener('click', () => {
      if (records.length === 0) { alert('還沒有記錄可以匯出'); return; }
      exportRecords('md');
    });
    sr.getElementById('exp-txt-btn').addEventListener('click', () => {
      if (records.length === 0) { alert('還沒有記錄可以匯出'); return; }
      exportRecords('txt');
    });

    // ── Editor ──
    // Work on a snapshot; only commit to `records` on Save.
    let editorSnapshot = null; // deep copy of records while editing
    let pendingDeletes = new Set(); // indices marked for deletion

    sr.getElementById('editbtn').addEventListener('click', () => {
      if (records.length === 0) { alert('還沒有記錄可以編輯'); return; }
      openEditor();
    });
    sr.getElementById('editor-cancel').addEventListener('click', () => {
      // Discard all changes
      editorSnapshot = null;
      pendingDeletes.clear();
      editorOverlay.classList.remove('on');
    });
    sr.getElementById('editor-save').addEventListener('click', () => {
      if (!editorSnapshot) { editorOverlay.classList.remove('on'); return; }
      // Apply text edits from textareas
      const textareas = editorList.querySelectorAll('textarea');
      textareas.forEach((ta, i) => {
        if (editorSnapshot[i]) editorSnapshot[i].aiResponse = ta.value;
      });
      // Remove deleted records (in reverse to preserve indices)
      const kept = editorSnapshot.filter((_, i) => !pendingDeletes.has(i));
      records = kept;
      saveRecords();
      editorSnapshot = null;
      pendingDeletes.clear();
      editorOverlay.classList.remove('on');
    });

    function openEditor() {
      // Deep copy records as snapshot
      editorSnapshot = JSON.parse(JSON.stringify(records));
      pendingDeletes.clear();
      renderEditor();
      editorOverlay.classList.add('on');
    }

    function renderEditor() {
      editorList.innerHTML = '';
      editorSnapshot.forEach((r, i) => {
        const card = document.createElement('div');
        card.className = 'edit-card';
        if (pendingDeletes.has(i)) card.style.opacity = '0.3';

        const label = document.createElement('div');
        label.className = 'edit-label';
        const labelParts = [`#${i + 1}`];
        if (r.questionNum) labelParts.push('題號 ' + r.questionNum);
        if (r.examInfo) labelParts.push(r.examInfo);
        if (r.categories?.length) labelParts.push('[' + r.categories.join(', ') + ']');
        label.textContent = labelParts.join(' — ');

        const ta = document.createElement('textarea');
        ta.value = r.aiResponse || '';
        ta.rows = 8;
        ta.disabled = pendingDeletes.has(i);

        const del = document.createElement('button');
        del.className = 'del-btn';
        if (pendingDeletes.has(i)) {
          del.textContent = '↩';
          del.title = '恢復此記錄';
          del.addEventListener('click', () => {
            pendingDeletes.delete(i);
            renderEditor();
          });
        } else {
          del.textContent = '✕';
          del.title = '標記刪除（按儲存才生效）';
          del.addEventListener('click', () => {
            pendingDeletes.add(i);
            renderEditor();
          });
        }

        card.appendChild(label);
        card.appendChild(ta);
        card.appendChild(del);
        editorList.appendChild(card);
      });
    }
    sr.getElementById('resize').addEventListener('mousedown', e => {
      isResizing = true; e.preventDefault();
      document.addEventListener('mousemove', onResize);
      document.addEventListener('mouseup', stopResize);
      document.body.style.userSelect = 'none';
    });

    loadSettings();
    loadRecords();
    setTimeout(() => {
      const url = gemUrl || DEFAULT_GEMINI_URL;
      if (gemUrl) {
        gemBar.classList.add('on');
        gemUrlEl.textContent = gemUrl;
      }
      aiIframe.src = url;
    }, 100);
  }

  function onResize(e) {
    if (!isResizing) return;
    const w = Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - e.clientX);
    container.style.width = w + 'px';
    document.documentElement.style.marginRight = w + 'px';
  }
  function stopResize() {
    isResizing = false;
    document.removeEventListener('mousemove', onResize);
    document.removeEventListener('mouseup', stopResize);
    document.body.style.userSelect = '';
  }

  function openSidebar(selData) {
    buildSidebar();
    container.style.display = 'flex';
    document.documentElement.style.marginRight = container.style.width;
    document.documentElement.style.transition = 'margin-right .2s ease';
    isOpen = true;
    if (selData) sendToAIWithData(selData.text, selData.meta, selData.hasImages);
  }
  function closeSidebar() {
    if (!container) return;
    container.style.display = 'none';
    document.documentElement.style.marginRight = '0';
    isOpen = false;
  }

  // Check if selection contains images (lightweight — no DOM cloning)
  function selectionHasImages() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    // Check the container for any img that intersects the range
    const container = range.commonAncestorContainer;
    const root = container.nodeType === 1 ? container : container.parentElement;
    if (!root) return false;
    const imgs = root.getElementsByTagName('img');
    for (let i = 0; i < imgs.length; i++) {
      if (range.intersectsNode(imgs[i])) return true;
    }
    return false;
  }

  // Capture selection data synchronously BEFORE any DOM changes
  function captureSelectionData() {
    const text = window.getSelection().toString().trim();
    const meta = extractCougarbotMetadata();
    const hasImages = selectionHasImages();
    return { text, meta, hasImages };
  }

  let pendingPostMessage = null;
  let postMessageRetryTimer = null;
  let iframeReady = false;

  function sendToAIWithData(text, meta, hasImages) {
    window.__psfLastSelectedText = text;
    window.__psfLastSourceUrl = window.location.href;
    window.__psfLastMeta = meta;

    const fullPrompt = promptTemplate.replace('{text}', text);
    const autoSubmit = !hasImages;
    const msg = { type: 'PSF_FILL_AND_SUBMIT', prompt: fullPrompt, autoSubmit };

    // If iframe is ready, send immediately; otherwise queue and retry
    if (iframeReady && aiIframe && aiIframe.contentWindow) {
      console.log('[解題心流] Sending prompt via postMessage (ready)');
      aiIframe.contentWindow.postMessage(msg, '*');
    } else {
      console.log('[解題心流] Iframe not ready, queuing prompt...');
      pendingPostMessage = msg;
      startPostMessageRetry();
    }
  }

  function startPostMessageRetry() {
    if (postMessageRetryTimer) clearInterval(postMessageRetryTimer);
    let attempts = 0;
    postMessageRetryTimer = setInterval(() => {
      attempts++;
      if (!pendingPostMessage || attempts > 30) {
        clearInterval(postMessageRetryTimer);
        postMessageRetryTimer = null;
        return;
      }
      if (aiIframe && aiIframe.contentWindow) {
        console.log('[解題心流] Retry postMessage, attempt:', attempts);
        aiIframe.contentWindow.postMessage(pendingPostMessage, '*');
        // Don't clear yet — content-script-ai.js will confirm via PSF_RECEIVED
      }
    }, 1000);
  }

  // Listen for iframe ready signal
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'PSF_AI_READY') {
      console.log('[解題心流] Iframe reported ready');
      iframeReady = true;
      if (pendingPostMessage && aiIframe && aiIframe.contentWindow) {
        console.log('[解題心流] Sending queued prompt');
        aiIframe.contentWindow.postMessage(pendingPostMessage, '*');
      }
    }
    if (event.data && event.data.type === 'PSF_RECEIVED') {
      // Prompt was received, stop retrying
      pendingPostMessage = null;
      if (postMessageRetryTimer) {
        clearInterval(postMessageRetryTimer);
        postMessageRetryTimer = null;
      }
    }
  });

  // ── Export ──
  function formatRecord(r, index) {
    let out = '';

    // Header line: 題號 + 年份/考試資訊
    const headerParts = [];
    if (r.questionNum) headerParts.push('題號 ' + r.questionNum);
    if (r.examInfo) headerParts.push(r.examInfo);
    if (r.year && !( r.examInfo && r.examInfo.includes(r.year))) headerParts.push(r.year);
    if (headerParts.length > 0) {
      out += '【' + headerParts.join(' — ') + '】\n';
    }

    // AI response with category annotation
    let response = (r.aiResponse || '').trim();

    if (r.categories && r.categories.length > 0) {
      const lines = response.split('\n');
      const firstLine = lines[0].trim();
      const catStr = r.categories.join('/');
      if (firstLine && !firstLine.startsWith('#')) {
        lines[0] = firstLine + '/' + catStr + '(Original)';
      } else {
        lines.unshift(catStr + '(Original)');
      }
      response = lines.join('\n');
    }

    out += response + '\n\n';

    // Hashtags at the end
    if (r.categories && r.categories.length > 0) {
      out += r.categories.map(c => `#${c}`).join(' ') + '\n\n';
    }

    out += '---\n\n';
    return out;
  }

  function exportRecords(format) {
    const now = new Date();
    const dateStr = now.toLocaleString('zh-TW', { year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit' });
    const examInfos = [...new Set(records.map(r => r.examInfo).filter(Boolean))];

    let content = '';
    records.forEach((r, i) => { content += formatRecord(r, i); });

    const ext = format === 'txt' ? 'txt' : 'md';
    const mime = format === 'txt' ? 'text/plain' : 'text/markdown';

    // For .txt: strip markdown formatting
    let fileContent = content;
    if (format === 'txt') {
      fileContent = content
        .replace(/^#{1,3}\s*/gm, '')       // remove # headings
        .replace(/\*\*([^*]+)\*\*/g, '$1') // remove **bold**
        .replace(/\*([^*]+)\*/g, '$1');    // remove *italic*
    }

    const b64 = btoa(unescape(encodeURIComponent(fileContent)));
    const examPrefix = examInfos[0] ? examInfos[0].replace(/\s+/g, '_') + '_' : '';
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_FILE',
      url: `data:${mime};base64,` + b64,
      filename: `${examPrefix}解題記錄_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.${ext}`
    });
    navigator.clipboard.writeText(fileContent).then(() => {
      if (confirm(`已匯出 ${records.length} 題 (.${ext}) 並複製到剪貼簿。\n要清除當前記錄嗎？`)) {
        records = [];
        saveRecords();
      }
    });
  }

  // ── Message listeners ──
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SEND_TO_AI') {
      const selData = captureSelectionData();
      selData.text = msg.text || selData.text;
      if (!isOpen) openSidebar(selData);
      else sendToAIWithData(selData.text, selData.meta, selData.hasImages);
      if (selData.hasImages) {
        setTimeout(() => alert('⚠️ 題目含有圖片。文字已填入 Gemini，請手動貼上圖片後自行按送出。'), 300);
      }
    }
    if (msg.type === 'TRIGGER_SEND_TO_AI') {
      const selData = captureSelectionData();
      if (selData.text) {
        if (!isOpen) openSidebar(selData);
        else sendToAIWithData(selData.text, selData.meta, selData.hasImages);
        if (selData.hasImages) {
          setTimeout(() => alert('⚠️ 題目含有圖片。文字已填入 Gemini，請手動貼上圖片後自行按送出。'), 300);
        }
      }
    }
    if (msg.type === 'AI_RESPONSE_CAPTURED') {
      const d = msg.data;
      const meta = window.__psfLastMeta || {};
      records.push({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        sourceUrl: window.__psfLastSourceUrl || '',
        selectedText: window.__psfLastSelectedText || '',
        aiPlatform: d.platform,
        aiResponse: d.responseText,
        // Cougarbot metadata
        questionNum: meta.questionNum || '',
        examInfo: meta.examInfo || '',
        year: meta.year || '',
        categories: meta.categories || []
      });
      saveRecords();
    }
  });

  loadSettings();
})();
