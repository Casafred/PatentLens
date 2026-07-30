/**
 * Espacenet 页面抓取 Content Script
 *
 * 支持：
 *   - 专利详情页面：提取书目数据、摘要、说明书、权利要求、附图、引用、法律事件、同族等
 *
 * 注意：Espacenet 是 React SPA，使用 data-qa 属性标识元素，类名带随机后缀，
 *       因此主要通过 data-qa 属性和 DOM 结构来定位元素。
 *       由于标签页内容按需加载，需要模拟点击标签页来触发内容加载。
 */

// ============ 防止重复注入 ============
if (typeof window.__patentHelperEspLoaded === 'undefined') {
window.__patentHelperEspLoaded = true;

/**
 * 等待指定选择器的元素出现（用于 SPA 动态加载）
 */
function waitForElement(selector, timeout = 8000) {
  return new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el) { resolve(el); return; }
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
  });
}

/**
 * 等待一段时间（用于等待 React 渲染）
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 从 URL 中提取专利公开号
 */
function extractPublicationNumber() {
  const url = window.location.href;
  const pubMatch = url.match(/\/publication\/([A-Z0-9]+)/);
  if (pubMatch) return pubMatch[1];

  const pubEl = document.querySelector('[data-qa="publicationNumber"]');
  if (pubEl) {
    const text = pubEl.textContent.trim();
    const searchMatch = text.match(/[A-Z]{2}\d+[A-Z0-9]*/);
    if (searchMatch) return searchMatch[0];
  }
  return '';
}

/**
 * 检测当前页面是否是专利详情页面
 */
function isPatentDetailPage() {
  return window.location.href.includes('/patent/search/family/') &&
         window.location.href.includes('/publication/');
}

/**
 * 通过 data-qa 或标签文本查找标签页并点击
 */
async function clickTabByQaOrText(qaSelector, tabTextKeywords) {
  // 首先尝试 data-qa 选择器
  let tab = document.querySelector(qaSelector);

  // 如果没找到，尝试通过标签文本查找
  if (!tab && tabTextKeywords) {
    const allTabs = document.querySelectorAll('[role="tab"]');
    for (const t of allTabs) {
      const text = t.textContent.toLowerCase();
      if (tabTextKeywords.some(kw => text.includes(kw.toLowerCase()))) {
        tab = t;
        break;
      }
    }
  }

  if (!tab) return false;
  if (tab.getAttribute('aria-selected') === 'true') return true;

  tab.click();
  await sleep(1000);
  return true;
}

/**
 * 获取当前激活的标签页名称
 */
function getActiveTabName() {
  const tabs = document.querySelectorAll('[role="tab"]');
  for (const tab of tabs) {
    if (tab.getAttribute('aria-selected') === 'true') {
      return tab.textContent.trim();
    }
  }
  return null;
}

/**
 * 获取标签页对应的内容面板
 */
function getTabPanel(tab) {
  if (!tab) return null;
  // 通过 aria-controls 属性查找
  const controlsId = tab.getAttribute('aria-controls');
  if (controlsId) {
    return document.getElementById(controlsId);
  }
  // 或者查找关联的 tabpanel
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const idx = tabs.indexOf(tab);
  const panels = document.querySelectorAll('[role="tabpanel"]');
  return panels[idx] || null;
}

/**
 * 提取标题
 */
function extractTitle() {
  const titleEl = document.querySelector('[data-qa="publicationTitle"], [data-qa="detailsHeaderPublicationTitle"]');
  return titleEl ? titleEl.textContent.trim() : '';
}

/**
 * 标准化日期格式 YYYY-MM-DD
 */
function normalizeDate(dateStr) {
  if (!dateStr) return '';
  const d = dateStr.trim();
  // 匹配 YYYY-MM-DD 或 YYYY/MM/DD
  const m1 = d.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2, '0')}-${m1[3].padStart(2, '0')}`;
  // 匹配 DD.MM.YYYY (欧洲格式)
  const m2 = d.match(/(\d{1,2})[.](\d{1,2})[.](\d{4})/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`;
  return d;
}

/**
 * 提取书目数据（Bibliographic data）
 */
