/*!
 * PatentLens browser-extension integration feature
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL.
 */

// Loaded after web-app.js so legacy classic-script globals remain available.
function handleExtensionData(data) {
  if (!data) return;

  // 移除 Espacenet 测试模式等待 banner
  var banner = document.getElementById('ep-waiting-banner');
  if (banner) banner.parentNode.removeChild(banner);

  // JP 审查经纬数据 — 填充到看板
  if (data.office === "JP" && data.type === "keika" && data.documents) {
    const appNumber = data.appNumber || "";
    const docs = data.documents.map((doc, idx) => ({
      docId: `jp-ext-${idx}`,
      docCode: doc.name,
      type: doc.category,
      date: doc.date,
      url: "",
      description: doc.name,
      extractUrl: null,
      downloadUrl: null,
      extractedText: null,
      aiAnalysis: null,
    }));

    // 更新看板
    const kanbanBoard = document.getElementById("kanban-board");
    if (kanbanBoard) {
      const statusColumns = kanbanBoard.querySelectorAll(".kanban-column");
      if (statusColumns.length > 0) {
        // 将文档按类别分配到看板列
        for (const doc of docs) {
          const colIdx = getKanbanColumnIndex(doc.type);
          if (colIdx < statusColumns.length) {
            const card = createKanbanCard(doc, doc.type, "JP", appNumber);
            const cardsContainer = statusColumns[colIdx].querySelector(".kanban-cards");
            if (cardsContainer) cardsContainer.appendChild(card);
          }
        }
      }
    }
    showNotification(`已导入 ${docs.length} 个 JP 审查文档（来自浏览器插件）`);
  }

  // JP 文档全文 — 直接显示
  if (data.office === "JP" && data.type === "document" && data.content) {
    const idx = currentData?.documents?.length || 0;
    const docObj = {
      docId: `jp-doc-ext`,
      docCode: data.title || "文档",
      type: "extension",
      date: "",
      url: "",
      description: data.title || "浏览器插件导入的文档",
      extractedText: {
        text: data.content,
        markdown: data.content,
        engine: "jplatpat_text",
        blocks: [],
        page_dimensions: {},
      },
    };

    // 添加到文档列表
    if (!currentData) currentData = {};
    if (!currentData.documents) currentData.documents = [];
    currentData.documents.push(docObj);

    // 显示文档内容
    showDocumentContent(data.content, data.title || "文档内容");
    showNotification(`已导入文档: ${data.title || "未知"}`);
  }

  // DE 注册信息 — 显示在结果区域
  if (data.office === "DE" && data.type === "register") {
    const info = data.data || data;
    const lines = [];
    if (info.akz) lines.push(`Aktenzeichen: ${info.akz}`);
    if (info.status) lines.push(`Status: ${info.status}`);
    if (info.title) lines.push(`Bezeichnung: ${info.title}`);
    if (info.applicant) lines.push(`Anmelder: ${info.applicant}`);
    if (info.inventor) lines.push(`Erfinder: ${info.inventor}`);
    if (info.representative) lines.push(`Vertreter: ${info.representative}`);
    if (info.filingDate) lines.push(`Anmeldetag: ${info.filingDate}`);
    if (info.publicationDate) lines.push(`Offenlegungstag: ${info.publicationDate}`);
    if (info.bescheideCount != null) lines.push(`Bescheide: ${info.bescheideCount}`);
    if (info.erwiderungenCount != null) lines.push(`Erwiderungen: ${info.erwiderungenCount}`);
    if (info.ipcClasses?.length) lines.push(`IPC: ${info.ipcClasses.join(", ")}`);

    if (info.procedures?.length) {
      lines.push("\nVerfahrensdaten:");
      for (const p of info.procedures) {
        lines.push(`  ${p.nr}. ${p.type} - ${p.status} (${p.date})`);
      }
    }

    showDocumentContent(lines.join("\n"), `DE 注册信息: ${info.akz || "未知"}`);
    showNotification("已导入 DE 注册信息（来自浏览器插件）");
  }

  // Espacenet 专利全文 — 显示在专利详情界面（与 GP 查询一致）
  if (data.office === "EP" && data.type === "patent_full" && !data.error) {
    var pn = (data.patent_number || "").trim().toUpperCase().replace(/[\s\/;]/g, "");
    // 如果设置了期望的专利号（打开弹窗时记录的），优先使用期望的专利号
    // 防止提取到同族专利号导致重复标签页
    var expectedPn = window._espacenetExpectedPatent;
    if (expectedPn && expectedPn !== pn) {
      console.log('[Espacenet] 提取专利号 ' + pn + ' 与期望 ' + expectedPn + ' 不一致，使用期望专利号');
      pn = expectedPn;
    }
    // 清除期望专利号标记
    window._espacenetExpectedPatent = null;
    if (!pn) {
      showNotification("无法识别专利号");
      return;
    }

    // 规范化数据，确保与 renderPatentDetail 期望的格式一致
    var normalized = JSON.parse(JSON.stringify(data));
    normalized.patent_number = pn;
    // 修正标题（Espacenet 页面的 h1 可能是"Espacenet"品牌名，不是专利标题）
    if (normalized.title && (normalized.title === 'Espacenet' || normalized.title.length < 3)) {
      normalized.title = pn;
    }
    // inventors / assignees: 字符串 → 数组
    function toArray(v) {
      if (Array.isArray(v)) return v;
      if (typeof v === 'string') {
        return v.split(/[;,]\s*/).map(function(s){return s.trim();}).filter(Boolean);
      }
      return [];
    }
    normalized.inventors = toArray(normalized.inventors);
    normalized.assignees = toArray(normalized.assignees);
    // claims: 字符串 → {num, text} 对象数组
    if (typeof normalized.claims === 'string') {
      var claimsText = normalized.claims.trim();
      var claimItems = [];
      // 优先按 "1. " / "2. " 编号分割（支持跨行）
      var numRe = /(?:^|\n)\s*(\d+)\s*[.、)]\s+/g;
      var match;
      var matches = [];
      while ((match = numRe.exec(claimsText)) !== null) {
        // match.index 是整个匹配的起始（含 \n），match[0].length 是整个匹配长度
        matches.push({
          num: match[1],
          textStart: match.index + match[0].length, // 权利要求文本起始位置
          matchStart: match.index                    // 整个匹配起始（含 \n）
        });
      }
      for (var mi = 0; mi < matches.length; mi++) {
        // 文本结束位置 = 下一个匹配的 matchStart，否则到字符串末尾
        var end = (mi + 1 < matches.length) ? matches[mi + 1].matchStart : claimsText.length;
        var cText = claimsText.substring(matches[mi].textStart, end).trim().replace(/\s+/g, ' ');
        if (cText) claimItems.push({ num: matches[mi].num, text: cText });
      }
      // 回退：按换行分割，每行一条
      if (claimItems.length === 0 && claimsText) {
        var lines = claimsText.split(/\n+/);
        var idx = 0;
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].trim();
          if (!line) continue;
          idx++;
          // 去除行首 "1." / "1、" / "1)" 等
          line = line.replace(/^\d+\s*[.、)]\s*/, '');
          if (line) claimItems.push({ num: String(idx), text: line });
        }
      }
      normalized.claims = claimItems;
    } else if (!Array.isArray(normalized.claims)) {
      normalized.claims = [];
    } else {
      // 已是数组 — 规范化每个元素为 {num, text} 对象
      normalized.claims = normalized.claims.map(function(c, i) {
        if (typeof c === 'string') return { num: String(i + 1), text: c.trim() };
        if (c && typeof c === 'object') {
          return {
            num: c.num || c.number || c.claim_number || String(i + 1),
            text: (c.text || c.content || c.claim_text || '').trim(),
            type: c.type || '',
            dependent_on: c.dependent_on || c.depends_on || ''
          };
        }
        return { num: String(i + 1), text: '' };
      }).filter(function(c) { return c.text; });
    }
    // classifications: 字符串数组 → {code, description} 对象数组
    if (Array.isArray(normalized.classifications)) {
      normalized.classifications = normalized.classifications.map(function(c) {
        if (typeof c === 'string') return { code: c, description: '' };
        return c;
      });
    } else if (typeof normalized.classifications === 'string') {
      normalized.classifications = normalized.classifications.split(/[;,]\s*/).map(function(c){return {code:c.trim(), description:''};}).filter(function(c){return c.code;});
    } else {
      normalized.classifications = [];
    }
    // cpc 字符串 → 也填入 classifications
    if (normalized.cpc && !normalized.classifications.length) {
      normalized.classifications = normalized.cpc.split(/[;,]\s*/).map(function(c){return {code:c.trim(), description:''};}).filter(function(c){return c.code;});
    }
    // legal_events: 字符串数组 → {date, code, description} 对象数组
    if (Array.isArray(normalized.legal_events)) {
      normalized.legal_events = normalized.legal_events.map(function(le) {
        if (typeof le === 'string') return { date: '', code: '', description: le };
        return le;
      });
    } else {
      normalized.legal_events = [];
    }
    // family_applications: 确保是对象数组
    if (Array.isArray(normalized.family)) {
      normalized.family_applications = normalized.family.map(function(f) {
        if (typeof f === 'string') return { publication_number: f, title: '', status: '' };
        return f;
      });
      delete normalized.family;
    } else if (!normalized.family_applications) {
      normalized.family_applications = [];
    }
    // drawings: 确保是字符串数组
    if (!Array.isArray(normalized.drawings)) normalized.drawings = [];
    // patent_citations: 确保是 {patent_number} 对象数组；兼容旧 citations 字段
    if (!normalized.patent_citations && normalized.citations) {
      normalized.patent_citations = normalized.citations;
    }
    if (Array.isArray(normalized.patent_citations)) {
      normalized.patent_citations = normalized.patent_citations.map(function(c) {
        if (typeof c === 'string') return { patent_number: c.trim() };
        if (c && typeof c === 'object') {
          var entry = {
            patent_number: (c.patent_number || c.number || c.publication_number || '').toString().trim(),
            applicant: c.applicant || c.applicants || '',
            publication_date: c.publication_date || c.date || ''
          };
          // origin: SEA=审查员引用(examiner), APP=申请人引用(applicant)
          if (c.origin || c.citation_type) {
            var orig = (c.origin || c.citation_type || '').toUpperCase();
            if (orig === 'SEA') entry.citation_type = 'examiner';
            else if (orig === 'APP') entry.citation_type = 'applicant';
            else if (orig === 'EXAMINER' || orig === 'APPLICANT') entry.citation_type = orig.toLowerCase();
          }
          return entry;
        }
        return { patent_number: '' };
      }).filter(function(c) { return c.patent_number; });
    } else {
      normalized.patent_citations = [];
    }
    delete normalized.citations;
    // cited_by / similar_documents: 兜底为空数组
    if (!Array.isArray(normalized.cited_by)) normalized.cited_by = [];
    if (!Array.isArray(normalized.similar_documents)) normalized.similar_documents = [];
    // 日期字段规范化（YYYY-MM-DD）
    function normalizeDate(d) {
      if (!d || typeof d !== 'string') return '';
      d = d.trim();
      // 已符合 YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      // DD.MM.YYYY → YYYY-MM-DD
      var m1 = d.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
      if (m1) return m1[3] + '-' + m1[2].padStart(2,'0') + '-' + m1[1].padStart(2,'0');
      // YYYYMMDD → YYYY-MM-DD
      var m2 = d.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (m2) return m2[1] + '-' + m2[2] + '-' + m2[3];
      return d;
    }
    normalized.application_date = normalizeDate(normalized.application_date);
    normalized.publication_date = normalizeDate(normalized.publication_date);
    normalized.priority_date = normalizeDate(normalized.priority_date);
    normalized.filing_date = normalizeDate(normalized.filing_date);
    // external_links: 确保是 {key: {url, text}} 格式
    if (normalized.pdf_link) {
      if (!normalized.external_links || typeof normalized.external_links !== 'object' || Array.isArray(normalized.external_links)) {
        normalized.external_links = {};
      }
      if (!normalized.external_links.pdf) {
        normalized.external_links.pdf = { url: normalized.pdf_link, text: 'PDF原文' };
      }
    } else if (!normalized.external_links) {
      normalized.external_links = {};
    }
    // description: 确保是字符串
    if (typeof normalized.description !== 'string') normalized.description = '';
    // abstract: 确保是字符串
    if (typeof normalized.abstract !== 'string') normalized.abstract = '';

    // 切换到专利详情视图
    const appEl = document.getElementById("app");
    if (appEl && appEl.classList.contains("home-mode")) appEl.classList.remove("home-mode");
    if (patentDetailSection) patentDetailSection.classList.remove("hidden");
    if (resultSection) resultSection.classList.add("hidden");
    if (batchResultsSection) batchResultsSection.classList.add("hidden");
    updateFloatingBallsVisibility();

    if (searchMode !== "patent") {
      searchMode = "patent";
      document.querySelectorAll(".search-mode-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.mode === "patent");
      });
      if (patentInput) {
        patentInput.placeholder = "输入专利号查询原文信息（如 US12030161B2, EP4252965A3）";
        patentInput.value = pn;
      }
      if (batchSearchToggleBtn) batchSearchToggleBtn.style.display = "";
    } else if (patentInput) {
      patentInput.value = pn;
    }

    // 缓存数据
    _pdPatentCache[pn] = normalized;
    GPCache.set(pn, normalized);
    if (!_pdOpenPatents.includes(pn)) {
      _pdOpenPatents.push(pn);
    }
    _pdActivePatent = pn;
    window._currentPatentData = normalized;

    // 渲染专利详情
    renderPatentDetail(normalized);
    _renderPdTabs();
    _switchPdTab(pn);
    showDataSourceBadge("Espacenet 浏览器提取", "通过 Espacenet 页面一键导入");
    showNotification(`已从 Espacenet 导入专利: ${pn}`);
    return;
  }

  // Espacenet 当前标签页内容
  if (data.office === "EP" && data.type === "current_tab" && data.content) {
    const tabName = data.active_tab || "当前标签";
    showDocumentContent(data.content, `Espacenet - ${data.patent_number || ""} (${tabName})`);
    showNotification(`已导入 Espacenet ${tabName} 内容`);
  }

  // Espacenet 提取错误
  if (data.office === "EP" && data.error) {
    showNotification(`Espacenet 提取失败: ${data.error}`);
  }
}

