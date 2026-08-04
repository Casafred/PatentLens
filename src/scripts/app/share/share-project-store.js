/*!
 * PatentLens - 专利分享工作台项目状态
 *
 * 分享项目与既有 PatentCache、kanbanState、GP 缓存隔离。项目内容只写入
 * 独立 IndexedDB；localStorage 不能承载 OCR / AI 等大字段，也不能作为回退副本。
 */
(function () {
  "use strict";

  var DB_NAME = "patentlens-share";
  var DB_VERSION = 1;
  var PROJECT_STORE = "projects";
  var META_STORE = "meta";
  var ACTIVE_PROJECT_KEY = "activeProjectId";
  var project = null;
  var listeners = [];
  var readyPromise = null;
  var initialized = false;
  var writeQueue = Promise.resolve();
  var persistence = { mode: "loading", error: "" };

  function makeId(prefix) {
    var random = Math.random().toString(36).slice(2, 10);
    return String(prefix || "share") + "_" + Date.now().toString(36) + "_" + random;
  }

  function now() {
    return new Date().toISOString();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cleanText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function createProject() {
    var defaultModules = window.PatentShareModules && window.PatentShareModules.defaultConfig ? window.PatentShareModules.defaultConfig() : {};
    return {
      schemaVersion: 1,
      id: makeId("project"),
      name: "未命名分享项目",
      createdAt: now(),
      updatedAt: now(),
      patents: [],
      sources: [],
      moduleConfig: defaultModules,
    };
  }

  function normalizeProject(raw) {
    if (!raw || typeof raw !== "object") return null;
    var normalized = {
      schemaVersion: 1,
      id: cleanText(raw.id) || makeId("project"),
      name: cleanText(raw.name) || "未命名分享项目",
      createdAt: cleanText(raw.createdAt) || now(),
      updatedAt: cleanText(raw.updatedAt) || now(),
      patents: [],
      sources: [],
      moduleConfig: raw.moduleConfig && typeof raw.moduleConfig === "object" ? clone(raw.moduleConfig) : {},
    };
    var knownNumbers = {};
    (Array.isArray(raw.patents) ? raw.patents : []).forEach(function (record) {
      if (!record || typeof record !== "object") return;
      var patentNumber = cleanText(record.patentNumber);
      if (!patentNumber) return;
      var dedupeKey = patentNumber.toUpperCase();
      if (knownNumbers[dedupeKey]) return;
      knownNumbers[dedupeKey] = true;
      var safeRecord = clone(record);
      safeRecord.id = cleanText(safeRecord.id) || makeId("patent");
      safeRecord.patentNumber = patentNumber;
      safeRecord.title = cleanText(safeRecord.title);
      safeRecord.fields = safeRecord.fields && typeof safeRecord.fields === "object" ? safeRecord.fields : {};
      safeRecord.claims = Array.isArray(safeRecord.claims) ? safeRecord.claims : [];
      safeRecord.ocrSources = Array.isArray(safeRecord.ocrSources) ? safeRecord.ocrSources : [];
      safeRecord.source = safeRecord.source && typeof safeRecord.source === "object" ? safeRecord.source : {};
      normalized.patents.push(safeRecord);
    });
    (Array.isArray(raw.sources) ? raw.sources : []).forEach(function (source) {
      if (!source || typeof source !== "object" || !cleanText(source.patentId)) return;
      normalized.sources.push(clone(source));
    });
    return normalized;
  }

  function ensureProject() {
    if (!project) project = createProject();
    return project;
  }

  function notify() {
    var snapshot = getSnapshot();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](snapshot); } catch (_) {}
    }
  }

  function getSnapshot() {
    return clone(ensureProject());
  }

  function getPersistenceState() {
    return { mode: persistence.mode, error: persistence.error };
  }

  function openDatabase() {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
    return new Promise(function (resolve, reject) {
      var request;
      try { request = indexedDB.open(DB_NAME, DB_VERSION); } catch (error) { reject(error); return; }
      request.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains(PROJECT_STORE)) db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "key" });
      };
      request.onsuccess = function (event) { resolve(event.target.result); };
      request.onerror = function () { reject(request.error || new Error("IndexedDB open failed")); };
      request.onblocked = function () { reject(new Error("IndexedDB upgrade blocked")); };
    });
  }

  function readActiveProject(db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction([META_STORE, PROJECT_STORE], "readonly");
      var metaRequest = tx.objectStore(META_STORE).get(ACTIVE_PROJECT_KEY);
      metaRequest.onsuccess = function () {
        var activeId = metaRequest.result && metaRequest.result.value;
        if (!activeId) { resolve(null); return; }
        var projectRequest = tx.objectStore(PROJECT_STORE).get(activeId);
        projectRequest.onsuccess = function () { resolve(projectRequest.result || null); };
        projectRequest.onerror = function () { reject(projectRequest.error || new Error("IndexedDB project read failed")); };
      };
      metaRequest.onerror = function () { reject(metaRequest.error || new Error("IndexedDB metadata read failed")); };
      tx.onerror = function () { reject(tx.error || new Error("IndexedDB transaction failed")); };
    });
  }

  function writeActiveProject(db, snapshot) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction([PROJECT_STORE, META_STORE], "readwrite");
      tx.objectStore(PROJECT_STORE).put(snapshot);
      tx.objectStore(META_STORE).put({ key: ACTIVE_PROJECT_KEY, value: snapshot.id, updatedAt: now() });
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error || new Error("IndexedDB save failed")); };
      tx.onabort = function () { reject(tx.error || new Error("IndexedDB save aborted")); };
    });
  }

  function queuePersist() {
    if (!initialized || persistence.mode !== "indexeddb") return Promise.resolve(false);
    var snapshot = getSnapshot();
    writeQueue = writeQueue.then(function () {
      return openDatabase().then(function (db) {
        return writeActiveProject(db, snapshot).finally(function () { db.close(); });
      });
    }).catch(function (error) {
      persistence = { mode: "error", error: error && error.message ? error.message : "IndexedDB save failed" };
      notify();
      return false;
    });
    return writeQueue;
  }

  function initialize() {
    if (readyPromise) return readyPromise;
    readyPromise = openDatabase().then(function (db) {
      return readActiveProject(db).then(function (saved) {
        db.close();
        var restored = normalizeProject(saved);
        project = restored || ensureProject();
        persistence = { mode: "indexeddb", error: "" };
        initialized = true;
        if (!restored) return queuePersist();
        return true;
      });
    }).catch(function (error) {
      // 无隐式 localStorage 回退：存储不可用时仍可完成当次工作，但明确标记为临时内存草稿。
      persistence = { mode: "memory", error: error && error.message ? error.message : "IndexedDB unavailable" };
      initialized = true;
      return false;
    }).then(function (result) {
      notify();
      return result;
    });
    return readyPromise;
  }

  function newProject() {
    project = createProject();
    queuePersist();
    notify();
    return getSnapshot();
  }

  function renameProject(name) {
    var cleaned = cleanText(name);
    if (!cleaned) return false;
    var active = ensureProject();
    active.name = cleaned.slice(0, 120);
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function setModuleConfig(config) {
    var active = ensureProject();
    active.moduleConfig = config && typeof config === "object" ? clone(config) : {};
    active.updatedAt = now();
    queuePersist();
    notify();
    return getSnapshot().moduleConfig;
  }

  function setModuleMode(moduleId, mode) {
    var modules = window.PatentShareModules;
    if (!modules || !modules.setModuleMode) return false;
    var next = modules.setModuleMode(ensureProject().moduleConfig, moduleId, mode);
    if (!next) return false;
    setModuleConfig(next);
    return true;
  }

  function addPatent(record) {
    var active = ensureProject();
    if (!record || !record.id || !cleanText(record.patentNumber)) return { ok: false, reason: "invalid-record" };
    var patentNumber = cleanText(record.patentNumber);
    var duplicate = active.patents.some(function (item) {
      return cleanText(item.patentNumber).toUpperCase() === patentNumber.toUpperCase();
    });
    if (duplicate) return { ok: false, reason: "duplicate" };

    var safeRecord = clone(record);
    safeRecord.patentNumber = patentNumber;
    active.patents.push(safeRecord);
    active.sources.push({
      id: makeId("source"),
      patentId: safeRecord.id,
      type: safeRecord.source && safeRecord.source.type ? safeRecord.source.type : "unknown",
      label: safeRecord.source && safeRecord.source.label ? safeRecord.source.label : "未命名来源",
      capturedAt: safeRecord.source && safeRecord.source.capturedAt ? safeRecord.source.capturedAt : now(),
    });
    active.updatedAt = now();
    queuePersist();
    notify();
    return { ok: true, record: clone(safeRecord) };
  }

  function addSource(active, record) {
    active.sources.push({
      id: makeId("source"),
      patentId: record.id,
      type: record.source && record.source.type ? record.source.type : "unknown",
      label: record.source && record.source.label ? record.source.label : "未命名来源",
      capturedAt: record.source && record.source.capturedAt ? record.source.capturedAt : now(),
    });
  }

  function mergeCustomFields(existing, incoming, merge) {
    var result = existing && typeof existing === "object" ? clone(existing) : {};
    Object.keys(incoming && typeof incoming === "object" ? incoming : {}).forEach(function (key) {
      var incomingItem = incoming[key];
      if (!incomingItem || !incomingItem.field) return;
      var existingItem = result[key];
      var fieldResult = merge && merge.mergeField ? merge.mergeField(existingItem && existingItem.field, incomingItem.field) : { field: clone(incomingItem.field), hasConflict: false };
      result[key] = { label: cleanText(incomingItem.label) || (existingItem && existingItem.label) || key, field: fieldResult.field };
    });
    return result;
  }

  function importPatents(records) {
    var active = ensureProject();
    var summary = { added: 0, merged: 0, skipped: 0, conflicts: 0, results: [] };
    var merge = window.PatentShareFieldMerge;
    (Array.isArray(records) ? records : []).forEach(function (record) {
      if (!record || !cleanText(record.patentNumber)) { summary.skipped++; return; }
      var number = cleanText(record.patentNumber);
      var existing = active.patents.find(function (item) { return cleanText(item.patentNumber).toUpperCase() === number.toUpperCase(); });
      if (!existing) {
        var safeRecord = clone(record);
        safeRecord.id = cleanText(safeRecord.id) || makeId("patent");
        safeRecord.patentNumber = number;
        safeRecord.fields = safeRecord.fields && typeof safeRecord.fields === "object" ? safeRecord.fields : {};
        safeRecord.customFields = safeRecord.customFields && typeof safeRecord.customFields === "object" ? safeRecord.customFields : {};
        active.patents.push(safeRecord);
        addSource(active, safeRecord);
        summary.added++;
        summary.results.push({ patentId: safeRecord.id, patentNumber: number, action: "added", conflicts: [] });
        return;
      }
      var fieldResult = merge && merge.mergeFieldMap ? merge.mergeFieldMap(existing.fields, record.fields) : { fields: existing.fields || {}, conflicts: [] };
      existing.fields = fieldResult.fields;
      existing.customFields = mergeCustomFields(existing.customFields, record.customFields, merge);
      if (existing.fields.title && existing.fields.title.value) existing.title = existing.fields.title.value;
      addSource(active, record);
      summary.merged++;
      summary.conflicts += fieldResult.conflicts.length;
      summary.results.push({ patentId: existing.id, patentNumber: number, action: "merged", conflicts: fieldResult.conflicts });
    });
    if (summary.added || summary.merged) {
      active.updatedAt = now();
      queuePersist();
      notify();
    }
    return summary;
  }

  function updatePatentField(patentId, fieldName, value) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    var field = cleanText(fieldName);
    var text = cleanText(value);
    if (!patent || !field || !text) return false;
    if (!patent.fields || typeof patent.fields !== "object") patent.fields = {};
    var manualValue = {
      value: text,
      source: "manual",
      sourceRef: "分享工作台人工确认",
      capturedAt: now(),
      confidence: "high",
      reviewState: "accepted",
    };
    var merge = window.PatentShareFieldMerge;
    patent.fields[field] = merge && merge.mergeField ? merge.mergeField(patent.fields[field], manualValue).field : manualValue;
    if (field === "title") patent.title = text;
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function selectPatentFieldCandidate(patentId, fieldName, candidateIndex) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    var merge = window.PatentShareFieldMerge;
    var field = cleanText(fieldName);
    if (!patent || !field || !merge || !merge.selectCandidate) return false;
    var current = patent.fields && patent.fields[field];
    var selected = merge.selectCandidate(current, candidateIndex);
    if (!selected) return false;
    if (!patent.fields || typeof patent.fields !== "object") patent.fields = {};
    patent.fields[field] = selected;
    if (field === "title") patent.title = selected.value;
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function addOcrSource(patentId, payload, fileName) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    if (!patent || !payload || (!cleanText(payload.text) && !cleanText(payload.markdown))) return { ok: false, reason: "empty-ocr" };
    if (!Array.isArray(patent.ocrSources)) patent.ocrSources = [];
    var source = {
      id: makeId("ocr"),
      fileName: cleanText(fileName) || "未命名 PDF",
      engine: cleanText(payload.engine) || "ocr",
      capturedAt: now(),
      text: cleanText(payload.text).slice(0, 500000),
      markdown: cleanText(payload.markdown).slice(0, 500000),
      blocks: Array.isArray(payload.blocks) ? clone(payload.blocks).slice(0, 10000) : [],
      pageDimensions: payload.pageDimensions && typeof payload.pageDimensions === "object" ? clone(payload.pageDimensions) : {},
    };
    patent.ocrSources.push(source);
    active.sources.push({ id: makeId("source"), patentId: patent.id, type: "ocr", label: "PDF OCR · " + source.fileName, capturedAt: source.capturedAt });
    active.updatedAt = now();
    queuePersist();
    notify();
    return { ok: true, source: clone(source) };
  }

  function removePatent(patentId) {
    var active = ensureProject();
    var before = active.patents.length;
    active.patents = active.patents.filter(function (item) { return item.id !== patentId; });
    active.sources = active.sources.filter(function (item) { return item.patentId !== patentId; });
    if (active.patents.length === before) return false;
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function flush() {
    return writeQueue;
  }

  function onChange(listener) {
    if (typeof listener !== "function") return function () {};
    listeners.push(listener);
    return function () { listeners = listeners.filter(function (item) { return item !== listener; }); };
  }

  window.PatentShareStore = {
    ensureProject: ensureProject,
    getSnapshot: getSnapshot,
    getPersistenceState: getPersistenceState,
    initialize: initialize,
    newProject: newProject,
    renameProject: renameProject,
    setModuleConfig: setModuleConfig,
    setModuleMode: setModuleMode,
    addPatent: addPatent,
    importPatents: importPatents,
    updatePatentField: updatePatentField,
    selectPatentFieldCandidate: selectPatentFieldCandidate,
    addOcrSource: addOcrSource,
    removePatent: removePatent,
    flush: flush,
    onChange: onChange,
  };
})();
