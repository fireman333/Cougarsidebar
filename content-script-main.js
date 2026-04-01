// content-script-main.js — Injected into all pages
// Creates and manages the AI sidebar

(function () {
  if (window.__problemSolvingFlowLoaded) return;
  window.__problemSolvingFlowLoaded = true;

  let sidebarContainer = null;
  let sidebarIframe = null;
  let isOpen = false;
  const SIDEBAR_MIN_WIDTH = 300;
  const SIDEBAR_DEFAULT_WIDTH = 400;

  function createSidebar() {
    if (sidebarContainer) return;

    sidebarContainer = document.createElement('div');
    sidebarContainer.id = 'psf-sidebar-container';
    sidebarContainer.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      width: ${SIDEBAR_DEFAULT_WIDTH}px;
      height: 100vh;
      z-index: 2147483647;
      display: none;
      flex-direction: row;
      box-shadow: -2px 0 10px rgba(0,0,0,0.3);
    `;

    const resizeHandle = document.createElement('div');
    resizeHandle.id = 'psf-resize-handle';
    resizeHandle.style.cssText = `
      width: 6px;
      height: 100%;
      cursor: col-resize;
      background: #2a2a4a;
      flex-shrink: 0;
    `;
    resizeHandle.addEventListener('mousedown', startResize);

    sidebarIframe = document.createElement('iframe');
    sidebarIframe.id = 'psf-sidebar-iframe';
    sidebarIframe.src = chrome.runtime.getURL('sidebar/sidebar.html');
    sidebarIframe.style.cssText = `
      flex: 1;
      border: none;
      height: 100%;
      width: 100%;
    `;

    sidebarContainer.appendChild(resizeHandle);
    sidebarContainer.appendChild(sidebarIframe);
    document.body.appendChild(sidebarContainer);
  }

  function openSidebar(selectedText) {
    createSidebar();
    sidebarContainer.style.display = 'flex';
    document.documentElement.style.marginRight = sidebarContainer.style.width;
    document.documentElement.style.transition = 'margin-right 0.2s ease';
    isOpen = true;

    if (selectedText) {
      const sendWhenReady = () => {
        sidebarIframe.contentWindow.postMessage({
          type: 'SELECTED_TEXT',
          text: selectedText,
          sourceUrl: window.location.href
        }, '*');
      };
      if (sidebarIframe.contentDocument?.readyState === 'complete') {
        sendWhenReady();
      } else {
        sidebarIframe.addEventListener('load', sendWhenReady, { once: true });
      }
    }
  }

  function closeSidebar() {
    if (!sidebarContainer) return;
    sidebarContainer.style.display = 'none';
    document.documentElement.style.marginRight = '0';
    isOpen = false;
  }

  let isResizing = false;

  function startResize(e) {
    isResizing = true;
    e.preventDefault();
    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);
    document.body.style.userSelect = 'none';
  }

  function doResize(e) {
    if (!isResizing) return;
    const newWidth = Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - e.clientX);
    sidebarContainer.style.width = newWidth + 'px';
    document.documentElement.style.marginRight = newWidth + 'px';
  }

  function stopResize() {
    isResizing = false;
    document.removeEventListener('mousemove', doResize);
    document.removeEventListener('mouseup', stopResize);
    document.body.style.userSelect = '';
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SEND_TO_AI') {
      if (isOpen && message.text) {
        sidebarIframe.contentWindow.postMessage({
          type: 'SELECTED_TEXT',
          text: message.text,
          sourceUrl: window.location.href
        }, '*');
      } else {
        openSidebar(message.text);
      }
    }
    if (message.type === 'TRIGGER_SEND_TO_AI') {
      const selectedText = window.getSelection().toString().trim();
      if (selectedText) {
        if (isOpen) {
          sidebarIframe.contentWindow.postMessage({
            type: 'SELECTED_TEXT',
            text: selectedText,
            sourceUrl: window.location.href
          }, '*');
        } else {
          openSidebar(selectedText);
        }
      }
    }
  });

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'CLOSE_SIDEBAR') {
      closeSidebar();
    }
  });
})();
