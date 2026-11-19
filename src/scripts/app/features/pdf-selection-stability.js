/* Keep Chromium's native selection, but resolve PDF whitespace to its nearest
 * visual text row instead of an unrelated absolutely positioned DOM sibling. */
(function () {
  "use strict";
  let drag = null;

  function caretInSpan(span, x, y) {
    const node = span.firstChild;
    if (!node || node.nodeType !== 3) return null;
    const range = document.createRange();
    const length = node.length;
    function position(offset) {
      range.setStart(node, offset);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    }
    const first = position(0), last = position(length);
    const axis = Math.abs(last.y - first.y) > Math.abs(last.x - first.x) ? "y" : "x";
    const direction = last[axis] >= first[axis] ? 1 : -1;
    const target = (axis === "x" ? x : y) * direction;
    let low = 0, high = length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (position(mid)[axis] * direction < target) low = mid + 1;
      else high = mid;
    }
    let offset = low;
    if (offset && Math.abs(position(offset - 1)[axis] * direction - target) < Math.abs(position(offset)[axis] * direction - target)) offset--;
    // Never split a UTF-16 surrogate pair when resolving a blank area's caret.
    if (offset && offset < length && /[\uDC00-\uDFFF]/.test(node.data[offset]) && /[\uD800-\uDBFF]/.test(node.data[offset - 1])) offset--;
    return { node, offset };
  }

  function nearestCaret(layer, x, y) {
    const vertical = (Number(layer.dataset.mainRotation) || 0) % 180 !== 0;
    let best = null, bestRow = Infinity, bestAlong = Infinity;
    const rows = [];
    for (const span of layer.querySelectorAll("span")) {
      if (!span.firstChild || span.firstChild.nodeType !== 3 || !span.textContent.trim()) continue;
      const rect = span.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      rows.push({ span, rect });
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      const row = vertical ? dx : dy, along = vertical ? dy : dx;
      if (row < bestRow - .5 || (Math.abs(row - bestRow) <= .5 && along < bestAlong)) {
        best = span; bestRow = row; bestAlong = along;
      }
    }
    if (!best) return null;
    // In a line gap, finish the nearer row before entering the next one.
    // Projecting x onto that row can otherwise briefly select backwards when
    // dragging down from the middle of a line towards an indented next line.
    const rect = best.getBoundingClientRect();
    if (!vertical && (y < rect.top || y > rect.bottom)) {
      const reversed = (Number(layer.dataset.mainRotation) || 0) % 360 === 180;
      const after = (y > rect.bottom) !== reversed;
      // A PDF often splits a single line into several positioned spans. Use
      // the entire row's boundary so crossing its gap cannot reverse a range
      // anchored in a later span on that same row.
      const row = rows.filter(item => Math.min(rect.bottom, item.rect.bottom) - Math.max(rect.top, item.rect.top) > Math.min(rect.height, item.rect.height) / 2);
      const edge = (after ? row[row.length - 1] : row[0]).span.firstChild;
      return { node: edge, offset: after ? edge.length : 0 };
    }
    return caretInSpan(best, x, y);
  }

  function enabled(layer, event) {
    const container = layer.closest(".reader-pdf-container");
    return container && container.classList.contains("pdf-text-select-mode") &&
      !container.classList.contains("pdf-annot-mode") && !layer.parentElement.classList.contains("ocr-page-selectable") &&
      !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
  }

  function stabilize() {
    if (!drag || !drag.anchor.node.isConnected) { drag = null; return; }
    const target = document.elementFromPoint(drag.x, drag.y);
    let layer = target && target.closest(".pdf-text-layer");
    if (!layer && target && target.closest(".reader-pdf-container")) {
      // Page labels and page gaps are not selection endpoints. Keep the range
      // on the closest page's text while Chromium handles edge autoscrolling.
      let distance = Infinity;
      for (const candidate of target.closest(".reader-pdf-container").querySelectorAll(".pdf-text-layer")) {
        const rect = candidate.getBoundingClientRect();
        const value = Math.max(rect.top - drag.y, 0, drag.y - rect.bottom);
        if (value < distance) { layer = candidate; distance = value; }
      }
    }
    if (!layer || !enabled(layer, drag)) return;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const hit = target.closest("span");
    const validTextHit = hit && hit.firstChild && hit.firstChild.nodeType === 3 && hit.textContent.trim();
    const focus = validTextHit ? { node: selection.focusNode, offset: selection.focusOffset } : nearestCaret(layer, drag.x, drag.y);
    if (!focus || !focus.node || !focus.node.isConnected) return;
    if (selection.anchorNode !== drag.anchor.node || selection.anchorOffset !== drag.anchor.offset ||
        selection.focusNode !== focus.node || selection.focusOffset !== focus.offset) {
      selection.setBaseAndExtent(drag.anchor.node, drag.anchor.offset, focus.node, focus.offset);
    }
  }

  document.addEventListener("mousedown", event => {
    drag = null;
    const layer = event.target.closest && event.target.closest(".pdf-text-layer");
    if (event.button !== 0 || event.detail > 1 || !layer || !enabled(layer, event)) return;
    const anchor = nearestCaret(layer, event.clientX, event.clientY);
    if (anchor) drag = { anchor, x: event.clientX, y: event.clientY };
  }, true);
  document.addEventListener("mousemove", event => {
    if (!drag) return;
    if (!(event.buttons & 1)) { drag = null; return; }
    drag.x = event.clientX; drag.y = event.clientY;
    // The browser's default mouse selection can run after this listener.
    queueMicrotask(stabilize);
    // Chromium may coalesce selectionchange while updating its native range.
    // Resolve again before paint, after the default mouse action has finished.
    requestAnimationFrame(stabilize);
  }, true);
  document.addEventListener("selectionchange", stabilize);
  document.addEventListener("mouseup", () => { stabilize(); drag = null; }, true);
  window.addEventListener("blur", () => { drag = null; });
})();
