/* One movable dock owns the desktop shortcuts. Existing panels retain their state. */
(function (root) {
  'use strict';
  var key = 'patentlens-tools-position-v1', dock, wheel, timer, drag, moved = false;
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
  function position(x, y, save) {
    var w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
    x = Math.max(10, Math.min(Number(x) || 10, w - 56)); y = Math.max(10, Math.min(Number(y) || 10, h - dock.offsetHeight - 10));
    dock.style.left = x + 'px'; dock.style.top = y + 'px';
    var inward = x > w / 2 ? -1 : 1;
    dock.classList.toggle('at-left', inward > 0);
    var center = Math.max(140, Math.min(y + dock.offsetHeight / 2, h - 140));
    wheel.style.top = (center - y) + 'px';
    // Four points on the inward-facing half of a circle. Labels fit inside 136 px cards.
    wheel.querySelectorAll('button').forEach(function (button, i) {
      var angle = (-72 + i * 48) * Math.PI / 180, dx = inward * (92 + Math.cos(angle) * 58), dy = Math.sin(angle) * 112;
      var left = Math.max(8 - x, Math.min(23 + dx - 68, w - x - 144));
      button.style.left = left + 'px'; button.style.top = (dy - 28) + 'px';
    });
    if (save) { try { localStorage.setItem(key, JSON.stringify({ x: x, y: y })); } catch (_) {} }
  }
  function expand(value) {
    clearTimeout(timer);
    if (drag) value = false;
    dock.classList.toggle('expanded', value);
    wheel.inert = !value; wheel.setAttribute('aria-hidden', String(!value));
    dock.querySelector('[data-drag]').setAttribute('aria-expanded', String(value));
  }
  function later() { clearTimeout(timer); timer = setTimeout(function () { if (!dock.contains(document.activeElement)) expand(false); }, 350); }
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
    function finish() { if (!drag) return; drag = null; position(parseFloat(dock.style.left), parseFloat(dock.style.top), true); setTimeout(function () { moved = false; }, 0); }
    root.addEventListener('pointerup', finish); root.addEventListener('pointercancel', finish);
    document.addEventListener('pointerdown', function (event) { if (!dock.contains(event.target)) expand(false); });
    document.addEventListener('pointermove', function (event) {
      if (drag || event.pointerType === 'touch') return;
      var r = dock.getBoundingClientRect();
      if (event.clientX >= r.left - 18 && event.clientX <= r.right + 18 && event.clientY >= r.top - 18 && event.clientY <= r.bottom + 18) expand(true);
    });
    root.addEventListener('resize', function () { position(parseFloat(dock.style.left), parseFloat(dock.style.top)); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
