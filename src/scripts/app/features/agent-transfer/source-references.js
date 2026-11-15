(function (root, factory) {
  var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; root.AgentSourceReferences = api;
})(globalThis, function () {
  'use strict';
  var locator;
  function norm(value) { return String(value || '').normalize('NFKC').replace(/\s+/g, ''); }
  function textSources(prefix, text, meta) {
    var result = [], offset = 0, value = String(text || '');
    // Keep every character, including long OCR blocks. IDs include deterministic offsets.
    while (offset < value.length) {
      var end = Math.min(offset + 12000, value.length);
      if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
      result.push(Object.assign({}, meta, { id: prefix + ':' + offset, text: value.slice(offset, end), start: offset, end: end })); offset = end;
    }
    return result;
  }
  function evidence(task, items) {
    if (!Array.isArray(items) || items.length > 1000) throw new Error('证据列表格式无效');
    var sources = new Map((task.input.sources || []).map(function (source) { return [source.id, source]; }));
    return items.map(function (item) {
      if (!item || typeof item.sourceId !== 'string' || typeof item.quote !== 'string') throw new Error('证据需要 sourceId 和原文 quote 字符串');
      var source = sources.get(item.sourceId);
      if (!source || !norm(item.quote) || !norm(source.text).includes(norm(item.quote))) throw new Error('证据不在原文中：' + String(item.sourceId || '缺少 sourceId'));
      return { sourceId: source.id, quote: String(item.quote), explanation: String(item.explanation || '') };
    });
  }
  function report(task, payload) {
    if (typeof payload.report !== 'string' || !payload.report.trim() || payload.report.length > 200000) throw new Error('需要完整 report 报告（最多 20 万字）');
    return { report: payload.report, evidence: evidence(task, payload.evidence || []) };
  }
  function mergeReports(task, payloads) {
    return { report: payloads.map(function (p, i) { return '### 材料分包 ' + (i + 1) + '\n' + report(task, p).report; }).join('\n\n'), evidence: payloads.flatMap(function (p) { return p.evidence || []; }) };
  }
  function view(source, quote) {
    var previous = document.activeElement;
    var overlay = document.createElement('div'); overlay.className = 'agent-source-overlay';
    function dismiss() { overlay.remove(); document.removeEventListener('keydown', keydown, true); if (previous && previous.isConnected) previous.focus(); }
    function keydown(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); dismiss(); }
      if (e.key === 'Tab') { var controls = Array.from(box.querySelectorAll('button')), first = controls[0], last = controls[controls.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    }
    overlay.style.cssText = 'position:fixed;inset:0;z-index:18000;background:#0007;display:grid;place-items:center;padding:24px';
    var box = document.createElement('section'); box.style.cssText = 'background:var(--bg-primary,white);color:var(--text-primary,#123);padding:24px;max-width:850px;width:90%;max-height:85vh;overflow:auto;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere';
    var close = document.createElement('button'); close.textContent = '关闭原文'; close.onclick = dismiss; box.appendChild(close);
    var locate = locator && locator(source);
    if (locate) { var live = document.createElement('button'); live.textContent = '在工作台定位'; live.onclick = function () { dismiss(); var panelClose = document.querySelector('.agent-task-close'); if (panelClose) panelClose.click(); locate(); }; box.appendChild(live); }
    var title = document.createElement('h3'); title.textContent = [source.documentName || source.patentNumber, source.paragraph ? '段落 ' + source.paragraph : '', source.claimNumber ? '权项 ' + source.claimNumber : '', source.page ? '页 ' + source.page : '', source.id].filter(Boolean).join(' · '); box.appendChild(title);
    var index = source.text.indexOf(quote || '');
    if (quote && index >= 0) { box.appendChild(document.createTextNode(source.text.slice(0, index))); var mark = document.createElement('mark'); mark.textContent = quote; box.appendChild(mark); box.appendChild(document.createTextNode(source.text.slice(index + quote.length))); }
    else box.appendChild(document.createTextNode(source.text));
    overlay.appendChild(box); overlay.addEventListener('click', function (e) { if (e.target === overlay) dismiss(); }); document.body.appendChild(overlay); document.addEventListener('keydown', keydown, true); close.focus();
  }
  return { textSources: textSources, evidence: evidence, report: report, mergeReports: mergeReports, view: view, setLocator: function (fn) { locator = fn; } };
});
