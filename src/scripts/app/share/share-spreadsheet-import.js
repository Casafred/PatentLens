/*!
 * PatentLens - 专利分享 CSV 导入
 *
 * 解析与字段映射保持为纯函数；文件选择由 share-entry.js 负责。XLSX/XLS
 * 接入时应复用 buildRecords() 的输出契约，而不是绕过字段候选值模型。
 */
(function () {
  "use strict";

  var MAX_CSV_BYTES = 10 * 1024 * 1024;
  var HEADER_ALIASES = {
    patentNumber: ["专利号", "公开号", "申请号", "publicationnumber", "publicationno", "patentnumber", "patentno", "applicationnumber", "applicationno"],
    title: ["标题", "专利名称", "发明名称", "title", "patenttitle", "inventiontitle"],
    abstract: ["摘要", "abstract", "summary"],
    applicationDate: ["申请日", "申请日期", "filingdate", "applicationdate"],
    publicationDate: ["公开日", "公开日期", "publicationdate", "publishdate"],
    priorityDate: ["优先权日", "优先权日期", "prioritydate"],
    assignees: ["申请人", "权利人", "专利权人", "assignee", "assignees", "applicant", "applicants"],
    inventors: ["发明人", "inventor", "inventors"],
  };

  function cleanText(value) { return typeof value === "string" ? value.trim() : ""; }
  function now() { return new Date().toISOString(); }

  function normalizeHeader(value) {
    return cleanText(value).toLocaleLowerCase().replace(/[\s_\-()（）【】\[\].:：/\\]/g, "");
  }

  function parseCsv(text) {
    var input = String(text || "").replace(/^\uFEFF/, "");
    var rows = [], row = [], cell = "", quoted = false;
    for (var index = 0; index < input.length; index++) {
      var character = input[index];
      if (quoted) {
        if (character === '"' && input[index + 1] === '"') { cell += '"'; index++; }
        else if (character === '"') quoted = false;
        else cell += character;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === ",") { row.push(cell); cell = ""; }
      else if (character === "\n" || character === "\r") {
        if (character === "\r" && input[index + 1] === "\n") index++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += character;
    }
    if (quoted) throw new Error("CSV 中存在未闭合的引号");
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function detectColumnMapping(headers) {
    var seen = {};
    return headers.map(function (header, index) {
      var normalized = normalizeHeader(header);
      var fieldName = Object.keys(HEADER_ALIASES).find(function (field) {
        return !seen[field] && HEADER_ALIASES[field].indexOf(normalized) >= 0;
      }) || null;
      if (fieldName) seen[fieldName] = true;
      return { index: index, header: header, fieldName: fieldName, confidence: fieldName ? "high" : "none" };
    });
  }

  function fieldValue(value, sourceRef, capturedAt) {
    var text = cleanText(value);
    if (!text) return null;
    var merge = window.PatentShareFieldMerge;
    if (merge && merge.createCandidate) {
      return merge.createCandidate(text, { source: "excel", sourceRef: sourceRef, capturedAt: capturedAt, confidence: "high", reviewState: "pending" });
    }
    return { value: text, source: "excel", sourceRef: sourceRef, capturedAt: capturedAt, confidence: "high", reviewState: "pending" };
  }

  function uniqueHeaders(row) {
    var used = {};
    return row.map(function (value, index) {
      var base = cleanText(value) || ("列" + (index + 1));
      var label = base, sequence = 2;
      while (used[label]) { label = base + " (" + sequence + ")"; sequence++; }
      used[label] = true;
      return label;
    });
  }

  function buildRecords(text, fileName) {
    var rows = parseCsv(text);
    if (!rows.length) return { ok: false, reason: "empty-file", message: "CSV 文件为空。" };
    var headers = uniqueHeaders(rows[0]);
    var mapping = detectColumnMapping(headers);
    var numberColumn = mapping.find(function (item) { return item.fieldName === "patentNumber"; });
    if (!numberColumn) return { ok: false, reason: "missing-patent-number", message: "未识别到专利号、公开号或申请号列。" };
    var capturedAt = now();
    var name = cleanText(fileName) || "未命名 CSV";
    var records = [], skippedRows = [];
    for (var rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      var row = rows[rowIndex];
      if (!row.some(function (value) { return cleanText(value); })) continue;
      var patentNumber = cleanText(row[numberColumn.index]);
      if (!patentNumber) { skippedRows.push({ rowNumber: rowIndex + 1, reason: "missing-patent-number" }); continue; }
      var fields = {}, customFields = {};
      mapping.forEach(function (column) {
        if (!column.fieldName || column.fieldName === "patentNumber") return;
        var candidate = fieldValue(row[column.index], "CSV " + name + " · 第 " + (rowIndex + 1) + " 行 · " + column.header, capturedAt);
        if (candidate) fields[column.fieldName] = candidate;
      });
      mapping.filter(function (column) { return !column.fieldName; }).forEach(function (column) {
        var candidate = fieldValue(row[column.index], "CSV " + name + " · 第 " + (rowIndex + 1) + " 行 · " + column.header, capturedAt);
        if (candidate) customFields["csv:" + normalizeHeader(column.header)] = { label: column.header, field: candidate };
      });
      records.push({
        id: "csv_" + patentNumber.replace(/[^a-z0-9]+/gi, "_") + "_" + (rowIndex + 1),
        patentNumber: patentNumber,
        title: fields.title ? fields.title.value : "",
        fields: fields,
        customFields: customFields,
        claims: [],
        source: { type: "excel", label: "CSV · " + name + " · 第 " + (rowIndex + 1) + " 行", capturedAt: capturedAt },
      });
    }
    return { ok: true, headers: headers, mapping: mapping, unmappedHeaders: mapping.filter(function (item) { return !item.fieldName; }).map(function (item) { return item.header; }), records: records, skippedRows: skippedRows };
  }

  function validateFile(file) {
    if (!file) return { ok: false, message: "未选择 CSV 文件。" };
    if (file.size > MAX_CSV_BYTES) return { ok: false, message: "CSV 文件超过 10 MB 限制。" };
    if (!/\.csv$/i.test(file.name || "")) return { ok: false, message: "当前仅支持 .csv 文件。" };
    return { ok: true };
  }

  window.PatentShareSpreadsheetImport = {
    MAX_CSV_BYTES: MAX_CSV_BYTES,
    parseCsv: parseCsv,
    detectColumnMapping: detectColumnMapping,
    buildRecords: buildRecords,
    validateFile: validateFile,
  };
})();
