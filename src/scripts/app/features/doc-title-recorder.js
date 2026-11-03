/*!
 * PatentLens - 未翻译审查文档标题后台记录
 *
 * 开启后，任何一次审查文档列表查询（GD / EPO 降级）都会检查返回的文档标题。
 * 若 getStatusInfo 没有命中中文译名（结果名不含中文），则把原始英文标题、
 * 局别和文档代码写入 localStorage，便于后续补充 patent-status.js 的映射表。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var ENABLED_KEY = "patentlens_doc_title_recorder_enabled";
  var RECORDS_KEY = "patentlens_doc_title_records_v1";
  var MAX_RECORDS = 600;

  function safeStorageGet(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeStorageSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (_) { return false; }
  }

  function safeStorageRemove(key) {
    try { window.localStorage.removeItem(key); } catch (_) {}
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hasChinese(text) {
    return /[\u4e00-\u9fff]/.test(String(text || ""));
  }

  function normalizeTitle(text) {
    return String(text || "").toLowerCase().replace(/[\s\u00a0]+/g, " ").trim();
  }

  function looksLikeEnglishTitle(text) {
    var value = String(text || "").trim();
    if (value.length < 6) return false;
    if (!/[A-Za-z]/.test(value)) return false;
    if (hasChinese(value)) return false;
    // 纯编号、纯日期或纯代码不是可补充的标题
    if (/^[0-9\/.\-:]+$/.test(value)) return false;
    return true;
  }

  function isEnabled() {
    return safeStorageGet(ENABLED_KEY) === "true";
  }

  function readRecords() {
    var raw = safeStorageGet(RECORDS_KEY);
    if (!raw) return {};
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeRecords(records) {
    var keys = Object.keys(records || {});
    if (keys.length > MAX_RECORDS) {
      keys.sort(function (a, b) {
        return (records[b].lastSeen || 0) - (records[a].lastSeen || 0);
      });
      var trimmed = {};
      keys.slice(0, MAX_RECORDS).forEach(function (key) { trimmed[key] = records[key]; });
      records = trimmed;
    }
    safeStorageSet(RECORDS_KEY, JSON.stringify(records));
  }

  function recordDocuments(office, docs) {
    if (!isEnabled() || !Array.isArray(docs) || docs.length === 0) return [];
    var records = readRecords();
    var now = Date.now();
    var added = [];

    docs.forEach(function (doc) {
      if (!doc) return;
      var docCode = doc.docCode || doc.documentType || doc.kindCode || doc.type || "";
      var desc = doc.docDesc || doc.documentDescription || doc.description || "";
      if (!looksLikeEnglishTitle(desc)) return;

      var status = null;
      try {
        if (typeof window.getStatusInfo === "function") {
          status = window.getStatusInfo(office, docCode, desc);
        }
      } catch (_) {}
      if (status && hasChinese(status.name)) return;

      var key = normalizeTitle(desc);
      if (!key) return;
      var existing = records[key];
      if (existing) {
        existing.count = (existing.count || 0) + 1;
        existing.lastSeen = now;
        if (docCode && !existing.docCode) existing.docCode = docCode;
      } else {
        records[key] = {
          title: String(desc).trim(),
          office: String(office || "").toUpperCase(),
          docCode: String(docCode || ""),
          firstSeen: now,
          lastSeen: now,
          count: 1,
        };
        added.push(key);
      }
    });

    if (added.length) {
      writeRecords(records);
      renderSettingsPanel();
    }
    return added;
  }

  function setEnabled(enabled) {
    safeStorageSet(ENABLED_KEY, enabled ? "true" : "false");
    renderSettingsPanel();
  }

  function clearRecords() {
    safeStorageRemove(RECORDS_KEY);
    renderSettingsPanel();
  }

  function removeRecord(key) {
    var records = readRecords();
    if (!records[key]) return;
    delete records[key];
    writeRecords(records);
    renderSettingsPanel();
  }

  function sortedRecords() {
    var records = readRecords();
    return Object.keys(records).map(function (key) {
      return { key: key, record: records[key] };
    }).sort(function (a, b) {
      return (b.record.lastSeen || 0) - (a.record.lastSeen || 0);
    });
  }

  function plainTextRecords() {
    return sortedRecords().map(function (item) {
      var r = item.record;
      return "[" + (r.office || "?") + "] " + (r.docCode ? r.docCode + " | " : "") + r.title;
    }).join("\n");
  }

  function copyRecords() {
    var text = plainTextRecords();
    if (!text) return Promise.resolve(false);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () {
        return legacyCopy(text);
      });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var area = document.createElement("textarea");
      area.value = text;
      area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch (_) {
      return false;
    }
  }

  function renderSettingsPanel() {
    var checkbox = document.getElementById("doc-title-recorder-checkbox");
    if (checkbox) checkbox.checked = isEnabled();

    var stats = document.getElementById("doc-title-recorder-stats");
    var list = document.getElementById("doc-title-recorder-list");
    var items = sortedRecords();

    if (stats) {
      stats.textContent = items.length
        ? "共 " + items.length + " 条 · 仅保存在本机"
        : "暂无记录";
    }
    if (!list) return;

    if (!items.length) {
      list.innerHTML = '<div class="doc-title-recorder-empty">开启后台记录后，查询审查文档时会自动收集没有中文译名的英文标题。</div>';
      return;
    }

    var html = '<div class="doc-title-recorder-items">';
    items.forEach(function (item) {
      var r = item.record || {};
      html += '<div class="doc-title-recorder-item" data-record-key="' + escapeHtml(item.key) + '">';
      html += '<div class="doc-title-recorder-meta">';
      if (r.office) html += '<span class="doc-title-recorder-office">' + escapeHtml(r.office) + '</span>';
      if (r.docCode) html += '<span class="doc-title-recorder-code">' + escapeHtml(r.docCode) + '</span>';
      if (r.count > 1) html += '<span class="doc-title-recorder-count">×' + Number(r.count) + '</span>';
      html += '</div>';
      html += '<div class="doc-title-recorder-title">' + escapeHtml(r.title || "") + '</div>';
      html += '<button type="button" class="btn-small btn-secondary doc-title-recorder-remove" data-record-key="' + escapeHtml(item.key) + '">已补译，移除</button>';
      html += '</div>';
    });
    html += '</div>';
    list.innerHTML = html;
  }

  function bindSettingsUi() {
    var checkbox = document.getElementById("doc-title-recorder-checkbox");
    if (checkbox && !checkbox.dataset.docTitleRecorderBound) {
      checkbox.dataset.docTitleRecorderBound = "1";
      checkbox.addEventListener("change", function () {
        setEnabled(!!checkbox.checked);
      });
    }

    var copyBtn = document.getElementById("doc-title-recorder-copy-btn");
    if (copyBtn && !copyBtn.dataset.docTitleRecorderBound) {
      copyBtn.dataset.docTitleRecorderBound = "1";
      copyBtn.addEventListener("click", function () {
        copyRecords().then(function (ok) {
          if (typeof window.showToast === "function") {
            window.showToast(ok ? "已复制未翻译标题" : "复制失败，请手动选择列表内容", 3000);
          }
        });
      });
    }

    var clearBtn = document.getElementById("doc-title-recorder-clear-btn");
    if (clearBtn && !clearBtn.dataset.docTitleRecorderBound) {
      clearBtn.dataset.docTitleRecorderBound = "1";
      clearBtn.addEventListener("click", function () {
        if (sortedRecords().length === 0) return;
        if (typeof window.confirm === "function" && !window.confirm("确定清空所有未翻译标题记录？")) return;
        clearRecords();
      });
    }

    var list = document.getElementById("doc-title-recorder-list");
    if (list && !list.dataset.docTitleRecorderBound) {
      list.dataset.docTitleRecorderBound = "1";
      list.addEventListener("click", function (event) {
        var btn = event.target && event.target.closest ? event.target.closest(".doc-title-recorder-remove") : null;
        if (!btn) return;
        removeRecord(btn.dataset.recordKey);
      });
    }

    var settingsBtn = document.getElementById("ai-settings-btn");
    if (settingsBtn && !settingsBtn.dataset.docTitleRecorderBound) {
      settingsBtn.dataset.docTitleRecorderBound = "1";
      settingsBtn.addEventListener("click", function () {
        // 等设置弹窗 DOM 可见后刷新一次
        setTimeout(renderSettingsPanel, 0);
      });
    }

    document.querySelectorAll(".settings-tab-btn").forEach(function (btn) {
      if (btn.dataset.settingsTab === "doctitle" && !btn.dataset.docTitleRecorderBound) {
        btn.dataset.docTitleRecorderBound = "1";
        btn.addEventListener("click", function () {
          setTimeout(renderSettingsPanel, 0);
        });
      }
    });
  }

  function installGdFetchHook() {
    if (typeof window.gdFetch !== "function" || window.gdFetch.__docTitleRecorderWrapped) return;
    var original = window.gdFetch;
    var wrapped = async function (urlPath) {
      var data = await original.apply(this, arguments);
      try {
        var match = String(urlPath || "").match(/\/doc-list\/svc\/doclist\/([^/]+)\//);
        if (match && data) {
          var office = decodeURIComponent(match[1]);
          var rawDocs = data.documents || data.docs || data;
          var docs = typeof window.extractDocuments === "function"
            ? window.extractDocuments(rawDocs)
            : (Array.isArray(rawDocs) ? rawDocs : []);
          recordDocuments(office, docs);
        }
      } catch (_) {}
      return data;
    };
    wrapped.__docTitleRecorderWrapped = true;
    window.gdFetch = wrapped;
  }

  window.PatentLensDocTitleRecorder = {
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    getRecords: function () {
      return sortedRecords().map(function (item) {
        var r = item.record || {};
        return { title: r.title, office: r.office, docCode: r.docCode, count: r.count };
      });
    },
    clear: clearRecords,
    text: plainTextRecords,
    render: renderSettingsPanel,
    // 供测试使用
    _looksLikeEnglishTitle: looksLikeEnglishTitle,
    _normalizeTitle: normalizeTitle,
  };

  function init() {
    installGdFetchHook();
    bindSettingsUi();
    renderSettingsPanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
