/*!
 * PatentLens - 专利分享工作台项目状态
 *
 * 分享项目与既有 PatentCache、kanbanState、GP 缓存隔离。项目内容只写入
 * 独立 IndexedDB；localStorage 不能承载 OCR / AI 等大字段，也不能作为回退副本。
 */
(function () {
  "use strict";

  var DB_NAME = "patentlens-share";
  var DB_VERSION = 2;
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

  function normalizeResearchSummary(value) {
    var source = value && typeof value === "object" ? value : {};
    return {
      problem: cleanText(source.problem).slice(0, 5000),
      approach: cleanText(source.approach).slice(0, 5000),
      effect: cleanText(source.effect).slice(0, 5000),
      openQuestions: cleanText(source.openQuestions).slice(0, 5000),
    };
  }

  function normalizeProjectBrief(value) {
    var source = value && typeof value === "object" ? value : {};
    return {
      audience: cleanText(source.audience).slice(0, 200) || "研发团队",
      purpose: cleanText(source.purpose).slice(0, 300) || "技术分享",
      focus: cleanText(source.focus).slice(0, 2000),
      confidentiality: cleanText(source.confidentiality).slice(0, 100) || "内部使用",
    };
  }

  function normalizeAIAnalysis(value) {
    if (!value || typeof value !== "object") return {};
    var normalized = {};
    Object.keys(value).forEach(function (key) {
      var item = value[key];
      if (!item || typeof item !== "object") return;
      normalized[key] = {
        content: cleanText(item.content).slice(0, 200000),
        reasoning: cleanText(item.reasoning).slice(0, 100000),
        parsed: item.parsed && typeof item.parsed === "object" ? clone(item.parsed) : null,
        model: cleanText(item.model),
        generatedAt: cleanText(item.generatedAt) || now(),
        reviewState: item.reviewState === "accepted" ? "accepted" : "pending",
        promptVersion: cleanText(item.promptVersion).slice(0, 100),
        evidence: Array.isArray(item.evidence) ? item.evidence.map(function (e) {
          return e && typeof e === "object" ? {
            source: cleanText(e.source).slice(0, 100),
            locator: cleanText(e.locator).slice(0, 300),
            quote: cleanText(e.quote).slice(0, 3000),
          } : null;
        }).filter(Boolean) : [],
      };
    });
    return normalized;
  }

  function normalizeCustomFields(value) {
    if (!value || typeof value !== "object") return {};
    var normalized = {};
    Object.keys(value).forEach(function (key) {
      var item = value[key];
      if (!item || typeof item !== "object" || !item.field) return;
      normalized[key] = {
        label: cleanText(item.label) || key,
        field: {
          value: cleanText(item.field.value),
          source: cleanText(item.field.source) || "unknown",
          sourceRef: cleanText(item.field.sourceRef),
          capturedAt: cleanText(item.field.capturedAt) || now(),
          confidence: cleanText(item.field.confidence) || "medium",
          reviewState: item.field.reviewState === "accepted" ? "accepted" : (item.field.reviewState === "conflict" ? "conflict" : "pending"),
          candidates: Array.isArray(item.field.candidates) ? item.field.candidates.map(function (c) {
            return c && typeof c === "object" ? {
              value: cleanText(c.value),
              source: cleanText(c.source) || "unknown",
              sourceRef: cleanText(c.sourceRef),
              capturedAt: cleanText(c.capturedAt) || now(),
              confidence: cleanText(c.confidence) || "medium",
            } : null;
          }).filter(Boolean) : [],
        },
      };
    });
    return normalized;
  }

  function normalizeProcessedFields(value) {
    if (!Array.isArray(value)) return [];
    return value.map(function (f) {
      if (!f || typeof f !== "object") return null;
      return {
        id: cleanText(f.id) || makeId("pf"),
        label: cleanText(f.label) || "未命名字段",
        value: cleanText(f.value).slice(0, 200000),
        type: f.type === "list" ? "list" : "text",
        source: cleanText(f.source) || "manual",
        prompt: cleanText(f.prompt),
        model: cleanText(f.model),
        generatedAt: cleanText(f.generatedAt),
        reviewState: f.reviewState === "accepted" ? "accepted" : "pending",
        evidence: Array.isArray(f.evidence) ? f.evidence.map(function (e) {
          return e && typeof e === "object" ? {
            source: cleanText(e.source).slice(0, 100),
            locator: cleanText(e.locator).slice(0, 300),
            quote: cleanText(e.quote).slice(0, 3000),
          } : null;
        }).filter(Boolean) : [],
      };
    }).filter(function (f) { return f && (f.value || f.prompt); });
  }

  function normalizeAnnotations(value) {
    if (!Array.isArray(value)) return [];
    return value.map(function (a) {
      if (!a || typeof a !== "object") return null;
      var type = cleanText(a.type);
      if (["underline", "highlight", "comment"].indexOf(type) < 0) return null;
      return {
        id: cleanText(a.id) || makeId("anno"),
        key: cleanText(a.key),
        type: type,
        start: Math.max(0, parseInt(a.start, 10) || 0),
        end: Math.max(0, parseInt(a.end, 10) || 0),
        text: cleanText(a.text).slice(0, 5000),
        comment: cleanText(a.comment).slice(0, 5000),
      };
    }).filter(Boolean);
  }

  function createProject() {
    var defaultModules = window.PatentShareModules && window.PatentShareModules.defaultConfig ? window.PatentShareModules.defaultConfig() : {};
    return {
      schemaVersion: 2,
      id: makeId("project"),
      name: "未命名分享项目",
      createdAt: now(),
      updatedAt: now(),
      patents: [],
      sources: [],
      brief: normalizeProjectBrief(),
      researchSummary: {},
      moduleConfig: defaultModules,
      aiAnalysis: {},
    };
  }

  function normalizeProject(raw) {
    if (!raw || typeof raw !== "object") return null;
    var normalized = {
      schemaVersion: raw.schemaVersion || 2,
      id: cleanText(raw.id) || makeId("project"),
      name: cleanText(raw.name) || "未命名分享项目",
      createdAt: cleanText(raw.createdAt) || now(),
      updatedAt: cleanText(raw.updatedAt) || now(),
      patents: [],
      sources: [],
      brief: normalizeProjectBrief(raw.brief),
      researchSummary: normalizeResearchSummary(raw.researchSummary),
      moduleConfig: raw.moduleConfig && typeof raw.moduleConfig === "object" ? clone(raw.moduleConfig) : {},
      aiAnalysis: raw.aiAnalysis && typeof raw.aiAnalysis === "object" ? clone(raw.aiAnalysis) : {},
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
      safeRecord.description = cleanText(safeRecord.description).slice(0, 500000);
      safeRecord.fields = safeRecord.fields && typeof safeRecord.fields === "object" ? safeRecord.fields : {};
      safeRecord.customFields = normalizeCustomFields(safeRecord.customFields);
      safeRecord.claims = Array.isArray(safeRecord.claims) ? safeRecord.claims.map(function (c) {
        return {
          number: cleanText(c.number),
          text: cleanText(c.text),
          type: cleanText(c.type),
          references: Array.isArray(c.references) ? c.references.map(String) : [],
        };
      }).filter(function (c) { return !!c.text; }) : [];
      safeRecord.classifications = Array.isArray(safeRecord.classifications) ? safeRecord.classifications.map(cleanText).filter(Boolean) : [];
      safeRecord.citations = Array.isArray(safeRecord.citations) ? safeRecord.citations.map(function (c) {
        return c && typeof c === "object" ? {
          number: cleanText(c.number),
          type: cleanText(c.type),
          title: cleanText(c.title),
          assignee: cleanText(c.assignee),
          date: cleanText(c.date),
        } : null;
      }).filter(Boolean) : [];
      safeRecord.family = Array.isArray(safeRecord.family) ? safeRecord.family.map(function (m) {
        return m && typeof m === "object" ? {
          number: cleanText(m.number),
          country: cleanText(m.country),
          title: cleanText(m.title),
          date: cleanText(m.date),
        } : null;
      }).filter(Boolean) : [];
      safeRecord.ocrSources = Array.isArray(safeRecord.ocrSources) ? safeRecord.ocrSources : [];
      safeRecord.figures = Array.isArray(safeRecord.figures) ? safeRecord.figures.map(function (f) {
        return f && typeof f === "object" ? {
          id: cleanText(f.id) || makeId("fig"),
          caption: cleanText(f.caption),
          dataUrl: typeof f.dataUrl === "string" ? f.dataUrl.slice(0, 3500000) : "",
          width: f.width || 0,
          height: f.height || 0,
          addedAt: cleanText(f.addedAt) || now(),
        } : null;
      }).filter(function (f) { return f && f.dataUrl; }) : [];
      safeRecord.source = safeRecord.source && typeof safeRecord.source === "object" ? safeRecord.source : {};
      safeRecord.aiAnalysis = normalizeAIAnalysis(safeRecord.aiAnalysis);
      safeRecord.processedFields = normalizeProcessedFields(safeRecord.processedFields);
      safeRecord.claimsTranslation = cleanText(safeRecord.claimsTranslation).slice(0, 200000);
      safeRecord.descriptionTranslation = cleanText(safeRecord.descriptionTranslation).slice(0, 500000);
      safeRecord.translationMeta = safeRecord.translationMeta && typeof safeRecord.translationMeta === "object" ? {
        model: cleanText(safeRecord.translationMeta.model),
        generatedAt: cleanText(safeRecord.translationMeta.generatedAt),
      } : {};
      safeRecord.claimsAnnotations = normalizeAnnotations(safeRecord.claimsAnnotations);
      safeRecord.descriptionAnnotations = normalizeAnnotations(safeRecord.descriptionAnnotations);
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

  function readAllProjects(db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(PROJECT_STORE, "readonly");
      var request = tx.objectStore(PROJECT_STORE).getAll();
      request.onsuccess = function () { resolve(Array.isArray(request.result) ? request.result : []); };
      request.onerror = function () { reject(request.error || new Error("IndexedDB project list read failed")); };
      tx.onerror = function () { reject(tx.error || new Error("IndexedDB project list transaction failed")); };
    });
  }

  function projectSummary(raw) {
    var normalized = normalizeProject(raw);
    if (!normalized) return null;
    return {
      id: normalized.id,
      name: normalized.name,
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt,
      patentCount: normalized.patents.length,
    };
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

  function listProjects() {
    var currentSummary = projectSummary(ensureProject());
    if (persistence.mode !== "indexeddb") return Promise.resolve(currentSummary ? [currentSummary] : []);
    return flush().then(function () {
      return openDatabase().then(function (db) {
        return readAllProjects(db).then(function (items) {
          return items.map(projectSummary).filter(Boolean).sort(function (left, right) {
            return String(right.updatedAt).localeCompare(String(left.updatedAt));
          });
        }).finally(function () { db.close(); });
      });
    }).catch(function () {
      return currentSummary ? [currentSummary] : [];
    });
  }

  function selectProject(projectId) {
    var id = cleanText(projectId);
    if (!id) return Promise.resolve({ ok: false, reason: "invalid-project" });
    if (ensureProject().id === id) return Promise.resolve({ ok: true, project: getSnapshot() });
    if (persistence.mode !== "indexeddb") return Promise.resolve({ ok: false, reason: "project-not-available" });
    return flush().then(function () {
      return openDatabase().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(PROJECT_STORE, "readonly");
          var request = tx.objectStore(PROJECT_STORE).get(id);
          request.onsuccess = function () { resolve(request.result || null); };
          request.onerror = function () { reject(request.error || new Error("IndexedDB project read failed")); };
          tx.onerror = function () { reject(tx.error || new Error("IndexedDB project transaction failed")); };
        }).then(function (saved) {
          var selected = normalizeProject(saved);
          if (!selected) return { ok: false, reason: "project-not-found" };
          return writeActiveProject(db, selected).then(function () {
            project = selected;
            notify();
            return { ok: true, project: getSnapshot() };
          });
        }).finally(function () { db.close(); });
      });
    }).catch(function (error) {
      persistence = { mode: "error", error: error && error.message ? error.message : "IndexedDB project switch failed" };
      notify();
      return { ok: false, reason: "storage-error" };
    });
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

  function deleteProject(projectId) {
    var id = cleanText(projectId);
    if (!id) return Promise.resolve({ ok: false, reason: "invalid-project" });
    if (persistence.mode !== "indexeddb") {
      // 内存模式下仅能删除当前项目：清空并新建
      if (ensureProject().id === id) {
        project = createProject();
        queuePersist();
        notify();
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ ok: false, reason: "project-not-available" });
    }
    return flush().then(function () {
      return openDatabase().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction([PROJECT_STORE, META_STORE], "readwrite");
          tx.objectStore(PROJECT_STORE).delete(id);
          // 若删除的是当前激活项目，清空激活指针（后续 ensureProject 会新建空项目）
          if (ensureProject().id === id) {
            tx.objectStore(META_STORE).delete(ACTIVE_PROJECT_KEY);
          }
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { reject(tx.error || new Error("IndexedDB delete failed")); };
          tx.onabort = function () { reject(tx.error || new Error("IndexedDB delete aborted")); };
        }).then(function () {
          if (ensureProject().id === id) {
            project = createProject();
          }
          queuePersist();
          notify();
          return { ok: true };
        }).finally(function () { db.close(); });
      });
    }).catch(function (error) {
      persistence = { mode: "error", error: error && error.message ? error.message : "IndexedDB delete failed" };
      notify();
      return { ok: false, reason: "storage-error" };
    });
  }

  function setModuleConfig(config) {
    var active = ensureProject();
    active.moduleConfig = config && typeof config === "object" ? clone(config) : {};
    active.updatedAt = now();
    queuePersist();
    notify();
    return getSnapshot().moduleConfig;
  }

  function setResearchSummary(summary) {
    var active = ensureProject();
    active.researchSummary = normalizeResearchSummary(summary);
    active.updatedAt = now();
    queuePersist();
    notify();
    return clone(active.researchSummary);
  }

  function setProjectBrief(brief) {
    var active = ensureProject();
    active.brief = normalizeProjectBrief(brief);
    active.updatedAt = now();
    queuePersist();
    notify();
    return clone(active.brief);
  }

  function setModuleMode(moduleId, mode) {
    var modules = window.PatentShareModules;
    if (!modules || !modules.setModuleMode) return false;
    var next = modules.setModuleMode(ensureProject().moduleConfig, moduleId, mode);
    if (!next) return false;
    setModuleConfig(next);
    return true;
  }

  function setModuleOrder(zone, order) {
    var active = ensureProject();
    if (!active.moduleConfig || typeof active.moduleConfig !== "object") active.moduleConfig = {};
    if (!active.moduleConfig.moduleOrder || typeof active.moduleConfig.moduleOrder !== "object") active.moduleConfig.moduleOrder = {};
    active.moduleConfig.moduleOrder[zone] = Array.isArray(order) ? order.slice() : [];
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function addAnnotation(patentId, annotation) {
    var active = ensureProject();
    var patent = active.patents.find(function (p) { return p.id === patentId; });
    if (!patent || !annotation || !annotation.field || !annotation.type) return false;
    if (annotation.field === "claims") {
      if (!Array.isArray(patent.claimsAnnotations)) patent.claimsAnnotations = [];
      patent.claimsAnnotations.push({
        id: makeId("anno"),
        key: annotation.key || "",
        type: annotation.type,
        start: annotation.start || 0,
        end: annotation.end || 0,
        text: annotation.text || "",
        comment: annotation.comment || "",
      });
    } else if (annotation.field === "description") {
      if (!Array.isArray(patent.descriptionAnnotations)) patent.descriptionAnnotations = [];
      patent.descriptionAnnotations.push({
        id: makeId("anno"),
        key: "",
        type: annotation.type,
        start: annotation.start || 0,
        end: annotation.end || 0,
        text: annotation.text || "",
        comment: annotation.comment || "",
      });
    }
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function removeAnnotation(patentId, field, annotationId) {
    var active = ensureProject();
    var patent = active.patents.find(function (p) { return p.id === patentId; });
    if (!patent || !cleanText(annotationId)) return false;
    var property = field === "claims" ? "claimsAnnotations" : (field === "description" ? "descriptionAnnotations" : "");
    if (!property || !Array.isArray(patent[property])) return false;
    var before = patent[property].length;
    patent[property] = patent[property].filter(function (annotation) { return annotation.id !== annotationId; });
    if (patent[property].length === before) return false;
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function clearAnnotations(patentId, field, key) {
    var active = ensureProject();
    var patent = active.patents.find(function (p) { return p.id === patentId; });
    if (!patent) return false;
    if (field === "claims") {
      patent.claimsAnnotations = (patent.claimsAnnotations || []).filter(function(a) { return a.key !== (key || ""); });
    } else if (field === "description") {
      patent.descriptionAnnotations = [];
    }
    active.updatedAt = now();
    queuePersist();
    notify();
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
    if (!safeRecord.aiAnalysis) safeRecord.aiAnalysis = {};
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
        safeRecord.title = cleanText(safeRecord.title) || (safeRecord.fields && safeRecord.fields.title ? safeRecord.fields.title.value : "");
        safeRecord.description = cleanText(safeRecord.description);
        safeRecord.fields = safeRecord.fields && typeof safeRecord.fields === "object" ? safeRecord.fields : {};
        safeRecord.customFields = safeRecord.customFields && typeof safeRecord.customFields === "object" ? safeRecord.customFields : {};
        safeRecord.claims = Array.isArray(safeRecord.claims) ? safeRecord.claims : [];
        safeRecord.classifications = Array.isArray(safeRecord.classifications) ? safeRecord.classifications : [];
        safeRecord.citations = Array.isArray(safeRecord.citations) ? safeRecord.citations : [];
        safeRecord.family = Array.isArray(safeRecord.family) ? safeRecord.family : [];
        safeRecord.ocrSources = Array.isArray(safeRecord.ocrSources) ? safeRecord.ocrSources : [];
        safeRecord.figures = Array.isArray(safeRecord.figures) ? safeRecord.figures : [];
        if (!safeRecord.aiAnalysis) safeRecord.aiAnalysis = {};
        if (!safeRecord.source) safeRecord.source = {};
        active.patents.push(safeRecord);
        addSource(active, safeRecord);
        summary.added++;
        summary.results.push({ patentId: safeRecord.id, patentNumber: number, action: "added", conflicts: [] });
        return;
      }
      var fieldResult = merge && merge.mergeFieldMap ? merge.mergeFieldMap(existing.fields, record.fields) : { fields: existing.fields || {}, conflicts: [] };
      existing.fields = fieldResult.fields;
      existing.customFields = mergeCustomFields(existing.customFields, record.customFields, merge);
      if (record.description && !existing.description) existing.description = cleanText(record.description);
      if (Array.isArray(record.claims) && record.claims.length && (!existing.claims || !existing.claims.length)) {
        existing.claims = record.claims.map(function (c) { return clone(c); });
      }
      if (Array.isArray(record.classifications) && record.classifications.length && (!existing.classifications || !existing.classifications.length)) {
        existing.classifications = record.classifications.slice();
      }
      if (existing.fields.title && existing.fields.title.value) existing.title = existing.fields.title.value;
      addSource(active, existing);
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

  function updateCustomField(patentId, key, value) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    var fieldKey = cleanText(key);
    var text = cleanText(value);
    if (!patent || !fieldKey || !text) return false;
    if (!patent.customFields || typeof patent.customFields !== "object") patent.customFields = {};
    var existing = patent.customFields[fieldKey];
    var manualValue = {
      value: text,
      source: "manual",
      sourceRef: "分享工作台人工确认",
      capturedAt: now(),
      confidence: "high",
      reviewState: "accepted",
    };
    var merge = window.PatentShareFieldMerge;
    var mergedField = merge && merge.mergeField ? merge.mergeField(existing && existing.field, manualValue).field : manualValue;
    patent.customFields[fieldKey] = {
      label: existing && existing.label ? existing.label : fieldKey,
      field: mergedField,
    };
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function addCustomField(patentId, label, value) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    var text = cleanText(label);
    if (!patent || !text) return false;
    if (!patent.customFields || typeof patent.customFields !== "object") patent.customFields = {};
    var key = "custom_" + text.replace(/\s+/g, "_").slice(0, 30) + "_" + Date.now().toString(36);
    patent.customFields[key] = {
      label: text,
      field: {
        value: cleanText(value),
        source: "manual",
        sourceRef: "分享工作台自定义字段",
        capturedAt: now(),
        confidence: "high",
        reviewState: "accepted",
      },
    };
    active.updatedAt = now();
    queuePersist();
    notify();
    return { ok: true, key: key };
  }

  function removeCustomField(patentId, key) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    var fieldKey = cleanText(key);
    if (!patent || !fieldKey || !patent.customFields) return false;
    if (!patent.customFields[fieldKey]) return false;
    delete patent.customFields[fieldKey];
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function updatePatentDescription(patentId, description) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    if (!patent) return false;
    patent.description = cleanText(description).slice(0, 500000);
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function updateClaims(patentId, claims) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    if (!patent) return false;
    patent.claims = Array.isArray(claims) ? claims.map(function (c) {
      return {
        number: cleanText(c.number),
        text: cleanText(c.text),
        type: cleanText(c.type),
        references: Array.isArray(c.references) ? c.references.map(String) : [],
      };
    }).filter(function (c) { return !!c.text; }) : [];
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function updateClassifications(patentId, classifications) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    if (!patent) return false;
    patent.classifications = Array.isArray(classifications) ? classifications.map(cleanText).filter(Boolean) :
      cleanText(classifications).split(/[;；,，\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
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

  function addFigure(patentId, dataUrl, caption, dimensions) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    if (!patent || typeof dataUrl !== "string" || dataUrl.length < 10) return { ok: false, reason: "invalid-image" };
    if (dataUrl.length > 3500000) return { ok: false, reason: "too-large" };
    if (!Array.isArray(patent.figures)) patent.figures = [];
    var figure = {
      id: makeId("fig"),
      caption: cleanText(caption),
      dataUrl: dataUrl.slice(0, 3500000),
      width: (dimensions && dimensions.width) || 0,
      height: (dimensions && dimensions.height) || 0,
      addedAt: now(),
    };
    patent.figures.push(figure);
    active.updatedAt = now();
    queuePersist();
    notify();
    return { ok: true, figure: clone(figure) };
  }

  function removeFigure(patentId, figureId) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    if (!patent || !Array.isArray(patent.figures)) return false;
    var before = patent.figures.length;
    patent.figures = patent.figures.filter(function (f) { return f.id !== figureId; });
    if (patent.figures.length === before) return false;
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function addProcessedField(patentId, label, prompt, type) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    var cleanLabel = cleanText(label);
    if (!patent || !cleanLabel) return { ok: false, reason: "invalid-label" };
    if (!Array.isArray(patent.processedFields)) patent.processedFields = [];
    var field = {
      id: makeId("pf"),
      label: cleanLabel,
      value: "",
      type: type === "list" ? "list" : "text",
      source: "manual",
      prompt: cleanText(prompt),
      model: "",
      generatedAt: "",
      reviewState: "pending",
    };
    patent.processedFields.push(field);
    active.updatedAt = now();
    queuePersist();
    notify();
    return { ok: true, field: clone(field) };
  }

  function updateProcessedField(patentId, fieldId, updates) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    if (!patent || !Array.isArray(patent.processedFields) || !updates || typeof updates !== "object") return false;
    var field = patent.processedFields.find(function (f) { return f.id === fieldId; });
    if (!field) return false;
    if (typeof updates.value === "string") field.value = updates.value.slice(0, 200000);
    if (typeof updates.label === "string") field.label = cleanText(updates.label) || field.label;
    if (typeof updates.prompt === "string") field.prompt = cleanText(updates.prompt);
    if (typeof updates.model === "string") field.model = cleanText(updates.model);
    if (typeof updates.generatedAt === "string") field.generatedAt = cleanText(updates.generatedAt);
    if (updates.source === "ai" || updates.source === "manual") field.source = updates.source;
    if (updates.reviewState === "accepted") field.reviewState = "accepted";
    else if (updates.reviewState) field.reviewState = "pending";
    if (Array.isArray(updates.evidence)) field.evidence = updates.evidence.slice(0, 20);
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function removeProcessedField(patentId, fieldId) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    if (!patent || !Array.isArray(patent.processedFields)) return false;
    var before = patent.processedFields.length;
    patent.processedFields = patent.processedFields.filter(function (f) { return f.id !== fieldId; });
    if (patent.processedFields.length === before) return false;
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function setAIAnalysis(patentId, analysisType, analysisData) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    if (!patent || !cleanText(analysisType) || !analysisData) return false;
    if (!patent.aiAnalysis || typeof patent.aiAnalysis !== "object") patent.aiAnalysis = {};
    patent.aiAnalysis[analysisType] = {
      content: cleanText(analysisData.content).slice(0, 200000),
      reasoning: cleanText(analysisData.reasoning).slice(0, 100000),
      parsed: analysisData.parsed && typeof analysisData.parsed === "object" ? clone(analysisData.parsed) : null,
      model: cleanText(analysisData.model),
      generatedAt: cleanText(analysisData.generatedAt) || now(),
      reviewState: analysisData.reviewState === "accepted" ? "accepted" : "pending",
      promptVersion: cleanText(analysisData.promptVersion).slice(0, 100),
      evidence: Array.isArray(analysisData.evidence) ? clone(analysisData.evidence).slice(0, 20) : [],
    };
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function updateAIAnalysis(patentId, analysisType, updates) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    var analysis = patent && patent.aiAnalysis && patent.aiAnalysis[analysisType];
    if (!analysis || !updates || typeof updates !== "object") return false;
    if (typeof updates.content === "string") analysis.content = cleanText(updates.content).slice(0, 200000);
    if (updates.reviewState === "accepted") analysis.reviewState = "accepted";
    else if (updates.reviewState) analysis.reviewState = "pending";
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  // 保存权利要求/说明书的中文翻译，供分享HTML双栏对照使用
  function setPatentTranslation(patentId, kind, translation, meta) {
    var active = ensureProject();
    var patent = active.patents.find(function (item) { return item.id === patentId; });
    if (!patent) return false;
    var text = cleanText(translation);
    if (kind === "claims") patent.claimsTranslation = text.slice(0, 200000);
    else if (kind === "description") patent.descriptionTranslation = text.slice(0, 500000);
    else return false;
    patent.translationMeta = {
      model: cleanText(meta && meta.model),
      generatedAt: cleanText(meta && meta.generatedAt) || now(),
    };
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function setProjectAIAnalysis(analysisType, analysisData) {
    var active = ensureProject();
    if (!cleanText(analysisType) || !analysisData) return false;
    if (!active.aiAnalysis || typeof active.aiAnalysis !== "object") active.aiAnalysis = {};
    active.aiAnalysis[analysisType] = {
      content: cleanText(analysisData.content).slice(0, 200000),
      reasoning: cleanText(analysisData.reasoning).slice(0, 100000),
      model: cleanText(analysisData.model),
      patentIds: Array.isArray(analysisData.patentIds) ? analysisData.patentIds.slice() : [],
      generatedAt: cleanText(analysisData.generatedAt) || now(),
      reviewState: analysisData.reviewState === "accepted" ? "accepted" : "pending",
      promptVersion: cleanText(analysisData.promptVersion).slice(0, 100),
      evidence: Array.isArray(analysisData.evidence) ? clone(analysisData.evidence).slice(0, 20) : [],
    };
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
  }

  function updateProjectAIAnalysis(analysisType, updates) {
    var active = ensureProject();
    var analysis = active.aiAnalysis && active.aiAnalysis[analysisType];
    if (!analysis || !updates || typeof updates !== "object") return false;
    if (typeof updates.content === "string") analysis.content = cleanText(updates.content).slice(0, 200000);
    if (updates.reviewState === "accepted") analysis.reviewState = "accepted";
    else if (updates.reviewState) analysis.reviewState = "pending";
    active.updatedAt = now();
    queuePersist();
    notify();
    return true;
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
    listProjects: listProjects,
    selectProject: selectProject,
    deleteProject: deleteProject,
    renameProject: renameProject,
    setResearchSummary: setResearchSummary,
    setProjectBrief: setProjectBrief,
    setModuleConfig: setModuleConfig,
    setModuleMode: setModuleMode,
    addPatent: addPatent,
    importPatents: importPatents,
    updatePatentField: updatePatentField,
    updateCustomField: updateCustomField,
    addCustomField: addCustomField,
    removeCustomField: removeCustomField,
    updatePatentDescription: updatePatentDescription,
    updateClaims: updateClaims,
    updateClassifications: updateClassifications,
    selectPatentFieldCandidate: selectPatentFieldCandidate,
    addOcrSource: addOcrSource,
    addFigure: addFigure,
    removeFigure: removeFigure,
    addProcessedField: addProcessedField,
    updateProcessedField: updateProcessedField,
    removeProcessedField: removeProcessedField,
    setAIAnalysis: setAIAnalysis,
    updateAIAnalysis: updateAIAnalysis,
    setPatentTranslation: setPatentTranslation,
    setProjectAIAnalysis: setProjectAIAnalysis,
    updateProjectAIAnalysis: updateProjectAIAnalysis,
    removePatent: removePatent,
    setModuleOrder: setModuleOrder,
    addAnnotation: addAnnotation,
    removeAnnotation: removeAnnotation,
    clearAnnotations: clearAnnotations,
    flush: flush,
    onChange: onChange,
  };
})();
