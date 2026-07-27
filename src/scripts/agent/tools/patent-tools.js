/*!
 * PatentLens Agent - Patent Tools
 * 专利相关工具：封装现有UI逻辑，供Agent调用
 * 适配Electron环境（不依赖Tauri）
 */
var AgentPatentTools = (function () {
  var BUS = AgentEventBus;
  var EVT = BUS.EVENTS;

  var currentFulltextData = null;

  function waitForSearchComplete(timeoutMs) {
    return new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        resolve({ timedOut: true });
      }, timeoutMs || 30000);

      var checkInterval = setInterval(function () {
        var loadingEl = document.getElementById("loading");
        var searchBtnEl = document.getElementById("search-btn");
        if (loadingEl && loadingEl.classList.contains("hidden") && searchBtnEl && !searchBtnEl.disabled) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve({ done: true });
        }
      }, 300);
    });
  }

  function waitForFulltextComplete(timeoutMs) {
    return new Promise(function (resolve) {
      var timeout = setTimeout(function () {
        resolve({ timedOut: true });
      }, timeoutMs || 60000);

      var checkInterval = setInterval(function () {
        var searchBtnEl = document.getElementById("search-btn");
        var detailSection = document.getElementById("patent-detail-section");
        if (searchBtnEl && !searchBtnEl.disabled && detailSection && !detailSection.classList.contains("hidden")) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve({ done: true });
        }
      }, 300);
    });
  }

  function normalizePatentNumber(input) {
    if (!input) return "";
    var pn = String(input).trim().toUpperCase().replace(/[\s\/\-]/g, "");
    return pn;
  }

  function detectClaimType(text, idx) {
    if (!text) return "independent";
    var t = String(text).trim();
    var head = t.substring(0, 300);
    if (/^(根据|如|按照|依据).*(权利要求|权项|claim|claims)/i.test(head)) return "dependent";
    if (/^the\s+(claimed|present)\s+invention/i.test(head)) return "independent";
    if (/請求項\s*\d+/i.test(head)) return "dependent";
    if (/に記載/.test(head)) return "dependent";
    if (/のいずれか/.test(head)) return "dependent";
    if (/前記|所述的/.test(t.substring(0, 80))) return "dependent";
    if (/\bclaims?\s+\d+/i.test(head)) return "dependent";
    if (t.includes('根据权利要求') || t.includes('根據權利要求')) return "dependent";
    return "independent";
  }

  function getCurrentPatentData() {
    try {
      if (typeof currentData !== "undefined" && currentData) {
        var title = "";
        var applicantName = "";
        try {
          if (currentData.documents && currentData.documents.title) {
            title = currentData.documents.title;
          } else if (currentData.family && currentData.family.list && currentData.family.list.length > 0) {
            title = currentData.family.list[0].title || "";
          }
          applicantName = currentData.applicantName || "";
        } catch (e) { /* ignore */ }
        return {
          patentNumber: currentData.raw || (currentData.office + currentData.applicationNumber) || "",
          applicationNumber: currentData.applicationNumber || "",
          office: currentData.office || "",
          title: title,
          applicantName: applicantName,
          documents: currentData.documents || [],
          family: currentData.family || null,
          warnings: currentData.warnings || [],
        };
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function getCurrentFulltextData() {
    if (currentFulltextData) {
      return currentFulltextData;
    }
    if (typeof window !== "undefined" && window._currentPatentData) {
      return window._currentPatentData;
    }
    if (typeof _pdPatentCache !== "undefined") {
      var keys = Object.keys(_pdPatentCache);
      if (keys.length > 0) {
        return _pdPatentCache[keys[keys.length - 1]];
      }
    }
    return null;
  }

  function switchToTab(tabName) {
    if (tabName === "comparison") {
      var cmpBtn = document.querySelector('.search-mode-btn[data-mode="comparison"]');
      if (cmpBtn) {
        cmpBtn.click();
        return { ok: true, switchedTo: "comparison" };
      }
      return { ok: false, error: "未找到智能比对入口" };
    }
    var tabMap = {
      "overview": "overview",
      "family": "family",
      "kanban": "kanban",
      "documents": "kanban",
      "ai-analysis": "ai-analysis",
      "ai-summary": "ai-analysis",
    };
    var actualTab = tabMap[tabName] || tabName;
    var tabBtn = document.querySelector('.tab-btn[data-tab="' + actualTab + '"]');
    if (tabBtn && !tabBtn.classList.contains("active")) {
      tabBtn.click();
    } else if (tabBtn) {
      // already active
    }
    BUS.emit(EVT.TAB_SWITCH, { tab: actualTab });
    return { ok: true, switchedTo: actualTab };
  }

  function registerAll() {

    AgentTools.register({
      name: "fetch_patent",
      description: "查询专利审查档案/审查历史信息（dossier模式），获取同族专利、审查文档列表、审查时间线等审查流程相关数据。注意：此工具不包含权利要求书、说明书等专利全文内容。当用户需要：总结权利要求保护范围、查看专利全文、分析技术方案、查看说明书内容时，必须使用fetch_patent_fulltext工具。",
      parameters: {
        type: "object",
        properties: {
          patent_number: {
            type: "string",
            description: "专利号，如 US14412875, EP1234567B1, WO2023123456",
          },
        },
        required: ["patent_number"],
      },
      execute: async function (args) {
        var patentInput = document.getElementById("patent-input");
        var searchBtn = document.getElementById("search-btn");
        if (!patentInput || !searchBtn) {
          return { error: "找不到搜索输入框" };
        }

        var normalizedPn = normalizePatentNumber(args.patent_number);
        if (!normalizedPn) {
          return { error: "专利号不能为空" };
        }

        if (typeof searchMode !== "undefined" && searchMode !== "dossier") {
          var dossierBtn = document.querySelector('.search-mode-btn[data-mode="dossier"]');
          if (dossierBtn) dossierBtn.click();
        }

        patentInput.value = normalizedPn;

        if (typeof doSearch === "function") {
          try {
            await doSearch(normalizedPn, { silent: true });
          } catch (e) {
            return { error: "查询失败: " + e.message };
          }
        } else {
          searchBtn.click();
          await waitForSearchComplete(30000);
        }

        await new Promise(function (r) { return setTimeout(r, 800); });

        var data = getCurrentPatentData();
        if (data && data.patentNumber) {
          AgentCore.updateContext({ patentData: data, patentNumber: normalizedPn });

          switchToTab("overview");

          var docCount = 0;
          if (data.documents) {
            if (Array.isArray(data.documents)) {
              docCount = data.documents.length;
            } else if (data.documents.list && Array.isArray(data.documents.list)) {
              docCount = data.documents.list.length;
            }
          }

          return {
            ok: true,
            patentNumber: data.patentNumber,
            office: data.office,
            title: data.title || "(暂无标题)",
            applicantName: data.applicantName || "",
            documentCount: docCount,
            hasFamily: !!(data.family && data.family.list && data.family.list.length > 0),
            familyMemberCount: data.family && data.family.list ? data.family.list.length : 0,
            warnings: data.warnings,
          };
        }

        var pn = normalizedPn || "";
        var office = pn.replace(/[0-9].*/, "").toUpperCase();
        var espacenetUrl = "https://worldwide.espacenet.com/patent/search?q=" + encodeURIComponent(pn);
        var gpUrl = "https://patents.google.com/patent/" + encodeURIComponent(pn);
        var hint = "请确认专利号格式正确，如 US14412875, EP1234567B1, WO2023123456";
        if (office === "JP" || office === "CN" || office === "KR") {
          hint = "该专利局可能不在Global Dossier覆盖范围内。请改用fetch_patent_fulltext工具查询专利原文（包含权利要求书、说明书等），或通过open_url工具在Espacenet中查看。";
        }
        return {
          ok: false,
          error: "审查档案查询未获取到数据。" + hint,
          patentNumber: pn,
          links: {
            espacenet: espacenetUrl,
            googlePatents: gpUrl,
          },
          tip: "如果用户需要同族专利信息、权利要求、技术方案分析等，应该直接使用fetch_patent_fulltext工具，而不是审查档案查询。审查档案只用于审查历程、OA答复等审查流程相关内容。",
        };
      },
    });

    AgentTools.register({
      name: "switch_to_tab",
      description: "切换应用界面的标签页/功能模块。可选值：overview（概览）、family（同族）、kanban（审查看板/文档列表）、ai-analysis（AI分析）、comparison（智能比对）。",
      parameters: {
        type: "object",
        properties: {
          tab: {
            type: "string",
            enum: ["overview", "family", "kanban", "ai-analysis", "comparison"],
            description: "要切换到的标签页名称",
          },
        },
        required: ["tab"],
      },
      execute: function (args) {
        return Promise.resolve(switchToTab(args.tab));
      },
    });

    AgentTools.register({
      name: "get_documents_summary",
      description: "获取当前查询专利的审查文档列表摘要，包括文档类型、日期、标题等信息。需要先调用fetch_patent。",
      parameters: { type: "object", properties: {} },
      execute: function () {
        var data = getCurrentPatentData();
        if (!data) return Promise.resolve({ error: "请先调用fetch_patent查询专利" });
        var docs = [];
        var docSource = data.documents;
        var docList = [];
        if (Array.isArray(docSource)) {
          docList = docSource;
        } else if (docSource && docSource.list && Array.isArray(docSource.list)) {
          docList = docSource.list;
        } else if (docSource && Array.isArray(docSource.docs)) {
          docList = docSource.docs;
        }
        docList.forEach(function (d, i) {
          docs.push({
            idx: d.idx || i,
            type: d.type || d.docType || "",
            date: d.date || d.pubDate || "",
            title: d.title || d.description || "",
            docCode: d.docCode || "",
          });
        });
        return Promise.resolve({
          ok: true,
          patentNumber: data.patentNumber,
          count: docs.length,
          documents: docs,
        });
      },
    });

    AgentTools.register({
      name: "get_family_summary",
      description: "获取当前查询专利的同族信息摘要。需要先调用fetch_patent。",
      parameters: { type: "object", properties: {} },
      execute: function () {
        var data = getCurrentPatentData();
        if (!data || !data.family) return Promise.resolve({ error: "请先调用fetch_patent查询专利" });
        var members = [];
        if (data.family.list && Array.isArray(data.family.list)) {
          data.family.list.forEach(function (m) {
            members.push({
              country: m.countryCode || "",
              pubNum: m.pubNum || (m.docNum && m.docNum.docNumber) || "",
              appNum: m.appNum || "",
              title: m.title || "",
              kindCode: m.kindCode || "",
            });
          });
        }
        return Promise.resolve({
          ok: true,
          patentNumber: data.patentNumber,
          familyId: data.family.familyId || "",
          memberCount: members.length,
          members: members,
        });
      },
    });

    AgentTools.register({
      name: "get_patent_basic_info",
      description: "获取当前已查询专利的基本信息（专利号、标题、申请人、专利局等）。需要先调用fetch_patent。",
      parameters: { type: "object", properties: {} },
      execute: function () {
        var data = getCurrentPatentData();
        if (!data) return Promise.resolve({ error: "请先调用fetch_patent查询专利" });
        return Promise.resolve({
          patentNumber: data.patentNumber,
          applicationNumber: data.applicationNumber,
          office: data.office,
          title: data.title || "(暂无标题)",
          applicantName: data.applicantName || "",
        });
      },
    });

    AgentTools.register({
      name: "fetch_patent_fulltext",
      description: "查询专利原文（Google Patents），获取完整的专利信息包括：标题、摘要、权利要求书、说明书、申请人、发明人、申请日/公开日/优先权日、同族专利列表、引证/被引信息、法律事件等。**这是获取专利基本信息的首选工具**——除非用户明确询问审查历程、审查意见答复、审查文档列表等审查流程相关内容，否则都应使用此工具。同族专利信息也从这里获取，不需要调用审查档案的get_family_summary。",
      parameters: {
        type: "object",
        properties: {
          patent_number: {
            type: "string",
            description: "专利号，支持CN/US/EP/WO/DE/JP/KR等各国专利号，如 CN101172339B, US14412875, EP1234567B1",
          },
        },
        required: ["patent_number"],
      },
      execute: async function (args) {
        var patentInput = document.getElementById("patent-input");
        var searchBtn = document.getElementById("search-btn");
        if (!patentInput || !searchBtn) {
          return { error: "找不到搜索输入框" };
        }

        var normalizedPn = normalizePatentNumber(args.patent_number);
        if (!normalizedPn) {
          return { error: "专利号不能为空" };
        }

        if (typeof searchMode !== "undefined" && searchMode !== "patent") {
          var patentModeBtn = document.querySelector('.search-mode-btn[data-mode="patent"]');
          if (patentModeBtn) patentModeBtn.click();
        }

        patentInput.value = normalizedPn;

        var queryError = null;
        if (typeof searchPatentDetail === "function") {
          try {
            await searchPatentDetail(normalizedPn);
          } catch (e) {
            queryError = e;
          }
        } else {
          return { error: "专利原文查询功能不可用" };
        }

        await new Promise(function (r) { return setTimeout(r, 1200); });

        var data = getCurrentFulltextData();
        if (data) {
          currentFulltextData = data;
          AgentCore.updateContext({ patentFulltextData: data, patentNumber: args.patent_number });

          var familyMembers = [];
          if (data.family_applications && Array.isArray(data.family_applications)) {
            data.family_applications.forEach(function (fa) {
              familyMembers.push({
                publicationNumber: fa.publication_number || "",
                title: fa.title || "",
                status: fa.status || "",
                countryCode: fa.country_code || (fa.publication_number ? fa.publication_number.replace(/[0-9A-Z].*/, "").substring(0, 2) : ""),
              });
            });
          }

          var citations = [];
          if (data.patent_citations && Array.isArray(data.patent_citations)) {
            data.patent_citations.slice(0, 30).forEach(function (c) {
              citations.push({
                patentNumber: c.patent_number || "",
                title: c.title || "",
                assignee: c.assignee || "",
                priorityDate: c.priority_date || "",
                publicationDate: c.publication_date || "",
              });
            });
          }

          var citedBy = [];
          if (data.cited_by && Array.isArray(data.cited_by)) {
            data.cited_by.slice(0, 30).forEach(function (c) {
              citedBy.push({
                patentNumber: c.patent_number || "",
                title: c.title || "",
                assignee: c.assignee || "",
                priorityDate: c.priority_date || "",
                publicationDate: c.publication_date || "",
              });
            });
          }

          var legalEvents = [];
          if (data.legal_events && Array.isArray(data.legal_events)) {
            data.legal_events.forEach(function (le) {
              legalEvents.push({ date: le.date || "", code: le.code || "", description: le.description || "" });
            });
          }

          var result = {
            ok: true,
            patentNumber: data.patent_number || args.patent_number,
            title: data.title || "(暂无标题)",
            abstract: data.abstract || "",
            assignees: data.assignees || [],
            inventors: data.inventors || [],
            publicationDate: data.publication_date || "",
            filingDate: data.filing_date || "",
            priorityDate: data.priority_date || "",
            familyId: data.family_id || "",
            familyMembers: familyMembers,
            familyMemberCount: familyMembers.length,
            claimsCount: (data.claims || []).length,
            hasDescription: !!(data.description && data.description.length > 0),
            descriptionLength: (data.description || "").length,
            citations: citations,
            citationCount: (data.patent_citations || []).length,
            citedBy: citedBy,
            citedByCount: (data.cited_by || []).length,
            legalEvents: legalEvents,
            legalEventCount: legalEvents.length,
            dataSource: data.data_source || "Google Patents",
            links: {
              googlePatents: "https://patents.google.com/patent/" + encodeURIComponent(normalizedPn),
              espacenet: "https://worldwide.espacenet.com/patent/search?q=" + encodeURIComponent(normalizedPn),
            },
          };

          return result;
        }

        var espacenetUrl = "https://worldwide.espacenet.com/patent/search?q=" + encodeURIComponent(normalizedPn);
        var gpUrl = "https://patents.google.com/patent/" + encodeURIComponent(normalizedPn);
        return {
          ok: false,
          error: "在Google Patents中未查询到专利「" + normalizedPn + "」的数据。",
          patentNumber: normalizedPn,
          suggestion: "您可以尝试以下方式：\n1. 确认专利号格式是否正确（如 US12030161B2, EP4252965A3）\n2. 尝试在Espacenet中手动查找：在应用内打开Espacenet链接\n3. 如果您能确认该专利存在，请提供正确的专利号后继续",
          links: {
            googlePatents: gpUrl,
            espacenet: espacenetUrl,
            openInApp_espacenet: "应用内查看Espacenet（使用浏览器打开工具open_external_url）",
            openInApp_googlePatents: "应用内查看Google Patents",
          },
          tip: "向用户展示这些链接时，请说明：「您可以先在Espacenet中确认专利号是否正确，确认后再告诉我继续分析。Espacenet查询链接已提供。」不要因为查询失败就停止任务，请询问用户是否能提供正确专利号或愿意手动查找。",
        };
      },
    });

    AgentTools.register({
      name: "get_patent_claims",
      description: "获取已查询专利原文的权利要求书全文。必须先调用fetch_patent_fulltext获取专利原文。返回所有权利要求的编号、类型（独立/从属）和文本内容。",
      parameters: { type: "object", properties: {} },
      execute: function () {
        var data = getCurrentFulltextData();
        if (!data || !data.claims) {
          return Promise.resolve({ error: "请先调用fetch_patent_fulltext查询专利原文" });
        }
        var claims = (data.claims || []).map(function (c, i) {
          var claimType = c.type === "dependent" ? "dependent" : (c.type === "independent" ? "independent" : detectClaimType(c.text, i));
          return {
            num: c.num || (i + 1),
            type: claimType,
            dependentOn: c.dependent_on || null,
            text: c.text || "",
          };
        });
        return Promise.resolve({
          ok: true,
          patentNumber: data.patent_number || "",
          title: data.title || "",
          totalClaims: claims.length,
          independentClaims: claims.filter(function (c) { return c.type === "independent"; }).length,
          dependentClaims: claims.filter(function (c) { return c.type === "dependent"; }).length,
          claims: claims,
        });
      },
    });

    AgentTools.register({
      name: "get_patent_abstract",
      description: "获取已查询专利原文的摘要。必须先调用fetch_patent_fulltext。",
      parameters: { type: "object", properties: {} },
      execute: function () {
        var data = getCurrentFulltextData();
        if (!data) {
          return Promise.resolve({ error: "请先调用fetch_patent_fulltext查询专利原文" });
        }
        return Promise.resolve({
          ok: true,
          patentNumber: data.patent_number || "",
          title: data.title || "",
          abstract: data.abstract || "",
        });
      },
    });

    AgentTools.register({
      name: "get_patent_description",
      description: "获取已查询专利原文的说明书（具体实施方式、发明内容等）全文或片段。必须先调用fetch_patent_fulltext。说明书内容可能很长，可通过max_length参数限制返回长度。",
      parameters: {
        type: "object",
        properties: {
          max_length: {
            type: "number",
            description: "返回的最大字符数，默认8000。说明书可能非常长（数万字），建议根据需要截取",
          },
        },
      },
      execute: function (args) {
        var data = getCurrentFulltextData();
        if (!data) {
          return Promise.resolve({ error: "请先调用fetch_patent_fulltext查询专利原文" });
        }
        var desc = data.description || "";
        var maxLen = (args && args.max_length) || 8000;
        var truncated = false;
        if (desc.length > maxLen) {
          desc = desc.substring(0, maxLen);
          truncated = true;
        }
        return Promise.resolve({
          ok: true,
          patentNumber: data.patent_number || "",
          title: data.title || "",
          descriptionLength: (data.description || "").length,
          returnedLength: desc.length,
          truncated: truncated,
          description: desc,
          tip: truncated ? "说明书已被截断，如需更多内容可增大max_length参数" : "",
        });
      },
    });

    AgentTools.register({
      name: "get_timeline",
      description: "获取审查时间线信息，包括各审查节点（申请、公开、审查意见、授权等）的日期和事件。需要先调用fetch_patent。",
      parameters: { type: "object", properties: {} },
      execute: function () {
        var data = getCurrentPatentData();
        if (!data) return Promise.resolve({ error: "请先调用fetch_patent查询专利" });
        var timeline = [];
        try {
          var timelineBoard = document.getElementById("timeline-board");
          if (timelineBoard) {
            var items = timelineBoard.querySelectorAll(".timeline-item");
            items.forEach(function (item) {
              var date = item.querySelector(".timeline-date");
              var title = item.querySelector(".timeline-title");
              var desc = item.querySelector(".timeline-desc");
              timeline.push({
                date: date ? date.textContent.trim() : "",
                title: title ? title.textContent.trim() : "",
                description: desc ? desc.textContent.trim() : "",
              });
            });
          }
        } catch (e) {}
        if (timeline.length === 0 && data.documents) {
          var docList = Array.isArray(data.documents) ? data.documents : (data.documents.list || []);
          docList.forEach(function (d) {
            if (d.date) {
              timeline.push({
                date: d.date || "",
                title: d.type || d.docCode || "",
                description: d.title || d.description || "",
              });
            }
          });
          timeline.sort(function (a, b) { return (a.date || "").localeCompare(b.date || ""); });
        }
        return Promise.resolve({
          ok: true,
          patentNumber: data.patentNumber,
          eventCount: timeline.length,
          events: timeline.slice(0, 50),
        });
      },
    });

    AgentTools.register({
      name: "open_document_reader",
      description: "在应用内打开审查文档阅读器查看特定文档。用户可以在阅读器中查看、翻译、OCR、标注文档。需要先调用fetch_patent。**注意：此工具仅在UI上打开阅读器，不会返回文档内容文本。如果Agent需要获取文档原文用于翻译/总结/分析/输出给用户，请改用ocr_document工具，它会直接返回OCR后的markdown文本。**",
      parameters: {
        type: "object",
        properties: {
          document_index: {
            type: "number",
            description: "文档序号（从0开始），可通过get_documents_summary获取",
          },
        },
        required: ["document_index"],
      },
      execute: function (args) {
        var data = getCurrentPatentData();
        if (!data) return Promise.resolve({ error: "请先调用fetch_patent查询专利" });
        switchToTab("kanban");
        var idx = args.document_index || 0;
        setTimeout(function () {
          try {
            var docItems = document.querySelectorAll(".kanban-doc-item, .doc-list-item");
            if (docItems[idx]) {
              docItems[idx].click();
              var viewBtn = docItems[idx].querySelector(".doc-view-btn, .kanban-doc-view, [title*='阅读'], [title*='查看']");
              if (viewBtn) viewBtn.click();
            }
          } catch (e) {}
          var readerBtn = document.getElementById("reader-btn");
          if (readerBtn) readerBtn.click();
        }, 500);
        return Promise.resolve({
          ok: true,
          action: "已打开文档阅读器",
          tip: "已为您切换到审查看板并打开阅读器",
        });
      },
    });

    AgentTools.register({
      name: "ocr_document",
      description: "对指定审查文档执行OCR并返回识别文本（markdown格式）。需要先调用fetch_patent。当用户需要查看审查文档原文（如驳回意见、答复陈述、引用文献等）进行翻译/总结/分析时，使用此工具直接获取文本，而不是open_document_reader。OCR调用可能需要10-60秒。",
      parameters: {
        type: "object",
        properties: {
          document_index: {
            type: "number",
            description: "文档序号（从0开始），可通过get_documents_summary获取",
          },
          engine: {
            type: "string",
            enum: ["paddle_ocr_vl", "glm_ocr", "auto"],
            description: "OCR引擎。paddle_ocr_vl：百度PaddleOCR-VL（默认，无需API Key，精度高，推荐）；glm_ocr：智谱GLM OCR（需要API Key）；auto：自动选择并降级",
          },
          max_length: {
            type: "number",
            description: "返回文本最大字符数，默认20000。审查文档OCR结果可能很长，超出部分会截断。如需完整内容可增大此值",
          },
        },
        required: ["document_index"],
      },
      execute: async function (args) {
        var data = getCurrentPatentData();
        if (!data) {
          return { error: "请先调用fetch_patent查询专利" };
        }

        var idx = args.document_index;
        if (idx == null || idx < 0) {
          return { error: "document_index不能为空且必须>=0" };
        }

        // 1. 取文档元信息（需要 docId / numberOfPages / docFormat）
        //    优先从 kanbanState.documents（web-app.js 实际使用源），备选 currentData.documents
        var doc = null;
        try {
          if (typeof kanbanState !== "undefined" && kanbanState && Array.isArray(kanbanState.documents)) {
            for (var i = 0; i < kanbanState.documents.length; i++) {
              if (kanbanState.documents[i].idx === idx) {
                doc = kanbanState.documents[i];
                break;
              }
            }
          }
        } catch (e) { /* ignore */ }

        if (!doc) {
          try {
            if (typeof currentData !== "undefined" && currentData && currentData.documents) {
              var docSource = currentData.documents;
              var docList = [];
              if (Array.isArray(docSource)) docList = docSource;
              else if (docSource.list && Array.isArray(docSource.list)) docList = docSource.list;
              else if (Array.isArray(docSource.docs)) docList = docSource.docs;
              for (var j = 0; j < docList.length; j++) {
                var d = docList[j];
                if ((d.idx != null ? d.idx : j) === idx) { doc = d; break; }
              }
              if (!doc && docList[idx]) doc = docList[idx];
            }
          } catch (e) { /* ignore */ }
        }

        if (!doc) {
          return { error: "找不到序号 " + idx + " 的文档。请先调用get_documents_summary确认文档列表" };
        }

        if (!doc.docId) {
          return {
            error: "文档 " + idx + " 缺少docId字段，无法下载PDF。该文档可能不支持OCR",
            doc: { idx: doc.idx, docCode: doc.docCode || "", date: doc.date || "" },
          };
        }

        // 2. 构造 doExtractText 所需的 urlDocNum（与 web-app.js L8755 一致）
        //    US 用 applicationNumber 不 encode；其他用 docNumber 且 encodeURIComponent
        var office = data.office || "";
        var urlDocNum = "";
        try {
          if (office === "US") {
            urlDocNum = (typeof currentData !== "undefined" && currentData && currentData.applicationNumber)
              ? currentData.applicationNumber
              : data.applicationNumber;
          } else {
            var dn = (typeof currentData !== "undefined" && currentData && currentData.docNumber)
              ? currentData.docNumber
              : (data.docNumber || data.applicationNumber || "");
            urlDocNum = encodeURIComponent(dn);
          }
        } catch (e) { /* ignore */ }

        if (!urlDocNum) {
          return { error: "无法构造文档URL：缺少applicationNumber/docNumber" };
        }

        // 3. 选择引擎；GLM 需要API Key
        var engine = args.engine || "paddle_ocr_vl";
        var apiKey = "";
        if (engine === "glm_ocr") {
          try {
            if (typeof window !== "undefined" && window.AI && typeof window.AI.getGlmOcrApiKey === "function") {
              // 与 web-app.js L8746 一致：通过 window.AI.loadAIConfig() 取配置
              var config = (typeof window.AI.loadAIConfig === "function") ? window.AI.loadAIConfig() : {};
              apiKey = window.AI.getGlmOcrApiKey(config) || "";
            }
          } catch (e) { /* ignore */ }
          if (!apiKey) {
            return {
              error: "GLM OCR 引擎需要API Key，但未检测到配置",
              suggestion: "请改用 engine: 'paddle_ocr_vl'（默认，无需API Key），或在应用设置中配置智谱API Key后重试",
            };
          }
        }

        // 4. 调用 doExtractText（已封装 Tauri / Web 双环境 + JP JPO API + DE DPMA 降级）
        var result;
        try {
          if (typeof doExtractText !== "function") {
            return { error: "doExtractText 函数不可用，无法执行OCR" };
          }
          result = await doExtractText(
            office,
            urlDocNum,
            doc.docId,
            String(doc.numberOfPages || "1"),
            doc.docFormat || "pdf",
            engine,
            apiKey
          );
        } catch (e) {
          return {
            error: "OCR调用失败: " + (e && e.message ? e.message : String(e)),
            doc: { idx: doc.idx, docCode: doc.docCode || "", date: doc.date || "" },
            engine: engine,
          };
        }

        if (!result) {
          return { error: "OCR返回空结果", engine: engine };
        }

        // 5. 错误且无有效文本 → 返回错误并建议切换引擎
        if (result.error && !(result.text || result.markdown)) {
          return {
            error: "OCR返回错误: " + result.error,
            engine: result.engine || engine,
            suggestion: engine === "paddle_ocr_vl"
              ? "可尝试改用 glm_ocr 引擎（需配置智谱API Key）"
              : "可尝试改用 paddle_ocr_vl 引擎",
          };
        }

        // 6. 截断并返回 markdown + text
        var md = result.markdown || "";
        var text = result.text || "";
        var maxLen = args.max_length || 20000;
        var truncated = false;
        if (md.length > maxLen) { md = md.substring(0, maxLen); truncated = true; }
        if (text.length > maxLen) { text = text.substring(0, maxLen); truncated = true; }

        return {
          ok: true,
          patentNumber: data.patentNumber,
          docIndex: idx,
          docCode: doc.docCode || "",
          docDate: doc.date || "",
          docTitle: doc.name || doc.title || doc.desc || "",
          engine: result.engine || engine,
          charCount: (result.text || "").length,
          markdownLength: (result.markdown || "").length,
          blockCount: result.blocks ? result.blocks.length : 0,
          truncated: truncated,
          markdown: md,
          text: text,
          tip: truncated
            ? "OCR结果已截断至" + maxLen + "字符。如需完整内容可增大max_length参数后重试"
            : "OCR识别完成。markdown字段含结构化文本（含表格/公式标记），text字段为纯文本。可直接基于此内容做翻译/总结/分析",
        };
      },
    });

    AgentTools.register({
      name: "run_ai_analysis",
      description: "触发AI审查意见梳理，在后台自动执行（无需用户操作界面）。通常在用户通过对话确认要分析哪些文档后调用。如果用户说「全部文档」「所有文档」「直接分析」，直接调用即可（默认全选）。需要先调用fetch_patent。",
      parameters: {
        type: "object",
        properties: {
          auto_select: {
            type: "boolean",
            description: "是否自动选择全部文档并开始分析，默认true。后台自动完成，不会弹出面板让用户操作。",
          },
        },
      },
      execute: function (args) {
        var data = getCurrentPatentData();
        if (!data) return Promise.resolve({ error: "请先调用fetch_patent查询专利" });
        switchToTab("ai-analysis");
        var autoSelect = args.auto_select !== false;
        setTimeout(function () {
          try {
            var analyzeBtn = document.getElementById("kanban-manual-select-btn");
            if (analyzeBtn && !analyzeBtn.disabled) {
              analyzeBtn.click();
              if (autoSelect) {
                setTimeout(function () {
                  var confirmBtns = document.querySelectorAll(".ai-manual-select .btn-primary, #confirm-select-btn");
                  if (confirmBtns.length > 0) {
                    var lastBtn = confirmBtns[confirmBtns.length - 1];
                    lastBtn.click();
                  }
                }, 800);
              }
            }
          } catch (e) {}
        }, 500);
        return Promise.resolve({
          ok: true,
          action: "已在后台启动AI审查意见梳理",
          tip: "AI正在分析审查文档，请稍候在AI分析标签页查看结果。分析完成后您可以在页面上查看完整梳理内容。",
          waitForUser: false,
        });
      },
    });

    AgentTools.register({
      name: "get_analysis_result",
      description: "获取AI审查分析结果。如果分析仍在进行中会返回inProgress=true，此时不要继续轮询，应直接finish告知用户稍后查看。最多调用2次。",
      parameters: { type: "object", properties: {} },
      execute: function () {
        try {
          var analysisContent = document.getElementById("kanban-analysis-content");
          if (analysisContent) {
            var isHidden = analysisContent.classList.contains("hidden");
            var text = analysisContent.textContent || "";
            if (text.trim().length > 0) {
              var preview = text.substring(0, 500);
              var inProgress = /提取中|梳理中|分析中|处理中|loading|请稍候|正在/.test(preview);
              return Promise.resolve({
                ok: true,
                hasResult: !isHidden && !inProgress && text.trim().length > 0,
                inProgress: inProgress,
                contentLength: text.length,
                preview: preview,
                tip: inProgress ? "分析仍在进行中，不要继续轮询，请直接finish告知用户稍后在AI分析标签页查看结果" : "分析已完成",
              });
            }
          }
        } catch (e) {}
        return Promise.resolve({
          ok: true,
          hasResult: false,
          inProgress: false,
          message: "分析结果尚未生成，请先调用run_ai_analysis触发分析",
        });
      },
    });

    AgentTools.register({
      name: "fetch_dossier_and_analyze",
      description: "一站式查询专利审查档案。查询成功后返回审查文档列表，你可以在对话中向用户展示并询问要分析哪些文档。如果用户说「全部」「直接分析」，传auto_select=true即可在后台自动开始AI分析（无需用户操作界面）。仅当用户明确要求「梳理审查意见」时使用。",
      parameters: {
        type: "object",
        properties: {
          patent_number: {
            type: "string",
            description: "专利号",
          },
          auto_select: {
            type: "boolean",
            description: "是否查询完成后自动全选文档并开始AI分析，默认false（只查询返回文档列表，在对话中问用户选择）。设为true则后台自动执行。",
          },
        },
        required: ["patent_number"],
      },
      execute: async function (args) {
        var patentInput = document.getElementById("patent-input");
        if (!patentInput) return { error: "找不到搜索输入框" };
        var normalizedPn = normalizePatentNumber(args.patent_number);
        if (!normalizedPn) return { error: "专利号不能为空" };
        if (typeof searchMode !== "undefined" && searchMode !== "dossier") {
          var dossierBtn = document.querySelector('.search-mode-btn[data-mode="dossier"]');
          if (dossierBtn) dossierBtn.click();
        }
        patentInput.value = normalizedPn;
        if (typeof doSearch === "function") {
          try {
            await doSearch(normalizedPn, { silent: true });
          } catch (e) {
            return { error: "查询失败: " + e.message };
          }
        } else {
          var searchBtn = document.getElementById("search-btn");
          if (searchBtn) searchBtn.click();
          await waitForSearchComplete(30000);
        }
        await new Promise(function (r) { return setTimeout(r, 1500); });
        var data = getCurrentPatentData();
        if (!data) {
          return { ok: false, error: "查询失败，未获取到专利数据。请确认专利号格式正确，如 US14412875, EP1234567B1, WO2023123456" };
        }
        AgentCore.updateContext({ patentData: data, patentNumber: args.patent_number });
        var docs = [];
        var docList = [];
        if (data.documents) {
          if (Array.isArray(data.documents)) docList = data.documents;
          else if (data.documents.list) docList = data.documents.list;
          else if (Array.isArray(data.documents.docs)) docList = data.documents.docs;
        }
        docList.forEach(function (d, i) {
          docs.push({
            idx: d.idx || i,
            type: d.type || d.docType || "",
            date: d.date || d.pubDate || "",
            title: d.title || d.description || "",
            docCode: d.docCode || "",
          });
        });
        var autoSelect = args.auto_select === true;
        if (autoSelect) {
          setTimeout(function () {
            switchToTab("ai-analysis");
            setTimeout(function () {
              var analyzeBtn = document.getElementById("kanban-manual-select-btn");
              if (analyzeBtn && !analyzeBtn.disabled) {
                analyzeBtn.click();
                setTimeout(function () {
                  var confirmBtns = document.querySelectorAll(".ai-manual-select .btn-primary, #confirm-select-btn");
                  if (confirmBtns.length > 0) {
                    var lastBtn = confirmBtns[confirmBtns.length - 1];
                    lastBtn.click();
                  }
                }, 800);
              }
            }, 500);
          }, 800);
        }
        return {
          ok: true,
          patentNumber: data.patentNumber,
          title: data.title || "",
          documentCount: docs.length,
          documents: docs,
          action: autoSelect ? "已查询专利并在后台启动AI分析" : "已查询专利，返回文档列表",
          tip: autoSelect
            ? "已在后台自动选择全部文档并开始AI审查意见梳理，请稍候在AI分析标签页查看结果。"
            : "审查档案已查询成功，共" + docs.length + "份文档。请在对话中展示文档列表，询问用户要分析哪些文档；用户确认后调用run_ai_analysis(auto_select=true)后台执行。绝不要让用户去界面上手动勾选！",
          waitForUser: !autoSelect,
          openInApp: { patentNumber: data.patentNumber, mode: "dossier" },
        };
      },
    });

    AgentTools.register({
      name: "get_patent_family",
      description: "获取已查询专利原文的同族专利列表。必须先调用fetch_patent_fulltext获取专利原文。返回同族专利的公开号、标题、状态等信息。注意：同族信息从Google Patents数据中获取，不需要调用审查档案的get_family_summary。",
      parameters: { type: "object", properties: {} },
      execute: function () {
        var data = getCurrentFulltextData();
        if (!data) {
          return Promise.resolve({
            ok: false,
            error: "请先调用fetch_patent_fulltext查询专利原文",
            tip: "同族专利信息来自Google Patents，需要先查询专利原文才能获取。如果审查档案的get_family_summary失败（如500错误），这是正常的备用方案。",
          });
        }
        var members = [];
        if (data.family_applications && Array.isArray(data.family_applications)) {
          data.family_applications.forEach(function (fa) {
            members.push({
              publicationNumber: fa.publication_number || "",
              title: fa.title || "",
              status: fa.status || "",
            });
          });
        }
        return Promise.resolve({
          ok: true,
          patentNumber: data.patent_number || "",
          title: data.title || "",
          familyId: data.family_id || "",
          memberCount: members.length,
          familyMembers: members,
        });
      },
    });

    AgentTools.register({
      name: "open_url",
      description: "在应用内打开外部网页链接（如Espacenet、Google Patents等）。当专利查询失败需要用户手动确认时，可调用此工具打开Espacenet链接让用户查看。",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "要打开的完整URL地址，如 https://worldwide.espacenet.com/patent/search?q=US11407039B2",
          },
          title: {
            type: "string",
            description: "（可选）窗口标题",
          },
        },
        required: ["url"],
      },
      execute: function (args) {
        try {
          if (typeof openInAppWebview === "function") {
            openInAppWebview(args.url, args.title || "外部链接");
            return Promise.resolve({ ok: true, action: "已在应用内打开链接: " + args.url });
          }
          window.open(args.url, "_blank");
          return Promise.resolve({ ok: true, action: "已在新窗口打开链接: " + args.url });
        } catch (e) {
          return Promise.resolve({ ok: false, error: "打开链接失败: " + e.message });
        }
      },
    });
  }

  return { registerAll: registerAll };
})();
