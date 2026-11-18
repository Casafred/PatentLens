/*!
 * PatentLens - Agent 转移模式 · 上下文采集器
 *
 * 职责：把软件内各场景的数据采集为标准化「上下文块」
 *   块结构：{ key, label, source, available, chars, text, truncated, note }
 *
 * 设计原则：
 *   1. 对业务数据只读不写；
 *   2. 采集函数接受显式数据参数，便于 Node vm 单测；
 *      readXxxBlocks() 包装层负责读取 web-app.js 全局（currentData/kanbanState）；
 *   3. 长文本截断阈值与软件内置 AI 输入惯例保持一致；
 *   4. 不依赖 DOM。
 *
 * 对外暴露 window.TransferContext
 */
var TransferContext = (function () {
  "use strict";

  // 与现有模块惯例对齐：说明书 18000、单篇 OCR 12000、权项合计 20000
  var DESCRIPTION_MAX = 18000;
  var OCR_PER_DOC_MAX = 12000;
  var CLAIMS_MAX = 20000;
  var LIST_MAX = 30;

  var TYPE_LABELS = {
    office_action: "审查意见",
    response: "申请人答复",
    patent_doc: "专利文件",
    citation: "审查员引用与IDS",
    allowance: "授权通知",
    applicant_request: "申请人其他请求",
    notification: "通知",
    misc: "其他文件",
  };

  var OFFICE_LABELS = {
    US: "USPTO（美国）",
    EP: "EPO（欧洲）",
    CN: "CNIPA（中国）",
    DE: "DPMA（德国）",
    JP: "JPO（日本）",
    KR: "KIPO（韩国）",
    WO: "WIPO（PCT）",
    WIPO: "WIPO（PCT）",
  };

  function listOf(value) {
    if (Array.isArray(value)) return value.filter(function (v) { return v != null; });
    if (value && Array.isArray(value.items)) return value.items.filter(Boolean);
    return value == null || value === "" ? [] : [value];
  }
  function firstValue(data, keys) {
    for (var i = 0; data && i < keys.length; i++) {
      var v = data[keys[i]];
      if (v != null && v !== "" && (!Array.isArray(v) || v.length)) return v;
    }
    return null;
  }
  function drawingUrls(data) {
    return listOf(firstValue(data, ["drawings", "figures", "images"])).map(function (v) {
      return typeof v === "string" ? v : v.url || v.src || v.imageUrl || "";
    }).filter(Boolean);
  }
  function safeStr(v) {
    return v == null ? "" : String(v);
  }

  // 数组元素可能是字符串，也可能是 {name}/{assignee} 对象
  function nameOf(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    return safeStr(v.name || v.assignee || v.applicant || v.title || "");
  }

  function joinNames(arr) {
    if (!Array.isArray(arr)) return "";
    return arr.map(nameOf).filter(Boolean).join("；");
  }

  function truncate(text, max) {
    var raw = safeStr(text);
    if (raw.length <= max) return { text: raw, truncated: false };
    return {
      text: raw.slice(0, max) + "\n［…内容过长，已截断，完整内容请在 PatentLens 内查看原文／交接 PDF］",
      truncated: true,
    };
  }

  function makeBlock(key, label, source, text, note) {
    var body = safeStr(text);
    return {
      key: key,
      label: label,
      source: source || "",
      available: body.trim().length > 0,
      chars: body.length,
      text: body,
      truncated: false,
      note: note || "",
    };
  }

  // ── 权利要求独权/从权判定：优先复用全局 isIndependentClaim，缺失时内部兜底 ──
  function isIndependent(claim, idx) {
    try {
      if (typeof isIndependentClaim === "function") return isIndependentClaim(claim, idx);
    } catch (e) { /* 全局不可用时走兜底 */ }
    if (!claim) return false;
    if (claim.type === "independent") return true;
    if (claim.type === "dependent") return false;
    if (claim.dependent_on !== undefined && claim.dependent_on !== null && claim.dependent_on !== "" && claim.dependent_on !== false) return false;
    var head = safeStr(claim.text).substring(0, 300);
    if (/^(根据|如|按照|依据).*(权利要求|权项|claim|claims)/i.test(head)) return false;
    if (/前記|所述的/.test(head.substring(0, 80))) return false;
    if (/\bclaim\s+\d+/i.test(head)) return false;
    return idx === 0;
  }

  function claimLine(c, i) {
    var num = c.num || c.number || (i + 1);
    return "权利要求" + num + "：" + safeStr(c.text).trim();
  }

  // ───────────────────────── 通用：专利基础信息块 ─────────────────────────
  function buildMetaBlock(data) {
    if (!data) return makeBlock("meta", "专利基础信息", "专利原文", "");
    var lines = [];
    var pn = data.patent_number || data.raw || data.patentNumber || "";
    lines.push("专利号：" + pn);
    if (data.title) lines.push("标题：" + data.title);
    var office = data.office ? (OFFICE_LABELS[data.office] || data.office) : "";
    if (office) lines.push("专利局：" + office);
    if (data.applicationNumber) lines.push("申请号：" + data.applicationNumber);
    var assignees = joinNames(data.assignees || data.assigneeNames);
    if (!assignees && data.applicantName) assignees = safeStr(data.applicantName);
    if (assignees) lines.push("申请人：" + assignees);
    var inventors = joinNames(data.inventors);
    if (inventors) lines.push("发明人：" + inventors);
    if (data.filing_date || data.filingDate) lines.push("申请日：" + (data.filing_date || data.filingDate));
    if (data.publication_date || data.publicationDate) lines.push("公开日：" + (data.publication_date || data.publicationDate));
    if (data.priority_date || data.priorityDate) lines.push("优先权日：" + (data.priority_date || data.priorityDate));
    if (data.family_id || data.familyId) lines.push("同族 ID：" + (data.family_id || data.familyId));
    return makeBlock("meta", "专利基础信息", "专利原文", lines.join("\n"));
  }

  // ───────────────────────── 场景一：时间轴 ─────────────────────────
  function renderTimelineTable(office, documents) {
    var docs = (documents || []).slice().sort(function (a, b) {
      return safeStr(a.date).localeCompare(safeStr(b.date));
    });
    var lines = [];
    lines.push("专利局：" + (OFFICE_LABELS[office] || office || "未知"));
    lines.push("文档总数：" + docs.length);
    lines.push("");
    lines.push("| 序号 | 日期 | 文档代码 | 文档名称 | 类型 | 阶段 |");
    lines.push("|------|------|----------|----------|------|------|");
    docs.forEach(function (d, i) {
      var typeLabel = TYPE_LABELS[d.type] || d.type || "其他文件";
      lines.push("| " + (i + 1) + " | " + (d.date || "—") + " | " + (d.docCode || "—") +
        " | " + (d.name || d.desc || "—") + " | " + typeLabel + " | " + (d.stage || "—") + " |");
    });
    return lines.join("\n");
  }

  function buildTimelineBlocks(data, documents) {
    var blocks = [buildMetaBlock(data)];
    var docs = documents || (data && data.documents) || [];
    var table = docs.length ? renderTimelineTable(data && data.office, docs) : "";
    var tlBlock = makeBlock("timeline", "审查时间轴（全部文档节点）", "审查档案", table);
    if (!docs.length) tlBlock.note = "暂无审查文档数据";
    blocks.push(tlBlock);
    return blocks;
  }

  // ───────────────────────── 场景二：审查文档 + OCR ─────────────────────────
  function buildDocListBlock(data, documents, selectedIdxs) {
    var sel = new Set((selectedIdxs || []).map(String));
    var docs = (documents || []).filter(function (d) { return sel.has(String(d.idx)); });
    if (!docs.length) {
      return makeBlock("doc-list", "审查文档清单（已选）", "审查档案", "");
    }
    var lines = [];
    lines.push("已选文档 " + docs.length + " 篇：");
    lines.push("");
    lines.push("| 序号 | 日期 | 代码 | 文档名称 | 类型 | 页数 |");
    lines.push("|------|------|------|----------|------|------|");
    docs.forEach(function (d, i) {
      var typeLabel = TYPE_LABELS[d.type] || d.type || "其他文件";
      lines.push("| " + (i + 1) + " | " + (d.date || "—") + " | " + (d.docCode || "—") +
        " | " + (d.name || d.desc || "—") + " | " + typeLabel + " | " + (d.numberOfPages || "—") + " |");
    });
    return makeBlock("doc-list", "审查文档清单（已选 " + docs.length + " 篇）", "审查档案", lines.join("\n"));
  }

  function buildOcrBlocks(documents, extractions, selectedIdxs) {
    var sel = new Set((selectedIdxs || []).map(String));
    var blocks = [];
    (documents || []).forEach(function (d) {
      if (!sel.has(String(d.idx))) return;
      var ext = extractions && extractions[d.idx];
      var raw = ext ? (ext.markdown || ext.text || "") : "";
      var block = makeBlock(
        "ocr-" + d.idx,
        "OCR 文本｜" + (d.docCode || "文档" + d.idx) + " " + (d.date || ""),
        (d.name || d.desc || "审查文档"),
        ""
      );
      if (ext && ext.error) {
        block.note = "OCR 失败：" + ext.error;
      } else if (raw.trim()) {
        var r = truncate(raw, OCR_PER_DOC_MAX);
        block.text = r.text;
        block.chars = r.text.length;
        block.available = true;
        block.truncated = r.truncated;
        block.fullText = raw;
      } else {
        block.note = "该文档尚未 OCR，可直接交接 PDF 给 Agent 识别，或先导入 OCR 全文";
      }
      blocks.push(block);
    });
    return blocks;
  }

  function buildDossierBlocks(data, documents, extractions, selectedIdxs) {
    // 审查文档交接必须带上完整时间轴；否则 Agent 只能看到 OCR 片段，
    // 无法判断哪一次审查意见对应哪一次答复。
    var timeline = makeBlock(
      "timeline",
      "审查时间轴（全部文档节点）",
      "审查档案",
      documents && documents.length ? renderTimelineTable(data && data.office, documents) : ""
    );
    if (!(documents && documents.length)) timeline.note = "暂无审查文档数据";
    var blocks = [buildMetaBlock(data), timeline, buildDocListBlock(data, documents, selectedIdxs)];
    blocks = blocks.concat(buildOcrBlocks(documents, extractions, selectedIdxs));
    return blocks;
  }

  // ───────────────────────── 场景三：专利原文 ─────────────────────────
  function buildAbstractBlock(data) {
    return makeBlock("abstract", "摘要", "专利原文", safeStr(data && (data.abstract || data.abstractText || data.summary)));
  }

  function buildClaimBlocks(data) {
    var claims = listOf(firstValue(data, ["claims", "claimsData", "claimList"])).map(function (v) {
      return typeof v === "string" ? { text: v } : v;
    });
    var ind = [];
    var dep = [];
    claims.forEach(function (c, i) {
      if (isIndependent(c, i)) ind.push(claimLine(c, i));
      else dep.push(claimLine(c, i));
    });
    var indR = truncate(ind.join("\n\n"), CLAIMS_MAX);
    var depR = truncate(dep.join("\n\n"), CLAIMS_MAX);
    var indBlock = makeBlock(
      "claims-independent",
      "独立权利要求（" + ind.length + " 项）",
      "专利原文·权利要求书",
      indR.text
    );
    indBlock.truncated = indR.truncated;
    indBlock.fullText = ind.join("\n\n");
    var depBlock = makeBlock(
      "claims-dependent",
      "从属权利要求（" + dep.length + " 项）",
      "专利原文·权利要求书",
      depR.text
    );
    depBlock.truncated = depR.truncated;
    depBlock.fullText = dep.join("\n\n");
    if (!claims.length) {
      indBlock.note = "暂无权利要求数据";
      depBlock.note = "暂无权利要求数据";
    }
    return [indBlock, depBlock];
  }

  function buildDescriptionBlock(data) {
    var raw = safeStr(firstValue(data, ["description", "specification", "detailedDescription"]));
    var r = truncate(raw, DESCRIPTION_MAX);
    var block = makeBlock("description", "说明书", "专利原文·说明书", r.text);
    block.truncated = r.truncated;
    block.fullText = raw;
    if (!(data && (data.description || data.specification || data.detailedDescription))) block.note = "暂无说明书数据";
    return block;
  }

  function citationRows(list, limit) {
    return listOf(list).slice(0, limit || LIST_MAX).map(function (c) {
      var pn = c.patent_number || c.patentNumber || c.publicationNumber || c.publication_number || "";
      var date = c.publication_date || c.publicationDate || c.priority_date || c.priorityDate || "";
      var owner = c.assignee || nameOf(c);
      return "| " + pn + " | " + safeStr(c.title).replace(/\|/g, "/") + " | " + owner + " | " + date + " |";
    });
  }

  function buildCitationsBlock(data) {
    var list = listOf(firstValue(data, ["patent_citations", "citations"]));
    var rows = citationRows(list);
    var text = "";
    if (rows.length) {
      text = "共 " + list.length + " 件，以下列出前 " + rows.length + " 件：\n\n" +
        "| 专利号 | 标题 | 申请人 | 日期 |\n|------|------|--------|------|\n" + rows.join("\n");
    }
    var block = makeBlock("citations", "引用专利（向后引证）", "专利原文·引证", text);
    block.fullText = rows.length ? "共 " + list.length + " 件：\n\n| 专利号 | 标题 | 申请人 | 日期 |\n|------|------|--------|------|\n" + citationRows(list, Infinity).join("\n") : "";
    if (!rows.length) block.note = "无引证数据";
    return block;
  }

  function buildCitedByBlock(data) {
    var list = listOf(firstValue(data, ["cited_by", "citedBy"]));
    var rows = citationRows(list);
    var text = "";
    if (rows.length) {
      text = "共 " + list.length + " 件，以下列出前 " + rows.length + " 件：\n\n" +
        "| 专利号 | 标题 | 申请人 | 日期 |\n|------|------|--------|------|\n" + rows.join("\n");
    }
    var block = makeBlock("cited-by", "被引专利（向前引证）", "专利原文·引证", text);
    block.fullText = rows.length ? "共 " + list.length + " 件：\n\n| 专利号 | 标题 | 申请人 | 日期 |\n|------|------|--------|------|\n" + citationRows(list, Infinity).join("\n") : "";
    if (!rows.length) block.note = "无被引数据";
    return block;
  }

  function buildDrawingsBlock(data) {
    var drawings = drawingUrls(data);
    var text = drawings.map(function (url, i) {
      return "图" + (i + 1) + "：" + url;
    }).join("\n");
    var block = makeBlock("drawings", "说明书附图清单（" + drawings.length + " 张，含图片链接）", "专利原文·附图", text);
    if (drawings.length) {
      block.note = "图片无法随文本粘贴；可在面板下方「附图文件交接」准备图片后直接拖入 Agent，或在 Agent 中打开链接";
    } else {
      block.note = "无附图数据";
    }
    return block;
  }

  function buildFamilyBlock(data) {
    var list = listOf(firstValue(data, ["family_applications", "familyMembers", "family"]));
    var lines = list.slice(0, LIST_MAX).map(function (f) {
      var pn = f.publication_number || f.publicationNumber || "";
      return "- " + pn + "｜" + safeStr(f.title) + "｜" + safeStr(f.status || "");
    });
    var block = makeBlock("family", "同族专利（" + list.length + " 件）", "专利原文·同族", lines.join("\n"));
    block.fullText = list.map(function (f) {
      return "- " + (f.publication_number || f.publicationNumber || "") + "｜" + safeStr(f.title) + "｜" + safeStr(f.status || "");
    }).join("\n");
    if (!list.length) block.note = "无同族数据";
    return block;
  }

  function buildFulltextBlocks(data) {
    var blocks = [buildMetaBlock(data), buildAbstractBlock(data)];
    blocks = blocks.concat(buildClaimBlocks(data));
    blocks.push(buildDescriptionBlock(data));
    blocks.push(buildCitationsBlock(data));
    blocks.push(buildCitedByBlock(data));
    blocks.push(buildDrawingsBlock(data));
    blocks.push(buildFamilyBlock(data));
    return blocks;
  }

  // ───────────────────────── 全局包装层（读取 web-app.js 状态） ─────────────────────────
  function getCurrentData() {
    try {
      if (typeof currentData !== "undefined") return currentData;
    } catch (e) { /* ignore */ }
    return null;
  }

  // 原文与案卷分别维护状态；只补齐同一文献号的缓存，绝不混入其他页的数据。
  function getFulltextData(scope) {
    var popup = scope === "popup";
    var data = popup ? window._patentPopupData : window._currentPatentData;
    var pn = "";
    try {
      pn = popup
        ? (typeof _ppvActivePatent !== "undefined" && _ppvActivePatent)
        : (typeof _pdActivePatent !== "undefined" && _pdActivePatent);
    } catch (e) { /* state may not be initialized */ }
    pn = pn || (data && (data.patent_number || data.patentNumber)) || "";
    if (!pn) return null;
    var normalize = function (value) { return safeStr(value).replace(/\s/g, "").toUpperCase(); };
    var result = {};
    var merge = function (candidate) {
      if (!candidate || typeof candidate !== "object") return;
      // 部分缓存版本包了一层 { data: {...} }，解包后仍按文献号严格匹配，
      // 避免把上一页的说明书/附图混入当前文档。
      if (candidate.data && typeof candidate.data === "object" && !candidate.patent_number && !candidate.patentNumber) {
        candidate = candidate.data;
      }
      var candidatePn = candidate.patent_number || candidate.patentNumber || candidate.publication_number || candidate.publicationNumber || candidate.applicationNumber;
      if (normalize(candidatePn) !== normalize(pn)) return;
      Object.keys(candidate).forEach(function (key) {
        var value = candidate[key];
        if (value != null && value !== "" && (!Array.isArray(value) || value.length)) result[key] = value;
      });
    };
    try { if (typeof GPCache !== "undefined") merge(GPCache.get(pn)); } catch (e) { /* cache unavailable */ }
    try {
      if (popup && typeof _patentPopupCache !== "undefined") merge(_patentPopupCache[pn] && _patentPopupCache[pn].data);
      if (!popup && typeof _pdPatentCache !== "undefined") merge(_pdPatentCache[pn]);
    } catch (e) { /* memory cache unavailable */ }
    merge(data);
    return Object.keys(result).length ? result : null;
  }

  function getKanban() {
    try {
      if (typeof kanbanState !== "undefined" && kanbanState) return kanbanState;
    } catch (e) { /* ignore */ }
    return { documents: [], extractions: {} };
  }

  function readTimelineBlocks() {
    var data = getCurrentData();
    var kb = getKanban();
    return buildTimelineBlocks(data, kb.documents);
  }

  function readDossierBlocks(selectedIdxs) {
    var data = getCurrentData();
    var kb = getKanban();
    return buildDossierBlocks(data, kb.documents, kb.extractions, selectedIdxs);
  }

  function readFulltextBlocks(scope) {
    return buildFulltextBlocks(getFulltextData(scope));
  }

  return {
    // 常量（供测试与面板复用）
    drawingUrls: drawingUrls,
    DESCRIPTION_MAX: DESCRIPTION_MAX,
    OCR_PER_DOC_MAX: OCR_PER_DOC_MAX,
    CLAIMS_MAX: CLAIMS_MAX,
    // 纯函数（可单测）
    buildMetaBlock: buildMetaBlock,
    renderTimelineTable: renderTimelineTable,
    buildTimelineBlocks: buildTimelineBlocks,
    buildDocListBlock: buildDocListBlock,
    buildOcrBlocks: buildOcrBlocks,
    buildDossierBlocks: buildDossierBlocks,
    buildAbstractBlock: buildAbstractBlock,
    buildClaimBlocks: buildClaimBlocks,
    buildDescriptionBlock: buildDescriptionBlock,
    buildCitationsBlock: buildCitationsBlock,
    buildCitedByBlock: buildCitedByBlock,
    buildDrawingsBlock: buildDrawingsBlock,
    buildFamilyBlock: buildFamilyBlock,
    buildFulltextBlocks: buildFulltextBlocks,
    truncate: truncate,
    // 全局包装
    readTimelineBlocks: readTimelineBlocks,
    readDossierBlocks: readDossierBlocks,
    readFulltextBlocks: readFulltextBlocks,
    getCurrentData: getCurrentData,
    getFulltextData: getFulltextData,
    getKanban: getKanban,
  };
})();

if (typeof window !== "undefined") {
  window.TransferContext = TransferContext;
}
