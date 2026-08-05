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

  var viewMeta = {
    overview: { title: "项目概览", description: "围绕一个可分享的专利项目管理材料、模块和输出。" },
    sources: { title: "材料来源", description: "从当前查询、审查档案、PDF 和表格逐步汇集可追溯的专利材料。" },
    review: { title: "数据审核", description: "确认字段冲突、来源优先级、人工修订和说明书内容。" },
    modules: { title: "分享模块", description: "选择必要模块的完整/精简/关闭模式；基础模块、研发洞察、附录分类管理。" },
    insights: { title: "研发洞察", description: "AI自动生成技术问题-方案-效果分析、技术要素提取、多专利对比，或人工编辑研发结论。" },
    preview: { title: "预览", description: "在隔离 iframe 中查看将要分享的离线页面。" },
    export: { title: "导出", description: "完成敏感信息检查后保存单文件 HTML。" },
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
    var aiText = aiCount ? " · AI分析完成 " + aiCount + " 项" : "";
    return storage + " · " + (count ? "已加入 " + count + " 篇专利" : "尚未加入专利") + aiText;
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
            if (result.ok) succeeded++;
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
    var standardFields = [
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
      var header = makeElement("div", "share-review-header");
      header.appendChild(makeElement("h4", "", patent.patentNumber + " · " + (patent.title || "未提供标题")));
      var descBtn = makeElement("button", "share-secondary-action", patent.description ? "编辑说明书" : "添加说明书");
      descBtn.type = "button";
      descBtn.dataset.shareAction = "edit-description";
      descBtn.dataset.patentId = patent.id;
      descBtn.disabled = aiRunning;
      header.appendChild(descBtn);
      card.appendChild(header);

      var classList = Array.isArray(patent.classifications) ? patent.classifications : [];
      var classRow = makeElement("div", "share-review-field");
      classRow.appendChild(makeElement("span", "share-review-field-label", "IPC/CPC分类"));
      var classVal = makeElement("div", "share-review-field-value");
      if (classList.length) {
        classList.forEach(function(c) {
          var tag = makeElement("span", "share-classification-tag", c);
          classVal.appendChild(tag);
        });
      } else {
        classVal.appendChild(makeElement("span", "share-missing-text", "尚未提供分类号"));
      }
      classRow.appendChild(classVal);
      var classEdit = makeElement("button", "share-field-edit", classList.length ? "编辑" : "添加");
      classEdit.type = "button";
      classEdit.dataset.shareAction = "edit-classifications";
      classEdit.dataset.patentId = patent.id;
      classEdit.disabled = aiRunning;
      classRow.appendChild(classEdit);
      card.appendChild(classRow);

      var claimList = Array.isArray(patent.claims) ? patent.claims : [];
      var claimRow = makeElement("div", "share-review-field");
      claimRow.appendChild(makeElement("span", "share-review-field-label", "权利要求"));
      var claimVal = makeElement("div", "share-review-field-value");
      if (claimList.length) {
        var claimSummary = makeElement("span", "", String(claimList.length) + " 项权利要求");
        claimVal.appendChild(claimSummary);
        var indep = claimList.filter(function(c) { return c.type === "independent"; }).length;
        if (indep) claimVal.appendChild(makeElement("span", "share-review-field-source", "其中独立权利要求 " + indep + " 项"));
      } else {
        claimVal.appendChild(makeElement("span", "share-missing-text", "尚未提供权利要求"));
      }
      claimRow.appendChild(claimVal);
      var claimEdit = makeElement("button", "share-field-edit", claimList.length ? "编辑" : "添加");
      claimEdit.type = "button";
      claimEdit.dataset.shareAction = "edit-claims";
      claimEdit.dataset.patentId = patent.id;
      claimEdit.disabled = aiRunning;
      claimRow.appendChild(claimEdit);
      if (claimList.length) {
        var trClaimsBtn = makeElement("button", "share-field-edit", patent.claimsTranslation ? "重新翻译" : "翻译为中文");
        trClaimsBtn.type = "button";
        trClaimsBtn.dataset.shareAction = "translate-claims";
        trClaimsBtn.dataset.patentId = patent.id;
        trClaimsBtn.disabled = aiRunning;
        claimRow.appendChild(trClaimsBtn);
        if (patent.claimsTranslation) {
          claimVal.appendChild(makeElement("span", "share-processed-badge ai", "已翻译"));
        }
      }
      card.appendChild(claimRow);

      if (patent.description) {
        var descPreview = makeElement("div", "share-description-preview");
        var truncated = patent.description.length > 300 ? patent.description.slice(0, 300) + "..." : patent.description;
        descPreview.appendChild(makeElement("span", "share-review-field-label", "说明书预览"));
        descPreview.appendChild(makeElement("div", "share-review-field-value", truncated));
        var trDescBtn = makeElement("button", "share-field-edit", patent.descriptionTranslation ? "重新翻译说明书" : "翻译说明书");
        trDescBtn.type = "button";
        trDescBtn.dataset.shareAction = "translate-description";
        trDescBtn.dataset.patentId = patent.id;
        trDescBtn.disabled = aiRunning;
        descPreview.appendChild(trDescBtn);
        if (patent.descriptionTranslation) {
          descPreview.appendChild(makeElement("span", "share-processed-badge ai", "已翻译"));
        }
        card.appendChild(descPreview);
      }

      var table = makeElement("div", "share-review-fields");
      standardFields.forEach(function (definition) {
        var fieldName = definition[0];
        var field = patent.fields && patent.fields[fieldName];
        var row = makeElement("div", "share-review-field");
        row.appendChild(makeElement("span", "share-review-field-label", definition[1]));
        var value = makeElement("div", "share-review-field-value", field && field.value ? field.value : "来源未提供");
        row.appendChild(value);
        row.appendChild(makeElement("span", "share-review-field-source", readableSource(field)));
        if (field && Array.isArray(field.candidates) && field.candidates.length > 1) {
          var candidates = makeElement("div", "share-review-candidates");
          field.candidates.forEach(function (candidate, candidateIndex) {
            var choose = makeElement("button", "share-candidate-button", (candidate.source || "来源") + "：" + candidate.value);
            choose.type = "button";
            choose.dataset.shareAction = "select-field-candidate";
            choose.dataset.patentId = patent.id;
            choose.dataset.fieldName = fieldName;
            choose.dataset.candidateIndex = String(candidateIndex);
            choose.disabled = aiRunning;
            candidates.appendChild(choose);
          });
          row.appendChild(candidates);
        }
        var edit = makeElement("button", "share-field-edit", "人工确认");
        edit.type = "button";
        edit.dataset.shareAction = "edit-field";
        edit.dataset.patentId = patent.id;
        edit.dataset.fieldName = fieldName;
        edit.dataset.fieldLabel = definition[1];
        edit.dataset.fieldValue = field && field.value ? field.value : "";
        edit.disabled = aiRunning;
        row.appendChild(edit);
        table.appendChild(row);
      });
      Object.keys(patent.customFields && typeof patent.customFields === "object" ? patent.customFields : {}).forEach(function (key) {
        var custom = patent.customFields[key];
        if (!custom || !custom.field) return;
        var row = makeElement("div", "share-review-field");
        row.appendChild(makeElement("span", "share-review-field-label", custom.label || key));
        row.appendChild(makeElement("div", "share-review-field-value", custom.field.value || "来源未提供"));
        row.appendChild(makeElement("span", "share-review-field-source", readableSource(custom.field)));
        var editCustom = makeElement("button", "share-field-edit", "人工确认");
        editCustom.type = "button";
        editCustom.dataset.shareAction = "edit-custom-field";
        editCustom.dataset.patentId = patent.id;
        editCustom.dataset.fieldKey = key;
        editCustom.dataset.fieldLabel = custom.label || key;
        editCustom.dataset.fieldValue = custom.field.value || "";
        editCustom.disabled = aiRunning;
        row.appendChild(editCustom);
        var removeCustom = makeElement("button", "share-field-remove", "删除");
        removeCustom.type = "button";
        removeCustom.dataset.shareAction = "remove-custom-field";
        removeCustom.dataset.patentId = patent.id;
        removeCustom.dataset.fieldKey = key;
        removeCustom.disabled = aiRunning;
        row.appendChild(removeCustom);
        table.appendChild(row);
      });
      var addCustomRow = makeElement("div", "share-review-field share-review-add-custom");
      var addCustomBtn = makeElement("button", "btn-secondary btn-small", "+ 添加自定义字段");
      addCustomBtn.type = "button";
      addCustomBtn.dataset.shareAction = "add-custom-field";
      addCustomBtn.dataset.patentId = patent.id;
      addCustomBtn.disabled = aiRunning;
      addCustomRow.appendChild(addCustomBtn);
      table.appendChild(addCustomRow);
      card.appendChild(table);

      var figSection = makeElement("div", "share-review-figures");
      figSection.appendChild(makeElement("h4", "", "附图与图片"));
      var figList = Array.isArray(patent.figures) ? patent.figures : [];
      if (figList.length) {
        figList.forEach(function (fig) {
          var figItem = makeElement("div", "share-figure-item");
          var img = makeElement("img", "share-figure-thumb");
          img.src = fig.dataUrl;
          img.alt = fig.caption || "附图";
          figItem.appendChild(img);
          if (fig.caption) figItem.appendChild(makeElement("span", "share-figure-caption", fig.caption));
          var removeFig = makeElement("button", "share-field-remove", "删除");
          removeFig.type = "button";
          removeFig.dataset.shareAction = "remove-figure";
          removeFig.dataset.patentId = patent.id;
          removeFig.dataset.figureId = fig.id;
          removeFig.disabled = aiRunning;
          figItem.appendChild(removeFig);
          figSection.appendChild(figItem);
        });
      } else {
        figSection.appendChild(makeElement("p", "share-review-field-value", "尚未上传附图。"));
      }
      var uploadBtn = makeElement("button", "btn-secondary btn-small", "+ 上传附图");
      uploadBtn.type = "button";
      uploadBtn.dataset.shareAction = "upload-figure";
      uploadBtn.dataset.patentId = patent.id;
      uploadBtn.disabled = aiRunning;
      figSection.appendChild(uploadBtn);
      var fileInput = makeElement("input", "share-figure-file-input");
      fileInput.type = "file";
      fileInput.accept = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
      fileInput.style.display = "none";
      fileInput.dataset.shareAction = "figure-file-input";
      fileInput.dataset.patentId = patent.id;
      figSection.appendChild(fileInput);
      card.appendChild(figSection);

      var pfSection = makeElement("div", "share-review-processed");
      pfSection.appendChild(makeElement("h4", "", "加工信息字段（AI 抽取 / 手工录入）"));
      var pfList = Array.isArray(patent.processedFields) ? patent.processedFields : [];
      if (pfList.length) {
        pfList.forEach(function (pf) {
          var pfRow = makeElement("div", "share-review-field share-processed-field-row");
          pfRow.appendChild(makeElement("span", "share-review-field-label", pf.label));
          var pfVal = makeElement("div", "share-review-field-value");
          var valText = pf.value || "（尚未填写）";
          if (valText.length > 120) valText = valText.slice(0, 120) + "...";
          pfVal.appendChild(makeElement("span", "", valText));
          var badge = makeElement("span", "share-processed-badge" + (pf.source === "ai" ? " ai" : " manual"), pf.source === "ai" ? "AI" : "手工");
          pfVal.appendChild(badge);
          pfRow.appendChild(pfVal);
          var aiBtn = makeElement("button", "share-field-edit", pf.prompt ? "AI抽取" : "配置AI");
          aiBtn.type = "button";
          aiBtn.dataset.shareAction = "ai-processed-field";
          aiBtn.dataset.patentId = patent.id;
          aiBtn.dataset.fieldId = pf.id;
          aiBtn.disabled = aiRunning;
          pfRow.appendChild(aiBtn);
          var editPf = makeElement("button", "share-field-edit", "编辑");
          editPf.type = "button";
          editPf.dataset.shareAction = "edit-processed-field";
          editPf.dataset.patentId = patent.id;
          editPf.dataset.fieldId = pf.id;
          editPf.disabled = aiRunning;
          pfRow.appendChild(editPf);
          var rmPf = makeElement("button", "share-field-remove", "删除");
          rmPf.type = "button";
          rmPf.dataset.shareAction = "remove-processed-field";
          rmPf.dataset.patentId = patent.id;
          rmPf.dataset.fieldId = pf.id;
          rmPf.disabled = aiRunning;
          pfRow.appendChild(rmPf);
          pfSection.appendChild(pfRow);
        });
      } else {
        pfSection.appendChild(makeElement("p", "share-review-field-value", "尚未添加加工字段。可从预设模板添加，或自定义字段名称与提示词后AI抽取。"));
      }
      var presetBar = makeElement("div", "share-processed-preset-bar");
      presetBar.appendChild(makeElement("span", "share-review-field-label", "快速添加："));
      var presets = window.PatentShareModules && window.PatentShareModules.fieldPresets ? window.PatentShareModules.fieldPresets() : [];
      presets.forEach(function (preset) {
        var pb = makeElement("button", "btn-secondary btn-small share-preset-btn", "+" + preset.label);
        pb.type = "button";
        pb.dataset.shareAction = "add-preset-field";
        pb.dataset.patentId = patent.id;
        pb.dataset.presetLabel = preset.label;
        pb.dataset.presetType = preset.type;
        pb.disabled = aiRunning;
        presetBar.appendChild(pb);
      });
      var customBtn = makeElement("button", "btn-secondary btn-small", "+ 自定义字段");
      customBtn.type = "button";
      customBtn.dataset.shareAction = "add-processed-field";
      customBtn.dataset.patentId = patent.id;
      customBtn.disabled = aiRunning;
      presetBar.appendChild(customBtn);
      pfSection.appendChild(presetBar);
      card.appendChild(pfSection);

      container.appendChild(card);
    });
  }

  function modeLabel(mode) { return mode === "full" ? "完整" : mode === "lite" ? "精简" : "关闭"; }

  function renderModules(container, project) {
    addHeading(container, viewMeta.modules);
    addNotice(container);
    var registry = window.PatentShareModules;
    if (!registry) { renderPlaceholder(container, "modules", project); return; }
    var config = registry.resolveConfig(project.moduleConfig);
    var hint = makeElement("p", "share-module-hint", "必要模块不能关闭；配置会自动保存到当前分享项目，并在预览与导出中生效。AI生成的研发洞察内容需启用对应R模块后才会出现在分享中。");
    container.appendChild(hint);
    var categories = registry.listByCategory();
    var categoryLabels = { basic: "基础信息（从来源提取 + 人工校核）", processed: "加工信息（AI 抽取 / 手工录入）" };
    Object.keys(categories).forEach(function(catKey) {
      var catLabel = categoryLabels[catKey] || catKey;
      container.appendChild(makeElement("h4", "share-module-category-title", catLabel));
      var list = makeElement("div", "share-module-list");
      categories[catKey].forEach(function (module) {
        var card = makeElement("article", "share-module-card");
        var copy = makeElement("div", "share-module-copy");
        copy.appendChild(makeElement("strong", "", module.id + " · " + module.label));
        copy.appendChild(makeElement("p", "", module.description + (module.required ? " （必要模块）" : " （可选模块）")));
        card.appendChild(copy);
        var select = document.createElement("select");
        select.className = "share-module-mode";
        select.dataset.shareAction = "module-mode";
        select.dataset.moduleId = module.id;
        select.disabled = aiRunning;
        ["full", "lite", "off"].forEach(function (mode) {
          if (module.required && mode === "off") return;
          var option = document.createElement("option");
          option.value = mode;
          option.textContent = modeLabel(mode);
          option.selected = config.modules[module.id] === mode;
          select.appendChild(option);
        });
        card.appendChild(select);
        list.appendChild(card);
      });
      container.appendChild(list);
    });
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

  function renderInsights(container, project) {
    addHeading(container, viewMeta.insights, project.patents.length >= 2 ? "一键AI分析全部" : "AI生成专利分析", "ai-analyze-all");
    addNotice(container);
    if (aiRunning) {
      container.appendChild(makeElement("div", "share-ai-loading", "AI正在分析中，请稍候..."));
    }
    var hasAI = window.PatentShareAI && window.PatentShareAI.getActiveAIProvider();
    if (!hasAI) {
      container.appendChild(makeElement("div", "share-inline-notice error", "未检测到可用的AI配置，请先在应用设置中配置AI接口。仍可使用下方人工编辑功能。"));
    }
    container.appendChild(makeElement("p", "share-module-hint", "可对每篇专利单独运行AI生成'问题-手段-效果'分析、技术要素提取；多专利项目可生成技术路线对比。AI结果会自动保存，可人工修改后导出。"));

    if (project.patents.length === 0) {
      var empty = makeElement("div", "share-empty-panel");
      empty.appendChild(makeElement("h4", "", "请先加入专利材料"));
      empty.appendChild(makeElement("p", "", "加入专利后，可在此页面运行AI自动分析，或人工编辑研发结论。"));
      container.appendChild(empty);
    } else {
      project.patents.forEach(function(patent, idx) {
        var patentCard = makeElement("article", "share-ai-patent-card");
        var header = makeElement("div", "share-ai-patent-header");
        header.appendChild(makeElement("h4", "", patent.patentNumber + " · " + (patent.title || "未提供标题")));
        var btnGroup = makeElement("div", "share-ai-btn-group");
        var sumBtn = makeElement("button", "share-secondary-action share-ai-btn", patent.aiAnalysis && patent.aiAnalysis.summary ? "重新生成摘要分析" : "AI生成摘要分析");
        sumBtn.type = "button";
        sumBtn.dataset.shareAction = "ai-summary";
        sumBtn.dataset.patentId = patent.id;
        sumBtn.disabled = aiRunning || !hasAI;
        btnGroup.appendChild(sumBtn);
        var elemBtn = makeElement("button", "share-secondary-action share-ai-btn", patent.aiAnalysis && patent.aiAnalysis.elements ? "重新提取技术要素" : "AI提取技术要素");
        elemBtn.type = "button";
        elemBtn.dataset.shareAction = "ai-elements";
        elemBtn.dataset.patentId = patent.id;
        elemBtn.disabled = aiRunning || !hasAI;
        btnGroup.appendChild(elemBtn);
        var embBtn = makeElement("button", "share-secondary-action share-ai-btn", patent.aiAnalysis && patent.aiAnalysis.embodiments ? "重新提取实施例" : "AI提取实施例");
        embBtn.type = "button";
        embBtn.dataset.shareAction = "ai-embodiments";
        embBtn.dataset.patentId = patent.id;
        embBtn.disabled = aiRunning || !hasAI || !patent.description;
        if (!patent.description) embBtn.title = "需先导入说明书内容";
        btnGroup.appendChild(embBtn);
        header.appendChild(btnGroup);
        patentCard.appendChild(header);

        if (patent.aiAnalysis && patent.aiAnalysis.summary) {
          var aiInfo = makeElement("div", "share-ai-status", "✓ AI摘要分析已生成 · 模型: " + (patent.aiAnalysis.summary.model || "unknown") + " · " + (patent.aiAnalysis.summary.generatedAt || ""));
          patentCard.appendChild(aiInfo);
        }
        if (patent.aiAnalysis && patent.aiAnalysis.elements) {
          var aiInfo2 = makeElement("div", "share-ai-status", "✓ 技术要素已提取 · 模型: " + (patent.aiAnalysis.elements.model || "unknown"));
          patentCard.appendChild(aiInfo2);
        }
        if (patent.aiAnalysis && patent.aiAnalysis.embodiments) {
          var aiInfo3 = makeElement("div", "share-ai-status", "✓ 实施例分析已生成 · 模型: " + (patent.aiAnalysis.embodiments.model || "unknown"));
          patentCard.appendChild(aiInfo3);
        }
        patentCard.appendChild(makeElement("hr", "share-ai-divider"));
        container.appendChild(patentCard);
      });

      if (project.patents.length >= 2) {
        var compCard = makeElement("article", "share-ai-patent-card");
        var compHeader = makeElement("div", "share-ai-patent-header");
        compHeader.appendChild(makeElement("h4", "", "多专利组合分析"));
        var compBtn = makeElement("button", "share-primary-action share-ai-btn", project.aiAnalysis && project.aiAnalysis.comparison ? "重新生成对比分析" : "AI生成多专利技术路线对比");
        compBtn.type = "button";
        compBtn.dataset.shareAction = "ai-comparison";
        compBtn.disabled = aiRunning || !hasAI;
        compHeader.appendChild(compBtn);
        compCard.appendChild(compHeader);
        if (project.aiAnalysis && project.aiAnalysis.comparison) {
          compCard.appendChild(makeElement("div", "share-ai-status", "✓ 多专利对比已生成 · 模型: " + (project.aiAnalysis.comparison.model || "unknown") + " · 涉及" + (project.aiAnalysis.comparison.patentIds ? project.aiAnalysis.comparison.patentIds.length : project.patents.length) + "篇专利"));
        }
        compCard.appendChild(makeElement("hr", "share-ai-divider"));
        container.appendChild(compCard);
      }
    }

    container.appendChild(makeElement("h4", "", "项目级研发结论（人工编辑）"));
    var summary = project.researchSummary || {};
    var fields = [
      ["problem", "技术问题（项目整体）"], ["approach", "技术手段要点"], ["effect", "技术效果总结"], ["openQuestions", "待验证问题/研发启发"],
    ];
    fields.forEach(function (item) {
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
    var save = makeElement("button", "share-primary-action", "保存研发结论");
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
    var action = makeElement("button", "share-primary-action", "保存 HTML");
    action.type = "button";
    action.dataset.shareAction = "save-html";
    action.disabled = result.findings.length > 0 || project.patents.length === 0 || aiRunning;
    container.appendChild(action);
    if (result.findings.length) container.appendChild(makeElement("div", "share-inline-notice error", "导出前需要处理：" + result.findings.join("；")));
    else {
      if (project.patents.length === 0) container.appendChild(makeElement("div", "share-inline-notice error", "请先加入至少一篇专利。"));
      else container.appendChild(makeElement("div", "share-inline-notice", "未发现密钥、本机路径或本地代理地址。保存后可在无网络环境打开分享给研发团队。"));
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
    container.textContent = "";
    if (activeView === "overview") renderOverview(container, project);
    else if (activeView === "sources") renderSources(container, project);
    else if (activeView === "review") renderReview(container, project);
    else if (activeView === "modules") renderModules(container, project);
    else if (activeView === "insights") renderInsights(container, project);
    else if (activeView === "preview") renderPreview(container, project);
    else if (activeView === "export") renderExport(container, project);
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
    if (!quiet) {
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
    // 安全扫描：密钥/Token 类硬阻断；本机路径/本地地址类仅警告，确认后允许导出
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
      promise = AI.generatePatentSummary(patent).then(function(result) {
        if (result.ok) {
          window.PatentShareStore.setAIAnalysis(patentId, "summary", result);
          setNotice("已生成" + patent.patentNumber + "的技术问题-手段-效果分析。", false);
        } else {
          setNotice("AI分析失败: " + (result.error || "未知错误"), true);
        }
      });
    } else if (type === "elements") {
      promise = AI.generateTechnicalElements(patent).then(function(result) {
        if (result.ok) {
          window.PatentShareStore.setAIAnalysis(patentId, "elements", result);
          setNotice("已提取" + patent.patentNumber + "的技术要素和系统结构。", false);
        } else {
          setNotice("AI技术要素提取失败: " + (result.error || "未知错误"), true);
        }
      });
    } else if (type === "embodiments") {
      promise = AI.generateEmbodiments(patent).then(function(result) {
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
    AI.generateProcessedField(patent, field).then(function (result) {
      if (result.ok) {
        window.PatentShareStore.updateProcessedField(patentId, fieldId, {
          value: result.value,
          source: "ai",
          model: result.model,
          generatedAt: result.generatedAt,
          reviewState: "accepted",
        });
        setNotice("AI已抽取「" + field.label + "」内容。", false);
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

    AI.generateMultiPatentComparison(project.patents).then(function(result) {
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
    var total = project.patents.length + (project.patents.length >= 2 ? 1 : 0);
    var completed = 0;
    setNotice("AI批量分析开始：共" + total + "项任务（每篇专利摘要分析+技术要素" + (project.patents.length >= 2 ? "+多专利对比" : "") + "）...", false);
    render();

    var tasks = project.patents.map(function(patent) {
      return AI.generatePatentSummary(patent).then(function(result) {
        if (result.ok) window.PatentShareStore.setAIAnalysis(patent.id, "summary", result);
        completed++;
        setNotice("AI批量分析进度: " + completed + "/" + total + "...", false);
        return AI.generateTechnicalElements(patent);
      }).then(function(result) {
        if (result.ok) window.PatentShareStore.setAIAnalysis(patent.id, "elements", result);
        completed++;
        setNotice("AI批量分析进度: " + completed + "/" + total + "...", false);
      });
    });
    if (project.patents.length >= 2) {
      tasks.push(Promise.resolve().then(function() {
        return AI.generateMultiPatentComparison(project.patents);
      }).then(function(result) {
        if (result.ok) window.PatentShareStore.setProjectAIAnalysis("comparison", result);
        completed++;
      }));
    }
    Promise.all(tasks).then(function() {
      setNotice("AI批量分析全部完成！共处理 " + project.patents.length + " 篇专利" + (project.patents.length >= 2 ? "，含1项组合对比" : "") + "。", false);
    }).catch(function(err) {
      setNotice("AI批量分析部分出错: " + (err && err.message ? err.message : String(err)), true);
    }).then(function() {
      aiRunning = false;
      render();
    });
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
    var view = byId("share-workspace-view");
    if (view) view.addEventListener("click", function (event) {
      var action = event.target.closest ? event.target.closest("[data-share-action]") : null;
      if (!action) return;
      var actionName = action.dataset.shareAction;
      if (actionName === "add-current") addCurrentPatent();
      if (actionName === "search-add-patents") searchAndAddPatents();
      if (actionName === "import-csv") startSpreadsheetImport();
      if (actionName === "import-pdf") startPdfImport();
      if (actionName === "refresh-preview") render();
      if (actionName === "save-html") saveHtml();
      if (actionName === "save-research-summary") {
        window.PatentShareStore.setResearchSummary({
          problem: byId("share-research-problem") ? byId("share-research-problem").value : "",
          approach: byId("share-research-approach") ? byId("share-research-approach").value : "",
          effect: byId("share-research-effect") ? byId("share-research-effect").value : "",
          openQuestions: byId("share-research-openQuestions") ? byId("share-research-openQuestions").value : "",
        });
        setNotice("研发结论已保存；请在'分享模块'启用 R1/R6 后导出。", false);
        render();
      }
      if (actionName === "ai-analyze-all") runAIAnalyzeAll();
      if (actionName === "ai-summary" && action.dataset.patentId) runAIAnalysis(action.dataset.patentId, "summary");
      if (actionName === "ai-elements" && action.dataset.patentId) runAIAnalysis(action.dataset.patentId, "elements");
      if (actionName === "ai-embodiments" && action.dataset.patentId) runAIAnalysis(action.dataset.patentId, "embodiments");
      if (actionName === "ai-comparison") runAIComparison();
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
        var figInput = action.parentElement.querySelector(".share-figure-file-input");
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
      if (!control || control.dataset.shareAction !== "module-mode") return;
      if (window.PatentShareStore.setModuleMode(control.dataset.moduleId, control.value)) {
        setNotice("模块配置已保存。", false);
        render();
      } else {
        setNotice("该模块配置不可用。", true);
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
