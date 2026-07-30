/**
 * 弹窗逻辑
 *
 * 功能：
 *   1. 检测当前页面类型（J-PlatPat / DPMAregister / 不支持）
 *   2. 根据页面类型显示对应操作按钮
 *   3. 执行提取操作并展示结果（独立于桌面应用）
 *   4. 提供复制、发送到应用、AI 梳理功能（后两者需要桌面应用）
 */

// ============ 应用端口发现 ============

const APP_PORT_STORAGE_KEY = 'patent-helper-app-port';
const DEFAULT_PORTS = [8080, 7865, 7866, 7867, 7868, 7869, 7870, 7871, 7872, 7873, 7874, 7875];

/**
 * 发现桌面应用端口
 */
async function discoverAppPort() {
  const saved = localStorage.getItem(APP_PORT_STORAGE_KEY);
  if (saved) {
    const port = parseInt(saved, 10);
    if (await testPort(port)) return port;
    localStorage.removeItem(APP_PORT_STORAGE_KEY);
  }

  for (const port of DEFAULT_PORTS) {
    if (await testPort(port)) {
      localStorage.setItem(APP_PORT_STORAGE_KEY, String(port));
      return port;
    }
  }

  return null;
}

/**
 * 测试端口是否可用
 */
async function testPort(port) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`http://127.0.0.1:${port}/api/extension/port`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json();
      return data.port === port;
    }
  } catch {
    // 端口不可用
  }
  return false;
}

/**
 * 获取应用基础 URL
 */
async function getAppBaseUrl() {
  const port = await discoverAppPort();
  if (port) return `http://127.0.0.1:${port}`;
  return null;
}

// ============ DOM 元素引用 ============
const pageInfo = document.getElementById('page-info');
const statusDot = document.getElementById('status-dot');
const pageTypeText = document.getElementById('page-type-text');
const actionsSection = document.getElementById('actions');
const resultSection = document.getElementById('result-section');
const resultContent = document.getElementById('result-content');
const resultCount = document.getElementById('result-count');
const footerActions = document.getElementById('footer-actions');
const btnCopy = document.getElementById('btn-copy');
const btnSend = document.getElementById('btn-send');
const btnAnalyze = document.getElementById('btn-analyze');
const appStatusDot = document.getElementById('app-status-dot');
const appStatusText = document.getElementById('app-status-text');

// ============ 状态 ============
let currentPage = null; // { office: 'JP'|'DE'|null, pageType: string }
let extractedData = null; // 最近一次提取的数据
let appConnected = false; // 桌面应用连接状态

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', async () => {
  await detectCurrentPage();
  renderActions();
  checkAppConnection();
});

/**
 * 检查桌面应用连接状态
 */
async function checkAppConnection() {
  const baseUrl = await getAppBaseUrl();
  appConnected = !!baseUrl;
  if (appStatusDot) {
    appStatusDot.className = 'status-dot ' + (appConnected ? 'connected' : 'disconnected');
  }
  if (appStatusText) {
    appStatusText.textContent = appConnected ? '应用已连接' : '应用未连接（提取功能正常，发送/AI需应用）';
  }
}

// ============ 页面检测 ============

/**
 * 检测当前标签页的页面类型
 */
async function detectCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      setPageInfo(null, 'unknown');
      return;
    }

    const url = tab.url;

    if (url.includes('worldwide.espacenet.com')) {
      // Espacenet 页面检测
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          target: 'espacenet',
          action: 'detectPage',
        });
        currentPage = { office: 'EP', pageType: response.pageType };
        setPageInfo('EP', response.pageType);
      } catch {
        let pageType = 'unknown';
        if (url.includes('/publication/')) pageType = 'patent_detail';
        else if (url.includes('/search')) pageType = 'search_results';
        currentPage = { office: 'EP', pageType };
        setPageInfo('EP', pageType);
      }
    } else if (url.includes('j-platpat.inpit.go.jp')) {
      // 先尝试通过 content script 检测，失败则通过 URL 判断
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          target: 'jplatpat',
          action: 'detectPage',
        });
        currentPage = { office: 'JP', pageType: response.pageType };
        setPageInfo('JP', response.pageType);
      } catch {
        let pageType = 'unknown';
        if (url.includes('/h0000')) pageType = 'keika';
        else if (url.includes('/h0101')) pageType = 'document';
        else if (url.includes('/p0200')) pageType = 'bibliography';
        currentPage = { office: 'JP', pageType };
        setPageInfo('JP', pageType);
      }
    } else if (url.includes('register.dpma.de')) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          target: 'dpma',
          action: 'detectPage',
        });
        currentPage = { office: 'DE', pageType: response.pageType };
        setPageInfo('DE', response.pageType);
      } catch {
        currentPage = { office: 'DE', pageType: 'register' };
        setPageInfo('DE', 'register');
      }
    } else {
      currentPage = { office: null, pageType: 'unsupported' };
      setPageInfo(null, 'unsupported');
    }
  } catch (error) {
    setPageInfo(null, 'error');
  }
}

