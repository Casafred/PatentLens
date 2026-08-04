/*!
 * PatentLens - 专利分享字段候选值与冲突合并
 *
 * 这是纯领域逻辑：不访问 DOM、既有 renderer 全局或 IndexedDB。所有新来源
 * （Excel、PDF、OCR、档案）都必须先在此处合并字段，再由 UI 呈现待确认冲突。
 */
(function () {
  "use strict";

  var SOURCE_PRIORITY = {
    manual: 600,
    excel: 500,
    google_patents: 400,
    dossier: 300,
    pdf_text: 200,
    ocr: 100,
  };

  function cleanText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function now() {
    return new Date().toISOString();
  }

  function comparableValue(value) {
    return cleanText(value).replace(/\s+/g, " ").toLocaleLowerCase();
  }

  function sourcePriority(source) {
    return Object.prototype.hasOwnProperty.call(SOURCE_PRIORITY, source) ? SOURCE_PRIORITY[source] : 0;
  }

  function createCandidate(value, metadata) {
    var text = cleanText(value);
    if (!text) return null;
    var source = cleanText(metadata && metadata.source) || "unknown";
    return {
      value: text,
      source: source,
      sourceRef: cleanText(metadata && metadata.sourceRef),
      capturedAt: cleanText(metadata && metadata.capturedAt) || now(),
      confidence: cleanText(metadata && metadata.confidence) || "medium",
      reviewState: source === "manual" ? "accepted" : (cleanText(metadata && metadata.reviewState) || "pending"),
    };
  }

  function candidateFromField(field) {
    if (!field || typeof field !== "object") return null;
    return createCandidate(field.value, field);
  }

  function candidateKey(candidate) {
    return [candidate.source, candidate.sourceRef, comparableValue(candidate.value)].join("\u0001");
  }

  function uniqueCandidates(candidates) {
    var byKey = {};
    candidates.forEach(function (candidate) {
      if (!candidate) return;
      var key = candidateKey(candidate);
      var known = byKey[key];
      // 对同一来源的同一内容保留最新抓取时间，避免重复导入制造伪冲突。
      if (!known || String(candidate.capturedAt) > String(known.capturedAt)) byKey[key] = candidate;
    });
    return Object.keys(byKey).map(function (key) { return byKey[key]; });
  }

  function collectCandidates(field) {
    if (!field || typeof field !== "object") return [];
    var candidates = [];
    var selected = candidateFromField(field);
    if (selected) candidates.push(selected);
    (Array.isArray(field.candidates) ? field.candidates : []).forEach(function (candidate) {
      var normalized = candidateFromField(candidate);
      if (normalized) candidates.push(normalized);
    });
    return uniqueCandidates(candidates);
  }

  function compareCandidates(left, right) {
    var priority = sourcePriority(right.source) - sourcePriority(left.source);
    if (priority) return priority;
    var accepted = (right.reviewState === "accepted" ? 1 : 0) - (left.reviewState === "accepted" ? 1 : 0);
    if (accepted) return accepted;
    return String(right.capturedAt).localeCompare(String(left.capturedAt));
  }

  function distinctValues(candidates) {
    var values = {};
    candidates.forEach(function (candidate) { values[comparableValue(candidate.value)] = true; });
    return Object.keys(values);
  }

  function makeField(selected, candidates, reviewState) {
    var field = clone(selected);
    field.reviewState = reviewState;
    field.candidates = candidates.map(function (candidate) { return clone(candidate); });
    return field;
  }

  function mergeField(existing, incoming) {
    var candidates = collectCandidates(existing);
    var incomingCandidate = candidateFromField(incoming);
    if (incomingCandidate) candidates.push(incomingCandidate);
    candidates = uniqueCandidates(candidates).sort(compareCandidates);
    if (!candidates.length) return { field: null, hasConflict: false, candidates: [] };

    var manualCandidate = candidates.find(function (candidate) {
      return candidate.source === "manual" && candidate.reviewState === "accepted";
    });
    var hasConflict = distinctValues(candidates).length > 1 && !manualCandidate;
    var selected = manualCandidate || candidates[0];
    return {
      field: makeField(selected, candidates, hasConflict ? "conflict" : "accepted"),
      hasConflict: hasConflict,
      candidates: candidates.map(function (candidate) { return clone(candidate); }),
    };
  }

  function selectCandidate(field, candidateIndex) {
    var candidates = collectCandidates(field);
    var index = Number(candidateIndex);
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) return null;
    var selected = candidates[index];
    return makeField(selected, candidates, "accepted");
  }

  function mergeFieldMap(existingFields, incomingFields) {
    var existing = existingFields && typeof existingFields === "object" ? existingFields : {};
    var incoming = incomingFields && typeof incomingFields === "object" ? incomingFields : {};
    var names = {};
    var fields = {};
    var conflicts = [];
    Object.keys(existing).forEach(function (name) { names[name] = true; });
    Object.keys(incoming).forEach(function (name) { names[name] = true; });
    Object.keys(names).forEach(function (name) {
      var result = mergeField(existing[name], incoming[name]);
      if (result.field) fields[name] = result.field;
      if (result.hasConflict) conflicts.push({ fieldName: name, candidates: result.candidates });
    });
    return { fields: fields, conflicts: conflicts };
  }

  window.PatentShareFieldMerge = {
    SOURCE_PRIORITY: clone(SOURCE_PRIORITY),
    createCandidate: createCandidate,
    collectCandidates: collectCandidates,
    mergeField: mergeField,
    mergeFieldMap: mergeFieldMap,
    selectCandidate: selectCandidate,
  };
})();
