/* PatentLens - AI claim-to-description support analysis. */
var ClaimSupportAnalysis = (function () {
  "use strict";
  var state = { results: {}, running: {} };
  var MAX_DESCRIPTION_CHARS = 90000;

  function esc(value) { var div = document.createElement("div"); div.textContent = String(value || ""); return div.innerHTML; }
  function root(scope) { return scope === "popup" ? document.querySelector("#ppv-content") : document.querySelector("#patent-detail-content"); }
  function patentData(scope) { return scope === "popup" ? window._patentPopupData : window._currentPatentData; }
  function key(scope, claim) { var data = patentData(scope) || {}; return scope + ":" + (data.patent_number || data.publication_number || "unknown") + ":" + (claim.num || claim._idx || "0"); }
  function normalizeId(value) { var digits = String(value || "").replace(/\D/g, ""); return digits ? String(Number(digits)).padStart(4, "0") : ""; }

  function paragraphs(description) {
    var text = String(description || "").replace(/\r\n/g, "\n"), result = [];
    var re = /(?:^|\n\s*)(?:\[?(\d{3,5})\]?\s*)?([\s\S]*?)(?=\n\s*(?:\[?\d{3,5}\]?\s*)|\n\s*\n|$)/g, match;
    while ((match = re.exec(text))) {
      var body = (match[2] || "").trim();
      if (body) result.push({ id: match[1] ? normalizeId(match[1]) : String(result.length + 1).padStart(4, "0"), text: body });
    }
    return result.length ? result : (text.trim() ? [{ id: "0001", text: text.trim() }] : []);
  }

  function sourceText(description) {
    var text = paragraphs(description).map(function (p) { return "[" + p.id + "] " + p.text; }).join("\n");
    return text.length > MAX_DESCRIPTION_CHARS ? text.slice(0, MAX_DESCRIPTION_CHARS) + "\n[TRUNCATED]" : text;
  }

  function prompt() {
    return [
      "你是专利说明书支撑关系分析助手。任务是帮助人工核查权利要求的每个技术特征可在说明书何处找到文字依据。",
      "这不是法律意见：不得判断充分公开、支持性或有效性，只能定位文本证据并说明对应程度。",
      "必须只引用输入中存在的段落号，paragraph 必须是形如 0020 的编号。quote 必须逐字摘自该段落；找不到时 evidence 为空、status 为 missing。",
      "按权利要求的自然技术限定拆分 features，不得遗漏限定。每一项 claimText 必须逐字来自权利要求。",
      "只输出 JSON，不要 Markdown 或其他文字：",
      '{"features":[{"id":"F1","claimText":"权利要求中的原文片段","label":"前序/部件/关系/功能/参数/从属限定","status":"strong|partial|missing","evidence":[{"paragraph":"0020","quote":"说明书原文摘录","explanation":"对应理由"}]}],"summary":"供人工核查的简短说明"}'
    ].join("\n");
  }

  function extractJson(raw) {
    var text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    var start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("AI 未返回可解析的结构化结果");
    return JSON.parse(text.slice(start, end + 1));
  }

  function normalizeForMatch(value) { return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, ""); }

  function validateResult(raw, description, claimText) {
    var paraMap = {}, validStatuses = { strong: true, partial: true, missing: true };
    paragraphs(description).forEach(function (paragraph) { paraMap[paragraph.id] = paragraph; });
    var features = Array.isArray(raw && raw.features) ? raw.features : [];
    if (!features.length) throw new Error("AI 未识别出可核查的技术特征");
    var claimSource = normalizeForMatch(claimText);
    var verifiedFeatures = features.slice(0, 20).filter(function (feature) {
      var text = normalizeForMatch(feature && feature.claimText);
      return text && claimSource.indexOf(text) !== -1;
    });
    if (!verifiedFeatures.length) throw new Error("AI 返回的技术特征无法在当前权利要求原文中验证");
    return { features: verifiedFeatures.map(function (feature, index) {
      var evidence = (Array.isArray(feature.evidence) ? feature.evidence : []).map(function (item) {
        var id = normalizeId(item.paragraph); if (!paraMap[id]) return null;
        return { paragraph: paraMap[id], quote: String(item.quote || ""), explanation: String(item.explanation || "") };
      }).filter(Boolean).slice(0, 4);
      return { id: String(feature.id || "F" + (index + 1)), claimText: String(feature.claimText || ""), label: String(feature.label || "技术特征"), status: validStatuses[feature.status] ? feature.status : (evidence.length ? "partial" : "missing"), evidence: evidence };
    }), summary: String(raw.summary || "AI 已按技术特征定位说明书证据，请结合原文人工核查。") };
  }

  function statusLabel(status) { return { strong: "明确对应", partial: "部分对应", missing: "待核查" }[status] || "待核查"; }
  function selectClaim(scope, index) { var panel = root(scope); if (panel) panel.querySelectorAll(".pd-claim-item").forEach(function (item) { item.classList.toggle("claim-support-selected", Number(item.dataset.claimIndex) === Number(index)); }); }
  function activateDescription(scope) { var panel = root(scope); if (!panel) return; panel.querySelectorAll(".pd-bookmark-tab").forEach(function (tab) { tab.classList.toggle("active", tab.dataset.tab === "description"); }); panel.querySelectorAll(".pd-tab-panel").forEach(function (item) { item.classList.toggle("active", item.dataset.panel === "description"); }); }
  function jump(scope, id) {
    var panel = root(scope), wanted = normalizeId(id), target = null; if (!panel) return;
    if (typeof DescriptionSummary !== "undefined" && DescriptionSummary.ensureParagraphs) {
      try { DescriptionSummary.ensureParagraphs(scope); } catch (_) {}
    }
    panel.querySelectorAll(".pd-para-num").forEach(function (el) { if (normalizeId(el.textContent) === wanted) target = el; });
    if (!target) return; var paragraph = target.closest("p") || target;
    paragraph.scrollIntoView({ behavior: "smooth", block: "center" }); paragraph.classList.remove("claim-support-highlight"); void paragraph.offsetWidth; paragraph.classList.add("claim-support-highlight"); setTimeout(function () { paragraph.classList.remove("claim-support-highlight"); }, 2400);
  }
  function renderEvidenceText(text, quote) {
    var source = String(text || ""), selected = String(quote || "").trim();
    if (!selected || source.indexOf(selected) < 0) return esc(source.slice(0, 360));
    var index = source.indexOf(selected), start = Math.max(0, index - 70), end = Math.min(source.length, index + selected.length + 120);
    return esc((start ? "..." : "") + source.slice(start, index)) + "<mark>" + esc(selected) + "</mark>" + esc(source.slice(index + selected.length, end) + (end < source.length ? "..." : ""));
  }

  function render(scope, claim, result) {
    var panel = root(scope), body = panel && panel.querySelector(".claim-support-body"); if (!body) return;
    if (!result) {
      body.innerHTML = '<div class="claim-support-empty"><b>准备 AI 分析</b><span>保留左侧权利要求原文；AI 将在右侧拆解技术特征，并逐项给出说明书段落证据。</span><button class="btn-primary claim-support-run">开始 AI 分析</button></div>';
      body.querySelector(".claim-support-run").addEventListener("click", function () { run(scope, claim); }); return;
    }
    var counts = { strong: 0, partial: 0, missing: 0 }; result.features.forEach(function (item) { counts[item.status]++; });
    var html = '<div class="claim-support-summary"><b>AI 证据链</b><span class="strong">明确对应 ' + counts.strong + '</span><span class="partial">部分对应 ' + counts.partial + '</span><span class="missing">待核查 ' + counts.missing + '</span></div><p class="claim-support-ai-summary">' + esc(result.summary) + '</p>';
    result.features.forEach(function (feature, index) {
      html += '<article class="claim-support-feature ' + feature.status + '"><div class="claim-support-feature-head"><span class="claim-support-index">' + (index + 1) + '</span><span class="claim-support-kind">' + esc(feature.label) + '</span><span class="claim-support-status">' + statusLabel(feature.status) + '</span></div><div class="claim-support-feature-text">' + esc(feature.claimText) + '</div>';
      if (feature.evidence.length) { html += '<div class="claim-support-evidence">'; feature.evidence.forEach(function (item) { html += '<button class="claim-support-evidence-item" data-para="' + esc(item.paragraph.id) + '"><b>[' + esc(item.paragraph.id) + ']</b><span>' + renderEvidenceText(item.paragraph.text, item.quote) + '</span><small>' + esc(item.explanation) + '</small></button>'; }); html += '</div>'; }
      else html += '<div class="claim-support-no-evidence">AI 未定位到可引用的说明书原文，请人工核查。</div>';
      html += '</article>';
    });
    body.innerHTML = html;
    body.querySelectorAll(".claim-support-evidence-item").forEach(function (button) { button.addEventListener("click", function () { activateDescription(scope); setTimeout(function () { jump(scope, button.dataset.para); }, 80); }); });
  }

  async function run(scope, claim) {
    var id = key(scope, claim), data = patentData(scope) || {}, panel = root(scope), body = panel && panel.querySelector(".claim-support-body");
    if (!data.description) { if (body) body.innerHTML = '<div class="claim-support-error">该专利没有可用于分析的说明书原文。</div>'; return; }
    if (!window.AI || !window.AI.loadAIConfig || !window.AI.streamChat) { if (body) body.innerHTML = '<div class="claim-support-error">AI 功能未加载。</div>'; return; }
    var config = window.AI.loadAIConfig(), provider = window.AI.getCurrentProvider(config);
    if (!provider || !provider.apiKey) { if (body) body.innerHTML = '<div class="claim-support-error">请先在设置中配置并选择 AI 模型。</div>'; return; }
    if (state.running[id]) return; state.running[id] = true;
    if (body) body.innerHTML = '<div class="claim-support-loading"><span></span>AI 正在拆解技术特征并核对说明书段落…</div>';
    try {
      var content = "【权利要求 " + (claim.num || "") + "】\n" + (claim.text || "") + "\n\n【说明书段落】\n" + sourceText(data.description), output = "";
      var stream = window.AI.streamChat(provider.type, provider.apiKey, provider.baseUrl, { model: provider.model, messages: [{ role: "system", content: prompt() }, { role: "user", content: content }], temperature: 0.1, maxTokens: 6000 });
      for await (var chunk of stream) if (chunk.content) output += chunk.content;
      state.results[id] = validateResult(extractJson(output), data.description, claim.text); render(scope, claim, state.results[id]);
    } catch (error) {
      if (body) body.innerHTML = '<div class="claim-support-error">AI 分析失败：' + esc(error && error.message ? error.message : String(error)) + '<button class="claim-support-retry">重试</button></div>';
      var retry = panel && panel.querySelector(".claim-support-retry"); if (retry) retry.addEventListener("click", function () { run(scope, claim); });
    } finally { state.running[id] = false; }
  }

  function open(scope, index) {
    var panel = root(scope), data = patentData(scope) || {}, claims = data.claims || [], box = panel && panel.querySelector(".claim-support-panel"), body = panel && panel.querySelector('.pd-tab-panel-body[data-panel-body="claims"]');
    if (!box || !claims[index]) return; box.classList.add("active"); body.classList.add("claim-support-mode");
    var select = box.querySelector(".claim-support-select"); select.value = String(index); selectClaim(scope, index); render(scope, claims[index], state.results[key(scope, claims[index])]);
  }

  function enhance() {
    ["detail", "popup"].forEach(function (scope) {
      var panel = root(scope); if (!panel) return;
      var claimsPanel = panel.querySelector('.pd-tab-panel[data-panel="claims"]'), actions = claimsPanel && claimsPanel.querySelector(".pd-panel-actions"); if (!actions || actions.querySelector(".claim-support-open")) return;
      var body = claimsPanel.querySelector('.pd-tab-panel-body[data-panel-body="claims"]'), claims = (patentData(scope) || {}).claims || [];
      var button = document.createElement("button"); button.className = "pd-compare-btn claim-support-open"; button.textContent = "权利要求支撑"; button.title = "使用 AI 定位权利要求技术特征在说明书中的文本证据"; actions.insertBefore(button, actions.firstChild);
      var box = document.createElement("section"); box.className = "claim-support-panel"; box.innerHTML = '<div class="claim-support-toolbar"><b>AI 权利要求支撑</b><select class="claim-support-select"></select><button class="claim-support-close" title="关闭分析视图">关闭</button></div><p class="claim-support-note">AI 按技术特征引用说明书原文，结果供人工核查，不构成法律上的支持性或充分公开结论。</p><div class="claim-support-body"></div>'; body.insertBefore(box, body.firstChild);
      var select = box.querySelector(".claim-support-select"); claims.forEach(function (claim, index) { var option = document.createElement("option"); option.value = index; option.textContent = "权利要求 " + (claim.num || index + 1); select.appendChild(option); });
      button.addEventListener("click", function () { open(scope, Number(select.value || 0)); }); select.addEventListener("change", function () { open(scope, Number(this.value)); });
      box.querySelector(".claim-support-close").addEventListener("click", function () { box.classList.remove("active"); body.classList.remove("claim-support-mode"); panel.querySelectorAll(".pd-claim-item").forEach(function (item) { item.classList.remove("claim-support-selected"); }); });
      panel.querySelectorAll(".pd-claim-item").forEach(function (item) { item.addEventListener("click", function (event) { if (!box.classList.contains("active") || event.target.closest("button")) return; open(scope, Number(item.dataset.claimIndex)); }); });
    });
  }

  var observer = typeof MutationObserver === "function" ? new MutationObserver(enhance) : null;
  function init() { if (observer) observer.observe(document.body, { childList: true, subtree: true }); enhance(); }
  return { init: init, paragraphs: paragraphs, validateResult: validateResult, extractJson: extractJson, sourceText: sourceText };
})();
if (typeof document !== "undefined") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ClaimSupportAnalysis.init); else ClaimSupportAnalysis.init(); }
