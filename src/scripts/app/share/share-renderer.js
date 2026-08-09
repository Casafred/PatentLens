/*!
 * PatentLens - 专利分享离线 HTML 渲染器
 *
 * 输入为项目快照和声明式模块配置，输出不依赖网络的 HTML。所有外部文本
 * 先转义；该模块不执行用户 HTML 或用户脚本。
 *
 * 布局：左侧分栏（专利列表导航）+ 右侧三大标签页（基础信息 / 原文信息 / 加工信息）。
 * 基础信息只含著录项与摘要；原文信息含权利要求、说明书、附图，权利要求与说明书
 * 支持原文/中文翻译双栏对照；加工信息含 AI 抽取或手工录入的字段。
 * 配色为绿色系，与主应用主题一致；不输出 "Google Patents" 字样。
 */
(function () {
  "use strict";

  var CSS = ":root{--c-bg:#f3f8f4;--c-surface:#ffffff;--c-border:#d6e8dc;--c-border-soft:#e8f1ec;--c-text:#14211a;--c-muted:#4a6355;--c-faint:#7a9486;--c-primary:#16a34a;--c-primary-hover:#15803d;--c-primary-soft:#e8f5ed;--c-accent:#059669;--c-accent-soft:#d1fae5;--c-success:#10b981;--c-warn:#d97706;--c-danger:#dc2626;--shadow:0 1px 3px rgba(20,33,26,.06),0 1px 2px rgba(20,33,26,.04);--shadow-md:0 4px 12px rgba(20,33,26,.08);--radius:10px;--radius-sm:6px;--nav-h:52px;--sidebar-w:248px}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--c-bg);color:var(--c-text);font:15px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei','PingFang SC',sans-serif;-webkit-font-smoothing:antialiased}.progress-bar{position:fixed;top:0;left:0;height:3px;width:0;background:linear-gradient(90deg,var(--c-primary),var(--c-accent));z-index:1000;transition:width .12s ease-out}.topnav{position:sticky;top:0;z-index:900;height:var(--nav-h);display:flex;align-items:center;gap:12px;padding:0 20px;background:rgba(255,255,255,.92);backdrop-filter:saturate(180%) blur(8px);border-bottom:1px solid var(--c-border);box-shadow:0 1px 2px rgba(20,33,26,.04)}.topnav .brand{font-size:14px;font-weight:700;color:var(--c-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:50vw}.topnav .spacer{flex:1}.topnav .nav-btn{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border:1px solid var(--c-border);border-radius:6px;background:#fff;color:var(--c-text);font-size:13px;cursor:pointer;transition:all .15s}.topnav .nav-btn:hover{border-color:var(--c-primary);color:var(--c-primary);background:var(--c-primary-soft)}.layout{display:flex;align-items:flex-start;max-width:1440px;margin:0 auto;padding:18px 20px 64px;gap:18px}.sidebar{width:var(--sidebar-w);flex-shrink:0;position:sticky;top:calc(var(--nav-h) + 18px);max-height:calc(100vh - var(--nav-h) - 36px);overflow-y:auto;background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius);box-shadow:var(--shadow);padding:12px 10px}.sidebar h4{margin:4px 6px 8px;font-size:12px;color:var(--c-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}.patent-nav-item{display:block;width:100%;text-align:left;border:none;background:transparent;color:var(--c-text);font-size:13px;line-height:1.45;padding:9px 10px;border-radius:6px;cursor:pointer;transition:all .15s;margin-bottom:3px;border-left:3px solid transparent}.patent-nav-item:hover{background:var(--c-primary-soft)}.patent-nav-item.active{background:var(--c-primary-soft);border-left-color:var(--c-primary);font-weight:600}.patent-nav-item .pn-num{display:block;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;color:var(--c-primary);font-weight:600}.patent-nav-item .pn-title{display:block;color:var(--c-muted);font-size:11px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sidebar-section{margin-bottom:14px}.content{flex:1;min-width:0}.tabs{display:flex;gap:4px;background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius);box-shadow:var(--shadow);padding:6px;margin-bottom:16px;position:sticky;top:calc(var(--nav-h) + 18px);z-index:800}.tab{flex:1;padding:9px 14px;border:none;background:transparent;color:var(--c-muted);font-size:14px;font-weight:500;border-radius:6px;cursor:pointer;transition:all .15s;text-align:center}.tab:hover{background:var(--c-primary-soft);color:var(--c-primary)}.tab.active{background:var(--c-primary);color:#fff;box-shadow:0 1px 3px rgba(22,163,74,.3)}.cover{background:linear-gradient(135deg,#14532d 0%,#16a34a 60%,#22c55e 100%);color:#fff;border-radius:14px;padding:32px 30px;box-shadow:var(--shadow-md);margin-bottom:18px}.cover h1{margin:0 0 8px;font-size:24px;line-height:1.3;font-weight:700}.cover .subtitle{margin:0;font-size:13px;opacity:.85}.cover .meta-row{margin-top:14px;display:flex;flex-wrap:wrap;gap:7px}.cover .chip{display:inline-flex;align-items:center;gap:4px;padding:3px 11px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.25);border-radius:18px;font-size:12px;font-weight:500}.patent-panels{display:none}.patent-panels.active{display:block}.panel{display:none}.panel.active{display:block}.card{background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius);box-shadow:var(--shadow);margin:0 0 16px;overflow:hidden;page-break-inside:avoid}.card-header{padding:14px 18px;border-bottom:1px solid var(--c-border-soft);background:linear-gradient(90deg,var(--c-primary-soft),transparent)}.card-header h3{margin:0;font-size:16px;font-weight:700;line-height:1.4;color:var(--c-text)}.card-header .pn{display:inline-block;margin-right:8px;padding:2px 10px;background:var(--c-primary);color:#fff;border-radius:4px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:600;vertical-align:middle}.card-body{padding:16px 18px}.section-title{display:flex;align-items:center;gap:8px;margin:0 0 12px;font-size:15px;font-weight:600;color:var(--c-text)}.section-title .bar{width:3px;height:18px;border-radius:2px;background:linear-gradient(180deg,var(--c-primary),var(--c-accent));flex-shrink:0}.field-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px 22px}.field-item{display:flex;flex-direction:column;gap:2px}.field-item .fl{font-size:12px;color:var(--c-muted);font-weight:500}.field-item .fv{font-size:14px;color:var(--c-text);white-space:pre-wrap;overflow-wrap:anywhere}.field-item .fv.empty{color:var(--c-faint);font-style:italic}.field-item .fs{font-size:11px;color:var(--c-faint);margin-top:1px}.full-row{grid-column:1/-1}.tags{display:flex;flex-wrap:wrap;gap:5px}.tag{display:inline-block;padding:2px 9px;background:var(--c-accent-soft);color:var(--c-accent);border:1px solid #a7f3d0;border-radius:4px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.abstract-box{padding:14px 16px;background:var(--c-primary-soft);border-radius:var(--radius-sm);font-size:14px;line-height:1.75;color:var(--c-text);white-space:pre-wrap;overflow-wrap:anywhere}.bilingual{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:8px 0}.bilingual-col{background:#f8faf8;border:1px solid var(--c-border-soft);border-radius:var(--radius-sm);padding:12px 14px;max-height:560px;overflow:auto;font-size:13.5px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}.bilingual-col.original{border-left:3px solid var(--c-muted)}.bilingual-col.translated{border-left:3px solid var(--c-primary);background:var(--c-primary-soft)}.bilingual-header{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:6px}.bilingual-header .col-label{font-size:12px;font-weight:600;color:var(--c-muted);text-transform:uppercase;letter-spacing:.03em}.bilingual-header .col-label.translated{color:var(--c-primary)}.translate-hint{padding:10px 14px;background:#fffbeb;border-left:3px solid var(--c-warn);border-radius:0 var(--radius-sm) var(--radius-sm) 0;font-size:13px;color:var(--c-muted);margin:8px 0}.claim-item{margin:8px 0;padding:10px 13px;background:#f8faf8;border-left:3px solid var(--c-primary);border-radius:0 6px 6px 0;white-space:pre-wrap;font-size:13.5px;line-height:1.65}.claim-item.independent{border-left-color:var(--c-danger);background:#fef2f2}.claim-item.dependent{border-left-color:var(--c-warn);background:#fffbeb}.claim-num{font-weight:700;margin-right:4px}.claim-type{display:inline-block;margin-right:6px;padding:1px 7px;border-radius:3px;font-size:11px;font-weight:600}.claim-type.independent{background:#fee2e2;color:var(--c-danger)}.claim-type.dependent{background:#fef3c7;color:var(--c-warn)}.claim-refs{margin-top:5px;font-size:12px;color:var(--c-muted)}.claim-refs a{color:var(--c-primary);text-decoration:none}.claim-refs a:hover{text-decoration:underline}.claims-dependent-group{margin:8px 0;padding:0;border:1px solid var(--c-border-soft);border-radius:var(--radius-sm);overflow:hidden}.claims-dependent-summary{padding:10px 14px;background:#fffbeb;color:var(--c-muted);font-size:13px;font-weight:600;cursor:pointer;user-select:none;list-style:none}.claims-dependent-summary::-webkit-details-marker{display:none}.claims-dependent-summary:hover{background:#fef3c7}.claims-dependent-group[open] .claims-dependent-summary{border-bottom:1px solid var(--c-border-soft)}.claims-dependent-group .claim-item{border-radius:0;margin:0;border-left:none;border-bottom:1px solid var(--c-border-soft)}.claims-dependent-group .claim-item:last-child{border-bottom:none}.figures-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:8px 0}.figure-card{padding:10px;background:#f8faf8;border:1px solid var(--c-border-soft);border-radius:var(--radius-sm);text-align:center;cursor:zoom-in;transition:transform .15s}.figure-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}.figure-card img{max-width:100%;height:auto;border-radius:4px;box-shadow:var(--shadow)}.figure-card figcaption{margin-top:7px;font-size:12px;color:var(--c-muted)}.lightbox{position:fixed;inset:0;z-index:1200;display:none;align-items:center;justify-content:center;background:rgba(20,33,26,.85);padding:32px}.lightbox.open{display:flex}.lightbox img{max-width:92%;max-height:88vh;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.4)}.lightbox .lb-close{position:absolute;top:18px;right:24px;color:#fff;font-size:32px;cursor:pointer;line-height:1}.pf-card{background:var(--c-surface);border:1px solid var(--c-border);border-left:4px solid var(--c-accent);border-radius:var(--radius-sm);padding:14px 16px;margin:0 0 12px;page-break-inside:avoid}.pf-card .pf-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.pf-card .pf-label{font-size:14px;font-weight:600;color:var(--c-text)}.pf-card .pf-badge{font-size:11px;padding:2px 8px;border-radius:10px;font-weight:500}.pf-card .pf-badge.ai{background:var(--c-primary-soft);color:var(--c-primary)}.pf-card .pf-badge.manual{background:#f1f5f9;color:var(--c-muted)}.pf-card .pf-value{font-size:14px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}.pf-card .pf-meta{margin-top:7px;font-size:11px;color:var(--c-faint)}.ai-block{margin:0 0 14px;padding:14px 16px;background:linear-gradient(135deg,var(--c-primary-soft),var(--c-accent-soft));border:1px solid #a7f3d0;border-radius:var(--radius-sm)}.ai-block .ai-tag{display:inline-block;margin-bottom:8px;padding:2px 9px;background:var(--c-primary);color:#fff;border-radius:3px;font-size:11px;font-weight:600}.ai-block .ai-meta{margin-top:8px;font-size:11px;color:var(--c-faint)}.tech-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin:10px 0}.tech-card{padding:11px;background:#fff;border:1px solid var(--c-border-soft);border-radius:var(--radius-sm)}.tech-card h5{margin:0 0 6px;font-size:13px;color:var(--c-accent)}.tech-card ul{margin:0;padding-left:17px;font-size:13px;line-height:1.6}.tech-card .role{margin:0 0 5px;font-size:12px;color:var(--c-muted)}.data-table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px}.data-table th{text-align:left;padding:8px 11px;background:#eef7f1;border-bottom:2px solid #bcdcc7;font-weight:600;color:var(--c-text)}.data-table td{padding:8px 11px;border-bottom:1px solid var(--c-border-soft);vertical-align:top}.data-table tr:last-child td{border-bottom:none}.data-table tr:hover td{background:var(--c-primary-soft)}.compare-table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px;display:block;overflow-x:auto}.compare-table th,.compare-table td{padding:9px 12px;border:1px solid var(--c-border);text-align:left;min-width:110px}.compare-table th{background:#f0f7f3;font-weight:600}.notice{padding:12px 16px;background:#fffbeb;border-left:3px solid var(--c-warn);border-radius:0 var(--radius-sm) var(--radius-sm) 0;font-size:14px}.missing{color:var(--c-faint);font-size:13px;font-style:italic}.back-to-top{position:fixed;bottom:28px;right:28px;width:44px;height:44px;border-radius:50%;background:var(--c-primary);color:#fff;border:none;font-size:20px;cursor:pointer;box-shadow:var(--shadow-md);opacity:0;transform:translateY(12px);transition:all .2s;z-index:850;display:flex;align-items:center;justify-content:center}.back-to-top.show{opacity:1;transform:translateY(0)}.back-to-top:hover{background:var(--c-primary-hover);transform:translateY(-2px)}.footer{margin-top:24px;padding-top:16px;border-top:1px solid var(--c-border);color:var(--c-muted);font-size:12px;line-height:1.6}.source-line{margin-top:10px;padding-top:8px;border-top:1px dashed var(--c-border-soft);font-size:11px;color:var(--c-faint)}.back-cite{color:var(--c-success);font-weight:600}.forward-cite{color:var(--c-danger);font-weight:600}@media(max-width:860px){.layout{flex-direction:column;padding:14px 14px 56px}.sidebar{position:static;width:100%;max-height:none}.tabs{position:static}.bilingual{grid-template-columns:1fr}.bilingual-header{grid-template-columns:1fr}.field-grid{grid-template-columns:1fr}.figures-grid{grid-template-columns:1fr}}@media print{body{background:#fff}.topnav,.back-to-top,.progress-bar,.lightbox{display:none!important}.layout{display:block;max-width:none;padding:0}.sidebar{display:none}.tabs{display:none}.patent-panels{display:block!important}.panel{display:block!important}.card,.pf-card{box-shadow:none;break-inside:avoid}.cover{box-shadow:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}.bilingual-col{max-height:none;overflow:visible}}.anno-underline{text-decoration:underline;text-decoration-color:#dc2626;text-decoration-thickness:2px;text-underline-offset:2px}.anno-highlight{background:#fef08a;padding:1px 2px;border-radius:2px}.anno-comment{background:#dbeafe;border-bottom:2px solid #3b82f6;cursor:help;padding:1px 2px}.anno-comment sup{font-size:10px;color:#3b82f6;margin-left:2px;vertical-align:super;font-weight:700}.md-code{background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:6px;overflow:auto;font:13px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;margin:10px 0}.md-table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px}.md-table th{background:#eef7f1;border:1px solid #bcdcc7;padding:7px 10px;text-align:left;font-weight:600}.md-table td{border:1px solid var(--c-border-soft);padding:7px 10px;vertical-align:top}.fig-ref{color:var(--c-primary);text-decoration:none;border-bottom:1px dashed var(--c-primary);cursor:pointer}.fig-ref:hover{background:var(--c-primary-soft);text-decoration:none}.source-split{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:14px;align-items:flex-start}.source-split .source-text{min-width:0}.source-split .source-figures{position:sticky;top:calc(var(--nav-h) + 38px);max-height:calc(100vh - var(--nav-h) - 56px);overflow:auto;background:#f8faf8;border:1px solid var(--c-border-soft);border-radius:var(--radius-sm);padding:10px}.source-split .source-figures .fig-mini{margin-bottom:10px;cursor:zoom-in}.source-split .source-figures .fig-mini:last-child{margin-bottom:0}.source-split .source-figures .fig-mini img{max-width:100%;height:auto;border-radius:4px;box-shadow:var(--shadow)}.source-split .source-figures .fig-mini figcaption{margin-top:4px;font-size:11px;color:var(--c-muted);text-align:center}.source-split .source-figures .fig-mini.flash{outline:3px solid var(--c-primary);outline-offset:2px;transition:outline .15s}@media(max-width:860px){.source-split{grid-template-columns:1fr}.source-split .source-figures{position:static;max-height:none}}.patentlens-watermark{position:fixed;bottom:14px;left:0;right:0;text-align:center;font-size:11px;color:rgba(20,33,26,.28);letter-spacing:.06em;pointer-events:none;z-index:700;user-select:none}.patentlens-watermark .wl-brand{font-weight:600;color:rgba(22,163,74,.42)}@media print{.patentlens-watermark{position:static;padding:8px 0 4px;color:var(--c-faint)}.patentlens-watermark .wl-brand{color:var(--c-primary)}}";

  var JS = "(function(){'use strict';var progressBar=document.querySelector('.progress-bar');var backTop=document.querySelector('.back-to-top');function onScroll(){var st=document.documentElement.scrollTop||document.body.scrollTop;var sh=(document.documentElement.scrollHeight||document.body.scrollHeight)-document.documentElement.clientHeight;if(progressBar&&sh>0)progressBar.style.width=Math.min(100,Math.round(st/sh*100))+'%';if(backTop)backTop.classList.toggle('show',st>400);}window.addEventListener('scroll',onScroll,{passive:true});onScroll();if(backTop)backTop.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});});var currentPatent=0;var currentTab='basic';function applyVisibility(){document.querySelectorAll('.patent-panels').forEach(function(p){p.classList.toggle('active',String(p.dataset.patentIndex)===String(currentPatent));});document.querySelectorAll('.tab').forEach(function(t){t.classList.toggle('active',t.dataset.tab===currentTab);});document.querySelectorAll('.patent-panels.active .panel').forEach(function(p){p.classList.toggle('active',p.dataset.panel===currentTab);});if(backTop){}var activePanels=document.querySelector('.patent-panels.active');if(activePanels){var top=activePanels.getBoundingClientRect().top+window.scrollY-80;if(top<window.scrollY-50){}}document.querySelectorAll('.patent-nav-item').forEach(function(n){n.classList.toggle('active',String(n.dataset.patentIndex)===String(currentPatent));});}document.querySelectorAll('.patent-nav-item').forEach(function(item){item.addEventListener('click',function(){currentPatent=item.dataset.patentIndex;applyVisibility();var sidebar=document.querySelector('.sidebar');if(sidebar)sidebar.scrollTop=0;window.scrollTo({top:document.querySelector('.content').offsetTop-70,behavior:'smooth'});});});document.querySelectorAll('.tab').forEach(function(tab){tab.addEventListener('click',function(){currentTab=tab.dataset.tab;applyVisibility();});});document.querySelectorAll('.figure-card img').forEach(function(img){img.parentElement.addEventListener('click',function(){var lb=document.querySelector('.lightbox');if(!lb)return;lb.querySelector('img').src=img.src;lb.classList.add('open');});});document.querySelectorAll('.fig-mini img').forEach(function(img){var fig=img.closest('.fig-mini');if(!fig)return;fig.addEventListener('click',function(){var lb=document.querySelector('.lightbox');if(!lb)return;lb.querySelector('img').src=img.src;lb.classList.add('open');});});document.addEventListener('click',function(e){var ref=e.target.closest&&e.target.closest('.fig-ref');if(!ref)return;e.preventDefault();var idx=ref.getAttribute('data-fig-index');if(!idx)return;var panels=ref.closest('.patent-panels');if(!panels)return;var target=panels.querySelector('.fig-mini[data-fig-index=\\\"'+idx+'\\\"]');if(!target)return;var rail=target.closest('.source-figures');if(rail){rail.scrollTop=target.offsetTop-rail.offsetTop-8;}target.classList.add('flash');setTimeout(function(){target.classList.remove('flash');},1400);});var lb=document.querySelector('.lightbox');if(lb){lb.addEventListener('click',function(){lb.classList.remove('open');});document.addEventListener('keydown',function(e){if(e.key==='Escape')lb.classList.remove('open');});}applyVisibility();})();";

  var EXTRA_CSS = ".sidebar{transition:width .2s ease,padding .2s ease,transform .2s ease}.sidebar-toggle{display:flex;align-items:center;justify-content:center;width:100%;margin:0 0 10px;padding:6px 8px;border:1px solid var(--c-border);border-radius:6px;background:var(--c-primary-soft);color:var(--c-primary);font-size:12px;font-weight:600;cursor:pointer}.sidebar-toggle:hover{background:var(--c-accent-soft)}.sidebar-edge-trigger{display:none}.layout.sidebar-collapsed{gap:8px}.layout.sidebar-collapsed .sidebar{position:sticky;width:24px;height:58px;min-height:58px;max-height:58px;padding:0;border-color:var(--c-primary);background:var(--c-primary-soft);overflow:visible;cursor:e-resize}.layout.sidebar-collapsed .sidebar>*:not(.sidebar-edge-trigger){visibility:hidden;pointer-events:none}.layout.sidebar-collapsed .sidebar-edge-trigger{display:flex;position:absolute;inset:0;align-items:center;justify-content:center;color:var(--c-primary);font-size:18px;font-weight:700;cursor:e-resize}.layout.sidebar-collapsed .sidebar:hover{width:var(--sidebar-w);height:auto;min-height:0;max-height:calc(100vh - var(--nav-h) - 36px);padding:12px 10px;overflow-y:auto;cursor:default;background:var(--c-surface)}.layout.sidebar-collapsed .sidebar:hover>*:not(.sidebar-edge-trigger){visibility:visible;pointer-events:auto}.layout.sidebar-collapsed .sidebar:hover .sidebar-edge-trigger{display:none}.bilingual-header{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.bilingual-header .col-label{flex:1;min-width:90px}.bilingual-actions{display:flex;gap:6px;margin-left:auto}.bilingual-toggle{padding:4px 8px;border:1px solid var(--c-border);border-radius:5px;background:var(--c-surface);color:var(--c-muted);font-size:11px;cursor:pointer}.bilingual-toggle:hover{border-color:var(--c-primary);color:var(--c-primary);background:var(--c-primary-soft)}.bilingual-header.hide-original .col-label.original,.bilingual-header.hide-translated .col-label.translated{display:none}.bilingual.hide-original .original{display:none}.bilingual.hide-translated .translated{display:none}.bilingual.hide-original,.bilingual.hide-translated{grid-template-columns:1fr}.bilingual.hide-original.hide-translated{display:none}.source-split{grid-template-columns:minmax(0,1fr) 12px var(--figure-rail-width,280px);gap:0}.source-split-resizer{width:12px;min-height:160px;position:relative;cursor:col-resize;touch-action:none}.source-split-resizer::after{content:'';position:absolute;top:8px;bottom:8px;left:5px;width:2px;border-radius:2px;background:var(--c-border)}.source-split-resizer:hover::after,.source-split-resizer.dragging::after{background:var(--c-primary);width:3px;left:4px}.source-split .source-figures{width:var(--figure-rail-width,280px);max-width:none}.resizing-figures{cursor:col-resize!important;user-select:none!important}.bilingual-loading{padding:12px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-left:3px solid #2563eb;border-radius:0 var(--radius-sm) var(--radius-sm) 0;color:#1e40af;font-size:13px}.processed-translation{padding:12px 14px;background:var(--c-primary-soft);border:1px solid var(--c-border-soft);border-radius:var(--radius-sm);white-space:pre-wrap;overflow-wrap:anywhere}.processed-translation-label{margin-bottom:6px;color:var(--c-primary);font-size:12px;font-weight:700}.lightbox{flex-direction:column;gap:12px}.lightbox .lb-stage{display:flex;align-items:center;justify-content:center;max-width:94vw;max-height:82vh;overflow:hidden}.lightbox .lb-stage img{max-width:92vw;max-height:82vh;object-fit:contain;transform-origin:center center;will-change:transform}.lb-toolbar{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid rgba(255,255,255,.3);border-radius:7px;background:rgba(20,33,26,.72);z-index:1}.lb-toolbar button{min-width:34px;height:30px;padding:0 8px;border:1px solid rgba(255,255,255,.35);border-radius:5px;background:rgba(255,255,255,.12);color:#fff;font-size:16px;line-height:1;cursor:pointer}.lb-toolbar button:hover{background:rgba(255,255,255,.24)}.lb-toolbar .lb-scale{min-width:48px;color:#fff;font-size:12px;text-align:center}@media(max-width:860px){.layout.sidebar-collapsed .sidebar{position:fixed;left:0;top:calc(var(--nav-h) + 14px);z-index:950}.layout.sidebar-collapsed .sidebar:hover{width:min(var(--sidebar-w),calc(100vw - 28px))}.source-split{grid-template-columns:1fr}.source-split-resizer{display:none}.source-split .source-figures{width:auto}.bilingual-header{align-items:flex-start}.bilingual-actions{width:100%;margin-left:0}}";
  var EXTRA_JS = "(function(){'use strict';var layout=document.querySelector('.layout');var sidebar=document.querySelector('.sidebar');var sidebarToggle=document.querySelector('.sidebar-toggle');if(layout&&sidebar&&sidebarToggle){sidebarToggle.addEventListener('click',function(){var collapsed=layout.classList.toggle('sidebar-collapsed');sidebarToggle.setAttribute('aria-expanded',String(!collapsed));sidebarToggle.textContent=collapsed?'展开专利侧栏':'收起专利侧栏';});}document.querySelectorAll('.bilingual-header').forEach(function(header){var bilingual=header.nextElementSibling;if(!bilingual||!bilingual.classList.contains('bilingual'))return;header.querySelectorAll('.bilingual-toggle').forEach(function(button){button.addEventListener('click',function(){var target=button.getAttribute('data-bilingual-toggle');var hiddenClass=target==='original'?'hide-original':'hide-translated';var labelClass=target==='original'?'hide-original':'hide-translated';bilingual.classList.toggle(hiddenClass);header.classList.toggle(labelClass);var hidden=bilingual.classList.contains(hiddenClass);button.textContent=(hidden?'显示':'隐藏')+(target==='original'?'原文':'翻译');});});});var activeResize=null;document.querySelectorAll('.source-split-resizer').forEach(function(resizer){resizer.addEventListener('pointerdown',function(event){var split=resizer.closest('.source-split');if(!split)return;var rail=split.querySelector('.source-figures');if(!rail)return;activeResize={split:split,resizer:resizer};resizer.classList.add('dragging');document.body.classList.add('resizing-figures');if(resizer.setPointerCapture)resizer.setPointerCapture(event.pointerId);event.preventDefault();});});document.addEventListener('pointermove',function(event){if(!activeResize)return;var rect=activeResize.split.getBoundingClientRect();var width=Math.max(180,Math.min(520,rect.right-event.clientX));activeResize.split.style.setProperty('--figure-rail-width',width+'px');});function endResize(){if(!activeResize)return;activeResize.resizer.classList.remove('dragging');document.body.classList.remove('resizing-figures');activeResize=null;}document.addEventListener('pointerup',endResize);document.addEventListener('pointercancel',endResize);var lb=document.querySelector('.lightbox');var lbImg=lb&&lb.querySelector('img');var lbScale=1;var lbRotation=0;function updateLightbox(){if(!lbImg)return;lbImg.style.transform='scale('+lbScale+') rotate('+lbRotation+'deg)';var scaleLabel=lb&&lb.querySelector('.lb-scale');if(scaleLabel)scaleLabel.textContent=Math.round(lbScale*100)+'%';}function resetLightbox(){lbScale=1;lbRotation=0;updateLightbox();}function openLightboxState(){if(!lb)return;resetLightbox();lb.classList.add('open');}if(lb&&lbImg){document.querySelectorAll('.figure-card img,.fig-mini img').forEach(function(img){img.addEventListener('click',openLightboxState);});var toolbar=lb.querySelector('.lb-toolbar');if(toolbar)toolbar.addEventListener('click',function(event){event.stopPropagation();var action=event.target.closest('[data-lb-action]');if(!action)return;var name=action.getAttribute('data-lb-action');if(name==='zoom-in')lbScale=Math.min(4,Math.round((lbScale+.25)*100)/100);if(name==='zoom-out')lbScale=Math.max(.25,Math.round((lbScale-.25)*100)/100);if(name==='reset')resetLightbox();if(name==='rotate-left')lbRotation-=90;if(name==='rotate-right')lbRotation+=90;updateLightbox();});lb.addEventListener('wheel',function(event){if(!lb.classList.contains('open'))return;event.preventDefault();lbScale=Math.max(.25,Math.min(4,Math.round((lbScale+(event.deltaY<0?.15:-.15))*100)/100));updateLightbox();},{passive:false});lb.addEventListener('click',function(event){if(event.target===lb)return;if(event.target.closest&&event.target.closest('.lb-close'))return;event.stopPropagation();},true);var close=lb.querySelector('.lb-close');if(close)close.addEventListener('click',function(event){event.stopPropagation();lb.classList.remove('open');});}updateLightbox();})();";

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

  // 来源标签中性化：不输出 "Google Patents" 字样
  function readableSourceLabel(source) {
    if (!source) return "未标记";
    var label = cleanText(source.label);
    var type = cleanText(source.type);
    if (label) return label.replace(/google\s*patents?/gi, "专利原文");
    if (type === "google_patents") return "专利原文";
    return sourceKeyLabel(type) || "未标记";
  }

  // 内部来源 key → 中文标签映射
  function sourceKeyLabel(key) {
    var map = {
      google_patents: "专利原文",
      manual: "人工确认",
      excel: "Excel/CSV",
      csv: "CSV",
      dossier: "审查档案",
      pdf_text: "PDF 文本层",
      ocr: "OCR",
      ai: "AI生成",
    };
    return map[key] || (cleanText(key) ? key.replace(/google\s*patents?/gi, "专利原文") : "");
  }

  function renderMarkdownSimple(text) {
    if (!text) return "";
    var html = escapeHtml(text);
    // 1. 先抽取围栏代码块，避免内部内容被其它规则误伤。
    var codeBlocks = [];
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function (m, lang, code) {
      var idx = codeBlocks.length;
      codeBlocks.push('<pre class="md-code"><code>' + code.replace(/\n$/, "") + "</code></pre>");
      return "\u0000CODE" + idx + "\u0000";
    });
    // 2. GFM 表格：表头行 + 分隔行 + 若干数据行。
    html = renderMarkdownTables(html);
    // 3. 标题、行内代码、粗体、斜体、列表、段落。
    html = html.replace(/^### (.*$)/gm, "<h4>$1</h4>");
    html = html.replace(/^## (.*$)/gm, "<h3>$1</h3>");
    html = html.replace(/^# (.*$)/gm, "<h3>$1</h3>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>[^\0]*?<\/li>)(\n|$)/g, function (group) { return "<ul>" + group + "</ul>"; });
    html = html.replace(/<\/ul>\n?<ul>/g, "");
    html = html.replace(/^(\d+)\. (.+)$/gm, "<li>$2</li>");
    html = html.replace(/\n\n/g, "</p><p>");
    html = "<p>" + html + "</p>";
    html = html.replace(/<p><\/p>/g, "");
    html = html.replace(/<p><(h[34]|ul|ol|li|table|pre)/g, "<$1");
    html = html.replace(/<\/(h[34]|ul|ol|li|table|pre)><\/p>/g, "</$1>");
    html = html.replace(/<p>\u0000CODE/g, "\u0000CODE");
    html = html.replace(/\u0000CODE(\d+)\u0000<\/p>/g, function (m, idx) { return codeBlocks[Number(idx)] || ""; });
    html = html.replace(/\u0000CODE(\d+)\u0000/g, function (m, idx) { return codeBlocks[Number(idx)] || ""; });
    return html;
  }

  function splitTableRow(line) {
    var t = line.trim().replace(/^\|/, "").replace(/\|\s*$/, "");
    return t.split("|").map(function (c) { return c.trim(); });
  }

  function renderMarkdownTables(html) {
    var lines = html.split("\n");
    var out = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var next = i + 1 < lines.length ? lines[i + 1] : "";
      if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(next)) {
        var header = splitTableRow(line);
        out.push('<table class="md-table"><thead><tr>' + header.map(function (c) { return "<th>" + c + "</th>"; }).join("") + "</tr></thead><tbody>");
        i += 2;
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
          var row = splitTableRow(lines[i]);
          out.push("<tr>" + row.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>");
          i++;
        }
        out.push("</tbody></table>");
      } else {
        out.push(line);
        i++;
      }
    }
    return out.join("\n");
  }

  // 将正文中的「图N」引用转为可点击链接，点击后切换图文对照的主图。
  // 仅处理文本节点（标签之间的内容），不会触碰标签属性中的「图N」。
  function linkFigureRefs(html, figures) {
    if (!figures || !figures.length) return html;
    var parts = html.split(/(<[^>]+>)/);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].charAt(0) === "<") continue;
      parts[i] = parts[i].replace(/图\s*(\d+)/g, function (match, n) {
        var idx = parseInt(n, 10);
        if (idx < 1 || idx > figures.length) return match;
        return '<a class="fig-ref" data-fig-index="' + idx + '" href="#fig-' + idx + '">' + match + "</a>";
      });
    }
    return parts.join("");
  }

  function scanSensitive(project, html) {
    var embeddedText = String(html || "");
    var projectText = JSON.stringify(project || {});
    var text = embeddedText + "\n" + projectText;
    var findings = [];
    if (/["']?(?:api[_-]?key|access[_-]?token|token|secret|cookie)["']?\s*[:=]/i.test(text)) findings.push("可能包含密钥、Token 或 Cookie 字段");
    if (/https?:\/\/127\.0\.0\.1(?::\d+)?|https?:\/\/localhost(?::\d+)?|127\.0\.0\.1:\d+/i.test(embeddedText)) findings.push("可能包含本机代理或本地服务地址");
    // 收紧路径正则：至少两层目录（/Users/foo/、C:\Users\foo\），避免误命中字段名或 CSS 转义
    if (/[A-Z]:\\[^\n"<>\\]+\\[^\n"<>\\]+|\/(?:Users|home|private|var)\/[^\n"<>\/]+\/[^\n"<>\/]+/i.test(embeddedText)) findings.push("可能包含绝对本机路径");
    return findings;
  }

  function findPendingConflicts(project) {
    var conflicts = [];
    (project && Array.isArray(project.patents) ? project.patents : []).forEach(function (record) {
      Object.keys(record.fields && typeof record.fields === "object" ? record.fields : {}).forEach(function (fieldName) {
        var f = record.fields[fieldName];
        if (f && f.reviewState === "conflict") conflicts.push({ patentNumber: record.patentNumber, fieldName: fieldName });
      });
      Object.keys(record.customFields && typeof record.customFields === "object" ? record.customFields : {}).forEach(function (key) {
        var custom = record.customFields[key];
        if (custom && custom.field && custom.field.reviewState === "conflict") conflicts.push({ patentNumber: record.patentNumber, fieldName: custom.label || key });
      });
    });
    return conflicts;
  }

  function findUnreviewedAI(project) {
    var pending = [];
    (project && Array.isArray(project.patents) ? project.patents : []).forEach(function (record) {
      Object.keys(record.aiAnalysis && typeof record.aiAnalysis === "object" ? record.aiAnalysis : {}).forEach(function (type) {
        var item = record.aiAnalysis[type];
        if (item && item.content && item.reviewState !== "accepted") pending.push({ patentNumber: record.patentNumber, label: type });
      });
      (record.processedFields || []).forEach(function (field) {
        if (field && field.source === "ai" && field.value && field.reviewState !== "accepted") pending.push({ patentNumber: record.patentNumber, label: field.label || "加工字段" });
      });
    });
    Object.keys(project && project.aiAnalysis && typeof project.aiAnalysis === "object" ? project.aiAnalysis : {}).forEach(function (type) {
      var item = project.aiAnalysis[type];
      if (item && item.content && item.reviewState !== "accepted") pending.push({ patentNumber: "项目级", label: type });
    });
    return pending;
  }

  function fieldValueHtml(record, name, label, fullRow) {
    var item = field(record, name);
    var rowClass = fullRow ? " field-item full-row" : " field-item";
    if (!item) return '<div class="' + rowClass.trim() + '"><span class="fl">' + escapeHtml(label) + '</span><span class="fv empty">来源未提供</span></div>';
    return '<div class="' + rowClass.trim() + '"><span class="fl">' + escapeHtml(label) + '</span><span class="fv">' + escapeHtml(item.value) + '</span></div>';
  }

  // 按原始文本偏移量应用标注。偏移量不能在 HTML 转义后计算，否则特殊字符会导致位置漂移。
  // annotations: [{ key, type, start, end, text, comment }]
  // key: 仅匹配该 key 的标注（claims 用 claim.number，description 用空串）
  function applyAnnotationsToHtml(text, annotations, key) {
    if (!text) return "";
    if (!annotations || !Array.isArray(annotations) || !annotations.length) return escapeHtml(text);
    var sorted = annotations.filter(function (a) { return a && a.key === (key || ""); })
      .sort(function (a, b) { return (b.start || 0) - (a.start || 0); });
    var html = "";
    var cursor = 0;
    sorted.forEach(function (anno) {
      var start = Math.max(0, anno.start || 0);
      var end = Math.min(text.length, anno.end || start);
      if (start < cursor || start >= end) return;
      html += escapeHtml(text.slice(cursor, start));
      var middle = escapeHtml(text.slice(start, end));
      if (anno.type === "underline") {
        middle = '<span class="anno-underline">' + middle + '</span>';
      } else if (anno.type === "highlight") {
        middle = '<mark class="anno-highlight">' + middle + '</mark>';
      } else if (anno.type === "comment" && anno.comment) {
        middle = '<span class="anno-comment" title="' + escapeHtml(anno.comment) + '">' + middle +
          '<sup>注释</sup></span>';
      }
      html += middle;
      cursor = end;
    });
    return html + escapeHtml(text.slice(cursor));
  }

  function renderClaimsHtml(claims, config, annotations, figures) {
    if (!claims || !claims.length) return '<p class="missing">来源未提供权利要求</p>';
    var annos = Array.isArray(annotations) ? annotations : [];
    var items = claims;
    var mode = moduleMode(config, "S4");
    if (mode === "lite") {
      var independent = claims.filter(function (c) { return c.type === "independent"; });
      items = independent.length ? independent.slice(0, 3) : claims.slice(0, 1);
    }
    // 按独立权利要求分组，从属权利要求默认折叠
    var independentClaims = items.filter(function (c) { return c.type !== "dependent"; });
    var dependentClaims = items.filter(function (c) { return c.type === "dependent"; });
    var html = '';
    // 先渲染独立权利要求
    independentClaims.forEach(function (claim) {
      var typeClass = claim.type === "independent" ? "independent" : "";
      var claimId = 'claim-' + (claim.number || "").replace(/\D/g, "");
      html += '<div class="claim-item ' + typeClass + '" id="' + claimId + '">';
      if (claim.type === "independent") html += '<span class="claim-type independent">独立</span>';
      html += '<span class="claim-num">' + escapeHtml(claim.number || "") + '.</span> ';
      html += linkFigureRefs(applyAnnotationsToHtml(claim.text || "", annos, claim.number || ""), figures);
      if (claim.references && claim.references.length) {
        html += '<div class="claim-refs">引用权项：';
        html += claim.references.map(function (ref) {
          return '<a href="#claim-' + escapeHtml(String(ref).replace(/\D/g, "")) + '">' + escapeHtml(ref) + '</a>';
        }).join(", ");
        html += '</div>';
      }
      html += '</div>';
    });
    // 从属权利要求默认折叠
    if (dependentClaims.length) {
      html += '<details class="claims-dependent-group"><summary class="claims-dependent-summary">从属权利要求（' + dependentClaims.length + ' 项，点击展开）</summary>';
      dependentClaims.forEach(function (claim) {
        var claimId = 'claim-' + (claim.number || "").replace(/\D/g, "");
        html += '<div class="claim-item dependent" id="' + claimId + '">';
        html += '<span class="claim-type dependent">从属</span>';
        html += '<span class="claim-num">' + escapeHtml(claim.number || "") + '.</span> ';
        html += linkFigureRefs(applyAnnotationsToHtml(claim.text || "", annos, claim.number || ""), figures);
        if (claim.references && claim.references.length) {
          html += '<div class="claim-refs">引用权项：';
          html += claim.references.map(function (ref) {
            return '<a href="#claim-' + escapeHtml(String(ref).replace(/\D/g, "")) + '">' + escapeHtml(ref) + '</a>';
          }).join(", ");
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</details>';
    }
    if (mode === "lite" && claims.length > items.length) {
      html += '<p class="missing">（精简模式：仅展示前 ' + items.length + ' 项，共 ' + claims.length + ' 项权利要求）</p>';
    }
    return html;
  }

  // 权利要求双栏对照：原文（按条拼接）+ 整段中文翻译
  function renderClaimsBilingual(record, config, figures) {
    var claims = Array.isArray(record.claims) ? record.claims : [];
    if (!claims.length) return '<p class="missing">来源未提供权利要求</p>';
    var originalHtml = renderClaimsHtml(claims, config, record.claimsAnnotations, figures);
    var translation = cleanText(record.claimsTranslation);
    var html = '<div class="bilingual-header"><span class="col-label original">原文</span><span class="col-label translated">中文翻译</span><span class="bilingual-actions"><button class="bilingual-toggle" type="button" data-bilingual-toggle="original">隐藏原文</button><button class="bilingual-toggle" type="button" data-bilingual-toggle="translated">隐藏翻译</button></span></div>';
    html += '<div class="bilingual">';
    html += '<div class="bilingual-col original">' + originalHtml + '</div>';
    if (translation) {
      html += '<div class="bilingual-col translated">' + escapeHtml(translation) + '</div>';
    } else {
      html += '<div class="bilingual-col translated"><p class="missing">尚未生成中文翻译。可在分享工作台「数据审核」中点击"翻译权利要求"生成。</p></div>';
    }
    html += '</div>';
    return html;
  }

  // 说明书双栏对照：原文 + 中文翻译
  function renderDescriptionBilingual(record, config, figures) {
    var description = cleanText(record.description);
    if (!description) return '<p class="missing">来源未提供说明书内容</p>';
    var mode = moduleMode(config, "S5");
    var origText = description;
    if (mode === "lite" && origText.length > 3000) origText = origText.slice(0, 3000) + "\n\n...（内容过长，已截断。完整模式展示全部内容）";
    var translation = cleanText(record.descriptionTranslation);
    var transText = translation;
    if (mode === "lite" && transText.length > 3000) transText = transText.slice(0, 3000) + "\n\n...（内容过长，已截断）";
    var html = '<div class="bilingual-header"><span class="col-label original">原文</span><span class="col-label translated">中文翻译</span><span class="bilingual-actions"><button class="bilingual-toggle" type="button" data-bilingual-toggle="original">隐藏原文</button><button class="bilingual-toggle" type="button" data-bilingual-toggle="translated">隐藏翻译</button></span></div>';
    html += '<div class="bilingual">';
    html += '<div class="bilingual-col original">' + linkFigureRefs(applyAnnotationsToHtml(origText, record.descriptionAnnotations, ""), figures) + '</div>';
    if (transText) {
      html += '<div class="bilingual-col translated">' + escapeHtml(transText) + '</div>';
    } else {
      html += '<div class="bilingual-col translated"><p class="missing">尚未生成中文翻译。可在分享工作台「数据审核」中点击"翻译说明书"生成。</p></div>';
    }
    html += '</div>';
    return html;
  }

  // 图文对照右侧附图栏：仅渲染附图缩略图，点击可放大；正文中的「图N」会高亮对应附图。
  function renderFigureRail(figures) {
    if (!figures || !figures.length) return "";
    var html = '<div class="source-figures"><div class="ai-meta" style="margin:0 0 8px;font-weight:600;color:var(--c-muted)">附图对照（点击正文「图N」可定位）</div>';
    figures.forEach(function (fig, idx) {
      var n = idx + 1;
      html += '<figure class="fig-mini" data-fig-index="' + n + '" id="fig-' + n + '">';
      html += '<img src="' + fig.dataUrl + '" alt="' + escapeHtml(fig.caption || "附图" + n) + '"' + (fig.width ? ' style="max-width:' + fig.width + 'px"' : '') + ' />';
      html += '<figcaption>图 ' + n + (fig.caption ? ' · ' + escapeHtml(fig.caption) : '') + '</figcaption>';
      html += '</figure>';
    });
    html += '</div>';
    return html;
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
      var badge = isAI ? '<span class="pf-badge ai">' + (f.reviewState === "accepted" ? "AI 抽取，已确认" : "AI 草稿，待审核") + '</span>' : '<span class="pf-badge manual">手工录入</span>';
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

  // 基础信息面板：著录项 + 摘要（不含权利要求和说明书）
  function renderBasicPanel(record, config) {
    var html = '<div class="panel" data-panel="basic">';
    html += '<div class="card"><div class="card-body">';
    if (moduleEnabled(config, "S2")) {
      html += '<div class="section-title"><span class="bar"></span>著录信息</div>';
      html += '<div class="field-grid">';
      html += fieldValueHtml(record, "title", "标题");
      if (record.classifications && record.classifications.length) {
        html += '<div class="field-item full-row"><span class="fl">IPC/CPC 分类</span><div class="tags">';
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
            html += '<div class="field-item"><span class="fl">' + escapeHtml(custom.label || key) + '</span><span class="fv' + (val ? '' : ' empty') + '">' + escapeHtml(val || "来源未提供") + '</span></div>';
          }
        });
      }
      html += '</div>';
    }
    if (moduleEnabled(config, "S3")) {
      var abstractField = field(record, "abstract");
      var abstract = abstractField && abstractField.value;
      if (abstract && moduleMode(config, "S3") === "lite" && abstract.length > 360) abstract = abstract.slice(0, 360) + "…";
      html += '<div class="section-title" style="margin-top:18px"><span class="bar"></span>技术摘要</div>';
      html += abstract ? '<div class="abstract-box">' + escapeHtml(abstract) + '</div>' : '<p class="missing">来源未提供摘要</p>';
    }
    html += '</div></div>';
    html += '</div>';
    return html;
  }

  // 原文信息面板：权利要求（双栏）、说明书（双栏）、附图
  // 当 S7（附图）与 S4/S5 同时启用时，使用「左文右图」分栏，正文中的「图N」可定位到右侧附图。
  function renderSourcePanel(record, config) {
    var html = '<div class="panel" data-panel="source">';
    var figures = Array.isArray(record.figures) ? record.figures : [];
    var hasFigures = figures && figures.length > 0;
    var useSplit = hasFigures && moduleEnabled(config, "S7");
    var figureRail = useSplit ? renderFigureRail(figures) : "";
    if (moduleEnabled(config, "S4")) {
      var claimsBody = '';
      claimsBody += '<div class="section-title"><span class="bar"></span>权利要求书（原文 / 中文翻译对照）</div>';
      claimsBody += renderClaimsBilingual(record, config, figures);
      if (useSplit) {
        html += '<div class="card"><div class="card-body"><div class="source-split"><div class="source-text">' + claimsBody + '</div><div class="source-split-resizer" role="separator" aria-label="调节附图栏宽度" tabindex="0"></div>' + figureRail + '</div></div></div>';
      } else {
        html += '<div class="card"><div class="card-body">' + claimsBody + '</div></div>';
      }
    }
    if (moduleEnabled(config, "S5")) {
      var descBody = '';
      descBody += '<div class="section-title"><span class="bar"></span>说明书（原文 / 中文翻译对照）</div>';
      descBody += renderDescriptionBilingual(record, config, figures);
      if (useSplit) {
        html += '<div class="card"><div class="card-body"><div class="source-split"><div class="source-text">' + descBody + '</div><div class="source-split-resizer" role="separator" aria-label="调节附图栏宽度" tabindex="0"></div>' + figureRail + '</div></div></div>';
      } else {
        html += '<div class="card"><div class="card-body">' + descBody + '</div></div>';
      }
    }
    if (moduleEnabled(config, "S7") && !useSplit) {
      html += '<div class="card"><div class="card-body">';
      html += '<div class="section-title"><span class="bar"></span>附图</div>';
      html += renderFigures(record.figures, moduleMode(config, "S7"));
      html += '</div></div>';
    }
    if (!moduleEnabled(config, "S4") && !moduleEnabled(config, "S5") && !moduleEnabled(config, "S7")) {
      html += '<p class="missing">原文信息模块（权利要求/说明书/附图）均未启用。可在「分享模块」中开启 S4/S5/S7。</p>';
    }
    html += '</div>';
    return html;
  }

  // 项目级研发结论模块（R1 技术问题-方案-效果 / R6 研发启发与待验证）。
  // 这两个模块属于项目级数据（project.researchSummary），与专利条目无关；
  // 在多专利视图中挂在第一篇专利的「加工信息」标签页下，无专利时作为独立面板渲染。
  function renderProjectResearchBlocks(project, config) {
    var html = "";
    if (moduleEnabled(config, "R1")) {
      var researchR1 = project.researchSummary && typeof project.researchSummary === "object" ? project.researchSummary : {};
      if (researchR1.problem || researchR1.approach || researchR1.effect || researchR1.openQuestions) {
        html += '<div class="card"><div class="card-body">';
        html += '<div class="section-title"><span class="bar"></span>技术问题-方案-效果</div>';
        [["技术问题", researchR1.problem], ["技术手段", researchR1.approach], ["技术效果", researchR1.effect], ["待验证问题", researchR1.openQuestions]].forEach(function (item) {
          var text = cleanText(item[1]);
          if (text && moduleMode(config, "R1") === "lite" && text.length > 800) text = text.slice(0, 800) + "…";
          if (text) html += '<div class="field-item full-row" style="margin:6px 0"><span class="fl">' + escapeHtml(item[0]) + '</span><span class="fv">' + escapeHtml(text) + '</span></div>';
        });
        html += '</div></div>';
      }
    }
    if (moduleEnabled(config, "R6")) {
      var researchR6 = project.researchSummary || {};
      if (researchR6.openQuestions) {
        html += '<div class="card"><div class="card-body">';
        html += '<div class="section-title"><span class="bar"></span>研发启发与待验证问题</div>';
        html += '<div class="ai-block"><div class="field-item full-row"><span class="fl">待验证问题</span><span class="fv">' + escapeHtml(researchR6.openQuestions) + '</span></div></div>';
        html += '</div></div>';
      }
    }
    return html;
  }

  function processedCard(title, content) {
    return '<div class="card"><div class="card-body"><div class="section-title"><span class="bar"></span>' + title + '</div>' + content + '</div></div>';
  }

  function renderProcessedModule(record, config, project, moduleId, researchRendered) {
    var mode = moduleMode(config, moduleId);
    if (moduleId === "R1") {
      var result = "";
      if (record === project.patents[0] && !researchRendered.value) { result += renderProjectResearchBlocks(project, config); researchRendered.value = true; }
      if (record.aiAnalysis && record.aiAnalysis.summary) result += processedCard("技术解读（AI）", renderAISummary(record, null, record.aiAnalysis || {}, mode));
      return result;
    }
    if (moduleId === "R2") return processedCard("技术要素与系统结构", renderTechElements(record.aiAnalysis && record.aiAnalysis.elements, mode));
    if (moduleId === "R3") {
      var elements = record.aiAnalysis && record.aiAnalysis.elements;
      var params = '<p class="missing">请先生成并审核技术要素草稿，关键参数将据此归纳。</p>';
      if (elements && elements.parsed && elements.parsed.parameters && elements.parsed.parameters.length) {
        params = '<table class="data-table"><tr><th>参数</th><th>范围/取值</th><th>单位</th><th>作用</th></tr>';
        elements.parsed.parameters.forEach(function (p) { params += '<tr><td>' + escapeHtml(p.name || "") + '</td><td>' + escapeHtml(p.range || "") + '</td><td>' + escapeHtml(p.unit || "") + '</td><td>' + escapeHtml(p.effect || "") + '</td></tr>'; });
        params += '</table><div class="ai-meta">来源：技术要素 AI 提取</div>';
      }
      return processedCard("关键参数与边界条件", params);
    }
    if (moduleId === "R4") {
      var emb = record.aiAnalysis && record.aiAnalysis.embodiments;
      var embHtml = '<p class="missing">尚未生成实施例分析。需要先导入说明书内容。</p>';
      if (emb && emb.content) {
        var content = mode === "lite" && emb.content.length > 2000 ? emb.content.slice(0, 2000) + "\n\n...（内容过长，已截断）" : emb.content;
        embHtml = '<div class="ai-block"><span class="ai-tag">AI</span>' + renderMarkdownSimple(content) + '<div class="ai-meta">' + escapeHtml(emb.model || "AI") + ' · ' + escapeHtml(emb.generatedAt ? emb.generatedAt.slice(0, 10) : "") + '</div></div>';
      }
      return processedCard("实施例与验证证据", embHtml);
    }
    if (moduleId === "R5") return record === project.patents[0] && project.patents.length >= 2 ? processedCard("多专利对比", renderMultiPatentComparison(project, project.aiAnalysis, mode)) : "";
    if (moduleId === "R6") {
      if (record !== project.patents[0] || researchRendered.value) return "";
      researchRendered.value = true;
      return renderProjectResearchBlocks(project, config);
    }
    if (moduleId === "R7") {
      var sources = Array.isArray(record.ocrSources) ? record.ocrSources : [];
      var ocr = sources.length ? sources.map(function (source) {
        var excerpt = source.text || source.markdown || "";
        if (mode === "lite" && excerpt.length > 4000) excerpt = excerpt.slice(0, 4000) + "…";
        return '<div class="ai-meta">' + escapeHtml(source.fileName || "PDF") + ' · ' + escapeHtml(source.engine || "OCR") + '</div><pre class="bilingual-col" style="max-height:340px;font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace">' + escapeHtml(excerpt) + '</pre>';
      }).join("") : '<p class="missing">尚未关联 PDF OCR 材料</p>';
      return processedCard("OCR 原文摘录", ocr);
    }
    if (moduleId === "R8") return processedCard("引证文献", renderCitations(record.citations, mode));
    if (moduleId === "R9") return processedCard("同族与地域布局", renderFamily(record.family, mode));
    return "";
  }

  // 加工信息面板：手工字段固定在顶部，R 系列模块严格按照 moduleOrder 输出。
  function renderTranslationProcessing(record) {
    var html = "";
    if (Array.isArray(record.claims) && record.claims.length) {
      html += processedCard("权利要求中文翻译", record.claimsTranslation
        ? '<div class="processed-translation"><div class="processed-translation-label">已完成翻译</div>' + escapeHtml(record.claimsTranslation) + '</div>'
        : '<div class="bilingual-loading">尚未生成权利要求翻译。可在分享内容加工中发起翻译。</div>');
    }
    if (cleanText(record.description)) {
      html += processedCard("说明书中文翻译", record.descriptionTranslation
        ? '<div class="processed-translation"><div class="processed-translation-label">已完成翻译</div>' + escapeHtml(record.descriptionTranslation) + '</div>'
        : '<div class="bilingual-loading">尚未生成说明书翻译。可在分享内容加工中发起翻译。</div>');
    }
    return html;
  }

  function renderProcessedPanel(record, config, project) {
    var html = '<div class="panel" data-panel="processed">';
    html += renderTranslationProcessing(record);
    if (record.processedFields && record.processedFields.length) html += processedCard("加工字段", renderProcessedFields(record, "full"));
    var defaultOrder = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"];
    var order = config.moduleOrder && Array.isArray(config.moduleOrder.processed) ? config.moduleOrder.processed : defaultOrder;
    var researchRendered = { value: false };
    order.forEach(function (moduleId) { if (moduleEnabled(config, moduleId)) html += renderProcessedModule(record, config, project, moduleId, researchRendered); });
    var hasAnyProcessed = (record.processedFields && record.processedFields.length) || order.some(function (id) { return moduleEnabled(config, id); });
    if (!hasAnyProcessed) html += '<p class="missing">尚未添加加工信息。可在“分享内容加工”中添加字段或运行 AI 草稿，并在“分享模块编排”中启用 R 系列模块。</p>';
    html += '</div>';
    return html;
  }

  function renderPatentPanels(record, config, project, index) {
    var html = '<div class="patent-panels' + (index === 0 ? ' active' : '') + '" data-patent-index="' + index + '">';
    html += '<div class="card"><div class="card-header"><h3><span class="pn">' + escapeHtml(record.patentNumber) + '</span>' + escapeHtml(record.title || "未提供标题") + '</h3></div></div>';
    html += renderBasicPanel(record, config);
    html += renderSourcePanel(record, config);
    html += renderProcessedPanel(record, config, project);
    html += '</div>';
    return html;
  }

  function renderShareAttributes(attributes) {
    if (!attributes || typeof attributes !== "object") return "";
    var fields = [
      ["分享时间", attributes.shareTime],
      ["分享部门", attributes.department],
      ["分享主题", attributes.topic],
      ["分享人", attributes.sharer],
      ["分享对象", attributes.audience],
      ["分享地点", attributes.location],
      ["使用边界", attributes.confidentiality],
      ["备注", attributes.notes],
    ].filter(function (item) { return cleanText(item[1]); });
    if (!fields.length) return "";
    var html = '<section class="card share-meta-card" style="margin-bottom:18px"><div class="card-body">';
    html += '<div class="section-title"><span class="bar"></span>分享属性</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 18px">';
    fields.forEach(function (item) {
      html += '<div class="field-item"><span class="fl">' + escapeHtml(item[0]) + '</span><span class="fv">' + escapeHtml(item[1]) + '</span></div>';
    });
    html += '</div></div></section>';
    return html;
  }

  function render(project) {
    var input = project && typeof project === "object" ? project : { name: "未命名分享项目", patents: [], sources: [], moduleConfig: {}, aiAnalysis: {} };
    var modules = window.PatentShareModules;
    var config = modules ? modules.resolveConfig(input.moduleConfig) : { modules: { S1: "full", S2: "full", S3: "full", S4: "lite", S5: "off", S7: "full", R1: "full", R6: "full" }, moduleOrder: { processed: ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"] } };
    var patents = Array.isArray(input.patents) ? input.patents : [];
    var generatedAt = new Date().toISOString();
    var projectName = input.name || "未命名分享项目";
    var html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml(projectName) + '</title><style>' + CSS + EXTRA_CSS + '</style></head><body>';
    html += '<div class="progress-bar"></div>';
    html += '<nav class="topnav"><span class="brand">' + escapeHtml(projectName) + '</span><span class="spacer"></span>';
    html += '<button class="nav-btn" onclick="window.print()">打印 / 导出PDF</button>';
    html += '</nav>';
    html += '<div class="layout">';
    // 左侧分栏：专利列表导航
    html += '<aside class="sidebar"><button class="sidebar-toggle" type="button" aria-expanded="true" aria-label="收起专利侧栏">收起专利侧栏</button><span class="sidebar-edge-trigger" title="悬浮展开专利侧栏" aria-hidden="true">›</span>';
    if (moduleEnabled(config, "S1")) {
      html += '<div class="cover" style="margin:0 0 14px;padding:18px 16px;border-radius:10px"><h1 style="font-size:16px;margin:0 0 4px">' + escapeHtml(projectName) + '</h1><p class="subtitle" style="font-size:11px">专利技术分享报告</p><div class="meta-row" style="margin-top:10px"><span class="chip">' + patents.length + ' 篇</span><span class="chip">' + escapeHtml(generatedAt.slice(0, 10)) + '</span></div></div>';
    }
    html += '<div class="sidebar-section"><h4>专利列表</h4>';
    if (patents.length) {
      patents.forEach(function (record, index) {
        html += '<button class="patent-nav-item' + (index === 0 ? ' active' : '') + '" data-patent-index="' + index + '" title="' + escapeHtml(record.title || "") + '">';
        html += '<span class="pn-num">' + escapeHtml(record.patentNumber) + '</span>';
        html += '<span class="pn-title">' + escapeHtml(record.title || "未提供标题") + '</span>';
        html += '</button>';
      });
    } else {
      html += '<p class="missing" style="padding:6px">尚未加入专利</p>';
    }
    html += '</div>';
    html += '</aside>';
    // 右侧内容：三大标签页
    html += '<main class="content">';
    html += renderShareAttributes(input.shareAttributes);
    if (!patents.length) {
      // 无专利时仍渲染项目级研发结论（R1/R6），便于在加入专利前先整理研发结论
      var projectBlocks = renderProjectResearchBlocks(input, config);
      if (projectBlocks) {
        html += '<div class="tabs">';
        html += '<button class="tab active" data-tab="processed">加工信息</button>';
        html += '</div>';
        html += '<div class="patent-panels active" data-patent-index="0">';
        html += '<div class="panel" data-panel="processed">';
        html += projectBlocks;
        html += '</div></div>';
      } else {
        html += '<p class="notice">当前项目没有可分享的专利材料。</p>';
      }
    } else {
      html += '<div class="tabs">';
      html += '<button class="tab active" data-tab="basic">基础信息</button>';
      html += '<button class="tab" data-tab="source">原文信息</button>';
      html += '<button class="tab" data-tab="processed">加工信息</button>';
      html += '</div>';
      patents.forEach(function (record, index) { html += renderPatentPanels(record, config, input, index); });
    }
    html += '</main>';
    html += '</div>';
    html += '<button class="back-to-top" title="返回顶部" aria-label="返回顶部">↑</button>';
    html += '<div class="lightbox"><span class="lb-close" role="button" tabindex="0" aria-label="关闭附图预览">×</span><div class="lb-toolbar" role="toolbar" aria-label="附图操作"><button type="button" data-lb-action="zoom-out" title="缩小">−</button><button type="button" data-lb-action="zoom-in" title="放大">＋</button><button type="button" data-lb-action="reset" title="重置">100%</button><button type="button" data-lb-action="rotate-left" title="向左旋转">↶</button><button type="button" data-lb-action="rotate-right" title="向右旋转">↷</button><span class="lb-scale">100%</span></div><div class="lb-stage"><img alt="附图预览" /></div></div>';
    html += '<div class="patentlens-watermark" aria-hidden="true">由 <span class="wl-brand">PatentLens</span> 制作</div>';
    html += '<script>' + JS + EXTRA_JS + '<\/script>';
    html += '</body></html>';
    var findings = scanSensitive(input, html);
    var conflicts = findPendingConflicts(input);
    if (conflicts.length) findings.push("存在 " + conflicts.length + " 个未确认字段冲突");
    var unreviewedAI = findUnreviewedAI(input);
    if (unreviewedAI.length) findings.push("存在 " + unreviewedAI.length + " 项未审核 AI 内容");
    return { html: html, config: config, findings: findings, size: html.length };
  }

  window.PatentShareRenderer = { render: render, scanSensitive: scanSensitive, findPendingConflicts: findPendingConflicts, findUnreviewedAI: findUnreviewedAI, escapeHtml: escapeHtml, escapeJson: escapeJson, renderMarkdownSimple: renderMarkdownSimple };
})();