/**
 * 设置页面识别信息显示
 */
function setPageInfo(office, pageType) {
  statusDot.className = 'status-dot';
  if (office === 'EP') statusDot.classList.add('ep');
  else if (office === 'JP') statusDot.classList.add('jp');
  else if (office === 'DE') statusDot.classList.add('de');
  else statusDot.classList.add('unsupported');

  const labels = {
    patent_detail: 'Espacenet - 专利详情页面',
    search_results: 'Espacenet - 搜索结果页面',
    keika: 'J-PlatPat - 审查经纬页面',
    document: 'J-PlatPat - 文档内容页面',
    bibliography: 'J-PlatPat - 文献表示页面',
    register: 'DPMAregister - 注册信息页面',
    unknown: office === 'EP' ? 'Espacenet - 未知页面' : (office === 'JP' ? 'J-PlatPat - 未知页面' : 'DPMAregister - 未知页面'),
    unsupported: '当前页面不受支持',
    error: '检测失败',
  };
  pageTypeText.textContent = labels[pageType] || '未知页面';
}

// ============ 操作按钮渲染 ============

function renderActions() {
  actionsSection.innerHTML = '';

  if (!currentPage || !currentPage.office) {
    const hint = document.createElement('div');
    hint.style.cssText = 'padding: 8px; text-align: center; color: var(--text-secondary); font-size: 12px;';
    hint.textContent = '请打开 Espacenet、J-PlatPat 或 DPMAregister 页面后使用';
    actionsSection.appendChild(hint);
    return;
  }

  const { office, pageType } = currentPage;

  if (office === 'EP') {
    switch (pageType) {
      case 'patent_detail':
        addButton('一键提取专利全文（发送到应用）', () => extractData('extractPatent'), 'btn-primary');
        addButton('提取当前标签页内容', () => extractData('extractCurrent'), 'btn-secondary');
        break;
      case 'search_results':
        addHint('请点击进入具体专利详情页后提取');
        break;
      default:
        addHint('请导航到专利详情页面');
        break;
    }
  } else if (office === 'JP') {
    switch (pageType) {
      case 'keika':
        addButton('提取审查经纬列表', () => extractData('extractKeika'), 'btn-primary');
        addButton('提取全部文档内容', () => extractData('extractAllDocuments'), 'btn-secondary');
        break;
      case 'document':
        addButton('提取当前文档内容', () => extractData('extractDocument'), 'btn-primary');
        break;
      case 'bibliography':
        addButton('提取书志信息', () => extractData('extractBibliography'), 'btn-primary');
        break;
      default:
        addHint('请导航到审查经纬、文档内容或文献表示页面');
        break;
    }
  } else if (office === 'DE') {
    switch (pageType) {
      case 'register':
        addButton('提取注册信息', () => extractData('extractRegister'), 'btn-primary');
        break;
      default:
        addHint('请导航到注册信息页面');
        break;
    }
  }
}

function addButton(text, onClick, className = 'btn-primary') {
  const btn = document.createElement('button');
  btn.className = `btn ${className}`;
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  actionsSection.appendChild(btn);
}

function addHint(text) {
  const hint = document.createElement('div');
  hint.style.cssText = 'padding: 8px; text-align: center; color: var(--text-secondary); font-size: 12px;';
  hint.textContent = text;
  actionsSection.appendChild(hint);
}

