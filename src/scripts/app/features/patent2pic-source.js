(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Patent2PicSource = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function snapshot(data, indexes) {
    if (!data || !Array.isArray(data.claims) || !data.claims.length) throw new Error('当前专利没有可用的权利要求原文');
    var publication = String(data.patent_number || data.publication_number || data.patentNumber || '').trim();
    if (!publication) throw new Error('缺少专利文献号，请重新查询后成图');
    var selected = Array.from(new Set(indexes));
    if (!selected.length) throw new Error('请至少选择一项权利要求');
    var claims = selected.map(function (index) {
      var claim = Number.isInteger(index) && data.claims[index];
      if (!claim || typeof claim.text !== 'string' || !claim.text.trim()) throw new Error('所选权利要求缺少原文，请重新获取');
      return {
        publicationNumber: publication,
        title: String(data.title || ''), language: String(data.language || data.lang || ''),
        source: String(data.data_source || data.source || 'PatentLens'),
        sourceUrl: String(data.url || data.source_url || ''),
        documentId: String(data.document_id || ''),
        sourceClaimNumber: String(claim.num || index + 1),
        originalText: claim.text,
        claimType: claim.type === 'independent' || claim.type === 'dependent' ? claim.type : 'unknown',
      };
    });
    return { schemaVersion: 1, requestId: 'p2p-' + Date.now() + '-' + Math.random().toString(36).slice(2), claims: claims };
  }
  return { snapshot: snapshot };
});
