/*!
 * PatentLens - 专利分享离线 HTML 渲染器
 *
 * 输入为项目快照和声明式模块配置，输出不依赖网络的 HTML。所有外部文本
 * 先转义；该模块不执行用户 HTML 或用户脚本。仅分基础信息与加工信息两类。
 */
(function () {
  "use strict";

  var CSS = ":root{--c-bg:#f4f6fb;--c-surface:#ffffff;--c-border:#e2e8f0;--c-border-soft:#eef2f7;--c-text:#1e293b;--c-muted:#64748b;--c-faint:#94a3b8;--c-primary:#2563eb;--c-primary-soft:#eff6ff;--c-accent:#7c3aed;--c-accent-soft:#f5f3ff;--c-success:#059669;--c-warn:#d97706;--c-danger:#dc2626;--shadow:0 1px 3px rgba(15,23,42,.06),0 1px 2px rgba(15,23,42,.04);--shadow-md:0 4px 12px rgba(15,23,42,.08);--radius:10px;--radius-sm:6px;--nav-h:54px}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:calc(var(--nav-h) + 18px)}body{margin:0;background:var(--c-bg);color:var(--c-text);font:15px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei','PingFang SC',sans-serif;-webkit-font-smoothing:antialiased}.progress-bar{position:fixed;top:0;left:0;height:3px;width:0;background:linear-gradient(90deg,var(--c-primary),var(--c-accent));z-index:1000;transition:width .12s ease-out}.topnav{position:sticky;top:0;z-index:900;height:var(--nav-h);display:flex;align-items:center;gap:12px;padding:0 20px;background:rgba(255,255,255,.92);backdrop-filter:saturate(180%) blur(8px);border-bottom:1px solid var(--c-border);box-shadow:0 1px 2px rgba(15,23,42,.04)}.topnav .brand{font-size:14px;font-weight:700;color:var(--c-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:42vw}.topnav .spacer{flex:1}.topnav .nav-btn{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border:1px solid var(--c-border);border-radius:6px;background:#fff;color:var(--c-text);font-size:13px;cursor:pointer;transition:all .15s}.topnav .nav-btn:hover{border-color:var(--c-primary);color:var(--c-primary);background:var(--c-primary-soft)}.topnav .nav-btn.primary{background:var(--c-primary);border-color:var(--c-primary);color:#fff}.topnav .nav-btn.primary:hover{background:#1d4ed8}.toc-dropdown{position:relative}.toc-menu{position:absolute;top:calc(var(--nav-h) - 6px);right:0;min-width:280px;max-width:380px;max-height:60vh;overflow-y:auto;background:#fff;border:1px solid var(--c-border);border-radius:8px;box-shadow:var(--shadow-md);padding:8px 4px;display:none}.toc-menu.open{display:block}.toc-menu a{display:block;padding:6px 12px;color:var(--c-text);text-decoration:none;font-size:13px;border-radius:4px;cursor:pointer}.toc-menu a:hover{background:var(--c-primary-soft);color:var(--c-primary)}.toc-menu a.lvl-2{padding-left:24px;font-size:12px;color:var(--c-muted)}main{max-width:1060px;margin:0 auto;padding:24px 28px 64px}.cover{background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 60%,#7c3aed 100%);color:#fff;border-radius:16px;padding:40px 36px;box-shadow:var(--shadow-md);margin-bottom:28px}.cover h1{margin:0 0 10px;font-size:28px;line-height:1.3;font-weight:700}.cover .subtitle{margin:0;font-size:14px;opacity:.85}.cover .meta-row{margin-top:18px;display:flex;flex-wrap:wrap;gap:8px}.cover .chip{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.25);border-radius:20px;font-size:12px;font-weight:500}.patent-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 18px;padding:8px;background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius);box-shadow:var(--shadow);position:sticky;top:calc(var(--nav-h) + 8px);z-index:800}.patent-tabs.single{display:none}.patent-tab{padding:6px 14px;border:none;background:transparent;color:var(--c-muted);font-size:13px;font-weight:500;border-radius:6px;cursor:pointer;transition:all .15s;white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis}.patent-tab:hover{background:var(--c-primary-soft);color:var(--c-primary)}.patent-tab.active{background:var(--c-primary);color:#fff}.section-title{display:flex;align-items:center;gap:10px;margin:32px 0 16px;font-size:20px;font-weight:700;color:var(--c-text);cursor:pointer;user-select:none}.section-title .bar{width:4px;height:22px;border-radius:2px;background:linear-gradient(180deg,var(--c-primary),var(--c-accent));flex-shrink:0}.section-title .hint{font-size:13px;font-weight:400;color:var(--c-muted)}.section-title .chevron{margin-left:auto;font-size:14px;color:var(--c-faint);transition:transform .2s}.section-title.collapsed .chevron{transform:rotate(-90deg)}.collapsible-body{overflow:hidden;transition:max-height .3s ease,opacity .2s ease,margin .2s}.collapsible-body.collapsed{max-height:0!important;opacity:0;margin:0!important}.patent-card{background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius);box-shadow:var(--shadow);margin:0 0 22px;overflow:hidden;page-break-inside:avoid}.patent-card.hidden{display:none}.patent-card .pc-header{padding:18px 22px;border-bottom:1px solid var(--c-border-soft);background:linear-gradient(90deg,var(--c-primary-soft),transparent)}.patent-card .pc-header h3{margin:0;font-size:17px;font-weight:700;line-height:1.4}.patent-card .pc-header .pn{display:inline-block;margin-right:8px;padding:2px 10px;background:var(--c-primary);color:#fff;border-radius:4px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:600;vertical-align:middle}.patent-card .pc-body{padding:18px 22px}.field-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px 24px}.field-item{display:flex;flex-direction:column;gap:2px}.field-item .fl{font-size:12px;color:var(--c-muted);font-weight:500}.field-item .fv{font-size:14px;color:var(--c-text);white-space:pre-wrap;overflow-wrap:anywhere}.field-item .fv.empty{color:var(--c-faint);font-style:italic}.field-item .fs{font-size:11px;color:var(--c-faint);margin-top:1px}.full-row{grid-column:1/-1}.tags{display:flex;flex-wrap:wrap;gap:5px}.tag{display:inline-block;padding:2px 9px;background:var(--c-accent-soft);color:var(--c-accent);border:1px solid #ddd6fe;border-radius:4px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.sub-heading{display:flex;align-items:center;gap:6px;margin:22px 0 10px;font-size:15px;font-weight:600;color:var(--c-text);padding-left:10px;border-left:3px solid var(--c-primary);cursor:pointer;user-select:none}.sub-heading .sub-chev{margin-left:auto;font-size:12px;color:var(--c-faint);transition:transform .2s}.sub-heading.collapsed .sub-chev{transform:rotate(-90deg)}.abstract-box{padding:14px 16px;background:var(--c-primary-soft);border-radius:var(--radius-sm);font-size:14px;line-height:1.75;color:var(--c-text);white-space:pre-wrap;overflow-wrap:anywhere}.claim-item{margin:8px 0;padding:11px 14px;background:#f8fafc;border-left:3px solid var(--c-primary);border-radius:0 6px 6px 0;white-space:pre-wrap;font-size:14px;line-height:1.65}.claim-item.independent{border-left-color:var(--c-danger);background:#fef2f2}.claim-item.dependent{border-left-color:var(--c-warn);background:#fffbeb}.claim-num{font-weight:700;margin-right:4px}.claim-type{display:inline-block;margin-right:6px;padding:1px 7px;border-radius:3px;font-size:11px;font-weight:600}.claim-type.independent{background:#fee2e2;color:var(--c-danger)}.claim-type.dependent{background:#fef3c7;color:var(--c-warn)}.claim-refs{margin-top:5px;font-size:12px;color:var(--c-muted)}.claim-refs a{color:var(--c-primary);text-decoration:none}.claim-refs a:hover{text-decoration:underline}.desc-box{margin:8px 0;padding:14px 16px;background:#f8fafc;border:1px solid var(--c-border-soft);border-radius:var(--radius-sm);white-space:pre-wrap;line-height:1.75;max-height:560px;overflow:auto;font-size:13.5px}.figures-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin:8px 0}.figure-card{padding:10px;background:#f8fafc;border:1px solid var(--c-border-soft);border-radius:var(--radius-sm);text-align:center;cursor:zoom-in;transition:transform .15s}.figure-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}.figure-card img{max-width:100%;height:auto;border-radius:4px;box-shadow:var(--shadow)}.figure-card figcaption{margin-top:7px;font-size:12px;color:var(--c-muted)}.lightbox{position:fixed;inset:0;z-index:1200;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.85);padding:32px}.lightbox.open{display:flex}.lightbox img{max-width:92%;max-height:88vh;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.4)}.lightbox .lb-close{position:absolute;top:18px;right:24px;color:#fff;font-size:32px;cursor:pointer;line-height:1}.pf-card{background:var(--c-surface);border:1px solid var(--c-border);border-left:4px solid var(--c-accent);border-radius:var(--radius-sm);padding:14px 16px;margin:0 0 12px;page-break-inside:avoid}.pf-card .pf-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.pf-card .pf-label{font-size:14px;font-weight:600;color:var(--c-text)}.pf-card .pf-badge{font-size:11px;padding:2px 8px;border-radius:10px;font-weight:500}.pf-card .pf-badge.ai{background:var(--c-primary-soft);color:var(--c-primary)}.pf-card .pf-badge.manual{background:#f1f5f9;color:var(--c-muted)}.pf-card .pf-value{font-size:14px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}.pf-card .pf-meta{margin-top:7px;font-size:11px;color:var(--c-faint)}.ai-block{margin:0 0 14px;padding:14px 16px;background:linear-gradient(135deg,var(--c-primary-soft),var(--c-accent-soft));border:1px solid #dbeafe;border-radius:var(--radius-sm)}.ai-block .ai-tag{display:inline-block;margin-bottom:8px;padding:2px 9px;background:var(--c-primary);color:#fff;border-radius:3px;font-size:11px;font-weight:600}.ai-block .ai-meta{margin-top:8px;font-size:11px;color:var(--c-faint)}.tech-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin:10px 0}.tech-card{padding:11px;background:#fff;border:1px solid var(--c-border-soft);border-radius:var(--radius-sm)}.tech-card h5{margin:0 0 6px;font-size:13px;color:var(--c-accent)}.tech-card ul{margin:0;padding-left:17px;font-size:13px;line-height:1.6}.tech-card .role{margin:0 0 5px;font-size:12px;color:var(--c-muted)}.data-table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px}.data-table th{text-align:left;padding:8px 11px;background:#f1f5f9;border-bottom:2px solid #cbd5e1;font-weight:600;color:var(--c-text)}.data-table td{padding:8px 11px;border-bottom:1px solid var(--c-border-soft);vertical-align:top}.data-table tr:last-child td{border-bottom:none}.data-table tr:hover td{background:var(--c-primary-soft)}.compare-table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px;display:block;overflow-x:auto}.compare-table th,.compare-table td{padding:9px 12px;border:1px solid var(--c-border);text-align:left;min-width:110px}.compare-table th{background:#f8fafc;font-weight:600}.toc{padding:14px 18px;background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius-sm);display:none}.notice{padding:12px 16px;background:#fffbeb;border-left:3px solid var(--c-warn);border-radius:0 var(--radius-sm) var(--radius-sm) 0;font-size:14px}.missing{color:var(--c-faint);font-size:13px;font-style:italic}.ocr-excerpt{max-height:340px;overflow:auto;padding:12px;background:#f8fafc;border:1px solid var(--c-border-soft);border-radius:var(--radius-sm);white-space:pre-wrap;font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}.back-to-top{position:fixed;bottom:28px;right:28px;width:44px;height:44px;border-radius:50%;background:var(--c-primary);color:#fff;border:none;font-size:20px;cursor:pointer;box-shadow:var(--shadow-md);opacity:0;transform:translateY(12px);transition:all .2s;z-index:850;display:flex;align-items:center;justify-content:center}.back-to-top.show{opacity:1;transform:translateY(0)}.back-to-top:hover{background:#1d4ed8;transform:translateY(-2px)}.footer{margin-top:40px;padding-top:18px;border-top:1px solid var(--c-border);color:var(--c-muted);font-size:12px;line-height:1.6}.source-line{margin-top:10px;padding-top:8px;border-top:1px dashed var(--c-border-soft);font-size:11px;color:var(--c-faint)}.back-cite{color:var(--c-success);font-weight:600}.forward-cite{color:var(--c-danger);font-weight:600}@media(max-width:720px){main{padding:20px 16px 56px}.cover{padding:28px 22px}.cover h1{font-size:22px}.field-grid{grid-template-columns:1fr}.figures-grid{grid-template-columns:1fr}.topnav{padding:0 14px;gap:8px}.topnav .brand{max-width:30vw}.patent-tabs{top:calc(var(--nav-h) + 6px);padding:6px}.patent-tab{max-width:160px}}@media print{body{background:#fff}.topnav,.back-to-top,.patent-tabs,.progress-bar,.lightbox{display:none!important}.collapsible-body.collapsed{max-height:none!important;opacity:1!important;margin:initial!important}.patent-card.hidden{display:block!important}.section-title,.sub-heading{cursor:default}.patent-card,.pf-card{box-shadow:none;break-inside:avoid}.cover{box-shadow:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}}";

  var JS = "(function(){'use strict';var progressBar=document.querySelector('.progress-bar');var backTop=document.querySelector('.back-to-top');var topnavBrand=document.querySelector('.topnav .brand');function onScroll(){var st=document.documentElement.scrollTop||document.body.scrollTop;var sh=(document.documentElement.scrollHeight||document.body.scrollHeight)-document.documentElement.clientHeight;if(progressBar&&sh>0)progressBar.style.width=Math.min(100,Math.round(st/sh*100))+'%';if(backTop)backTop.classList.toggle('show',st>400);}window.addEventListener('scroll',onScroll,{passive:true});onScroll();if(backTop)backTop.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});});var tocBtn=document.querySelector('[data-toc-toggle]');var tocMenu=document.querySelector('.toc-menu');if(tocBtn&&tocMenu){tocBtn.addEventListener('click',function(e){e.stopPropagation();tocMenu.classList.toggle('open');});document.addEventListener('click',function(e){if(!tocMenu.contains(e.target)&&e.target!==tocBtn)tocMenu.classList.remove('open');});}document.querySelectorAll('.section-title[data-collapse]').forEach(function(t){t.addEventListener('click',function(){var body=t.nextElementSibling;if(!body||!body.classList.contains('collapsible-body'))return;t.classList.toggle('collapsed');body.classList.toggle('collapsed');if(!body.classList.contains('collapsed')){body.style.maxHeight='none';}else{body.style.maxHeight='0px';}});});document.querySelectorAll('.sub-heading[data-collapse]').forEach(function(t){t.addEventListener('click',function(){var body=t.nextElementSibling;if(!body)return;t.classList.toggle('collapsed');if(t.classList.contains('collapsed')){body.dataset.origMax=body.style.maxHeight;body.style.maxHeight='0px';body.style.overflow='hidden';}else{body.style.maxHeight='none';body.style.overflow='';}});});var tabs=document.querySelectorAll('.patent-tab');var cards=document.querySelectorAll('.patent-card[data-patent-index]');tabs.forEach(function(tab){tab.addEventListener('click',function(){tabs.forEach(function(t){t.classList.remove('active');});tab.classList.add('active');var idx=tab.dataset.patentIndex;cards.forEach(function(c){c.classList.toggle('hidden',c.dataset.patentIndex!==idx);});if(tocMenu)tocMenu.classList.remove('open');window.scrollTo({top:document.querySelector('.patent-tabs').offsetTop-70,behavior:'smooth'});});});document.querySelectorAll('.figure-card img').forEach(function(img){img.parentElement.addEventListener('click',function(){var lb=document.querySelector('.lightbox');if(!lb)return;lb.querySelector('img').src=img.src;lb.classList.add('open');});});var lb=document.querySelector('.lightbox');if(lb){lb.addEventListener('click',function(){lb.classList.remove('open');});document.addEventListener('keydown',function(e){if(e.key==='Escape')lb.classList.remove('open');});}document.querySelectorAll('.toc-menu a[data-target]').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();var el=document.querySelector(a.dataset.target);if(el){el.scrollIntoView({behavior:'smooth',block:'start'});if(tocMenu)tocMenu.classList.remove('open');}});});})();";

  function cleanText(value) { return typeof value === "string" ? value.trim() : ""; }
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }
  function escapeJson(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  function field(record, name) { return record.fields && record.fields[name] && cleanText(record.fields[name].value) ? record.fields[name] : null; }
  function moduleEnabled(config, id) { return config.modules[id] && config.modules[id] !== "off"; }
  function moduleMode(config, id) { return config.modules[id] || "off"; }
  function moduleHeading(id, label, hint, collapsible) {
    var hintHtml = hint ? '<span class="hint">' + escapeHtml(hint) + '</span>' : '';
    var chev = collapsible !== false ? '<span class="chevron">▾</span>' : '';
    var collapseAttr = collapsible !== false ? ' data-collapse="1"' : '';
    return '<h2 class="section-title" id="module-' + escapeHtml(id) + '"' + collapseAttr + '><span class="bar"></span>' + escapeHtml(label) + hintHtml + chev + '</h2>';
  }
  function collapsibleOpen() { return '<div class="collapsible-body">'; }
  function collapsibleClose() { return '</div>'; }
  function subHeading(label, collapsible) {
    var chev = collapsible !== false ? '<span class="sub-chev">▾</span>' : '';
    var collapseAttr = collapsible !== false ? ' data-collapse="1"' : '';
    return '<div class="sub-heading"' + collapseAttr + '>' + escapeHtml(label) + chev + '</div>';
  }

  function renderMarkdownSimple(text) {
    if (!text) return "";
    var html = escapeHtml(text);
    html = html.replace(/^### (.*$)/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.*$)/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.*$)/gm, '<h3>$1</h3>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p><(h[34]|ul|ol|li)/g, '<$1');
    html = html.replace(/<\/(h[34]|ul|ol|li|table)><\/p>/g, '</$1>');
    html = html.replace(/<p><table/g, '<table');
    html = html.replace(/<\/table><\/p>/g, '</table>');
    return html;
  }

  function scanSensitive(project, html) {
    var text = String(html || "") + "\n" + JSON.stringify(project || {});
    var findings = [];
    if (/["']?(?:api[_-]?key|access[_-]?token|token|secret|cookie)["']?\s*[:=]/i.test(text)) findings.push("可能包含密钥、Token 或 Cookie 字段");
    if (/https?:\/\/127\.0\.0\.1(?::\d+)?|https?:\/\/localhost(?::\d+)?|127\.0\.0\.1:\d+/i.test(text)) findings.push("可能包含本机代理或本地服务地址");
    if (/[A-Z]:\\[^\n"<>]+|\/(?:Users|home|private|var)\/[^\n"<>]+/i.test(text)) findings.push("可能包含绝对本机路径");
    return findings;
  }

  function findPendingConflicts(project) {
    var conflicts = [];
    (project && Array.isArray(project.patents) ? project.patents : []).forEach(function (record) {
      Object.keys(record.fields && typeof record.fields === "object" ? record.fields : {}).forEach(function (fieldName) {
        var field = record.fields[fieldName];
        if (field && field.reviewState === "conflict") conflicts.push({ patentNumber: record.patentNumber, fieldName: fieldName });
      });
      Object.keys(record.customFields && typeof record.customFields === "object" ? record.customFields : {}).forEach(function (key) {
        var custom = record.customFields[key];
        if (custom && custom.field && custom.field.reviewState === "conflict") conflicts.push({ patentNumber: record.patentNumber, fieldName: custom.label || key });
      });
    });
    return conflicts;
  }

  function fieldValueHtml(record, name, label, fullRow) {
    var item = field(record, name);
    var rowClass = fullRow ? " field-item full-row" : " field-item";
    if (!item) return '<div class="' + rowClass.trim() + '"><span class="fl">' + escapeHtml(label) + '</span><span class="fv empty">来源未提供</span></div>';
    var state = item.reviewState === "conflict" ? " · 待确认冲突" : "";
    return '<div class="' + rowClass.trim() + '"><span class="fl">' + escapeHtml(label) + '</span><span class="fv">' + escapeHtml(item.value) + '</span><span class="fs">' + escapeHtml(item.source || "unknown") + escapeHtml(state) + '</span></div>';
  }

  function renderClaims(claims, config) {
    if (!claims || !claims.length) return '<p class="missing">来源未提供权利要求</p>';
    var items = claims;
    var mode = moduleMode(config, "S4");
    if (mode === "lite") {
      var independent = claims.filter(function (c) { return c.type === "independent"; });
      items = independent.length ? independent.slice(0, 3) : claims.slice(0, 1);
    }
    var html = '';
    items.forEach(function (claim) {
      var typeClass = claim.type === "independent" ? "independent" : (claim.type === "dependent" ? "dependent" : "");
      var claimId = 'claim-' + (claim.number || "").replace(/\D/g, "");
      html += '<div class="claim-item ' + typeClass + '" id="' + claimId + '">';
      if (claim.type === "independent") html += '<span class="claim-type independent">独立</span>';
      else if (claim.type === "dependent") html += '<span class="claim-type dependent">从属</span>';
      html += '<span class="claim-num">' + escapeHtml(claim.number || "") + '.</span> ';
      html += escapeHtml(claim.text || "");
      if (claim.references && claim.references.length) {
        html += '<div class="claim-refs">引用权项：';
        html += claim.references.map(function (ref) {
          return '<a href="#claim-' + escapeHtml(String(ref).replace(/\D/g, "")) + '">' + escapeHtml(ref) + '</a>';
        }).join(", ");
        html += '</div>';
      }
      html += '</div>';
    });
    if (mode === "lite" && claims.length > items.length) {
      html += '<p class="missing">（精简模式：仅展示前 ' + items.length + ' 项，共 ' + claims.length + ' 项权利要求）</p>';
    }
    return html;
  }

  function renderDescription(description, mode) {
    if (!description) return '<p class="missing">来源未提供说明书内容</p>';
    var text = description;
    if (mode === "lite" && text.length > 3000) text = text.slice(0, 3000) + "\n\n...（内容过长，已截断。完整模式展示全部内容）";
    return '<div class="desc-box">' + escapeHtml(text) + '</div>';
  }

  function renderFigures(figures, mode) {
    if (!figures || !figures.length) return '<p class="missing">尚未上传附图。可在「数据审核」中为该专利添加图片。</p>';
    var items = mode === "lite" ? figures.slice(0, 5) : figures;
    var html = '<div class="figures-grid">';
    items.forEach(function (fig) {
      html += '<figure class="figure-card">';
      html += '<img src="' + fig.dataUrl + '" alt="' + escapeHtml(fig.caption || "附图") + '"' + (fig.width ? ' style="max-width:' + fig.width + 'px"' : '') + ' />';
      if (fig.caption) html += '<figcaption>' + escapeHtml(fig.caption) + '</figcaption>';
      html += '</figure>';
    });
    html += '</div>';
    if (mode === "lite" && figures.length > 5) html += '<p class="missing">（精简模式仅展示前5张，共' + figures.length + '张附图）</p>';
    return html;
  }

  function renderProcessedFields(patent, mode) {
    var fields = Array.isArray(patent.processedFields) ? patent.processedFields : [];
    if (!fields.length) return '<p class="missing">尚未添加加工字段。可在「数据审核」中添加预设或自定义加工字段，支持AI抽取或手工录入。</p>';
    var html = '';
    fields.forEach(function (f) {
      if (!f.value) return;
      var isAI = f.source === "ai";
      var badge = isAI ? '<span class="pf-badge ai">AI 抽取</span>' : '<span class="pf-badge manual">手工录入</span>';
      html += '<div class="pf-card">';
      html += '<div class="pf-head"><span class="pf-label">' + escapeHtml(f.label) + '</span>' + badge + '</div>';
      var value = f.value;
      if (mode === "lite" && value.length > 800) value = value.slice(0, 800) + "...（精简模式已截断）";
      html += '<div class="pf-value">' + renderMarkdownSimple(value) + '</div>';
      if (isAI && f.model) html += '<div class="pf-meta">模型：' + escapeHtml(f.model) + ' · 生成于 ' + escapeHtml(f.generatedAt ? f.generatedAt.slice(0, 10) : "") + '</div>';
      html += '</div>';
    });
    return html;
  }

  function renderAISummary(patent, researchSummary, aiAnalysis, mode) {
    var hasSummary = researchSummary && (researchSummary.problem || researchSummary.approach || researchSummary.effect || researchSummary.openQuestions);
    var ai = aiAnalysis && aiAnalysis.summary;
    var html = '';
    if (ai && ai.content) {
      html += '<div class="ai-block">';
      html += '<span class="ai-tag">AI 生成</span>';
      var content = ai.content;
      if (mode === "lite" && content.length > 2000) content = content.slice(0, 2000) + "\n\n...（精简模式已截断）";
      html += renderMarkdownSimple(content);
      html += '<div class="ai-meta">模型：' + escapeHtml(ai.model || "unknown") + ' · 生成时间：' + escapeHtml(ai.generatedAt || "") + '</div>';
      html += '</div>';
    }
    if (hasSummary) {
      [["技术问题", researchSummary.problem], ["技术手段", researchSummary.approach], ["技术效果", researchSummary.effect], ["待验证问题", researchSummary.openQuestions]].forEach(function (item) {
        var text = cleanText(item[1]);
        if (text) {
          var display = mode === "lite" && text.length > 500 ? text.slice(0, 500) + "..." : text;
          html += '<div class="field-item full-row"><span class="fl">' + escapeHtml(item[0]) + '</span><span class="fv">' + escapeHtml(display) + '</span></div>';
        }
      });
    }
    if (!html) html += '<p class="missing">尚未生成或填写研发分析内容。可在「数据审核」中添加加工字段或运行AI抽取。</p>';
    return html;
  }

  function renderTechElements(analysis, mode) {
    if (!analysis || !analysis.parsed) {
      if (analysis && analysis.content) return '<div class="ai-block"><span class="ai-tag">AI 生成</span>' + renderMarkdownSimple(analysis.content) + '</div>';
      return '<p class="missing">尚未生成技术要素分析。可在「数据审核」中运行AI提取。</p>';
    }
    var data = analysis.parsed;
    var html = '<div class="ai-block"><span class="ai-tag">AI 提取</span>';
    if (data.components && data.components.length) {
      html += '<div class="tech-grid">';
      data.components.forEach(function (comp) {
        html += '<div class="tech-card"><h5>' + escapeHtml(comp.name || "未命名") + '</h5>';
        if (comp.role) html += '<p class="role">' + escapeHtml(comp.role) + '</p>';
        if (comp.keyFeatures && comp.keyFeatures.length) {
          html += '<ul>' + comp.keyFeatures.map(function (f) { return '<li>' + escapeHtml(f) + '</li>'; }).join("") + '</ul>';
        }
        html += '</div>';
      });
      html += '</div>';
    }
    if (data.steps && data.steps.length && mode !== "lite") {
      html += '<h4 style="margin:14px 0 6px;font-size:14px">方法步骤</h4><ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.7">';
      data.steps.forEach(function (step) {
        html += '<li><strong>' + escapeHtml(step.action || "") + '</strong>';
        if (step.input || step.output) {
          html += ' <span style="color:var(--c-muted);font-size:12px">(';
          if (step.input) html += '输入: ' + escapeHtml(step.input);
          if (step.input && step.output) html += ' → ';
          if (step.output) html += '输出: ' + escapeHtml(step.output);
          html += ')</span>';
        }
        html += '</li>';
      });
      html += '</ol>';
    }
    if (data.parameters && data.parameters.length) {
      html += '<table class="data-table" style="margin-top:10px"><tr><th>参数</th><th>范围/取值</th><th>单位</th><th>作用</th></tr>';
      data.parameters.forEach(function (p) {
        html += '<tr><td>' + escapeHtml(p.name || "") + '</td><td>' + escapeHtml(p.range || "") + '</td><td>' + escapeHtml(p.unit || "") + '</td><td>' + escapeHtml(p.effect || "") + '</td></tr>';
      });
      html += '</table>';
    }
    html += '<div class="ai-meta">模型：' + escapeHtml(analysis.model || "unknown") + ' · 生成时间：' + escapeHtml(analysis.generatedAt || "") + '</div></div>';
    return html;
  }

  function renderCitations(citations, mode) {
    if (!citations || !citations.length) return '<p class="missing">来源未提供引证文献信息</p>';
    var back = citations.filter(function (c) { return c.type !== "forward"; });
    var forward = citations.filter(function (c) { return c.type === "forward"; });
    var html = '';
    if (back.length) {
      html += '<h4 style="margin:14px 0 6px;font-size:14px">后向引证文献（本专利引用的先前文献）<span class="back-cite">(' + back.length + ')</span></h4>';
      html += '<table class="data-table"><tr><th>专利号</th><th>标题</th><th>申请人</th><th>公开日</th></tr>';
      var backItems = mode === "lite" ? back.slice(0, 10) : back;
      backItems.forEach(function (c) {
        html += '<tr><td><strong>' + escapeHtml(c.number || "") + '</strong></td><td>' + escapeHtml(c.title || "") + '</td><td>' + escapeHtml(c.assignee || "") + '</td><td>' + escapeHtml(c.date || "") + '</td></tr>';
      });
      html += '</table>';
      if (mode === "lite" && back.length > 10) html += '<p class="missing">（精简模式仅显示前10项，共' + back.length + '项）</p>';
    }
    if (forward.length && mode !== "lite") {
      html += '<h4 style="margin:14px 0 6px;font-size:14px">前向引证文献（引用本专利的后续文献）<span class="forward-cite">(' + forward.length + ')</span></h4>';
      html += '<table class="data-table"><tr><th>专利号</th><th>标题</th><th>申请人</th><th>公开日</th></tr>';
      forward.forEach(function (c) {
        html += '<tr><td><strong>' + escapeHtml(c.number || "") + '</strong></td><td>' + escapeHtml(c.title || "") + '</td><td>' + escapeHtml(c.assignee || "") + '</td><td>' + escapeHtml(c.date || "") + '</td></tr>';
      });
      html += '</table>';
    }
    return html;
  }

  function renderFamily(family, mode) {
    if (!family || !family.length) return '<p class="missing">来源未提供同族专利信息</p>';
    var html = '<table class="data-table"><tr><th>国家/地区</th><th>公开号</th><th>标题</th><th>公开日</th></tr>';
    var items = mode === "lite" ? family.slice(0, 10) : family;
    items.forEach(function (m) {
      html += '<tr><td>' + escapeHtml(m.country || "") + '</td><td><strong>' + escapeHtml(m.number || "") + '</strong></td><td>' + escapeHtml(m.title || "") + '</td><td>' + escapeHtml(m.date || "") + '</td></tr>';
    });
    html += '</table>';
    if (mode === "lite" && family.length > 10) html += '<p class="missing">（精简模式仅显示前10项，共' + family.length + '项同族）</p>';
    return html;
  }

  function renderMultiPatentComparison(project, aiAnalysis, mode) {
    var comp = aiAnalysis && aiAnalysis.comparison;
    if (comp && comp.content) {
      var content = comp.content;
      if (mode === "lite" && content.length > 3000) content = content.slice(0, 3000) + "\n\n...（精简模式已截断）";
      return '<div class="ai-block"><span class="ai-tag">AI 多专利对比</span>' + renderMarkdownSimple(content) + '<div class="ai-meta">模型：' + escapeHtml(comp.model || "unknown") + ' · 涉及专利：' + (comp.patentIds ? comp.patentIds.length : project.patents.length) + ' 篇</div></div>';
    }
    if (project.patents.length < 2) return '<p class="missing">需要至少2篇专利才能生成技术路线对比。</p>';
    var html = '<div style="overflow-x:auto"><table class="compare-table"><tr><th>维度</th>';
    project.patents.forEach(function (p) { html += '<th>' + escapeHtml(p.patentNumber) + '</th>'; });
    html += '</tr>';
    [["标题", "title", null], ["技术问题", "problem", "技术问题"], ["申请人", "assignee", null], ["公开日", "publicationDate", null]].forEach(function (row) {
      html += '<tr><td><strong>' + escapeHtml(row[0]) + '</strong></td>';
      project.patents.forEach(function (p) {
        var val = "";
        if (row[1] === "title") val = p.title || "";
        else if (row[1] === "assignee" && p.fields && p.fields.assignees) val = p.fields.assignees.value || "";
        else if (row[1] === "publicationDate" && p.fields && p.fields.publicationDate) val = p.fields.publicationDate.value || "";
        else if (row[2] && p.aiAnalysis && p.aiAnalysis.summary && p.aiAnalysis.summary.content) {
          var match = p.aiAnalysis.summary.content.match(new RegExp("##\\s*" + row[2] + "[\\s\\S]*?\\n([\\s\\S]*?)(?=\\n##|$)", "i"));
          if (match) val = match[1].slice(0, 200);
        }
        html += '<td>' + escapeHtml(val || "未提供") + '</td>';
      });
      html += '</tr>';
    });
    html += '</table></div>';
    html += '<p class="ai-meta" style="margin-top:8px">基础对比（基于现有数据）。可在「数据审核」中运行AI生成深度对比分析。</p>';
    return html;
  }

  function renderPatent(record, config, index) {
    var html = '<article class="patent-card" id="patent-' + index + '" data-patent-index="' + index + '">';
    html += '<div class="pc-header"><h3 id="patent-heading-' + index + '"><span class="pn">' + escapeHtml(record.patentNumber) + '</span>' + escapeHtml(record.title || "未提供标题") + '</h3></div>';
    html += '<div class="pc-body">';
    // 基础信息
    if (moduleEnabled(config, "S2")) {
      html += '<div class="field-grid">';
      html += fieldValueHtml(record, "title", "标题");
      if (record.classifications && record.classifications.length) {
        html += '<div class="field-item"><span class="fl">IPC/CPC 分类</span><div class="tags">';
        html += record.classifications.map(function (c) { return '<span class="tag">' + escapeHtml(c) + '</span>'; }).join(" ");
        html += '</div></div>';
      }
      html += fieldValueHtml(record, "publicationDate", "公开日");
      html += fieldValueHtml(record, "assignees", "申请人");
      if (moduleMode(config, "S2") === "full") {
        html += fieldValueHtml(record, "applicationDate", "申请日");
        html += fieldValueHtml(record, "priorityDate", "优先权日");
        html += fieldValueHtml(record, "inventors", "发明人");
        Object.keys(record.customFields && typeof record.customFields === "object" ? record.customFields : {}).forEach(function (key) {
          var custom = record.customFields[key];
          if (custom && custom.field) {
            var val = cleanText(custom.field.value);
            html += '<div class="field-item"><span class="fl">' + escapeHtml(custom.label || key) + '</span><span class="fv' + (val ? '' : ' empty') + '">' + escapeHtml(val || "来源未提供") + '</span><span class="fs">' + escapeHtml(custom.field.source || "unknown") + '</span></div>';
          }
        });
      }
      html += '</div>';
    }
    if (moduleEnabled(config, "S3")) {
      var abstractField = field(record, "abstract");
      var abstract = abstractField && abstractField.value;
      if (abstract && moduleMode(config, "S3") === "lite" && abstract.length > 360) abstract = abstract.slice(0, 360) + "…";
      html += subHeading("技术摘要");
      html += collapsibleOpen() + (abstract ? '<div class="abstract-box">' + escapeHtml(abstract) + '</div>' : '<p class="missing">来源未提供摘要</p>') + collapsibleClose();
    }
    if (moduleEnabled(config, "S4")) {
      html += subHeading("权利要求书");
      html += collapsibleOpen() + renderClaims(record.claims, config) + collapsibleClose();
    }
    if (moduleEnabled(config, "S5")) {
      html += subHeading("说明书");
      html += collapsibleOpen() + renderDescription(record.description, moduleMode(config, "S5")) + collapsibleClose();
    }
    if (moduleEnabled(config, "S7")) {
      html += subHeading("附图");
      html += collapsibleOpen() + renderFigures(record.figures, moduleMode(config, "S7")) + collapsibleClose();
    }
    // 加工信息
    var hasProcessed = (record.processedFields && record.processedFields.length) ||
      (moduleEnabled(config, "R1") && record.aiAnalysis && record.aiAnalysis.summary) ||
      moduleEnabled(config, "R2") || moduleEnabled(config, "R3") || moduleEnabled(config, "R4") ||
      moduleEnabled(config, "R8") || moduleEnabled(config, "R9") || moduleEnabled(config, "R7");
    if (hasProcessed) {
      html += '<h2 class="section-title" style="font-size:16px;margin-top:24px" data-collapse="1"><span class="bar" style="background:var(--c-accent)"></span>加工信息<span class="chevron">▾</span></h2>';
      html += collapsibleOpen();
    }
    if (record.processedFields && record.processedFields.length) {
      html += renderProcessedFields(record, "full");
    }
    if (moduleEnabled(config, "R1") && record.aiAnalysis && record.aiAnalysis.summary) {
      html += subHeading("技术问题-方案-效果");
      html += collapsibleOpen() + renderAISummary(record, null, record.aiAnalysis || {}, moduleMode(config, "R1")) + collapsibleClose();
    }
    if (moduleEnabled(config, "R2")) {
      html += subHeading("技术要素与系统结构");
      html += collapsibleOpen() + renderTechElements(record.aiAnalysis && record.aiAnalysis.elements, moduleMode(config, "R2")) + collapsibleClose();
    }
    if (moduleEnabled(config, "R3")) {
      html += subHeading("关键参数与边界条件");
      var elementsForParams = record.aiAnalysis && record.aiAnalysis.elements;
      if (elementsForParams && elementsForParams.parsed && elementsForParams.parsed.parameters && elementsForParams.parsed.parameters.length) {
        html += collapsibleOpen() + '<table class="data-table"><tr><th>参数</th><th>范围/取值</th><th>单位</th><th>作用</th></tr>';
        elementsForParams.parsed.parameters.forEach(function (p) {
          html += '<tr><td>' + escapeHtml(p.name || "") + '</td><td>' + escapeHtml(p.range || "") + '</td><td>' + escapeHtml(p.unit || "") + '</td><td>' + escapeHtml(p.effect || "") + '</td></tr>';
        });
        html += '</table><div class="ai-meta">来源：技术要素AI提取</div>' + collapsibleClose();
      } else {
        html += collapsibleOpen() + '<p class="missing">请先运行AI技术要素提取，关键参数将自动归纳。</p>' + collapsibleClose();
      }
    }
    if (moduleEnabled(config, "R4")) {
      html += subHeading("实施例与验证证据");
      if (record.aiAnalysis && record.aiAnalysis.embodiments && record.aiAnalysis.embodiments.content) {
        var emb = record.aiAnalysis.embodiments;
        var embContent = emb.content;
        if (moduleMode(config, "R4") === "lite" && embContent.length > 2000) embContent = embContent.slice(0, 2000) + "\n\n...（内容过长，已截断）";
        html += collapsibleOpen() + '<div class="ai-block"><span class="ai-tag">AI</span>' + renderMarkdownSimple(embContent) + '<div class="ai-meta">' + escapeHtml(emb.model || "AI") + ' · ' + escapeHtml(emb.generatedAt ? emb.generatedAt.slice(0, 10) : "") + '</div></div>' + collapsibleClose();
      } else {
        html += collapsibleOpen() + '<p class="missing">尚未生成实施例分析。请运行R4实施例分析（需要已导入说明书）。</p>' + collapsibleClose();
      }
    }
    if (moduleEnabled(config, "R8")) {
      html += subHeading("引证文献");
      html += collapsibleOpen() + renderCitations(record.citations, moduleMode(config, "R8")) + collapsibleClose();
    }
    if (moduleEnabled(config, "R9")) {
      html += subHeading("同族与地域布局");
      html += collapsibleOpen() + renderFamily(record.family, moduleMode(config, "R9")) + collapsibleClose();
    }
    if (moduleEnabled(config, "R7")) {
      html += subHeading("PDF OCR 原文摘录");
      var ocrSources = Array.isArray(record.ocrSources) ? record.ocrSources : [];
      var ocrHtml = '';
      if (ocrSources.length) ocrSources.forEach(function (source) {
        var excerpt = source.text || source.markdown || "";
        if (moduleMode(config, "R7") === "lite" && excerpt.length > 4000) excerpt = excerpt.slice(0, 4000) + "…";
        ocrHtml += '<div class="ai-meta">' + escapeHtml(source.fileName || "PDF") + ' · ' + escapeHtml(source.engine || "OCR") + '</div><pre class="ocr-excerpt">' + escapeHtml(excerpt) + '</pre>';
      });
      else ocrHtml = '<p class="missing">尚未关联 PDF OCR 材料</p>';
      html += collapsibleOpen() + ocrHtml + collapsibleClose();
    }
    if (hasProcessed) {
      html += collapsibleClose();
    }
    if (moduleEnabled(config, "S6")) {
      var source = record.source || {};
      html += '<div class="source-line">来源：' + escapeHtml(source.label || source.type || "未标记") + ' · 抓取时间：' + escapeHtml(source.capturedAt || "未记录") + '</div>';
    }
    html += '</div></article>';
    return html;
  }

  function render(project) {
    var input = project && typeof project === "object" ? project : { name: "未命名分享项目", patents: [], sources: [], moduleConfig: {}, aiAnalysis: {} };
    var modules = window.PatentShareModules;
    var config = modules ? modules.resolveConfig(input.moduleConfig) : { modules: { S1: "full", S2: "full", S3: "full", S4: "lite", S6: "full", R1: "full", R6: "full" } };
    var patents = Array.isArray(input.patents) ? input.patents : [];
    var generatedAt = new Date().toISOString();
    var projectName = input.name || "未命名分享项目";
    // 构建 TOC 条目
    var tocItems = [];
    if (moduleEnabled(config, "R5") && patents.length >= 2) tocItems.push({ id: "#module-R5", label: "多专利对比", lvl: 1 });
    if (moduleEnabled(config, "R1")) {
      var research = input.researchSummary && typeof input.researchSummary === "object" ? input.researchSummary : {};
      if (research.problem || research.approach || research.effect || research.openQuestions) tocItems.push({ id: "#module-R1", label: "技术问题-方案-效果", lvl: 1 });
    }
    if (moduleEnabled(config, "R6") && input.researchSummary && input.researchSummary.openQuestions) tocItems.push({ id: "#module-R6", label: "研发启发与待验证", lvl: 1 });
    patents.forEach(function (record, index) {
      tocItems.push({ id: "#patent-" + index, label: record.patentNumber + " · " + (record.title || "未提供标题"), lvl: 1 });
    });
    var html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml(projectName) + '</title><style>' + CSS + '</style></head><body>';
    html += '<div class="progress-bar"></div>';
    html += '<nav class="topnav"><span class="brand">' + escapeHtml(projectName) + '</span><span class="spacer"></span>';
    if (tocItems.length) {
      html += '<div class="toc-dropdown"><button class="nav-btn" data-toc-toggle="1">目录 ▾</button><div class="toc-menu">';
      tocItems.forEach(function (item) {
        html += '<a data-target="' + escapeHtml(item.id) + '" class="' + (item.lvl === 2 ? 'lvl-2' : '') + '">' + escapeHtml(item.label) + '</a>';
      });
      html += '</div></div>';
    }
    html += '<button class="nav-btn" onclick="window.print()">打印 / 导出PDF</button>';
    html += '</nav>';
    html += '<main>';
    if (moduleEnabled(config, "S1")) {
      html += '<header class="cover"><h1>' + escapeHtml(projectName) + '</h1>';
      html += '<p class="subtitle">专利技术分享报告</p>';
      html += '<div class="meta-row">';
      html += '<span class="chip">' + patents.length + ' 篇专利</span>';
      html += '<span class="chip">生成于 ' + escapeHtml(generatedAt.slice(0, 10)) + '</span>';
      html += '</div></header>';
    }
    if (moduleEnabled(config, "R5") && patents.length >= 2) {
      html += moduleHeading("R5", "多专利对比");
      html += collapsibleOpen() + renderMultiPatentComparison(input, input.aiAnalysis, moduleMode(config, "R5")) + collapsibleClose();
    }
    if (moduleEnabled(config, "R1")) {
      var researchR1 = input.researchSummary && typeof input.researchSummary === "object" ? input.researchSummary : {};
      if (researchR1.problem || researchR1.approach || researchR1.effect || researchR1.openQuestions) {
        html += moduleHeading("R1", "技术问题-方案-效果");
        html += collapsibleOpen();
        [["技术问题", researchR1.problem], ["技术手段", researchR1.approach], ["技术效果", researchR1.effect], ["待验证问题", researchR1.openQuestions]].forEach(function (item) {
          var text = cleanText(item[1]);
          if (text && moduleMode(config, "R1") === "lite" && text.length > 800) text = text.slice(0, 800) + "…";
          if (text) html += '<div class="field-item full-row" style="margin:6px 0"><span class="fl">' + escapeHtml(item[0]) + '</span><span class="fv">' + escapeHtml(text) + '</span></div>';
        });
        html += collapsibleClose();
      }
    }
    if (moduleEnabled(config, "R6")) {
      var researchR6 = input.researchSummary || {};
      if (researchR6.openQuestions) {
        html += moduleHeading("R6", "研发启发与待验证问题");
        html += collapsibleOpen() + '<div class="ai-block"><div class="field-item full-row"><span class="fl">待验证问题</span><span class="fv">' + escapeHtml(researchR6.openQuestions) + '</span></div></div>' + collapsibleClose();
      }
    }
    if (!patents.length) html += '<p class="notice">当前项目没有可分享的专利材料。</p>';
    if (patents.length) {
      // 多专利时显示标签页切换栏
      if (patents.length > 1) {
        html += '<div class="patent-tabs">';
        patents.forEach(function (record, index) {
          html += '<button class="patent-tab' + (index === 0 ? ' active' : '') + '" data-patent-index="' + index + '" title="' + escapeHtml(record.title || "") + '">' + escapeHtml(record.patentNumber) + '</button>';
        });
        html += '</div>';
      }
      html += '<h2 class="section-title" id="module-S2"><span class="bar"></span>专利资料<span class="hint">从来源提取，可人工校核</span></h2>';
      patents.forEach(function (record, index) { html += renderPatent(record, config, index); });
    }
    if (moduleEnabled(config, "S6")) html += '<footer class="footer">来源内容来自项目快照；仅供技术沟通，不构成法律意见。AI 生成内容已标注，请人工核验关键信息后再分享。</footer>';
    html += '</main>';
    html += '<button class="back-to-top" title="返回顶部" aria-label="返回顶部">↑</button>';
    html += '<div class="lightbox"><span class="lb-close">×</span><img alt="附图预览" /></div>';
    html += '<script>' + JS + '<\/script>';
    html += '</body></html>';
    var findings = scanSensitive(input, html);
    var conflicts = findPendingConflicts(input);
    if (conflicts.length) findings.push("存在 " + conflicts.length + " 个未确认字段冲突");
    return { html: html, config: config, findings: findings, size: html.length };
  }

  window.PatentShareRenderer = { render: render, scanSensitive: scanSensitive, findPendingConflicts: findPendingConflicts, escapeHtml: escapeHtml, escapeJson: escapeJson, renderMarkdownSimple: renderMarkdownSimple };
})();
