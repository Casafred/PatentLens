/**
 * Background Service Worker
 *
 * 功能：
 *   - 监听来自 content script 和 popup 的消息
 *   - 管理右键菜单提取
 *   - 管理扩展状态
 */

// ============ 扩展安装/更新 ============
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[专利审查文档助手] 扩展已安装');
    chrome.storage.local.set({
      settings: {
        tauriEndpoint: 'http://localhost:8080',
        autoExtract: false,
      },
    });
  } else if (details.reason === 'update') {
    console.log('[专利审查文档助手] 扩展已更新');
  }

  // 创建右键菜单（解决弹窗页面无法点击扩展图标的问题）
  chrome.contextMenus.create({
    id: 'patent-extract',
    title: '专利审查文档助手 - 提取当前页面',
    contexts: ['page'],
    documentUrlPatterns: [
      'https://worldwide.espacenet.com/*',
      'https://www.j-platpat.inpit.go.jp/*',
      'https://register.dpma.de/*',
    ],
  });

  // Espacenet 子菜单
  chrome.contextMenus.create({
    id: 'ep-extract-all',
    parentId: 'patent-extract',
    title: '提取专利全文（各标签页）',
    contexts: ['page'],
    documentUrlPatterns: ['https://worldwide.espacenet.com/*'],
  });
  chrome.contextMenus.create({
    id: 'ep-extract-current',
    parentId: 'patent-extract',
    title: '提取当前标签页内容',
    contexts: ['page'],
    documentUrlPatterns: ['https://worldwide.espacenet.com/*'],
  });

  // J-PlatPat 子菜单
  chrome.contextMenus.create({
    id: 'jp-extract-keika',
    parentId: 'patent-extract',
    title: '提取审查经纬列表',
    contexts: ['page'],
    documentUrlPatterns: ['https://www.j-platpat.inpit.go.jp/*'],
  });
  chrome.contextMenus.create({
    id: 'jp-extract-document',
    parentId: 'patent-extract',
    title: '提取当前文档内容',
    contexts: ['page'],
    documentUrlPatterns: ['https://www.j-platpat.inpit.go.jp/*'],
  });
  chrome.contextMenus.create({
    id: 'jp-extract-bibliography',
    parentId: 'patent-extract',
    title: '提取书志信息',
    contexts: ['page'],
    documentUrlPatterns: ['https://www.j-platpat.inpit.go.jp/*'],
  });

  // DPMA 子菜单
  chrome.contextMenus.create({
    id: 'de-extract-register',
    parentId: 'patent-extract',
    title: '提取注册信息',
    contexts: ['page'],
    documentUrlPatterns: ['https://register.dpma.de/*'],
  });
});

// ============ 右键菜单点击处理 ============
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;

  const actionMap = {
    'ep-extract-all': 'extractPatent',
    'ep-extract-current': 'extractCurrent',
    'jp-extract-keika': 'extractKeika',
    'jp-extract-document': 'extractDocument',
    'jp-extract-bibliography': 'extractBibliography',
    'de-extract-register': 'extractRegister',
  };

  const action = actionMap[info.menuItemId];
  if (!action) return;

  let target;
  if (info.menuItemId.startsWith('ep-')) target = 'espacenet';
  else if (info.menuItemId.startsWith('jp-')) target = 'jplatpat';
  else target = 'dpma';

  try {
    // 方法1：尝试通过 content script 消息通信
    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { target, action }, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(res);
        }
      });
    });

    if (response && !response.error) {
      chrome.storage.local.set({ lastExtractedData: response });
      console.log('[右键菜单] 提取成功:', response.type || response.office);
    } else if (response && response.error) {
      console.error('[右键菜单] 提取返回错误:', response.error);
    }
  } catch {
    // 方法2：Content script 未加载，使用 scripting API 动态注入
    console.log('[右键菜单] Content script 未响应，尝试动态注入...');
    try {
      let file;
      if (target === 'espacenet') file = 'content/espacenet.js';
      else if (target === 'jplatpat') file = 'content/jplatpat.js';
      else file = 'content/dpma.js';
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [file],
      });
      // 等待脚本初始化
      await new Promise(resolve => setTimeout(resolve, 200));

      const response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { target, action }, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(res);
          }
        });
      });

      if (response && !response.error) {
        chrome.storage.local.set({ lastExtractedData: response });
        console.log('[右键菜单] 动态注入后提取成功:', response.type || response.office);
      } else if (response && response.error) {
        console.error('[右键菜单] 动态注入后提取返回错误:', response.error);
      }
    } catch (injectError) {
      console.error('[右键菜单] 动态注入也失败:', injectError.message);
    }
  }
});

// ============ 消息监听 ============
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 处理来自 popup 的消息，转发到 content script
  if (message.action === 'forwardToContent') {
    const { tabId, payload } = message;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, payload, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
      return true; // 异步响应
    }
    sendResponse({ error: '未指定标签页 ID' });
    return false;
  }

  // 处理来自 content script 的消息
  if (message.action === 'openDocumentTab') {
    const { url } = message;
    if (url) {
      chrome.tabs.create({ url }, (tab) => {
        sendResponse({ tabId: tab.id });
      });
      return true;
    }
    sendResponse({ error: '未提供 URL' });
    return false;
  }

  // 处理提取全部文档的请求
  if (message.action === 'extractAllDocuments') {
    handleExtractAllDocuments(message, sender)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  // 处理发送到 Tauri 应用的请求
  if (message.action === 'sendToTauri') {
    const { endpoint, data } = message;
    fetch(`${endpoint}/api/extension/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then((res) => res.json())
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  return false;
});

/**
 * 处理提取全部文档的请求
 */
async function handleExtractAllDocuments(message, sender) {
  const { documents, baseUrl } = message;
  if (!documents || documents.length === 0) {
    return { error: '没有文档需要提取' };
  }

  const results = [];

  for (const doc of documents) {
    try {
      const tab = await chrome.tabs.create({
        url: baseUrl || 'about:blank',
        active: false,
      });

      await new Promise((resolve) => {
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === tab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        });
        setTimeout(resolve, 10000);
      });

      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, {
          target: 'jplatpat',
          action: 'extractDocument',
        }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
          } else {
            resolve(res);
          }
        });
      });

      results.push({
        name: doc.name,
        date: doc.date,
        category: doc.category,
        ...response,
      });

      await chrome.tabs.remove(tab.id);
    } catch (error) {
      results.push({
        name: doc.name,
        date: doc.date,
        category: doc.category,
        error: error.message,
      });
    }
  }

  return {
    office: 'JP',
    type: 'documents_batch',
    documents: results,
  };
}

// ============ 标签页更新监听 ============
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (tab.url.includes('worldwide.espacenet.com') || tab.url.includes('j-platpat.inpit.go.jp') || tab.url.includes('register.dpma.de')) {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  }
});
