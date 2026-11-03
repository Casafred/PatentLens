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

  function relevantInfoHtml(list) {
    if (!Array.isArray(list) || !list.length) return "";
    return list.map(function (info) {
      var category = String((info && info.category) || "").trim();
      var claims = String((info && info.claims) || "").trim();
      var parts = [];
      if (category) parts.push("Relevancy code: " + escapeHtml(category));
      if (claims) parts.push("Claims: " + escapeHtml(claims));
      return '<div class="gd-citation-relevance">' + parts.join(" · ") + "</div>";
    }).join("");
  }

  function sectionHtml(list) {
    if (!list.length) return "";
    return list.map(function (part) {
      return "<div>" + escapeHtml(part).replace(/\n/g, "<br>") + "</div>";
    }).join("");
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
      rows += "<td>" + (citedIn ? escapeHtml(citedIn).replace(/\n/g, "<br>") : "-") + "</td>";
      rows += "<td>" + (citedBy ? escapeHtml(citedBy).replace(/\n/g, "<br>") : "-") + "</td>";
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
      rows += "<td>" + (citedIn ? escapeHtml(citedIn).replace(/\n/g, "<br>") : "-") + "</td>";
      rows += "<td>" + (citedBy ? escapeHtml(citedBy).replace(/\n/g, "<br>") : "-") + "</td>";
      rows += "</tr>";
    });
    return rows;
  }

  function renderCitationData(body, response) {
    var citationList = response && Array.isArray(response.citationList) ? response.citationList : [];
    var nplList = response && Array.isArray(response.nplCitationList) ? response.nplCitationList : [];

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
      html += '<div class="gd-citation-table-wrap"><table class="gd-citation-table"><thead><tr>';
      html += "<th>Publication/patent number</th><th>Relevant Section</th><th>Relevancy/Claims</th><th>Cited in</th><th>Cited by</th>";
      html += "</tr></thead><tbody>";
      html += patentRowsHtml(citationList);
      html += "</tbody></table></div>";
    }
    if (nplList.length) {
      html += '<div class="pd-section-title" style="margin-top:14px;">NPL（非专利文献 ' + nplList.length + '）</div>';
      html += '<div class="gd-citation-table-wrap"><table class="gd-citation-table"><thead><tr>';
      html += "<th>Reference</th><th>Cited in</th><th>Cited by</th>";
      html += "</tr></thead><tbody>";
      html += nplRowsHtml(nplList);
      html += "</tbody></table></div>";
    }
    html += '<div class="gd-citation-source">数据来源：USPTO Global Dossier · Citation Data</div>';
    body.innerHTML = html;

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

      var response = null;
      var lastError = null;
      var seen = {};
      for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i];
        var candidateKey = candidate.type + "/" + candidate.docNumber + "/" + candidate.kindCode;
        if (seen[candidateKey] || !candidate.docNumber) continue;
        seen[candidateKey] = true;
        try {
          var path = "/citation-classification/svc/citation/" + candidate.type + "/"
            + encodeURIComponent(ref.office) + "/"
            + encodeURIComponent(candidate.docNumber) + "/"
            + encodeURIComponent(candidate.kindCode || "A");
          response = await window.gdFetch(path);
          if (response && (Array.isArray(response.citationList) && response.citationList.length
            || Array.isArray(response.nplCitationList) && response.nplCitationList.length)) {
            break;
          }
        } catch (candidateError) {
          lastError = candidateError;
        }
      }
      if (!response && lastError) throw lastError;
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
    // 供测试使用
    _parseNumberFallback: parseNumberFallback,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