function handleExtensionAnalyze(data) {
  if (!data || !data.content) return;

  // 使用已有的 AI 分析功能
  const config = AI.loadAIConfig();
  const provider = AI.getCurrentProvider(config);
  if (!provider || !provider.apiKey) {
    showNotification("请先配置 AI API Key");
    return;
  }

  const prompt = AI.getDefaultPrompt("docAnalysis");
  const messages = [
    { role: "system", content: prompt },
    { role: "user", content: data.content },
  ];

  // 流式分析
  const readerContent = document.getElementById("reader-content");
  if (readerContent) {
    readerContent.innerHTML = '<div class="markdown-body"></div>';
    const streamContainer = readerContent.querySelector(".markdown-body");
    // 思考区 + 回答区分层
    const answerEl = document.createElement("div");
    answerEl.className = "reader-analysis-answer";
    streamContainer.appendChild(answerEl);
    const thinkingHost = _createThinkingHost(streamContainer);
    let _readerContentStarted = false;
    let fullContent = "";
    let _rafPending = false;

    AI.streamChat(provider.type, provider.apiKey, provider.baseUrl, {
      model: provider.model,
      messages,
      maxTokens: 32768,
    }).then(async (stream) => {
      for await (const chunk of stream) {
        if (chunk.reasoningContent && thinkingHost) {
          thinkingHost.appendReasoning(chunk.reasoningContent);
        }
        if (chunk.content) {
          if (!_readerContentStarted) {
            _readerContentStarted = true;
            if (thinkingHost) thinkingHost.startContent();
          }
          fullContent += chunk.content;
          if (!_rafPending) {
            _rafPending = true;
            requestAnimationFrame(() => {
              if (answerEl) answerEl.innerHTML = marked.parse(fullContent);
              _rafPending = false;
            });
          }
        }
      }
      if (thinkingHost) thinkingHost.finish();
      if (answerEl) answerEl.innerHTML = marked.parse(fullContent);
    }).catch((err) => {
      readerContent.innerHTML = `<p class="error">分析失败: ${err.message}</p>`;
    });
  }
}

function showNotification(message) {
  const existing = document.querySelector(".extension-notification");
  if (existing) existing.remove();

  const notif = document.createElement("div");
  notif.className = "extension-notification";
  notif.style.cssText = "position:fixed;top:20px;right:20px;background:#1a73e8;color:#fff;padding:12px 20px;border-radius:8px;z-index:10000;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 0.3s;";
  notif.textContent = message;
  document.body.appendChild(notif);

  setTimeout(() => {
    notif.style.opacity = "0";
    setTimeout(() => notif.remove(), 300);
  }, 3000);
}

function showDocumentContent(content, title) {
  const readerContent = document.getElementById("reader-content");
  if (readerContent) {
    readerContent.innerHTML = `<h3>${title || "文档内容"}</h3><pre style="white-space:pre-wrap;word-break:break-all;">${content}</pre>`;
  }
  // 切换到阅读器标签
  const readerTab = document.querySelector('[data-tab="reader"]');
  if (readerTab) readerTab.click();
}