async function extractBibliographicData() {
  const result = {
    abstract: '',
    inventors: [],
    assignees: [],
    application_date: '',
    publication_date: '',
    priority_date: '',
    classifications: [],
  };

  // 点击 Bibliographic data 标签
  await clickTabByQaOrText('[data-qa="bibliographicDataTab_resultDescription"]', ['bibliographic', 'bibliography']);
  await sleep(500);

  // 获取整个书目区域的文本
  // 首先尝试找到当前激活的 tabpanel
  let biblioPanel = null;
  const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
  if (activeTab) {
    biblioPanel = getTabPanel(activeTab);
  }
  if (!biblioPanel) {
    biblioPanel = document.querySelector('[data-qa="resultDescription_resultBlock"], [role="tabpanel"]');
  }

  const biblioText = biblioPanel ? biblioPanel.innerText : document.body.innerText;

  // 提取摘要 - 查找 Abstract 部分
  const abstractPatterns = [
    /(?:^|\n)\s*Abstract\s*\n([\s\S]*?)(?=\n\s*(?:Inventors|Applicants|Assignees|Priority|Application|Publication|Classifications|IPC|CPC|Claims|Description|$))/i,
    /(?:^|\n)\s*要約\s*\n([\s\S]*?)(?=\n\s*(?:発明者|出願人|優先権|出願日|公開日|国際特許分類|$))/i,
  ];
  for (const pattern of abstractPatterns) {
    const m = biblioText.match(pattern);
    if (m && m[1]) {
      result.abstract = m[1].trim().replace(/\s+/g, ' ');
      break;
    }
  }

  // 解析每行的键值对
  const lines = biblioText.split('\n').map(l => l.trim()).filter(l => l);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Inventors
    if (/^Inventors?:/i.test(line) || /^発明者:/i.test(line)) {
      const value = line.replace(/^Inventors?:/i, '').replace(/^発明者:/i, '').trim();
      if (value) {
        result.inventors = value.split(/[;,；]/).map(s => s.trim()).filter(s => s);
      } else if (i + 1 < lines.length) {
        result.inventors = lines[i + 1].split(/[;,；]/).map(s => s.trim()).filter(s => s);
      }
    }

    // Applicants / Assignees
    if (/^Applicants?:/i.test(line) || /^Assignees?:/i.test(line) || /^出願人:/i.test(line)) {
      const value = line.replace(/^Applicants?:/i, '').replace(/^Assignees?:/i, '').replace(/^出願人:/i, '').trim();
      if (value) {
        result.assignees = value.split(/[;,；]/).map(s => s.trim()).filter(s => s);
      } else if (i + 1 < lines.length) {
        result.assignees = lines[i + 1].split(/[;,；]/).map(s => s.trim()).filter(s => s);
      }
    }

    // Application date
    if (/^Application date:/i.test(line) || /^出願日:/i.test(line)) {
      const value = line.replace(/^Application date:/i, '').replace(/^出願日:/i, '').trim();
      result.application_date = normalizeDate(value);
    } else if (/^\(.*?\)\s*Application date:/i.test(line)) {
      const m = line.match(/Application date:\s*(.+)$/i);
      if (m) result.application_date = normalizeDate(m[1]);
    }

    // Publication date
    if (/^Publication date:/i.test(line) || /^公開日:/i.test(line)) {
      const value = line.replace(/^Publication date:/i, '').replace(/^公開日:/i, '').trim();
      result.publication_date = normalizeDate(value);
    } else if (/^\(.*?\)\s*Publication date:/i.test(line)) {
      const m = line.match(/Publication date:\s*(.+)$/i);
      if (m) result.publication_date = normalizeDate(m[1]);
    }

    // Priority date
    if (/^Priority date:/i.test(line) || /^優先日:/i.test(line)) {
      const value = line.replace(/^Priority date:/i, '').replace(/^優先日:/i, '').trim();
      result.priority_date = normalizeDate(value);
    } else if (/^\(.*?\)\s*Priority date:/i.test(line)) {
      const m = line.match(/Priority date:\s*(.+)$/i);
      if (m) result.priority_date = normalizeDate(m[1]);
    }

    // IPC / CPC Classifications
    if (/^IPC:/i.test(line) || /^CPC:/i.test(line) || /^国際特許分類:/i.test(line)) {
      let value = line.replace(/^IPC:/i, '').replace(/^CPC:/i, '').replace(/^国際特許分類:/i, '').trim();
      if (value) {
        const codes = value.split(/[;,；]/).map(s => s.trim()).filter(s => s && /^[A-HY]\d/.test(s));
        for (const code of codes) {
          result.classifications.push({ code, description: '' });
        }
      }
      // 可能后续行也是分类号
      let j = i + 1;
      while (j < lines.length && /^[A-HY]\d/.test(lines[j])) {
        result.classifications.push({ code: lines[j], description: '' });
        j++;
      }
    }
  }

  return result;
}

/**
 * 提取权利要求（Claims）
 */
