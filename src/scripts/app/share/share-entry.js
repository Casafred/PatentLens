/*!
 * PatentLens - 专利分享工作台入口和壳层
 *
 * 工作台独立于 searchMode。打开时仅记录和隐藏旧视图，关闭后原样恢复；
 * 不清理或回写 dossier、GP、OCR 和历史缓存。
 */
(function () {
  "use strict";

  var SECTION_SELECTORS = [
    "#batch-results-section",
    "#comparison-section",
    "#patent-detail-section",
    "#result-section",
    "#extract-mode-section",
  ];
  var workspaceOpen = false;
  var activeView = "overview";
  var priorVisibility = [];
  var priorHomeMode = false;
  var notice = null;

  var viewMeta = {
    overview: { title: "项目概览", description: "围绕一个可分享的专利项目管理材料、模块和输出。" },
    sources: { title: "材料来源", description: "从当前查询、审查档案、PDF 和表格逐步汇集可追溯的专利材料。" },
    review: { title: "数据审核", description: "后续在这里确认字段冲突、来源优先级和人工修订。" },
    modules: { title: "分享模块", description: "后续在这里应用预设、调整模块，并为单篇专利设置覆盖规则。" },
    insights: { title: "研发洞察", description: "后续在这里生成并审核技术要素、参数、验证证据和待验证问题。" },
    preview: { title: "预览", description: "后续在隔离 iframe 中预览离线分享页面。" },
    export: { title: "导出", description: "后续在这里进行敏感信息扫描、资源策略选择和 HTML 保存。" },
  };

  function byId(id) { return document.getElementById(id); }

  function makeElement(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function currentProject() {
    return window.PatentShareStore ? window.PatentShareStore.getSnapshot() : null;
  }

  function projectStatusText(project) {
    var count = project && project.patents ? project.patents.length : 0;
    return "本地草稿 · " + (count ? "已加入 " + count + " 篇专利" : "尚未加入专利");
  }

  function updateProjectStatus() {
    var status = byId("share-project-status");
    if (status) status.textContent = projectStatusText(currentProject());
  }

  function setNotice(message, isError) {
    notice = message ? { message: message, isError: !!isError } : null;
  }

  function addHeading(container, meta, actionLabel, actionName) {
    var heading = makeElement("div", "share-view-heading");
    var copy = document.createElement("div");
    copy.appendChild(makeElement("h3", "", meta.title));
    copy.appendChild(makeElement("p", "", meta.description));
    heading.appendChild(copy);
    if (actionLabel) {
      var action = makeElement("button", "share-primary-action", actionLabel);
      action.type = "button";
      action.dataset.shareAction = actionName;
      heading.appendChild(action);
    }
    container.appendChild(heading);
  }

  function addNotice(container) {
    if (!notice) return;
    var el = makeElement("div", "share-inline-notice" + (notice.isError ? " error" : ""), notice.message);
    container.appendChild(el);
  }

  function renderOverview(container, project) {
    addHeading(container, viewMeta.overview, "加入当前专利", "add-current");
    addNotice(container);
    var grid = makeElement("div", "share-overview-grid");
    var cards = [
      ["项目名称", project.name || "未命名分享项目"],
      ["已加入专利", String(project.patents.length) + " 篇"],
      ["已记录来源", String(project.sources.length) + " 项"],
    ];
    cards.forEach(function (item) {
      var card = makeElement("div", "share-overview-card");
      card.appendChild(makeElement("span", "share-overview-label", item[0]));
      card.appendChild(makeElement("strong", "share-overview-value", item[1]));
      grid.appendChild(card);
    });
    container.appendChild(grid);

    if (project.patents.length === 0) {
      var empty = makeElement("div", "share-empty-panel");
      empty.appendChild(makeElement("h4", "", "从已有查询开始"));
      empty.appendChild(makeElement("p", "", "先在「专利原文」中查询一篇专利，再回到这里将当前结果复制为分享项目的第一份快照。后续将支持 PDF 与 Excel 导入。"));
      var add = makeElement("button", "share-primary-action", "加入当前专利");
      add.type = "button";
      add.dataset.shareAction = "add-current";
      empty.appendChild(add);
      container.appendChild(empty);
    }
  }

  function renderSources(container, project) {
    addHeading(container, viewMeta.sources, "加入当前专利", "add-current");
    addNotice(container);
    if (project.patents.length === 0) {
      var empty = makeElement("div", "share-empty-panel");
      empty.appendChild(makeElement("h4", "", "尚无材料来源"));
      empty.appendChild(makeElement("p", "", "当前切片已支持复制当前 PatentLens 专利原文结果。PDF OCR 和 Excel/CSV 字段映射将在材料来源页面继续接入。"));
      container.appendChild(empty);
      return;
    }
    var list = makeElement("div", "share-source-list");
    project.patents.forEach(function (patent) {
      var card = makeElement("article", "share-source-card");
      card.appendChild(makeElement("span", "share-source-badge", "GP"));
      var content = makeElement("div", "share-source-content");
      content.appendChild(makeElement("div", "share-source-title", patent.title || patent.patentNumber));
      content.appendChild(makeElement("div", "share-source-meta", patent.patentNumber + " · " + (patent.source && patent.source.label ? patent.source.label : "当前快照")));
      card.appendChild(content);
      var remove = makeElement("button", "share-source-remove", "移除");
      remove.type = "button";
      remove.dataset.shareAction = "remove-patent";
      remove.dataset.patentId = patent.id;
      card.appendChild(remove);
      list.appendChild(card);
    });
    container.appendChild(list);
  }

  function renderPlaceholder(container, viewId, project) {
    addHeading(container, viewMeta[viewId]);
    var panel = makeElement("div", "share-placeholder-panel");
    panel.appendChild(makeElement("h4", "", "此区域已预留，等待后续功能接入"));
    var prerequisite = project.patents.length ? "当前项目已有 " + project.patents.length + " 篇专利，可在后续切片直接接入这里。" : "请先在「材料来源」加入至少一篇专利；完成后这里会显示对应的操作。";
    panel.appendChild(makeElement("p", "", prerequisite));
    container.appendChild(panel);
  }

  function render() {
    if (!workspaceOpen) return;
    var container = byId("share-workspace-view");
    var project = currentProject();
    if (!container || !project) return;
    container.textContent = "";
    if (activeView === "overview") renderOverview(container, project);
    else if (activeView === "sources") renderSources(container, project);
    else renderPlaceholder(container, activeView, project);

    var navItems = document.querySelectorAll(".share-workspace-nav-item");
    for (var i = 0; i < navItems.length; i++) {
      navItems[i].classList.toggle("active", navItems[i].dataset.shareView === activeView);
    }
    updateProjectStatus();
  }

  function rememberAndHideLegacyViews() {
    priorVisibility = SECTION_SELECTORS.map(function (selector) {
      var section = document.querySelector(selector);
      return { selector: selector, wasHidden: !section || section.classList.contains("hidden") };
    });
    priorVisibility.forEach(function (item) {
      var section = document.querySelector(item.selector);
      if (section) section.classList.add("hidden");
    });
  }

  function restoreLegacyViews() {
    priorVisibility.forEach(function (item) {
      var section = document.querySelector(item.selector);
      if (section) section.classList.toggle("hidden", item.wasHidden);
    });
    priorVisibility = [];
  }

  function openWorkspace() {
    if (workspaceOpen) return;
    var section = byId("share-workspace-section");
    var app = byId("app");
    if (!section || !app) return;
    priorHomeMode = app.classList.contains("home-mode");
    rememberAndHideLegacyViews();
    app.classList.remove("home-mode");
    app.classList.add("share-workspace-active");
    section.classList.remove("hidden");
    var entry = byId("share-workspace-entry");
    if (entry) entry.classList.add("active");
    workspaceOpen = true;
    notice = null;
    render();
  }

  function closeWorkspace() {
    if (!workspaceOpen) return;
    var section = byId("share-workspace-section");
    var app = byId("app");
    if (section) section.classList.add("hidden");
    if (app) {
      app.classList.remove("share-workspace-active");
      app.classList.toggle("home-mode", priorHomeMode);
    }
    var entry = byId("share-workspace-entry");
    if (entry) entry.classList.remove("active");
    restoreLegacyViews();
    workspaceOpen = false;
    notice = null;
  }

  function addCurrentPatent() {
    var adapter = window.PatentShareSources;
    var store = window.PatentShareStore;
    var record = adapter && adapter.currentPatentSnapshot ? adapter.currentPatentSnapshot() : null;
    if (!record) {
      setNotice("未检测到当前专利原文。请先切换到「专利原文」查询并打开一篇专利，再回到分享工作台。", true);
      render();
      return;
    }
    var result = store.addPatent(record);
    if (!result.ok && result.reason === "duplicate") {
      setNotice("该专利已在当前分享项目中，无需重复加入。", true);
    } else if (!result.ok) {
      setNotice("当前专利数据不完整，暂时无法加入分享项目。", true);
    } else {
      setNotice("已复制当前专利原文快照。后续可在「数据审核」中确认字段和来源。", false);
      activeView = "sources";
    }
    render();
  }

  function newProject() {
    var project = currentProject();
    if (project && project.patents.length > 0 && !window.confirm("新建项目会清空当前分享工作台中的材料草稿，是否继续？")) return;
    window.PatentShareStore.newProject();
    activeView = "overview";
    setNotice("已创建新的空分享项目。", false);
    render();
  }

  function bind() {
    var entry = byId("share-workspace-entry");
    if (entry) entry.addEventListener("click", openWorkspace);
    var close = byId("share-close-workspace-btn");
    if (close) close.addEventListener("click", closeWorkspace);
    var create = byId("share-new-project-btn");
    if (create) create.addEventListener("click", newProject);
    var nav = byId("share-workspace-nav");
    if (nav) nav.addEventListener("click", function (event) {
      var button = event.target.closest ? event.target.closest("[data-share-view]") : null;
      if (!button) return;
      activeView = button.dataset.shareView || "overview";
      notice = null;
      render();
    });
    var view = byId("share-workspace-view");
    if (view) view.addEventListener("click", function (event) {
      var action = event.target.closest ? event.target.closest("[data-share-action]") : null;
      if (!action) return;
      if (action.dataset.shareAction === "add-current") addCurrentPatent();
      if (action.dataset.shareAction === "remove-patent" && action.dataset.patentId) {
        window.PatentShareStore.removePatent(action.dataset.patentId);
        setNotice("已从当前项目移除该专利快照。", false);
        render();
      }
    });
    document.addEventListener("keydown", function (event) {
      if (workspaceOpen && event.key === "Escape") closeWorkspace();
    });
    if (window.PatentShareStore) {
      window.PatentShareStore.onChange(function () {
        if (workspaceOpen) render();
      });
    }
  }

  function init() {
    if (!window.PatentShareStore || !window.PatentShareSources) return;
    window.PatentShareStore.ensureProject();
    bind();
  }

  window.PatentShareWorkspace = {
    open: openWorkspace,
    close: closeWorkspace,
    isOpen: function () { return workspaceOpen; },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
