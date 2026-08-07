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
  var aiRunning = false;
  var reviewPatentIndex = 0;

  // 批量 AI 处理状态：在一次输入多篇专利后，统一选定字段类型并发处理。
  // 状态保存在模块作用域（不持久化到 store），跨 render 保持。
  // fields: { summary, elements, embodiments, processed } 用户勾选的字段类型
  // concurrency: 1-20，默认 3（上限 20，可按平台情况调整）
  // tasks: 任务队列 [{ patentId, fieldId, type, label, status, error }]
  // status: pending | running | done | failed | skipped
  // cancelled: 取消标志，正在执行的让其完成，未开始标记 skipped
  var batchState = null;

  var viewMeta = {
    overview: { title: "项目设定", description: "明确分享对象、目的、技术关注点和内部使用边界。" },
    sources: { title: "专利与材料", description: "从当前查询、审查档案、PDF 和表格汇集可追溯的专利材料。" },
    review: { title: "内容加工与审核", description: "核对来源字段、制作分享字段、标注关键原文，并确认可对外呈现的内容。" },
    insights: { title: "组合判断", description: "生成并审核单篇技术解读和多专利技术路线对比；所有 AI 内容先作为草稿。" },
    prompts: { title: "提示词与原文范围", description: "集中管理组合判断与加工字段的提示词，以及 AI 分析纳入的原文范围。" },
    modules: { title: "编排与展示", description: "选择研发分享中真正需要展示的内容，并调整加工模块在报告中的顺序。" },
    preview: { title: "预览", description: "在隔离 iframe 中检查研发团队最终会看到的离线页面。" },
    export: { title: "发布", description: "完成审核和敏感信息检查后保存单文件 HTML。" },
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
    var aiCount = 0;
    if (project && project.patents) {
      project.patents.forEach(function(p) { if (p.aiAnalysis && (p.aiAnalysis.summary || p.aiAnalysis.elements)) aiCount++; });
      if (project.aiAnalysis && project.aiAnalysis.comparison) aiCount++;
    }
    var pending = 0;
    if (project && project.patents) {
      project.patents.forEach(function (p) {
        Object.keys(p.aiAnalysis || {}).forEach(function (key) { if (p.aiAnalysis[key] && p.aiAnalysis[key].reviewState !== "accepted") pending++; });
        (p.processedFields || []).forEach(function (field) { if (field.source === "ai" && field.value && field.reviewState !== "accepted") pending++; });
      });
      Object.keys(project.aiAnalysis || {}).forEach(function (key) { if (project.aiAnalysis[key] && project.aiAnalysis[key].reviewState !== "accepted") pending++; });
    }
    var aiText = aiCount ? " · AI草稿 " + aiCount + " 项" : "";
    var reviewText = pending ? " · 待审核 " + pending + " 项" : "";
    return storage + " · " + (count ? "已加入 " + count + " 篇专利" : "尚未加入专利") + aiText + reviewText;
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
      action.disabled = aiRunning;
      heading.appendChild(action);
    }
    container.appendChild(heading);
  }

  function addNotice(container) {
    if (!notice) return;
    var el = makeElement("div", "share-inline-notice" + (notice.isError ? " error" : ""), notice.message);
    container.appendChild(el);
  }

  // AI 分析纳入的原文范围：4 个开关，项目级与字段级共用同一组标签。
  var SCOPE_LABELS = [
    { key: "abstract", label: "摘要", hint: "专利摘要文本" },
    { key: "claims", label: "权利要求", hint: "完整权利要求文本" },
    { key: "description", label: "说明书", hint: "说明书 / 具体实施方式全文" },
    { key: "annotations", label: "IPR 标注", hint: "在「内容加工与审核」中标注的关键段落" },
  ];

  // 构建原文范围勾选面板。opts.actionName 决定 onChange 派发到哪个 action；
  // opts.inheritLabel 用于字段级「跟随项目默认」选项。
  function buildContextScopePanel(scope, opts) {
    opts = opts || {};
    var panel = makeElement("div", "share-scope-panel");
    // 继承态必须在归一化前判断：字段级 scope === null 表示「跟随项目默认」。
    var isInherit = opts.allowInherit && scope === null;
    // 显示用的范围值：继承态回退到项目级默认（只读预览继承到的勾选范围）；
    // 字段级自定义态用字段自身范围；项目级直接用传入范围。
    var s;
    if (scope && typeof scope === "object") {
      s = scope;
    } else if (isInherit) {
      s = (window.PatentShareStore && window.PatentShareStore.getAIContextScope) ? window.PatentShareStore.getAIContextScope() : { abstract: true, claims: true, description: true, annotations: true };
    } else {
      s = {};
    }
    if (opts.allowInherit) {
      var inheritRow = makeElement("label", "share-scope-row" + (isInherit ? " active" : ""));
      var inheritCb = document.createElement("input");
      inheritCb.type = "radio";
      inheritCb.name = opts.radioName || "share-scope-inherit";
      inheritCb.checked = isInherit;
      inheritCb.dataset.shareAction = opts.inheritAction || "set-field-context-scope";
      if (opts.fieldId) inheritCb.dataset.fieldId = opts.fieldId;
      if (opts.patentId) inheritCb.dataset.patentId = opts.patentId;
      inheritCb.dataset.scopeValue = "inherit";
      inheritRow.appendChild(inheritCb);
      inheritRow.appendChild(makeElement("span", "share-scope-label", opts.inheritLabel || "跟随项目默认"));
      panel.appendChild(inheritRow);
    }
    var customRow = makeElement("div", "share-scope-custom");
    SCOPE_LABELS.forEach(function (item) {
      var row = makeElement("label", "share-scope-row" + (s[item.key] ? " active" : ""));
      var cb = document.createElement("input");
      // 4 个原文范围始终用 checkbox 支持多选；与「跟随项目默认」单选解耦。
      // 继承态下保持可点击：用户勾选任意一项即自动切换到自定义范围。
      cb.type = "checkbox";
      cb.checked = s[item.key] !== false;
      cb.dataset.shareAction = opts.actionName || "toggle-context-scope";
      cb.dataset.scopeKey = item.key;
      if (opts.fieldId) cb.dataset.fieldId = opts.fieldId;
      if (opts.patentId) cb.dataset.patentId = opts.patentId;
      row.appendChild(cb);
      var labelBox = makeElement("span", "share-scope-label", item.label);
      row.appendChild(labelBox);
      row.appendChild(makeElement("span", "share-scope-hint", item.hint));
      customRow.appendChild(row);
    });
    panel.appendChild(customRow);
    return panel;
  }

  // 构建单条提示词行：显示当前是否被覆盖、编辑与重置按钮。
  function buildPromptRow(item) {
    var row = makeElement("div", "share-prompt-row");
    var head = makeElement("div", "share-prompt-head");
    var labelText = item.label;
    if (item.isCustom) labelText += " (自定义)";
    head.appendChild(makeElement("span", "share-prompt-label", labelText));
    if (item.description) head.appendChild(makeElement("span", "share-prompt-desc", item.description));
    var badgeText = item.isCustom ? "自定义" : (item.modified ? "已自定义" : "默认");
    var badge = makeElement("span", "share-prompt-badge" + (item.modified || item.isCustom ? " modified" : ""), badgeText);
    head.appendChild(badge);
    row.appendChild(head);
    var preview = makeElement("div", "share-prompt-preview");
    preview.textContent = (item.currentValue || "").slice(0, 120) + ((item.currentValue || "").length > 120 ? "…" : "");
    row.appendChild(preview);
    var actions = makeElement("div", "share-prompt-actions");
    var edit = makeElement("button", "share-field-edit", "编辑提示词");
    edit.type = "button";
    edit.dataset.shareAction = item.editAction;
    if (item.promptKey) edit.dataset.promptKey = item.promptKey;
    if (item.presetLabel) edit.dataset.presetLabel = item.presetLabel;
    if (item.presetType) edit.dataset.presetType = item.presetType;
    edit.disabled = aiRunning;
    actions.appendChild(edit);
    if (item.isCustom) {
      var del = makeElement("button", "share-field-remove", "删除");
      del.type = "button";
      del.dataset.shareAction = "delete-custom-preset";
      del.dataset.presetLabel = item.presetLabel || item.label;
      del.disabled = aiRunning;
      actions.appendChild(del);
    } else if (item.modified) {
      var reset = makeElement("button", "share-field-remove", "恢复默认");
      reset.type = "button";
      reset.dataset.shareAction = item.resetAction;
      if (item.promptKey) reset.dataset.promptKey = item.promptKey;
      if (item.presetLabel) reset.dataset.presetLabel = item.presetLabel;
      reset.disabled = aiRunning;
      actions.appendChild(reset);
    }
    row.appendChild(actions);
    return row;
  }

  // 构建提示词与原文范围管理面板（编排与展示视图顶部）。
  function buildPromptManagementPanel(project) {
    var panel = makeElement("section", "share-prompt-panel");
    panel.appendChild(makeElement("h4", "", "提示词管理"));
    panel.appendChild(makeElement("p", "share-module-hint", "组合判断的 4 类内置提示词与加工字段的预设提示词均在此集中管理；修改后立即生效，影响后续 AI 草稿生成。您也可以新增自定义预置模板，快速添加到「内容加工与审核」中。"));

    // 组合判断 4 类内置提示词
    var aiGroup = makeElement("div", "share-prompt-group");
    aiGroup.appendChild(makeElement("div", "share-prompt-group-title", "组合判断（技术解读 / 技术要素 / 实施例与验证 / 多专利对比）"));
    var ai = window.PatentShareAI;
    var overrides = window.PatentShareStore && window.PatentShareStore.getPromptOverrides ? window.PatentShareStore.getPromptOverrides() : { ai: {}, fieldPresets: {} };
    var aiMeta = ai && ai.promptMeta ? ai.promptMeta() : {};
    var aiDefaults = ai && ai.getPromptDefaults ? ai.getPromptDefaults() : {};
    ["summary", "elements", "embodiments", "comparison"].forEach(function (key) {
      var meta = aiMeta[key] || { label: key, description: "" };
      var current = (overrides.ai && overrides.ai[key]) || aiDefaults[key] || "";
      var modified = !!(overrides.ai && overrides.ai[key]);
      aiGroup.appendChild(buildPromptRow({
        label: meta.label, description: meta.description,
        currentValue: current, modified: modified, isCustom: false,
        editAction: "edit-ai-prompt", promptKey: key,
        resetAction: "reset-ai-prompt",
      }));
    });
    panel.appendChild(aiGroup);

    // 加工字段预设提示词（内置 + 自定义）
    var fieldGroup = makeElement("div", "share-prompt-group");
    fieldGroup.appendChild(makeElement("div", "share-prompt-group-title", "加工字段预设（应用于「内容加工与审核」中的快速添加字段）"));
    var presets = window.PatentShareModules && window.PatentShareModules.fieldPresets ? window.PatentShareModules.fieldPresets() : [];
    presets.forEach(function (preset) {
      fieldGroup.appendChild(buildPromptRow({
        label: preset.label, description: preset.type === "list" ? "列表型" : "文本型",
        currentValue: preset.prompt, modified: !!preset.modified, isCustom: !!preset.isCustom,
        editAction: "edit-field-preset-prompt", presetLabel: preset.label, presetType: preset.type,
        resetAction: "reset-field-preset-prompt",
      }));
    });
    // 新增自定义模板按钮
    var addPresetBtn = makeElement("button", "share-add-preset-btn", "+ 新增自定义预置模板");
    addPresetBtn.type = "button";
    addPresetBtn.dataset.shareAction = "add-custom-preset";
    addPresetBtn.disabled = aiRunning;
    fieldGroup.appendChild(addPresetBtn);
    panel.appendChild(fieldGroup);

    // 项目级 AI 原文范围
    var scopeGroup = makeElement("div", "share-prompt-group");
    scopeGroup.appendChild(makeElement("div", "share-prompt-group-title", "AI 分析纳入的原文范围（项目级默认）"));
    scopeGroup.appendChild(makeElement("p", "share-module-hint", "勾选后，所有组合判断与加工字段的 AI 抽取都会基于此处勾选的原文内容生成；字段级可在「内容加工与审核」中单独覆盖。"));
    var projectScope = window.PatentShareStore && window.PatentShareStore.getAIContextScope ? window.PatentShareStore.getAIContextScope() : { abstract: true, claims: true, description: true, annotations: true };
    scopeGroup.appendChild(buildContextScopePanel(projectScope, { actionName: "toggle-context-scope" }));
    panel.appendChild(scopeGroup);
    return panel;
  }

  function renderOverview(container, project) {
    addHeading(container, viewMeta.overview, "加入当前专利", "add-current");
    addNotice(container);
    var grid = makeElement("div", "share-overview-grid");
    var aiCount = 0;
    project.patents.forEach(function(p) { if (p.aiAnalysis && (p.aiAnalysis.summary || p.aiAnalysis.elements)) aiCount++; });
    var hasComp = project.aiAnalysis && project.aiAnalysis.comparison;
    var cards = [
      ["项目名称", project.name || "未命名分享项目"],
      ["已加入专利", String(project.patents.length) + " 篇"],
      ["已记录来源", String(project.sources.length) + " 项"],
      ["AI分析进度", String(aiCount + (hasComp ? 1 : 0)) + " 项完成"],
    ];
    cards.forEach(function (item) {
      var card = makeElement("div", "share-overview-card");
      card.appendChild(makeElement("span", "share-overview-label", item[0]));
      card.appendChild(makeElement("strong", "share-overview-value", item[1]));
      grid.appendChild(card);
    });
    container.appendChild(grid);

    var actions = makeElement("div", "share-overview-actions");
    var rename = makeElement("button", "share-secondary-action", "编辑项目名称");
    rename.type = "button";
    rename.dataset.shareAction = "rename-project";
    rename.disabled = aiRunning;
    actions.appendChild(rename);
    container.appendChild(actions);

    var brief = project.brief || {};
    var briefPanel = makeElement("section", "share-project-brief");
    briefPanel.appendChild(makeElement("h4", "", "分享设定"));
    briefPanel.appendChild(makeElement("p", "share-module-hint", "这些设定会连同专利材料一起传给 AI，用于约束生成内容的对象和重点。"));
    var briefGrid = makeElement("div", "share-brief-grid");
    [
      ["audience", "分享对象", brief.audience || "研发团队", "例如：电池材料研发组"],
      ["purpose", "分享目的", brief.purpose || "技术分享", "例如：技术预研评审"],
      ["focus", "技术关注点", brief.focus || "", "例如：界面材料、循环寿命、工艺边界"],
      ["confidentiality", "使用边界", brief.confidentiality || "内部使用", "例如：内部使用，不构成法律意见"],
    ].forEach(function (item) {
      var label = makeElement("label", "share-research-label", item[1]);
      var input = document.createElement(item[0] === "focus" ? "textarea" : "input");
      input.className = "share-research-input";
      input.id = "share-brief-" + item[0];
      input.value = item[2];
      input.placeholder = item[3];
      if (item[0] === "focus") { input.rows = 2; input.maxLength = 2000; }
      else input.maxLength = 300;
      label.appendChild(input);
      briefGrid.appendChild(label);
    });
    briefPanel.appendChild(briefGrid);
    var saveBrief = makeElement("button", "share-secondary-action", "保存分享设定");
    saveBrief.type = "button";
    saveBrief.dataset.shareAction = "save-project-brief";
    briefPanel.appendChild(saveBrief);
    container.appendChild(briefPanel);

    renderProjectList(container, project);

    if (project.patents.length === 0) {
      var empty = makeElement("div", "share-empty-panel");
      empty.appendChild(makeElement("h4", "", "从已有查询开始"));
      empty.appendChild(makeElement("p", "", "先在「专利原文」中查询一篇专利，或在'材料来源'导入 CSV/Excel 表格；两种输入都会复制为独立分享快照。"));
      var add = makeElement("button", "share-primary-action", "加入当前专利");
      add.type = "button";
      add.dataset.shareAction = "add-current";
      add.disabled = aiRunning;
      empty.appendChild(add);
      container.appendChild(empty);
    }
  }

  function renderProjectList(container, project) {
    var store = window.PatentShareStore;
    if (!store || !store.listProjects) return;
    var section = makeElement("section", "share-project-list-section");
    section.appendChild(makeElement("h4", "", "本机分享项目"));
    var list = makeElement("div", "share-project-list");
    list.appendChild(makeElement("p", "share-project-list-loading", "正在读取已保存项目..."));
    section.appendChild(list);
    container.appendChild(section);
    store.listProjects().then(function (items) {
      if (!workspaceOpen || activeView !== "overview" || !list.isConnected) return;
      list.textContent = "";
      if (!items.length) {
        list.appendChild(makeElement("p", "share-project-list-loading", "尚无其他已保存项目。"));
        return;
      }
      items.forEach(function (item) {
        var row = makeElement("article", "share-project-list-item");
        var copy = makeElement("div", "share-project-list-copy");
        copy.appendChild(makeElement("strong", "", item.name || "未命名分享项目"));
        copy.appendChild(makeElement("span", "", String(item.patentCount || 0) + " 篇专利 · 更新于 " + formatProjectTime(item.updatedAt)));
        row.appendChild(copy);
        var open = makeElement("button", "share-secondary-action", item.id === project.id ? "当前项目" : "打开");
        open.type = "button";
        open.disabled = item.id === project.id || aiRunning;
        open.dataset.shareAction = "open-project";
        open.dataset.projectId = item.id;
        row.appendChild(open);
        var del = makeElement("button", "share-source-remove", "删除");
        del.type = "button";
        del.disabled = aiRunning;
        del.dataset.shareAction = "delete-project";
        del.dataset.projectId = item.id;
        del.dataset.projectName = item.name || "未命名分享项目";
        row.appendChild(del);
        list.appendChild(row);
      });
    }).catch(function () {
      if (!list.isConnected) return;
      list.textContent = "";
      list.appendChild(makeElement("p", "share-project-list-loading", "无法读取历史项目，当前项目仍可继续使用。"));
    });
  }

  function formatProjectTime(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知时间";
    return date.toLocaleString();
  }

  function renderSources(container, project) {
    addHeading(container, viewMeta.sources, "加入当前专利", "add-current");
    addNotice(container);
    // —— 材料加入区：双列卡片（快速加入 / 批量导入），无专利时仍展示 ——
    var addArea = makeElement("div", "share-add-area");
    // 左列：按专利号搜索加入（含当前专利一键加入）
    var searchCard = makeElement("div", "share-add-card");
    var searchHead = makeElement("div", "share-add-card-head");
    searchHead.appendChild(makeElement("span", "share-add-card-icon", "#"));
    var searchTitleWrap = makeElement("div", "share-add-card-title-wrap");
    searchTitleWrap.appendChild(makeElement("h4", "", "按专利号搜索加入"));
    searchTitleWrap.appendChild(makeElement("p", "share-add-card-desc", "复用主应用 GP 查询，串行抓取原文与权利要求。每行一个，最多 10 篇。"));
    searchHead.appendChild(searchTitleWrap);
    searchCard.appendChild(searchHead);
    var searchInput = makeElement("textarea", "share-search-input");
    searchInput.id = "share-patent-search-input";
    searchInput.placeholder = "US12030161B2\nEP4252965A3\n...";
    searchInput.rows = 4;
    searchInput.disabled = aiRunning;
    searchInput.spellcheck = false;
    searchCard.appendChild(searchInput);
    var searchFoot = makeElement("div", "share-add-card-foot");
    var searchBtn = makeElement("button", "share-primary-action", "查询并加入");
    searchBtn.type = "button";
    searchBtn.dataset.shareAction = "search-add-patents";
    searchBtn.disabled = aiRunning;
    searchFoot.appendChild(searchBtn);
    var curBtn = makeElement("button", "share-secondary-action", "加入当前打开的专利");
    curBtn.type = "button";
    curBtn.dataset.shareAction = "add-current";
    curBtn.disabled = aiRunning;
    searchFoot.appendChild(curBtn);
    searchCard.appendChild(searchFoot);
    addArea.appendChild(searchCard);
    // 右列：批量文件导入
    var fileCard = makeElement("div", "share-add-card");
    var fileHead = makeElement("div", "share-add-card-head");
    fileHead.appendChild(makeElement("span", "share-add-card-icon", "F"));
    var fileTitleWrap = makeElement("div", "share-add-card-title-wrap");
    fileTitleWrap.appendChild(makeElement("h4", "", "批量文件导入"));
    fileTitleWrap.appendChild(makeElement("p", "share-add-card-desc", "支持 CSV/XLS/XLSX 自动识别中英文列名，或 PDF OCR 文本层。未映射列保留为自定义字段。"));
    fileHead.appendChild(fileTitleWrap);
    fileCard.appendChild(fileHead);
    var fileFoot = makeElement("div", "share-add-card-foot");
    var importButton = makeElement("button", "share-secondary-action", "导入 CSV/Excel");
    importButton.type = "button";
    importButton.dataset.shareAction = "import-csv";
    importButton.disabled = aiRunning;
    fileFoot.appendChild(importButton);
    var pdfButton = makeElement("button", "share-secondary-action", "导入 PDF OCR");
    pdfButton.type = "button";
    pdfButton.dataset.shareAction = "import-pdf";
    pdfButton.disabled = aiRunning;
    fileFoot.appendChild(pdfButton);
    fileCard.appendChild(fileFoot);
    addArea.appendChild(fileCard);
    container.appendChild(addArea);
    if (project.patents.length === 0) {
      var empty = makeElement("div", "share-empty-panel");
      empty.appendChild(makeElement("h4", "", "尚无材料来源"));
      empty.appendChild(makeElement("p", "", "可使用上方任一方式加入专利：按专利号搜索、加入当前打开的专利，或导入 CSV/Excel/PDF。系统会自动识别常见中英文列名，并将未映射列保留为自定义字段，同时导入说明书、权利要求引用、IPC分类等完整内容。"));
      container.appendChild(empty);
      return;
    }
    var list = makeElement("div", "share-source-list");
    project.patents.forEach(function (patent) {
      var card = makeElement("article", "share-source-card");
      var sourceCount = project.sources.filter(function (source) { return source.patentId === patent.id; }).length;
      var sourceType = patent.source && (patent.source.type === "excel" || patent.source.type === "csv") ? "表格" : (patent.source && patent.source.type === "pdf" ? "PDF" : "GP");
      card.appendChild(makeElement("span", "share-source-badge", sourceType));
      var content = makeElement("div", "share-source-content");
      content.appendChild(makeElement("div", "share-source-title", patent.title || patent.patentNumber));
      var metaParts = [patent.patentNumber];
      if (patent.classifications && patent.classifications.length) metaParts.push("IPC: " + patent.classifications.slice(0,2).join(", ") + (patent.classifications.length > 2 ? "..." : ""));
      if (patent.claims && patent.claims.length) metaParts.push(patent.claims.length + "项权利要求");
      if (patent.description) metaParts.push("有说明书");
      if (patent.aiAnalysis && patent.aiAnalysis.summary) metaParts.push("AI分析✓");
      metaParts.push(sourceCount + "个来源");
      content.appendChild(makeElement("div", "share-source-meta", metaParts.join(" · ")));
      card.appendChild(content);
      var actions = makeElement("div", "share-source-card-actions");
      var remove = makeElement("button", "share-source-remove", "移除");
      remove.type = "button";
      remove.dataset.shareAction = "remove-patent";
      remove.dataset.patentId = patent.id;
      remove.disabled = aiRunning;
      actions.appendChild(remove);
      card.appendChild(actions);
      list.appendChild(card);
    });
    container.appendChild(list);
  }

  function readableSource(field) {
    if (!field || !field.source) return "尚未提供来源";
    var labels = {
      manual: "人工确认",
      excel: "Excel/CSV",
      csv: "CSV",
      google_patents: "专利原文",
      dossier: "审查档案",
      pdf_text: "PDF 文本层",
      ocr: "OCR",
      ai: "AI生成",
    };
    return (labels[field.source] || field.source) + (field.reviewState === "conflict" ? " · 待确认冲突" : "");
  }

  // 按专利号搜索加入：复用主应用 fetchPatentWithRetry 抓取 GP 原文，转成分享快照后入库
  function searchAndAddPatents() {
    var store = window.PatentShareStore;
    var adapter = window.PatentShareSources;
    if (!store || !adapter || !adapter.snapshotFromGpData) return;
    if (store.getPersistenceState().mode === "loading") {
      setNotice("正在恢复本机分享项目，请稍候再搜索。", true);
      render();
      return;
    }
    var fetchFn = window.fetchPatentWithRetry;
    if (typeof fetchFn !== "function") {
      setNotice("当前环境不支持专利号搜索，请使用桌面版或在主应用查询后加入。", true);
      render();
      return;
    }
    var input = byId("share-patent-search-input");
    var raw = input ? input.value : "";
    var lines = String(raw || "").split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var numbers = [];
    lines.forEach(function (line) {
      var num = line.toUpperCase().replace(/[\s\/]/g, "");
      if (num && numbers.indexOf(num) < 0) numbers.push(num);
    });
    if (!numbers.length) {
      setNotice("请输入至少一个专利号。", true);
      render();
      return;
    }
    if (numbers.length > 10) {
      numbers = numbers.slice(0, 10);
      setNotice("已截取前 10 个专利号进行查询。", true);
    }
    aiRunning = true;
    var succeeded = 0, failed = 0, duplicated = 0;
    var i = 0;
    setNotice("开始查询 " + numbers.length + " 篇专利，请稍候...", false);
    render();
    function next() {
      if (i >= numbers.length) {
        aiRunning = false;
        var msg = "查询完成：成功加入 " + succeeded + " 篇";
        if (duplicated) msg += "，已存在 " + duplicated + " 篇";
        if (failed) msg += "，失败 " + failed + " 篇";
        setNotice(msg + "。", failed > 0);
        activeView = "sources";
        render();
        return;
      }
      var pn = numbers[i];
      i++;
      setNotice("正在查询第 " + i + "/" + numbers.length + " 篇：" + pn, false);
      render();
      fetchFn(pn, 2).then(function (json) {
        var data = json && json.data;
        if (!data || data.data_source === "Espacenet") {
          failed++;
          setNotice(pn + " 未查询到原文（可能需降级到 Espacenet，请到主应用查询）。", true);
        } else {
          var record = adapter.snapshotFromGpData(data);
          if (!record) {
            failed++;
          } else {
            var result = store.addPatent(record);
            if (result.ok) {
              succeeded++;
              // 异步抓取附图
              if (record._pendingDrawings && adapter.hydrateSnapshotDrawings) {
                adapter.hydrateSnapshotDrawings(result.record, store).catch(function () {});
              }
            }
            else if (result.reason === "duplicate") duplicated++;
            else failed++;
          }
        }
        render();
      }).catch(function () {
        failed++;
        setNotice(pn + " 查询失败。", true);
        render();
      }).then(function () {
        if (i < numbers.length) {
          setTimeout(next, 1200);
        } else {
          next();
        }
      });
    }
    next();
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
          PatentShareUI.prompt("请选择要导入的工作表", "1", options).then(function(answer) {
            if (answer == null) return;
            var index = Number(answer) - 1;
            if (!Number.isInteger(index) || index < 0 || index >= sheets.length) { setNotice("工作表选择无效。", true); render(); return; }
            selected = sheets[index];
            finishSpreadsheetImport(importer.buildRecordsFromRows(selected.rows, file.name, "Excel", selected.name));
          });
          return;
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

  function startPdfImport() {
    if (window.PatentShareStore.getPersistenceState().mode === "loading") {
      setNotice("正在恢复本机分享项目，请稍候再导入 PDF。", true);
      render();
      return;
    }
    var input = byId("share-pdf-input");
    if (!input) return;
    input.value = "";
    input.click();
  }

  function importPdfFile(file) {
    if (!file || !/\.pdf$/i.test(file.name || "") || file.size > 20 * 1024 * 1024) {
      setNotice("仅支持不超过 20 MB 的 PDF 文件。", true);
      render();
      return;
    }
    var project = currentProject();
    if (!project || !project.patents || !project.patents.length) {
      PatentShareUI.prompt("未检测到已有专利。是否从 PDF 创建新专利？\n请输入专利号（可后续修改）：", "").then(function(number) {
        if (number == null) { render(); return; }
        number = number.trim();
        if (!number) { setNotice("专利号不能为空。", true); render(); return; }
        var result = window.PatentShareStore.addPatent({
          id: "patent_pdf_" + Date.now().toString(36),
          patentNumber: number,
          title: file.name.replace(/\.pdf$/i, ""),
          source: { type: "pdf_import", label: "PDF 导入", capturedAt: new Date().toISOString() },
        });
        if (!result.ok) {
          setNotice("创建专利失败：" + (result.reason || "未知错误"), true);
          render();
          return;
        }
        doPdfImport(result.record, file);
      });
      return;
    }
    var target = project.patents[0];
    if (project.patents.length > 1) {
      var choices = project.patents.map(function (patent, index) { return (index + 1) + ". " + patent.patentNumber + " · " + (patent.title || "未提供标题"); }).join("\n");
      PatentShareUI.prompt("请选择关联该 PDF 的专利", "1", choices).then(function(answer) {
        if (answer == null) return;
        var targetIndex = Number(answer) - 1;
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= project.patents.length) {
          setNotice("专利选择无效。", true);
          render();
          return;
        }
        target = project.patents[targetIndex];
        doPdfImport(target, file);
      });
      return;
    }
    doPdfImport(target, file);
  }

  function doPdfImport(target, file) {
    var bridge = window.electronAPI && window.electronAPI.ocrSharePdf;
    if (!bridge) { setNotice("当前环境不支持 PDF OCR，请使用桌面版。", true); render(); return; }
    var reader = new FileReader();
    reader.onerror = function () { setNotice("无法读取 PDF 文件。", true); render(); };
    reader.onload = function () {
      setNotice("正在 OCR 解析 PDF，请保持应用打开。", false);
      render();
      bridge(reader.result).then(function (result) {
        var stored = window.PatentShareStore.addOcrSource(target.id, result, file.name);
        if (!stored.ok) setNotice("PDF OCR 未返回可用文本。", true);
        else setNotice("PDF OCR 已关联到 " + target.patentNumber + "。可在'分享模块'启用'OCR 原文摘录'。", false);
        activeView = "sources";
        render();
      }).catch(function (error) {
        setNotice(error && error.message ? error.message : "PDF OCR 失败。", true);
        render();
      });
    };
    reader.readAsArrayBuffer(file);
  }

  function renderReview(container, project) {
    addHeading(container, viewMeta.review);
    addNotice(container);
    if (project.patents.length === 0) {
      var empty = makeElement("div", "share-empty-panel");
      empty.appendChild(makeElement("h4", "", "尚无待审核专利"));
      empty.appendChild(makeElement("p", "", "先在'材料来源'加入专利快照；后续 Excel、PDF 与 OCR 导入也会在这里统一处理字段来源、冲突和说明书内容。"));
      container.appendChild(empty);
      return;
    }
    if (reviewPatentIndex >= project.patents.length) reviewPatentIndex = 0;

    // 顶部专利切换栏
    var switchBar = makeElement("div", "share-review-switcher");
    project.patents.forEach(function (p, idx) {
      var pill = makeElement("button", "share-review-pill" + (idx === reviewPatentIndex ? " active" : ""));
      pill.type = "button";
      pill.dataset.shareAction = "select-review-patent";
      pill.dataset.patentIndex = String(idx);
      pill.disabled = aiRunning;
      pill.appendChild(makeElement("span", "share-review-pill-num", p.patentNumber));
      var pillTitle = p.title || "未提供标题";
      if (pillTitle.length > 24) pillTitle = pillTitle.slice(0, 24) + "…";
      pill.appendChild(makeElement("span", "share-review-pill-title", pillTitle));
      var badges = makeElement("span", "share-review-pill-badges");
      if (p.claimsTranslation) badges.appendChild(makeElement("span", "share-status-done", "译"));
      if (p.descriptionTranslation) badges.appendChild(makeElement("span", "share-status-done", "说译"));
      if (p.figures && p.figures.length) badges.appendChild(makeElement("span", "share-status-done", "图" + p.figures.length));
      pill.appendChild(badges);
      switchBar.appendChild(pill);
    });
    container.appendChild(switchBar);

    var patent = project.patents[reviewPatentIndex];
    var standardFields = [
      ["title", "标题"],
      ["abstract", "摘要"],
      ["applicationDate", "申请日"],
      ["publicationDate", "公开日"],
      ["priorityDate", "优先权日"],
      ["assignees", "申请人"],
      ["inventors", "发明人"],
    ];

    var card = makeElement("article", "share-review-card");

    // 详情卡头部（不冻结，随内容滚动）
    var header = makeElement("div", "share-review-header");
    var headerLeft = makeElement("div", "share-review-header-left");
    headerLeft.appendChild(makeElement("h4", "", patent.patentNumber));
    // 过滤标题中的 " - Google Patents" 等来源后缀
    var cleanTitle = (patent.title || "未提供标题")
      .replace(/\s*-\s*Google\s*Patents\s*$/i, "")
      .replace(/\s*-\s*Google\s*专利\s*$/i, "")
      .trim();
    headerLeft.appendChild(makeElement("p", "share-review-header-subtitle", cleanTitle));
    var sourceMeta = makeElement("div", "share-review-meta-row");
    var figCount = patent.figures ? patent.figures.length : 0;
    var claimCount = Array.isArray(patent.claims) ? patent.claims.length : 0;
    sourceMeta.appendChild(makeElement("span", "", claimCount + "项权利要求 · " + figCount + "张附图"));
    headerLeft.appendChild(sourceMeta);
    header.appendChild(headerLeft);
    var headerActions = makeElement("div", "share-review-detail-actions");
    var removeBtn = makeElement("button", "share-field-remove", "移除该专利");
    removeBtn.type = "button";
    removeBtn.dataset.shareAction = "remove-patent";
    removeBtn.dataset.patentId = patent.id;
    removeBtn.disabled = aiRunning;
    headerActions.appendChild(removeBtn);
    header.appendChild(headerActions);
    card.appendChild(header);

    // 导航条
    var navBar = makeElement("nav", "share-review-nav");
    navBar.appendChild(makeElement("div", "share-review-nav-progress"));
    var navItems = [
      { id: "basic", label: "基本信息" },
      { id: "processed", label: "加工字段" },
      { id: "claims", label: "权利要求" },
      { id: "description", label: "说明书" },
      { id: "figures", label: "附图" },
    ];
    var navBtnList = makeElement("div", "share-review-nav-list");
    navItems.forEach(function (ni) {
      var navBtn = makeElement("button", "share-review-nav-btn", ni.label);
      navBtn.type = "button";
      navBtn.dataset.shareAction = "review-nav";
      navBtn.dataset.reviewNav = ni.id;
      navBtnList.appendChild(navBtn);
    });
    navBar.appendChild(navBtnList);
    card.appendChild(navBar);

    // Section: 基本信息（著录项网格 + 分类号）
    card.appendChild(buildReviewSection("基本信息", "basic", function (body) {
      var grid = makeElement("div", "review-basic-grid");
      standardFields.forEach(function (definition) {
        var fieldName = definition[0];
        var f = patent.fields && patent.fields[fieldName];
        var item = makeElement("div", "review-basic-item");
        item.appendChild(makeElement("div", "review-basic-label", definition[1]));
        var valEl = makeElement("div", "review-basic-val", f && f.value ? f.value : "来源未提供");
        if (!f || !f.value) valEl.style.color = "var(--c-text-muted, #7a9486)";
        item.appendChild(valEl);
        var metaEl = makeElement("div", "review-field-meta");
        var editBtn = makeElement("button", "review-field-edit-btn", "编辑");
        editBtn.type = "button";
        editBtn.dataset.shareAction = "edit-field";
        editBtn.dataset.patentId = patent.id;
        editBtn.dataset.fieldName = fieldName;
        editBtn.dataset.fieldLabel = definition[1];
        editBtn.dataset.fieldValue = f && f.value ? f.value : "";
        editBtn.disabled = aiRunning;
        metaEl.appendChild(editBtn);
        item.appendChild(metaEl);
        if (f && Array.isArray(f.candidates) && f.candidates.length > 1) {
          var candidates = makeElement("div", "share-review-candidates");
          f.candidates.forEach(function (candidate, candidateIndex) {
            var choose = makeElement("button", "share-candidate-button", (candidate.source || "来源") + "：" + candidate.value);
            choose.type = "button";
            choose.dataset.shareAction = "select-field-candidate";
            choose.dataset.patentId = patent.id;
            choose.dataset.fieldName = fieldName;
            choose.dataset.candidateIndex = String(candidateIndex);
            choose.disabled = aiRunning;
            candidates.appendChild(choose);
          });
          item.appendChild(candidates);
        }
        grid.appendChild(item);
      });
      body.appendChild(grid);

      // 分类号
      var classList = Array.isArray(patent.classifications) ? patent.classifications : [];
      var classRow = makeElement("div", "review-basic-item");
      classRow.style.marginTop = "12px";
      classRow.appendChild(makeElement("div", "review-basic-label", "IPC/CPC 分类"));
      var classVal = makeElement("div", "review-basic-val");
      if (classList.length) {
        classVal.textContent = classList.join("; ");
      } else {
        classVal.textContent = "尚未提供分类号";
        classVal.style.color = "var(--c-text-muted, #7a9486)";
      }
      classRow.appendChild(classVal);
      var classMeta = makeElement("div", "review-field-meta");
      var classEdit = makeElement("button", "review-field-edit-btn", classList.length ? "编辑" : "添加");
      classEdit.type = "button";
      classEdit.dataset.shareAction = "edit-classifications";
      classEdit.dataset.patentId = patent.id;
      classEdit.disabled = aiRunning;
      classMeta.appendChild(classEdit);
      classRow.appendChild(classMeta);
      body.appendChild(classRow);

      // 自定义字段
      var customKeys = Object.keys(patent.customFields && typeof patent.customFields === "object" ? patent.customFields : {});
      if (customKeys.length) {
        body.appendChild(makeElement("div", "share-review-sub-title", "自定义字段"));
        var customGrid = makeElement("div", "review-basic-grid");
        customKeys.forEach(function (key) {
          var custom = patent.customFields[key];
          if (!custom || !custom.field) return;
          var item = makeElement("div", "review-basic-item");
          item.appendChild(makeElement("div", "review-basic-label", custom.label || key));
          var valEl = makeElement("div", "review-basic-val", custom.field.value || "来源未提供");
          if (!custom.field.value) valEl.style.color = "var(--c-text-muted, #7a9486)";
          item.appendChild(valEl);
          var metaEl = makeElement("div", "review-field-meta");
          var cEdit = makeElement("button", "review-field-edit-btn", "编辑");
          cEdit.type = "button";
          cEdit.dataset.shareAction = "edit-custom-field";
          cEdit.dataset.patentId = patent.id;
          cEdit.dataset.fieldKey = key;
          cEdit.dataset.fieldLabel = custom.label || key;
          cEdit.dataset.fieldValue = custom.field.value || "";
          cEdit.disabled = aiRunning;
          metaEl.appendChild(cEdit);
          var cRm = makeElement("button", "review-field-edit-btn", "删除");
          cRm.type = "button";
          cRm.dataset.shareAction = "remove-custom-field";
          cRm.dataset.patentId = patent.id;
          cRm.dataset.fieldKey = key;
          cRm.disabled = aiRunning;
          metaEl.appendChild(cRm);
          item.appendChild(metaEl);
          customGrid.appendChild(item);
        });
        body.appendChild(customGrid);
      }
      var addCustomRow = makeElement("div", "review-field-meta");
      var addCustomBtn = makeElement("button", "review-field-edit-btn", "+ 添加自定义字段");
      addCustomBtn.type = "button";
      addCustomBtn.dataset.shareAction = "add-custom-field";
      addCustomBtn.dataset.patentId = patent.id;
      addCustomBtn.disabled = aiRunning;
      addCustomRow.appendChild(addCustomBtn);
      body.appendChild(addCustomRow);
    }));

    // Section: 加工信息字段（移到基本信息下方，排第二）
    card.appendChild(buildReviewSection("加工信息字段（AI 抽取 / 手工录入）", "processed", function (body) {
      var pfList = Array.isArray(patent.processedFields) ? patent.processedFields : [];
      if (pfList.length) {
        pfList.forEach(function (pf) {
          var pfRow = makeElement("div", "share-review-pf-row");
          var pfHead = makeElement("div", "share-review-pf-head");
          pfHead.appendChild(makeElement("strong", "", pf.label));
          var badge = makeElement("span", "share-processed-badge" + (pf.source === "ai" ? " ai" : " manual"), pf.source === "ai" ? "AI" : "手工");
          pfHead.appendChild(badge);
          pfRow.appendChild(pfHead);
          var pfVal = makeElement("div", "share-review-pf-val");
          var valText = pf.value || "（尚未填写）";
          if (valText.length > 200) valText = valText.slice(0, 200) + "…";
          pfVal.textContent = valText;
          pfRow.appendChild(pfVal);
          var pfActions = makeElement("div", "share-review-pf-actions");
          var aiBtn = makeElement("button", "share-field-edit", pf.prompt ? "AI抽取" : "配置AI");
          aiBtn.type = "button";
          aiBtn.dataset.shareAction = "ai-processed-field";
          aiBtn.dataset.patentId = patent.id;
          aiBtn.dataset.fieldId = pf.id;
          aiBtn.disabled = aiRunning;
          pfActions.appendChild(aiBtn);
          var editPf = makeElement("button", "share-field-edit", "编辑");
          editPf.type = "button";
          editPf.dataset.shareAction = "edit-processed-field";
          editPf.dataset.patentId = patent.id;
          editPf.dataset.fieldId = pf.id;
          editPf.disabled = aiRunning;
          pfActions.appendChild(editPf);
          var rmPf = makeElement("button", "share-field-remove", "删除");
          rmPf.type = "button";
          rmPf.dataset.shareAction = "remove-processed-field";
          rmPf.dataset.patentId = patent.id;
          rmPf.dataset.fieldId = pf.id;
          rmPf.disabled = aiRunning;
          pfActions.appendChild(rmPf);
          pfRow.appendChild(pfActions);
          // 字段级 AI 原文范围：默认继承项目级；可单独勾选摘要/权利要求/说明书/IPR 标注。
          var scopeBox = makeElement("div", "share-review-pf-scope");
          scopeBox.appendChild(makeElement("div", "share-review-info-label", "AI 抽取基于的原文范围："));
          var fieldScope = pf.contextScope === null || pf.contextScope === undefined
            ? null
            : pf.contextScope;
          scopeBox.appendChild(buildContextScopePanel(fieldScope, {
            actionName: "toggle-field-context-scope",
            allowInherit: true,
            radioName: "share-scope-" + pf.id,
            inheritAction: "set-field-context-scope",
            patentId: patent.id,
            fieldId: pf.id,
          }));
          pfRow.appendChild(scopeBox);
          body.appendChild(pfRow);
        });
      } else {
        body.appendChild(makeElement("p", "share-missing-text", "尚未添加加工字段。可从预设模板添加，或自定义字段名称与提示词后AI抽取。"));
      }
      var presetBar = makeElement("div", "share-processed-preset-bar");
      presetBar.appendChild(makeElement("span", "share-review-info-label", "快速添加："));
      var presets = window.PatentShareModules && window.PatentShareModules.fieldPresets ? window.PatentShareModules.fieldPresets() : [];
      presets.forEach(function (preset) {
        var pb = makeElement("button", "share-field-edit share-preset-btn", "+" + preset.label);
        pb.type = "button";
        pb.dataset.shareAction = "add-preset-field";
        pb.dataset.patentId = patent.id;
        pb.dataset.presetLabel = preset.label;
        pb.dataset.presetType = preset.type;
        pb.disabled = aiRunning;
        presetBar.appendChild(pb);
      });
      var customBtn = makeElement("button", "share-field-edit", "+ 自定义字段");
      customBtn.type = "button";
      customBtn.dataset.shareAction = "add-processed-field";
      customBtn.dataset.patentId = patent.id;
      customBtn.disabled = aiRunning;
      presetBar.appendChild(customBtn);
      body.appendChild(presetBar);
    }));

    // Section: 权利要求
    card.appendChild(buildReviewSection("权利要求", "claims", function (body) {
      var claimList = Array.isArray(patent.claims) ? patent.claims : [];
      var claimActions = makeElement("div", "review-drawings-actions");
      if (claimList.length) {
        var indep = claimList.filter(function(c) { return c.type === "independent"; }).length;
        claimActions.appendChild(makeElement("span", "", claimList.length + " 项权利要求（独立 " + indep + " 项，从属 " + (claimList.length - indep) + " 项）"));
      } else {
        claimActions.appendChild(makeElement("span", "", "尚未提供权利要求"));
      }
      var claimEdit = makeElement("button", "share-secondary-action", claimList.length ? "编辑" : "添加");
      claimEdit.type = "button";
      claimEdit.dataset.shareAction = "edit-claims";
      claimEdit.dataset.patentId = patent.id;
      claimEdit.disabled = aiRunning;
      claimActions.appendChild(claimEdit);
      if (claimList.length) {
        var trClaimsBtn = makeElement("button", "share-secondary-action", patent.claimsTranslation ? "重新翻译" : "翻译为中文");
        trClaimsBtn.type = "button";
        trClaimsBtn.dataset.shareAction = "translate-claims";
        trClaimsBtn.dataset.patentId = patent.id;
        trClaimsBtn.disabled = aiRunning;
        claimActions.appendChild(trClaimsBtn);
        if (patent.claimsTranslation) {
          claimActions.appendChild(makeElement("span", "share-processed-badge ai", "已翻译"));
        }
      }
      body.appendChild(claimActions);
      if (claimList.length) {
        var claimGrid = makeElement("div", "review-claims");
        claimList.forEach(function (claim) {
          var claimItem = makeElement("div", "review-claim-item");
          var claimNum = makeElement("div", "review-claim-num", (claim.number || "") + " · " + (claim.type === "independent" ? "独立权利要求" : claim.type === "dependent" ? "从属权利要求" : "权利要求"));
          claimItem.appendChild(claimNum);
          // 标注层：用 contenteditable 的文本容器，支持选中后标注
          var claimText = makeElement("div", "review-claim-text review-annotatable");
          claimText.dataset.annotationField = "claims";
          claimText.dataset.annotationKey = claim.number || "";
          claimText.dataset.patentId = patent.id;
          claimText.innerHTML = applyAnnotations(claim.text || "", patent.claimsAnnotations, claim.number || "");
          claimItem.appendChild(claimText);
          var claimAnnoList = buildAnnotationList(patent, "claims", claim.number || "");
          if (claimAnnoList) claimItem.appendChild(claimAnnoList);
          if (claim.references && claim.references.length) {
            claimItem.appendChild(makeElement("div", "review-claim-dep", "引用：权项 " + claim.references.join(", ")));
          }
          claimGrid.appendChild(claimItem);
        });
        body.appendChild(claimGrid);
      }
    }));

    // Section: 说明书
    card.appendChild(buildReviewSection("说明书", "description", function (body) {
      var descActions = makeElement("div", "review-drawings-actions");
      var descBtn = makeElement("button", "share-secondary-action", patent.description ? "编辑说明书" : "添加说明书");
      descBtn.type = "button";
      descBtn.dataset.shareAction = "edit-description";
      descBtn.dataset.patentId = patent.id;
      descBtn.disabled = aiRunning;
      descActions.appendChild(descBtn);
      if (patent.description) {
        var trDescBtn = makeElement("button", "share-secondary-action", patent.descriptionTranslation ? "重新翻译说明书" : "翻译说明书");
        trDescBtn.type = "button";
        trDescBtn.dataset.shareAction = "translate-description";
        trDescBtn.dataset.patentId = patent.id;
        trDescBtn.disabled = aiRunning;
        descActions.appendChild(trDescBtn);
        if (patent.descriptionTranslation) {
          descActions.appendChild(makeElement("span", "share-processed-badge ai", "已翻译"));
        }
      }
      body.appendChild(descActions);
      if (patent.description) {
        var descPreview = makeElement("div", "review-desc-block");
        var descText = makeElement("div", "review-desc-text review-annotatable");
        descText.dataset.annotationField = "description";
        descText.dataset.patentId = patent.id;
        descText.innerHTML = applyAnnotations(patent.description.length > 2000 ? patent.description.slice(0, 2000) + "..." : patent.description, patent.descriptionAnnotations, "");
        descPreview.appendChild(descText);
        body.appendChild(descPreview);
        var descAnnoList = buildAnnotationList(patent, "description", "");
        if (descAnnoList) body.appendChild(descAnnoList);
      } else {
        body.appendChild(makeElement("div", "review-drawings-empty", "尚未提供说明书内容，点击上方「编辑说明书」按钮添加"));
      }
    }));

    // Section: 附图
    card.appendChild(buildReviewSection("附图", "figures", function (body) {
      var figList = Array.isArray(patent.figures) ? patent.figures : [];
      var figActions = makeElement("div", "review-drawings-actions");
      figActions.appendChild(makeElement("span", "", figList.length ? figList.length + " 张附图" : "尚未上传附图"));
      var uploadBtn = makeElement("button", "share-secondary-action", "+ 上传附图");
      uploadBtn.type = "button";
      uploadBtn.dataset.shareAction = "upload-figure";
      uploadBtn.dataset.patentId = patent.id;
      uploadBtn.disabled = aiRunning;
      figActions.appendChild(uploadBtn);
      var fileInput = makeElement("input", "share-figure-file-input");
      fileInput.type = "file";
      fileInput.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
      fileInput.style.display = "none";
      fileInput.dataset.shareAction = "figure-file-input";
      fileInput.dataset.patentId = patent.id;
      body.appendChild(fileInput);
      body.appendChild(figActions);
      if (figList.length) {
        var figGrid = makeElement("div", "review-drawings-grid");
        figList.forEach(function (fig) {
          var figItem = makeElement("div", "review-drawing-thumb");
          var img = makeElement("img");
          img.src = fig.dataUrl;
          img.alt = fig.caption || "附图";
          figItem.appendChild(img);
          if (fig.caption) figItem.appendChild(makeElement("span", "review-drawing-label", fig.caption));
          var rmFig = makeElement("button", "share-fig-remove", "×");
          rmFig.type = "button";
          rmFig.title = "删除";
          rmFig.dataset.shareAction = "remove-figure";
          rmFig.dataset.patentId = patent.id;
          rmFig.dataset.figureId = fig.id;
          rmFig.disabled = aiRunning;
          figItem.appendChild(rmFig);
          figGrid.appendChild(figItem);
        });
        body.appendChild(figGrid);
      } else {
        body.appendChild(makeElement("div", "review-drawings-empty", "尚未上传附图，点击上方按钮上传图片"));
      }
    }));

    container.appendChild(card);
  }

  // 标注功能辅助函数
  function makeAnnoBtn(type, label, patentId, field, key) {
    var btn = makeElement("button", "review-anno-btn review-anno-" + type, label);
    btn.type = "button";
    btn.dataset.shareAction = "annotate-text";
    btn.dataset.annoType = type;
    btn.dataset.patentId = patentId;
    btn.dataset.annoField = field;
    btn.dataset.annoKey = key;
    btn.title = type === "clear" ? "清除本段所有标注" : label + "选中文字";
    btn.disabled = aiRunning;
    return btn;
  }

  // 逐条标注删除入口：列出当前段落已有的标注，每条提供独立删除按钮。
  // data-annotation-ui 标记的节点会被 selectionOffsetsInText 的 TreeWalker 跳过，
  // 避免删除按钮等 UI 文本污染选区偏移量。
  function buildAnnotationList(patent, field, key) {
    var property = field === "claims" ? "claimsAnnotations" : (field === "description" ? "descriptionAnnotations" : "");
    if (!property) return null;
    var annos = Array.isArray(patent[property]) ? patent[property].filter(function (a) {
      return a && a.key === (key || "");
    }) : [];
    if (!annos.length) return null;
    var typeLabels = { underline: "下划线", highlight: "高亮", comment: "注释" };
    var list = makeElement("div", "review-anno-list");
    list.setAttribute("data-annotation-ui", "true");
    annos.forEach(function (anno) {
      var item = makeElement("div", "review-anno-item");
      item.appendChild(makeElement("span", "review-anno-item-type type-" + anno.type, typeLabels[anno.type] || anno.type));
      var snippet = anno.text || (anno.type === "comment" ? anno.comment : "");
      if (snippet.length > 40) snippet = snippet.slice(0, 40) + "…";
      item.appendChild(makeElement("span", "review-anno-item-text", snippet));
      if (anno.type === "comment" && anno.comment) {
        var commentText = anno.comment.length > 30 ? anno.comment.slice(0, 30) + "…" : anno.comment;
        item.appendChild(makeElement("span", "review-anno-item-comment", "「" + commentText + "」"));
      }
      var rm = makeElement("button", "review-anno-item-remove", "删除");
      rm.type = "button";
      rm.dataset.shareAction = "remove-annotation";
      rm.dataset.patentId = patent.id;
      rm.dataset.annoField = field;
      rm.dataset.annoId = anno.id;
      rm.title = "删除该条标注";
      rm.disabled = aiRunning;
      item.appendChild(rm);
      list.appendChild(item);
    });
    return list;
  }

  function showAnnotationFeedback(action, message, isError) {
    var host = action && action.closest ? action.closest(".review-anno-bar, .review-anno-floating, .review-anno-contextmenu") : null;
    if (!host) return;
    var feedback = host.querySelector(".review-anno-feedback");
    if (!feedback) {
      feedback = makeElement("span", "review-anno-feedback");
      feedback.setAttribute("role", "status");
      host.appendChild(feedback);
    }
    feedback.classList.toggle("error", !!isError);
    feedback.textContent = message;
  }

  // === 标注悬浮工具条与右键菜单 ===
  // 选中正文后弹出悬浮球，右键弹出菜单；替代每条底部的固定工具条。
  var annoFloating = null;
  var annoContextMenu = null;

  function hideAnnotationFloating() {
    if (annoFloating) { annoFloating.remove(); annoFloating = null; }
  }
  function hideAnnotationContextMenu() {
    if (annoContextMenu) { annoContextMenu.remove(); annoContextMenu = null; }
  }

  // 根据按钮 data 属性定位对应的可标注正文元素（兼容底部工具条与悬浮球/右键菜单）。
  function findAnnotatableForAction(action) {
    var annoField = action.dataset.annoField || "";
    var annoKey = action.dataset.annoKey || "";
    var keySel = annoKey ? "[data-annotation-key='" + annoKey + "']" : "";
    var sel = ".review-annotatable[data-annotation-field='" + annoField + "']" + keySel;
    var container = action.closest ? action.closest(".review-claim-item, .share-review-section-body") : null;
    if (container) {
      var el = container.querySelector(sel);
      if (el) return el;
    }
    var view = byId("share-workspace-view");
    return view ? view.querySelector(sel) : null;
  }

  function buildAnnoButtons(target, types) {
    var patentId = target.dataset.patentId || "";
    var field = target.dataset.annotationField || "";
    var key = target.dataset.annotationKey || "";
    var labels = { underline: "下划线", highlight: "高亮", comment: "注释", clear: "清除标注" };
    return types.map(function (t) {
      return makeAnnoBtn(t, labels[t] || t, patentId, field, key);
    });
  }

  // 选中正文后，在选区上方弹出悬浮工具条（下划线/高亮/注释）。
  function showAnnotationFloating(target, rect) {
    hideAnnotationFloating();
    if (aiRunning) return;
    var view = byId("share-workspace-view");
    if (!view) return;
    var toolbar = makeElement("div", "review-anno-floating");
    toolbar.setAttribute("data-annotation-ui", "true");
    buildAnnoButtons(target, ["underline", "highlight", "comment"]).forEach(function (btn) {
      toolbar.appendChild(btn);
    });
    view.appendChild(toolbar);
    var top = rect.top - toolbar.offsetHeight - 8;
    var left = rect.left + (rect.width - toolbar.offsetWidth) / 2;
    if (top < 8) top = rect.bottom + 8;
    if (left < 8) left = 8;
    if (left + toolbar.offsetWidth > window.innerWidth - 8) left = window.innerWidth - toolbar.offsetWidth - 8;
    toolbar.style.top = top + "px";
    toolbar.style.left = left + "px";
    annoFloating = toolbar;
  }

  // 右键弹出菜单：有选区时提供下划线/高亮/注释/清除，无选区时仅清除标注。
  function showAnnotationContextMenu(target, x, y) {
    hideAnnotationContextMenu();
    if (aiRunning) return;
    var view = byId("share-workspace-view");
    if (!view) return;
    var menu = makeElement("div", "review-anno-contextmenu");
    menu.setAttribute("data-annotation-ui", "true");
    var sel = window.getSelection();
    var hasSelection = sel && !sel.isCollapsed && sel.rangeCount > 0 && target.contains(sel.getRangeAt(0).commonAncestorContainer);
    var types = hasSelection ? ["underline", "highlight", "comment", "clear"] : ["clear"];
    buildAnnoButtons(target, types).forEach(function (btn) {
      var item = makeElement("div", "review-anno-contextmenu-item");
      item.appendChild(btn);
      menu.appendChild(item);
    });
    view.appendChild(menu);
    var top = y;
    var left = x;
    if (top + menu.offsetHeight > window.innerHeight - 8) top = window.innerHeight - menu.offsetHeight - 8;
    if (left + menu.offsetWidth > window.innerWidth - 8) left = window.innerWidth - menu.offsetWidth - 8;
    menu.style.top = top + "px";
    menu.style.left = left + "px";
    annoContextMenu = menu;
  }

  // 判断选区是否落在某个可标注正文元素内，返回该元素或 null。
  function getAnnotatableFromSelection(sel) {
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    var node = range.commonAncestorContainer;
    var el = node.nodeType === 1 ? node : node.parentElement;
    return el && el.closest ? el.closest(".review-annotatable") : null;
  }

  function selectionOffsetsInText(container, range) {
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        return node.parentElement && node.parentElement.closest("[data-annotation-ui]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    var start = 0;
    var end = 0;
    var offset = 0;
    var foundStart = false;
    var node;
    while ((node = walker.nextNode())) {
      var length = node.nodeValue.length;
      if (node === range.startContainer) { start = offset + range.startOffset; foundStart = true; }
      if (node === range.endContainer) { end = offset + range.endOffset; return foundStart ? { start: start, end: end } : null; }
      offset += length;
    }
    return null;
  }

  // 将标注应用到文本，返回 HTML
  function applyAnnotations(text, annotations, key) {
    if (!text) return "";
    if (!annotations || !Array.isArray(annotations) || !annotations.length) return escapeHtmlForAnno(text);
    var sorted = annotations.filter(function(a) { return a.key === key; }).sort(function(a, b) { return (a.start || 0) - (b.start || 0); });
    var cursor = 0;
    var html = "";
    sorted.forEach(function(anno) {
      var start = Math.max(0, anno.start || 0);
      var end = Math.min(text.length, anno.end || start);
      if (start < cursor || start >= end) return;
      html += escapeHtmlForAnno(text.slice(cursor, start));
      var middle = escapeHtmlForAnno(text.slice(start, end));
      if (anno.type === "underline") middle = '<span class="anno-underline">' + middle + '</span>';
      else if (anno.type === "highlight") middle = '<mark class="anno-highlight">' + middle + '</mark>';
      else if (anno.type === "comment" && anno.comment) middle = '<span class="anno-comment" title="' + escapeHtmlForAnno(anno.comment) + '">' + middle + '<sup data-annotation-ui="true">注</sup></span>';
      html += middle;
      cursor = end;
    });
    return html + escapeHtmlForAnno(text.slice(cursor));
  }

  function escapeHtmlForAnno(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // 构建审核页面的分节块（标题 + 内容 body 由回调填充）
  function buildReviewSection(title, sectionId, fillBody) {
    var section = makeElement("section", "share-review-section");
    section.id = "review-section-" + (sectionId || "");
    var secHead = makeElement("div", "share-review-section-head");
    secHead.appendChild(makeElement("h4", "", title));
    section.appendChild(secHead);
    var secBody = makeElement("div", "share-review-section-body");
    fillBody(secBody);
    section.appendChild(secBody);
    return section;
  }

  function modeLabel(mode) { return mode === "full" ? "完整" : mode === "lite" ? "精简" : "关闭"; }

  // 提示词与原文范围视图：左侧导航常驻入口，集中管理 12 条提示词 + 项目级 AI 原文范围。
  // 面板组件复用 buildPromptManagementPanel，所有按钮 action 已有全局 handler。
  function renderPrompts(container, project) {
    addHeading(container, viewMeta.prompts);
    addNotice(container);
    var hint = makeElement("p", "share-module-hint", "这里集中管理「组合判断」4 类内置提示词（技术解读 / 技术要素 / 实施例与验证 / 多专利对比）与「内容加工与审核」中加工字段的预设提示词；修改后立即生效，影响后续 AI 草稿生成。下方还可设置 AI 分析纳入的原文范围（项目级默认，字段级可在加工字段中单独覆盖）。");
    container.appendChild(hint);
    container.appendChild(buildPromptManagementPanel(project));
  }

  function renderModules(container, project) {
    addHeading(container, viewMeta.modules);
    addNotice(container);
    var registry = window.PatentShareModules;
    if (!registry) { renderPlaceholder(container, "modules", project); return; }
    var config = registry.resolveConfig(project.moduleConfig);
    var hint = makeElement("p", "share-module-hint", "点击模块切换“完整 / 精简 / 关闭”。加工信息模块可拖拽排序，排序会在预览与导出中生效；基础原文模块保持固定阅读结构。");
    container.appendChild(hint);

    // 可视化布局编辑器：模拟最终分享 HTML 的版面结构
    var preview = makeElement("div", "share-module-visual");
    preview.appendChild(makeElement("div", "share-module-visual-hint", "以下版面模拟最终分享网页的布局结构；仅加工信息模块支持拖拽排序"));

    // 模拟封面区
    var coverZone = makeElement("div", "share-module-zone cover-zone");
    coverZone.appendChild(makeElement("div", "share-module-zone-label", "封面区"));
    var allModules = registry.list();
    var basicModules = allModules.filter(function(m) { return m.category === "basic"; });
    var sourceModules = allModules.filter(function(m) { return m.category === "source"; });
    var processedModules = registry.orderByConfig ? registry.orderByConfig(allModules.filter(function(m) { return m.category === "processed"; }), config, "processed") : allModules.filter(function(m) { return m.category === "processed"; });

    // S1 封面单独放封面区
    var s1 = basicModules.find(function(m) { return m.id === "S1"; });
    if (s1) coverZone.appendChild(buildModuleBlock(s1, config));
    preview.appendChild(coverZone);

    // 模拟主体布局：左侧导航 + 右侧内容区
    var bodyZone = makeElement("div", "share-module-body-zone");
    // 左侧导航（固定，非模块）
    var sidebarMock = makeElement("div", "share-module-sidebar-mock");
    sidebarMock.appendChild(makeElement("div", "share-module-sidebar-title", "专利导航"));
    sidebarMock.appendChild(makeElement("div", "share-module-sidebar-item", "专利 1"));
    sidebarMock.appendChild(makeElement("div", "share-module-sidebar-item", "专利 2"));
    sidebarMock.appendChild(makeElement("div", "share-module-sidebar-item", "专利 3"));
    bodyZone.appendChild(sidebarMock);

    // 右侧内容区：分面板
    var contentArea = makeElement("div", "share-module-content-area");

    // 基础信息面板
    var basicPanel = makeElement("div", "share-module-panel");
    basicPanel.appendChild(makeElement("div", "share-module-panel-header", "基础信息标签页"));
    var basicDropZone = makeElement("div", "share-module-drop-zone");
    basicDropZone.dataset.zone = "basic";
    basicModules.filter(function(m) { return m.id !== "S1"; }).forEach(function(m) {
      basicDropZone.appendChild(buildModuleBlock(m, config));
    });
    basicPanel.appendChild(basicDropZone);
    contentArea.appendChild(basicPanel);

    // 原文信息面板（权利要求 / 说明书 / 附图，与分享 HTML 的「原文信息」标签页对应，固定顺序不可拖拽）
    var sourcePanel = makeElement("div", "share-module-panel");
    sourcePanel.appendChild(makeElement("div", "share-module-panel-header", "原文信息标签页"));
    var sourceDropZone = makeElement("div", "share-module-drop-zone");
    sourceDropZone.dataset.zone = "source";
    sourceModules.forEach(function(m) {
      sourceDropZone.appendChild(buildModuleBlock(m, config));
    });
    sourcePanel.appendChild(sourceDropZone);
    contentArea.appendChild(sourcePanel);

    // 加工信息面板
    var procPanel = makeElement("div", "share-module-panel");
    procPanel.appendChild(makeElement("div", "share-module-panel-header", "加工信息标签页"));
    var procDropZone = makeElement("div", "share-module-drop-zone");
    procDropZone.dataset.zone = "processed";
    processedModules.forEach(function(m) {
      procDropZone.appendChild(buildModuleBlock(m, config));
    });
    procPanel.appendChild(procDropZone);
    contentArea.appendChild(procPanel);

    bodyZone.appendChild(contentArea);
    preview.appendChild(bodyZone);

    container.appendChild(preview);

    // 绑定拖拽事件
    bindModuleDragAndDrop(container);
  }

  function buildModuleBlock(module, config) {
    var mode = config.modules[module.id] || "off";
    var isOff = mode === "off";
    var block = makeElement("div", "share-module-block" + (isOff ? " disabled" : ""));
    block.dataset.moduleId = module.id;
    block.dataset.moduleMode = mode;
    block.draggable = !aiRunning && module.category === "processed";

    var dragHandle = makeElement("div", "share-module-drag-handle", "⋮⋮");
    dragHandle.title = "拖拽排序";
    block.appendChild(dragHandle);

    var info = makeElement("div", "share-module-block-info");
    info.appendChild(makeElement("span", "share-module-block-id", module.id));
    info.appendChild(makeElement("span", "share-module-block-label", module.label));
    if (module.required) info.appendChild(makeElement("span", "share-module-block-required", "必要"));
    block.appendChild(info);

    // 数据来源标注：让用户看到该模块的内容来自「组合判断」的哪一类生成入口，
    // 解决「加工字段、组合判断的内容不知道对应编排的哪个模块」的问题。
    if (module.category === "processed" && module.dataSource) {
      var dsRow = makeElement("div", "share-module-block-datasource");
      dsRow.appendChild(makeElement("span", "share-module-block-ds-label", "数据来源："));
      dsRow.appendChild(makeElement("span", "share-module-block-ds-value", module.dataSource));
      if (module.analysisKey) {
        dsRow.appendChild(makeElement("span", "share-module-block-ds-key", "键：" + module.analysisKey));
      }
      block.appendChild(dsRow);
    }

    // 模式切换按钮组
    var modeBar = makeElement("div", "share-module-mode-bar");
    ["full", "lite", "off"].forEach(function(m) {
      if (module.required && m === "off") return;
      var btn = makeElement("button", "share-module-mode-btn" + (mode === m ? " active" : ""), modeLabel(m));
      btn.type = "button";
      btn.dataset.shareAction = "module-mode";
      btn.dataset.moduleId = module.id;
      btn.dataset.mode = m;
      btn.disabled = aiRunning;
      modeBar.appendChild(btn);
    });
    block.appendChild(modeBar);

    return block;
  }

  function bindModuleDragAndDrop(container) {
    var dropZones = container.querySelectorAll(".share-module-drop-zone[data-zone='processed']");
    var dragged = null;
    dropZones.forEach(function(zone) {
      zone.addEventListener("dragstart", function(e) {
        var block = e.target.closest(".share-module-block");
        if (!block) return;
        dragged = block;
        block.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      zone.addEventListener("dragend", function(e) {
        var block = e.target.closest(".share-module-block");
        if (block) block.classList.remove("dragging");
        dragged = null;
      });
      zone.addEventListener("dragover", function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        var afterElement = getDragAfterElement(zone, e.clientY);
        if (!dragged) return;
        if (afterElement == null) {
          zone.appendChild(dragged);
        } else if (afterElement !== dragged) {
          zone.insertBefore(dragged, afterElement);
        }
      });
      zone.addEventListener("drop", function(e) {
        e.preventDefault();
        if (!dragged) return;
        // 保存新的模块顺序
        var blocks = zone.querySelectorAll(".share-module-block");
        var order = [];
        blocks.forEach(function(b) { order.push(b.dataset.moduleId); });
        // 暂存顺序到项目配置（通过 store）
        if (window.PatentShareStore && window.PatentShareStore.setModuleOrder) {
          window.PatentShareStore.setModuleOrder(zone.dataset.zone, order);
        }
        setNotice("模块顺序已保存。", false);
      });
    });
  }

  function getDragAfterElement(container, y) {
    var draggables = container.querySelectorAll(".share-module-block:not(.dragging)");
    var closest = null;
    var closestOffset = Number.NEGATIVE_INFINITY;
    draggables.forEach(function(el) {
      var box = el.getBoundingClientRect();
      var offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closestOffset) {
        closestOffset = offset;
        closest = el;
      }
    });
    return closest;
  }

  function renderPreview(container, project) {
    addHeading(container, viewMeta.preview);
    addNotice(container);
    var renderer = window.PatentShareRenderer;
    if (!renderer) { renderPlaceholder(container, "preview", project); return; }
    var result = renderer.render(project);
    var toolbar = makeElement("div", "share-preview-toolbar");
    toolbar.appendChild(makeElement("span", "share-preview-meta", "离线预览 · " + Math.ceil(result.size / 1024) + " KB"));
    var refresh = makeElement("button", "share-secondary-action", "刷新预览");
    refresh.type = "button";
    refresh.dataset.shareAction = "refresh-preview";
    toolbar.appendChild(refresh);
    container.appendChild(toolbar);
    if (result.findings.length) container.appendChild(makeElement("div", "share-inline-notice error", "预览发现：" + result.findings.join("；")));
    else container.appendChild(makeElement("div", "share-inline-notice", "AI生成内容已标注，请在导出前人工核验关键技术信息。"));
    var frame = document.createElement("iframe");
    frame.className = "share-preview-frame";
    frame.title = "专利分享离线预览";
    // sandbox=allow-scripts 允许分享 HTML 内的交互脚本（标签页/分栏/灯箱/返回顶部）运行；
    // 不加 allow-same-origin，保持 iframe 与父页面跨域隔离，脚本无法访问主应用 DOM 或 IPC。
    frame.setAttribute("sandbox", "allow-scripts");
    frame.srcdoc = result.html;
    container.appendChild(frame);
  }

  function aiReviewLabel(analysis) {
    return analysis && analysis.reviewState === "accepted" ? "已确认用于分享" : "AI 草稿，待人工审核";
  }

  function buildAIReviewCard(owner, scope, analysisType, label, analysis) {
    if (!analysis) return null;
    var card = makeElement("section", "share-ai-review-card");
    var head = makeElement("div", "share-ai-review-head");
    head.appendChild(makeElement("strong", "", label));
    head.appendChild(makeElement("span", "share-processed-badge " + (analysis.reviewState === "accepted" ? "manual" : "ai"), aiReviewLabel(analysis)));
    card.appendChild(head);
    card.appendChild(makeElement("p", "share-ai-review-meta", "模型：" + (analysis.model || "未知") + " · 生成：" + (analysis.generatedAt || "").slice(0, 19) + (analysis.promptVersion ? " · 模板：" + analysis.promptVersion : "")));
    var editor = document.createElement("textarea");
    editor.className = "share-research-input share-ai-review-editor";
    editor.rows = Math.min(14, Math.max(5, Math.ceil((analysis.content || "").length / 90)));
    editor.maxLength = 200000;
    editor.value = analysis.content || "";
    editor.dataset.aiEditor = "true";
    editor.dataset.aiScope = scope;
    editor.dataset.aiType = analysisType;
    if (owner && owner.id) editor.dataset.patentId = owner.id;
    card.appendChild(editor);
    var actions = makeElement("div", "share-ai-review-actions");
    [["save-ai-analysis", "保存草稿"], [analysis.reviewState === "accepted" ? "return-ai-analysis" : "accept-ai-analysis", analysis.reviewState === "accepted" ? "退回草稿" : "确认用于分享"]].forEach(function (item) {
      var button = makeElement("button", item[0] === "accept-ai-analysis" ? "share-primary-action" : "share-secondary-action", item[1]);
      button.type = "button";
      button.dataset.shareAction = item[0];
      button.dataset.aiScope = scope;
      button.dataset.aiType = analysisType;
      if (owner && owner.id) button.dataset.patentId = owner.id;
      button.disabled = aiRunning;
      actions.appendChild(button);
    });
    card.appendChild(actions);
    return card;
  }

  function renderInsights(container, project) {
    addHeading(container, viewMeta.insights, project.patents.length >= 2 ? "生成全部草稿" : "生成技术解读草稿", "ai-analyze-all");
    addNotice(container);
    if (aiRunning) container.appendChild(makeElement("div", "share-ai-loading", "AI 正在生成草稿，请稍候..."));
    var hasAI = window.PatentShareAI && window.PatentShareAI.getActiveAIProvider();
    if (!hasAI) container.appendChild(makeElement("div", "share-inline-notice error", "未检测到可用的 AI 配置。仍可编辑人工结论，但无法生成新的 AI 草稿。"));
    container.appendChild(makeElement("p", "share-module-hint", "每份 AI 内容都必须在这里阅读、编辑并确认后，才可进入正式分享。结论应能回到权利要求、说明书或 IPR 标注核验。"));

    // 批量 AI 处理面板：一次输入多篇专利后，统一选定字段类型并发处理，可看进度、可取消。
    container.appendChild(buildBatchPanel(project, hasAI));

    // 提示词与原文范围入口：跳转到独立的「提示词与原文范围」导航项集中管理。
    var promptHint = makeElement("div", "share-insights-prompt-hint");
    promptHint.appendChild(makeElement("span", "", "提示词与原文范围管理："));
    var promptBtn = makeElement("button", "share-field-edit", "前往「提示词与原文范围」");
    promptBtn.type = "button";
    promptBtn.dataset.shareAction = "go-prompts";
    promptBtn.disabled = aiRunning;
    promptHint.appendChild(promptBtn);
    // 显示当前项目级原文范围概要
    var curScope = window.PatentShareStore && window.PatentShareStore.getAIContextScope ? window.PatentShareStore.getAIContextScope() : {};
    var scopeSummary = ["abstract", "claims", "description", "annotations"]
      .filter(function (k) { return curScope[k] !== false; })
      .map(function (k) { return k === "abstract" ? "摘要" : k === "claims" ? "权利要求" : k === "description" ? "说明书" : "IPR 标注"; })
      .join("、") || "（未勾选任何原文）";
    promptHint.appendChild(makeElement("span", "share-review-info-label", "当前 AI 基于：" + scopeSummary));
    container.appendChild(promptHint);

    if (!project.patents.length) {
      var empty = makeElement("div", "share-empty-panel");
      empty.appendChild(makeElement("h4", "", "请先加入专利材料"));
      empty.appendChild(makeElement("p", "", "加入专利后，可生成技术解读草稿并逐项审核。"));
      container.appendChild(empty);
    }

    project.patents.forEach(function (patent) {
      var patentCard = makeElement("article", "share-ai-patent-card");
      var header = makeElement("div", "share-ai-patent-header");
      header.appendChild(makeElement("h4", "", patent.patentNumber + " · " + (patent.title || "未提供标题")));
      var btnGroup = makeElement("div", "share-ai-btn-group");
      [["summary", "技术解读"], ["elements", "技术要素"], ["embodiments", "实施例与验证"]].forEach(function (item) {
        var button = makeElement("button", "share-secondary-action share-ai-btn", (patent.aiAnalysis && patent.aiAnalysis[item[0]] ? "重新生成" : "生成") + item[1] + "草稿");
        button.type = "button";
        button.dataset.shareAction = "ai-" + item[0];
        button.dataset.patentId = patent.id;
        button.disabled = aiRunning || !hasAI || (item[0] === "embodiments" && !patent.description);
        if (item[0] === "embodiments" && !patent.description) button.title = "需先导入说明书内容";
        btnGroup.appendChild(button);
      });
      header.appendChild(btnGroup);
      patentCard.appendChild(header);
      [["summary", "技术解读（问题、方案、效果与待确认事项）"], ["elements", "技术要素与参数"], ["embodiments", "实施例与验证"]].forEach(function (item) {
        var reviewCard = buildAIReviewCard(patent, "patent", item[0], item[1], patent.aiAnalysis && patent.aiAnalysis[item[0]]);
        if (reviewCard) patentCard.appendChild(reviewCard);
      });
      container.appendChild(patentCard);
    });

    if (project.patents.length >= 2) {
      var compCard = makeElement("article", "share-ai-patent-card");
      var compHeader = makeElement("div", "share-ai-patent-header");
      compHeader.appendChild(makeElement("h4", "", "多专利技术路线对比"));
      var compBtn = makeElement("button", "share-primary-action share-ai-btn", project.aiAnalysis && project.aiAnalysis.comparison ? "重新生成对比草稿" : "生成对比草稿");
      compBtn.type = "button";
      compBtn.dataset.shareAction = "ai-comparison";
      compBtn.disabled = aiRunning || !hasAI;
      compHeader.appendChild(compBtn);
      compCard.appendChild(compHeader);
      var comparisonReview = buildAIReviewCard(null, "project", "comparison", "技术路线对比", project.aiAnalysis && project.aiAnalysis.comparison);
      if (comparisonReview) compCard.appendChild(comparisonReview);
      container.appendChild(compCard);
    }

    container.appendChild(makeElement("h4", "", "项目级结论（人工确认）"));
    var summary = project.researchSummary || {};
    [["problem", "技术问题（项目整体）"], ["approach", "技术手段要点"], ["effect", "技术效果总结"], ["openQuestions", "待验证问题与下一步"]].forEach(function (item) {
      var label = makeElement("label", "share-research-label", item[1]);
      var input = document.createElement("textarea");
      input.className = "share-research-input";
      input.id = "share-research-" + item[0];
      input.maxLength = 8000;
      input.rows = 3;
      input.value = summary[item[0]] || "";
      label.appendChild(input);
      container.appendChild(label);
    });
    var save = makeElement("button", "share-primary-action", "保存项目级结论");
    save.type = "button";
    save.dataset.shareAction = "save-research-summary";
    save.disabled = aiRunning;
    container.appendChild(save);
  }

  function renderExport(container, project) {
    addHeading(container, viewMeta.export);
    addNotice(container);
    var renderer = window.PatentShareRenderer;
    if (!renderer) { renderPlaceholder(container, "export", project); return; }
    var result = renderer.render(project);
    var summary = makeElement("div", "share-export-summary");
    summary.appendChild(makeElement("strong", "", "HTML 导出检查"));
    summary.appendChild(makeElement("p", "", "" + project.patents.length + " 篇专利 · " + Math.ceil(result.size / 1024) + " KB · 离线 CSS 已内联，无外部依赖"));
    container.appendChild(summary);
    var hardBlockFindings = result.findings.filter(function (f) { return /密钥|Token|Cookie/.test(f); });
    var softWarningFindings = result.findings.filter(function (f) { return !/密钥|Token|Cookie/.test(f); });
    var canExport = project.patents.length > 0 && !aiRunning && hardBlockFindings.length === 0;
    var action = makeElement("button", "share-primary-action", "保存 HTML");
    action.type = "button";
    action.dataset.shareAction = "save-html";
    action.disabled = !canExport;
    container.appendChild(action);
    if (hardBlockFindings.length) {
      container.appendChild(makeElement("div", "share-inline-notice error", "导出已阻止：" + hardBlockFindings.join("；")));
    } else if (softWarningFindings.length) {
      container.appendChild(makeElement("div", "share-inline-notice", "导出前提示：" + softWarningFindings.join("；") + "。点击「保存 HTML」后将弹确认框，确认后可继续导出。"));
    } else if (project.patents.length === 0) {
      container.appendChild(makeElement("div", "share-inline-notice error", "请先加入至少一篇专利。"));
    } else {
      container.appendChild(makeElement("div", "share-inline-notice", "未发现密钥、本机路径或本地代理地址。保存后可在无网络环境打开分享给研发团队。"));
    }
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
    hideAnnotationFloating();
    hideAnnotationContextMenu();
    container.textContent = "";
    // 按当前视图打修饰类，供 CSS 定向（如审核页启用独立滚动容器以冻结标题+导航条）
    container.className = "share-workspace-view" + (activeView ? " share-workspace-view--" + activeView : "");
    if (activeView === "overview") renderOverview(container, project);
    else if (activeView === "sources") renderSources(container, project);
    else if (activeView === "review") renderReview(container, project);
    else if (activeView === "modules") renderModules(container, project);
    else if (activeView === "insights") renderInsights(container, project);
    else if (activeView === "prompts") renderPrompts(container, project);
    else if (activeView === "preview") renderPreview(container, project);
    else if (activeView === "export") renderExport(container, project);
    else renderPlaceholder(container, activeView, project);

    var navItems = document.querySelectorAll(".share-workspace-nav-item");
    for (var i = 0; i < navItems.length; i++) {
      navItems[i].classList.toggle("active", navItems[i].dataset.shareView === activeView);
    }
    var promptsBtn = byId("share-prompts-settings-btn");
    if (promptsBtn) {
      promptsBtn.classList.toggle("active", activeView === "prompts");
    }
    updateProjectStatus();
    if (activeView === "review") {
      bindReviewScrollSpy();
      enhanceReviewBasicFields();
    }
  }

  // 数据审核页：悬浮导航条 active 状态与滚动进度
  // 审核页改为独立滚动容器（.share-workspace-view--review），滚动事件与坐标
  // 均以该容器为准，而非 window。这样 sticky 标题/导航条不受 body overflow 影响。
  var reviewScrollSpyBound = false;
  var reviewScrollSpyEl = null;
  var reviewScrollSpyHandler = null;
  function bindReviewScrollSpy() {
    var navBar = document.querySelector(".share-review-nav");
    if (!navBar) return;
    var sections = document.querySelectorAll(".share-review-section[id^='review-section-']");
    var navBtns = navBar.querySelectorAll("[data-review-nav]");
    if (!sections.length || !navBtns.length) return;
    var progress = navBar.querySelector(".share-review-nav-progress");
    var scrollEl = byId("share-workspace-view");

    function updateActive() {
      if (!scrollEl) return;
      var viewH = scrollEl.clientHeight;
      // 以滚动容器为参考系：section 顶部相对容器顶边的偏移。
      var containerTop = scrollEl.getBoundingClientRect().top;
      var offset = viewH * 0.3;
      var activeId = null;
      sections.forEach(function (sec) {
        var top = sec.getBoundingClientRect().top - containerTop;
        if (top <= offset) activeId = sec.id;
      });
      var scrollableH = scrollEl.scrollHeight - viewH;
      var pct = scrollableH > 0 ? Math.min(100, Math.max(0, (scrollEl.scrollTop / scrollableH) * 100)) : 0;
      if (progress) progress.style.width = pct + "%";
      navBtns.forEach(function (btn) {
        btn.classList.toggle("active", activeId === "review-section-" + btn.dataset.reviewNav);
      });
    }

    // 重新绑定时先解绑上一轮：scroll 监听挂在滚动容器上，resize 挂在 window。
    if (reviewScrollSpyBound && reviewScrollSpyHandler) {
      if (reviewScrollSpyEl) reviewScrollSpyEl.removeEventListener("scroll", reviewScrollSpyHandler);
      window.removeEventListener("resize", reviewScrollSpyHandler);
      if (reviewScrollSpyEl === window) window.removeEventListener("scroll", reviewScrollSpyHandler);
    }
    reviewScrollSpyHandler = updateActive;
    reviewScrollSpyEl = scrollEl || window;
    if (scrollEl) {
      scrollEl.addEventListener("scroll", updateActive, { passive: true });
    } else {
      window.addEventListener("scroll", updateActive, { passive: true });
    }
    window.addEventListener("resize", updateActive, { passive: true });
    reviewScrollSpyBound = true;
    updateActive();
  }

  // ── 基本信息/分类号字段卡片：固定尺寸 + 折叠 + 悬浮查看完整内容 ──
  // 卡片高度固定（值折叠为 3 行），内容溢出时点击值打开悬浮窗查看完整文本。
  var _reviewFieldPopover = null;
  function enhanceReviewBasicFields() {
    var vals = document.querySelectorAll(".review-basic-val");
    Array.prototype.forEach.call(vals, function (valEl) {
      // 折叠态下滚动高度大于可见高度，说明内容被截断
      if (valEl.scrollHeight - valEl.clientHeight <= 1) return;
      var item = valEl.closest ? valEl.closest(".review-basic-item") : null;
      var labelEl = item ? item.querySelector(".review-basic-label") : null;
      var label = labelEl ? labelEl.textContent.trim() : "字段内容";
      var fullText = valEl.textContent || "";
      if (item) item.classList.add("has-overflow");
      valEl.setAttribute("role", "button");
      valEl.setAttribute("tabindex", "0");
      valEl.title = "点击查看完整内容";
      valEl.addEventListener("click", function () {
        showFieldPopover(label, fullText, valEl.getBoundingClientRect());
      });
      valEl.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          showFieldPopover(label, fullText, valEl.getBoundingClientRect());
        }
      });
    });
  }
  function closeFieldPopover() {
    if (!_reviewFieldPopover) return;
    var ref = _reviewFieldPopover;
    document.removeEventListener("keydown", ref.keyHandler);
    if (ref.backdrop.parentNode) ref.backdrop.parentNode.removeChild(ref.backdrop);
    _reviewFieldPopover = null;
  }
  function showFieldPopover(label, text, anchorRect) {
    closeFieldPopover();
    var backdrop = makeElement("div", "review-field-popover-backdrop");
    var pop = makeElement("div", "review-field-popover");
    var head = makeElement("div", "review-field-popover-head");
    head.appendChild(makeElement("span", "review-field-popover-label", label));
    var closeBtn = makeElement("button", "review-field-popover-close", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "关闭");
    head.appendChild(closeBtn);
    var body = makeElement("div", "review-field-popover-body");
    body.textContent = text; // 纯文本，避免长内容/特殊字符引发安全问题
    pop.appendChild(head);
    pop.appendChild(body);
    backdrop.appendChild(pop);
    document.body.appendChild(backdrop);

    // 先隐藏定位，避免初始位置闪现
    pop.style.visibility = "hidden";
    requestAnimationFrame(function () {
      if (!pop.isConnected) return;
      var vw = window.innerWidth, vh = window.innerHeight, M = 12, GAP = 8;
      var pw = pop.offsetWidth, ph = pop.offsetHeight;
      var centerX = anchorRect.left + anchorRect.width / 2;
      var left = Math.max(M, Math.min(centerX - pw / 2, vw - pw - M));
      var want = Math.min(ph, vh * 0.6);
      var spaceBelow = vh - anchorRect.bottom - GAP - M;
      var spaceAbove = anchorRect.top - GAP - M;
      var top;
      if (spaceBelow >= want) {
        top = anchorRect.bottom + GAP;
      } else if (spaceAbove >= want) {
        top = Math.max(M, anchorRect.top - GAP - ph);
      } else if (spaceBelow >= spaceAbove) {
        top = anchorRect.bottom + GAP;
        if (top + ph > vh - M) top = Math.max(M, vh - M - ph);
      } else {
        top = Math.max(M, anchorRect.top - GAP - ph);
      }
      pop.style.left = left + "px";
      pop.style.top = top + "px";
      pop.style.visibility = "";
      pop.classList.add("open");
      closeBtn.focus();
    });

    function onKey(e) { if (e.key === "Escape") closeFieldPopover(); }
    document.addEventListener("keydown", onKey);
    closeBtn.addEventListener("click", closeFieldPopover);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeFieldPopover();
    });
    _reviewFieldPopover = { backdrop: backdrop, pop: pop, keyHandler: onKey };
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
    aiRunning = false;
  }

  // 把当前主应用打开的专利加入激活分享项目。quiet=true 时仅返回结果不触发 UI 渲染
  // （供主应用专利详情页"加入分享项目"按钮调用）。
  function addCurrentPatent(options) {
    var quiet = options && options.quiet;
    var adapter = window.PatentShareSources;
    var store = window.PatentShareStore;
    if (!store) return { ok: false, reason: "store-unavailable" };
    if (store.getPersistenceState && store.getPersistenceState().mode === "loading") {
      if (!quiet) { setNotice("正在恢复本机分享项目，请稍候再加入材料。", true); render(); }
      return { ok: false, reason: "loading" };
    }
    var record = adapter && adapter.currentPatentSnapshot ? adapter.currentPatentSnapshot() : null;
    if (!record) {
      if (!quiet) { setNotice("未检测到当前专利原文。请先切换到「专利原文」查询并打开一篇专利，再回到分享工作台。", true); render(); }
      return { ok: false, reason: "no-current-patent" };
    }
    var result = store.addPatent(record);
    // 异步抓取 GP 附图（后台进行，不阻塞 UI，完成后自动持久化并刷新）
    if (result.ok && record._pendingDrawings && window.PatentShareSources && window.PatentShareSources.hydrateSnapshotDrawings) {
      if (!quiet) setNotice("已复制专利快照，正在抓取附图...", false);
      window.PatentShareSources.hydrateSnapshotDrawings(result.record, store).then(function () {
        if (!quiet) { setNotice("已复制当前专利原文快照（含附图、说明书、权利要求引用、分类号等完整字段）。", false); render(); }
      }).catch(function () { /* 附图抓取失败不影响主流程 */ });
    } else if (!quiet) {
      if (!result.ok && result.reason === "duplicate") {
        setNotice("该专利已在当前分享项目中，无需重复加入。", true);
      } else if (!result.ok) {
        setNotice("当前专利数据不完整，暂时无法加入分享项目。", true);
      } else {
        setNotice("已复制当前专利原文快照（含说明书、权利要求引用、分类号等完整字段）。后续可在「研发洞察」运行AI分析。", false);
        activeView = "sources";
      }
      render();
    }
    return { ok: !!result.ok, reason: result.reason, patentNumber: record.patentNumber, projectId: currentProject().id, projectName: currentProject().name };
  }

  function newProject() {
    if (window.PatentShareStore && window.PatentShareStore.getPersistenceState && window.PatentShareStore.getPersistenceState().mode === "loading") {
      setNotice("正在恢复本机分享项目，请稍候再新建项目。", true);
      render();
      return;
    }
    var project = currentProject();
    if (project && project.patents.length > 0) {
      PatentShareUI.confirm("新建项目会清空当前分享工作台中的材料草稿，是否继续？").then(function(confirmed) {
        if (confirmed) {
          window.PatentShareStore.newProject();
          activeView = "overview";
          setNotice("已创建新的空分享项目。", false);
          render();
        }
      });
      return;
    }
    window.PatentShareStore.newProject();
    activeView = "overview";
    setNotice("已创建新的空分享项目。", false);
    render();
  }

  function openProject(projectId) {
    var store = window.PatentShareStore;
    if (!store || !store.selectProject) return;
    if (store.getPersistenceState().mode === "loading") {
      setNotice("正在恢复本机分享项目，请稍候再切换。", true);
      render();
      return;
    }
    setNotice("正在打开分享项目...", false);
    render();
    store.selectProject(projectId).then(function (result) {
      if (!result || !result.ok) setNotice("未能打开该项目；它可能已不可用。", true);
      else setNotice("已打开分享项目：" + result.project.name + "。", false);
      activeView = "overview";
      render();
    });
  }

  function deleteProject(projectId, projectName) {
    var store = window.PatentShareStore;
    if (!store || !store.deleteProject) return;
    if (store.getPersistenceState().mode === "loading") {
      setNotice("正在恢复本机分享项目，请稍候再删除。", true);
      render();
      return;
    }
    PatentShareUI.confirm('确定要删除分享项目"' + (projectName || "未命名") + '"吗？该项目的所有专利与加工字段将被永久删除，此操作不可撤销。').then(function (confirmed) {
      if (!confirmed) return;
      setNotice("正在删除分享项目...", false);
      render();
      store.deleteProject(projectId).then(function (result) {
        if (result && result.ok) {
          setNotice("已删除分享项目。", false);
          activeView = "overview";
        } else {
          setNotice("删除失败：" + (result && result.reason ? result.reason : "未知错误"), true);
        }
        render();
      });
    });
  }

  function runTranslate(patentId, kind) {
    var AI = window.PatentShareAI;
    var project = currentProject();
    if (!AI || !AI.translatePatentText || !project || aiRunning) return;
    var patent = project.patents.find(function (p) { return p.id === patentId; });
    if (!patent) { setNotice("未找到目标专利。", true); render(); return; }
    var text = "";
    var label = kind === "claims" ? "权利要求" : "说明书";
    if (kind === "claims") {
      if (!patent.claims || !patent.claims.length) { setNotice("该专利没有权利要求内容，无法翻译。", true); render(); return; }
      text = patent.claims.map(function (c) { return (c.number ? c.number + ". " : "") + (c.text || ""); }).join("\n\n");
    } else {
      if (!patent.description) { setNotice("该专利没有说明书内容，无法翻译。", true); render(); return; }
      text = patent.description;
    }
    aiRunning = true;
    setNotice("AI正在翻译" + label + "，内容较长时请耐心等候...", false);
    render();
    AI.translatePatentText(text, kind).then(function (result) {
      if (result.ok) {
        window.PatentShareStore.setPatentTranslation(patentId, kind, result.content, { model: result.model, generatedAt: result.generatedAt });
        setNotice("已生成" + label + "中文翻译，分享HTML将以双栏对照展示。", false);
      } else {
        setNotice(label + "翻译失败：" + (result.error || "未知错误"), true);
      }
    }).catch(function (err) {
      setNotice(label + "翻译出错：" + (err && err.message ? err.message : String(err)), true);
    }).then(function () {
      aiRunning = false;
      render();
    });
  }

  function saveHtml() {
    var project = currentProject();
    var renderer = window.PatentShareRenderer;
    if (!project || !renderer || !project.patents.length) {
      setNotice("请先加入至少一篇专利，再导出分享 HTML。", true);
      render();
      return;
    }
    var result = renderer.render(project);
    // 安全扫描：密钥、令牌内容硬阻断；未审核 AI 与路径类仅警告，不阻断导出。
    var hardBlock = result.findings.some(function (f) { return /密钥|Token|Cookie/.test(f); });
    if (hardBlock) {
      setNotice("导出已阻止：" + result.findings.join("；"), true);
      render();
      return;
    }
    var softWarnings = result.findings.filter(function (f) { return !/密钥|Token|Cookie/.test(f); });
    function doExport() {
      var baseName = (project.name || "patent-share").replace(/[<>:"/\\|?*]/g, "-").trim().slice(0, 60) || "patent-share";
      var bridge = window.electronAPI && window.electronAPI.saveShareHtml;
      if (bridge) {
        bridge(result.html, baseName + ".html").then(function (saved) {
          setNotice(saved && saved.canceled ? "已取消保存。" : "分享 HTML 已保存到本机，可发送给研发团队分享。", false);
          render();
        }).catch(function (error) {
          setNotice(error && error.message ? error.message : "保存 HTML 失败。", true);
          render();
        });
        return;
      }
      var blobUrl = URL.createObjectURL(new Blob([result.html], { type: "text/html;charset=utf-8" }));
      var link = document.createElement("a");
      link.href = blobUrl;
      link.download = baseName + ".html";
      link.click();
      setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 1000);
      setNotice("分享 HTML 已生成并开始下载。", false);
      render();
    }
    if (softWarnings.length) {
      PatentShareUI.confirm("导出前提示：" + softWarnings.join("；") + "\n\n分享 HTML 为离线自包含文件，不会自动外发数据。是否继续导出？").then(function (yes) {
        if (!yes) { setNotice("已取消导出。", false); render(); return; }
        doExport();
      });
      return;
    }
    doExport();
  }

  function runAIAnalysis(patentId, type) {
    var AI = window.PatentShareAI;
    var project = currentProject();
    if (!AI || !project || aiRunning) return;
    var provider = AI.getActiveAIProvider();
    if (!provider) { setNotice("未检测到可用的AI配置，请先在设置中配置AI接口。", true); render(); return; }
    aiRunning = true;
    setNotice("AI正在分析中，请稍候...", false);
    render();

    var patent = project.patents.find(function(p) { return p.id === patentId; });
    if (!patent) { aiRunning = false; setNotice("未找到目标专利。", true); render(); return; }

    var promise;
    if (type === "summary") {
      promise = AI.generatePatentSummary(patent, project.brief).then(function(result) {
        if (result.ok) {
          window.PatentShareStore.setAIAnalysis(patentId, "summary", result);
          setNotice("已生成" + patent.patentNumber + "的技术解读草稿，请审核后确认用于分享。", false);
        } else {
          setNotice("AI分析失败: " + (result.error || "未知错误"), true);
        }
      });
    } else if (type === "elements") {
      promise = AI.generateTechnicalElements(patent, project.brief).then(function(result) {
        if (result.ok) {
          window.PatentShareStore.setAIAnalysis(patentId, "elements", result);
          setNotice("已提取" + patent.patentNumber + "的技术要素和系统结构。", false);
        } else {
          setNotice("AI技术要素提取失败: " + (result.error || "未知错误"), true);
        }
      });
    } else if (type === "embodiments") {
      promise = AI.generateEmbodiments(patent, project.brief).then(function(result) {
        if (result.ok) {
          window.PatentShareStore.setAIAnalysis(patentId, "embodiments", result);
          setNotice("已生成" + patent.patentNumber + "的实施例分析。", false);
        } else {
          setNotice("AI实施例分析失败: " + (result.error || "未知错误"), true);
        }
      });
    }
    promise.catch(function(err) {
      setNotice("AI分析出错: " + (err && err.message ? err.message : String(err)), true);
    }).then(function() {
      aiRunning = false;
      render();
    });
  }

  function runAIProcessedField(patentId, fieldId) {
    var AI = window.PatentShareAI;
    var project = currentProject();
    if (!AI || !project || aiRunning) return;
    var provider = AI.getActiveAIProvider();
    if (!provider) { setNotice("未检测到可用的AI配置，请先在设置中配置AI接口。", true); render(); return; }
    var patent = project.patents.find(function (p) { return p.id === patentId; });
    if (!patent) { setNotice("未找到目标专利。", true); render(); return; }
    var field = patent.processedFields && patent.processedFields.find(function (f) { return f.id === fieldId; });
    if (!field) { setNotice("未找到目标加工字段。", true); render(); return; }
    aiRunning = true;
    setNotice("AI正在抽取「" + field.label + "」，请稍候...", false);
    render();
    AI.generateProcessedField(patent, field, project.brief).then(function (result) {
      if (result.ok) {
        window.PatentShareStore.updateProcessedField(patentId, fieldId, {
          value: result.value,
          source: "ai",
          model: result.model,
          generatedAt: result.generatedAt,
          reviewState: "pending",
        });
        setNotice("AI已抽取「" + field.label + "」内容，请在内容加工与审核中确认后分享。", false);
      } else {
        setNotice("AI抽取失败: " + (result.error || "未知错误"), true);
      }
    }).catch(function (err) {
      setNotice("AI抽取出错: " + (err && err.message ? err.message : String(err)), true);
    }).then(function () {
      aiRunning = false;
      render();
    });
  }

  function runAIComparison() {
    var AI = window.PatentShareAI;
    var project = currentProject();
    if (!AI || !project || project.patents.length < 2 || aiRunning) return;
    var provider = AI.getActiveAIProvider();
    if (!provider) { setNotice("未检测到可用的AI配置，请先在设置中配置AI接口。", true); render(); return; }
    aiRunning = true;
    setNotice("AI正在进行多专利对比分析（" + project.patents.length + "篇），请稍候...", false);
    render();

    AI.generateMultiPatentComparison(project.patents, project.brief).then(function(result) {
      if (result.ok) {
        window.PatentShareStore.setProjectAIAnalysis("comparison", result);
        setNotice("已生成" + project.patents.length + "篇专利的技术路线对比分析。", false);
      } else {
        setNotice("AI对比分析失败: " + (result.error || "未知错误"), true);
      }
    }).catch(function(err) {
      setNotice("AI对比出错: " + (err && err.message ? err.message : String(err)), true);
    }).then(function() {
      aiRunning = false;
      render();
    });
  }

  function runAIAnalyzeAll() {
    var AI = window.PatentShareAI;
    var project = currentProject();
    if (!AI || !project || project.patents.length === 0 || aiRunning) return;
    var provider = AI.getActiveAIProvider();
    if (!provider) { setNotice("未检测到可用的AI配置，请先在设置中配置AI接口。", true); render(); return; }
    aiRunning = true;
    var total = project.patents.length * 2 + (project.patents.length >= 2 ? 1 : 0);
    var completed = 0;
    var failed = 0;
    setNotice("AI批量分析开始：共" + total + "项任务（每篇专利摘要分析+技术要素" + (project.patents.length >= 2 ? "+多专利对比" : "") + "）...", false);
    render();

    var tasks = project.patents.map(function(patent) {
      return AI.generatePatentSummary(patent, project.brief).then(function(result) {
        if (result.ok) window.PatentShareStore.setAIAnalysis(patent.id, "summary", result);
        else failed++;
        completed++;
        setNotice("AI批量分析进度: " + completed + "/" + total + "...", false);
        return AI.generateTechnicalElements(patent, project.brief);
      }).then(function(result) {
        if (result.ok) window.PatentShareStore.setAIAnalysis(patent.id, "elements", result);
        else failed++;
        completed++;
        setNotice("AI批量分析进度: " + completed + "/" + total + "...", false);
      });
    });
    if (project.patents.length >= 2) {
      tasks.push(Promise.resolve().then(function() {
        return AI.generateMultiPatentComparison(project.patents, project.brief);
      }).then(function(result) {
        if (result.ok) window.PatentShareStore.setProjectAIAnalysis("comparison", result);
        else failed++;
        completed++;
      }));
    }
    Promise.all(tasks).then(function() {
      var resultText = failed ? "完成，其中" + failed + "项失败" : "全部完成";
      setNotice("AI批量分析" + resultText + "。所有成功结果仍需人工审核后才会进入分享。", failed > 0);
    }).catch(function(err) {
      setNotice("AI批量分析部分出错: " + (err && err.message ? err.message : String(err)), true);
    }).then(function() {
      aiRunning = false;
      render();
    });
  }

  // ── 批量 AI 处理 ──
  // 解决"一次输入 N 篇专利后逐篇逐字段点击"的痛点：统一勾选字段类型 + 目标专利，
  // 并发执行（默认 3，可调 1-6），实时显示进度，可中途取消。
  // 取消后已完成的保留，未开始的标记 skipped（不回滚已写入的结果）。
  function buildBatchPanel(project, hasAI) {
    var panel = makeElement("section", "share-batch-panel");
    var head = makeElement("div", "share-batch-head");
    head.appendChild(makeElement("h4", "", "批量 AI 处理"));
    head.appendChild(makeElement("p", "share-module-hint", "统一选定要处理的字段类型与目标专利，并发执行；可在进度面板中查看每项状态，支持中途取消。"));
    panel.appendChild(head);

    var running = batchState && batchState.running;
    var patents = project.patents || [];

    // 配置区（运行中禁用）
    var configRow = makeElement("div", "share-batch-config");
    configRow.appendChild(makeElement("div", "share-batch-config-label", "处理字段："));
    var fieldDefs = [
      { key: "summary", label: "技术解读", needsDesc: false },
      { key: "elements", label: "技术要素", needsDesc: false },
      { key: "embodiments", label: "实施例与验证", needsDesc: true },
      { key: "processed", label: "加工字段（每篇已有的全部加工字段）", needsDesc: false },
    ];
    var selectedFields = (batchState && batchState.fields) || { summary: true, elements: true, embodiments: false, processed: false };
    fieldDefs.forEach(function (fd) {
      var id = "batch-field-" + fd.key;
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = id;
      cb.className = "share-batch-cb";
      cb.checked = !!selectedFields[fd.key];
      cb.disabled = running;
      cb.dataset.batchField = fd.key;
      var lbl = makeElement("label", "share-batch-cb-label", fd.label);
      lbl.htmlFor = id;
      lbl.insertBefore(cb, lbl.firstChild);
      // 缺说明书的 embodiments 提示
      if (fd.needsDesc && patents.some(function (p) { return !p.description; })) {
        lbl.appendChild(makeElement("span", "share-batch-cb-hint", "（部分专利无说明书将跳过）"));
      }
      configRow.appendChild(lbl);
    });

    // 目标专利选择（运行中禁用，默认全选）
    configRow.appendChild(makeElement("div", "share-batch-config-label", "目标专利："));
    var patentBox = makeElement("div", "share-batch-patent-list");
    var selectedPatents = (batchState && batchState.patentIds) || patents.map(function (p) { return p.id; });
    if (!patents.length) {
      patentBox.appendChild(makeElement("div", "share-batch-empty", "尚未加入专利。请先在「专利与材料」中导入。"));
    } else {
      // 全选 / 取消全选
      var allCb = document.createElement("input");
      allCb.type = "checkbox";
      allCb.id = "batch-patent-all";
      allCb.className = "share-batch-cb";
      allCb.checked = selectedPatents.length === patents.length;
      allCb.disabled = running;
      allCb.dataset.batchPatentAll = "1";
      var allLbl = makeElement("label", "share-batch-cb-label share-batch-cb-all", "全选 (" + patents.length + " 篇)");
      allLbl.htmlFor = "batch-patent-all";
      allLbl.insertBefore(allCb, allLbl.firstChild);
      patentBox.appendChild(allLbl);
      patents.forEach(function (p) {
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.id = "batch-patent-" + p.id;
        cb.className = "share-batch-cb";
        cb.checked = selectedPatents.indexOf(p.id) >= 0;
        cb.disabled = running;
        cb.dataset.batchPatent = p.id;
        var lbl = makeElement("label", "share-batch-cb-label", (p.patentNumber || "未编号") + " · " + (p.title || "未提供标题"));
        lbl.htmlFor = "batch-patent-" + p.id;
        lbl.insertBefore(cb, lbl.firstChild);
        patentBox.appendChild(lbl);
      });
    }
    configRow.appendChild(patentBox);

    // 并发数滑块
    var concRow = makeElement("div", "share-batch-conc");
    concRow.appendChild(makeElement("span", "share-batch-config-label", "并发数："));
    var concInput = document.createElement("input");
    concInput.type = "range";
    concInput.min = "1";
    concInput.max = "20";
    concInput.value = String((batchState && batchState.concurrency) || 3);
    concInput.className = "share-batch-conc-range";
    concInput.disabled = running;
    concInput.dataset.batchConc = "1";
    var concVal = makeElement("span", "share-batch-conc-val", concInput.value + " 个并发");
    concInput.addEventListener("input", function () { concVal.textContent = concInput.value + " 个并发"; });
    concRow.appendChild(concInput);
    concRow.appendChild(concVal);
    configRow.appendChild(concRow);

    // 启动 / 取消按钮
    var btnRow = makeElement("div", "share-batch-btn-row");
    var startBtn = makeElement("button", "share-primary-action", "开始批量处理");
    startBtn.type = "button";
    startBtn.dataset.shareAction = "batch-start";
    startBtn.disabled = running || !hasAI || !patents.length;
    btnRow.appendChild(startBtn);
    if (running) {
      var cancelBtn = makeElement("button", "share-secondary-action", "取消（已完成保留，未开始跳过）");
      cancelBtn.type = "button";
      cancelBtn.dataset.shareAction = "batch-cancel";
      btnRow.appendChild(cancelBtn);
    }
    configRow.appendChild(btnRow);
    panel.appendChild(configRow);

    // 进度面板（运行中或完成后展示）
    if (batchState && batchState.tasks && batchState.tasks.length) {
      panel.appendChild(buildBatchProgressPanel());
    }
    return panel;
  }

  function buildBatchProgressPanel() {
    var st = batchState;
    var wrap = makeElement("div", "share-batch-progress");
    var total = st.tasks.length;
    var done = 0, failed = 0, skipped = 0, running = 0, pending = 0;
    st.tasks.forEach(function (t) {
      if (t.status === "done") done++;
      else if (t.status === "failed") failed++;
      else if (t.status === "skipped") skipped++;
      else if (t.status === "running") running++;
      else pending++;
    });
    var finished = done + failed + skipped;
    var pct = total ? Math.round((finished / total) * 100) : 0;

    var head = makeElement("div", "share-batch-progress-head");
    head.appendChild(makeElement("span", "share-batch-progress-title", (st.running ? "处理中" : "已结束") + " · " + finished + "/" + total + "（" + pct + "%）"));
    var stats = makeElement("span", "share-batch-progress-stats");
    stats.appendChild(makeElement("span", "share-batch-stat-done", "✓ " + done));
    if (failed) stats.appendChild(makeElement("span", "share-batch-stat-failed", "✗ " + failed));
    if (skipped) stats.appendChild(makeElement("span", "share-batch-stat-skipped", "⊘ " + skipped));
    if (running) stats.appendChild(makeElement("span", "share-batch-stat-running", "▶ " + running));
    if (pending) stats.appendChild(makeElement("span", "share-batch-stat-pending", "○ " + pending));
    head.appendChild(stats);
    wrap.appendChild(head);

    var bar = makeElement("div", "share-batch-bar");
    var fill = makeElement("div", "share-batch-bar-fill");
    fill.style.width = pct + "%";
    bar.appendChild(fill);
    wrap.appendChild(bar);

    // 每项任务状态（按专利分组）
    var list = makeElement("div", "share-batch-task-list");
    st.tasks.forEach(function (t) {
      var row = makeElement("div", "share-batch-task-row share-batch-task-" + t.status);
      var icon = t.status === "done" ? "✓" : t.status === "failed" ? "✗" : t.status === "skipped" ? "⊘" : t.status === "running" ? "▶" : "○";
      row.appendChild(makeElement("span", "share-batch-task-icon", icon));
      row.appendChild(makeElement("span", "share-batch-task-label", t.label));
      if (t.status === "failed" && t.error) {
        row.appendChild(makeElement("span", "share-batch-task-error", t.error));
      }
      list.appendChild(row);
    });
    wrap.appendChild(list);
    return wrap;
  }

  // 启动批量处理：构建任务队列 → 并发池执行 → 实时更新进度
  function runAIBatch() {
    var AI = window.PatentShareAI;
    var project = currentProject();
    if (!AI || !project || aiRunning) return;
    var provider = AI.getActiveAIProvider();
    if (!provider) { setNotice("未检测到可用的AI配置，请先在设置中配置AI接口。", true); render(); return; }

    // 从 DOM 读取用户选择（render 后的 checkbox 状态）
    var fields = {};
    document.querySelectorAll("[data-batch-field]").forEach(function (cb) {
      fields[cb.dataset.batchField] = cb.checked;
    });
    var patentIds = [];
    document.querySelectorAll("[data-batch-patent]").forEach(function (cb) {
      if (cb.checked) patentIds.push(cb.dataset.batchPatent);
    });
    var concurrency = 3;
    var concEl = document.querySelector("[data-batch-conc]");
    if (concEl) concurrency = Math.max(1, Math.min(20, parseInt(concEl.value, 10) || 3));

    if (!fields.summary && !fields.elements && !fields.embodiments && !fields.processed) {
      setNotice("请至少勾选一个要处理的字段类型。", true);
      render();
      return;
    }
    if (!patentIds.length) {
      setNotice("请至少选择一篇目标专利。", true);
      render();
      return;
    }

    // 构建任务队列
    var tasks = [];
    var patentsById = {};
    project.patents.forEach(function (p) { patentsById[p.id] = p; });
    patentIds.forEach(function (pid) {
      var patent = patentsById[pid];
      if (!patent) return;
      if (fields.summary) tasks.push({ patentId: pid, type: "summary", label: patent.patentNumber + " · 技术解读", status: "pending", error: "" });
      if (fields.elements) tasks.push({ patentId: pid, type: "elements", label: patent.patentNumber + " · 技术要素", status: "pending", error: "" });
      if (fields.embodiments) {
        if (patent.description) tasks.push({ patentId: pid, type: "embodiments", label: patent.patentNumber + " · 实施例与验证", status: "pending", error: "" });
        else tasks.push({ patentId: pid, type: "embodiments", label: patent.patentNumber + " · 实施例（无说明书，跳过）", status: "skipped", error: "" });
      }
      if (fields.processed) {
        var pfs = patent.processedFields || [];
        if (!pfs.length) {
          tasks.push({ patentId: pid, type: "processed", fieldId: null, label: patent.patentNumber + " · 加工字段（无字段，跳过）", status: "skipped", error: "" });
        } else {
          pfs.forEach(function (pf) {
            if (!pf.prompt) {
              tasks.push({ patentId: pid, type: "processed", fieldId: pf.id, label: patent.patentNumber + " · " + pf.label + "（无提示词，跳过）", status: "skipped", error: "" });
            } else {
              tasks.push({ patentId: pid, type: "processed", fieldId: pf.id, label: patent.patentNumber + " · " + pf.label, status: "pending", error: "" });
            }
          });
        }
      }
    });

    if (!tasks.length) {
      setNotice("没有可执行的任务，请检查选择。", true);
      return;
    }

    batchState = {
      running: true,
      cancelled: false,
      fields: fields,
      patentIds: patentIds,
      concurrency: concurrency,
      tasks: tasks,
      startedAt: new Date().toISOString(),
    };
    aiRunning = true;
    setNotice("批量处理已启动：" + tasks.length + " 项任务，并发 " + concurrency + "。", false);
    render();

    // 并发池：维护 concurrency 个 worker，从队列取 pending 任务执行
    var queue = tasks.slice();
    function nextTask() {
      if (batchState.cancelled) return null;
      for (var i = 0; i < queue.length; i++) {
        if (queue[i].status === "pending") {
          queue[i].status = "running";
          return queue[i];
        }
      }
      return null;
    }

    function executeTask(task) {
      var patent = patentsById[task.patentId];
      var promise;
      if (task.type === "summary") {
        promise = AI.generatePatentSummary(patent, project.brief).then(function (r) {
          if (r.ok) { window.PatentShareStore.setAIAnalysis(task.patentId, "summary", r); task.status = "done"; }
          else { task.status = "failed"; task.error = r.error || "未知错误"; }
        });
      } else if (task.type === "elements") {
        promise = AI.generateTechnicalElements(patent, project.brief).then(function (r) {
          if (r.ok) { window.PatentShareStore.setAIAnalysis(task.patentId, "elements", r); task.status = "done"; }
          else { task.status = "failed"; task.error = r.error || "未知错误"; }
        });
      } else if (task.type === "embodiments") {
        promise = AI.generateEmbodiments(patent, project.brief).then(function (r) {
          if (r.ok) { window.PatentShareStore.setAIAnalysis(task.patentId, "embodiments", r); task.status = "done"; }
          else { task.status = "failed"; task.error = r.error || "未知错误"; }
        });
      } else if (task.type === "processed") {
        var field = patent.processedFields && patent.processedFields.find(function (f) { return f.id === task.fieldId; });
        if (!field) { task.status = "skipped"; return Promise.resolve(); }
        promise = AI.generateProcessedField(patent, field, project.brief).then(function (r) {
          if (r.ok) {
            window.PatentShareStore.updateProcessedField(task.patentId, task.fieldId, {
              value: r.content, source: "ai", model: r.model, generatedAt: r.generatedAt, reviewState: "pending",
            });
            task.status = "done";
          } else { task.status = "failed"; task.error = r.error || "未知错误"; }
        });
      }
      return promise.catch(function (err) {
        task.status = "failed";
        task.error = err && err.message ? err.message : String(err);
      });
    }

    // 每个 worker 循环取任务执行，直到队列空或被取消
    function worker() {
      if (batchState.cancelled) return Promise.resolve();
      var task = nextTask();
      if (!task) return Promise.resolve();
      renderBatchOnly(); // 显示 running 状态
      return executeTask(task).then(function () {
        renderBatchOnly();
        return worker();
      });
    }

    var workers = [];
    for (var i = 0; i < concurrency; i++) workers.push(worker());
    Promise.all(workers).then(function () {
      // 取消后，把剩余 pending 标记 skipped
      if (batchState.cancelled) {
        batchState.tasks.forEach(function (t) { if (t.status === "pending" || t.status === "running") t.status = "skipped"; });
      }
      batchState.running = false;
      aiRunning = false;
      var done = batchState.tasks.filter(function (t) { return t.status === "done"; }).length;
      var failed = batchState.tasks.filter(function (t) { return t.status === "failed"; }).length;
      var skipped = batchState.tasks.filter(function (t) { return t.status === "skipped"; }).length;
      setNotice("批量处理结束：成功 " + done + "，失败 " + failed + (skipped ? "，跳过 " + skipped : "") + "。成功结果仍需人工审核。", failed > 0);
      render();
    });
  }

  // 仅刷新进度面板（不触发完整 render，避免重渲染打断用户在 insights 视图的滚动位置）
  // 但仍要更新进度数字；这里折中：直接重渲染当前视图（render 会保留滚动容器位置）。
  function renderBatchOnly() {
    // 更新 notice 文本
    var st = batchState;
    var done = st.tasks.filter(function (t) { return t.status === "done"; }).length;
    var total = st.tasks.length;
    setNotice("批量处理进度：" + done + "/" + total + " 已完成...", false);
    render();
  }

  function cancelAIBatch() {
    if (!batchState || !batchState.running) return;
    batchState.cancelled = true;
    // 不立即结束；让正在执行的 worker 完成，剩余 pending 会在 Promise.all 后标 skipped
    setNotice("正在取消批量处理，等待当前进行中的任务完成...", false);
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
    var pdfInput = byId("share-pdf-input");
    if (pdfInput) pdfInput.addEventListener("change", function () {
      if (pdfInput.files && pdfInput.files[0]) importPdfFile(pdfInput.files[0]);
    });
    var nav = byId("share-workspace-nav");
    if (nav) nav.addEventListener("click", function (event) {
      var button = event.target.closest ? event.target.closest("[data-share-view]") : null;
      if (!button) return;
      activeView = button.dataset.shareView || "overview";
      notice = null;
      render();
    });
    var promptsSettingsBtn = byId("share-prompts-settings-btn");
    if (promptsSettingsBtn) promptsSettingsBtn.addEventListener("click", function () {
      activeView = "prompts";
      notice = null;
      render();
    });
    var view = byId("share-workspace-view");
    if (view) view.addEventListener("mousedown", function (event) {
      var annoButton = event.target.closest ? event.target.closest("[data-share-action='annotate-text']") : null;
      if (annoButton && annoButton.dataset.annoType !== "clear") event.preventDefault();
    });
    // 选中正文后弹出标注悬浮球（仅左键拖选；右键交给 contextmenu 菜单）
    if (view) view.addEventListener("mouseup", function (event) {
      if (event.button !== 0) return;
      if (event.target.closest && event.target.closest("[data-annotation-ui]")) return;
      setTimeout(function () {
        var sel = window.getSelection();
        var target = getAnnotatableFromSelection(sel);
        if (target) {
          var range = sel.getRangeAt(0);
          var rect = range.getBoundingClientRect();
          if (rect && rect.width > 0 && rect.height > 0) showAnnotationFloating(target, rect);
          else hideAnnotationFloating();
        } else {
          hideAnnotationFloating();
        }
      }, 0);
    });
    // 右键弹出标注菜单
    if (view) view.addEventListener("contextmenu", function (event) {
      var targetEl = event.target.closest ? event.target.closest(".review-annotatable") : null;
      if (!targetEl) return;
      event.preventDefault();
      showAnnotationContextMenu(targetEl, event.clientX, event.clientY);
    });
    // 滚动时隐藏悬浮球与右键菜单（选区可能已滚出视口）
    if (view) view.addEventListener("scroll", function () {
      hideAnnotationFloating();
      hideAnnotationContextMenu();
    }, true);
    // 点击悬浮球/菜单外部或按 Esc 时隐藏
    document.addEventListener("mousedown", function (event) {
      if (annoFloating && !annoFloating.contains(event.target)) hideAnnotationFloating();
      if (annoContextMenu && !annoContextMenu.contains(event.target)) hideAnnotationContextMenu();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { hideAnnotationFloating(); hideAnnotationContextMenu(); }
    });
    // 批量处理面板：全选联动 + 单选反向同步全选状态
    if (view) view.addEventListener("change", function (event) {
      var target = event.target;
      if (!target || !target.dataset) return;
      if (target.dataset.batchPatentAll === "1") {
        var checked = target.checked;
        document.querySelectorAll("[data-batch-patent]").forEach(function (cb) { cb.checked = checked; });
      } else if (target.dataset.batchPatent) {
        var allCb2 = document.querySelector("[data-batch-patent-all]");
        if (allCb2) {
          var cbs = document.querySelectorAll("[data-batch-patent]");
          var allChecked = true;
          cbs.forEach(function (cb) { if (!cb.checked) allChecked = false; });
          allCb2.checked = cbs.length > 0 && allChecked;
        }
      }
    });
    if (view) view.addEventListener("click", function (event) {
      var action = event.target.closest ? event.target.closest("[data-share-action]") : null;
      if (!action) return;
      var actionName = action.dataset.shareAction;
      if (actionName === "add-current") addCurrentPatent();
      if (actionName === "search-add-patents") searchAndAddPatents();
      if (actionName === "module-mode" && action.dataset.moduleId && action.dataset.mode) {
        if (window.PatentShareStore.setModuleMode(action.dataset.moduleId, action.dataset.mode)) {
          setNotice("模块配置已保存。", false);
        } else {
          setNotice("该模块配置不可用。", true);
        }
        render();
        return;
      }
      if (actionName === "annotate-text" && action.dataset.patentId) {
        var annoType = action.dataset.annoType;
        var annoField = action.dataset.annoField;
        var annoKey = action.dataset.annoKey || "";
        // 找到对应的可标注文本元素（兼容悬浮球/右键菜单：按钮不在段落容器内时回退到视图全局查找）
        var annoTextEl = findAnnotatableForAction(action);
        if (!annoTextEl) return;
        var sel = window.getSelection();
        if (annoType === "clear") {
          if (window.PatentShareStore.clearAnnotations) {
            window.PatentShareStore.clearAnnotations(action.dataset.patentId, annoField, annoKey);
            setNotice("已清除该区域标注。", false);
            showAnnotationFeedback(action, "已清除本段标注。", false);
            render();
          }
          return;
        }
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          setNotice("请先选中文本再点击标注按钮。", true);
          showAnnotationFeedback(action, "请先选中正文，再添加标注。", true);
          return;
        }
        var range = sel.getRangeAt(0);
        // 确保选区在标注文本元素内
        if (!annoTextEl.contains(range.commonAncestorContainer)) {
          setNotice("请选中该区域内的文本再标注。", true);
          showAnnotationFeedback(action, "选区必须位于当前正文区域。", true);
          return;
        }
        var selectedText = range.toString();
        var offsets = selectionOffsetsInText(annoTextEl, range);
        if (!offsets || offsets.start >= offsets.end) {
          setNotice("无法定位选中文本。", true);
          showAnnotationFeedback(action, "无法定位选区，请重新选择。", true);
          return;
        }
        var comment = "";
        if (annoType === "comment") {
          PatentShareUI.prompt("请输入注释内容", "").then(function (input) {
            if (!input) { setNotice("未输入注释内容。", true); showAnnotationFeedback(action, "未保存：请填写注释内容。", true); return; }
            comment = input;
            doSaveAnnotation();
          });
        } else {
          doSaveAnnotation();
        }
        function doSaveAnnotation() {
          if (window.PatentShareStore.addAnnotation) {
            window.PatentShareStore.addAnnotation(action.dataset.patentId, {
              field: annoField, key: annoKey, type: annoType,
              start: offsets.start, end: offsets.end, text: selectedText, comment: comment,
            });
            setNotice("标注已保存。", false);
            showAnnotationFeedback(action, "标注已保存。", false);
            render();
          }
        }
        return;
      }
      if (actionName === "remove-annotation" && action.dataset.patentId && action.dataset.annoField && action.dataset.annoId) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        PatentShareUI.confirm("确定要删除该条标注吗？").then(function (confirmed) {
          if (!confirmed) return;
          var removed = window.PatentShareStore.removeAnnotation(action.dataset.patentId, action.dataset.annoField, action.dataset.annoId);
          setNotice(removed ? "已删除该条标注。" : "未找到该标注，可能已被删除。", !removed);
          render();
        });
        return;
      }
      // 审核页悬浮导航跳转
      if (actionName === "review-nav" && action.dataset.reviewNav) {
        var target = document.getElementById("review-section-" + action.dataset.reviewNav);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (actionName === "select-review-patent" && action.dataset.patentIndex != null) {
        var idx = parseInt(action.dataset.patentIndex, 10);
        if (!Number.isNaN(idx)) { reviewPatentIndex = idx; render(); }
      }
      if (actionName === "import-csv") startSpreadsheetImport();
      if (actionName === "import-pdf") startPdfImport();
      if (actionName === "refresh-preview") render();
      if (actionName === "save-html") saveHtml();
      if (actionName === "save-project-brief") {
        window.PatentShareStore.setProjectBrief({
          audience: byId("share-brief-audience") ? byId("share-brief-audience").value : "",
          purpose: byId("share-brief-purpose") ? byId("share-brief-purpose").value : "",
          focus: byId("share-brief-focus") ? byId("share-brief-focus").value : "",
          confidentiality: byId("share-brief-confidentiality") ? byId("share-brief-confidentiality").value : "",
        });
        setNotice("分享设定已保存，后续 AI 草稿会按此对象和重点生成。", false);
        render();
      }
      if (actionName === "save-research-summary") {
        window.PatentShareStore.setResearchSummary({
          problem: byId("share-research-problem") ? byId("share-research-problem").value : "",
          approach: byId("share-research-approach") ? byId("share-research-approach").value : "",
          effect: byId("share-research-effect") ? byId("share-research-effect").value : "",
          openQuestions: byId("share-research-openQuestions") ? byId("share-research-openQuestions").value : "",
        });
        setNotice("项目级结论已保存；请在“编排与展示”中启用相应内容后导出。", false);
        render();
      }
      if ((actionName === "save-ai-analysis" || actionName === "accept-ai-analysis" || actionName === "return-ai-analysis") && action.dataset.aiType) {
        var editor = view.querySelector("[data-ai-editor='true'][data-ai-scope='" + action.dataset.aiScope + "'][data-ai-type='" + action.dataset.aiType + "']" + (action.dataset.patentId ? "[data-patent-id='" + action.dataset.patentId + "']" : ""));
        var updates = {};
        if (actionName === "save-ai-analysis") updates.content = editor ? editor.value : "";
        else updates.reviewState = actionName === "accept-ai-analysis" ? "accepted" : "pending";
        var changed = action.dataset.aiScope === "project" ? window.PatentShareStore.updateProjectAIAnalysis(action.dataset.aiType, updates) : window.PatentShareStore.updateAIAnalysis(action.dataset.patentId, action.dataset.aiType, updates);
        setNotice(changed ? (actionName === "accept-ai-analysis" ? "已确认该内容可用于分享。" : actionName === "return-ai-analysis" ? "内容已退回草稿状态。" : "AI 草稿已保存。") : "无法更新该 AI 内容。", !changed);
        render();
      }
      if (actionName === "ai-analyze-all") runAIAnalyzeAll();
      if (actionName === "batch-start") runAIBatch();
      if (actionName === "batch-cancel") cancelAIBatch();
      if (actionName === "ai-summary" && action.dataset.patentId) runAIAnalysis(action.dataset.patentId, "summary");
      if (actionName === "ai-elements" && action.dataset.patentId) runAIAnalysis(action.dataset.patentId, "elements");
      if (actionName === "ai-embodiments" && action.dataset.patentId) runAIAnalysis(action.dataset.patentId, "embodiments");
      if (actionName === "ai-comparison") runAIComparison();
      // 跳转到独立的「提示词与原文范围」视图（不再嵌在编排与展示里）
      if (actionName === "go-prompts" || actionName === "go-modules-prompts") {
        activeView = "prompts";
        render();
        return;
      }
      // 提示词管理：编辑/重置组合判断内置提示词
      if (actionName === "edit-ai-prompt" && action.dataset.promptKey) {
        var aiPromptKey = action.dataset.promptKey;
        var aiMetaMap = window.PatentShareAI && window.PatentShareAI.promptMeta ? window.PatentShareAI.promptMeta() : {};
        var aiDefaultsMap = window.PatentShareAI && window.PatentShareAI.getPromptDefaults ? window.PatentShareAI.getPromptDefaults() : {};
        var aiMetaEntry = aiMetaMap[aiPromptKey] || { label: aiPromptKey };
        var currentOverrides = window.PatentShareStore.getPromptOverrides();
        var currentPromptVal = (currentOverrides.ai && currentOverrides.ai[aiPromptKey]) || aiDefaultsMap[aiPromptKey] || "";
        PatentShareUI.multilinePrompt("编辑提示词：" + aiMetaEntry.label, currentPromptVal, aiMetaEntry.description || "留空保存将恢复为内置默认提示词。").then(function (next) {
          if (next == null) return;
          window.PatentShareStore.setAIPrompt(aiPromptKey, next);
          setNotice("提示词「" + aiMetaEntry.label + "」已" + (next.trim() ? "保存" : "重置为默认") + "。", false);
          render();
        });
      }
      if (actionName === "reset-ai-prompt" && action.dataset.promptKey) {
        var resetAiKey = action.dataset.promptKey;
        var resetAiMeta = window.PatentShareAI && window.PatentShareAI.promptMeta ? window.PatentShareAI.promptMeta() : {};
        var resetAiLabel = (resetAiMeta[resetAiKey] || { label: resetAiKey }).label;
        PatentShareUI.confirm("确定将「" + resetAiLabel + "」提示词恢复为内置默认吗？").then(function (confirmed) {
          if (!confirmed) return;
          window.PatentShareStore.setAIPrompt(resetAiKey, "");
          setNotice("提示词「" + resetAiLabel + "」已恢复为默认。", false);
          render();
        });
      }
      // 提示词管理：编辑/重置加工字段预设提示词
      if (actionName === "edit-field-preset-prompt" && action.dataset.presetLabel) {
        var presetLabel = action.dataset.presetLabel;
        var presetList = window.PatentShareModules && window.PatentShareModules.fieldPresets ? window.PatentShareModules.fieldPresets() : [];
        var presetMatch = presetList.find(function (p) { return p.label === presetLabel; });
        var presetType = presetMatch ? presetMatch.type : "text";
        var currentPresetPrompt = presetMatch ? presetMatch.prompt : "";
        PatentShareUI.multilinePrompt("编辑预设提示词：" + presetLabel, currentPresetPrompt, "留空保存将恢复为内置预设。当前类型：" + (presetType === "list" ? "列表型" : "文本型")).then(function (next) {
          if (next == null) return;
          window.PatentShareStore.setFieldPresetPrompt(presetLabel, next, presetType);
          setNotice("预设提示词「" + presetLabel + "」已" + (next.trim() ? "保存" : "重置为默认") + "。", false);
          render();
        });
      }
      if (actionName === "reset-field-preset-prompt" && action.dataset.presetLabel) {
        var resetPresetLabel = action.dataset.presetLabel;
        PatentShareUI.confirm("确定将预设「" + resetPresetLabel + "」的提示词恢复为内置默认吗？").then(function (confirmed) {
          if (!confirmed) return;
          window.PatentShareStore.setFieldPresetPrompt(resetPresetLabel, "", "text");
          setNotice("预设提示词「" + resetPresetLabel + "」已恢复为默认。", false);
          render();
        });
      }
      // 新增自定义预置模板
      if (actionName === "add-custom-preset") {
        PatentShareUI.prompt("请输入自定义预置模板名称", "").then(function (presetName) {
          if (presetName == null) return;
          presetName = presetName.trim();
          if (!presetName) { setNotice("模板名称不能为空。", true); render(); return; }
          // 检查是否与已有模板重名
          var existingPresets = window.PatentShareModules && window.PatentShareModules.fieldPresets ? window.PatentShareModules.fieldPresets() : [];
          if (existingPresets.some(function (p) { return p.label === presetName; })) {
            setNotice("已存在同名模板「" + presetName + "」，请换一个名称。", true);
            render();
            return;
          }
          // 选择类型
          PatentShareUI.confirm("默认类型为列表型，点击确定为列表型，取消为文本型。", "选择类型").then(function (isList) {
            var pType = isList !== false ? "list" : "text";
            PatentShareUI.multilinePrompt("输入自定义预置模板的提示词", "", "提示AI如何抽取该字段内容，如：请概括该专利在XX方面的技术优势，3-5个要点。").then(function (promptText) {
              if (promptText == null || !promptText.trim()) { setNotice("提示词不能为空。", true); render(); return; }
              window.PatentShareStore.addCustomPreset(presetName, promptText, pType);
              setNotice("自定义预置模板「" + presetName + "」已添加。", false);
              render();
            });
          });
        });
      }
      // 删除自定义预置模板
      if (actionName === "delete-custom-preset" && action.dataset.presetLabel) {
        var delPresetLabel = action.dataset.presetLabel;
        PatentShareUI.confirm("确定删除自定义预置模板「" + delPresetLabel + "」吗？此操作不可恢复。").then(function (confirmed) {
          if (!confirmed) return;
          window.PatentShareStore.removeCustomPreset(delPresetLabel);
          setNotice("自定义预置模板「" + delPresetLabel + "」已删除。", false);
          render();
        });
      }
      if (actionName === "open-project") openProject(action.dataset.projectId);
      if (actionName === "delete-project" && action.dataset.projectId) deleteProject(action.dataset.projectId, action.dataset.projectName);
      if (actionName === "translate-claims" && action.dataset.patentId) runTranslate(action.dataset.patentId, "claims");
      if (actionName === "translate-description" && action.dataset.patentId) runTranslate(action.dataset.patentId, "description");
      if (actionName === "select-field-candidate") {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再审核。", true);
          render();
          return;
        }
        if (window.PatentShareStore.selectPatentFieldCandidate(action.dataset.patentId, action.dataset.fieldName, action.dataset.candidateIndex)) {
          setNotice("已选择字段来源并完成审核。", false);
          render();
        }
      }
      if (actionName === "rename-project") {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        var current = currentProject();
        PatentShareUI.prompt("请输入分享项目名称", current && current.name ? current.name : "").then(function(nextName) {
          if (nextName == null) return;
          nextName = nextName.trim();
          if (!nextName) {
            setNotice("项目名称不能为空。", true);
            render();
            return;
          }
          if (!window.PatentShareStore.renameProject(nextName)) {
            setNotice("项目名称更新失败。", true);
          } else {
            setNotice("项目名称已更新。", false);
          }
          render();
        });
      }
      if (actionName === "edit-description" && action.dataset.patentId) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        var p = currentProject();
        var targetPatent = p.patents.find(function(x) { return x.id === action.dataset.patentId; });
        var currentDesc = targetPatent ? (targetPatent.description || "") : "";
        PatentShareUI.multilinePrompt("编辑说明书内容（" + (targetPatent ? targetPatent.patentNumber : "") + "）", currentDesc, "支持粘贴完整说明书文本，可分段整理...").then(function(nextDesc) {
          if (nextDesc == null) return;
          nextDesc = nextDesc.trim();
          if (!nextDesc) {
            setNotice("说明书内容不能为空（若要清空请使用移除功能）。", true);
            render();
            return;
          }
          window.PatentShareStore.updatePatentDescription(action.dataset.patentId, nextDesc);
          setNotice("说明书内容已更新保存；可在'分享模块'启用S5(说明书)模块进行展示。", false);
          render();
        });
      }
      if (actionName === "edit-classifications" && action.dataset.patentId) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        var projForClass = currentProject();
        var patentForClass = projForClass.patents.find(function(x) { return x.id === action.dataset.patentId; });
        var currentClasses = patentForClass && Array.isArray(patentForClass.classifications) ? patentForClass.classifications.join("\n") : "";
        PatentShareUI.multilinePrompt("编辑 IPC/CPC 分类号（" + (patentForClass ? patentForClass.patentNumber : "") + "）", currentClasses, "每行一个分类号，或用逗号/分号分隔").then(function(nextValue) {
          if (nextValue == null) return;
          if (!window.PatentShareStore.updateClassifications(action.dataset.patentId, nextValue)) {
            setNotice("分类号更新失败。", true);
          } else {
            setNotice("分类号已保存；可在'分享模块'中调整 S3(分类号)的展示模式。", false);
          }
          render();
        });
      }
      if (actionName === "edit-claims" && action.dataset.patentId) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        var projForClaims = currentProject();
        var patentForClaims = projForClaims.patents.find(function(x) { return x.id === action.dataset.patentId; });
        var claimLines = "";
        if (patentForClaims && Array.isArray(patentForClaims.claims)) {
          claimLines = patentForClaims.claims.map(function(c) {
            var prefix = c.number ? c.number + ". " : "";
            var body = c.text || "";
            return prefix + body;
          }).join("\n");
        }
        PatentShareUI.multilinePrompt("编辑权利要求（" + (patentForClaims ? patentForClaims.patentNumber : "") + "）", claimLines, "每行一条权利要求，格式：序号. 文本（如 1. 一种装置...）；从属权利要求请以'根据权利要求'开头以便自动识别").then(function(nextValue) {
          if (nextValue == null) return;
          var rawClaims = String(nextValue || "").split(/\r?\n/).map(function(line) { return line.trim(); }).filter(Boolean);
          var parsedClaims = rawClaims.map(function(line) {
            var match = line.match(/^(\d+)\s*[.、]\s*(.+)$/);
            var number = match ? match[1] : String(rawClaims.indexOf(line) + 1);
            var text = match ? match[2] : line;
            var type = "independent";
            var refs = [];
            var depMatch = text.match(/根据权利要求\s*(\d+)/);
            if (depMatch) {
              type = "dependent";
              refs.push(depMatch[1]);
            } else if (/根据|引用|如权利要求/.test(text)) {
              type = "dependent";
            }
            return { number: number, text: text, type: type, references: refs };
          });
          if (!parsedClaims.length) {
            setNotice("未能解析出权利要求，请确认每行格式为'序号. 文本'。", true);
            render();
            return;
          }
          if (!window.PatentShareStore.updateClaims(action.dataset.patentId, parsedClaims)) {
            setNotice("权利要求更新失败。", true);
          } else {
            setNotice("权利要求已保存（共 " + parsedClaims.length + " 项）；可在'分享模块'中调整 S4(权利要求)的展示模式。", false);
          }
          render();
        });
      }
      if (actionName === "edit-field" && action.dataset.patentId && action.dataset.fieldName) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        var longFields = ["abstract", "assignees", "inventors"];
        var isLong = longFields.indexOf(action.dataset.fieldName) >= 0;
        if (isLong) {
          var mlTitle = action.dataset.fieldName === "abstract" ? "支持多行文本" : "多个值用逗号或换行分隔";
          PatentShareUI.multilinePrompt("人工确认：" + (action.dataset.fieldLabel || action.dataset.fieldName), action.dataset.fieldValue || "", mlTitle).then(function(nextValue) {
            if (nextValue == null) return;
            nextValue = nextValue.trim();
            if (!nextValue) { setNotice("字段值不能为空，请重新输入。", true); render(); return; }
            if (!window.PatentShareStore.updatePatentField(action.dataset.patentId, action.dataset.fieldName, nextValue)) {
              setNotice("字段更新失败。", true);
            } else {
              setNotice("已保存人工确认值，并保留为独立的项目快照。", false);
            }
            render();
          });
        } else {
          PatentShareUI.prompt("人工确认：" + (action.dataset.fieldLabel || action.dataset.fieldName), action.dataset.fieldValue || "").then(function(nextValue) {
          if (nextValue == null) return;
          nextValue = nextValue.trim();
          if (!nextValue) {
            setNotice("字段值不能为空，请重新输入。", true);
            render();
            return;
          }
          if (!window.PatentShareStore.updatePatentField(action.dataset.patentId, action.dataset.fieldName, nextValue)) {
            setNotice("字段更新失败。", true);
          } else {
            setNotice("已保存人工确认值，并保留为独立的项目快照。", false);
          }
          render();
        });
        }
      }
      if (actionName === "edit-custom-field" && action.dataset.patentId && action.dataset.fieldKey) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        PatentShareUI.prompt("人工确认：" + (action.dataset.fieldLabel || action.dataset.fieldKey), action.dataset.fieldValue || "").then(function(nextValue) {
          if (nextValue == null) return;
          nextValue = nextValue.trim();
          if (!nextValue) {
            setNotice("字段值不能为空，请重新输入。", true);
            render();
            return;
          }
          if (!window.PatentShareStore.updateCustomField(action.dataset.patentId, action.dataset.fieldKey, nextValue)) {
            setNotice("自定义字段更新失败。", true);
          } else {
            setNotice("已保存自定义字段值。", false);
          }
          render();
        });
      }
      if (actionName === "add-custom-field" && action.dataset.patentId) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        PatentShareUI.prompt("自定义字段名称", "").then(function(label) {
          if (label == null) return;
          label = label.trim();
          if (!label) { render(); return; }
          PatentShareUI.prompt("字段值：" + label, "").then(function(value) {
            if (value == null) { render(); return; }
            var result = window.PatentShareStore.addCustomField(action.dataset.patentId, label, value);
            if (!result || !result.ok) {
              setNotice("添加自定义字段失败。", true);
            } else {
              setNotice("已添加自定义字段：" + label, false);
            }
            render();
          });
        });
      }
      if (actionName === "remove-custom-field" && action.dataset.patentId && action.dataset.fieldKey) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        PatentShareUI.confirm("确定要删除该自定义字段吗？此操作不可撤销。").then(function(confirmed) {
          if (confirmed) {
            window.PatentShareStore.removeCustomField(action.dataset.patentId, action.dataset.fieldKey);
            setNotice("已删除自定义字段。", false);
          }
          render();
        });
      }
      if (actionName === "upload-figure" && action.dataset.patentId) {
        var figSection = action.closest(".share-review-section-body");
        var figInput = figSection ? figSection.querySelector(".share-figure-file-input") : null;
        if (figInput) figInput.click();
      }
      if (actionName === "figure-file-input" && action.dataset.patentId) {
        var file = action.files && action.files[0];
        if (!file) return;
        if (file.size > 2.5 * 1024 * 1024) {
          setNotice("图片不能超过 2.5 MB。", true);
          render();
          return;
        }
        var reader = new FileReader();
        reader.onload = function (ev) {
          var dataUrl = ev.target.result;
          PatentShareUI.prompt("附图说明（可选）", "").then(function (caption) {
            var probe = new Image();
            probe.onload = function () {
              var dims = { width: probe.width, height: probe.height };
              doAddFigure(dataUrl, caption, dims);
            };
            probe.onerror = function () { doAddFigure(dataUrl, caption, {}); };
            probe.src = dataUrl;
          });
        };
        reader.onerror = function () { setNotice("图片读取失败。", true); render(); };
        reader.readAsDataURL(file);
        function doAddFigure(dataUrl, caption, dims) {
          var result = window.PatentShareStore.addFigure(action.dataset.patentId, dataUrl, caption || "", dims);
          if (!result || !result.ok) {
            setNotice("附图上传失败：" + (result && result.reason || "未知错误"), true);
          } else {
            setNotice("已添加附图。S7(附图)模块默认开启，可在「分享模块」调整展示模式。", false);
          }
          render();
        }
      }
      if (actionName === "remove-figure" && action.dataset.patentId && action.dataset.figureId) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        PatentShareUI.confirm("确定要删除该附图吗？").then(function (confirmed) {
          if (confirmed) {
            window.PatentShareStore.removeFigure(action.dataset.patentId, action.dataset.figureId);
            setNotice("已删除附图。", false);
          }
          render();
        });
      }
      if (actionName === "add-preset-field" && action.dataset.patentId) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        var presets = window.PatentShareModules && window.PatentShareModules.fieldPresets ? window.PatentShareModules.fieldPresets() : [];
        var matched = presets.find(function (p) { return p.label === action.dataset.presetLabel; });
        if (!matched) { setNotice("未找到该预设模板。", true); render(); return; }
        var addResult = window.PatentShareStore.addProcessedField(action.dataset.patentId, matched.label, matched.prompt, matched.type);
        if (!addResult || !addResult.ok) {
          setNotice("添加加工字段失败。", true);
        } else {
          setNotice("已添加加工字段「" + matched.label + "」，可点击AI抽取或手工编辑。", false);
        }
        render();
      }
      if (actionName === "add-processed-field" && action.dataset.patentId) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        PatentShareUI.prompt("加工字段名称（如：技术优势、避让方案）", "").then(function (label) {
          if (label == null) return;
          label = label.trim();
          if (!label) { render(); return; }
          PatentShareUI.multilinePrompt("AI抽取提示词（可选，留空则仅手工录入）", "", "提示AI如何抽取该字段内容，如：请概括该专利在XX方面的技术优势，3-5个要点。").then(function (prompt) {
            if (prompt == null) { render(); return; }
            var r = window.PatentShareStore.addProcessedField(action.dataset.patentId, label, prompt, "text");
            if (!r || !r.ok) { setNotice("添加加工字段失败。", true); }
            else { setNotice("已添加加工字段「" + label + "」。", false); }
            render();
          });
        });
      }
      if (actionName === "edit-processed-field" && action.dataset.patentId && action.dataset.fieldId) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        var projForPF = currentProject();
        var patForPF = projForPF.patents.find(function (x) { return x.id === action.dataset.patentId; });
        var pfField = patForPF && Array.isArray(patForPF.processedFields) ? patForPF.processedFields.find(function (f) { return f.id === action.dataset.fieldId; }) : null;
        if (!pfField) { setNotice("未找到该加工字段。", true); render(); return; }
        PatentShareUI.multilinePrompt("编辑加工字段：" + pfField.label, pfField.value || "", "可手工录入或粘贴内容，保存后在分享报告中展示。").then(function (nextValue) {
          if (nextValue == null) return;
          window.PatentShareStore.updateProcessedField(action.dataset.patentId, action.dataset.fieldId, { value: nextValue, source: "manual", reviewState: "accepted" });
          setNotice("加工字段「" + pfField.label + "」已保存。", false);
          render();
        });
      }
      if (actionName === "ai-processed-field" && action.dataset.patentId && action.dataset.fieldId) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再操作。", true);
          render();
          return;
        }
        var projForAIPF = currentProject();
        var patForAIPF = projForAIPF.patents.find(function (x) { return x.id === action.dataset.patentId; });
        var aiPFField = patForAIPF && Array.isArray(patForAIPF.processedFields) ? patForAIPF.processedFields.find(function (f) { return f.id === action.dataset.fieldId; }) : null;
        if (!aiPFField) { setNotice("未找到该加工字段。", true); render(); return; }
        if (!aiPFField.prompt) {
          PatentShareUI.multilinePrompt("配置AI抽取提示词：" + aiPFField.label, "", "提示AI如何抽取该字段内容，如：请概括该专利的技术问题，2-4句话。").then(function (prompt) {
            if (prompt == null) return;
            prompt = prompt.trim();
            if (!prompt) { setNotice("提示词不能为空。", true); render(); return; }
            window.PatentShareStore.updateProcessedField(action.dataset.patentId, action.dataset.fieldId, { prompt: prompt });
            runAIProcessedField(action.dataset.patentId, action.dataset.fieldId);
          });
        } else {
          runAIProcessedField(action.dataset.patentId, action.dataset.fieldId);
        }
      }
      if (actionName === "remove-processed-field" && action.dataset.patentId && action.dataset.fieldId) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        PatentShareUI.confirm("确定要删除该加工字段吗？").then(function (confirmed) {
          if (confirmed) {
            window.PatentShareStore.removeProcessedField(action.dataset.patentId, action.dataset.fieldId);
            setNotice("已删除加工字段。", false);
          }
          render();
        });
      }
      if (actionName === "remove-patent" && action.dataset.patentId) {
        if (window.PatentShareStore.getPersistenceState().mode === "loading") {
          setNotice("正在恢复本机分享项目，请稍候再编辑。", true);
          render();
          return;
        }
        PatentShareUI.confirm("确定要从当前项目移除该专利吗？此操作不可撤销。").then(function(confirmed) {
          if (confirmed) {
            window.PatentShareStore.removePatent(action.dataset.patentId);
            setNotice("已从当前项目移除该专利快照。", false);
            render();
          }
        });
      }
    });
    if (view) view.addEventListener("change", function (event) {
      var control = event.target;
      if (!control || !control.dataset.shareAction) return;
      var actionName = control.dataset.shareAction;
      if (actionName === "module-mode") {
        if (window.PatentShareStore.setModuleMode(control.dataset.moduleId, control.value)) {
          setNotice("模块配置已保存。", false);
        } else {
          setNotice("该模块配置不可用。", true);
        }
        render();
        return;
      }
      if (actionName === "figure-file-input" && control.dataset.patentId) {
        var file = control.files && control.files[0];
        if (!file) return;
        if (file.size > 2.5 * 1024 * 1024) {
          setNotice("图片不能超过 2.5 MB。", true);
          render();
          return;
        }
        var figReader = new FileReader();
        figReader.onload = function (ev) {
          var dataUrl = ev.target.result;
          PatentShareUI.prompt("附图说明（可选）", "").then(function (caption) {
            var probe = new Image();
            probe.onload = function () {
              var dims = { width: probe.width, height: probe.height };
              doAddFigure(dataUrl, caption, dims);
            };
            probe.onerror = function () { doAddFigure(dataUrl, caption, {}); };
            probe.src = dataUrl;
          });
        };
        figReader.onerror = function () { setNotice("图片读取失败。", true); render(); };
        figReader.readAsDataURL(file);
        function doAddFigure(dataUrl, caption, dims) {
          var result = window.PatentShareStore.addFigure(control.dataset.patentId, dataUrl, caption || "", dims);
          if (!result || !result.ok) {
            setNotice("附图上传失败：" + (result && result.reason || "未知错误"), true);
          } else {
            setNotice("已添加附图。S7(附图)模块默认开启，可在「分享模块」调整展示模式。", false);
          }
          render();
        }
        control.value = "";
      }
      // 项目级 AI 原文范围勾选：toggle 单个 key
      if (actionName === "toggle-context-scope" && control.dataset.scopeKey) {
        var scopeKey = control.dataset.scopeKey;
        var projectScope = window.PatentShareStore.getAIContextScope ? window.PatentShareStore.getAIContextScope() : { abstract: true, claims: true, description: true, annotations: true };
        projectScope[scopeKey] = !!control.checked;
        window.PatentShareStore.setAIContextScope(projectScope);
        setNotice("AI 原文范围「" + (scopeKey === "abstract" ? "摘要" : scopeKey === "claims" ? "权利要求" : scopeKey === "description" ? "说明书" : "IPR 标注") + "」已" + (control.checked ? "纳入" : "排除") + "。", false);
        render();
        return;
      }
      // 字段级 AI 原文范围：选择「跟随项目默认」
      if (actionName === "set-field-context-scope" && control.dataset.patentId && control.dataset.fieldId) {
        if (control.dataset.scopeValue === "inherit") {
          window.PatentShareStore.updateProcessedField(control.dataset.patentId, control.dataset.fieldId, { contextScope: null });
          setNotice("字段已恢复为跟随项目级原文范围。", false);
          render();
        }
        return;
      }
      // 字段级 AI 原文范围：自定义时切换某个 key
      if (actionName === "toggle-field-context-scope" && control.dataset.patentId && control.dataset.fieldId && control.dataset.scopeKey) {
        var pfScopeKey = control.dataset.scopeKey;
        var pfProj = currentProject();
        var pfPatent = pfProj.patents.find(function (x) { return x.id === control.dataset.patentId; });
        var pfFieldTarget = pfPatent && Array.isArray(pfPatent.processedFields) ? pfPatent.processedFields.find(function (f) { return f.id === control.dataset.fieldId; }) : null;
        if (!pfFieldTarget) { render(); return; }
        var baseScope = pfFieldTarget.contextScope && typeof pfFieldTarget.contextScope === "object"
          ? pfFieldTarget.contextScope
          : (window.PatentShareStore.getAIContextScope ? window.PatentShareStore.getAIContextScope() : { abstract: true, claims: true, description: true, annotations: true });
        baseScope[pfScopeKey] = !!control.checked;
        window.PatentShareStore.updateProcessedField(control.dataset.patentId, control.dataset.fieldId, { contextScope: baseScope });
        setNotice("字段原文范围已更新。", false);
        render();
        return;
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
    // 供主应用专利详情页"加入分享项目"按钮外部调用：
    //   PatentShareWorkspace.addCurrentPatent() -> Promise<{ok, reason, patentNumber, projectId, projectName}>
    //   options.quiet=true 时不弹通知；options.open=true 时加入后自动打开工作台。
    addCurrentPatent: function (options) {
      var result = addCurrentPatent(options || {});
      // addCurrentPatent 是同步的（已通过 store.addPatent 入库），但为便于调用方使用 await，包装为 Promise。
      var shouldOpen = options && options.open && result.ok;
      return Promise.resolve(result).then(function (r) {
        if (shouldOpen) openWorkspace();
        return r;
      });
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