// ============ 核心提取逻辑 ============

/**
 * 向 content script 发送提取请求
 * 优先使用 chrome.tabs.sendMessage，失败时回退到 chrome.scripting.executeScript 动态注入
 */
async function extractData(action) {
  if (!currentPage) return;

  // 显示加载状态
  resultSection.classList.remove('hidden');
  resultContent.innerHTML = '<div style="text-align:center;padding:20px;"><span class="loading"></span> 提取中...</div>';
  resultCount.textContent = '';

  const target = currentPage.office === 'JP' ? 'jplatpat' : 'dpma';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('无法获取当前标签页');

    let response = null;

    // 方法1：尝试通过 content script 消息通信
    try {
      response = await chrome.tabs.sendMessage(tab.id, { target, action });
    } catch {
      // Content script 未加载（SPA 导航、弹窗页面等），尝试动态注入
      console.log('[插件] Content script 未响应，尝试动态注入...');
    }

    // 方法2：如果 content script 未响应，使用 scripting API 动态注入
    if (!response) {
      try {
        const file = target === 'jplatpat' ? 'content/jplatpat.js' : 'content/dpma.js';
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [file],
        });
        // 等待脚本初始化
        await new Promise(resolve => setTimeout(resolve, 200));
        response = await chrome.tabs.sendMessage(tab.id, { target, action });
      } catch (injectError) {
        // 方法3：最终回退 — 直接在页面中执行提取函数
        console.log('[插件] 动态注入后仍失败，尝试直接执行提取...');
        response = await extractViaScripting(tab.id, target, action);
      }
    }

    if (!response) {
      throw new Error('未收到提取结果');
    }

    if (response.error) {
      showError(response.error);
      return;
    }

    extractedData = response;
    renderResult(response);
    footerActions.classList.remove('hidden');
  } catch (error) {
    showError(`提取失败: ${error.message}`);
  }
}

/**
 * 通过 chrome.scripting.executeScript 直接在页面中执行提取逻辑（最终回退方案）
 */
async function extractViaScripting(tabId, target, action) {
  // 对于复杂的提取逻辑，直接注入对应的 content script 文件
  let file;
  if (target === 'espacenet') file = 'content/espacenet.js';
  else if (target === 'jplatpat') file = 'content/jplatpat.js';
  else if (target === 'dpma') file = 'content/dpma.js';
  else throw new Error('未知的目标类型');

  try {
    // 先尝试注入文件
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [file],
    });
    await new Promise(resolve => setTimeout(resolve, 500));

    // 然后发送消息
    return await chrome.runtime.sendMessage({
      action: 'forwardToContent',
      tabId,
      payload: { target, action },
    });
  } catch {
    // 如果文件注入失败，jplatpat 和 dpma 可以用内联函数
    if (target === 'jplatpat') {
      return extractJpViaScripting(tabId, action);
    } else if (target === 'dpma') {
      return extractDeViaScripting(tabId, action);
    }
    throw new Error('注入脚本失败');
  }
}

/**
 * 通过 scripting API 直接提取 J-PlatPat 数据
 */
