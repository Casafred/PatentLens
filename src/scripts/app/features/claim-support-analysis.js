/* PatentLens - AI claim-to-description support analysis. */
var ClaimSupportAnalysis = (function () {
  "use strict";
  var state = { results: {}, running: {}, selected: {}, activeIndex: {}, mode: {}, displayMode: {}, patentId: {} };
  var MAX_DESCRIPTION_CHARS = 90000;

  function esc(value) { var div = document.createElement("div"); div.textContent = String(value || ""); return div.innerHTML; }
  function root(scope) { return scope === "popup" ? document.querySelector("#ppv-content") : document.querySelector("#patent-detail-content"); }
  function patentData(scope) { return scope === "popup" ? window._patentPopupData : window._currentPatentData; }
  function key(scope, claim) { var data = patentData(scope) || {}; return scope + ":" + (data.patent_number || data.publication_number || "unknown") + ":" + (claim.num || claim._idx || "0"); }
  function claimCacheKey(claim) { return String(claim && (claim.num || claim._idx) || "0"); }
  function scopePatentId(scope) { var data = patentData(scope) || {}; return String(data.patent_number || data.publication_number || data.application_number || "unknown"); }
  function resetForPatent(scope) {
    var id = scopePatentId(scope);
    if (state.patentId[scope] === id) return;
    state.patentId[scope] = id;
    state.selected[scope] = [];
    state.activeIndex[scope] = 0;
    state.mode[scope] = "manual";
    state.displayMode[scope] = "translation";
  }
  function normalizeId(value) { var digits = String(value || "").replace(/\D/g, ""); return digits ? String(Number(digits)).padStart(4, "0") : ""; }
  function selectedIndexes(scope) { return state.selected[scope] || []; }
  function setSelected(scope, indexes) { state.selected[scope] = indexes.filter(function (value, index, all) { return Number.isInteger(value) && value >= 0 && all.indexOf(value) === index; }).sort(function (a, b) { return a - b; }); }
  function cacheKeyForData(data) {
    if (typeof GPCache === "undefined" || !GPCache.getAll) return "";
    var normalized = String(data && (data.patent_number || data.publication_number || data.application_number) || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
    var all = GPCache.getAll();
    return Object.keys(all).find(function (cacheKey) {
      var cached = all[cacheKey] && all[cacheKey].data;
      return cached === data || (normalized && String(cacheKey).replace(/[^a-z0-9]/gi, "").toUpperCase() === normalized);
    }) || "";
  }
  function restoreCachedResults(scope) {
    var data = patentData(scope) || {}, cached = data._claimSupportAnalysis;
    if (!cached || !cached.claims) return;
    (data.claims || []).forEach(function (claim) {
      var entry = cached.claims[claimCacheKey(claim)];
      if (entry && entry.claimText === String(claim.text || "") && entry.result) state.results[key(scope, claim)] = entry.result;
      else delete state.results[key(scope, claim)];
    });
  }
  function persistResult(scope, claim, result) {
    var data = patentData(scope) || {}, cacheKey = cacheKeyForData(data);
    if (!cacheKey) return;
    var saved = data._claimSupportAnalysis || { version: 1, claims: {} };
    saved.claims[claimCacheKey(claim)] = { claimText: String(claim.text || ""), result: result, savedAt: Date.now() };
    saved.updatedAt = Date.now();
    data._claimSupportAnalysis = saved;
    try { GPCache.set(cacheKey, data); } catch (error) { console.warn("[ClaimSupport] failed to cache analysis:", error); }
  }
  function isIndependentClaim(claim, index) {
    if (!claim) return false;
    if (claim._isIndependent === true || claim.type === "independent") return true;
    if (claim._isIndependent === false || claim.type === "dependent") return false;
    if (claim.dependent_on !== undefined && claim.dependent_on !== null && claim.dependent_on !== "" && claim.dependent_on !== false) return false;
    var head = String(claim.text || "").trim().slice(0, 300);
    if (/^(根据|如|按照|依据).*(权利要求|权项|claim|claims)/i.test(head) || /請求項\s*\d+/i.test(head) || /に記載/.test(head) || /のいずれか/.test(head) || /前記|所述的/.test(head.slice(0, 80)) || /\bclaim\s+\d+/i.test(head)) return false;
    return index === 0;
  }
  function allIndependentIndexes(claims) { return claims.map(function (claim, index) { return isIndependentClaim(claim, index) ? index : -1; }).filter(function (index) { return index >= 0; }); }

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
      "每个 claimText、quote、explanation 和 summary 都必须同时给出对应的中文译文（分别写入 claimTextZh、quoteZh、explanationZh 和 summaryZh）；原文已经是中文时，译文字段照抄原文。",
      "只输出 JSON，不要 Markdown 或其他文字：",
      '{"features":[{"id":"F1","claimText":"权利要求中的原文片段","claimTextZh":"该技术特征的中文译文（若原文已是中文则照抄）","label":"前序/部件/关系/功能/参数/从属限定","status":"strong|partial|missing","evidence":[{"paragraph":"0020","quote":"说明书原文摘录","quoteZh":"该证据摘录的中文译文（若原文已是中文则照抄）","explanation":"对应理由","explanationZh":"对应理由的中文译文"}]}],"summary":"供人工核查的简短说明","summaryZh":"供人工核查的中文简短说明"}'
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
        return { paragraph: paraMap[id], quote: String(item.quote || ""), quoteZh: String(item.quoteZh || item.quote || ""), explanation: String(item.explanation || ""), explanationZh: String(item.explanationZh || item.explanation || "") };
      }).filter(Boolean).slice(0, 4);
      return { id: String(feature.id || "F" + (index + 1)), claimText: String(feature.claimText || ""), claimTextZh: String(feature.claimTextZh || feature.claimText || ""), label: String(feature.label || "技术特征"), status: validStatuses[feature.status] ? feature.status : (evidence.length ? "partial" : "missing"), evidence: evidence };
    }), summary: String(raw.summary || "AI 已按技术特征定位说明书证据，请结合原文人工核查。"), summaryZh: String(raw.summaryZh || raw.summary || "AI 已按技术特征定位说明书证据，请结合原文人工核查。") };
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

  function renderSelection(scope) {
    var panel = root(scope), data = patentData(scope) || {}, claims = data.claims || [];
    var box = panel && panel.querySelector(".claim-support-panel"), host = box && box.querySelector(".claim-support-selection");
    if (!host) return;
    var mode = state.mode[scope] || "manual", selected = selectedIndexes(scope);
    var html = '<div class="claim-support-scope"><span>分析范围</span>';
    [["manual", "手动多选"], ["independent", "全部独权"], ["all", "全部权利要求"]].forEach(function (item) {
      html += '<button type="button" class="claim-support-scope-btn' + (mode === item[0] ? ' active' : '') + '" data-mode="' + item[0] + '">' + item[1] + '</button>';
    });
    html += '</div>';
    if (mode === "manual") {
      html += '<div class="claim-support-claim-picker">';
      claims.forEach(function (claim, index) {
        html += '<label><input type="checkbox" data-claim-index="' + index + '"' + (selected.indexOf(index) >= 0 ? ' checked' : '') + '> 权利要求 ' + esc(claim.num || index + 1) + '</label>';
      });
      html += '</div>';
    } else {
      html += '<div class="claim-support-selection-summary">已选择 <b>' + selected.length + '</b> 项' + (mode === "independent" ? '独立权利要求' : '权利要求') + '</div>';
    }
    html += '<button type="button" class="btn-primary claim-support-batch-run"' + (selected.length ? '' : ' disabled') + '>分析已选 ' + selected.length + ' 项</button>';
    host.innerHTML = html;
    host.querySelectorAll(".claim-support-scope-btn").forEach(function (button) {
      button.addEventListener("click", function () {
        var nextMode = button.dataset.mode; state.mode[scope] = nextMode;
        if (nextMode === "independent") setSelected(scope, allIndependentIndexes(claims));
        else if (nextMode === "all") setSelected(scope, claims.map(function (_claim, index) { return index; }));
        else if (!selectedIndexes(scope).length && claims.length) setSelected(scope, [state.activeIndex[scope] || 0]);
        renderSelection(scope);
      });
    });
    host.querySelectorAll("input[data-claim-index]").forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        var index = Number(this.dataset.claimIndex), next = selectedIndexes(scope).slice();
        if (this.checked && next.indexOf(index) === -1) next.push(index);
        if (!this.checked) next = next.filter(function (value) { return value !== index; });
        setSelected(scope, next); renderSelection(scope);
      });
    });
    var runButton = host.querySelector(".claim-support-batch-run");
    if (runButton) runButton.addEventListener("click", function () { runBatch(scope, selectedIndexes(scope)); });
  }

  function layoutPanel(scope) { return root(scope) && root(scope).querySelector('.pd-tab-panel[data-panel="claims"]'); }
  function updateLayoutMenu(scope) {
    var panel = layoutPanel(scope), menu = panel && panel.querySelector(".claim-support-layout-menu");
    if (!panel || !menu) return;
    var supportHidden = panel.classList.contains("claim-support-layout-hide-support"), claimsHidden = panel.classList.contains("claim-support-layout-hide-claims"), drawingsHidden = panel.classList.contains("claim-support-layout-hide-drawings");
    menu.innerHTML = '<button type="button" data-layout-target="claims">' + (claimsHidden ? "展开权利要求" : "折叠权利要求") + '</button><button type="button" data-layout-target="support">' + (supportHidden ? "展开 AI 支撑" : "折叠 AI 支撑") + '</button><button type="button" data-layout-target="drawings">' + (drawingsHidden ? "展开图文对照" : "折叠图文对照") + '</button><button type="button" data-layout-target="all">展开全部栏目</button><span></span><button type="button" data-layout-close="claims">关闭权利要求</button><button type="button" data-layout-close="support">关闭 AI 支撑</button><button type="button" data-layout-close="drawings">关闭图文对照</button>';
    menu.querySelectorAll("[data-layout-target]").forEach(function (button) { button.addEventListener("click", function () {
      var target = button.dataset.layoutTarget;
      if (target === "all") panel.classList.remove("claim-support-layout-hide-claims", "claim-support-layout-hide-support", "claim-support-layout-hide-drawings");
      else panel.classList.toggle("claim-support-layout-hide-" + target);
      updateLayoutMenu(scope);
    }); });
    menu.querySelectorAll("[data-layout-close]").forEach(function (button) { button.addEventListener("click", function () {
      if (button.dataset.layoutClose === "claims") { panel.classList.add("claim-support-layout-hide-claims"); updateLayoutMenu(scope); }
      else if (button.dataset.layoutClose === "support") { var close = panel.querySelector(".claim-support-close"); if (close) close.click(); }
      else if (typeof window.toggleSplitView === "function" && panel.classList.contains("pd-split-view")) window.toggleSplitView("claims", scope);
    }); });
  }
  function initLayoutMenu(scope, box) {
    var panel = layoutPanel(scope), actions = panel && panel.querySelector(".pd-panel-actions"), supportButton = actions && actions.querySelector(".claim-support-open");
    if (!panel || !actions || !supportButton || !panel.querySelector(".pd-split-drawings") || actions.querySelector(".claim-support-layout-toggle")) return;
    var button = document.createElement("button"), menu = document.createElement("div");
    button.type = "button"; button.className = "claim-support-layout-toggle"; button.textContent = "栏目"; button.title = "折叠、展开或关闭当前三栏中的栏目";
    menu.className = "claim-support-layout-menu"; menu.hidden = true;
    supportButton.insertAdjacentElement("afterend", button); button.insertAdjacentElement("afterend", menu);
    button.addEventListener("click", function () { menu.hidden = !menu.hidden; if (!menu.hidden) updateLayoutMenu(scope); });
    updateLayoutMenu(scope);
  }

  function render(scope, claim, result) {
    var panel = root(scope), body = panel && panel.querySelector(".claim-support-body"); if (!body) return;
    if (!result) {
      body.innerHTML = '<div class="claim-support-empty"><b>准备 AI 分析</b><span>保留左侧权利要求原文；AI 将在右侧拆解技术特征，并逐项给出说明书段落证据。</span><button class="btn-primary claim-support-run">开始 AI 分析</button></div>';
      body.querySelector(".claim-support-run").addEventListener("click", function () { runBatch(scope, [state.activeIndex[scope]]); }); return;
    }
    var counts = { strong: 0, partial: 0, missing: 0 }; result.features.forEach(function (item) { counts[item.status]++; });
    var displayMode = state.displayMode[scope] || "translation";
    var html = '<div class="claim-support-summary"><b>AI 证据链</b><span class="strong">明确对应 ' + counts.strong + '</span><span class="partial">部分对应 ' + counts.partial + '</span><span class="missing">待核查 ' + counts.missing + '</span><span class="claim-support-display-toggle" role="group" aria-label="证据链语言"><button type="button" data-display-mode="translation"' + (displayMode === "translation" ? ' class="active"' : '') + '>译文</button><button type="button" data-display-mode="original"' + (displayMode === "original" ? ' class="active"' : '') + '>原文</button></span></div><p class="claim-support-ai-summary">' + esc(displayMode === "translation" ? result.summaryZh : result.summary) + '</p>';
    result.features.forEach(function (feature, index) {
      html += '<article class="claim-support-feature ' + feature.status + '"><div class="claim-support-feature-head"><span class="claim-support-index">' + (index + 1) + '</span><span class="claim-support-kind">' + esc(feature.label) + '</span><span class="claim-support-status">' + statusLabel(feature.status) + '</span></div><div class="claim-support-feature-text">' + esc(displayMode === "translation" ? feature.claimTextZh : feature.claimText) + '</div>';
      if (feature.evidence.length) { html += '<div class="claim-support-evidence">'; feature.evidence.forEach(function (item) { var quote = displayMode === "translation" ? item.quoteZh : item.quote; var explanation = displayMode === "translation" ? item.explanationZh : item.explanation; html += '<button class="claim-support-evidence-item" data-para="' + esc(item.paragraph.id) + '"><b>[' + esc(item.paragraph.id) + ']</b><span>' + (displayMode === "translation" ? esc(quote) : renderEvidenceText(item.paragraph.text, quote)) + '</span><small>' + esc(explanation) + '</small></button>'; }); html += '</div>'; }
      else html += '<div class="claim-support-no-evidence">AI 未定位到可引用的说明书原文，请人工核查。</div>';
      html += '</article>';
    });
    body.innerHTML = html;
    body.querySelectorAll("[data-display-mode]").forEach(function (button) { button.addEventListener("click", function () { state.displayMode[scope] = button.dataset.displayMode; render(scope, claim, result); }); });
    body.querySelectorAll(".claim-support-evidence-item").forEach(function (button) { button.addEventListener("click", function () { activateDescription(scope); setTimeout(function () { jump(scope, button.dataset.para); }, 80); }); });
  }

  async function analyzeClaim(scope, claim) {
    var id = key(scope, claim), data = patentData(scope) || {};
    var config = window.AI.loadAIConfig(), provider = window.AI.getCurrentProvider(config);
    if (state.running[id]) return state.results[id]; state.running[id] = true;
    try {
      var content = "【权利要求 " + (claim.num || "") + "】\n" + (claim.text || "") + "\n\n【说明书段落】\n" + sourceText(data.description), output = "";
      var stream = window.AI.streamChat(provider.type, provider.apiKey, provider.baseUrl, { model: provider.model, messages: [{ role: "system", content: prompt() }, { role: "user", content: content }], temperature: 0.1, maxTokens: 6000 });
      for await (var chunk of stream) if (chunk.content) output += chunk.content;
      state.results[id] = validateResult(extractJson(output), data.description, claim.text);
      persistResult(scope, claim, state.results[id]);
      return state.results[id];
    } finally { state.running[id] = false; }
  }

  async function runBatch(scope, indexes) {
    var panel = root(scope), data = patentData(scope) || {}, claims = data.claims || [], body = panel && panel.querySelector(".claim-support-body");
    if (!data.description) { if (body) body.innerHTML = '<div class="claim-support-error">该专利没有可用于分析的说明书原文。</div>'; return; }
    if (!window.AI || !window.AI.loadAIConfig || !window.AI.streamChat) { if (body) body.innerHTML = '<div class="claim-support-error">AI 功能未加载。</div>'; return; }
    var provider = window.AI.getCurrentProvider(window.AI.loadAIConfig());
    if (!provider || !provider.apiKey) { if (body) body.innerHTML = '<div class="claim-support-error">请先在设置中配置并选择 AI 模型。</div>'; return; }
    var targets = indexes.map(function (index) { return claims[index]; }).filter(Boolean), failures = [];
    if (!targets.length) return;
    for (var i = 0; i < targets.length; i++) {
      if (body) body.innerHTML = '<div class="claim-support-loading"><span></span>AI 正在分析第 ' + (i + 1) + ' / ' + targets.length + ' 项权利要求…</div>';
      try { await analyzeClaim(scope, targets[i]); } catch (error) { failures.push((targets[i].num || i + 1) + "：" + (error && error.message ? error.message : String(error))); }
    }
    state.activeIndex[scope] = targets[0]._idx !== undefined ? targets[0]._idx : claims.indexOf(targets[0]);
    var active = claims[state.activeIndex[scope]], result = active && state.results[key(scope, active)];
    if (result) render(scope, active, result);
    else if (body) body.innerHTML = '<div class="claim-support-error">所选权利要求未生成可用分析。' + esc(failures.join("；")) + '</div>';
    if (failures.length && body) {
      var notice = document.createElement("div"); notice.className = "claim-support-batch-warning"; notice.textContent = failures.length + " 项分析失败，可单独重试。"; body.prepend(notice);
    }
  }

  function open(scope, index) {
    var panel = root(scope), data = patentData(scope) || {}, claims = data.claims || [], box = panel && panel.querySelector(".claim-support-panel"), body = panel && panel.querySelector('.pd-tab-panel-body[data-panel-body="claims"]');
    if (!box || !claims[index]) return; box.classList.add("active"); body.classList.add("claim-support-mode");
    resetForPatent(scope);
    restoreCachedResults(scope);
    state.activeIndex[scope] = index;
    if (!state.mode[scope]) state.mode[scope] = "manual";
    if (!selectedIndexes(scope).length) setSelected(scope, [index]);
    var select = box.querySelector(".claim-support-select"); select.value = String(index); selectClaim(scope, index); renderSelection(scope); render(scope, claims[index], state.results[key(scope, claims[index])]);
  }

  function enhance() {
    ["detail", "popup"].forEach(function (scope) {
      var panel = root(scope); if (!panel) return;
      var claimsPanel = panel.querySelector('.pd-tab-panel[data-panel="claims"]'), actions = claimsPanel && claimsPanel.querySelector(".pd-panel-actions");
      if (!actions) return;
      if (actions.querySelector(".claim-support-open")) { var existing = claimsPanel.querySelector(".claim-support-panel.active"); if (existing) initLayoutMenu(scope, existing); return; }
      var body = claimsPanel.querySelector('.pd-tab-panel-body[data-panel-body="claims"]'), claims = (patentData(scope) || {}).claims || [];
      var button = document.createElement("button"); button.className = "pd-compare-btn claim-support-open"; button.textContent = "权利要求支撑"; button.title = "使用 AI 定位权利要求技术特征在说明书中的文本证据"; actions.insertBefore(button, actions.firstChild);
      var box = document.createElement("section"); box.className = "claim-support-panel"; box.innerHTML = '<div class="claim-support-toolbar"><b>AI 权利要求支撑</b><select class="claim-support-select"></select><button class="claim-support-close" title="关闭分析视图">关闭</button></div><p class="claim-support-note">AI 按技术特征引用说明书原文，结果供人工核查，不构成法律上的支持性或充分公开结论。</p><div class="claim-support-selection"></div><div class="claim-support-body"></div>'; body.insertBefore(box, body.firstChild);
      var select = box.querySelector(".claim-support-select"); claims.forEach(function (claim, index) { var option = document.createElement("option"); option.value = index; option.textContent = "权利要求 " + (claim.num || index + 1); select.appendChild(option); });
      button.addEventListener("click", function () { open(scope, Number(select.value || 0)); initLayoutMenu(scope, box); }); select.addEventListener("change", function () { open(scope, Number(this.value)); initLayoutMenu(scope, box); });
      box.querySelector(".claim-support-close").addEventListener("click", function () { box.classList.remove("active"); body.classList.remove("claim-support-mode"); claimsPanel.classList.remove("claim-support-layout-hide-support"); panel.querySelectorAll(".pd-claim-item").forEach(function (item) { item.classList.remove("claim-support-selected"); }); });
      panel.querySelectorAll(".pd-claim-item").forEach(function (item) { item.addEventListener("click", function (event) { if (!box.classList.contains("active") || event.target.closest("button")) return; open(scope, Number(item.dataset.claimIndex)); }); });
    });
  }

  var observer = typeof MutationObserver === "function" ? new MutationObserver(enhance) : null;
  function init() { if (observer) observer.observe(document.body, { childList: true, subtree: true }); enhance(); }
  return { init: init, paragraphs: paragraphs, validateResult: validateResult, extractJson: extractJson, sourceText: sourceText, isIndependentClaim: isIndependentClaim, allIndependentIndexes: allIndependentIndexes, persistResult: persistResult, restoreCachedResults: restoreCachedResults, cachedResult: function (scope, claim) { return state.results[key(scope, claim)]; } };
})();
if (typeof document !== "undefined") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ClaimSupportAnalysis.init); else ClaimSupportAnalysis.init(); }
