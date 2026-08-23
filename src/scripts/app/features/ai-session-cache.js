/*!
 * PatentLens - AI 会话与解读结果本地缓存
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 * @author Alfred Shi
 * @version 260823
 *
 * web-app.js 已冻结不可新增行，本模块通过 DOM 增强 + 覆盖函数声明实现
 * 四类 AI 交互的 localStorage 持久缓存：
 *
 *   1. 专利详情「AI 问一问」      已有 patentlens_ask_<pn> 缓存（仅 1 小时 TTL），
 *      本模块将有效期延长为 30 天
 *   2. 专利详情「AI 解读」区域    新增 patentlens-interpret-<pn>（无 TTL，与
 *      实施例总结缓存策略一致；详情/弹层渲染后自动回显，可点「重新解读」刷新）
 *   3. 审查文档「继续问」         新增 patentlens-analysis-chat-<pn>（30 天 TTL，
 *      打开面板时恢复；分析报告变化后不再恢复旧对话）
 *   4. 阅读器单篇审查文档 AI 提问  新增 patentlens-reader-chat-<pn>|doc（30 天 TTL，
 *      按专利号+文档身份键控，打开 AI 对话面板或切换文档时恢复）
 *
 * 依赖（web-app.js 暴露的全局，经典脚本未用 IIFE 包裹）：
 *   - 函数声明（挂 window，可用 window.xxx = 覆盖）：
 *     runPatentInterpretation / appendAnalysisChatMessage /
 *     renderMarkdown / renderMarkdownWithTrace / _loadPatentAskCache
 *   - 顶层 let/const（不挂 window，只能通过作用域链以直接名字访问）：
 *     kanbanState / currentData / pdfViewState / chatHistory /
 *     analysisChatHistory / _PATENT_ASK_CACHE_PREFIX
 *
 * 保存时机说明：sendChatMessage / sendAnalysisChatMessage 被 web-app.js 以
 * addEventListener("click", fn) 方式捕获了原函数引用，覆盖 window 属性对
 * 点击路径无效，因此改用「监听发送按钮 disabled 属性变化」来捕获一次问答
 * 的开始与结束（开始时已含用户消息、结束后已含完整回复），两条路径（点击
 * 发送 / 回车发送）均可覆盖。
 */
