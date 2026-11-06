/*!
 * PatentLens - Global Dossier Citation Data
 *
 * GD 的 Citation Data 页面由 /citation-classification/svc/citation/application/{cc}/{doc}/{kc}
 * 提供，返回 citationList（专利文献）与 nplCitationList（非专利文献）。
 * 本模块在专利原文详情「引用」面板追加 GD 引用数据，并复用现有 GP 跳转能力：
 * 点击引用专利号即可在应用内打开 Google Patents 原文模式。
 *
 * web-app.js 已冻结；这里通过运行时包装 renderPatentDetail 注入面板，不修改 legacy 文件。
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var SECTION_ID = "gd-citation-section";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizePatentNumber(value) {
    return String(value || "").trim().toUpperCase().replace(/[\s\/]+/g, "");
  }

  function parseNumberFallback(patentNumber) {
    var raw = normalizePatentNumber(patentNumber);
    var match = raw.match(/^([A-Z]{2})(\d+)([A-Z]\d*)?$/);
    if (!match) return null;
    var kind = match[3] || "";
    var queryType = "application";
    if (kind) queryType = /^B\d*$/.test(kind) ? "patent" : "publication";
    return {
      office: match[1],
      applicationNumber: match[2],
      kindCode: kind,
      queryType: queryType,
    };
  }

  function parseContext(data) {
    var patentNumber = normalizePatentNumber(
      (data && (data.patent_number || data.publication_number)) || ""
    );
    if (!patentNumber) return null;

    var parsed = null;
    try {
      if (typeof parsePatentNumber === "function") {
        parsed = parsePatentNumber(patentNumber);
      }
    } catch (_) {}
    if (!parsed) parsed = parseNumberFallback(patentNumber);
    if (!parsed) return null;

    return {
      patentNumber: patentNumber,
      office: String(parsed.office || "").toUpperCase(),
      applicationNumber: String(parsed.applicationNumber || "").replace(/[^0-9A-Z]/gi, ""),
      kindCode: String(parsed.kindCode || "").toUpperCase(),
      queryType: parsed.queryType || "application",
    };
  }

  function familyOwnEntry(family, office) {
    if (!family || !Array.isArray(family.list)) return null;
    var target = String(office || "").toUpperCase();
    var own = family.list.filter(function (item) {
      return String((item && item.countryCode) || "").toUpperCase() === target;
    });
    return own.length ? own[0] : null;
  }

  async function resolveGdReference(context) {
    var ref = {
      office: context.office,
      docNumber: context.applicationNumber,
      kindCode: context.kindCode || "A",
      queryType: context.queryType,
    };
    if (!ref.office || !ref.docNumber) return ref;
    if (context.queryType === "application") return ref;

    try {
      var family = await window.gdFetch(
        "/patent-family/svc/family/" + encodeURIComponent(context.queryType) +
        "/" + encodeURIComponent(context.office) +
        "/" + encodeURIComponent(context.applicationNumber)
      );
      var own = familyOwnEntry(family, context.office);
      var corr = family && family.corrAppNum;
      if (corr) ref.docNumber = String(corr);
      else if (own && own.appNum) ref.docNumber = String(own.appNum);
      else if (own && own.docNum && own.docNum.docNumber) ref.docNumber = String(own.docNum.docNumber);
      if (own && own.docNum && own.docNum.kindCode) ref.kindCode = String(own.docNum.kindCode);
    } catch (_) {}
    return ref;
  }

  function citationNumber(item) {
    if (!item) return "";
    var doc = item.citedDocument || {};
    var country = String(doc.docCountry || item.docCountry || "");
    var number = String(doc.docNumber || item.docNumber || "");
    var kind = String(doc.docKindCode || doc.kindCode || item.docKindCode || item.kindCode || "");
    if (country || number) return (country + number + kind).replace(/\/+/, "");
    return String(item.patentNumber || item.publicationNumber || item.number || "");
  }

  function citationTitle(item) {
    var doc = item && item.citedDocument;
    return String((doc && (doc.title || doc.docTitle)) || (item && (item.title || item.docTitle)) || "");
  }

  function splitSections(text) {
    var value = String(text || "")
      .replace(/\\n\\n/g, "\n\n")
      .replace(/\\n/g, "\n")
      .replace(/null/g, "");
    return value.split(/\n\n/).map(function (part) {
      return part.trim();
    }).filter(Boolean);
  }

  function cleanCitedIn(value) {
    if (!value) return "";
    return String(value).split(/\n/).map(function (line) {
      return line.trim();
    }).filter(function (line) {
      return line && !/^(undefined|origin)$/i.test(line);
    }).join("\n");
  }

  function cleanToken(token) {
    return String(token || "")
      .replace(/\s+/g, " ")
      .replace(/^[\s|,;:]+/, "")
      .replace(/[)\]]+$/, "")
      .replace(/^[(\[]+/, "")
      .replace(/[\s|,;:]+$/, "")
      .trim();
  }

  function classifyToken(token) {
    var text = String(token || "").trim();
    var head = text.toLowerCase().split(/[.\s]/)[0];
    if (head === "fig" || head === "figure" || head === "figures") return "figure";
    if (head === "claim" || head === "claims") return "claim";
    if (head === "col" || head === "column" || head === "columns" || head === "c") return "column";
    if (head === "section" || head === "sections" || /^§/.test(text)) return "section";
    if (head === "line" || head === "lines" || head === "l") return "lines";
    if (head === "paragraph" || head === "paragraphs" || head === "para" || /^¶/.test(text)) return "paragraph";
    return "text";
  }

  function tokenLabel(token, kind) {
    if (kind === "figure") {
      var figureMatch = token.match(/^fig(?:ures?)?\.?\s+/i);
      var figurePlural = !!(figureMatch && /s/i.test(figureMatch[0]));
      return (figurePlural ? "Figs. " : "Fig. ") + token.slice(figureMatch ? figureMatch[0].length : 0);
    }
    if (kind === "claim") {
      var claimMatch = token.match(/^claims?\s+/i);
      var claimPlural = !!(claimMatch && /s/i.test(claimMatch[0]));
      return (claimPlural ? "Claims " : "Claim ") + token.slice(claimMatch ? claimMatch[0].length : 0);
    }
    if (kind === "section") return token.replace(/^sections?\s+/i, "§ ");
    if (kind === "lines") return token.replace(/^lines?\s+/i, "l. ");
    if (kind === "paragraph") return token.replace(/^paragraphs?\s+/i, "¶ ");
    return token;
  }

  function tokenizeSection(text) {
    var seen = {};
    return String(text || "")
      .split(/[|\n]+/)
      .map(cleanToken)
      .filter(function (token) {
        return token && !/^(undefined|origin)$/i.test(token);
      })
      .map(function (token) {
        var kind = classifyToken(token);
        return { kind: kind, label: tokenLabel(token, kind) };
      })
      .filter(function (token) {
        var key = token.kind + ":" + token.label.toLowerCase();
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
  }

  function sectionHtml(list) {
    if (!list.length) return "";
    var html = "";
    list.forEach(function (part) {
      var tokens = tokenizeSection(part);
      if (!tokens.length) return;
      html += '<div class="gd-sect-block"><div class="gd-sect-tags">';
      tokens.forEach(function (token) {
        html += '<span class="gd-tag gd-tag-' + token.kind + '">' + escapeHtml(token.label) + "</span> ";
      });
      html += "</div></div>";
    });
    return html;
  }

  function formatClaimRef(claims) {
    var value = String(claims || "").trim().replace(/^claims?\s*:\s*/i, "");
    if (!value) return "";
    if (/^claims?\b/i.test(value)) return value;
    var multiple = /[,;\-–]|\band\b/i.test(value);
    return (multiple ? "Claims " : "Claim ") + value;
  }

  function categoryClass(category) {
    var code = String(category || "").trim().toUpperCase();
    if (code === "X") return "gd-rel-x";
    if (code === "Y") return "gd-rel-y";
    if (code === "A") return "gd-rel-a";
    if (code === "E") return "gd-rel-e";
    if (code === "D") return "gd-rel-d";
    return "gd-rel-other";
  }

  function relevantInfoHtml(list) {
    if (!Array.isArray(list) || !list.length) return "";
    var html = '<div class="gd-rel-list">';
    list.forEach(function (info) {
      var category = String((info && info.category) || "").trim();
      var claims = String((info && info.claims) || "").trim();
      if (!category && !claims) return;
      html += '<div class="gd-rel-item">';
      if (category) {
        html += '<span class="gd-rel-badge ' + categoryClass(category) + '">' + escapeHtml(category) + "</span> ";
      }
      if (claims) {
        html += '<span class="gd-rel-claims">' + escapeHtml(formatClaimRef(claims)) + "</span>";
      }
      html += "</div>";
    });
    html += "</div>";
    return html;
  }

  function citedHtml(value) {
    var text = String(value || "").trim();
    if (!text) return "-";
    var parts = text.split(/[,;\n\t]+/).map(function (part) {
      return part.trim();
    }).filter(Boolean);
    if (!parts.length) return "-";
    if (parts.length === 1) {
      return '<span class="gd-tag gd-tag-text">' + escapeHtml(parts[0]) + "</span>";
    }
    return '<div class="gd-sect-tags">' + parts.map(function (part) {
      return '<span class="gd-tag gd-tag-text">' + escapeHtml(part) + "</span> ";
    }).join("") + "</div>";
  }

  function patentRowsHtml(citationList) {
    var rows = "";
    citationList.forEach(function (item) {
      var number = citationNumber(item);
      var title = citationTitle(item);
      var sections = sectionHtml(splitSections(item && (item.relevancyText || item.text)));
      var relevancy = relevantInfoHtml(item && item.relevantInfos);
      var citedIn = cleanCitedIn(item && item.citedIn);
      var citedBy = String((item && item.citedBy) || "");
      rows += "<tr>";
      rows += '<td class="gd-citation-num">';
      if (number) {
        rows += '<a class="pd-patent-link" data-patent="' + escapeHtml(number) + '">' + escapeHtml(number) + "</a>";
        if (typeof window.patentLinkButtons === "function") {
          rows += window.patentLinkButtons(number);
        }
      }
      if (title) rows += '<div class="gd-citation-relevance">' + escapeHtml(title) + "</div>";
      rows += "</td>";
      rows += "<td>" + (sections || "-") + "</td>";
      rows += "<td>" + (relevancy || "-") + "</td>";
      rows += "<td>" + citedHtml(citedIn) + "</td>";
      rows += "<td>" + citedHtml(citedBy) + "</td>";
      rows += "</tr>";
    });
    return rows;
  }

  function nplRowsHtml(nplList) {
    var rows = "";
    nplList.forEach(function (item) {
      var text = String((item && (item.text || item.nplText)) || "");
      var source = String((item && (item.citationSource || item.url)) || "");
      var citedIn = cleanCitedIn(item && item.citedIn);
      var citedBy = String((item && item.citedBy) || "");
      rows += "<tr>";
      rows += "<td>";
      rows += text ? escapeHtml(text).replace(/\n/g, "<br>") : "-";
      if (source) {
        rows += '<div><button type="button" class="btn-small btn-secondary gd-citation-open-link" data-url="'
          + escapeHtml(source) + '">查看引用</button></div>';
      }
      rows += "</td>";
      rows += "<td>" + citedHtml(citedIn) + "</td>";
      rows += "<td>" + citedHtml(citedBy) + "</td>";
      rows += "</tr>";
    });
    return rows;
  }

  function bindColumnFilters(body) {
    if (!body) return;
    body.querySelectorAll(".gd-citation-table").forEach(function (table) {
      var inputs = table.querySelectorAll(".gd-citation-filter");
      if (!inputs.length) return;

      function applyFilters() {
        var rows = table.querySelectorAll("tbody tr");
        rows.forEach(function (row) {
          var show = true;
          inputs.forEach(function (input) {
            var keyword = String(input.value || "").trim().toLowerCase();
            if (!keyword) return;
            var col = parseInt(input.getAttribute("data-col"), 10);
            var cell = row.children[col];
            var text = cell ? String(cell.textContent || "").toLowerCase() : "";
            if (text.indexOf(keyword) === -1) show = false;
          });
          row.style.display = show ? "" : "none";
        });
      }

      inputs.forEach(function (input) {
        input.addEventListener("input", applyFilters);
        input.addEventListener("keydown", function (event) {
          if (event.key === "Escape") {
            input.value = "";
            applyFilters();
          }
        });
      });
    });
  }

  function renderCitationData(body, response) {
    var citationList = response && Array.isArray(response.citationList) ? response.citationList : [];
    var nplList = response && Array.isArray(response.nplCitationList) ? response.nplCitationList : [];

    // EPO 降级源没有 Citation Data 模块：这是数据源能力差异，不是网络故障。
    if (response && response.noCitationModule) {
      body.innerHTML = '<div class="gd-citation-empty">'
        + escapeHtml(response.note || "EPO GD 不提供引用模块，引用情况请以上方 GP 引用数据为准。") + "</div>";
      return;
    }

    if (!citationList.length && !nplList.length) {
      var emptyPanel = body.closest ? body.closest(".pd-tab-panel") : null;
      var emptyEl = emptyPanel ? emptyPanel.querySelector(".pd-empty") : null;
      if (emptyEl) emptyEl.style.display = "";
      body.innerHTML = '<div class="gd-citation-empty">未获取到 GD Citation Data。该申请可能尚无引用数据，或 GD 当前未返回该部分。</div>';
      return;
    }

    var panel = body.closest ? body.closest(".pd-tab-panel") : null;
    var empty = panel ? panel.querySelector(".pd-empty") : null;
    if (empty) empty.style.display = "none";

    var html = "";
    if (citationList.length) {
      html += '<div class="pd-section-title">Patent documents（专利文献 ' + citationList.length + '）</div>';
      html += '<div class="gd-citation-table-wrap"><table class="gd-citation-table gd-citation-table-patent"><thead><tr>';
      html += "<th>Publication/patent number</th><th>Relevant Section</th><th>Relevancy/Claims</th><th>Cited in</th><th>Cited by</th>";
      html += '</tr><tr class="gd-citation-filter-row">';
      html += '<th><input type="text" class="gd-citation-filter" data-col="0" placeholder="筛选..."></th>';
      html += '<th><input type="text" class="gd-citation-filter" data-col="1" placeholder="筛选..."></th>';
      html += '<th><input type="text" class="gd-citation-filter" data-col="2" placeholder="筛选..."></th>';
      html += '<th><input type="text" class="gd-citation-filter" data-col="3" placeholder="筛选..."></th>';
      html += '<th><input type="text" class="gd-citation-filter" data-col="4" placeholder="筛选..."></th>';
      html += "</tr></thead><tbody>";
      html += patentRowsHtml(citationList);
      html += "</tbody></table></div>";
    }
    if (nplList.length) {
      html += '<div class="pd-section-title" style="margin-top:14px;">NPL（非专利文献 ' + nplList.length + '）</div>';
      html += '<div class="gd-citation-table-wrap"><table class="gd-citation-table gd-citation-table-npl"><thead><tr>';
      html += "<th>Reference</th><th>Cited in</th><th>Cited by</th>";
      html += '</tr><tr class="gd-citation-filter-row">';
      html += '<th><input type="text" class="gd-citation-filter" data-col="0" placeholder="筛选..."></th>';
      html += '<th><input type="text" class="gd-citation-filter" data-col="1" placeholder="筛选..."></th>';
      html += '<th><input type="text" class="gd-citation-filter" data-col="2" placeholder="筛选..."></th>';
      html += "</tr></thead><tbody>";
      html += nplRowsHtml(nplList);
      html += "</tbody></table></div>";
    }
    html += '<div class="gd-citation-source">数据来源：USPTO Global Dossier · Citation Data</div>';
    body.innerHTML = html;

    bindColumnFilters(body);

    body.querySelectorAll(".pd-patent-link").forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        var number = link.dataset.patent;
        if (number && typeof window._openPdPatent === "function") {
          window._openPdPatent(number);
        }
      });
    });

    body.querySelectorAll(".gd-citation-open-link").forEach(function (button) {
      button.addEventListener("click", function () {
        var url = button.dataset.url;
        if (!url) return;
        if (typeof window.openInAppWebview === "function") {
          window.openInAppWebview(url, "引用文献");
        } else {
          window.open(url, "_blank");
        }
      });
    });
  }

  async function fetchCitationData(office, candidates) {
    var response = null;
    var lastError = null;
    var seen = {};
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      if (!candidate || !candidate.docNumber) continue;
      var candidateKey = candidate.type + "/" + candidate.docNumber + "/" + candidate.kindCode;
      if (seen[candidateKey]) continue;
      seen[candidateKey] = true;
      try {
        var path = "/citation-classification/svc/citation/" + candidate.type + "/"
          + encodeURIComponent(office) + "/"
          + encodeURIComponent(candidate.docNumber) + "/"
          + encodeURIComponent(candidate.kindCode || "A");
        response = await window.gdFetch(path);
        if (response && (Array.isArray(response.citationList) && response.citationList.length
          || Array.isArray(response.nplCitationList) && response.nplCitationList.length)) {
          return response;
        }
      } catch (candidateError) {
        lastError = candidateError;
      }
    }
    if (!response && lastError) throw lastError;
    return response;
  }

  async function loadCitationData(section, data) {
    var body = section.querySelector("#gd-citation-body");
    var button = section.querySelector("#gd-citation-load-btn");
    if (!body || !button) return;

    var context = parseContext(data);
    if (!context) {
      body.innerHTML = '<div class="gd-citation-empty">无法识别该专利号，无法查询 GD Citation Data。</div>';
      return;
    }

    button.disabled = true;
    button.textContent = "加载中...";
    body.innerHTML = '<div class="gd-citation-empty">正在从 Global Dossier 获取 Citation Data...</div>';

    try {
      var ref = await resolveGdReference(context);
      // GD 的 Citation Data 路由主要挂在 application 上；部分局/文献按
      // publication/patent 查询更准确，因此按顺序探测，命中有效数据即停止。
      var candidates = [
        { type: "application", docNumber: ref.docNumber, kindCode: ref.kindCode || "A" },
      ];
      if (context.queryType !== "application") {
        candidates.push({
          type: context.queryType,
          docNumber: context.applicationNumber,
          kindCode: context.kindCode || "A",
        });
      }
      candidates.push({ type: "publication", docNumber: context.applicationNumber, kindCode: context.kindCode || "A" });
      candidates.push({ type: "patent", docNumber: context.applicationNumber, kindCode: context.kindCode || "A" });

      var response = await fetchCitationData(ref.office, candidates);
      renderCitationData(body, response);
      button.textContent = "刷新";
    } catch (error) {
      body.innerHTML = '<div class="gd-citation-empty">GD Citation Data 获取失败：'
        + escapeHtml(error && error.message ? error.message : error) + "</div>";
      button.textContent = "重试";
    } finally {
      button.disabled = false;
    }
  }

  function injectSection(data) {
    var panel = document.querySelector('#patent-detail-content .pd-tab-panel[data-panel="references"]');
    if (!panel) return;
    var old = document.getElementById(SECTION_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var section = document.createElement("div");
    section.className = "pd-section";
    section.id = SECTION_ID;
    section.innerHTML =
      '<div class="pd-section-title pd-section-title-with-action">' +
        "<span>GD Citation Data（审查引用数据）</span>" +
        '<button type="button" id="gd-citation-load-btn" class="btn-small btn-secondary">加载</button>' +
      "</div>" +
      '<div id="gd-citation-body" class="gd-citation-body">' +
        '<div class="gd-citation-hint">' +
          "从 USPTO Global Dossier 获取专利文献与非专利文献引用数据，含 Relevant Section、Relevancy/Claims、Cited in、Cited by。" +
          "点击引用专利号可直接在 GP 原文模式查看专利详情。" +
        "</div>" +
      "</div>";
    panel.appendChild(section);

    var button = section.querySelector("#gd-citation-load-btn");
    if (button) {
      button.addEventListener("click", function () {
        loadCitationData(section, data);
      });
    }
  }

  function wrapRenderPatentDetail() {
    if (typeof window.renderPatentDetail !== "function" || window.renderPatentDetail.__gdCitationWrapped) return;
    var original = window.renderPatentDetail;
    var wrapped = function (data) {
      var result = original.apply(this, arguments);
      try { injectSection(data); } catch (_) {}
      return result;
    };
    wrapped.__gdCitationWrapped = true;
    window.renderPatentDetail = wrapped;
  }

  function init() {
    wrapRenderPatentDetail();
  }

  window.PatentLensGdCitationData = {
    parseContext: parseContext,
    citationNumber: citationNumber,
    splitSections: splitSections,
    cleanCitedIn: cleanCitedIn,
    renderCitationData: renderCitationData,
    fetchCitationData: fetchCitationData,
    // 供测试使用
    _parseNumberFallback: parseNumberFallback,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
