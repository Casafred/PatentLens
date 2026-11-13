/* Derived index: projects remain the only source of truth. No second cache. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Patent2PicRecords = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  function parse(text, fallback) { try { return JSON.parse(text) || fallback; } catch (_) { return fallback; } }
  function publication(value) { return String(value || '').replace(/[\s-]/g, '').toUpperCase(); }
  function index(values) {
    var meta = parse(values['patent2pic-workspace'], {}), rows = [];
    (meta.projects || []).forEach(function (project) {
      var data = parse(values['patent2pic-project-' + project.id], {});
      (data.files || []).forEach(function (file) {
        var versions = (file.versions || []).filter(function (v) {
          return v.extractResult && (v.extractResult.nodes || []).length || v.serializedGraph && (v.serializedGraph.cells || []).length;
        });
        if (!versions.length) return;
        var version = versions.find(function (v) { return v.id === file.activeVersionId; }) || versions[versions.length - 1];
        var claimId = version.extractResult && version.extractResult.claimId || file.claimId || file.activeClaimId;
        var claim = (file.claims || []).find(function (c) { return c.id === claimId; }) || (file.claims || [])[0];
        var source = claim && claim.source || {};
        rows.push({ projectId: project.id, projectName: project.name, fileId: file.id, fileName: file.name,
          versionId: version.id, claimId: claim && claim.id, claimNumber: source.sourceClaimNumber || claim && String(claim.index) || '',
          publicationNumber: source.publicationNumber || '', title: source.title || file.name || '',
          originalText: source.originalText || claim && claim.rawText || '', language: source.language || '',
          versions: versions.length, updatedAt: Math.max.apply(null, versions.map(function (v) { return v.createdAt || 0; })) || data.savedAt || project.updatedAt || 0 });
      });
    });
    return rows.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }
  function forClaim(rows, data, claim) {
    return rows.filter(function (row) { return publication(row.publicationNumber) === publication(data.patent_number || data.publication_number)
      && String(row.claimNumber) === String(claim.num) && row.originalText === claim.text; });
  }
  function removeFile(values, target) {
    var clean = Object.assign({}, values), key = 'patent2pic-project-' + target.projectId;
    var data = parse(clean[key], {});
    data.files = (data.files || []).filter(function (file) { return file.id !== target.fileId; });
    if (data.activeFileId === target.fileId) data.activeFileId = data.files[0] && data.files[0].id || '';
    clean[key] = JSON.stringify(data);
    // Deleted graph content must not remain in the editor's recycle bin.
    var trash = parse(clean['patent2pic-trash'], {});
    if (Array.isArray(trash.items)) {
      trash.items = trash.items.filter(function (item) {
        var payload = item.payload || {};
        if (item.kind === 'project') {
          payload.files = (payload.files || []).filter(function (file) { return file.id !== target.fileId; });
          return payload.files.length > 0;
        }
        return !(payload.projectId === target.projectId && (payload.fileId === target.fileId || payload.file && payload.file.id === target.fileId));
      });
      clean['patent2pic-trash'] = JSON.stringify(trash);
    }
    return clean;
  }
  return { index: index, forClaim: forClaim, removeFile: removeFile };
});