async function extractClaims() {
  const claims = [];

  // 点击 Claims 标签
  await clickTabByQaOrText('[data-qa="claimsTab_resultDescription"]', ['claim']);
  await sleep(800);

  // 获取当前激活的面板
  let claimsPanel = null;
  const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
  if (activeTab) {
    claimsPanel = getTabPanel(activeTab);
  }
  if (!claimsPanel) {
    claimsPanel = document.querySelector('[data-qa="ClaimsPanel_resultDescription"], [data-qa="ClaimsComponent_OriginalClaimsPanel_resultDescription"], [role="tabpanel"]');
  }
  if (!claimsPanel) return claims;

  // 获取所有文本
  const text = claimsPanel.innerText;

  // 匹配权利要求 - 支持多种编号格式: "1. ", "1 ", "[1]", "Claim 1"
  // 先尝试按行分割匹配
  const claimRegex = /(?:^|\n)\s*(?:Claim\s*)?(\d+)[\.\)]\s+([\s\S]*?)(?=\n\s*(?:Claim\s*)?\d+[\.\)]\s+|$)/gi;
  let match;
  while ((match = claimRegex.exec(text)) !== null) {
    const num = parseInt(match[1]);
    const claimText = match[2].trim().replace(/\s+/g, ' ');
    if (claimText && claimText.length > 5) {
      claims.push({ num, text: claimText });
    }
  }

  // 如果上面没匹配到，尝试更宽松的匹配
  if (claims.length === 0) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    let currentClaim = null;
    for (const line of lines) {
      const claimStart = line.match(/^(\d+)[\.\)]\s+(.*)$/);
      if (claimStart) {
        if (currentClaim) claims.push(currentClaim);
        currentClaim = { num: parseInt(claimStart[1]), text: claimStart[2] };
      } else if (currentClaim && line.length > 0) {
        currentClaim.text += ' ' + line;
      }
    }
    if (currentClaim) claims.push(currentClaim);
  }

  // 按编号排序
  claims.sort((a, b) => a.num - b.num);

  return claims;
}

/**
 * 提取说明书（Description）
 */
async function extractDescription() {
  // 点击 Description 标签
  await clickTabByQaOrText('[data-qa="descriptionTab_resultDescription"]', ['description', '明細書']);
  await sleep(800);

  // 获取当前激活的面板
  let descPanel = null;
  const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
  if (activeTab) {
    descPanel = getTabPanel(activeTab);
  }
  if (!descPanel) {
    descPanel = document.querySelector('[role="tabpanel"]');
  }
  if (!descPanel) return '';

  let text = descPanel.innerText.trim();

  // 移除开头可能的 "Description" 标题
  text = text.replace(/^\s*(?:Description|明細書|DETAILED DESCRIPTION|BACKGROUND ART|TECHNICAL FIELD)\s*\n+/i, '');

  // 格式化：在段落标题前添加换行（可选）
  const sectionHeaders = [
    'TECHNICAL FIELD',
    'BACKGROUND',
    'BACKGROUND OF THE INVENTION',
    'BACKGROUND ART',
    'SUMMARY OF THE INVENTION',
    'SUMMARY',
    'BRIEF DESCRIPTION OF THE DRAWINGS',
    'DESCRIPTION OF THE EMBODIMENTS',
    'DETAILED DESCRIPTION',
    'DETAILED DESCRIPTION OF THE PREFERRED EMBODIMENTS',
    'EXAMPLES',
    'INDUSTRIAL APPLICABILITY',
    'POTENTIAL FOR INDUSTRIAL APPLICATION',
    'CLAIMS',
    'CROSS-REFERENCE TO RELATED APPLICATIONS',
  ];

  for (const header of sectionHeaders) {
    const regex = new RegExp(`(^|\\n)\\s*${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n`, 'i');
    text = text.replace(regex, `\n\n## ${header}\n\n`);
  }

  text = text.replace(/\n{3,}/g, '\n\n');
  return text;
}

/**
 * 提取附图链接（Drawings）
 */
