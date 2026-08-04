/*!
 * PatentLens - 专利分享离线 HTML 渲染器
 *
 * 输入为项目快照和声明式模块配置，输出不依赖网络的 HTML。所有外部文本
 * 先转义；该模块不执行 Markdown、用户 HTML 或用户脚本。
 */
(function () {
  "use strict";

  var CSS = "body{margin:0;background:#f5f7fa;color:#1f2937;font:15px/1.65 system-ui,-apple-system,Segoe UI,Microsoft YaHei,sans-serif}main{max-width:1040px;margin:0 auto;padding:40px 24px}header{padding:36px 0 24px;border-bottom:1px solid #d8dee8}h1{margin:0 0 8px;font-size:30px;line-height:1.25}h2{margin:34px 0 12px;padding-top:10px;border-top:1px solid #d8dee8;font-size:21px}h3{margin:22px 0 8px;font-size:17px}h4{margin:16px 0 6px;font-size:15px}.meta,.source,.missing,.ai-badge{color:#667085;font-size:13px}.source{margin-top:8px}.patent{margin:22px 0;padding:20px;background:#fff;border:1px solid #d8dee8;border-radius:8px;page-break-inside:avoid}.field{margin:10px 0}.label{display:inline-block;min-width:92px;color:#667085;font-size:13px;vertical-align:top}.value{display:inline;white-space:pre-wrap;overflow-wrap:anywhere}.claim{margin:8px 0;padding:10px 12px;background:#f8fafc;border-left:3px solid #2b7fff;white-space:pre-wrap}.claim.independent{border-left-color:#e53935;background:#fff5f5}.claim.dependent{border-left-color:#fb8c00}.claim-refs{margin-top:4px;font-size:12px;color:#667085}.claim-refs a{color:#1769aa;text-decoration:none}.claim-refs a:hover{text-decoration:underline}.description-block{margin:12px 0;padding:14px 16px;background:#f8fafc;border:1px solid #d8dee8;border-radius:6px;white-space:pre-wrap;line-height:1.7;max-height:600px;overflow:auto;font-size:14px}.ocr-excerpt{max-height:360px;overflow:auto;padding:12px;background:#f8fafc;border:1px solid #d8dee8;white-space:pre-wrap;font:13px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}.toc{padding:14px 18px;background:#fff;border:1px solid #d8dee8;border-radius:8px}.toc a{display:block;color:#1769aa;text-decoration:none;margin:4px 0}.toc a:hover{text-decoration:underline}.notice{padding:12px 14px;background:#fff8e6;border-left:3px solid #e5a100}.footer{margin-top:38px;padding-top:16px;border-top:1px solid #d8dee8;color:#667085;font-size:12px}.ai-section{margin:16px 0;padding:16px;background:linear-gradient(135deg,#f0f9ff 0%,#eff6ff 100%);border:1px solid #bfdbfe;border-radius:8px}.ai-badge{display:inline-block;padding:2px 8px;background:#3b82f6;color:#fff;border-radius:4px;font-size:11px;font-weight:500;margin-right:6px}.ai-meta{font-size:12px;color:#64748b;margin-top:8px}.tech-elements{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin:12px 0}.tech-card{padding:12px;background:#fff;border:1px solid #e2e8f0;border-radius:6px}.tech-card h5{margin:0 0 8px;font-size:13px;color:#475569}.tech-card ul{margin:0;padding-left:18px;font-size:13px}.param-table,.cite-table,.family-table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}.param-table th,.cite-table th,.family-table th{text-align:left;padding:8px 10px;background:#f1f5f9;border-bottom:2px solid #cbd5e1}.param-table td,.cite-table td,.family-table td{padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top}.compare-matrix{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px;overflow-x:auto;display:block}.compare-matrix th,.compare-matrix td{padding:10px 12px;border:1px solid #e2e8f0;text-align:left;min-width:120px}.compare-matrix th{background:#f8fafc;font-weight:600}.back-citation{color:#059669}.forward-citation{color:#dc2626}.classification-tag{display:inline-block;padding:2px 8px;margin:2px;background:#e0e7ff;color:#3730a3;border-radius:4px;font-size:12px}@media(max-width:640px){main{padding:24px 16px}h1{font-size:25px}.label{display:block;margin-bottom:2px}.tech-elements{grid-template-columns:1fr}}";

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
      html += '<div class="claim ' + typeClass + '" id="' + claimId + '">';
      html += '<strong>' + escapeHtml(claim.number || "") + '.</strong> ';
      if (claim.type === "independent") html += '<span style="color:#e53935;font-size:12px;margin-right:4px">[独立]</span>';
      else if (claim.type === "dependent") html += '<span style="color:#fb8c00;font-size:12px;margin-right:4px">[从属]</span>';
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
    return '<div class="description-block">' + escapeHtml(text) + '</div>';
  }

  function renderAISummary(patent, researchSummary, aiAnalysis, mode) {
    var hasSummary = researchSummary && (researchSummary.problem || researchSummary.approach || researchSummary.effect || researchSummary.openQuestions);
    var ai = aiAnalysis && aiAnalysis.summary;
    var html = '';
    if (ai && ai.content) {
      html += '<div class="ai-section">';
      html += '<span class="ai-badge">AI 生成</span>';
      html += '<span class="source">模型：' + escapeHtml(ai.model || "unknown") + ' · 生成时间：' + escapeHtml(ai.generatedAt || "") + '</span>';
      var content = ai.content;
      if (mode === "lite" && content.length > 2000) content = content.slice(0, 2000) + "\n\n...（精简模式已截断）";
      html += '<div class="ai-content">' + renderMarkdownSimple(content) + '</div>';
      html += '</div>';
    }
    if (hasSummary) {
      html += '<div style="margin-top:12px">';
      [["技术问题", researchSummary.problem], ["技术手段", researchSummary.approach], ["技术效果", researchSummary.effect], ["待验证问题", researchSummary.openQuestions]].forEach(function (item) {
        var text = cleanText(item[1]);
        if (text) {
          var display = mode === "lite" && text.length > 500 ? text.slice(0, 500) + "..." : text;
          html += '<div class="field"><span class="label">' + escapeHtml(item[0]) + '</span><span class="value">' + escapeHtml(display) + '</span></div>';
        }
      });
      html += '</div>';
    }
    if (!html) html += '<p class="missing">尚未生成或填写研发分析内容。可在「研发洞察」中AI自动生成或人工编辑。</p>';
    return html;
  }

  function renderTechElements(analysis, mode) {
    if (!analysis || !analysis.parsed) {
      if (analysis && analysis.content) return '<div class="ai-section"><span class="ai-badge">AI 生成</span><div>' + renderMarkdownSimple(analysis.content) + '</div></div>';
      return '<p class="missing">尚未生成技术要素分析。可在「研发洞察」中运行AI提取。</p>';
    }
    var data = analysis.parsed;
    var html = '<div class="ai-section"><span class="ai-badge">AI 提取</span>';
    if (data.components && data.components.length) {
      html += '<h4>核心部件/模块</h4><div class="tech-elements">';
      data.components.forEach(function (comp) {
        html += '<div class="tech-card"><h5>' + escapeHtml(comp.name || "未命名") + '</h5>';
        if (comp.role) html += '<p style="margin:4px 0;font-size:12px;color:#64748b">' + escapeHtml(comp.role) + '</p>';
        if (comp.keyFeatures && comp.keyFeatures.length) {
          html += '<ul>' + comp.keyFeatures.map(function (f) { return '<li>' + escapeHtml(f) + '</li>'; }).join("") + '</ul>';
        }
        html += '</div>';
      });
      html += '</div>';
    }
    if (data.steps && data.steps.length && mode !== "lite") {
      html += '<h4>方法步骤</h4><ol>';
      data.steps.forEach(function (step) {
        html += '<li><strong>' + escapeHtml(step.action || "") + '</strong>';
        if (step.input || step.output) html += ' <span style="color:#64748b;font-size:12px">(';
        if (step.input) html += '输入: ' + escapeHtml(step.input);
        if (step.input && step.output) html += ' → ';
        if (step.output) html += '输出: ' + escapeHtml(step.output);
        if (step.input || step.output) html += ')</span>';
        html += '</li>';
      });
      html += '</ol>';
    }
    if (data.parameters && data.parameters.length) {
      html += '<h4>关键参数</h4><table class="param-table"><tr><th>参数</th><th>范围/取值</th><th>单位</th><th>作用</th></tr>';
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
      html += '<h4>后向引证文献（本专利引用的先前文献）<span class="back-citation">(' + back.length + ')</span></h4>';
      html += '<table class="cite-table"><tr><th>专利号</th><th>标题</th><th>申请人</th><th>公开日</th></tr>';
      var backItems = mode === "lite" ? back.slice(0, 10) : back;
      backItems.forEach(function (c) {
        html += '<tr><td><strong>' + escapeHtml(c.number || "") + '</strong></td><td>' + escapeHtml(c.title || "") + '</td><td>' + escapeHtml(c.assignee || "") + '</td><td>' + escapeHtml(c.date || "") + '</td></tr>';
      });
      html += '</table>';
      if (mode === "lite" && back.length > 10) html += '<p class="missing">（精简模式仅显示前10项，共' + back.length + '项）</p>';
    }
    if (forward.length && mode !== "lite") {
      html += '<h4>前向引证文献（引用本专利的后续文献）<span class="forward-citation">(' + forward.length + ')</span></h4>';
      html += '<table class="cite-table"><tr><th>专利号</th><th>标题</th><th>申请人</th><th>公开日</th></tr>';
      forward.forEach(function (c) {
        html += '<tr><td><strong>' + escapeHtml(c.number || "") + '</strong></td><td>' + escapeHtml(c.title || "") + '</td><td>' + escapeHtml(c.assignee || "") + '</td><td>' + escapeHtml(c.date || "") + '</td></tr>';
      });
      html += '</table>';
    }
    return html;
  }

  function renderFamily(family, mode) {
    if (!family || !family.length) return '<p class="missing">来源未提供同族专利信息</p>';
    var html = '<table class="family-table"><tr><th>国家/地区</th><th>公开号</th><th>标题</th><th>公开日</th></tr>';
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
      return '<div class="ai-section"><span class="ai-badge">AI 多专利对比</span><div>' + renderMarkdownSimple(content) + '</div><div class="ai-meta">模型：' + escapeHtml(comp.model || "unknown") + ' · 涉及专利：' + (comp.patentIds ? comp.patentIds.length : project.patents.length) + ' 篇</div></div>';
    }
    if (project.patents.length < 2) return '<p class="missing">需要至少2篇专利才能生成技术路线对比。可在「研发洞察」中运行AI对比分析。</p>';
    var html = '<div style="overflow-x:auto"><table class="compare-matrix"><tr><th>维度</th>';
    project.patents.forEach(function (p) { html += '<th>' + escapeHtml(p.patentNumber) + '</th>'; });
    html += '</tr>';
    [["标题", "title"], ["技术问题", "problem"], ["申请人", "assignee"], ["公开日", "publicationDate"]].forEach(function (row) {
      html += '<tr><td><strong>' + escapeHtml(row[0]) + '</strong></td>';
      project.patents.forEach(function (p) {
        var val = "";
        if (row[1] === "title") val = p.title || "";
        else if (row[1] === "assignee" && p.fields && p.fields.assignees) val = p.fields.assignees.value || "";
        else if (row[1] === "publicationDate" && p.fields && p.fields.publicationDate) val = p.fields.publicationDate.value || "";
        else if (p.aiAnalysis && p.aiAnalysis.summary && p.aiAnalysis.summary.content) {
          var match = p.aiAnalysis.summary.content.match(new RegExp("##\\s*[一二]?、?\\s*" + row[1] + "\\s*\\n([\\s\\S]*?)(?=\\n##|$)", "i"));
          if (match) val = match[1].slice(0, 200);
        }
        html += '<td>' + escapeHtml(val || "未提供") + '</td>';
      });
      html += '</tr>';
    });
    html += '</table></div>';
    html += '<p class="source" style="margin-top:8px">基础对比（基于现有数据）。可在「研发洞察」中运行AI生成深度对比分析。</p>';
    return html;
  }

  function renderPatent(record, config, index, project) {
    var html = '<article class="patent" id="patent-' + index + '">';
    html += '<h3 id="patent-heading-' + index + '">' + escapeHtml(record.patentNumber) + ' · ' + escapeHtml(record.title || "未提供标题") + '</h3>';
    if (moduleEnabled(config, "S2")) {
      html += valueHtml(record, "title", "标题");
      if (record.classifications && record.classifications.length) {
        html += '<div class="field"><span class="label">IPC/CPC</span><span class="value">';
        html += record.classifications.map(function (c) { return '<span class="classification-tag">' + escapeHtml(c) + '</span>'; }).join(" ");
        html += '</span></div>';
      }
      html += valueHtml(record, "publicationDate", "公开日") + valueHtml(record, "assignees", "申请人");
      if (moduleMode(config, "S2") === "full") {
        html += valueHtml(record, "applicationDate", "申请日") + valueHtml(record, "priorityDate", "优先权日") + valueHtml(record, "inventors", "发明人");
        if (record.fields && record.fields.classifications && record.fields.classifications.value) {
          // already rendered above
        }
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
    if (moduleEnabled(config, "S5")) {
      html += '<h3>说明书</h3>';
      html += renderDescription(record.description, moduleMode(config, "S5"));
    }
    if (moduleEnabled(config, "S4")) {
      html += '<h3>权利要求书</h3>';
      html += '<div id="claims-list-' + index + '">';
      html += renderClaims(record.claims, config);
      html += '</div>';
    }
    if (moduleEnabled(config, "R1") && record.aiAnalysis && record.aiAnalysis.summary) {
      html += '<h3>AI 研发摘要</h3>';
      html += renderAISummary(record, null, record.aiAnalysis || {}, moduleMode(config, "R1"));
    }
    if (moduleEnabled(config, "R2")) {
      html += moduleHeading("R2", "技术要素与系统结构");
      var elementsAnalysis = record.aiAnalysis && record.aiAnalysis.elements;
      html += renderTechElements(elementsAnalysis, moduleMode(config, "R2"));
    }
    if (moduleEnabled(config, "R3")) {
      html += moduleHeading("R3", "关键参数与边界条件");
      var elementsForParams = record.aiAnalysis && record.aiAnalysis.elements;
      if (elementsForParams && elementsForParams.parsed && elementsForParams.parsed.parameters && elementsForParams.parsed.parameters.length) {
        html += '<table class="param-table"><tr><th>参数</th><th>范围/取值</th><th>单位</th><th>作用</th></tr>';
        elementsForParams.parsed.parameters.forEach(function (p) {
          html += '<tr><td>' + escapeHtml(p.name || "") + '</td><td>' + escapeHtml(p.range || "") + '</td><td>' + escapeHtml(p.unit || "") + '</td><td>' + escapeHtml(p.effect || "") + '</td></tr>';
        });
        html += '</table>';
        html += '<div class="ai-meta">来源：技术要素AI提取</div>';
      } else {
        html += '<p class="missing">请先在「研发洞察」中运行AI技术要素提取，关键参数将自动从权利要求和说明书中归纳。</p>';
      }
    }
    if (moduleEnabled(config, "R4")) {
      html += moduleHeading("R4", "实施例与验证证据");
      html += '<p class="missing">实施例归纳功能开发中。请在「数据审核」中补充说明书内容，后续版本将支持AI自动提取实施例和对比实验数据。</p>';
    }
    if (moduleEnabled(config, "R8")) {
      html += moduleHeading("R8", "引证文献与背景");
      html += renderCitations(record.citations, moduleMode(config, "R8"));
    }
    if (moduleEnabled(config, "R9")) {
      html += moduleHeading("R9", "同族与地域布局");
      html += renderFamily(record.family, moduleMode(config, "R9"));
    }
    if (moduleEnabled(config, "R7")) {
      html += '<h3>PDF OCR 原文摘录</h3>';
      var ocrSources = Array.isArray(record.ocrSources) ? record.ocrSources : [];
      if (ocrSources.length) ocrSources.forEach(function (source) {
        var excerpt = source.text || source.markdown || "";
        if (moduleMode(config, "R7") === "lite" && excerpt.length > 4000) excerpt = excerpt.slice(0, 4000) + "…";
        html += '<div class="source">' + escapeHtml(source.fileName || "PDF") + ' · ' + escapeHtml(source.engine || "OCR") + '</div><pre class="ocr-excerpt">' + escapeHtml(excerpt) + '</pre>';
      });
      else html += '<p class="missing">尚未关联 PDF OCR 材料</p>';
    }
    if (moduleEnabled(config, "S6")) {
      var source = record.source || {};
      html += '<div class="source">来源：' + escapeHtml(source.label || source.type || "未标记") + ' · 抓取时间：' + escapeHtml(source.capturedAt || "未记录") + '</div>';
    }
    html += '</article>';
    return html;
  }

  function render(project) {
    var input = project && typeof project === "object" ? project : { name: "未命名分享项目", patents: [], sources: [], moduleConfig: {}, aiAnalysis: {} };
    var modules = window.PatentShareModules;
    var config = modules ? modules.resolveConfig(input.moduleConfig) : { modules: { S1: "full", S2: "full", S3: "full", S4: "lite", S6: "full", R1: "full", R6: "full" } };
    var patents = Array.isArray(input.patents) ? input.patents : [];
    var html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml(input.name || "专利分享") + '</title><style>' + CSS + '</style></head><body><main>';
    html += '<header><h1>' + escapeHtml(input.name || "未命名分享项目") + '</h1><p class="meta">专利分享 · ' + patents.length + ' 篇 · 生成时间 ' + escapeHtml(new Date().toISOString()) + '</p></header>';
    if (moduleEnabled(config, "S1")) {
      html += moduleHeading("S1", "目录");
      html += '<nav class="toc">' + (patents.length ? patents.map(function (record, index) { return '<a href="#patent-' + index + '">' + escapeHtml(record.patentNumber + " · " + (record.title || "未提供标题")) + '</a>'; }).join("") : '<span class="missing">项目尚未加入专利</span>') + '</nav>';
    }
    if (moduleEnabled(config, "R5") && patents.length >= 2) {
      html += moduleHeading("R5", "多专利技术路线对比");
      html += renderMultiPatentComparison(input, input.aiAnalysis, moduleMode(config, "R5"));
    }
    if (moduleEnabled(config, "R1")) {
      var research = input.researchSummary && typeof input.researchSummary === "object" ? input.researchSummary : {};
      html += moduleHeading("R1", "研发问题-手段-效果");
      [["技术问题", research.problem], ["技术手段", research.approach], ["技术效果", research.effect], ["待验证问题", research.openQuestions]].forEach(function (item) {
        var text = cleanText(item[1]);
        if (text && moduleMode(config, "R1") === "lite" && text.length > 800) text = text.slice(0, 800) + "…";
        html += '<div class="field"><span class="label">' + escapeHtml(item[0]) + '</span>' + (text ? '<span class="value">' + escapeHtml(text) + '</span>' : '<span class="missing">尚未填写</span>') + '</div>';
      });
    }
    if (moduleEnabled(config, "R6")) {
      var research = input.researchSummary || {};
      if (research.openQuestions || research.problem || research.approach || research.effect) {
        // already rendered per-patent or in R1 for single
        if (patents.length > 1) {
          html += moduleHeading("R6", "研发启发与待验证问题");
          html += '<div class="ai-section">';
          if (research.openQuestions) html += '<div class="field"><span class="label">待验证问题</span><span class="value">' + escapeHtml(research.openQuestions) + '</span></div>';
          html += '</div>';
        }
      }
    }
    if (!patents.length) html += '<p class="notice">当前项目没有可分享的专利材料。</p>';
    if (patents.length) {
      if (moduleEnabled(config, "S2")) html += moduleHeading("S2", "专利资料");
      patents.forEach(function (record, index) { html += renderPatent(record, config, index, input); });
    }
    if (moduleEnabled(config, "S6")) html += '<footer class="footer">来源内容来自项目快照；仅供技术沟通，不构成法律意见。AI 生成内容已标注，请人工核验关键信息后再分享。</footer>';
    html += '</main></body></html>';
    var findings = scanSensitive(input, html);
    var conflicts = findPendingConflicts(input);
    if (conflicts.length) findings.push("存在 " + conflicts.length + " 个未确认字段冲突");
    return { html: html, config: config, findings: findings, size: html.length };
  }

  window.PatentShareRenderer = { render: render, scanSensitive: scanSensitive, findPendingConflicts: findPendingConflicts, escapeHtml: escapeHtml, escapeJson: escapeJson, renderMarkdownSimple: renderMarkdownSimple };
})();