async function extractJpViaScripting(tabId, action) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (actionType) => {
      // ===== 内联提取逻辑 =====

      // 文档类别映射
      const CATEGORY_MAP = {
        '拒絶理由通知書': 'office_action', '意見書': 'response', '手続補正書': 'amendment',
        '検索報告書': 'search_report', '特許査定': 'allowance', '出願審査請求書': 'request',
        '明細書': 'specification', '請求の範囲': 'claims', '要約書': 'abstract',
        '図面': 'drawings', '特許願': 'application',
      };

      function inferCategory(name) {
        for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
          if (name.includes(keyword)) return category;
        }
        return 'other';
      }

      if (actionType === 'extractBibliography') {
        const result = {
          office: 'JP', type: 'bibliography',
          patentNumber: '', appNumber: '', title: '', applicant: '',
          inventor: '', filingDate: '', registrationDate: '',
          publicationNumber: '', publicationDate: '', status: '',
        };
        const bodyText = document.body.innerText;
        const m1 = bodyText.match(/【特許番号】\s*特許第(\d+)号/);
        if (m1) result.patentNumber = `特許${m1[1]}`;
        const m2 = bodyText.match(/【出願番号】\s*特願(\d{4}[-‐]\d+)/);
        if (m2) result.appNumber = `特願${m2[1]}`;
        const m3 = bodyText.match(/【発明の名称】\s*(.+)/);
        if (m3) result.title = m3[1].trim();
        const m4 = bodyText.match(/【特許権者】[\s\S]*?【氏名又は名称】\s*(.+)/);
        if (m4) result.applicant = m4[1].trim();
        else {
          const m4b = bodyText.match(/【出願人】[\s\S]*?【氏名又は名称】\s*(.+)/);
          if (m4b) result.applicant = m4b[1].trim();
        }
        const m5 = bodyText.match(/【発明者】[\s\S]*?【氏名】\s*(.+)/);
        if (m5) result.inventor = m5[1].trim();
        const m6 = bodyText.match(/【出願日】\s*(.+)/);
        if (m6) result.filingDate = m6[1].trim();
        const m7 = bodyText.match(/【登録日】\s*(.+)/);
        if (m7) result.registrationDate = m7[1].trim();
        const m8 = bodyText.match(/【公開番号】\s*(.+?)[\s(]/);
        if (m8) result.publicationNumber = m8[1].trim();
        const m9 = bodyText.match(/【公開日】\s*(.+)/);
        if (m9) result.publicationDate = m9[1].trim();
        const m10 = bodyText.match(/【公報種別】\s*(.+)/);
        if (m10) result.status = m10[1].trim();
        // 添加调试信息
        result._debug = bodyText.substring(0, 800);
        return result;
      }

      if (actionType === 'extractKeika') {
        const appNumber = (document.body.innerText.match(/特願(\d{4}[-‐]\d+)/) || [])[0] || '';
        const documents = [];
        const links = document.querySelectorAll('a[href="javascript:void(0)"]');
        let applicationDate = '';
        for (const link of links) {
          const name = link.textContent.trim();
          if (!name || name.length < 2) continue;
          const category = inferCategory(name);
          if (category === 'other') continue;
          let date = '';
          const row = link.closest('tr');
          if (row) {
            const cells = row.querySelectorAll('td, th');
            for (const cell of cells) {
              const dm = cell.textContent.trim().match(/(\d{4}[\/.]\d{2}[\/.]\d{2})/);
              if (dm) { date = dm[1]; break; }
            }
          }
          if (category === 'application' && date) applicationDate = date;
          documents.push({ name, date, category });
        }
        const CO_FILED = ['明細書', '請求の範囲', '要約書', '図面'];
        if (applicationDate) {
          for (const doc of documents) {
            if (!doc.date && CO_FILED.some(k => doc.name.includes(k))) doc.date = applicationDate;
          }
        }
        return { office: 'JP', type: 'keika', appNumber, documents };
      }

      if (actionType === 'extractDocument') {
        let title = '';
        const h2 = document.querySelector('h2');
        if (h2) title = h2.textContent.trim();
        if (!title) {
          for (const h of document.querySelectorAll('h1, h2, h3')) {
            if (h.textContent.trim().length > 2) { title = h.textContent.trim(); break; }
          }
        }
        let content = '';
        const mc = document.querySelector('.processes-content');
        if (mc) content = mc.innerText.trim();
        else {
          const ca = document.querySelector('#contents');
          if (ca) {
            const clone = ca.cloneNode(true);
            clone.querySelectorAll('script,style,noscript,.global-nav,header,nav').forEach(el => el.remove());
            content = clone.innerText.trim();
          } else {
            const body = document.body.cloneNode(true);
            body.querySelectorAll('script,style,noscript,h1,h2,h3').forEach(el => el.remove());
            content = body.innerText.trim();
          }
        }
        return { office: 'JP', type: 'document', title, content };
      }

      if (actionType === 'extractAllDocuments') {
        const appNumber = (document.body.innerText.match(/特願(\d{4}[-‐]\d+)/) || [])[0] || '';
        const documents = [];
        const links = document.querySelectorAll('a[href="javascript:void(0)"]');
        for (const link of links) {
          const name = link.textContent.trim();
          if (!name || name.length < 2) continue;
          const category = inferCategory(name);
          if (category === 'other') continue;
          let date = '';
          const row = link.closest('tr');
          if (row) {
            for (const cell of row.querySelectorAll('td, th')) {
              const dm = cell.textContent.trim().match(/(\d{4}[\/.]\d{2}[\/.]\d{2})/);
              if (dm) { date = dm[1]; break; }
            }
          }
          documents.push({ name, date, category });
        }
        return { office: 'JP', type: 'keika_all', appNumber, documents, message: `发现 ${documents.length} 个文档` };
      }

      return { error: `未知操作: ${actionType}` };
    },
    args: [action],
  });

  return results[0]?.result;
}

