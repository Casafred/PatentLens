/*!
 * PatentLens - 专利收藏夹 UI 与交互
 *
 * 依赖（均为 web-app.js 暴露的全局，该文件未用 IIFE 包裹）：
 *   - PatentFavorites         本模块自带的 store
 *   - PatentCache             读取历史条目的标题/申请人
 *   - currentData             当前审查文档（dossier）的专利数据
 *   - _openPdPatent / openJPlatPat  重新打开专利原文
 *   - escapeHtml / timeAgo    文本转义与时间格式化
 *
 * 由于 web-app.js 已冻结（不可新增行），本模块通过 MutationObserver 向
 * 已渲染的 DOM 注入「收藏」按钮，并通过 document 级事件委托处理点击，
 * 不修改任何既有渲染函数。
 */
(function () {
  "use strict";

  var FAV_VIEW_CLASS = "fav-view";
  var injectedFlag = "data-fav-injected";

  // ── tiny DOM helpers ────────────────────────────────────────────────
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function esc(value) {
    if (typeof escapeHtml === "function") return escapeHtml(value);
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function ago(ts) {
    if (typeof timeAgo === "function") { try { return timeAgo(ts); } catch (e) {} }
    if (!ts) return "";
    var d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return "刚刚";
    if (d < 3600) return Math.floor(d / 60) + "分钟前";
    if (d < 86400) return Math.floor(d / 3600) + "小时前";
    return Math.floor(d / 86400) + "天前";
  }
  function $(id) { return document.getElementById(id); }

  // ── 模式切换（复用既有 .search-mode-btn 点击处理器） ────────────────
  function switchMode(mode) {
    var btn = document.querySelector('.search-mode-btn[data-mode="' + mode + '"]');
    if (btn) btn.click();
  }

  // ── 重新打开一个收藏（与历史条目点击流程一致） ──────────────────────
  function reopenFavorite(fav) {
    if (!fav || !fav.patentNumber) return;
    var pn = fav.patentNumber;
    var input = $("patent-input");
    if (fav.type === "patent") {
      if (fav.source === "jplatpat" && typeof openJPlatPat === "function") {
        if (input) input.value = pn;
        openJPlatPat(pn);
        return;
      }
      switchMode("patent");
      if (typeof _openPdPatent === "function") {
        _openPdPatent(pn, { skipCachePrompt: true });
      } else {
        if (input) input.value = pn;
        var sb = $("search-btn"); if (sb) sb.click();
      }
    } else {
      switchMode("dossier");
      if (input) input.value = pn;
      var sb2 = $("search-btn"); if (sb2) sb2.click();
    }
  }

  // ── 从历史条目 DOM + PatentCache 提取完整专利元数据 ─────────────────
  function readHistoryItemData(item) {
    var pn = item.dataset.patent || "";
    var type = item.dataset.type === "patent" ? "patent" : "dossier";
    var source = item.dataset.source || "";
    var title = "", applicant = "", office = "";
    if (typeof PatentCache !== "undefined") {
      if (type === "patent" && PatentCache.getPatentHistoryAll) {
        var ph = PatentCache.getPatentHistoryAll() || {};
        var rec = ph[pn] || {};
        title = rec.title || ""; applicant = rec.applicantName || "";
        if (!source) source = rec.source || "gp";
        office = source === "jplatpat" ? "JP" : "GP";
      } else if (type === "dossier" && PatentCache.getHistoryAll) {
        var dh = PatentCache.getHistoryAll() || {};
        var rec2 = dh[pn] || {};
        title = rec2.title || ""; applicant = rec2.applicantName || "";
        office = rec2.office || "";
      }
    }
    if (!title) { var t = item.querySelector(".history-item-title"); if (t) title = t.textContent.trim(); }
    if (!applicant) {
      var a = item.querySelector(".history-item-applicant");
      if (a) applicant = a.textContent.replace(/^申请人:\s*/, "").trim();
    }
    return { patentNumber: pn, type: type, source: source, title: title, applicantName: applicant, office: office };
  }

  // ── 当前审查文档（dossier）元数据，来自全局 currentData ─────────────
  function readCurrentDossierData() {
    if (typeof currentData === "undefined" || !currentData) return null;
    var pn = currentData.raw || (currentData.office ? currentData.office + (currentData.applicationNumber || "") : "");
    if (!pn) return null;
    return {
      patentNumber: pn,
      type: "dossier",
      office: currentData.office || "",
      title: currentData.title || "",
      applicantName: currentData.applicantName || "",
      source: "",
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // 注入：历史条目的星标按钮
  // ════════════════════════════════════════════════════════════════════
  var STAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" style="width:13px;height:13px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

  function injectHistoryStars() {
    var list = $("history-list");
    if (!list) return;
    var items = list.querySelectorAll(".history-item:not([" + injectedFlag + "])");
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      // 仅在普通模式（有删除按钮）注入；多选模式下隐藏操作按钮。
      var row = item.querySelector(".history-item-row");
      if (!row || row.querySelector(".history-item-fav-btn")) { item.setAttribute(injectedFlag, "1"); continue; }
      var btn = el("button", "history-item-fav-btn");
      btn.type = "button";
      btn.innerHTML = STAR_SVG;
      btn.dataset.favAction = "toggle-history";
      btn.dataset.patent = item.dataset.patent || "";
      btn.dataset.type = item.dataset.type || "";
      btn.dataset.source = item.dataset.source || "";
      btn.title = "收藏 / 取消收藏";
      // Direct listener + stopPropagation: the star sits inside a .history-item
      // whose frozen click handler re-opens the patent. We must not let the click
      // bubble there, and we cannot use document delegation (the frozen handler
      // fires before a document-level listener).
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        doToggle(readHistoryItemData(btn));
      });
      row.appendChild(btn);
      item.setAttribute(injectedFlag, "1");
      updateHistoryStarState(btn);
    }
  }

  function updateHistoryStarState(btn) {
    if (!btn) return;
    var pn = btn.dataset.patent, type = btn.dataset.type === "patent" ? "patent" : "dossier";
    if (window.PatentFavorites.isFavorited(pn, type)) btn.classList.add("favorited");
    else btn.classList.remove("favorited");
  }

  // ════════════════════════════════════════════════════════════════════
  // 注入：专利原文详情头部的「收藏」按钮
  // ════════════════════════════════════════════════════════════════════
  function injectPatentFavoriteBtn() {
    var content = $("patent-detail-content");
    if (!content) return;
    var links = content.querySelector(".pd-header .pd-links");
    if (!links) return;
    var existing = links.querySelector("[data-fav-action='toggle-patent']");
    if (existing) { updatePatentFavBtnState(existing); return; }
    var numEl = content.querySelector(".pd-header .pd-patent-number");
    var titleEl = content.querySelector(".pd-header .pd-title");
    var pn = numEl ? numEl.textContent.trim() : "";
    if (!pn) return;
    var btn = el("button", "pd-header-link fav-inject-btn", "收藏");
    btn.type = "button";
    btn.dataset.favAction = "toggle-patent";
    btn.dataset.patent = pn;
    btn.dataset.title = titleEl ? titleEl.textContent.trim() : "";
    btn.dataset.source = content.querySelector(".pd-header .pd-header-jp") ? "jplatpat" : "gp";
    btn.title = "加入收藏夹";
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      doToggle({
        patentNumber: btn.dataset.patent,
        type: "patent",
        title: btn.dataset.title || "",
        source: btn.dataset.source || "gp",
        office: btn.dataset.source === "jplatpat" ? "JP" : "GP",
      });
    });
    links.appendChild(btn);
    updatePatentFavBtnState(btn);
  }

  function updatePatentFavBtnState(btn) {
    if (!btn) return;
    if (window.PatentFavorites.isFavorited(btn.dataset.patent, "patent")) {
      btn.textContent = "已收藏"; btn.classList.add("favorited");
    } else {
      btn.textContent = "收藏"; btn.classList.remove("favorited");
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 注入：审查文档标签栏的「收藏当前」按钮
  // ════════════════════════════════════════════════════════════════════
  function injectDossierFavoriteBtn() {
    var bar = $("dossier-tabs-bar");
    if (!bar || bar.classList.contains("hidden")) return;
    if (!bar.querySelector(".pdt-tab")) return;
    var existing = bar.querySelector("[data-fav-action='toggle-dossier']");
    if (existing) { updateDossierFavBtnState(existing); return; }
    var btn = el("button", "dossier-fav-btn", "收藏");
    btn.type = "button";
    btn.dataset.favAction = "toggle-dossier";
    btn.title = "收藏当前审查文档";
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var d = readCurrentDossierData();
      if (!d) return;
      doToggle(d);
    });
    bar.appendChild(btn);
    updateDossierFavBtnState(btn);
  }

  function updateDossierFavBtnState(btn) {
    if (!btn) return;
    var data = readCurrentDossierData();
    if (!data) { btn.textContent = "收藏"; btn.classList.remove("favorited"); btn.disabled = true; return; }
    btn.disabled = false;
    if (window.PatentFavorites.isFavorited(data.patentNumber, "dossier")) {
      btn.textContent = "已收藏"; btn.classList.add("favorited");
    } else {
      btn.textContent = "收藏"; btn.classList.remove("favorited");
    }
  }

  // ── 收藏状态变化时，刷新所有已注入按钮的视觉状态 ────────────────────
  function refreshInjectedStates() {
    document.querySelectorAll(".history-item-fav-btn").forEach(updateHistoryStarState);
    document.querySelectorAll("[data-fav-action='toggle-patent']").forEach(updatePatentFavBtnState);
    document.querySelectorAll("[data-fav-action='toggle-dossier']").forEach(updateDossierFavBtnState);
  }

  // ════════════════════════════════════════════════════════════════════
  // 侧栏视图切换：历史 ↔ 收藏夹
  // ════════════════════════════════════════════════════════════════════
  function injectSidebarToggle() {
    var actions = document.querySelector(".history-sidebar-actions");
    if (!actions || $("fav-view-toggle")) return;
    var btn = el("button", "btn-icon-sm fav-view-toggle", "");
    btn.id = "fav-view-toggle";
    btn.type = "button";
    btn.title = "收藏夹";
    btn.innerHTML = '<svg class="svg-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    btn.addEventListener("click", toggleFavView);
    actions.insertBefore(btn, actions.firstChild);
  }

  function toggleFavView() {
    var sidebar = $("history-sidebar");
    if (!sidebar) return;
    sidebar.classList.toggle(FAV_VIEW_CLASS);
    if (sidebar.classList.contains(FAV_VIEW_CLASS)) renderFavoritesList();
  }

  function ensureFavoritesContainer() {
    var list = $("history-list");
    if (!list || $("favorites-list")) return;
    var container = el("div", "favorites-list");
    container.id = "favorites-list";
    list.parentNode.insertBefore(container, list.nextSibling);
  }

  // ════════════════════════════════════════════════════════════════════
  // 收藏夹列表渲染
  // ════════════════════════════════════════════════════════════════════
  function getSearchQuery() {
    var input = $("history-search-input");
    return input ? input.value.trim().toLowerCase() : "";
  }

  function renderFavoritesList() {
    var container = $("favorites-list");
    if (!container) return;
    var favorites = window.PatentFavorites.getSnapshot();
    var q = getSearchQuery();
    var view = favorites.filter(function (f) {
      if (!q) return true;
      return (f.patentNumber || "").toLowerCase().includes(q)
        || (f.title || "").toLowerCase().includes(q)
        || (f.applicantName || "").toLowerCase().includes(q)
        || (f.note || "").toLowerCase().includes(q)
        || (f.folder || "").toLowerCase().includes(q);
    });

    // 更新切换按钮的计数徽标
    var toggle = $("fav-view-toggle");
    if (toggle) toggle.setAttribute("data-count", String(favorites.length));

    if (!view.length) {
      container.innerHTML = '<div class="fav-empty">' + (favorites.length ? "未找到匹配的收藏" : "暂无收藏，点击专利原文 / 审查文档或历史条目的星标加入收藏夹") + '</div>';
      return;
    }

    container.innerHTML = view.map(function (f) {
      var typeBadge = f.type === "patent"
        ? '<span class="fav-type-badge type-patent" title="专利原文">原文</span>'
        : '<span class="fav-type-badge type-dossier" title="审查文档">审查</span>';
      var office = f.office ? '<span class="fav-office">' + esc(f.office) + '</span> ' : '';
      var titleHtml = f.title ? '<div class="fav-item-title">' + esc(f.title) + '</div>' : '';
      var noteHtml = f.note ? '<div class="fav-item-note" title="' + esc(f.note) + '">' + esc(f.note) + '</div>' : '';
      var metaHtml = '<div class="fav-item-meta">'
        + '<span class="fav-folder" title="收藏夹分组">' + esc(f.folder) + '</span>'
        + (f.applicantName ? '<span class="fav-sep">·</span><span class="fav-applicant">' + esc(f.applicantName) + '</span>' : '')
        + '<span class="fav-sep">·</span><span class="fav-time">' + esc(ago(f.createdAt)) + '</span>'
        + '</div>';
      var pinBtn = '<button class="fav-act-btn fav-pin' + (f.pinned ? " active" : "") + '" data-fav-action="pin" data-fav-id="' + esc(f.id) + '" title="' + (f.pinned ? "取消置顶" : "置顶") + '" type="button">' + (f.pinned ? "★" : "☆") + '</button>';
      var editBtn = '<button class="fav-act-btn" data-fav-action="edit" data-fav-id="' + esc(f.id) + '" title="编辑备注 / 分组" type="button">编辑</button>';
      var delBtn = '<button class="fav-act-btn fav-del" data-fav-action="delete" data-fav-id="' + esc(f.id) + '" title="删除收藏" type="button">删除</button>';
      return '<div class="fav-item' + (f.pinned ? " pinned" : "") + '" data-fav-action="open" data-fav-id="' + esc(f.id) + '">'
        + '<div class="fav-item-main">'
        + '<div class="fav-item-patent">' + typeBadge + office + esc(f.patentNumber) + '</div>'
        + titleHtml + noteHtml + metaHtml
        + '</div>'
        + '<div class="fav-item-actions">' + pinBtn + editBtn + delBtn + '</div>'
        + '</div>';
    }).join("");
  }

  // ════════════════════════════════════════════════════════════════════
  // 编辑对话框（备注 / 分组 / 置顶）
  // ════════════════════════════════════════════════════════════════════
  var editingId = null;

  function ensureEditDialog() {
    if ($("fav-edit-modal")) return;
    var modal = el("div", "fav-edit-modal");
    modal.id = "fav-edit-modal";
    modal.innerHTML =
      '<div class="fav-edit-dialog" role="dialog" aria-modal="true">'
      + '<div class="fav-edit-title">编辑收藏</div>'
      + '<label class="fav-edit-label">备注</label>'
      + '<textarea id="fav-edit-note" rows="3" placeholder="为该专利添加备注（如案件要点、对比方向、跟进事项）"></textarea>'
      + '<label class="fav-edit-label">收藏夹分组</label>'
      + '<input type="text" id="fav-edit-folder" list="fav-edit-folders" placeholder="默认收藏">'
      + '<datalist id="fav-edit-folders"></datalist>'
      + '<label class="fav-edit-pin-row"><input type="checkbox" id="fav-edit-pinned"> 置顶显示</label>'
      + '<div class="fav-edit-actions">'
      + '<button type="button" id="fav-edit-cancel" class="btn-secondary-sm">取消</button>'
      + '<button type="button" id="fav-edit-save" class="btn-primary-sm">保存</button>'
      + '</div>'
      + '</div>';
    document.body.appendChild(modal);
    $("fav-edit-cancel").addEventListener("click", closeEditDialog);
    $("fav-edit-save").addEventListener("click", saveEditDialog);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeEditDialog(); });
  }

  function openEditDialog(id) {
    var fav = window.PatentFavorites.getSnapshot().find(function (f) { return f.id === id; });
    if (!fav) return;
    ensureEditDialog();
    editingId = id;
    $("fav-edit-note").value = fav.note || "";
    $("fav-edit-folder").value = fav.folder || "";
    $("fav-edit-pinned").checked = !!f.pinned;
    var dl = $("fav-edit-folders");
    dl.innerHTML = window.PatentFavorites.getFolders().map(function (name) {
      return '<option value="' + esc(name) + '">';
    }).join("");
    $("fav-edit-modal").classList.add("show");
    setTimeout(function () { $("fav-edit-note").focus(); }, 0);
  }

  function closeEditDialog() {
    var modal = $("fav-edit-modal");
    if (modal) modal.classList.remove("show");
    editingId = null;
  }

  function saveEditDialog() {
    if (!editingId) return;
    var patch = {
      note: $("fav-edit-note").value,
      folder: $("fav-edit-folder").value,
      pinned: $("fav-edit-pinned").checked,
    };
    window.PatentFavorites.update(editingId, patch);
    closeEditDialog();
  }

  // ════════════════════════════════════════════════════════════════════
  // 事件委托：所有 [data-fav-action] 点击
  // ════════════════════════════════════════════════════════════════════
  function onDelegatedClick(e) {
    var target = e.target.closest("[data-fav-action]");
    if (!target) return;
    var action = target.dataset.favAction;

    // 注入的 toggle 按钮（历史星标 / 专利原文 / 审查文档）由各自的直接监听器
    // 处理并 stopPropagation，不会走到这里。委托仅负责收藏夹列表内的操作。
    if (action === "open") {
      var fav = window.PatentFavorites.getSnapshot().find(function (f) { return f.id === target.dataset.favId; });
      if (fav) reopenFavorite(fav);
      return;
    }
    if (action === "pin") {
      var fav2 = window.PatentFavorites.getSnapshot().find(function (f) { return f.id === target.dataset.favId; });
      if (fav2) window.PatentFavorites.update(fav2.id, { pinned: !fav2.pinned });
      return;
    }
    if (action === "edit") {
      openEditDialog(target.dataset.favId);
      return;
    }
    if (action === "delete") {
      var fav3 = window.PatentFavorites.getSnapshot().find(function (f) { return f.id === target.dataset.favId; });
      if (!fav3) return;
      if (!confirm("确定删除收藏「" + (fav3.title || fav3.patentNumber) + "」？")) return;
      window.PatentFavorites.remove(fav3.id);
      return;
    }
  }

  function doToggle(data) {
    var res = window.PatentFavorites.toggle(data.patentNumber, data.type, data);
    if (!res.favorite && !res.favorited) { alert("收藏失败：专利号无效。"); return; }
    // store.onChange 会刷新列表与已注入按钮状态，这里无需额外处理
  }

  // ════════════════════════════════════════════════════════════════════
  // 初始化
  // ════════════════════════════════════════════════════════════════════
  function observe(targetId, injectFn) {
    var target = $(targetId);
    if (!target) return;
    var obs = new MutationObserver(function () { injectFn(); });
    obs.observe(target, { childList: true });
    injectFn();
  }

  function init() {
    if (typeof window.PatentFavorites === "undefined") return;
    window.PatentFavorites.init();
    injectSidebarToggle();
    ensureFavoritesContainer();

    // 收藏状态变化 → 刷新列表 + 已注入按钮
    window.PatentFavorites.onChange(function () {
      renderFavoritesList();
      refreshInjectedStates();
    });

    // 历史搜索框同时过滤收藏夹
    var searchInput = $("history-search-input");
    if (searchInput && !searchInput.dataset.favBound) {
      searchInput.addEventListener("input", function () {
        if ($("history-sidebar") && $("history-sidebar").classList.contains(FAV_VIEW_CLASS)) renderFavoritesList();
      });
      searchInput.dataset.favBound = "1";
    }

    // 三个注入点
    observe("history-list", injectHistoryStars);
    observe("patent-detail-content", injectPatentFavoriteBtn);
    observe("dossier-tabs-bar", injectDossierFavoriteBtn);

    // document 级事件委托
    document.addEventListener("click", onDelegatedClick);

    // 键盘关闭编辑框
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeEditDialog();
    });

    renderFavoritesList();
  }

  window.PatentFavoritesUI = {
    init: init,
    refresh: function () { renderFavoritesList(); refreshInjectedStates(); },
    toggleView: toggleFavView,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
