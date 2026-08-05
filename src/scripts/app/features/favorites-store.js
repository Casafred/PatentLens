/*!
 * PatentLens - 专利收藏夹状态存储
 *
 * 收藏夹与既有 PatentCache（历史/缓存）、PatentShareStore（分享项目）相互隔离。
 * 收藏条目仅保存轻量元数据（专利号、标题、备注、分组等），不承载 OCR / AI 等大字段，
 * 因此使用独立 localStorage key 持久化（与 PatentCache 的轻量历史同策略）。
 *
 * 模块自包含：仅依赖 window / localStorage / Date / Math / JSON，可在 Node vm 中测试。
 */
(function () {
  "use strict";

  var STORAGE_KEY = "patentlens-favorites";
  var DEFAULT_FOLDER = "默认收藏";
  var MAX_NOTE_LEN = 1000;
  var MAX_FOLDER_LEN = 40;
  var MAX_TITLE_LEN = 300;
  var MAX_PATENT_LEN = 60;
  var MAX_APPLICANT_LEN = 120;

  var favorites = [];
  var listeners = [];
  var persistence = { mode: "loading", error: "" };
  var initialized = false;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cleanText(value, max) {
    if (value === undefined || value === null) return "";
    return String(value).slice(0, max || 1000);
  }

  function makeId() {
    var random = Math.random().toString(36).slice(2, 10);
    return "fav_" + Date.now().toString(36) + "_" + random;
  }

  function now() {
    return Date.now();
  }

  function safeStorage() {
    try {
      if (typeof localStorage !== "undefined" && localStorage) return localStorage;
    } catch (e) { /* private mode / restricted */ }
    try {
      if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    } catch (e) { /* ignore */ }
    return null;
  }

  // Sanitize a raw favorite descriptor into a trusted shape.
  function normalize(input) {
    if (!input || typeof input !== "object") return null;
    var type = input.type === "patent" ? "patent" : "dossier";
    var patentNumber = cleanText(input.patentNumber, MAX_PATENT_LEN).trim();
    if (!patentNumber) return null;
    var folder = cleanText(input.folder, MAX_FOLDER_LEN).trim() || DEFAULT_FOLDER;
    var fav = {
      id: cleanText(input.id, 60).trim() || makeId(),
      patentNumber: patentNumber,
      type: type,
      office: cleanText(input.office, 20).trim(),
      title: cleanText(input.title, MAX_TITLE_LEN).trim(),
      applicantName: cleanText(input.applicantName, MAX_APPLICANT_LEN).trim(),
      source: type === "patent" ? (input.source === "jplatpat" ? "jplatpat" : "gp") : "",
      note: cleanText(input.note, MAX_NOTE_LEN),
      folder: folder,
      pinned: input.pinned === true,
      createdAt: Number(input.createdAt) || now(),
      updatedAt: Number(input.updatedAt) || now(),
    };
    return fav;
  }

  function persist() {
    var storage = safeStorage();
    if (!storage) {
      persistence = { mode: "memory", error: "localStorage 不可用，仅保留内存副本" };
      return;
    }
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(favorites));
      persistence = { mode: "localstorage", error: "" };
    } catch (e) {
      persistence = { mode: "memory", error: "写入 localStorage 失败：" + (e && e.message ? e.message : String(e)) };
    }
  }

  function load() {
    var storage = safeStorage();
    if (!storage) {
      persistence = { mode: "memory", error: "localStorage 不可用，仅保留内存副本" };
      favorites = [];
      return;
    }
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (!raw) { favorites = []; persistence = { mode: "localstorage", error: "" }; return; }
      var parsed = JSON.parse(raw);
      favorites = Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean) : [];
      persistence = { mode: "localstorage", error: "" };
    } catch (e) {
      favorites = [];
      persistence = { mode: "memory", error: "读取 localStorage 失败：" + (e && e.message ? e.message : String(e)) };
    }
  }

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](getSnapshot()); } catch (e) { /* listener errors are isolated */ }
    }
  }

  // Sorted: pinned first, then most-recently-added first.
  function sort(list) {
    return list.slice().sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function indexOf(patentNumber, type) {
    var pn = String(patentNumber || "").trim();
    var t = type === "patent" ? "patent" : "dossier";
    for (var i = 0; i < favorites.length; i++) {
      if (favorites[i].patentNumber === pn && favorites[i].type === t) return i;
    }
    return -1;
  }

  function init() {
    if (initialized) return;
    initialized = true;
    load();
  }

  function getSnapshot() {
    if (!initialized) init();
    return clone(sort(favorites));
  }

  function find(patentNumber, type) {
    if (!initialized) init();
    var idx = indexOf(patentNumber, type);
    return idx < 0 ? null : clone(favorites[idx]);
  }

  function isFavorited(patentNumber, type) {
    return indexOf(patentNumber, type) >= 0;
  }

  // Add a new favorite. Returns { ok, reason, favorite }.
  // A duplicate (same patentNumber + type) is rejected with reason "duplicate"
  // and the existing favorite is returned so callers can offer an update instead.
  function add(entry) {
    if (!initialized) init();
    var fav = normalize(entry);
    if (!fav) return { ok: false, reason: "invalid", favorite: null };
    var existingIdx = indexOf(fav.patentNumber, fav.type);
    if (existingIdx >= 0) {
      return { ok: false, reason: "duplicate", favorite: clone(favorites[existingIdx]) };
    }
    favorites.push(fav);
    persist();
    notify();
    return { ok: true, reason: "added", favorite: clone(fav) };
  }

  // Update mutable fields (note / folder / pinned / title) of an existing favorite by id.
  function update(id, patch) {
    if (!initialized) init();
    var idx = -1;
    for (var i = 0; i < favorites.length; i++) {
      if (favorites[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return { ok: false, favorite: null };
    var current = favorites[idx];
    var merged = Object.assign({}, current, patch || {});
    var renormalized = normalize(merged);
    if (!renormalized) return { ok: false, favorite: null };
    renormalized.id = current.id; // never change id via update
    renormalized.createdAt = current.createdAt; // preserve original creation time
    renormalized.updatedAt = now();
    favorites[idx] = renormalized;
    persist();
    notify();
    return { ok: true, favorite: clone(renormalized) };
  }

  function remove(id) {
    if (!initialized) init();
    var before = favorites.length;
    favorites = favorites.filter(function (f) { return f.id !== id; });
    if (favorites.length === before) return false;
    persist();
    notify();
    return true;
  }

  // Toggle favorite state for a patent. Adds if absent, removes if present.
  // meta supplies title/office/applicant/source/note/folder for the new entry.
  // Returns { favorited: bool, favorite: fav|null }.
  function toggle(patentNumber, type, meta) {
    if (!initialized) init();
    var idx = indexOf(patentNumber, type);
    if (idx >= 0) {
      var removed = clone(favorites[idx]);
      favorites.splice(idx, 1);
      persist();
      notify();
      return { favorited: false, favorite: removed };
    }
    var fav = normalize(Object.assign({ patentNumber: patentNumber, type: type }, meta || {}));
    if (!fav) return { favorited: false, favorite: null };
    favorites.push(fav);
    persist();
    notify();
    return { favorited: true, favorite: clone(fav) };
  }

  function getFolders() {
    if (!initialized) init();
    var seen = Object.create(null);
    var list = [];
    favorites.forEach(function (f) {
      if (!seen[f.folder]) { seen[f.folder] = true; list.push(f.folder); }
    });
    list.sort();
    return list;
  }

  function getPersistenceState() {
    if (!initialized) init();
    return { mode: persistence.mode, error: persistence.error };
  }

  function onChange(cb) {
    if (typeof cb !== "function") return function () {};
    listeners.push(cb);
    return function () {
      var i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  // Test/debug helper: clear all favorites. Not exposed in production UI by default.
  function clearAll() {
    favorites = [];
    persist();
    notify();
  }

  window.PatentFavorites = {
    init: init,
    getSnapshot: getSnapshot,
    find: find,
    isFavorited: isFavorited,
    add: add,
    update: update,
    remove: remove,
    toggle: toggle,
    getFolders: getFolders,
    getPersistenceState: getPersistenceState,
    onChange: onChange,
    clearAll: clearAll,
  };
})();
