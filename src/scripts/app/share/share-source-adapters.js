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

  function sourceValue(value, source, confidence) {
    var text = cleanText(value);
    if (!text) return null;
    return {
      value: text,
      source: source,
      sourceRef: "当前 PatentLens 专利原文快照",
      capturedAt: new Date().toISOString(),
      confidence: confidence || "high",
      reviewState: "accepted",
    };
  }

  function currentPatentSnapshot() {
    var data = window._currentPatentData;
    if (!data || typeof data !== "object") return null;

    var patentNumber = cleanText(data.patent_number || data.publication_number || data.application_number);
    if (!patentNumber) return null;

    var sourceName = cleanText(data.data_source) || "Google Patents";
    var claims = Array.isArray(data.claims) ? data.claims.map(function (claim, index) {
      if (typeof claim === "string") {
        return { number: String(index + 1), text: cleanText(claim), type: "" };
      }
      return {
        number: cleanText(claim && (claim.num || claim.number)) || String(index + 1),
        text: cleanText(claim && (claim.text || claim.content)),
        type: cleanText(claim && claim.type),
      };
    }).filter(function (claim) { return !!claim.text; }) : [];

    var capturedAt = new Date().toISOString();
    return {
      id: "patent_" + patentNumber + "_" + Date.now().toString(36),
      patentNumber: patentNumber,
      title: cleanText(data.title),
      fields: {
        title: sourceValue(data.title, "google_patents"),
        abstract: sourceValue(data.abstract, "google_patents"),
        applicationDate: sourceValue(data.application_date || data.filing_date, "google_patents"),
        publicationDate: sourceValue(data.publication_date, "google_patents"),
        priorityDate: sourceValue(data.priority_date, "google_patents"),
        assignees: sourceValue(toStringList(data.assignees).join("; "), "google_patents"),
        inventors: sourceValue(toStringList(data.inventors).join("; "), "google_patents"),
      },
      claims: claims,
      source: {
        type: "google_patents",
        label: sourceName + " · " + patentNumber,
        capturedAt: capturedAt,
        url: cleanText(data.url),
      },
    };
  }

  window.PatentShareSources = {
    currentPatentSnapshot: currentPatentSnapshot,
  };
})();
