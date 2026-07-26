/*!
 * PatentLens - Image Annotations Module
 * 图片标号标注和说明书原文抽取跳转高亮模式
 * Allows users to double-click on patent drawings to add reference number markers,
 * click markers to highlight corresponding text in the description, and navigate
 * between occurrences.
 */
var ImageAnnotations = (function () {
  var STORAGE_KEY = "patentlens-img-annotations";
  var annotationMode = false;
  var activeHighlight = null; // { number, vid, markerId, occurrences: [], currentIdx: 0 }
  var markerEditorEl = null;
  var numberImeCleanup = null; // removes the IME-proof document keydown handler
  var navBarEl = null;
  var _originalParaHtml = new Map(); // p element -> original innerHTML (for highlight restore)
  var _wasDragging = false;

  // ── Storage ──
  function loadAll() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveAll(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("[ImageAnnotations] save failed:", e);
    }
  }
  function getMarkers(pn, imgIdx) {
    if (!pn) return [];
    var all = loadAll();
    var patentData = all[pn];
    if (!patentData) return [];
    return patentData[String(imgIdx)] || [];
  }
  function saveMarkers(pn, imgIdx, markers) {
    if (!pn) return;
    var all = loadAll();
    if (!all[pn]) all[pn] = {};
    all[pn][String(imgIdx)] = markers;
    saveAll(all);
  }
  function addMarker(pn, imgIdx, marker) {
    var markers = getMarkers(pn, imgIdx);
    markers.push(marker);
    saveMarkers(pn, imgIdx, markers);
  }
  function removeMarker(pn, imgIdx, markerId) {
    var markers = getMarkers(pn, imgIdx);
    var filtered = markers.filter(function (m) { return m.id !== markerId; });
    saveMarkers(pn, imgIdx, filtered);
  }
  function updateMarker(pn, imgIdx, markerId, updates) {
    var markers = getMarkers(pn, imgIdx);
    for (var i = 0; i < markers.length; i++) {
      if (markers[i].id === markerId) {
        for (var k in updates) { markers[i][k] = updates[k]; }
        break;
      }
    }
    saveMarkers(pn, imgIdx, markers);
  }
  function getAllAnnotatedPatents() {
    var all = loadAll();
    return Object.keys(all);
  }
  function getAnnotationCount(pn) {
    var all = loadAll();
    var pd = all[pn];
    if (!pd) return 0;
    var count = 0;
    for (var k in pd) { count += (pd[k] || []).length; }
    return count;
  }
  function clearAnnotations(pn) {
    var all = loadAll();
    delete all[pn];
    saveAll(all);
  }
  function clearAllAnnotations() {
    saveAll({});
  }
  function getStorageSize() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? raw.length : 0;
    } catch (e) { return 0; }
  }

  // ── Patent number helper ──
  function getCurrentPatentNumber() {
    if (typeof window !== "undefined") {
      if (window._currentPatentData) {
        return window._currentPatentData.patent_number ||
               window._currentPatentData.patentNumber || "";
      }
      if (window._patentPopupData) {
        return window._patentPopupData.patent_number ||
               window._patentPopupData.patentNumber || "";
      }
    }
    return "";
  }

  // ── Image rect calculation ──
  function getUntransformedImageRect(vid) {
    var stage = document.getElementById(vid + "_stage");
    var img = document.getElementById(vid + "_img");
    if (!stage || !img) return null;
    var state = _splitViewerState[vid];
    if (!state) return null;

    var stageRect = stage.getBoundingClientRect();
    var naturalW = img.naturalWidth;
    var naturalH = img.naturalHeight;
    if (!naturalW || !naturalH) return null;

    var aspect = naturalW / naturalH;
    var stageAspect = stageRect.width / stageRect.height;
    var dispW, dispH;
    if (aspect > stageAspect) {
      dispW = stageRect.width;
      dispH = stageRect.width / aspect;
    } else {
      dispH = stageRect.height;
      dispW = stageRect.height * aspect;
    }
    var dispX = (stageRect.width - dispW) / 2;
    var dispY = (stageRect.height - dispH) / 2;
    return {
      left: stageRect.left + dispX,
      top: stageRect.top + dispY,
      width: dispW,
      height: dispH,
    };
  }

  // ── Sync anno overlay position/size to match the untransformed image rect ──
  function syncAnnoLayer(vid) {
    var stage = document.getElementById(vid + "_stage");
    var overlay = document.getElementById(vid + "_anno");
    if (!stage || !overlay) return;
    var rect = getUntransformedImageRect(vid);
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    var stageRect = stage.getBoundingClientRect();
    overlay.style.left = (rect.left - stageRect.left) + "px";
    overlay.style.top = (rect.top - stageRect.top) + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
  }

  function getClickPctOnImage(e, vid) {
    var state = _splitViewerState[vid];
    var imgRect = getUntransformedImageRect(vid);
    if (!imgRect || !state) return null;

    // Since the annotation overlay does NOT rotate with the image,
    // click coordinates are already in the unrotated image space.
    // We only need to reverse the translate and scale.
    var centerX = imgRect.left + imgRect.width / 2 + (state.tx || 0);
    var centerY = imgRect.top + imgRect.height / 2 + (state.ty || 0);
    var dx = e.clientX - centerX;
    var dy = e.clientY - centerY;

    dx /= (state.scale || 1);
    dy /= (state.scale || 1);

    // No reverse rotation needed — overlay is not rotated
    var xPct = (dx + imgRect.width / 2) / imgRect.width;
    var yPct = (dy + imgRect.height / 2) / imgRect.height;
    xPct = Math.max(0, Math.min(1, xPct));
    yPct = Math.max(0, Math.min(1, yPct));
    return { x: xPct, y: yPct };
  }

  // ── Annotation mode ──
  function isAnnotationMode() { return annotationMode; }

  // ── Suspend / resume Google Translate while annotating ──
  // Entering annotation mode (or opening the marker editor) must stop GT from
  // touching the editor DOM. Clearing the language combo ("idle") is NOT enough
  // on its own: the GT widget caches the last target language and keeps re-wrapping
  // any newly added subtree via its global MutationObserver. That previously
  // triggered an infinite wrap/unwrap tug-of-war with our protective observer and
  // left the input unfocusable for tens of seconds. The reliable, crash-free fix
  // is to mark <body> as notranslate so GT's observer skips the ENTIRE subtree
  // (including the editor) — without ever purging window.google (which crashes GT).
  function _suspendGt() {
    try {
      if (typeof setComboToOriginal === 'function') setComboToOriginal();
      if (typeof _hideGtChrome === 'function') _hideGtChrome();
      document.body.classList.add('notranslate');
      document.body.setAttribute('translate', 'no');
    } catch (e) { /* ignore */ }
  }
  function _resumeGt() {
    // Stay suspended only while an editor modal is still open (the editor itself is
    // already marked notranslate, so this is just a belt-and-suspenders pause).
    if (markerEditorEl) return;
    try {
      document.body.classList.remove('notranslate');
      document.body.removeAttribute('translate');
    } catch (e) { /* ignore */ }
  }

  // ── Annotation mode ──
  function toggleAnnotationMode() {
    annotationMode = !annotationMode;
    // GT is no longer suspended merely for being in annotation mode — the editor
    // modal (and all annotation UI) are individually marked notranslate, so the rest
    // of the page keeps translating. GT is only paused while an editor modal is open.
    document.body.classList.toggle("anno-mode-active", annotationMode);
    var btns = document.querySelectorAll(".anno-toggle-btn");
    btns.forEach(function (b) { b.classList.toggle("active", annotationMode); });
    var mains = document.querySelectorAll(".pd-split-main-image");
    mains.forEach(function (m) {
      m.classList.toggle("anno-mode", annotationMode);
    });
    _syncAnnoHintBar();
    return annotationMode;
  }

  // ── Hint bar: reminds user to double-click to insert a marker, with an exit button ──
  // Positioned at the top of the active image area (not the page center)
  function _syncAnnoHintBar() {
    var bar = document.getElementById("anno-hint-bar");
    if (annotationMode) {
      // Find the active split-view main image container
      var targetMain = document.querySelector(".pd-split-main-image") ||
        document.querySelector(".patent-image-viewer .pd-split-main-image");
      if (!targetMain) {
        // No image viewer open yet; defer until one opens
        if (bar) bar.remove();
        return;
      }
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "anno-hint-bar";
        bar.className = "anno-hint-bar notranslate";
        bar.setAttribute("translate", "no");
        bar.innerHTML =
          '<span class="anno-hint-text">' +
          "标注模式：双击鼠标位置以插入标记" +
          "</span>" +
          '<button class="anno-hint-exit" type="button">退出标注</button>';
        var exitBtn = bar.querySelector(".anno-hint-exit");
        if (exitBtn) {
          exitBtn.addEventListener("click", function () {
            if (annotationMode) toggleAnnotationMode();
          });
        }
      }
      // Append inside the image container so it positions relative to it
      if (bar.parentNode !== targetMain) {
        targetMain.appendChild(bar);
      }
    } else {
      if (bar) bar.remove();
    }
  }

  // Apply anno-mode class to a newly opened viewer if annotation mode is active
  function applyAnnoModeToViewer(vid) {
    if (!annotationMode) return;
    var main = document.getElementById(vid + "_main");
    if (main) main.classList.add("anno-mode");
    // Re-sync hint bar into the newly opened viewer
    _syncAnnoHintBar();
  }

  // ── Marker rendering ──
  function renderMarkers(vid) {
    var state = _splitViewerState[vid];
    if (!state) return;
    var overlay = document.getElementById(vid + "_anno");
    if (!overlay) return;
    overlay.innerHTML = "";

    var pn = getCurrentPatentNumber();
    var markers = getMarkers(pn, state.currentIdx);
    markers.forEach(function (m) {
      var el = createMarkerElement(m, vid);
      overlay.appendChild(el);
    });
    updateAnnoListBadge(vid);
  }

  function createMarkerElement(marker, vid) {
    var el = document.createElement("div");
    el.className = "img-anno-marker notranslate";
    el.setAttribute("translate", "no");
    el.dataset.markerId = marker.id;
    el.style.left = (marker.x * 100) + "%";
    el.style.top = (marker.y * 100) + "%";
    el.style.color = marker.color || "#ef4444";
    el.style.fontSize = (marker.fontSize || 16) + "px";
    el.innerHTML =
      '<div class="img-anno-marker-dot" style="background:' + (marker.color || "#ef4444") + '">' +
      '<span class="img-anno-marker-num">' + escapeHtmlAnno(marker.number) + "</span></div>" +
      (marker.comment ? '<div class="img-anno-marker-comment">' + escapeHtmlAnno(marker.comment) + "</div>" : "");

    // Drag-to-move
    makeMarkerDraggable(el, marker, vid);

    el.addEventListener("click", function (e) {
      if (_wasDragging) {
        e.stopPropagation();
        e.preventDefault();
        _wasDragging = false;
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      onMarkerClick(marker, vid);
    });
    el.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      e.stopPropagation();
      showMarkerContextMenu(e.clientX, e.clientY, marker, vid);
    });
    return el;
  }

  // ── Marker drag-to-move ──
  function makeMarkerDraggable(el, marker, vid) {
    var DRAG_THRESHOLD = 4;

    el.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      e.stopPropagation();

      var startX = e.clientX;
      var startY = e.clientY;
      var moved = false;

      function onMove(ev) {
        var dx = ev.clientX - startX;
        var dy = ev.clientY - startY;
        if (!moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
          moved = true;
          el.classList.add("dragging");
        }
        if (moved) {
          updatePos(ev);
        }
      }

      function updatePos(ev) {
        var state = _splitViewerState[vid];
        if (!state) return;
        var imgRect = getUntransformedImageRect(vid);
        if (!imgRect) return;

        // Overlay is not rotated, so drag delta is already in image space.
        // Only need to reverse translate and scale.
        var dx = (ev.clientX - startX) / (state.scale || 1) / imgRect.width;
        var dy = (ev.clientY - startY) / (state.scale || 1) / imgRect.height;

        // No reverse rotation needed — overlay is not rotated
        var newX = Math.max(0, Math.min(1, marker.x + dx));
        var newY = Math.max(0, Math.min(1, marker.y + dy));

        el.style.left = (newX * 100) + "%";
        el.style.top = (newY * 100) + "%";
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (moved) {
          el.classList.remove("dragging");
          var newX = parseFloat(el.style.left) / 100;
          var newY = parseFloat(el.style.top) / 100;
          var pn = getCurrentPatentNumber();
          var state = _splitViewerState[vid];
          if (pn && state) {
            updateMarker(pn, state.currentIdx, marker.id, { x: newX, y: newY });
            marker.x = newX;
            marker.y = newY;
          }
          _wasDragging = true;
        }
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  function escapeHtmlAnno(text) {
    if (!text) return "";
    var div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }

  // ── Double-click handler ──
  function handleDblClick(e, vid) {
    if (!annotationMode) return false;
    var pct = getClickPctOnImage(e, vid);
    if (!pct) return false;
    showMarkerEditor(e.clientX, e.clientY, vid, null, pct);
    return true;
  }

  // ── Marker editor dialog ──
  function showMarkerEditor(screenX, screenY, vid, existingMarker, pct) {
    closeMarkerEditor();
    var isEdit = !!existingMarker;
    var m = existingMarker || {
      number: "",
      comment: "",
      color: "#ef4444",
      fontSize: 16,
    };

    markerEditorEl = document.createElement("div");
    markerEditorEl.className = "anno-editor-overlay notranslate";
    markerEditorEl.setAttribute("translate", "no");
    markerEditorEl.innerHTML =
      '<div class="anno-editor-box">' +
      '<div class="anno-editor-title">' + (isEdit ? "编辑标记" : "添加附图标记") + "</div>" +
      '<div class="anno-editor-field">' +
      '<label>附图标号 <span style="color:var(--danger)">*</span></label>' +
      '<input type="text" class="notranslate" translate="no" id="anno-edit-number" value="' + escapeHtmlAnno(m.number) + '" placeholder="如 100、102、30A" autocomplete="off" inputmode="verbatim" readonly>' +
      "</div>" +
      '<div class="anno-editor-field">' +
      "<label>注释文字（可选）</label>" +
      '<textarea class="notranslate" translate="no" id="anno-edit-comment" rows="2" placeholder="该标号代表的部件名称或说明" autocomplete="off">' + escapeHtmlAnno(m.comment || "") + "</textarea>" +
      "</div>" +
      '<div class="anno-editor-field anno-editor-row">' +
      "<div><label>颜色</label><input type=\"color\" id=\"anno-edit-color\" value=\"" + (m.color || "#ef4444") + "\"></div>" +
      "<div><label>字号</label><input type=\"number\" id=\"anno-edit-fontsize\" value=\"" + (m.fontSize || 16) + "\" min=\"12\" max=\"32\"></div>" +
      "</div>" +
      '<div class="anno-editor-actions">' +
      (isEdit ? '<button class="btn-danger-sm" id="anno-edit-delete">删除</button>' : "") +
      '<div style="flex:1"></div>' +
      '<button class="btn-secondary-sm" id="anno-edit-cancel">取消</button>' +
      '<button class="btn-primary-sm" id="anno-edit-save">' + (isEdit ? "保存" : "添加") + "</button>" +
      "</div>" +
      "</div>";
    document.body.appendChild(markerEditorEl);

    var box = markerEditorEl.querySelector(".anno-editor-box");
    box.style.left = Math.min(screenX, window.innerWidth - 360) + "px";
    box.style.top = Math.min(screenY, window.innerHeight - 340) + "px";

    markerEditorEl.querySelector("#anno-edit-cancel").addEventListener("click", closeMarkerEditor);
    markerEditorEl.querySelector("#anno-edit-save").addEventListener("click", function () {
      var number = markerEditorEl.querySelector("#anno-edit-number").value.trim();
      if (!number) { markerEditorEl.querySelector("#anno-edit-number").focus(); return; }
      var comment = markerEditorEl.querySelector("#anno-edit-comment").value.trim();
      var color = markerEditorEl.querySelector("#anno-edit-color").value;
      var fontSize = parseInt(markerEditorEl.querySelector("#anno-edit-fontsize").value, 10) || 16;

      var pn = getCurrentPatentNumber();
      var state = _splitViewerState[vid];
      if (!pn || !state) { closeMarkerEditor(); return; }

      if (isEdit) {
        updateMarker(pn, state.currentIdx, existingMarker.id, {
          number: number, comment: comment, color: color, fontSize: fontSize,
        });
        // Update the in-memory marker object too (for list panel references)
        existingMarker.number = number;
        existingMarker.comment = comment;
        existingMarker.color = color;
        existingMarker.fontSize = fontSize;
      } else {
        var newMarker = {
          id: "m_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
          number: number, x: pct.x, y: pct.y,
          comment: comment, color: color, fontSize: fontSize,
          createdAt: Date.now(),
        };
        addMarker(pn, state.currentIdx, newMarker);
      }
      renderMarkers(vid);
      closeMarkerEditor();
    });

    if (isEdit) {
      markerEditorEl.querySelector("#anno-edit-delete").addEventListener("click", function () {
        var pn = getCurrentPatentNumber();
        var state = _splitViewerState[vid];
        if (pn && state) {
          removeMarker(pn, state.currentIdx, existingMarker.id);
          renderMarkers(vid);
          if (activeHighlight && activeHighlight.markerId === existingMarker.id) {
            clearHighlight();
          }
        }
        closeMarkerEditor();
      });
    }

    markerEditorEl.addEventListener("click", function (e) {
      if (e.target === markerEditorEl) closeMarkerEditor();
    });
    // Prevent mousedown from propagating to stage (which starts panning)
    markerEditorEl.addEventListener("mousedown", function (e) { e.stopPropagation(); });

    // ── Keep Google Translate fully suspended while the editor is open ──
    // Marking <body> as notranslate (in _suspendGt) makes GT's global
    // MutationObserver skip the ENTIRE editor subtree, so GT can never wrap the
    // inputs or steal focus. This replaces the previous wrap/unwrap MutationObserver
    // tug-of-war with our protective observer, which left the input unfocusable
    // for many seconds while GT kept re-wrapping newly added text. We never purge
    // window.google (that crashes GT's in-flight promises).
    _suspendGt();

    // Focus the number input. The editor subtree is notranslate and GT is paused
    // while the modal is open, so an immediate focus (plus a short safety retry in
    // case layout isn't ready) is sufficient.
    // focus (plus a couple of short safety retries in case layout isn't ready)
    // is sufficient — no multi-second retry loop.
    var focusAttempts = 0;
    var composing = false;
    var inp = markerEditorEl.querySelector('#anno-edit-number');
    var ta = markerEditorEl.querySelector('#anno-edit-comment');
    function _setComposing(v) { composing = v; }
    inp.addEventListener('compositionstart', function () { _setComposing(true); });
    inp.addEventListener('compositionend', function () { _setComposing(false); });
    // The comment box stays editable so the Windows Chinese IME can compose into it;
    // we still drive it through the same capture-phase handler for non-composition
    // keys, so typing works even if some global listener would otherwise swallow it.
    ta.addEventListener('compositionstart', function () { _setComposing(true); });
    ta.addEventListener('compositionend', function () { _setComposing(false); });
    // ── IME-proof manual key handling for BOTH editor fields ──
    // Windows Chinese IME swallows keystrokes into composition (key="Process") and the
    // digits never reach the value until the user commits — which reads as "can't type".
    // The number box is readonly (so the IME won't compose into it) and the comment box
    // is editable (so IME composes into it normally). For BOTH we intercept non-composition
    // printable keys at the document capture phase (the only phase that reliably fires) and
    // write the character in verbatim; when an IME composition IS active we step aside and
    // let the browser commit the text natively, so Chinese input works in the comment box.
    function insertTextAtCursor(el, text) {
      var s = (el.selectionStart != null) ? el.selectionStart : el.value.length;
      var e = (el.selectionEnd != null) ? el.selectionEnd : el.value.length;
      el.value = el.value.slice(0, s) + text + el.value.slice(e);
      var p = s + text.length;
      try { el.setSelectionRange(p, p); } catch (_) {}
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function deleteTextAtCursor(el, backward) {
      var s = (el.selectionStart != null) ? el.selectionStart : el.value.length;
      var e = (el.selectionEnd != null) ? el.selectionEnd : el.value.length;
      if (s === e) { if (backward && s > 0) s--; else if (!backward && e < el.value.length) e++; }
      if (s === e) return;
      el.value = el.value.slice(0, s) + el.value.slice(e);
      try { el.setSelectionRange(s, s); } catch (_) {}
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function _writeInto(box, text) {
      insertTextAtCursor(box, text);
    }
    function _deleteFrom(box, backward) {
      deleteTextAtCursor(box, backward);
    }
    var numberImeHandler = function (e) {
      if (!markerEditorEl) return;
      // Act only for our two fields; everything else behaves normally.
      var isNum = (document.activeElement === inp) || (e.target === inp);
      var isCmt = (document.activeElement === ta) || (e.target === ta);
      if (!isNum && !isCmt) return;
      var box = isNum ? inp : ta;
      // While an IME composition is in progress, let the browser handle it so that
      // Chinese pinyin / committed text goes in natively (only the comment box composes).
      // keyCode === 229 is the classic "IME is composing" signal for browsers that don't
      // set isComposing on the initiating keydown.
      if (e.isComposing || e.keyCode === 229) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // allow copy/paste/select-all
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isNum) {
          var saveBtn = markerEditorEl.querySelector('#anno-edit-save');
          if (saveBtn) saveBtn.click();
        }
        return;
      }
      if (e.key === 'Escape' || e.key === 'Tab') return; // let global handlers deal
      if (e.key && e.key.length === 1) { // printable char -> write verbatim
        e.preventDefault();
        _writeInto(box, e.key);
        return;
      }
      if (e.key === 'Backspace') { e.preventDefault(); _deleteFrom(box, true); return; }
      if (e.key === 'Delete') { e.preventDefault(); _deleteFrom(box, false); return; }
      // Arrow/Home/End: allow default caret movement (do not preventDefault)
    };
    // Capture phase on document is the most reliable phase: it fires for our fields before
    // the IME/OS or any other listener can swallow the key, so digits/letters go in verbatim.
    // (Do NOT also bind on the inputs themselves — that would fire a second time and double-write.)
    document.addEventListener('keydown', numberImeHandler, true);
    numberImeCleanup = function () {
      document.removeEventListener('keydown', numberImeHandler, true);
    };
    function focusNumberInput() {
      if (!markerEditorEl) return;
      var inp = markerEditorEl.querySelector("#anno-edit-number");
      var ta = markerEditorEl.querySelector("#anno-edit-comment");
      // Defensive: ensure inputs are editable (belt-and-suspenders; GT is suspended).
      [inp, ta].forEach(function(el) {
        if (!el) return;
        // Keep the number box readonly on purpose: that is what makes it IME-proof.
        // Removing readonly would let the Windows Chinese IME compose into it again.
        if (el === inp) { el.style.pointerEvents = ""; return; }
        if (el.hasAttribute("readonly")) el.removeAttribute("readonly");
        if (el.hasAttribute("disabled")) el.removeAttribute("disabled");
        el.style.pointerEvents = "";
      });
      if (!inp) return;
      // If the user already focused another field inside the editor, don't yank it.
      var ae = document.activeElement;
      if (ae && ae !== document.body && markerEditorEl.contains(ae) && ae !== inp) return;
      // Never steal focus while the IME is mid-composition — re-focusing an input
      // that the IME is composing into discards the in-progress composition, so the
      // typed characters never reach the value (input events stop firing). This is
      // the core reason the number box appeared "frozen" with a Chinese IME active.
      if (composing) return;
      inp.focus({ preventScroll: true });
      // Only auto-select when the field is empty; selecting text mid-composition
      // can also interrupt the IME.
      try { if (!inp.value) inp.select(); } catch (e) {}
      // Verify focus took; if not (layout not ready yet), retry briefly.
      if (document.activeElement !== inp && focusAttempts < 4) {
        focusAttempts++;
        setTimeout(focusNumberInput, 80);
      }
    }
    // Single focus after layout is ready. Avoid hammering focus() (rAF+0+120ms)
    // — repeated focus() on an input the IME is composing into breaks the
    // composition and the characters disappear.
    setTimeout(focusNumberInput, 60);
  }

  function closeMarkerEditor() {
    if (numberImeCleanup) { numberImeCleanup(); numberImeCleanup = null; }
    if (markerEditorEl) {
      markerEditorEl.remove();
      markerEditorEl = null;
    }
    // Restore Google Translate only if nothing else still needs it suspended
    // (annotation mode still on, or another editor open).
    _resumeGt();
  }

  // ── Marker context menu (right-click on marker) ──
  function showMarkerContextMenu(x, y, marker, vid) {
    closeMarkerContextMenu();
    var menu = document.createElement("div");
    menu.className = "anno-ctx-menu notranslate";
    menu.setAttribute("translate", "no");
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    menu.innerHTML =
      '<div class="anno-ctx-item" data-action="edit">编辑标记</div>' +
      '<div class="anno-ctx-item" data-action="highlight">高亮正文</div>' +
      '<div class="anno-ctx-item anno-ctx-danger" data-action="delete">删除标记</div>';
    document.body.appendChild(menu);

    menu.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    menu.addEventListener("click", function (e) {
      var item = e.target.closest(".anno-ctx-item");
      if (!item) return;
      var action = item.dataset.action;
      closeMarkerContextMenu();
      if (action === "edit") {
        showMarkerEditor(x, y, vid, marker, null);
      } else if (action === "highlight") {
        onMarkerClick(marker, vid);
      } else if (action === "delete") {
        var pn = getCurrentPatentNumber();
        var state = _splitViewerState[vid];
        if (pn && state) {
          removeMarker(pn, state.currentIdx, marker.id);
          renderMarkers(vid);
          if (activeHighlight && activeHighlight.markerId === marker.id) clearHighlight();
        }
      }
    });
    setTimeout(function () {
      document.addEventListener("click", closeMarkerContextMenu, { once: true });
    }, 0);
  }
  function closeMarkerContextMenu() {
    var existing = document.querySelector(".anno-ctx-menu");
    if (existing) existing.remove();
  }

  // ── Switch to description tab (so highlights are visible) ──
  function showDescriptionTab() {
    // Skip auto-translation when navigating from a marker click (preserve highlight)
    window._skipAutoTranslate = true;
    // Patent detail tab layout
    var bmTab = document.querySelector('.pd-bookmark-tab[data-tab="description"]');
    if (bmTab && typeof switchPatentTab === "function") {
      switchPatentTab("description");
      return;
    }
    // Popup viewer tab layout
    var ppvBmTab = document.querySelector('.ppv-bm-tab[data-tab="description"]');
    if (ppvBmTab && typeof switchPpvTab === "function") {
      switchPpvTab("description");
      return;
    }
  }

  // ── Marker click → highlight description ──
  function onMarkerClick(marker, vid) {
    // Always clear previous highlight first
    clearHighlight();
    // Switch to description tab so the highlight is visible
    showDescriptionTab();
    var occurrences = highlightNumberInDescription(marker.number);
    activeHighlight = {
      number: marker.number,
      vid: vid,
      markerId: marker.id,
      occurrences: occurrences,
      currentIdx: 0,
    };
    if (occurrences.length > 0) {
      showNavBar(vid, marker.number, occurrences.length, 0);
      // Delay scroll to allow tab switch to render
      setTimeout(function () { scrollToOccurrence(0); }, 100);
    } else {
      showNavBar(vid, marker.number, 0, 0);
    }
  }

  // ── Text highlighting in description (TreeWalker-based, robust) ──
  function getDescriptionContainers() {
    var containers = [];
    var selectors = [".pd-description-text", ".pd-claims-list", ".pd-claim-item"];
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        containers.push(el);
      });
    });
    return containers;
  }

  function highlightNumberInDescription(number) {
    if (!number) return [];
    var containers = getDescriptionContainers();
    var occurrences = [];
    // Build regex that matches both half-width and full-width characters
    // e.g., "24a" matches "24a", "２４ａ", "2４a", etc.
    var numChars = number.split("");
    var numPattern = numChars.map(function (ch) {
      var escaped = ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      var code = ch.charCodeAt(0);
      if (code >= 48 && code <= 57) {
        // digit 0-9: also match full-width ０-９
        return "[" + escaped + String.fromCharCode(code + 0xFEE0) + "]";
      }
      if (code >= 65 && code <= 90) {
        // A-Z: also match full-width Ａ-Ｚ
        return "[" + escaped + String.fromCharCode(code + 0xFEE0) + "]";
      }
      if (code >= 97 && code <= 122) {
        // a-z: also match full-width ａ-ｚ
        return "[" + escaped + String.fromCharCode(code + 0xFEE0) + "]";
      }
      return escaped;
    }).join("");
    var numRegex = new RegExp("(^|[^0-9a-zA-Z０-９ａ-ｚＡ-Ｚ])(" + numPattern + ")(?=[^0-9a-zA-Z０-９ａ-ｚＡ-Ｚ]|$)", "g");

    containers.forEach(function (container) {
      var paragraphs = container.querySelectorAll("p");
      paragraphs.forEach(function (p) {
        // Store original HTML if not already stored; restore first if already highlighted
        if (!_originalParaHtml.has(p)) {
          _originalParaHtml.set(p, p.innerHTML);
        } else {
          p.innerHTML = _originalParaHtml.get(p);
        }

        var found = false;
        // Walk text nodes and wrap matches in spans
        var walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null, false);
        var textNodes = [];
        var node;
        while (node = walker.nextNode()) {
          textNodes.push(node);
        }

        textNodes.forEach(function (textNode) {
          var text = textNode.nodeValue;
          numRegex.lastIndex = 0;
          var match;
          var lastIndex = 0;
          var fragments = [];
          var hasMatch = false;
          while ((match = numRegex.exec(text)) !== null) {
            hasMatch = true;
            found = true;
            if (match.index > lastIndex) {
              fragments.push(document.createTextNode(text.substring(lastIndex, match.index)));
            }
            if (match[1]) {
              fragments.push(document.createTextNode(match[1]));
            }
            var span = document.createElement("span");
            span.className = "anno-highlight-num";
            span.dataset.annoNum = number;
            span.textContent = match[2];
            fragments.push(span);
            lastIndex = match.index + match[0].length;
            if (match[0].length === 0) numRegex.lastIndex++;
          }
          if (hasMatch) {
            if (lastIndex < text.length) {
              fragments.push(document.createTextNode(text.substring(lastIndex)));
            }
            var parent = textNode.parentNode;
            for (var i = 0; i < fragments.length; i++) {
              parent.insertBefore(fragments[i], textNode);
            }
            parent.removeChild(textNode);
          }
        });

        if (found) {
          p.classList.add("anno-highlight-sentence");
          p.dataset.annoNum = number;
          occurrences.push(p);
        }
      });
    });
    return occurrences;
  }

  function clearHighlight() {
    // Restore original HTML for all highlighted paragraphs
    _originalParaHtml.forEach(function (html, p) {
      if (p && p.parentNode) {
        p.innerHTML = html;
      }
    });
    _originalParaHtml.clear();

    document.querySelectorAll(".anno-highlight-sentence").forEach(function (el) {
      el.classList.remove("anno-highlight-sentence", "anno-highlight-active");
      delete el.dataset.annoNum;
    });
    activeHighlight = null;
    closeNavBar();
  }

  function navigateHighlight(direction) {
    if (!activeHighlight || activeHighlight.occurrences.length === 0) return;
    if (direction > 0) {
      activeHighlight.currentIdx = (activeHighlight.currentIdx + 1) % activeHighlight.occurrences.length;
    } else {
      activeHighlight.currentIdx = (activeHighlight.currentIdx - 1 + activeHighlight.occurrences.length) % activeHighlight.occurrences.length;
    }
    updateNavBar();
    scrollToOccurrence(activeHighlight.currentIdx);
  }

  function scrollToOccurrence(idx) {
    if (!activeHighlight || !activeHighlight.occurrences[idx]) return;
    var el = activeHighlight.occurrences[idx];
    document.querySelectorAll(".anno-highlight-active").forEach(function (e) {
      e.classList.remove("anno-highlight-active");
    });
    el.classList.add("anno-highlight-active");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ── Navigation bar ──
  function showNavBar(vid, number, total, current) {
    closeNavBar();
    // Only show nav bar inside the patent-detail-section.
    // When patent detail is hidden (dossier/extract mode), the nav bar
    // will also be hidden because display:none cascades to children.
    var pdSection = document.getElementById("patent-detail-section");
    if (!pdSection || pdSection.classList.contains("hidden")) return;

    navBarEl = document.createElement("div");
    navBarEl.className = "anno-nav-bar notranslate";
    navBarEl.setAttribute("translate", "no");
    navBarEl.innerHTML =
      '<div class="anno-nav-info">' +
      '<span class="anno-nav-num">标号 ' + escapeHtmlAnno(number) + "</span>" +
      '<span class="anno-nav-count" id="anno-nav-count">' + (total > 0 ? (current + 1) + "/" + total : "无匹配") + "</span>" +
      "</div>" +
      '<div class="anno-nav-btns">' +
      '<button class="anno-nav-btn" id="anno-nav-prev" title="上一处">▲</button>' +
      '<button class="anno-nav-btn" id="anno-nav-next" title="下一处">▼</button>' +
      '<button class="anno-nav-btn anno-nav-close" title="关闭">✕</button>' +
      "</div>";
    pdSection.appendChild(navBarEl);
    navBarEl.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    navBarEl.querySelector("#anno-nav-prev").addEventListener("click", function (e) { e.stopPropagation(); navigateHighlight(-1); });
    navBarEl.querySelector("#anno-nav-next").addEventListener("click", function (e) { e.stopPropagation(); navigateHighlight(1); });
    navBarEl.querySelector(".anno-nav-close").addEventListener("click", function (e) { e.stopPropagation(); clearHighlight(); });
  }

  function updateNavBar() {
    if (!navBarEl || !activeHighlight) return;
    var countEl = navBarEl.querySelector("#anno-nav-count");
    if (countEl) {
      countEl.textContent = (activeHighlight.currentIdx + 1) + "/" + activeHighlight.occurrences.length;
    }
  }

  function closeNavBar() {
    if (navBarEl) { navBarEl.remove(); navBarEl = null; }
  }

  // ── Right-click on highlighted text → send to annotation ──
  function setupRightClickHandler() {
    document.addEventListener("contextmenu", function (e) {
      var highlightEl = e.target.closest(".anno-highlight-sentence");
      if (!highlightEl || !activeHighlight) return;
      var sel = window.getSelection();
      var text = sel ? sel.toString().trim() : "";
      if (!text || text.length < 2) return;

      e.preventDefault();
      e.stopPropagation();
      showSendToAnnotationBtn(e.clientX, e.clientY, text, activeHighlight);
    }, true);
  }

  function showSendToAnnotationBtn(x, y, text, highlight) {
    closeSendToAnnotationBtn();
    var btn = document.createElement("div");
    btn.className = "anno-send-btn notranslate";
    btn.setAttribute("translate", "no");
    btn.style.left = x + "px";
    btn.style.top = (y + 10) + "px";
    btn.innerHTML = "→ 发送到标记 " + escapeHtmlAnno(highlight.number) + " 注释";
    document.body.appendChild(btn);
    // Prevent mousedown from propagating (avoids stage panning & document-click dismissal)
    btn.addEventListener("mousedown", function (e) {
      e.stopPropagation();
      e.preventDefault();
    });
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      e.preventDefault();
      var pn = getCurrentPatentNumber();
      var state = _splitViewerState[highlight.vid];
      if (pn && state) {
        var markers = getMarkers(pn, state.currentIdx);
        for (var i = 0; i < markers.length; i++) {
          if (markers[i].id === highlight.markerId) {
            var existing = markers[i].comment || "";
            var newComment = existing ? existing + "；" + text : text;
            updateMarker(pn, state.currentIdx, highlight.markerId, { comment: newComment });
            // Update in-memory copy
            markers[i].comment = newComment;
            renderMarkers(highlight.vid);
            break;
          }
        }
      }
      closeSendToAnnotationBtn();
    });
    // Close on outside click, but exclude the button itself
    var outsideClickHandler = function (ev) {
      if (ev.target !== btn && !btn.contains(ev.target)) {
        closeSendToAnnotationBtn();
        document.removeEventListener("mousedown", outsideClickHandler);
      }
    };
    setTimeout(function () {
      document.addEventListener("mousedown", outsideClickHandler);
    }, 0);
  }

  function closeSendToAnnotationBtn() {
    var existing = document.querySelector(".anno-send-btn");
    if (existing) existing.remove();
  }

  // ── Marker list panel ──
  function toggleMarkerList(vid) {
    var state = _splitViewerState[vid];
    if (!state) return;
    var main = document.getElementById(vid + "_main");
    if (!main) return;
    var existingPanel = main.querySelector(".img-anno-list-panel");
    if (existingPanel) {
      existingPanel.remove();
      return;
    }
    var pn = getCurrentPatentNumber();
    var markers = getMarkers(pn, state.currentIdx);
    var panel = document.createElement("div");
    panel.className = "img-anno-list-panel notranslate";
    panel.setAttribute("translate", "no");
    panel.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    if (markers.length === 0) {
      panel.innerHTML = '<div class="img-anno-list-empty">当前图暂无标记</div>';
    } else {
      var html = '<div class="img-anno-list-header">标记列表 (' + markers.length + ')</div>';
      markers.forEach(function (m) {
        html +=
          '<div class="img-anno-list-item" data-marker-id="' + m.id + '">' +
          '<div class="img-anno-list-item-num" style="color:' + (m.color || "#ef4444") + '">' +
          '<span class="img-anno-list-dot" style="background:' + (m.color || "#ef4444") + '"></span>' +
          escapeHtmlAnno(m.number) +
          "</div>" +
          '<div class="img-anno-list-item-comment">' + escapeHtmlAnno(m.comment || "—") + "</div>" +
          '<div class="img-anno-list-item-actions">' +
          '<button class="img-anno-list-btn" data-action="goto" title="跳转高亮">📍</button>' +
          '<button class="img-anno-list-btn" data-action="edit" title="编辑">✎</button>' +
          '<button class="img-anno-list-btn" data-action="delete" title="删除">🗑</button>' +
          "</div></div>";
      });
      panel.innerHTML = html;
      panel.querySelectorAll(".img-anno-list-item").forEach(function (item) {
        var markerId = item.dataset.markerId;
        var marker = markers.find(function (m) { return m.id === markerId; });
        if (!marker) return;
        item.querySelector('[data-action="goto"]').addEventListener("click", function (e) {
          e.stopPropagation();
          onMarkerClick(marker, vid);
        });
        item.querySelector('[data-action="edit"]').addEventListener("click", function (e) {
          e.stopPropagation();
          var rect = item.getBoundingClientRect();
          showMarkerEditor(rect.left, rect.top, vid, marker, null);
        });
        item.querySelector('[data-action="delete"]').addEventListener("click", function (e) {
          e.stopPropagation();
          removeMarker(pn, state.currentIdx, markerId);
          renderMarkers(vid);
          if (activeHighlight && activeHighlight.markerId === markerId) clearHighlight();
          // Refresh panel
          var p = main.querySelector(".img-anno-list-panel");
          if (p) { p.remove(); toggleMarkerList(vid); }
        });
      });
    }
    main.appendChild(panel);
  }

  function updateAnnoListBadge(vid) {
    var state = _splitViewerState[vid];
    if (!state) return;
    var pn = getCurrentPatentNumber();
    var count = getMarkers(pn, state.currentIdx).length;
    var badge = document.querySelector('[data-anno-badge="' + vid + '"]');
    if (badge) {
      badge.textContent = count > 0 ? count : "";
      badge.style.display = count > 0 ? "" : "none";
    }
  }

  // ── Init ──
  function init() {
    setupRightClickHandler();
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (markerEditorEl) { closeMarkerEditor(); return; }
        if (activeHighlight) { clearHighlight(); return; }
      }
      if (activeHighlight) {
        if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); navigateHighlight(1); }
        if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); navigateHighlight(-1); }
      }
    });
  }

  return {
    init: init,
    isAnnotationMode: isAnnotationMode,
    toggleAnnotationMode: toggleAnnotationMode,
    applyAnnoModeToViewer: applyAnnoModeToViewer,
    handleDblClick: handleDblClick,
    renderMarkers: renderMarkers,
    syncAnnoLayer: syncAnnoLayer,
    onMarkerClick: onMarkerClick,
    toggleMarkerList: toggleMarkerList,
    clearHighlight: clearHighlight,
    closeNavBar: closeNavBar,
    navigateHighlight: navigateHighlight,
    getCurrentPatentNumber: getCurrentPatentNumber,
    getAllAnnotatedPatents: getAllAnnotatedPatents,
    getAnnotationCount: getAnnotationCount,
    clearAnnotations: clearAnnotations,
    clearAllAnnotations: clearAllAnnotations,
    getStorageSize: getStorageSize,
  };
})();
