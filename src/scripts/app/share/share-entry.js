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

    // 详情卡头部
    var header = makeElement("div", "share-review-header");
    var headerLeft = makeElement("div", "share-review-header-left");
    headerLeft.appendChild(makeElement("h4", "", patent.patentNumber));
    headerLeft.appendChild(makeElement("p", "share-review-header-subtitle", patent.title || "未提供标题"));
    var sourceMeta = makeElement("div", "share-review-meta-row");
    var srcType = patent.source && patent.source.type ? readableSource({ source: patent.source.type }) : "专利原文";
    sourceMeta.appendChild(makeElement("span", "", "来源：" + srcType));
    if (patent.source && patent.source.capturedAt) {
      try { sourceMeta.appendChild(makeElement("span", "", " · 抓取：" + new Date(patent.source.capturedAt).toLocaleString())); } catch (_) {}
    }
    var figCount = patent.figures ? patent.figures.length : 0;
    var claimCount = Array.isArray(patent.claims) ? patent.claims.length : 0;
    sourceMeta.appendChild(makeElement("span", "", " · " + claimCount + "项权利要求 · " + figCount + "张附图"));
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

    // 悬浮导航条 + 进度条
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
          claimText.innerHTML = applyAnnotations(claim.text || "", patent.claimsAnnotations, claim.number || "");
          claimItem.appendChild(claimText);
          // 标注工具条
          var annoBar = makeElement("div", "review-anno-bar");
          annoBar.appendChild(makeAnnoBtn("underline", "下划线", patent.id, "claims", claim.number || ""));
          annoBar.appendChild(makeAnnoBtn("highlight", "高亮", patent.id, "claims", claim.number || ""));
          annoBar.appendChild(makeAnnoBtn("comment", "注释", patent.id, "claims", claim.number || ""));
          annoBar.appendChild(makeAnnoBtn("clear", "清除标注", patent.id, "claims", claim.number || ""));
          claimItem.appendChild(annoBar);
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
        descText.innerHTML = applyAnnotations(patent.description.length > 2000 ? patent.description.slice(0, 2000) + "..." : patent.description, patent.descriptionAnnotations, "");
        descPreview.appendChild(descText);
        body.appendChild(descPreview);
        // 标注工具条
        var descAnnoBar = makeElement("div", "review-anno-bar");
        descAnnoBar.appendChild(makeAnnoBtn("underline", "下划线", patent.id, "description", ""));
        descAnnoBar.appendChild(makeAnnoBtn("highlight", "高亮", patent.id, "description", ""));
        descAnnoBar.appendChild(makeAnnoBtn("comment", "注释", patent.id, "description", ""));
        descAnnoBar.appendChild(makeAnnoBtn("clear", "清除标注", patent.id, "description", ""));
        body.appendChild(descAnnoBar);
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
    btn.disabled = aiRunning;
    return btn;
  }

  // 将标注应用到文本，返回 HTML
  function applyAnnotations(text, annotations, key) {
    if (!text) return "";
    var html = escapeHtmlForAnno(text);
    if (!annotations || !Array.isArray(annotations) || !annotations.length) return html;
    // 按 start 降序排列，从后往前插入标签
    var sorted = annotations.filter(function(a) { return a.key === key; }).sort(function(a, b) { return (b.start || 0) - (a.start || 0); });
    sorted.forEach(function(anno) {
      var start = anno.start || 0;
      var end = anno.end || start;
      if (start < 0 || end > html.length || start > end) return;
      var before = html.slice(0, start);
      var middle = html.slice(start, end);
      var after = html.slice(end);
      if (anno.type === "underline") {
        middle = '<span class="anno-underline">' + middle + '</span>';
      } else if (anno.type === "highlight") {
        middle = '<mark class="anno-highlight">' + middle + '</mark>';
      } else if (anno.type === "comment" && anno.comment) {
        middle = '<span class="anno-comment" title="' + escapeHtmlForAnno(anno.comment) + '">' + middle + '<sup>注</sup></span>';
      }
      html = before + middle + after;
    });
    return html;
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

  function renderModules(container, project) {
    addHeading(container, viewMeta.modules);
    addNotice(container);
    var registry = window.PatentShareModules;
    if (!registry) { renderPlaceholder(container, "modules", project); return; }
    var config = registry.resolveConfig(project.moduleConfig);
    var hint = makeElement("p", "share-module-hint", "点击模块切换「完整 / 精简 / 关闭」模式。拖拽模块卡片可调整在分享页面中的显示顺序。配置自动保存并在预览与导出中生效。");
    container.appendChild(hint);

    // 可视化布局编辑器：模拟最终分享 HTML 的版面结构
    var preview = makeElement("div", "share-module-visual");
    preview.appendChild(makeElement("div", "share-module-visual-hint", "以下版面模拟最终分享网页的布局结构，各模块可点击切换或拖拽排序"));

    // 模拟封面区
    var coverZone = makeElement("div", "share-module-zone cover-zone");
    coverZone.appendChild(makeElement("div", "share-module-zone-label", "封面区"));
    var allModules = registry.list();
    var basicModules = allModules.filter(function(m) { return m.category === "basic"; });
    var processedModules = allModules.filter(function(m) { return m.category === "processed"; });

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
    block.draggable = !aiRunning;

    var dragHandle = makeElement("div", "share-module-drag-handle", "⋮⋮");
    dragHandle.title = "拖拽排序";
    block.appendChild(dragHandle);

    var info = makeElement("div", "share-module-block-info");
    info.appendChild(makeElement("span", "share-module-block-id", module.id));
    info.appendChild(makeElement("span", "share-module-block-label", module.label));
    if (module.required) info.appendChild(makeElement("span", "share-module-block-required", "必要"));
    block.appendChild(info);

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
    var dropZones = container.querySelectorAll(".share-module-drop-zone");
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
    if (activeView === "review") bindReviewScrollSpy();
  }

  // 数据审核页：悬浮导航条 active 状态与滚动进度
  var reviewScrollSpyBound = false;
  function bindReviewScrollSpy() {
    var navBar = document.querySelector(".share-review-nav");
    if (!navBar) return;
    var sections = document.querySelectorAll(".share-review-section[id^='review-section-']");
    var navBtns = navBar.querySelectorAll("[data-review-nav]");
    if (!sections.length || !navBtns.length) return;
    var progress = navBar.querySelector(".share-review-nav-progress");

    function updateActive() {
      var viewTop = window.scrollY || document.documentElement.scrollTop;
      var viewH = window.innerHeight || document.documentElement.clientHeight;
      var offset = viewTop + viewH * 0.3;
      var activeId = null;
      sections.forEach(function (sec) {
        var top = sec.getBoundingClientRect().top + viewTop;
        if (top <= offset) activeId = sec.id;
      });
      var scrollableH = (document.documentElement.scrollHeight || document.body.scrollHeight) - viewH;
      var pct = scrollableH > 0 ? Math.min(100, Math.max(0, (viewTop / scrollableH) * 100)) : 0;
      if (progress) progress.style.width = pct + "%";
      navBtns.forEach(function (btn) {
        btn.classList.toggle("active", activeId === "review-section-" + btn.dataset.reviewNav);
      });
    }

    if (reviewScrollSpyBound) {
      window.removeEventListener("scroll", updateActive);
      window.removeEventListener("resize", updateActive);
    }
    window.addEventListener("scroll", updateActive, { passive: true });
    window.addEventListener("resize", updateActive, { passive: true });
    reviewScrollSpyBound = true;
    updateActive();
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
        // 找到对应的可标注文本元素
        var annoContainer = action.closest(".review-claim-item, .share-review-section-body");
        var annoTextEl = annoContainer ? annoContainer.querySelector(".review-annotatable[data-annotation-field='" + annoField + "']" + (annoKey ? "[data-annotation-key='" + annoKey + "']" : "")) : null;
        if (!annoTextEl) return;
        var sel = window.getSelection();
        if (annoType === "clear") {
          if (window.PatentShareStore.clearAnnotations) {
            window.PatentShareStore.clearAnnotations(action.dataset.patentId, annoField, annoKey);
            setNotice("已清除该区域标注。", false);
            render();
          }
          return;
        }
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          setNotice("请先选中文本再点击标注按钮。", true);
          return;
        }
        var range = sel.getRangeAt(0);
        // 确保选区在标注文本元素内
        if (!annoTextEl.contains(range.commonAncestorContainer)) {
          setNotice("请选中该区域内的文本再标注。", true);
          return;
        }
        // 计算选区在纯文本中的位置
        var fullText = annoTextEl.textContent || "";
        var selectedText = range.toString();
        var startIdx = fullText.indexOf(selectedText);
        if (startIdx < 0) { setNotice("无法定位选中文本。", true); return; }
        var endIdx = startIdx + selectedText.length;
        var comment = "";
        if (annoType === "comment") {
          PatentShareUI.prompt("请输入注释内容", "").then(function (input) {
            if (!input) { setNotice("未输入注释内容。", true); return; }
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
              start: startIdx, end: endIdx, text: selectedText, comment: comment,
            });
            setNotice("标注已保存。", false);
            render();
          }
        }
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
