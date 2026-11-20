/* One movable dock owns the desktop shortcuts. Existing panels retain their state. */
(function (root) {
  'use strict';
  var key = 'patentlens-tools-position-v1', dock, wheel, timer, peekTimer, drag, moved = false, keyboard = false;
  function assistant() {
    AgentUI.togglePanel();
    var panel = document.querySelector('.agent-panel'), report = document.getElementById('pl-tools-report-chat');
    if (!report) {
      report = document.createElement('button'); report.id = 'pl-tools-report-chat'; report.type = 'button'; report.textContent = '继续询问当前审查报告';
      report.onclick = function () { AgentUI.closePanel(); document.getElementById('analysis-chat-float-ball').click(); };
      panel.querySelector('.agent-panel-header').after(report);
    }
    report.hidden = !(root.TransferContext.getKanban().analysis);
  }
  var tools = [
    { id: 'assistant', label: '智能助手', path: '<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6"/>', run: assistant },
    { id: 'image', label: '生图工作台', path: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="9" cy="8" r="1.5"/><path d="m3 17 6-5 4 3 4-6 4 8"/>', run: function () { return root.Patent2PicWorkbench.open(); } },
    { id: 'tasks', label: 'Agent 任务', path: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 11h6M9 16h6"/>', run: function () { root.AgentTaskWorkspace.open(); } },
    { id: 'reader', label: '审查文档阅读器', path: '<path d="M12 5C8 2 3 4 3 4v16s5-2 9 1c4-3 9-1 9-1V4s-5-2-9 1Zm0 0v16"/>', run: function () {
      var kb = root.TransferContext.getKanban();
      if (!kb.documents.length) throw new Error('请先打开专利案卷并加载审查文档');
      var modal = document.getElementById('reader-modal');
      if (!modal.classList.contains('hidden')) { modal.classList.add('hidden'); exitReadingMode(); }
      else openReader();
    } }
  ];
  function icon(tool) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + tool.path + '</svg>'; }
  var offsets = [-1, -1 / 3, 1 / 3, 1], radiusMax = 124;
  function position(x, y, save) {
    var w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
    x = Math.max(10, Math.min(Number(x) || 10, w - 56)); y = Math.max(10, Math.min(Number(y) || 10, h - dock.offsetHeight - 10));
    dock.style.left = x + 'px'; dock.style.top = y + 'px';
    var inward = x > w / 2 ? -1 : 1;
    dock.classList.toggle('at-left', inward > 0);
    var dockWidth = dock.offsetWidth, margin = 10, cardW = 136, cardH = 56, gap = 10;
    var availIn = inward > 0 ? w - x - dockWidth - margin : x - margin;
    var radius = Math.max(64, Math.min(radiusMax, (availIn - cardW / 2 - 8) / .97, (h - margin * 2 - cardH) / 2 / .97));
    // Equal vertical steps keep the gaps between the four strips identical; the x offset
    // follows the same arc so the group still reads as a wheel around the dock.
    var half = Math.min((cardH + gap) * 1.5, radius * .85, (h - margin * 2 - cardH) / 2);
    var pad = Math.max(0, cardW / 2 - Math.sqrt(Math.max(0, radius * radius - half * half))) + 2;
    var lift = half + cardH / 2 + margin;
    var center = Math.max(lift, Math.min(y + dock.offsetHeight / 2, h - lift));
    wheel.style.left = (inward > 0 ? dockWidth + pad : -pad) + 'px';
    wheel.style.top = (center - y) + 'px';
    var origin = wheel.getBoundingClientRect();
    var froms = dock.querySelectorAll('.pl-tools-mini button'), boxes = [];
    for (var j = 0; j < froms.length; j++) boxes.push(froms[j].getBoundingClientRect());
    wheel.querySelectorAll('button').forEach(function (button, i) {
      var dy = offsets[i] * half, dx = inward * Math.sqrt(Math.max(0, radius * radius - dy * dy));
      button.style.left = (dx - cardW / 2) + 'px'; button.style.top = (dy - cardH / 2) + 'px';
      // Remember the dock icon this card grows out of so collapsing reverses the morph.
      var from = boxes[i];
      button.style.setProperty('--pl-morph-x', (from.left + from.width / 2 - origin.left - dx) + 'px');
      button.style.setProperty('--pl-morph-y', (from.top + from.height / 2 - origin.top - dy) + 'px');
    });
    if (save) { try { localStorage.setItem(key, JSON.stringify({ x: x, y: y })); } catch (_) {} }
    updatePeekShift();
  }
  // 贴边隐藏：把工具栏滑出屏幕，只留一小条抓手；鼠标靠近或键盘聚焦时恢复。
  function updatePeekShift() {
    if (!dock) return;
    var w = document.documentElement.clientWidth;
    var left = parseFloat(dock.style.left) || 0;
    var width = dock.offsetWidth || 46;
    var shift = dock.classList.contains('at-left')
      ? -(left + width - 12)
      : (w - left - 12);
    dock.style.setProperty('--pl-peek-x', shift + 'px');
  }
  function setPeek(value) {
    var next = !!value && !drag && !dock.classList.contains('expanded');
    if (next && keyboard && dock.contains(document.activeElement)) next = false;
    dock.classList.toggle('peeking', next);
  }
  function schedulePeek() {
    clearTimeout(peekTimer);
    peekTimer = setTimeout(function () {
      if (drag || dock.classList.contains('expanded')) return;
      if (keyboard && dock.contains(document.activeElement)) return;
      setPeek(true);
    }, 700);
  }
  function cancelPeek() { clearTimeout(peekTimer); setPeek(false); }
  // 工具栏区域 = 停靠条 + 展开后的轮盘卡片；只有指针在这里面时才显示轮盘。
  function pointerInsideTools(x, y) {
    var r = dock.getBoundingClientRect(), pad = 22;
    if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return true;
    if (!dock.classList.contains('expanded')) return false;
    var buttons = wheel.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i].getBoundingClientRect();
      if (b.width && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return true;
    }
    return false;
  }
  function expand(value) {
    clearTimeout(timer);
    timer = null;
    if (drag) value = false;
    if (value) cancelPeek(); else schedulePeek();
    dock.classList.toggle('expanded', value);
    wheel.inert = !value; wheel.setAttribute('aria-hidden', String(!value));
    dock.querySelector('[data-drag]').setAttribute('aria-expanded', String(value));
  }
  // 离开工具栏区域只启动一次收起计时；连续 pointermove 不能不断推迟关闭。
  function later() {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      if (!keyboard || !dock.contains(document.activeElement)) expand(false);
    }, 220);
  }
  function init() {
    dock = document.createElement('aside'); dock.id = 'pl-floating-tools'; dock.className = 'notranslate'; dock.setAttribute('aria-label', '悬浮工具栏');
    dock.innerHTML = '<button type="button" data-drag aria-label="拖动工具栏；点击展开工具" aria-expanded="false" title="拖动移动 · 点击展开"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="7" r="1.5"/><circle cx="15" cy="7" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="17" r="1.5"/><circle cx="15" cy="17" r="1.5"/></svg></button><div class="pl-tools-mini"></div><div class="pl-tools-wheel" aria-label="展开的工具" aria-hidden="true"></div><span class="pl-tools-status" role="status"></span>';
    wheel = dock.querySelector('.pl-tools-wheel'); wheel.inert = true;
    tools.forEach(function (tool) {
      ['.pl-tools-mini', '.pl-tools-wheel'].forEach(function (selector) {
        var button = document.createElement('button'); button.type = 'button'; button.dataset.tool = tool.id; button.title = tool.label; button.setAttribute('aria-label', tool.label);
        button.innerHTML = icon(tool) + (selector === '.pl-tools-wheel' ? '<span>' + tool.label + '</span>' : '');
        button.onclick = function () {
          if (moved) return;
          expand(false);
          Promise.resolve().then(tool.run).catch(function (error) { var status = dock.querySelector('[role=status]'); status.textContent = error.message; setTimeout(function () { status.textContent = ''; }, 4500); });
        };
        dock.querySelector(selector).appendChild(button);
      });
    });
    document.body.appendChild(dock); document.body.classList.add('pl-unified-tools');
    var saved; try { saved = JSON.parse(localStorage.getItem(key)); } catch (_) {}
    position(saved && saved.x || document.documentElement.clientWidth - 66, saved && saved.y || document.documentElement.clientHeight * .48);
    dock.addEventListener('pointerenter', function () { expand(true); }); dock.addEventListener('pointerleave', later);
    dock.addEventListener('focusin', function () { expand(true); }); dock.addEventListener('focusout', later);
    dock.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { expand(false); event.stopPropagation(); }
      if (event.target.hasAttribute('data-drag') && event.key.startsWith('Arrow')) {
        event.preventDefault(); var r = dock.getBoundingClientRect(); position(r.left + (event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0), r.top + (event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0), true);
      }
    });
    var handle = dock.querySelector('[data-drag]');
    handle.onclick = function () { if (!moved) expand(!dock.classList.contains('expanded')); };
    handle.onpointerdown = function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      // 贴边隐藏时先瞬时恢复原位，再以恢复后的位置作为拖拽基准，避免坐标跳变。
      dock.classList.add('no-transition');
      cancelPeek();
      void dock.offsetHeight;
      var r = dock.getBoundingClientRect(); drag = { x: event.clientX, y: event.clientY, left: r.left, top: r.top }; moved = false;
      try { handle.setPointerCapture(event.pointerId); } catch (_) { /* Window listeners also cover capture loss. */ }
      expand(false);
    };
    root.addEventListener('pointermove', function (event) {
      if (!drag) return;
      var dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 5) moved = true;
      if (moved) position(drag.left + dx, drag.top + dy);
    });
    function finish() {
      if (!drag) return;
      drag = null;
      position(parseFloat(dock.style.left), parseFloat(dock.style.top), true);
      dock.classList.remove('no-transition');
      schedulePeek();
      setTimeout(function () { moved = false; }, 0);
    }
    root.addEventListener('pointerup', finish); root.addEventListener('pointercancel', finish);
    document.addEventListener('keydown', function (event) { if (event.key === 'Tab' || event.key.startsWith('Arrow')) keyboard = true; });
    document.addEventListener('pointerdown', function (event) { keyboard = false; if (!dock.contains(event.target)) expand(false); });
    document.addEventListener('pointermove', function (event) {
      if (drag || event.pointerType === 'touch') return;
      // 只有指针位于停靠条或已展开的轮盘卡片上时才保持/呼出轮盘；
      // 离开该区域后立即进入收起计时，不会因旧的 pointerenter 状态一直悬停。
      if (pointerInsideTools(event.clientX, event.clientY)) expand(true);
      else if (!keyboard || !dock.contains(document.activeElement)) later();
    });
    root.addEventListener('resize', function () { position(parseFloat(dock.style.left), parseFloat(dock.style.top)); });
    schedulePeek();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