/**
 * 通过 scripting API 直接提取 DPMA 数据
 */
async function extractDeViaScripting(tabId, action) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const result = {
        office: 'DE', type: 'register',
        akz: '', status: '', title: '', applicant: '',
        filingDate: '', publicationDate: '',
        bescheideCount: 0, erwiderungenCount: 0,
        ipcClasses: [], procedures: [], pdfLinks: [],
      };
      const bodyText = document.body.innerText;
      const m1 = bodyText.match(/Aktenzeichen[:\s]*([A-Z]\d{2}\/\d+[\w.-]*)/i);
      if (m1) result.akz = m1[1].trim();
      const m2 = bodyText.match(/Status[:\s]*(.+)/i);
      if (m2) result.status = m2[1].trim();
      const m3 = bodyText.match(/Bezeichnung[:\s]*(.+)/i);
      if (m3) result.title = m3[1].trim();
      const m4 = bodyText.match(/Anmelder[:\s]*(.+)/i);
      if (m4) result.applicant = m4[1].trim();
      const m5 = bodyText.match(/Anmeldetag[:\s]*(\d{2}\.\d{2}\.\d{4})/);
      if (m5) result.filingDate = m5[1];
      const m6 = bodyText.match(/Offenlegungstag[:\s]*(\d{2}\.\d{2}\.\d{4})/);
      if (m6) result.publicationDate = m6[1];
      result._debug = bodyText.substring(0, 800);
      return result;
    },
  });

  return results[0]?.result;
}

// ============ 结果渲染 ============

function renderResult(data) {
  resultContent.innerHTML = '';

  if (data.error) {
    showError(data.error);
    return;
  }

  switch (data.type) {
    case 'keika':
      renderKeikaResult(data);
      break;
    case 'keika_all':
      renderKeikaAllResult(data);
      break;
    case 'document':
      renderDocumentResult(data);
      break;
    case 'bibliography':
      renderBibliographyResult(data);
      break;
    case 'register':
      renderRegisterResult(data);
      break;
    default:
      resultContent.textContent = JSON.stringify(data, null, 2);
  }
}

function renderKeikaResult(data) {
  const docs = data.documents || [];
  resultCount.textContent = `${docs.length} 个文档`;

  if (data.appNumber) addField('出愿号', data.appNumber);

  if (docs.length === 0) {
    resultContent.innerHTML += '<div style="color:var(--text-secondary);padding:8px 0;">未找到审查文档</div>';
    return;
  }

  for (const doc of docs) {
    const item = document.createElement('div');
    item.className = 'doc-item';
    item.innerHTML = `
      <span class="doc-name">${escapeHtml(doc.name)}</span>
      <span class="doc-date">${escapeHtml(doc.date)}</span>
      <span class="doc-category">${escapeHtml(doc.category)}</span>
    `;
    resultContent.appendChild(item);
  }
}

function renderKeikaAllResult(data) {
  const docs = data.documents || [];
  resultCount.textContent = `${docs.length} 个文档`;

  if (data.message) {
    const msg = document.createElement('div');
    msg.style.cssText = 'color:var(--accent-orange);padding:4px 0;margin-bottom:4px;';
    msg.textContent = data.message;
    resultContent.appendChild(msg);
  }

  if (data.appNumber) addField('出愿号', data.appNumber);

  for (const doc of docs) {
    const item = document.createElement('div');
    item.className = 'doc-item';
    item.innerHTML = `
      <span class="doc-name">${escapeHtml(doc.name)}</span>
      <span class="doc-date">${escapeHtml(doc.date)}</span>
      <span class="doc-category">${escapeHtml(doc.category)}</span>
    `;
    resultContent.appendChild(item);
  }
}

