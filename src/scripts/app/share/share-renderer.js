/*!
 * PatentLens - 专利分享离线 HTML 渲染器
 *
 * 输入为项目快照和声明式模块配置，输出不依赖网络的 HTML。所有外部文本
 * 先转义；该模块不执行 Markdown、用户 HTML 或用户脚本。
 */
(function () {
  "use strict";

  var CSS = "body{margin:0;background:#f5f7fa;color:#1f2937;font:15px/1.65 system-ui,-apple-system,Segoe UI,Microsoft YaHei,sans-serif}main{max-width:1040px;margin:0 auto;padding:40px 24px}header{padding:36px 0 24px;border-bottom:1px solid #d8dee8}h1{margin:0 0 8px;font-size:30px;line-height:1.25}h2{margin:34px 0 12px;padding-top:10px;border-top:1px solid #d8dee8;font-size:21px}h3{margin:22px 0 8px;font-size:17px}.meta,.source,.missing{color:#667085;font-size:13px}.source{margin-top:8px}.patent{margin:22px 0;padding:20px;background:#fff;border:1px solid #d8dee8;border-radius:8px}.field{margin:10px 0}.label{display:inline-block;min-width:92px;color:#667085;font-size:13px;vertical-align:top}.value{display:inline;white-space:pre-wrap;overflow-wrap:anywhere}.claim{margin:8px 0;padding:10px 12px;background:#f8fafc;border-left:3px solid #2b7fff;white-space:pre-wrap}.toc{padding:14px 18px;background:#fff;border:1px solid #d8dee8;border-radius:8px}.toc a{display:block;color:#1769aa;text-decoration:none;margin:4px 0}.notice{padding:12px 14px;background:#fff8e6;border-left:3px solid #e5a100}.footer{margin-top:38px;padding-top:16px;border-top:1px solid #d8dee8;color:#667085;font-size:12px}@media(max-width:640px){main{padding:24px 16px}h1{font-size:25px}.label{display:block;margin-bottom:2px}}";

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
  function valueHtml(record, name, label) {
    var item = field(record, name);
    if (!item) return '<div class="field"><span class="label">' + escapeHtml(label) + '</span><span class="missing">来源未提供</span></div>';
    var state = item.reviewState === "conflict" ? " · 待确认冲突" : "";
    return '<div class="field"><span class="label">' + escapeHtml(label) + '</span><span class="value">' + escapeHtml(item.value) + '</span><span class="source">' + escapeHtml(item.source || "unknown") + escapeHtml(state) + '</span></div>';
  }
  function moduleEnabled(config, id) { return config.modules[id] && config.modules[id] !== "off"; }
  function moduleMode(config, id) { return config.modules[id] || "off"; }
  function moduleHeading(id, label) { return '<h2 id="module-' + escapeHtml(id) + '">' + escapeHtml(label) + '</h2>'; }

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

  function renderPatent(record, config, index) {
    var html = '<article class="patent" id="patent-' + index + '">';
    html += '<h3>' + escapeHtml(record.patentNumber) + ' · ' + escapeHtml(record.title || "未提供标题") + '</h3>';
    if (moduleEnabled(config, "S2")) {
      html += valueHtml(record, "title", "标题") + valueHtml(record, "publicationDate", "公开日") + valueHtml(record, "assignees", "申请人");
      if (moduleMode(config, "S2") === "full") {
        html += valueHtml(record, "applicationDate", "申请日") + valueHtml(record, "priorityDate", "优先权日") + valueHtml(record, "inventors", "发明人");
        Object.keys(record.customFields && typeof record.customFields === "object" ? record.customFields : {}).forEach(function (key) {
          var custom = record.customFields[key];
          if (custom && custom.field) html += valueHtml({ fields: { custom: custom.field } }, "custom", custom.label || key);
        });
      }
    }
    if (moduleEnabled(config, "S3")) {
      var abstractField = field(record, "abstract");
      var abstract = abstractField && abstractField.value;
      if (abstract && moduleMode(config, "S3") === "lite" && abstract.length > 360) abstract = abstract.slice(0, 360) + "…";
      html += '<h3>技术摘要</h3>' + (abstract ? '<p class="value">' + escapeHtml(abstract) + '</p>' : '<p class="missing">来源未提供摘要</p>');
    }
    if (moduleEnabled(config, "S4")) {
      html += '<h3>权利要求</h3>';
      var claims = Array.isArray(record.claims) ? record.claims : [];
      if (moduleMode(config, "S4") === "lite") {
        var independent = claims.filter(function (claim) { return claim && claim.type === "independent"; });
        claims = independent.length ? independent.slice(0, 1) : claims.slice(0, 1);
      }
      if (claims.length) claims.forEach(function (claim) { html += '<div class="claim">' + escapeHtml((claim.number ? claim.number + ". " : "") + claim.text) + '</div>'; });
      else html += '<p class="missing">来源未提供权利要求</p>';
    }
    if (moduleEnabled(config, "S5")) {
      var source = record.source || {};
      html += '<div class="source">来源：' + escapeHtml(source.label || source.type || "未标记") + ' · 抓取时间：' + escapeHtml(source.capturedAt || "未记录") + '</div>';
    }
    html += '</article>';
    return html;
  }

  function render(project) {
    var input = project && typeof project === "object" ? project : { name: "未命名分享项目", patents: [], sources: [], moduleConfig: {} };
    var modules = window.PatentShareModules;
    var config = modules ? modules.resolveConfig(input.moduleConfig) : { modules: { S1: "full", S2: "full", S3: "full", S4: "lite", S5: "full" } };
    var patents = Array.isArray(input.patents) ? input.patents : [];
    var html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml(input.name || "专利分享") + '</title><style>' + CSS + '</style></head><body><main>';
    html += '<header><h1>' + escapeHtml(input.name || "未命名分享项目") + '</h1><p class="meta">专利分享 · ' + patents.length + ' 篇 · 生成时间 ' + escapeHtml(new Date().toISOString()) + '</p></header>';
    if (moduleEnabled(config, "S1")) {
      html += moduleHeading("S1", "目录");
      html += '<nav class="toc">' + (patents.length ? patents.map(function (record, index) { return '<a href="#patent-' + index + '">' + escapeHtml(record.patentNumber + " · " + (record.title || "未提供标题")) + '</a>'; }).join("") : '<span class="missing">项目尚未加入专利</span>') + '</nav>';
    }
    if (!patents.length) html += '<p class="notice">当前项目没有可分享的专利材料。</p>';
    if (patents.length && moduleEnabled(config, "S2")) html += moduleHeading("S2", "专利资料");
    patents.forEach(function (record, index) { html += renderPatent(record, config, index); });
    if (moduleEnabled(config, "S5")) html += '<footer class="footer">来源内容来自项目快照；仅供技术沟通，不构成法律意见。AI 内容（如有）应另行标注并人工核验。</footer>';
    html += '</main></body></html>';
    var findings = scanSensitive(input, html);
    var conflicts = findPendingConflicts(input);
    if (conflicts.length) findings.push("存在 " + conflicts.length + " 个未确认字段冲突");
    return { html: html, config: config, findings: findings, size: html.length };
  }

  window.PatentShareRenderer = { render: render, scanSensitive: scanSensitive, findPendingConflicts: findPendingConflicts, escapeHtml: escapeHtml, escapeJson: escapeJson };
})();