(function () {
  "use strict";

  // ── 守卫：web-app.js 必须已加载 ──
  if (typeof runPatentInterpretation !== "function") return;
  if (typeof kanbanState === "undefined" || typeof currentData === "undefined") return;

  var CHAT_TTL = 30 * 24 * 60 * 60 * 1000; // 对话类缓存 30 天
  var MAX_SAVED_MSGS = 100;                // 单个对话最多持久化条数
  var PREFIX_INTERPRET = "patentlens-interpret-";
  var PREFIX_ANALYSIS_CHAT = "patentlens-analysis-chat-";
  var PREFIX_READER_CHAT = "patentlens-reader-chat-";

  // ── localStorage 存取工具 ────────────────────────────────

  function loadEntry(key, ttl) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;
      if (ttl && obj.ts && Date.now() - obj.ts > ttl) {
        try { localStorage.removeItem(key); } catch (e2) {}
        return null;
      }
      return obj;
    } catch (e) { return null; }
  }

  function saveEntry(key, obj) {
    try {
      localStorage.setItem(key, JSON.stringify(obj));
    } catch (e) { /* 忽略配额错误 */ }
  }

  function removeEntry(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  function fmtDate(ts) {
    try {
      var d = new Date(ts || Date.now());
      return (d.getMonth() + 1) + "/" + d.getDate();
    } catch (e) { return ""; }
  }

  function sanitizeKeyPart(s) {
    return String(s || "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80);
  }

  // ── 专利号解析 ──────────────────────────────────────────
  // 注意区分两套数据：专利原文详情用 window._currentPatentData /
  // window._patentPopupData（GP 数据）；审查文档（看板/阅读器/继续问）
  // 用顶层 let currentData（档案数据）。

  function patentKeyFromData(data) {
    if (!data) return "";
    var k = data.patent_number || data.publication_number || data.raw || "";
    if (!k && data.office && data.applicationNumber) k = data.office + data.applicationNumber;
    return String(k);
  }

  // 审查文档模式下的当前专利键（与 PatentCache.captureCurrentState 一致）
  function dossierPatentKey() {
    try {
      if (typeof currentData !== "undefined" && currentData) {
        return String(currentData.raw || (currentData.office + currentData.applicationNumber) || "");
      }
    } catch (e) {}
    return "";
  }

  // 专利详情（GP 原文）当前渲染的专利号；优先从 DOM 读取，
  // 避免 renderPatentDetail 与 window._currentPatentData 赋值之间的时序差
  function detailPatentKey(source) {
    try {
      if (source === "popup") {
        var ppn = document.getElementById("ppv-patent-number");
        if (ppn && (ppn.textContent || "").trim()) return ppn.textContent.trim();
        return patentKeyFromData(window._patentPopupData);
      }
      var dpn = document.querySelector("#patent-detail-content .pd-patent-number");
      if (dpn && (dpn.textContent || "").trim()) return dpn.textContent.trim();
      return patentKeyFromData(window._currentPatentData);
    } catch (e) {
      return patentKeyFromData(source === "popup" ? window._patentPopupData : window._currentPatentData);
    }
  }

  // ══ 1. AI 问一问：缓存有效期 1 小时 → 30 天 ═════════════

  (function extendPatentAskTTL() {
    if (typeof _loadPatentAskCache !== "function") return;
    if (typeof _PATENT_ASK_CACHE_PREFIX === "undefined") return;
    var PREFIX = _PATENT_ASK_CACHE_PREFIX;
    window._loadPatentAskCache = function (pn) {
      if (!pn) return null;
      try {
        var key = PREFIX + pn;
        var raw = localStorage.getItem(key);
        if (!raw) return null;
        var obj = JSON.parse(raw);
        if (!obj || !Array.isArray(obj.messages)) return null;
        if (obj.ts && Date.now() - obj.ts > CHAT_TTL) {
          try { localStorage.removeItem(key); } catch (e2) {}
          return null;
        }
        return obj.messages;
      } catch (e) { return null; }
    };
  })();

  // ══ 2. 专利详情「AI 解读」缓存 ══════════════════════════

  (function setupInterpretCache() {
    function containerFor(source) {
      return document.querySelector(
        source === "popup"
          ? '#ppv-content .pd-ai-interpret[data-source="popup"]'
          : '#patent-detail-content .pd-ai-interpret[data-source="detail"]'
      );
    }

    // 回显缓存结果（含缓存标记与「重新解读」按钮）
    function renderCached(container, cached, source) {
      var contentEl = container && container.querySelector(".pd-ai-interpret-content");
      if (!contentEl) return;
      contentEl.innerHTML =
        '<div class="pd-ai-interpret-cachetag">' +
          '<span>缓存于 ' + fmtDate(cached.ts) + '</span>' +
          '<button type="button" class="pd-ai-interpret-refresh-btn" title="忽略缓存重新解读">重新解读</button>' +
        '</div>' +
        '<div class="markdown-body">' + cached.html + '</div>';
      var btn = contentEl.querySelector(".pd-ai-interpret-refresh-btn");
      if (btn) {
        btn.addEventListener("click", function (ev) {
          ev.stopPropagation();
          window.runPatentInterpretation(source, true);
        });
      }
    }

    // 覆盖 runPatentInterpretation（inline onclick 动态解析全局名，覆盖生效）
    var _origInterpret = window.runPatentInterpretation;
    window.runPatentInterpretation = function (source, forceRefresh) {
      var src = source || "detail";
      var container = containerFor(src);
      if (!container) return Promise.resolve();
      var pn = detailPatentKey(src);

      // 缓存命中：直接回显
      if (pn && !forceRefresh) {
        var cached = loadEntry(PREFIX_INTERPRET + pn, 0);
        if (cached && cached.html) {
          renderCached(container, cached, src);
          return Promise.resolve();
        }
      }

      // 未命中：执行原解读，完成后保存最终渲染结果
      return Promise.resolve()
        .then(function () { return _origInterpret(src); })
        .then(function () {
          if (!pn) return;
          var contentEl = container.querySelector(".pd-ai-interpret-content");
          if (!contentEl) return;
          // 最终答案是 contentEl 的直接子节点 .markdown-body（思考区为 .ai-thinking-block）
          var answerEl = contentEl.querySelector(":scope > .markdown-body");
          if (!answerEl) return;
          var html = answerEl.innerHTML;
          // 失败/空结果不缓存（这些状态会保留 .pd-ai-interpret-hint 提示节点）
          if (html && !answerEl.querySelector(".pd-ai-interpret-hint")) {
            saveEntry(PREFIX_INTERPRET + pn, { ts: Date.now(), html: html });
          }
        })
        .catch(function () { /* 解读失败不缓存 */ });
    };

    // 详情/弹层渲染完成后自动回显已缓存的解读结果
    var _scheduled = false;
    function enhance() {
      _scheduled = false;
      var containers = document.querySelectorAll(".pd-ai-interpret");
      for (var i = 0; i < containers.length; i++) {
        var container = containers[i];
        if (container.dataset.aiCacheDone) continue;
        var src = container.dataset.source || "detail";
        var pn = detailPatentKey(src);
        if (!pn) continue; // 数据尚未就绪，等下一轮 DOM 变更再试
        container.dataset.aiCacheDone = "1";
        var cached = loadEntry(PREFIX_INTERPRET + pn, 0);
        if (cached && cached.html) renderCached(container, cached, src);
      }
    }
    function scheduleEnhance() {
      if (_scheduled) return;
      _scheduled = true;
      requestAnimationFrame(function () {
        _scheduled = false;
        try { enhance(); } catch (e) { console.warn("[AISessionCache] enhance failed:", e); }
      });
    }
    if (typeof MutationObserver === "function") {
      new MutationObserver(scheduleEnhance).observe(document.body, { childList: true, subtree: true });
      scheduleEnhance();
    }
  })();

  // ══ 3. 审查文档「继续问」（analysis chat）缓存 ══════════

  var _lastAnalysisPn = "";

  function analysisChatMessages() {
    return (typeof analysisChatHistory !== "undefined" && Array.isArray(analysisChatHistory))
      ? analysisChatHistory
      : [];
  }

  function saveAnalysisChat() {
    var pn = dossierPatentKey();
    if (!pn) return;
    // 面板跨专利保持打开时发送新消息：内存/DOM 中仍残留上一专利的对话，
    // 仅保留本轮（最后一个 user 消息起）的内容，避免混存到新专利的缓存
    if (_lastAnalysisPn && _lastAnalysisPn !== pn && analysisChatMessages().length > 0) {
      var hist = analysisChatMessages();
      var lastUserMsgIdx = -1;
      for (var i = 0; i < hist.length; i++) {
        if (hist[i] && hist[i].role === "user") lastUserMsgIdx = i;
      }
      analysisChatHistory = lastUserMsgIdx >= 0 ? hist.slice(lastUserMsgIdx) : [];
      var el = document.getElementById("analysis-chat-messages");
      if (el) {
        var kids = Array.prototype.slice.call(el.children);
        var lastUserIdx = -1;
        for (var j = 0; j < kids.length; j++) {
          if (kids[j].classList.contains("chat-msg") && kids[j].classList.contains("user")) lastUserIdx = j;
        }
        if (lastUserIdx > 0) {
          for (var k = 0; k < lastUserIdx; k++) el.removeChild(kids[k]);
        }
      }
    }
    _lastAnalysisPn = pn;
    var msgs = analysisChatMessages().filter(function (m) {
      return m && (m.role === "user" || m.role === "assistant") && m.content;
    });
    var key = PREFIX_ANALYSIS_CHAT + pn;
    if (msgs.length === 0) { removeEntry(key); return; }
    if (msgs.length > MAX_SAVED_MSGS) msgs = msgs.slice(-MAX_SAVED_MSGS);
    var analysis = (kanbanState && kanbanState.analysis) || "";
    saveEntry(key, {
      ts: Date.now(),
      messages: msgs,
      // 分析报告指纹：报告变化后不再恢复旧对话
      analysisLen: analysis.length,
      analysisHead: analysis.substring(0, 80),
    });
  }

  function restoreAnalysisChat(pn) {
    if (!pn) return false;
    var entry = loadEntry(PREFIX_ANALYSIS_CHAT + pn, CHAT_TTL);
    if (!entry || !Array.isArray(entry.messages) || entry.messages.length === 0) return false;
    var msgs = entry.messages.filter(function (m) {
      return m && (m.role === "user" || m.role === "assistant") && m.content;
    });
    if (msgs.length === 0) return false;
    // 指纹校验：当前分析报告与保存时不一致 → 视为过期
    var analysis = (kanbanState && kanbanState.analysis) || "";
    if (entry.analysisLen && entry.analysisLen !== analysis.length) return false;
    if (entry.analysisHead && entry.analysisHead !== analysis.substring(0, 80)) return false;
    var messagesEl = document.getElementById("analysis-chat-messages");
    if (!messagesEl) return false;

    messagesEl.innerHTML = "";
    analysisChatHistory = msgs.map(function (m) {
      return { role: m.role, content: m.content };
    });
    if (typeof appendAnalysisChatMessage === "function") {
      appendAnalysisChatMessage("system", "已恢复 " + fmtDate(entry.ts) + " 的历史对话（" + msgs.length + " 条）");
      msgs.forEach(function (m) { appendAnalysisChatMessage(m.role, m.content); });
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return true;
  }

  function onAnalysisPanelOpen() {
    var pn = dossierPatentKey();
    var pnChanged = !!(_lastAnalysisPn && pn && _lastAnalysisPn !== pn);
    if (pnChanged) {
      // 已切换专利：内存与 DOM 中的旧对话不再属于当前专利
      analysisChatHistory = [];
      var el = document.getElementById("analysis-chat-messages");
      if (el) el.innerHTML = "";
    }
    if (analysisChatMessages().length === 0) {
      restoreAnalysisChat(pn);
    }
    if (pn) _lastAnalysisPn = pn;
  }

  (function setupAnalysisChatCache() {
    // 面板从隐藏变为可见时恢复历史对话
    var panel = document.getElementById("analysis-chat-panel");
    if (panel && typeof MutationObserver === "function") {
      new MutationObserver(function () {
        if (!panel.classList.contains("hidden")) {
          setTimeout(function () {
            try { onAnalysisPanelOpen(); } catch (e) { console.warn("[AISessionCache] restore analysis chat failed:", e); }
          }, 0);
        }
      }).observe(panel, { attributes: true, attributeFilter: ["class"] });
    }

    // 「清空对话」按钮同时清除本地缓存（本监听在 web-app.js 原监听之后执行）
    var clearBtn = document.getElementById("analysis-chat-clear-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        var pn = dossierPatentKey();
        if (pn) removeEntry(PREFIX_ANALYSIS_CHAT + pn);
      });
    }

    // 监听发送按钮 disabled 变化：true=新一轮问答开始（含用户消息），
    // false=问答结束（含完整回复），两个时机各保存一次快照
    var sendBtn = document.getElementById("analysis-chat-send-btn");
    if (sendBtn && typeof MutationObserver === "function") {
      var armed = false;
      new MutationObserver(function () {
        if (sendBtn.disabled) {
          armed = true;
          try { saveAnalysisChat(); } catch (e) {}
        } else if (armed) {
          armed = false;
          setTimeout(function () {
            try { saveAnalysisChat(); } catch (e) {}
          }, 0);
        }
      }).observe(sendBtn, { attributes: true, attributeFilter: ["disabled"] });
    }
  })();

  // ══ 4. 阅读器单篇审查文档 AI 提问（reader chat）缓存 ════

  function readerDocKey(idx) {
    var doc = null;
    try {
      if (kanbanState && kanbanState.documents) {
        doc = kanbanState.documents.find(function (d) { return String(d.idx) === String(idx); });
      }
    } catch (e) {}
    var ident = doc
      ? (doc.docId || "") + "_" + (doc.docCode || "") + "_" + (doc.date || "") + "_" + (doc.name || "")
      : String(idx);
    return dossierPatentKey() + "|" + sanitizeKeyPart(ident);
  }

  function readerChatMessages() {
    return (typeof chatHistory !== "undefined" && Array.isArray(chatHistory)) ? chatHistory : [];
  }

  function saveReaderChat() {
    var idx = (typeof pdfViewState !== "undefined") ? pdfViewState.currentDocIdx : null;
    if (idx == null) return;
    var key = PREFIX_READER_CHAT + readerDocKey(idx);
    var msgs = readerChatMessages().filter(function (m) {
      return m && (m.role === "user" || m.role === "assistant") && m.content;
    });
    if (msgs.length === 0) { removeEntry(key); return; }
    if (msgs.length > MAX_SAVED_MSGS) msgs = msgs.slice(-MAX_SAVED_MSGS);
    saveEntry(key, { ts: Date.now(), messages: msgs });
  }

  // 与 sendChatMessage 相同的方式重建溯源索引，使【来源: D{idx}_B_p{n}_{m}】可点击
  function buildReaderTraceIndex(idx) {
    var traceIdx = {};
    try {
      var ext = kanbanState.extractions[idx];
      if (ext && ext.blocks && ext.blocks.length) {
        ext.blocks.forEach(function (b) {
          if (b && b.content && String(b.content).trim()) {
            var refId = "D" + idx + "_" + b.block_id;
            traceIdx[refId] = {
              docIdx: idx,
              page: b.page,
              bbox: b.bbox,
              content: b.content,
              label: b.label,
              originalBlockId: b.block_id,
              pageDimensions: ext.page_dimensions ? (ext.page_dimensions[b.page] || null) : null,
            };
          }
        });
      }
    } catch (e) {}
    return traceIdx;
  }

  var _restoringReaderChat = false;

  function restoreReaderChat() {
    if (readerChatMessages().length > 0) return false;
    var idx = (typeof pdfViewState !== "undefined") ? pdfViewState.currentDocIdx : null;
    if (idx == null) return false;
    var entry = loadEntry(PREFIX_READER_CHAT + readerDocKey(idx), CHAT_TTL);
    if (!entry || !Array.isArray(entry.messages) || entry.messages.length === 0) return false;
    var msgs = entry.messages.filter(function (m) {
      return m && (m.role === "user" || m.role === "assistant") && m.content;
    });
    if (msgs.length === 0) return false;
    var messagesEl = document.getElementById("chat-messages");
    if (!messagesEl) return false;

    var traceIdx = buildReaderTraceIndex(idx);
    if (Object.keys(traceIdx).length > 0) {
      try {
        if (!kanbanState.traceIndex) kanbanState.traceIndex = {};
        Object.assign(kanbanState.traceIndex, traceIdx);
      } catch (e) {}
    }

    _restoringReaderChat = true;
    try {
      messagesEl.innerHTML = "";
      chatHistory = msgs.map(function (m) {
        return { role: m.role, content: m.content };
      });
      var sysEl = document.createElement("div");
      sysEl.className = "chat-msg system";
      sysEl.textContent = "已恢复 " + fmtDate(entry.ts) + " 的历史对话（" + msgs.length + " 条）";
      messagesEl.appendChild(sysEl);
      msgs.forEach(function (m) {
        var el = document.createElement("div");
        el.className = "chat-msg " + m.role;
        if (m.role === "assistant") {
          var html = Object.keys(traceIdx).length > 0
            ? renderMarkdownWithTrace(m.content, traceIdx)
            : renderMarkdown(m.content);
          el.innerHTML = '<div class="chat-msg-content markdown-body">' + html + '</div>';
        } else {
          el.textContent = m.content;
        }
        messagesEl.appendChild(el);
      });
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } finally {
      _restoringReaderChat = false;
    }
    return true;
  }

  (function setupReaderChatCache() {
    var panel = document.getElementById("reader-chat-panel");

    // AI 对话面板从隐藏变为可见时恢复当前文档的历史对话
    if (panel && typeof MutationObserver === "function") {
      new MutationObserver(function () {
        if (!panel.classList.contains("hidden")) {
          setTimeout(function () {
            try { restoreReaderChat(); } catch (e) { console.warn("[AISessionCache] restore reader chat failed:", e); }
          }, 0);
        }
      }).observe(panel, { attributes: true, attributeFilter: ["class"] });
    }

    // 面板已打开时切换文档：web-app.js 会清空 chatHistory 与 #chat-messages，
    // 监听消息容器被清空后恢复新文档的缓存对话
    var messagesEl = document.getElementById("chat-messages");
    if (messagesEl && typeof MutationObserver === "function") {
      new MutationObserver(function () {
        if (_restoringReaderChat) return;
        if (messagesEl.children.length === 0 && panel && !panel.classList.contains("hidden")) {
          setTimeout(function () {
            if (_restoringReaderChat) return;
            if (messagesEl.children.length === 0) {
              try { restoreReaderChat(); } catch (e) {}
            }
          }, 50);
        }
      }).observe(messagesEl, { childList: true });
    }

    // 发送按钮 disabled 变化：捕获问答开始/结束时机并保存快照
    var sendBtn = document.getElementById("chat-send-btn");
    if (sendBtn && typeof MutationObserver === "function") {
      var armed = false;
      new MutationObserver(function () {
        if (sendBtn.disabled) {
          armed = true;
          try { saveReaderChat(); } catch (e) {}
        } else if (armed) {
          armed = false;
          setTimeout(function () {
            try { saveReaderChat(); } catch (e) {}
          }, 0);
        }
      }).observe(sendBtn, { attributes: true, attributeFilter: ["disabled"] });
    }
  })();

  // ══ 5. 过期对话缓存清理（懒执行，不阻塞启动） ══════════

  setTimeout(function () {
    try {
      var now = Date.now();
      var prefixes = [PREFIX_ANALYSIS_CHAT, PREFIX_READER_CHAT, "patentlens_ask_"];
      var toRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key) continue;
        var matched = false;
        for (var j = 0; j < prefixes.length; j++) {
          if (key.indexOf(prefixes[j]) === 0) { matched = true; break; }
        }
        if (!matched) continue;
        try {
          var obj = JSON.parse(localStorage.getItem(key) || "null");
          if (!obj || !obj.ts || now - obj.ts > CHAT_TTL) toRemove.push(key);
        } catch (e) { toRemove.push(key); }
      }
      toRemove.forEach(function (k) { try { localStorage.removeItem(k); } catch (e2) {} });
    } catch (e) { /* ignore */ }
  }, 3000);
})();
