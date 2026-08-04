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
    var state = window.PatentShareStore && window.PatentShareStore.getPersistenceState ? window.PatentShareStore.getPersistenceState() : null;
    var storage = state && state.mode === "indexeddb" ? "已保存到本机" : "临时内存草稿";
    return storage + " · " + (count ? "已加入 " + count + " 篇专利" : "尚未加入专利");
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

    var rename = makeElement("button", "share-secondary-action", "编辑项目名称");
    rename.type = "button";
    rename.dataset.shareAction = "rename-project";
    container.appendChild(rename);

    if (project.patents.length === 0) {
      var empty = makeElement("div", "share-empty-panel");
      empty.appendChild(makeElement("h4", "", "从已有查询开始"));
      empty.appendChild(makeElement("p", "", "先在「专利原文」中查询一篇专利，或在“材料来源”导入 CSV 表格；两种输入都会复制为独立分享快照。"));
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
    var importButton = makeElement("button", "share-secondary-action", "导入表格");
    importButton.type = "button";
    importButton.dataset.shareAction = "import-csv";
    container.appendChild(importButton);
    if (project.patents.length === 0) {
      var empty = makeElement("div", "share-empty-panel");
      empty.appendChild(makeElement("h4", "", "尚无材料来源"));
      empty.appendChild(makeElement("p", "", "可复制当前 PatentLens 专利原文结果，或导入 CSV/XLS/XLSX。系统会自动识别常见中英文列名，并将未映射列保留为自定义字段。"));
      var importEmpty = makeElement("button", "share-primary-action", "导入表格");
      importEmpty.type = "button";
      importEmpty.dataset.shareAction = "import-csv";
      empty.appendChild(importEmpty);
      container.appendChild(empty);
      return;
    }
    var list = makeElement("div", "share-source-list");
    project.patents.forEach(function (patent) {
      var card = makeElement("article", "share-source-card");
      var sourceCount = project.sources.filter(function (source) { return source.patentId === patent.id; }).length;
      card.appendChild(makeElement("span", "share-source-badge", patent.source && patent.source.type === "excel" ? "表格" : "GP"));
      var content = makeElement("div", "share-source-content");
      content.appendChild(makeElement("div", "share-source-title", patent.title || patent.patentNumber));
      content.appendChild(makeElement("div", "share-source-meta", patent.patentNumber + " · " + sourceCount + " 个来源"));
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

  function readableSource(field) {
    if (!field || !field.source) return "尚未提供来源";
    var labels = {
      manual: "人工确认",
      excel: "Excel/CSV",
      google_patents: "Google Patents",
      dossier: "审查档案",
      pdf_text: "PDF 文本层",
      ocr: "OCR",
    };
    return (labels[field.source] || field.source) + (field.reviewState === "conflict" ? " · 待确认冲突" : "");
  }

  function startSpreadsheetImport() {
    if (window.PatentShareStore.getPersistenceState().mode === "loading") {
      setNotice("正在恢复本机分享项目，请稍候再导入文件。", true);
      render();
      return;
    }
    var input = byId("share-spreadsheet-input");
    if (!input) return;
    input.value = "";
    input.click();
  }

  function finishSpreadsheetImport(plan) {
    if (!plan.ok) { setNotice(plan.message || "表格导入失败。", true); render(); return; }
    var result = window.PatentShareStore.importPatents(plan.records);
    var message = "表格已处理：新增 " + result.added + " 篇，合并 " + result.merged + " 篇";
    if (plan.skippedRows.length) message += "，跳过 " + plan.skippedRows.length + " 行（缺少专利号）";
    if (plan.unmappedHeaders.length) message += "；保留 " + plan.unmappedHeaders.length + " 个未映射列";
    if (result.conflicts) message += "；发现 " + result.conflicts + " 个待确认冲突";
    setNotice(message + "。", false);
    activeView = result.conflicts ? "review" : "sources";
    render();
  }

  function importSpreadsheetFile(file) {
    var importer = window.PatentShareSpreadsheetImport;
    if (!importer) return;
    var validation = importer.validateFile(file);
    if (!validation.ok) {
      setNotice(validation.message, true);
      render();
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () {
      setNotice("无法读取表格文件。", true);
      render();
    };
    reader.onload = function () {
      if (/\.csv$/i.test(file.name || "")) {
        try { finishSpreadsheetImport(importer.buildRecords(String(reader.result || ""), file.name)); }
        catch (error) { setNotice(error.message || "CSV 解析失败。", true); render(); }
        return;
      }
      var bridge = window.electronAPI && window.electronAPI.parseShareSpreadsheet;
      if (!bridge) { setNotice("当前环境不支持 Excel 解析，请使用桌面版或导入 CSV。", true); render(); return; }
      bridge(reader.result).then(function (workbook) {
        var sheets = workbook && workbook.sheets ? workbook.sheets : [];
        if (!sheets.length) { setNotice("Excel 文件不包含可导入的工作表。", true); render(); return; }
        var selected = sheets[0];
        if (sheets.length > 1) {
          var options = sheets.map(function (sheet, index) { return (index + 1) + ". " + sheet.name; }).join("\n");
          var answer = window.prompt("请选择要导入的工作表：\n" + options, "1");
          if (answer == null) return;
          var index = Number(answer) - 1;
          if (!Number.isInteger(index) || index < 0 || index >= sheets.length) { setNotice("工作表选择无效。", true); render(); return; }
          selected = sheets[index];
        }
        finishSpreadsheetImport(importer.buildRecordsFromRows(selected.rows, file.name, "Excel", selected.name));
      }).catch(function (error) {
        setNotice(error && error.message ? error.message : "Excel 解析失败。", true);
        render();
      });
    };
    if (/\.csv$/i.test(file.name || "")) reader.readAsText(file, "UTF-8");
    else reader.readAsArrayBuffer(file);
  }

  function renderReview(container, project) {
    addHeading(container, viewMeta.review);
    addNotice(container);
    if (project.patents.length === 0) {
      var empty = makeElement("div", "share-empty-panel");
      empty.appendChild(makeElement("h4", "", "尚无待审核专利"));
      empty.appendChild(makeElement("p", "", "先在“材料来源”加入专利快照；后续 Excel、PDF 与 OCR 导入也会在这里统一处理字段来源和冲突。"));
      container.appendChild(empty);
      return;
    }
    var fields = [
      ["title", "标题"],
      ["abstract", "摘要"],
      ["applicationDate", "申请日"],
      ["publicationDate", "公开日"],
      ["priorityDate", "优先权日"],
      ["assignees", "申请人"],
      ["inventors", "发明人"],
    ];
    project.patents.forEach(function (patent) {
      var card = makeElement("article", "share-review-card");
      card.appendChild(makeElement("h4", "", patent.patentNumber + " · " + (patent.title || "未提供标题")));
      var table = makeElement("div", "share-review-fields");
      fields.forEach(function (definition) {
        var fieldName = definition[0];
        var field = patent.fields && patent.fields[fieldName];
        var row = makeElement("div", "share-review-field");
        row.appendChild(makeElement("span", "share-review-field-label", definition[1]));
        var value = makeElement("div", "share-review-field-value", field && field.value ? field.value : "来源未提供");
        row.appendChild(value);
        row.appendChild(makeElement("span", "share-review-field-source", readableSource(field)));
        var edit = makeElement("button", "share-field-edit", "人工确认");
        edit.type = "button";
        edit.dataset.shareAction = "edit-field";
        edit.dataset.patentId = patent.id;
        edit.dataset.fieldName = fieldName;
        edit.dataset.fieldLabel = definition[1];
        edit.dataset.fieldValue = field && field.value ? field.value : "";
        row.appendChild(edit);
        table.appendChild(row);
      });
      card.appendChild(table);
      container.appendChild(card);
    });
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
    else if (activeView === "review") renderReview(container, project);
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
    if (store && store.getPersistenceState && store.getPersistenceState().mode === "loading") {
      setNotice("正在恢复本机分享项目，请稍候再加入材料。", true);
      render();
      return;
    }
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
    if (window.PatentShareStore && window.PatentShareStore.getPersistenceState && window.PatentShareStore.getPersistenceState().mode === "loading") {
      setNotice("正在恢复本机分享项目，请稍候再新建项目。", true);
      render();
      return;
    }
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
    var spreadsheetInput = byId("share-spreadsheet-input");
    if (spreadsheetInput) spreadsheetInput.addEventListener("change", function () {
      if (spreadsheetInput.files && spreadsheetInput.files[0]) importSpreadsheetFile(spreadsheetInput.files[0]);
    });
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
      if (action.dataset.shareAction === "import-csv") startSpreadsheetImport();
      if (action.dataset.shareAction === "rename-project") {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        var current = currentProject();
        var nextName = window.prompt("请输入分享项目名称", current && current.name ? current.name : "");
        if (nextName == null) return;
        if (!window.PatentShareStore.renameProject(nextName)) {
          setNotice("项目名称不能为空。", true);
          render();
        }
      }
      if (action.dataset.shareAction === "edit-field" && action.dataset.patentId && action.dataset.fieldName) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        var nextValue = window.prompt("人工确认：" + (action.dataset.fieldLabel || action.dataset.fieldName), action.dataset.fieldValue || "");
        if (nextValue == null) return;
        if (!window.PatentShareStore.updatePatentField(action.dataset.patentId, action.dataset.fieldName, nextValue)) {
          setNotice("字段值不能为空，请重新输入。", true);
          render();
        } else {
          setNotice("已保存人工确认值，并保留为独立的项目快照。", false);
        }
      }
      if (action.dataset.shareAction === "remove-patent" && action.dataset.patentId) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
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
    // 壳层必须立即可打开；数据写操作在恢复完成前会被明确拦截，避免用户首击竞态。
    bind();
    updateProjectStatus();
    window.PatentShareStore.initialize().then(function () {
      if (window.PatentShareStore.getPersistenceState().mode === "memory") {
        setNotice("当前环境无法使用 IndexedDB，分享项目仅会保留到本次应用会话结束。", true);
      }
      updateProjectStatus();
      if (workspaceOpen) render();
    });
  }

  window.PatentShareWorkspace = {
    open: openWorkspace,
    close: closeWorkspace,
    isOpen: function () { return workspaceOpen; },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
