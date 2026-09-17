/*! 
 * PatentLens - 审查文档 OCR 修改版权利要求清洗与变动定位
 *
 * 仅在“专利文件”且标题为 Claims / 权利要求的审查文档中提供入口。
 * 该模块不改动冻结的 web-app.js，而是从既有阅读器状态读取 OCR 结果。
 */
(function () {
  'use strict';

  var BUTTON_ID = 'amended-claims-ocr-button';
  var MODAL_ID = 'amended-claims-ocr-modal';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function normalizeWhitespace(value) {
    return String(value || '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  }

  function cleanMarkup(value) {
    return normalizeWhitespace(value)
      .replace(/\$\s*\\underline\s*\{\s*\\text\s*\{([\s\S]*?)\}\s*\}\s*\$/g, '$1')
      .replace(/\\underline\s*\{\s*\\text\s*\{([\s\S]*?)\}\s*\}/g, '$1')
      .replace(/\\text\s*\{([\s\S]*?)\}/g, '$1')
      .replace(/\$/g, '')
      .replace(/\\(?:underline|text)\b/g, '')
      .replace(/\(\s*(?:Currently\s+Amended|Previously\s+Presented|Original|Cancelled|Withdrawn|Not\s+Entered)\s*\)/gi, '')
      .replace(/[ \t]+([,.;:])/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function claimType(text) {
    var source = String(text || '');
    return /\b(?:of|according to)\s+(?:any\s+)?claims?\s+\d+|\bclaims?\s+\d+\b|根据权利要求\s*\d+|如权利要求\s*\d+|所述权利要求\s*\d+/i.test(source) ? 'dependent' : 'independent';
  }

  function dependencies(text) {
    var source = String(text || '');
    var found = [];
    var matcher = /(?:claims?|权利要求)\s*(\d+(?:\s*(?:,|and|or|或|和|至|到|[-–—])\s*\d+)*)/gi;
    var match;
    while ((match = matcher.exec(source))) {
      (match[1].match(/\d+/g) || []).forEach(function (num) {
        if (found.indexOf(num) < 0) found.push(num);
      });
    }
    return found;
  }

  function firstClaimStart(prefix) {
    var lines = String(prefix || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (/^\s*(?:an?|the|one or more|一种|一项|根据)\b/i.test(lines[i])) return i;
    }
    return -1;
  }

  function splitLikelyUnnumberedClaim(text) {
    var parts = String(text || '').split(/(?<=\.)\s*\n\s*(?=(?:an?|the|one or more)\s+[a-z])/i);
    return parts.map(function (part) { return normalizeWhitespace(part).replace(/\n/g, ' '); }).filter(Boolean);
  }

  function parseClaims(value) {
    var cleaned = cleanMarkup(value);
    var markers = [];
    var marker = /(?:^|\n)\s*(\d{1,4})\s*[.)]\s*/g;
    var match;
    while ((match = marker.exec(cleaned))) markers.push({ num: Number(match[1]), start: match.index, contentStart: marker.lastIndex });

    var rawClaims = [];
    var diagnostics = [];
    if (markers.length) {
      var prefix = cleaned.slice(0, markers[0].start);
      var prefixLine = firstClaimStart(prefix);
      if (prefixLine >= 0) {
        var prefixText = prefix.split('\n').slice(prefixLine).join('\n');
        rawClaims.push({ num: 1, text: prefixText, inferred: true });
        if (markers[0].num > 1) diagnostics.push('已将修订说明后的未编号文本识别为权利要求 1；原 OCR 未提供该项编号。');
      }
      for (var i = 0; i < markers.length; i++) {
        rawClaims.push({ num: markers[i].num, text: cleaned.slice(markers[i].contentStart, i + 1 < markers.length ? markers[i + 1].start : cleaned.length), inferred: false });
      }
    } else {
      var start = firstClaimStart(cleaned);
      if (start >= 0) rawClaims.push({ num: 1, text: cleaned.split('\n').slice(start).join('\n'), inferred: true });
    }

    var claims = [];
    rawClaims.forEach(function (entry, index) {
      var pieces = splitLikelyUnnumberedClaim(entry.text);
      pieces.forEach(function (piece, pieceIndex) {
        var number = entry.num;
        if (pieceIndex > 0) {
          var next = rawClaims[index + 1];
          if (next && next.num > entry.num + pieceIndex) {
            number = entry.num + pieceIndex;
            diagnostics.push('已根据相邻编号将未编号段落恢复为权利要求 ' + number + '，请在比对前核对。');
          } else {
            diagnostics.push('发现无法可靠编号的独立段落，未纳入比对：' + piece.slice(0, 60));
            return;
          }
        }
        var text = normalizeWhitespace(piece).replace(/\n/g, ' ').replace(/^\s*[.)]\s*/, '').trim();
        if (!text || claims.some(function (claim) { return claim.num === String(number); })) return;
        claims.push({ num: String(number), text: text, type: claimType(text), dependencies: dependencies(text), inferred: entry.inferred || pieceIndex > 0 });
      });
    });

    if (!claims.length) diagnostics.push('未能识别出编号权利要求；请检查 OCR 结果或在清洗窗口中手动修正。');
    for (var j = 1; j < claims.length; j++) {
      var previous = Number(claims[j - 1].num), current = Number(claims[j].num);
      if (current > previous + 1) diagnostics.push('OCR 中缺少权利要求 ' + (previous + 1) + (current > previous + 2 ? ' 至 ' + (current - 1) : '') + ' 的编号或正文。');
    }
    return { cleanedText: cleaned, claims: claims, diagnostics: diagnostics };
  }

  function serializeClaims(claims) {
    return (claims || []).map(function (claim) { return claim.num + '. ' + claim.text; }).join('\n\n');
  }

  function currentDocument() {
    try {
      if (typeof kanbanState === 'undefined' || typeof pdfViewState === 'undefined') return null;
      var idx = pdfViewState.currentDocIdx;
      if (idx == null) return null;
      var doc = (kanbanState.documents || []).filter(function (item) { return item.idx === idx; })[0];
      var extraction = kanbanState.extractions && kanbanState.extractions[idx];
      return doc && extraction ? { idx: idx, doc: doc, extraction: extraction } : null;
    } catch (_) { return null; }
  }

  function isEligible(context) {
    if (!context || !context.doc || context.doc.type !== 'patent_doc') return false;
    var title = [context.doc.name, context.doc.desc, context.doc.docCode, context.doc.documentDescription].join(' ');
    return /\bclaims?\b|claim\s+listing|权利要求/i.test(title);
  }

  function removeModal() {
    var modal = document.getElementById(MODAL_ID);
    if (modal) modal.remove();
  }

  function openModal() {
    var context = currentDocument();
    if (!isEligible(context)) return;
    var source = context.extraction.markdown || context.extraction.text || '';
    var parsed = parseClaims(source);
    removeModal();
    var modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal amended-claims-modal';
    var docLabel = context.doc.name || context.doc.desc || '权利要求文档';
    modal.innerHTML = '<div class="modal-overlay" data-amended-close="true"></div>'
      + '<div class="modal-content amended-claims-dialog" role="dialog" aria-modal="true" aria-labelledby="amended-claims-title">'
      + '<div class="modal-header"><h2 id="amended-claims-title">OCR 修改版权利要求</h2><button class="btn-icon" type="button" title="关闭" data-amended-close="true">×</button></div>'
      + '<div class="modal-body"><p class="amended-claims-source">来源：' + escapeHtml(docLabel) + '。请核对清洗后的文本；下划线等修订标记已转为修改后的正文。</p>'
      + '<label class="amended-claims-label" for="amended-claims-text">修改版本权利要求</label><textarea id="amended-claims-text" class="amended-claims-textarea">' + escapeHtml(serializeClaims(parsed.claims)) + '</textarea>'
      + '<div class="amended-claims-diagnostics">' + (parsed.diagnostics.length ? parsed.diagnostics.map(function (item) { return '<p>' + escapeHtml(item) + '</p>'; }).join('') : '<p>已识别 ' + parsed.claims.length + ' 项权利要求，其中独立权利要求 ' + parsed.claims.filter(function (claim) { return claim.type === 'independent'; }).length + ' 项。</p>') + '</div>'
      + '<label class="amended-claims-label" for="amended-claims-base">基准专利号码</label><input id="amended-claims-base" class="amended-claims-base" type="text" placeholder="如 US12345678B2 或 CN110000000A">'
      + '</div><div class="modal-footer"><button class="btn-secondary" type="button" data-amended-close="true">取消</button><button class="btn-primary" type="button" id="amended-claims-compare">开始变动定位</button></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (event) {
      if (event.target.dataset && event.target.dataset.amendedClose) removeModal();
    });
    modal.querySelector('#amended-claims-compare').addEventListener('click', function () {
      var baseNum = modal.querySelector('#amended-claims-base').value.trim();
      var reparsed = parseClaims(modal.querySelector('#amended-claims-text').value);
      if (!baseNum) { modal.querySelector('#amended-claims-base').focus(); return; }
      if (!reparsed.claims.length) return;
      if (typeof ComparisonClaimDiff === 'undefined' || !ComparisonClaimDiff.enterWithBaselineAndClaims) return;
      removeModal();
      ComparisonClaimDiff.enterWithBaselineAndClaims(baseNum, reparsed.claims, { label: 'OCR 修改版本 · ' + docLabel, documentId: context.doc.docId || '', documentName: docLabel });
      var section = document.getElementById('comparison-section');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function syncButton() {
    var header = document.querySelector('.reader-extract-header');
    if (!header) return;
    var existing = document.getElementById(BUTTON_ID);
    if (!isEligible(currentDocument())) { if (existing) existing.remove(); return; }
    if (existing) return;
    var button = document.createElement('button');
    button.id = BUTTON_ID;
    button.className = 'btn-secondary btn-small amended-claims-trigger';
    button.type = 'button';
    button.textContent = '提取修改版权利要求';
    button.addEventListener('click', openModal);
    header.appendChild(button);
  }

  function injectStyle() {
    if (document.getElementById('amended-claims-ocr-style')) return;
    var style = document.createElement('style');
    style.id = 'amended-claims-ocr-style';
    style.textContent = '.amended-claims-trigger{margin-left:8px}.amended-claims-dialog{width:min(820px,94vw)}.amended-claims-source{margin:0 0 14px;color:var(--text-secondary,#64748b);font-size:13px;line-height:1.65}.amended-claims-label{display:block;margin:14px 0 6px;color:var(--text-primary,#0f172a);font-size:13px;font-weight:600}.amended-claims-textarea{box-sizing:border-box;width:100%;min-height:320px;padding:10px;border:1px solid var(--border,#cbd5e1);border-radius:6px;background:var(--bg-main,#fff);color:var(--text-primary,#0f172a);font:13px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;resize:vertical}.amended-claims-base{box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid var(--border,#cbd5e1);border-radius:6px;background:var(--bg-main,#fff);color:var(--text-primary,#0f172a);font-size:14px}.amended-claims-diagnostics{margin-top:10px;padding:8px 10px;border-left:3px solid #f59e0b;background:#fffbeb;color:#92400e;font-size:12px;line-height:1.55}.amended-claims-diagnostics p{margin:2px 0}.claimdiff-ocr-source{display:block;color:var(--text-secondary,#64748b);font-size:13px;line-height:34px}' ;
    document.head.appendChild(style);
  }

  function install() {
    injectStyle();
    var content = document.getElementById('reader-extract-content');
    if (content && window.MutationObserver) new MutationObserver(syncButton).observe(content, { childList: true, subtree: true });
    document.addEventListener('click', function (event) {
      if (event.target.closest && event.target.closest('.reader-doc-item')) setTimeout(syncButton, 0);
    });
    syncButton();
  }

  window.AmendedClaimsOcr = { cleanMarkup: cleanMarkup, parseClaims: parseClaims, serializeClaims: serializeClaims };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
