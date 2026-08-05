/*!
 * PatentLens - 专利分享工作台来源适配器
 *
 * 旧 renderer 的当前专利状态只在本文件读取；返回值是分享领域的独立快照，
 * 后续模块不得依赖 `_currentPatentData` 的对象结构。
 */
(function () {
  "use strict";

  function cleanText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function toStringList(value) {
    if (Array.isArray(value)) {
      return value.map(function (item) { return cleanText(item); }).filter(Boolean);
    }
    var text = cleanText(value);
    return text ? [text] : [];
  }

  function parseClaimReferences(claimText, allClaims) {
    var refs = [];
    if (!claimText) return refs;
    var refPatterns = [
      /(?:according to|as in|as set forth in|of)\s+(?:claim|claims)\s+(\d+(?:\s*(?:to|or|,|and|-|–|—)\s*\d+)*)/gi,
      /(?:权项|权利要求|权)\s*(\d+(?:\s*(?:至|或|、|和|-|–|—)\s*\d+)*)\s*(?:所述|的|其)/g,
      /\(?(?:claim|权项|权利要求)\s*(\d+)\)?/gi
    ];
    refPatterns.forEach(function (pattern) {
      var match;
      while ((match = pattern.exec(claimText)) !== null) {
        var refStr = match[1];
        var rangeMatch = refStr.match(/(\d+)\s*(?:to|-|–|—|至)\s*(\d+)/i);
        if (rangeMatch) {
          var start = parseInt(rangeMatch[1], 10);
          var end = parseInt(rangeMatch[2], 10);
          for (var i = Math.min(start, end); i <= Math.max(start, end); i++) {
            if (refs.indexOf(String(i)) < 0) refs.push(String(i));
          }
        } else {
          var parts = refStr.split(/\s*(?:,|and|或|、|和)\s*/);
          parts.forEach(function (p) {
            var num = cleanText(p);
            if (num && /^\d+$/.test(num) && refs.indexOf(num) < 0) refs.push(num);
          });
        }
      }
    });
    return refs.map(String).filter(function (n) {
      return allClaims.some(function (c) { return String(c.number) === n; });
    });
  }

  function detectClaimType(claim, index, allClaims) {
    if (claim.type && cleanText(claim.type)) return cleanText(claim.type).toLowerCase();
    var text = cleanText(claim.text).toLowerCase();
    var refs = parseClaimReferences(claim.text, allClaims);
    if (refs.length > 0) return "dependent";
    if (index === 0) return "independent";
    var independentStartPatterns = [
      /^(?:a|an|the)\s+(?:system|method|apparatus|device|composition|article|process|use)/i,
      /^(?:一种|一个|一项|用于)/
    ];
    for (var i = 0; i < independentStartPatterns.length; i++) {
      if (independentStartPatterns[i].test(cleanText(claim.text))) return "independent";
    }
    return refs.length > 0 ? "dependent" : "independent";
  }

  function sourceValue(value, source, confidence, sourceRef) {
    var text = cleanText(value);
    if (!text) return null;
    return {
      value: text,
      source: source,
      sourceRef: sourceRef || "当前 PatentLens 专利原文快照",
      capturedAt: new Date().toISOString(),
      confidence: confidence || "high",
      reviewState: "accepted",
    };
  }

  function extractClassifications(data) {
    var results = [];
    var classFields = ["ipc", "ipcr", "cpc", "classification", "international_classifications", "cpc_classifications"];
    classFields.forEach(function (field) {
      var value = data[field];
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach(function (v) {
          var text = cleanText(typeof v === "object" ? (v.code || v.symbol || v.classification || JSON.stringify(v)) : v);
          if (text && results.indexOf(text) < 0) results.push(text);
        });
      } else if (typeof value === "object") {
        Object.values(value).forEach(function (v) {
          var text = cleanText(v);
          if (text && results.indexOf(text) < 0) results.push(text);
        });
      } else {
        var text = cleanText(value);
        if (text) {
          text.split(/[;,；，]/).forEach(function (part) {
            var cleaned = cleanText(part);
            if (cleaned && results.indexOf(cleaned) < 0) results.push(cleaned);
          });
        }
      }
    });
    return results;
  }

  function extractDescription(data) {
    var descFields = ["description", "specification", "detaileddescription", "detailed_description", "disclosure"];
    for (var i = 0; i < descFields.length; i++) {
      var val = data[descFields[i]];
      if (typeof val === "string" && cleanText(val).length > 50) return cleanText(val);
      if (Array.isArray(val)) {
        var text = val.map(function (v) { return typeof v === "string" ? v : (v.text || v.content || ""); }).filter(Boolean).join("\n\n");
        if (cleanText(text).length > 50) return cleanText(text);
      }
    }
    return "";
  }

  function extractCitations(data) {
    var citations = [];
    var citeFields = ["citations", "cited_by", "references", "cited_patents", "backward_citations", "forward_citations"];
    citeFields.forEach(function (field) {
      var value = data[field];
      if (!value) return;
      var arr = Array.isArray(value) ? value : (value.patents || value.items || []);
      if (Array.isArray(arr)) {
        arr.forEach(function (c) {
          if (!c) return;
          var num = cleanText(c.patent_number || c.publication_number || c.number || c.patentNumber || (typeof c === "string" ? c : ""));
          if (!num) return;
          citations.push({
            number: num,
            type: cleanText(c.type || c.category || (field === "cited_by" || field === "forward_citations" ? "forward" : "backward")),
            title: cleanText(c.title || ""),
            assignee: cleanText(c.assignee || c.applicant || ""),
            date: cleanText(c.date || c.publication_date || c.filing_date || ""),
          });
        });
      }
    });
    return citations;
  }

  function extractFamily(data) {
    var family = [];
    var famFields = ["family", "family_members", "patent_family", "similars", "similar_patents"];
    famFields.forEach(function (field) {
      var value = data[field];
      if (!value) return;
      var arr = Array.isArray(value) ? value : (value.members || value.items || []);
      if (Array.isArray(arr)) {
        arr.forEach(function (m) {
          if (!m) return;
          var num = cleanText(m.patent_number || m.publication_number || m.number || m.patentNumber || (typeof m === "string" ? m : ""));
          if (!num) return;
          family.push({
            number: num,
            country: cleanText(m.country || m.country_code || (num.match(/^([A-Z]{2})/) || [])[1] || ""),
            title: cleanText(m.title || ""),
            date: cleanText(m.date || m.publication_date || m.filing_date || ""),
          });
        });
      }
    });
    return family;
  }

  // 把主应用 GP 原始数据（window._currentPatentData 或 fetchPatentWithRetry 返回的 data）
  // 转换为分享领域的独立快照。currentPatentSnapshot 与工作台内"按专利号搜索加入"复用本函数。
  function snapshotFromGpData(data) {
    if (!data || typeof data !== "object") return null;

    var patentNumber = cleanText(data.patent_number || data.publication_number || data.application_number);
    if (!patentNumber) return null;

    // 不直接暴露 "Google Patents" 字样，使用中性来源名
    var rawSource = cleanText(data.data_source);
    var sourceName = rawSource ? rawSource.replace(/google\s*patents?/gi, "专利原文") : "专利原文";
    var capturedAt = new Date().toISOString();

    // 清理标题中可能残留的 "Google Patents" 字样
    var rawTitle = cleanText(data.title);
    var title = rawTitle.replace(/[-—]\s*Google\s*Patents?\s*$/i, "").replace(/Google\s*Patents?\s*[-—:]\s*/i, "").trim();

    var rawClaims = Array.isArray(data.claims) ? data.claims.map(function (claim, index) {
      if (typeof claim === "string") {
        return { number: String(index + 1), text: cleanText(claim), type: "", references: [] };
      }
      return {
        number: cleanText(claim && (claim.num || claim.number)) || String(index + 1),
        text: cleanText(claim && (claim.text || claim.content)),
        type: cleanText(claim && claim.type),
        references: Array.isArray(claim && claim.dependencies) ? claim.dependencies.map(String) : [],
      };
    }).filter(function (claim) { return !!claim.text; }) : [];

    var claims = rawClaims.map(function (claim, index) {
      var detectedType = detectClaimType(claim, index, rawClaims);
      var refs = claim.references.length ? claim.references : parseClaimReferences(claim.text, rawClaims);
      return {
        number: claim.number,
        text: claim.text,
        type: (claim.type || detectedType).toLowerCase(),
        references: refs,
      };
    });

    var classifications = extractClassifications(data);
    var description = extractDescription(data);
    var citations = extractCitations(data);
    var family = extractFamily(data);

    // 捕获附图 URL（后续异步抓取转为 DataURL）
    var drawingUrls = Array.isArray(data.drawings) ? data.drawings.map(function (u) {
      if (typeof u === "string") return cleanText(u);
      if (u && typeof u === "object") return cleanText(u.url || u.src || u.image || "");
      return "";
    }).filter(Boolean) : [];

    var result = {
      id: "patent_" + patentNumber + "_" + Date.now().toString(36),
      patentNumber: patentNumber,
      title: title,
      description: description,
      classifications: classifications,
      citations: citations,
      family: family,
      fields: {
        title: sourceValue(title, "google_patents"),
        abstract: sourceValue(data.abstract, "google_patents"),
        applicationDate: sourceValue(data.application_date || data.filing_date, "google_patents"),
        publicationDate: sourceValue(data.publication_date, "google_patents"),
        priorityDate: sourceValue(data.priority_date, "google_patents"),
        assignees: sourceValue(toStringList(data.assignees).join("; "), "google_patents"),
        inventors: sourceValue(toStringList(data.inventors).join("; "), "google_patents"),
        classifications: sourceValue(classifications.join("; "), "google_patents"),
      },
      claims: claims,
      aiAnalysis: {},
      source: {
        type: "google_patents",
        label: sourceName + " · " + patentNumber,
        capturedAt: capturedAt,
        url: cleanText(data.url),
      },
    };

    if (drawingUrls.length) {
      result._pendingDrawings = drawingUrls;
    }

    if (!description) delete result.description;
    if (!classifications.length) delete result.classifications;
    if (!citations.length) delete result.citations;
    if (!family.length) delete result.family;

    return result;
  }

  function currentPatentSnapshot() {
    return snapshotFromGpData(window._currentPatentData);
  }

  // 异步抓取附图 URL 列表并转为 DataURL，返回 figures 数组
  // 优先使用 Electron 主进程 IPC（绕过 CORS），降级到 fetch
  function fetchDrawingsAsDataUrls(urls, maxCount, onProgress) {
    var list = Array.isArray(urls) ? urls.slice(0, maxCount || 20) : [];
    var figures = [];
    var done = 0;
    var hasElectron = typeof window !== "undefined" && window.electronAPI && window.electronAPI.fetchImageAsDataUrl;
    function next() {
      if (done >= list.length) return Promise.resolve(figures);
      var idx = done;
      var url = list[idx];
      done++;
      var fetchPromise;
      if (hasElectron) {
        fetchPromise = window.electronAPI.fetchImageAsDataUrl(url).then(function (result) {
          if (!result || !result.ok || !result.dataUrl) throw new Error(result && result.error || "IPC fetch failed");
          return result.dataUrl;
        });
      } else {
        fetchPromise = fetch(url, { mode: "cors" })
          .then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.blob();
          })
          .then(function (blob) {
            return new Promise(function (resolve, reject) {
              var reader = new FileReader();
              reader.onload = function () { resolve(reader.result); };
              reader.onerror = function () { reject(new Error("FileReader failed")); };
              reader.readAsDataURL(blob);
            });
          });
      }
      return fetchPromise
        .then(function (dataUrl) {
          figures.push({
            id: "fig_" + Date.now().toString(36) + "_" + idx,
            dataUrl: dataUrl,
            caption: "附图 " + (idx + 1),
            width: 0,
            height: 0,
          });
          if (onProgress) onProgress(figures.length, list.length);
        })
        .catch(function () {
          // 单张抓取失败不影响其余
        })
        .then(next);
    }
    return next();
  }

  // 异步将 _pendingDrawings 转为 figures 并写入 store
  function hydrateSnapshotDrawings(record, store) {
    if (!record || !record._pendingDrawings || !store) return Promise.resolve();
    var urls = record._pendingDrawings;
    return fetchDrawingsAsDataUrls(urls, 20).then(function (figures) {
      if (figures.length && store.addFigure) {
        figures.forEach(function (fig) {
          store.addFigure(record.id, fig.dataUrl, fig.caption, { width: fig.width, height: fig.height });
        });
      }
      // 清除临时标记
      delete record._pendingDrawings;
    });
  }

  window.PatentShareSources = {
    currentPatentSnapshot: currentPatentSnapshot,
    snapshotFromGpData: snapshotFromGpData,
    fetchDrawingsAsDataUrls: fetchDrawingsAsDataUrls,
    hydrateSnapshotDrawings: hydrateSnapshotDrawings,
  };
})();