function renderDocumentResult(data) {
  if (data.title) addField('标题', data.title);

  const content = data.content || '';
  resultCount.textContent = `${content.length} 字`;

  const contentDiv = document.createElement('div');
  contentDiv.style.cssText = 'margin-top:6px;white-space:pre-wrap;word-break:break-all;max-height:180px;overflow-y:auto;';

  if (content.length > 2000) {
    contentDiv.textContent = content.substring(0, 2000) + '\n\n... (内容已截断，完整内容可通过复制获取)';
  } else {
    contentDiv.textContent = content;
  }

  resultContent.appendChild(contentDiv);
}

function renderBibliographyResult(data) {
  const fields = [];
  if (data.patentNumber) fields.push(['专利号', data.patentNumber]);
  if (data.appNumber) fields.push(['出愿号', data.appNumber]);
  if (data.title) fields.push(['发明名称', data.title]);
  if (data.applicant) fields.push(['专利权者', data.applicant]);
  if (data.inventor) fields.push(['发明者', data.inventor]);
  if (data.filingDate) fields.push(['出愿日', data.filingDate]);
  if (data.registrationDate) fields.push(['注册日', data.registrationDate]);
  if (data.publicationNumber) fields.push(['公开番号', data.publicationNumber]);
  if (data.publicationDate) fields.push(['公开日', data.publicationDate]);
  if (data.status) fields.push(['公报种别', data.status]);

  if (fields.length === 0) {
    // 没有提取到任何字段
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'color:var(--accent-orange);padding:8px 0;';
    emptyMsg.textContent = '未提取到书志信息，请确认页面已完全加载';
    resultContent.appendChild(emptyMsg);

    // 显示调试信息（页面文本片段）
    if (data._debug) {
      const debugDiv = document.createElement('div');
      debugDiv.style.cssText = 'margin-top:8px;padding:8px;background:var(--bg-secondary);border-radius:4px;font-size:11px;max-height:120px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);';
      debugDiv.textContent = '页面文本片段（用于调试）:\n' + data._debug;
      resultContent.appendChild(debugDiv);
    }
    return;
  }

  resultCount.textContent = `${fields.length} 个字段`;
  for (const [label, value] of fields) {
    addField(label, value);
  }
}

function renderRegisterResult(data) {
  const fields = [];
  if (data.akz) fields.push(['Aktenzeichen', data.akz]);
  if (data.status) fields.push(['Status', data.status]);
  if (data.title) fields.push(['Bezeichnung', data.title]);
  if (data.applicant) fields.push(['Anmelder', data.applicant]);
  if (data.filingDate) fields.push(['Anmeldetag', data.filingDate]);
  if (data.publicationDate) fields.push(['Offenlegungstag', data.publicationDate]);
  if (data.bescheideCount > 0) fields.push(['Bescheide', String(data.bescheideCount)]);
  if (data.erwiderungenCount > 0) fields.push(['Erwiderungen', String(data.erwiderungenCount)]);
  if (data.ipcClasses && data.ipcClasses.length > 0) fields.push(['IPC', data.ipcClasses.join(', ')]);

  if (fields.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'color:var(--accent-orange);padding:8px 0;';
    emptyMsg.textContent = '未提取到注册信息，请确认页面已完全加载';
    resultContent.appendChild(emptyMsg);

    if (data._debug) {
      const debugDiv = document.createElement('div');
      debugDiv.style.cssText = 'margin-top:8px;padding:8px;background:var(--bg-secondary);border-radius:4px;font-size:11px;max-height:120px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);';
      debugDiv.textContent = '页面文本片段（用于调试）:\n' + data._debug;
      resultContent.appendChild(debugDiv);
    }
    return;
  }

  resultCount.textContent = `${fields.length} 个字段`;
  for (const [label, value] of fields) {
    addField(label, value);
  }

  if (data.procedures && data.procedures.length > 0) {
    const procHeader = document.createElement('div');
    procHeader.style.cssText = 'margin-top:8px;font-weight:600;font-size:11px;color:var(--text-secondary);';
    procHeader.textContent = 'Verfahrensdaten';
    resultContent.appendChild(procHeader);

    for (const proc of data.procedures) {
      const item = document.createElement('div');
      item.className = 'doc-item';
      item.innerHTML = `
        <span class="doc-name">${escapeHtml(proc.type)}</span>
        <span class="doc-date">${escapeHtml(proc.date)}</span>
        <span class="doc-category">${escapeHtml(proc.status)}</span>
      `;
      resultContent.appendChild(item);
    }
  }

  if (data.pdfLinks && data.pdfLinks.length > 0) {
    const pdfHeader = document.createElement('div');
    pdfHeader.style.cssText = 'margin-top:8px;font-weight:600;font-size:11px;color:var(--text-secondary);';
    pdfHeader.textContent = 'PDF 文档';
    resultContent.appendChild(pdfHeader);

    for (const pdf of data.pdfLinks) {
      const link = document.createElement('a');
      link.href = pdf.url;
      link.target = '_blank';
      link.style.cssText = 'display:block;padding:2px 0;color:var(--accent-blue);text-decoration:none;font-size:12px;';
      link.textContent = pdf.label;
      resultContent.appendChild(link);
    }
  }
}

