/*!
 * PatentLens - 专利分享工作台项目状态
 *
 * 该文件仅管理分享项目的内存快照。大型 OCR/AI 结果的 IndexedDB 持久化将在
 * 后续切片接入；这里不触碰既有 PatentCache、kanbanState 或 GP 缓存。
 */
(function () {
  "use strict";

  var project = null;
  var listeners = [];

  function makeId(prefix) {
    var random = Math.random().toString(36).slice(2, 10);
    return String(prefix || "share") + "_" + Date.now().toString(36) + "_" + random;
  }

  function now() {
    return new Date().toISOString();
  }

  function createProject() {
    return {
      id: makeId("project"),
      name: "未命名分享项目",
      createdAt: now(),
      updatedAt: now(),
      patents: [],
      sources: [],
      moduleConfig: {},
    };
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
    return JSON.parse(JSON.stringify(ensureProject()));
  }

  function newProject() {
    project = createProject();
    notify();
    return getSnapshot();
  }

  function addPatent(record) {
    var active = ensureProject();
    if (!record || !record.id || !record.patentNumber) {
      return { ok: false, reason: "invalid-record" };
    }
    var duplicate = active.patents.some(function (item) {
      return item.patentNumber === record.patentNumber;
    });
    if (duplicate) return { ok: false, reason: "duplicate" };

    active.patents.push(record);
    active.sources.push({
      id: makeId("source"),
      patentId: record.id,
      type: record.source && record.source.type ? record.source.type : "unknown",
      label: record.source && record.source.label ? record.source.label : "未命名来源",
      capturedAt: record.source && record.source.capturedAt ? record.source.capturedAt : now(),
    });
    active.updatedAt = now();
    notify();
    return { ok: true, record: record };
  }

  function removePatent(patentId) {
    var active = ensureProject();
    var before = active.patents.length;
    active.patents = active.patents.filter(function (item) { return item.id !== patentId; });
    active.sources = active.sources.filter(function (item) { return item.patentId !== patentId; });
    if (active.patents.length === before) return false;
    active.updatedAt = now();
    notify();
    return true;
  }

  function onChange(listener) {
    if (typeof listener !== "function") return function () {};
    listeners.push(listener);
    return function () {
      listeners = listeners.filter(function (item) { return item !== listener; });
    };
  }

  window.PatentShareStore = {
    ensureProject: ensureProject,
    getSnapshot: getSnapshot,
    newProject: newProject,
    addPatent: addPatent,
    removePatent: removePatent,
    onChange: onChange,
  };
})();