async function extractDrawings() {
  await clickTabByQaOrText('[data-qa="drawingsTab_resultDescription"]', ['drawing', '図面']);
  await sleep(800);

  const drawings = [];

  // 获取面板
  let drawingsPanel = null;
  const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
  if (activeTab) {
    drawingsPanel = getTabPanel(activeTab);
  }
  if (!drawingsPanel) {
    drawingsPanel = document.querySelector('[role="tabpanel"]');
  }

  if (drawingsPanel) {
    const images = drawingsPanel.querySelectorAll('img');
    for (const img of images) {
      const src = img.src || img.getAttribute('data-src');
      if (src && !src.includes('spacer') && !src.includes('data:image') && !src.includes('placeholder')) {
        const fullUrl = src.startsWith('http') ? src : new URL(src, window.location.origin).href;
        if (!drawings.includes(fullUrl)) {
          drawings.push(fullUrl);
        }
      }
    }
  }

  // 回退：查找所有可能的附图
  if (drawings.length === 0) {
    const allImgs = document.querySelectorAll('img[src*="/images/documents/"], img[src*="/pages/"]');
    for (const img of allImgs) {
      const src = img.src;
      if (src && (src.includes('/pages/') || src.includes('.png') || src.includes('.jpg'))) {
        drawings.push(src);
      }
    }
  }

  return drawings;
}

/**
 * 提取引用文献（Citations）
 */
async function extractCitations() {
  await clickTabByQaOrText('[data-qa="citationsTab_resultDescription"]', ['citation', 'references', '引用']);
  await sleep(800);

  const patent_citations = [];
  const cited_by = [];

  let citationsPanel = null;
  const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
  if (activeTab) {
    citationsPanel = getTabPanel(activeTab);
  }
  if (!citationsPanel) {
    citationsPanel = document.querySelector('[role="tabpanel"]');
  }
  if (!citationsPanel) return { patent_citations, cited_by };

  const text = citationsPanel.innerText;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  let currentSection = 'citations'; // 'citations' or 'cited_by'

  for (const line of lines) {
    if (/cited by|citing documents/i.test(line)) {
      currentSection = 'cited_by';
      continue;
    }
    if (/patent citations|references cited|citations/i.test(line) && !/cited by/i.test(line)) {
      currentSection = 'citations';
      continue;
    }

    // 匹配专利号 (两个字母开头 + 数字 + 可选字母)
    const pnMatch = line.match(/^([A-Z]{2}\s*\d+[A-Z0-9]*)/);
    if (pnMatch) {
      let pn = pnMatch[1].replace(/\s+/g, '');
      // 验证是看起来像专利号
      if (/^[A-Z]{2}\d{5,}/.test(pn)) {
        const rest = line.substring(pnMatch[0].length).trim();
        const citation = {
          patent_number: pn,
          title: rest,
          priority_date: '',
          publication_date: '',
          assignee: '',
          citation_type: currentSection === 'cited_by' ? '' : 'examiner',
        };

        if (currentSection === 'cited_by') {
          cited_by.push(citation);
        } else {
          patent_citations.push(citation);
        }
      }
    }
  }

  return { patent_citations, cited_by };
}

/**
 * 提取法律事件（Legal events）
 */
async function extractLegalEvents() {
  await clickTabByQaOrText('[data-qa="legalStatusTab_resultDescription"]', ['legal', 'status', '法律']);
  await sleep(800);

  const legal_events = [];

  let legalPanel = null;
  const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
  if (activeTab) {
    legalPanel = getTabPanel(activeTab);
  }
  if (!legalPanel) {
    legalPanel = document.querySelector('[role="tabpanel"]');
  }
  if (!legalPanel) return legal_events;

  // 查找表格
  const rows = legalPanel.querySelectorAll('tr');
  for (const row of rows) {
    const cells = row.querySelectorAll('td, th');
    if (cells.length >= 2) {
      const date = cells[0].textContent.trim();
      const code = cells.length >= 3 ? cells[1].textContent.trim() : '';
      const desc = cells.length >= 3 ? cells[2].textContent.trim() : cells[1].textContent.trim();
      if (date && desc && !/date|event|description|code/i.test(date) && !/date|event|description|code/i.test(desc)) {
        legal_events.push({
          date: normalizeDate(date),
          code: code || '',
          description: desc,
        });
      }
    }
  }

  // 如果没找到表格，尝试从文本解析
  if (legal_events.length === 0) {
    const text = legalPanel.innerText;
    const eventRegex = /(\d{2}[./]\d{2}[./]\d{4}|\d{4}[-./]\d{2}[-./]\d{2})\s+(\S+)?\s*([^\n]+)/g;
    let m;
    while ((m = eventRegex.exec(text)) !== null) {
      legal_events.push({
        date: normalizeDate(m[1]),
        code: m[2] || '',
        description: m[3].trim(),
      });
    }
  }

  return legal_events;
}

/**
 * 提取同族专利（Patent family）
 */