function addField(label, value) {
  const field = document.createElement('div');
  field.className = 'field';
  field.innerHTML = `<span class="field-label">${escapeHtml(label)}: </span><span class="field-value">${escapeHtml(value)}</span>`;
  resultContent.appendChild(field);
}

function showError(message) {
  resultSection.classList.remove('hidden');
  resultContent.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
  resultCount.textContent = '';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 2000);
}

// ============ 底部按钮事件 ============

btnCopy.addEventListener('click', async () => {
  if (!extractedData) {
    showToast('没有可复制的数据');
    return;
  }

  try {
    const text = JSON.stringify(extractedData, null, 2);
    await navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板');
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = JSON.stringify(extractedData, null, 2);
    textarea.style.cssText = 'position:fixed;left:-9999px;';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('已复制到剪贴板');
  }
});

btnSend.addEventListener('click', async () => {
  if (!extractedData) {
    showToast('没有可发送的数据');
    return;
  }

  btnSend.disabled = true;
  const originalText = btnSend.innerHTML;
  btnSend.innerHTML = '<span class="loading"></span> 发送中...';

  try {
    const baseUrl = await getAppBaseUrl();
    if (!baseUrl) {
      showToast('未找到桌面应用，请确保应用已启动');
      return;
    }

    const response = await fetch(`${baseUrl}/api/extension/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        office: extractedData.office,
        data: extractedData,
        source: 'browser-extension',
      }),
    });

    if (response.ok) {
      showToast('发送成功');
    } else {
      showToast(`发送失败: HTTP ${response.status}`);
    }
  } catch {
    showToast('发送失败: 无法连接到桌面应用');
  } finally {
    btnSend.disabled = false;
    btnSend.innerHTML = originalText;
  }
});

btnAnalyze.addEventListener('click', async () => {
  if (!extractedData) {
    showToast('没有可分析的数据');
    return;
  }

  btnAnalyze.disabled = true;
  const originalText = btnAnalyze.innerHTML;
  btnAnalyze.innerHTML = '<span class="loading"></span> 分析中...';

  try {
    const baseUrl = await getAppBaseUrl();
    if (!baseUrl) {
      showToast('未找到桌面应用，AI 梳理需要桌面应用运行');
      return;
    }

    const response = await fetch(`${baseUrl}/api/extension/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        office: extractedData.office,
        content: extractedData.content || JSON.stringify(extractedData),
        type: extractedData.type,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      showToast('分析完成');
      if (result.analysis) {
        resultContent.innerHTML += '\n\n--- AI 分析 ---\n' + escapeHtml(result.analysis);
      }
    } else {
      showToast(`分析失败: HTTP ${response.status}`);
    }
  } catch {
    showToast('分析失败: 无法连接到桌面应用');
  } finally {
    btnAnalyze.disabled = false;
    btnAnalyze.innerHTML = originalText;
  }
});