async function extractFamily() {
  await clickTabByQaOrText('[data-qa="patentFamilyTab_resultDescription"]', ['family', '同族']);
  await sleep(800);

  const result = {
    family_id: '',
    family_applications: [],
  };

  // 从 URL 获取 family ID
  const familyMatch = window.location.href.match(/\/family\/(\d+)/);
  if (familyMatch) {
    result.family_id = familyMatch[1];
  }

  let familyPanel = null;
  const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
  if (activeTab) {
    familyPanel = getTabPanel(activeTab);
  }
  if (!familyPanel) {
    familyPanel = document.querySelector('[role="tabpanel"]');
  }
  if (!familyPanel) return result;

  // 查找表格中的同族专利
  const rows = familyPanel.querySelectorAll('tr');
  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 2) {
      // 通常第一列是公开号，第二列是标题，可能还有状态列
      const pubNum = cells[0].textContent.trim().replace(/\s+/g, '');
      if (/^[A-Z]{2}\d/.test(pubNum)) {
        const title = cells[1] ? cells[1].textContent.trim() : '';
        const status = cells.length >= 3 ? cells[cells.length - 1].textContent.trim() : '';
        result.family_applications.push({
          publication_number: pubNum,
          title: title,
          status: status,
        });
      }
    }
  }

  return result;
}

/**
 * 获取 PDF 链接
 */
function getPdfLink() {
  // 查找 Original documents 标签中的 PDF 链接
  const pdfLinks = document.querySelectorAll('a[href*=".pdf"], a[href*="original-document"], button[class*="pdf"]');
  for (const link of pdfLinks) {
    const href = link.href || '';
    if (href.includes('.pdf')) return href;
  }
  return '';
}

/**
 * 主提取函数 - 提取所有专利详情
 */
async function extractAllPatentData() {
  try {
    if (!isPatentDetailPage()) {
      return {
        office: 'EP',
        type: 'patent_full',
        error: '当前不是 Espacenet 专利详情页面',
      };
    }

    const patentNumber = extractPublicationNumber();
    const title = extractTitle();

    // 依次提取各部分数据
    const biblio = await extractBibliographicData();
    const claims = await extractClaims();
    const description = await extractDescription();
    const drawings = await extractDrawings();
    const citations = await extractCitations();
    const legal_events = await extractLegalEvents();
    const family = await extractFamily();
    const pdf_link = getPdfLink();

    // 构造与 GP 查询一致的数据格式
    const result = {
      office: 'EP',
      type: 'patent_full',
      source: 'Espacenet',
      patent_number: patentNumber,
      title: title,
      abstract: biblio.abstract,
      inventors: biblio.inventors,
      assignees: biblio.assignees,
      application_date: biblio.application_date,
      publication_date: biblio.publication_date,
      priority_date: biblio.priority_date,
      classifications: biblio.classifications,
      claims: claims,
      description: description,
      patent_citations: citations.patent_citations,
      cited_by: citations.cited_by,
      similar_documents: [],
      drawings: drawings,
      family_id: family.family_id,
      family_applications: family.family_applications,
      legal_events: legal_events,
      url: window.location.href,
      pdf_link: pdf_link,
    };

    return result;
  } catch (error) {
    return {
      office: 'EP',
      type: 'patent_full',
      error: `提取专利数据失败: ${error.message}`,
      _debug: {
        url: window.location.href,
        stack: error.stack,
      },
    };
  }
}

/**
 * 快速提取 - 只提取当前可见的标签页内容（不切换标签）
 */
function extractCurrentTabData() {
  const result = {
    office: 'EP',
    type: 'current_tab',
    patent_number: extractPublicationNumber(),
    title: extractTitle(),
    active_tab: getActiveTabName(),
  };

  const activePanel = document.querySelector('[role="tabpanel"]:not([hidden])');
  if (activePanel) {
    result.content = activePanel.innerText.substring(0, 10000);
  }

  return result;
}

/**
 * 根据当前页面 URL 判断页面类型
 */
function detectPageType() {
  const url = window.location.href;
  if (url.includes('/patent/search/family/') && url.includes('/publication/')) {
    return 'patent_detail';
  }
  if (url.includes('/patent/search') && !url.includes('/publication/')) {
    return 'search_results';
  }
  return 'unknown';
}

// ============ 消息监听 ============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'espacenet') return false;

  switch (message.action) {
    case 'detectPage':
      sendResponse({ office: 'EP', pageType: detectPageType() });
      return false;

    case 'extractAll':
    case 'extractPatent':
      extractAllPatentData().then(result => {
        sendResponse(result);
      });
      return true; // 异步响应

    case 'extractCurrent':
      sendResponse(extractCurrentTabData());
      return false;

    default:
      sendResponse({ error: `未知操作: ${message.action}` });
      return false;
  }
});

} // end of __patentHelperEspLoaded guard
