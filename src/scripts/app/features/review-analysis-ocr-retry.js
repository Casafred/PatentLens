/*!
 * PatentLens - 审查分析 OCR 失败重试与 streamContainer 修复
 *
 * 目的：
 *   1. 修复 startReviewAnalysis 中 `streamContainer is not defined` 运行时错误
 *      （原代码在最终渲染后仍引用已被 innerHTML 重置清除的 streamContainer 变量）。
 *   2. OCR 提取有失败时（可能是触发 OCR API 速率限制），在进入 AI 分析环节前
 *      停下来，通过界面提示和按钮告诉用户可一键重新 OCR 失败文档，补齐后再进入
 *      AI 分析环节。
 *
 * 依赖（均为 web-app.js 暴露的全局，该文件已冻结不可新增行）：
 *   - kanbanState / currentData / showError / aiSettingsBtn
 *   - activeAnalysisProcess / abortActiveProcess / kanbanAutoAbortController
 *   - _updateAIAnalysisView / renderAiProgressUI / doExtractText / autoSaveCache
 *   - buildTimelineSummary / parseDate / renderAnalysisModules / _createThinkingHost
 *   - showAnalysisChatToggle / prefetchPatentLinks / analysisChatHistory
 *   - escapeHtml / icon
 *
 * 策略：web-app.js 的 startReviewAnalysis 是经典脚本全局函数声明，本模块在加载后
 * 用修复版覆盖 window.startReviewAnalysis。修复版完整复刻原实现，仅修改两处：
 *   - extractReport.failed/empty 的 push 补充 idx 与 it 引用，供重试使用
 *   - failedCount > 0 时停下来渲染重试面板（不进入 AI 分析），全部补齐后递归调用
 *   - 最终 report 插入用 analysisContent.firstChild 替代未定义的 streamContainer
 */
(function () {
  "use strict";

  if (typeof window.startReviewAnalysis !== "function") return;
  if (!window.AI || typeof window.AI.loadAIConfig !== "function") return;

  // 保留原函数引用（当前不直接调用，但保留以便未来回退或对照）
  var _originalStartReviewAnalysis = window.startReviewAnalysis;

  window.startReviewAnalysis = async function (selectedIdxs) {
    var items = window.kanbanState.documents;
    var config = window.AI.loadAIConfig();
    var provider = window.AI.getCurrentProvider(config);
    if (!provider) {
      if (typeof showError === "function") showError("请先在 AI 设置中配置并选择一个 AI 服务商");
      if (typeof aiSettingsBtn !== "undefined" && aiSettingsBtn) aiSettingsBtn.click();
      return;
    }

    var manualSelectBtnEl = document.getElementById("kanban-manual-select-btn");
    if (manualSelectBtnEl) manualSelectBtnEl.disabled = true;
    if (window.activeAnalysisProcess) {
      if (typeof abortActiveProcess === "function") abortActiveProcess();
    }
    window.activeAnalysisProcess = "review";
    window.kanbanState.activeAnalysisView = "review";
    window.kanbanAutoAbortController = new AbortController();
    ["kanban-manual-select-btn", "cited-refs-manual-btn"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
    var abortBtn = document.getElementById("cited-refs-abort-btn");
    if (abortBtn) abortBtn.classList.remove("hidden");

    if (typeof _updateAIAnalysisView === "function") _updateAIAnalysisView();

    var analysisSection = document.getElementById("kanban-analysis");
    var analysisContent = document.getElementById("kanban-analysis-content");
    analysisSection.classList.remove("hidden");
    var emptyState = document.getElementById("ai-empty-state");
    if (emptyState) emptyState.classList.add("hidden");
    analysisContent.innerHTML = renderAiProgressUI("extract", "正在准备文档提取...", -1);

    var selectedItems = items.filter(function (it) { return selectedIdxs.indexOf(it.idx) >= 0; });
    var CLAIMS_CODES_MANUAL = ["CLM", "FWCLM"];
    var oaItems = selectedItems;

    var ocrConfig = window.AI.getOCRConfig(config);
    var primaryEngine = ocrConfig.engine || "paddle_ocr_vl";
    var glmApiKey = window.AI.getGlmOcrApiKey(config);
    var statusEl = document.getElementById("ai-analysis-status");
    var isUS = window.currentData.office === "US";
    var urlDocNum = isUS ? window.currentData.applicationNumber : encodeURIComponent(window.currentData.docNumber || window.currentData.applicationNumber);

    var MAX_RETRIES = 5;
    var RETRY_BASE_DELAY = 8000;
    // extractReport.failed/empty 的每一项额外携带 idx 与 it，供重试面板定位文档
    var extractReport = { success: [], empty: [], failed: [], retrying: [] };

    async function extractWithRetry(it, engine, retriesLeft) {
      var container = document.getElementById("kanban-extracted-" + it.idx);
      var attemptNum = MAX_RETRIES - retriesLeft + 1;
      if (container) {
        container.classList.remove("hidden");
        container.innerHTML = '<p class="extracting">正在提取（' + escapeHtml(engine) + '）' + (attemptNum > 1 ? '第' + attemptNum + '次尝试' : '') + '...</p>';
      }
      try {
        var useApiKey = engine === "glm_ocr" ? glmApiKey : "";
        var result = await doExtractText(window.currentData.office, urlDocNum, it.docId, it.numberOfPages, it.docFormat, engine, useApiKey, it.epoPdfUrl || null);
        if (result.error) {
          var isRateLimit = result.error.indexOf("429") >= 0 || result.error.indexOf("rate") >= 0 || result.error.indexOf("limit") >= 0 || result.error.indexOf("Too Many") >= 0;
          if (retriesLeft > 0) {
            var delay = isRateLimit
              ? RETRY_BASE_DELAY * Math.pow(2, attemptNum - 1) + Math.random() * 3000
              : RETRY_BASE_DELAY * Math.pow(1.5, attemptNum - 1);
            if (statusEl) statusEl.textContent = it.name + " 遇到" + (isRateLimit ? '限速' : '提取错误') + "，" + Math.round(delay / 1000) + "秒后重试 (" + attemptNum + "/" + MAX_RETRIES + ")...";
            if (container) container.innerHTML = '<p class="extracting" style="color:var(--warning)">' + (isRateLimit ? '因限速正在等待重试' : '提取出错，正在重试') + ' (' + attemptNum + '/' + MAX_RETRIES + ')，约' + Math.round(delay / 1000) + '秒后重试...</p>';
            extractReport.retrying.push({ name: it.name, docCode: it.docCode, attempt: attemptNum, reason: result.error });
            await new Promise(function (r) { setTimeout(r, delay); });
            if (isRateLimit) {
              return await extractWithRetry(it, engine, retriesLeft - 1);
            }
            var fallbackEngine = engine === "paddle_ocr_vl" ? "glm_ocr" : "paddle_ocr_vl";
            if (fallbackEngine === "glm_ocr" && !glmApiKey) {
              return await extractWithRetry(it, engine, retriesLeft - 1);
            }
            return await extractWithRetry(it, fallbackEngine, retriesLeft - 1);
          }
          extractReport.failed.push({ name: it.name, docCode: it.docCode, reason: result.error, idx: it.idx, it: it });
          if (container) container.innerHTML = '<p class="extract-error">' + escapeHtml(result.error) + '</p>';
          return false;
        }
        var text = result.text || "";
        var markdown = result.markdown || "";
        if (!text && !markdown) {
          if (retriesLeft > 0) {
            var delay2 = RETRY_BASE_DELAY * Math.pow(1.5, attemptNum - 1);
            if (statusEl) statusEl.textContent = it.name + " 提取结果为空，" + Math.round(delay2 / 1000) + "秒后重试...";
            if (container) container.innerHTML = '<p class="extracting" style="color:var(--warning)">提取结果为空，正在重试 (' + attemptNum + '/' + MAX_RETRIES + ')...</p>';
            var fallbackEngine2 = engine === "paddle_ocr_vl" ? "glm_ocr" : "paddle_ocr_vl";
            if (fallbackEngine2 === "glm_ocr" && !glmApiKey) {
              return await extractWithRetry(it, engine, retriesLeft - 1);
            }
            return await extractWithRetry(it, fallbackEngine2, retriesLeft - 1);
          }
          extractReport.empty.push({ name: it.name, docCode: it.docCode, idx: it.idx, it: it });
          if (container) container.innerHTML = '<p class="extract-empty">未能提取到文本（已尝试 ' + MAX_RETRIES + ' 次）</p>';
          return false;
        }
        var blocks = result.blocks || [];
        var pageDimensions = result.page_dimensions || {};
        window.kanbanState.extractions[it.idx] = { text: text, markdown: markdown, engine: result.engine, blocks: blocks, pageDimensions: pageDimensions };
        window.kanbanState.hasUnsavedWork = true;
        if (blocks.length > 0) {
          blocks.forEach(function (b) {
            var traceKey = "D" + it.idx + "_" + b.block_id;
            window.kanbanState.traceIndex[traceKey] = {
              docIdx: it.idx, page: b.page, bbox: b.bbox,
              content: b.content, label: b.label, originalBlockId: b.block_id,
              pageDimensions: pageDimensions[b.page] || null,
            };
          });
        }
        extractReport.success.push({ name: it.name, docCode: it.docCode, chars: (markdown || text).length, engine: result.engine });
        if (container) {
          var displayText = markdown || text;
          var blocksInfo = blocks.length > 0 ? " · " + blocks.length + " blocks" : "";
          container.innerHTML =
            '<div class="extracted-header">' +
              '<span class="extracted-engine">引擎: ' + escapeHtml(result.engine) + '</span>' +
              '<span class="extracted-chars">字符数: ' + displayText.length + blocksInfo + '</span>' +
            '</div>' +
            '<pre class="extracted-text">' + escapeHtml(displayText.length > 6000 ? displayText.substring(0, 6000) + "\n\n[...已截断...]" : displayText) + '</pre>';
        }
        return true;
      } catch (e) {
        var isRateLimit2 = e.message && (e.message.indexOf("429") >= 0 || e.message.indexOf("rate") >= 0 || e.message.indexOf("limit") >= 0);
        if (retriesLeft > 0) {
          var delay3 = isRateLimit2
            ? RETRY_BASE_DELAY * Math.pow(2, attemptNum - 1) + Math.random() * 3000
            : 2000 * attemptNum;
          if (statusEl) statusEl.textContent = it.name + " " + (isRateLimit2 ? '限速等待重试' : '提取异常重试中') + " (" + attemptNum + "/" + MAX_RETRIES + ")...";
          if (container) container.innerHTML = '<p class="extracting" style="color:var(--warning)">' + (isRateLimit2 ? '因限速正在等待重试' : '提取异常，正在重试') + ' (' + attemptNum + '/' + MAX_RETRIES + ')...</p>';
          await new Promise(function (r) { setTimeout(r, delay3); });
          return await extractWithRetry(it, engine, retriesLeft - 1);
        }
        extractReport.failed.push({ name: it.name, docCode: it.docCode, reason: e.message, idx: it.idx, it: it });
        var container2 = document.getElementById("kanban-extracted-" + it.idx);
        if (container2) container2.innerHTML = '<p class="extract-error">' + escapeHtml(e.message) + '</p>';
        return false;
      }
    }

    // 断点续OCR：已有缓存（kanbanState.extractions）的跳过，只提取缺失的
    var missing = oaItems.filter(function (it) {
      return !window.kanbanState.extractions[it.idx] || (!window.kanbanState.extractions[it.idx].text && !window.kanbanState.extractions[it.idx].markdown);
    });
    var cachedItems = oaItems.filter(function (it) {
      return window.kanbanState.extractions[it.idx] && (window.kanbanState.extractions[it.idx].text || window.kanbanState.extractions[it.idx].markdown);
    });
    cachedItems.forEach(function (it) {
      var ext = window.kanbanState.extractions[it.idx];
      extractReport.success.push({
        name: it.name, docCode: it.docCode,
        chars: (ext.markdown || ext.text || "").length,
        engine: ext.engine || "cached", cached: true
      });
    });
    if (missing.length > 0) {
      for (var i = 0; i < missing.length; i++) {
        var it = missing[i];
        if (window.kanbanState.extractions[it.idx] && (window.kanbanState.extractions[it.idx].text || window.kanbanState.extractions[it.idx].markdown)) continue;
        if (statusEl) statusEl.textContent = "提取中 (" + (i + 1) + "/" + missing.length + "): " + it.name;
        var extractProgress = Math.round(((i + 1) / missing.length) * 60);
        analysisContent.innerHTML = renderAiProgressUI("extract", "提取中 (" + (i + 1) + "/" + missing.length + "): " + it.name, extractProgress);
        await extractWithRetry(it, primaryEngine, MAX_RETRIES);
        if (window.kanbanAutoAbortController && window.kanbanAutoAbortController.signal.aborted) break;
      }
    }
    autoSaveCache();

    var successCount = extractReport.success.length;
    var failedCount = extractReport.failed.length + extractReport.empty.length;

    if (successCount === 0) {
      analysisContent.innerHTML = '<p class="placeholder" style="color:var(--danger)">所有文档提取均失败，无法进行 AI 分析。</p>';
      var manualSelectBtnEl2 = document.getElementById("kanban-manual-select-btn");
      if (manualSelectBtnEl2) { manualSelectBtnEl2.disabled = false; manualSelectBtnEl2.classList.remove("hidden"); }
      window.kanbanAutoAbortController = null;
      return;
    }

    // OCR 有失败时停下来：可能是触发 OCR API 速率限制，提示用户一键重试失败项，
    // 补齐后再进入 AI 分析环节（不提供「仍继续」，确保内容完整）。
    if (failedCount > 0) {
      var renderFailedPanel = function () {
        var currentFailed = extractReport.failed.concat(extractReport.empty);
        var failedNames = currentFailed.map(function (f) { return f.docCode || f.name; }).join(", ");
        var currentSuccess = extractReport.success.length;
        if (statusEl) statusEl.innerHTML = icon('alert') + " " + currentSuccess + " 成功 / " + currentFailed.length + " 失败（" + failedNames + "）· 请重试失败项";
        var failedListHtml = currentFailed.map(function (f) {
          var reason = f.reason ? escapeHtml(f.reason) : "提取结果为空";
          return '<li><span class="doc-code">' + escapeHtml(f.docCode || '') + '</span> <span class="doc-name">' + escapeHtml(f.name || '') + '</span> <span class="reason">' + reason + '</span></li>';
        }).join("");
        analysisContent.innerHTML =
          '<div class="extract-failed-panel">' +
            '<h4>部分文档 OCR 提取失败</h4>' +
            '<p class="extract-failed-summary">' + currentSuccess + ' 个文档已就绪，' + currentFailed.length + ' 个失败。可能是触发 OCR 速率限制或文档异常。请点击下方按钮重试，补齐后再进入 AI 分析。</p>' +
            '<ul class="extract-failed-list">' + failedListHtml + '</ul>' +
            '<div class="extract-failed-actions">' +
              '<button id="retry-failed-ocr-btn" class="btn-primary" type="button">一键重试失败项</button>' +
            '</div>' +
          '</div>';
        var retryBtn = document.getElementById("retry-failed-ocr-btn");
        if (retryBtn) retryBtn.addEventListener("click", async function () {
          if (window.kanbanAutoAbortController && window.kanbanAutoAbortController.signal.aborted) return;
          retryBtn.disabled = true;
          retryBtn.textContent = "重试中...";
          // 仅重新提取当前失败项（成功的已缓存，递归调用会自动跳过）
          // 重试前清空 extractReport 的 failed/empty，让重试结果重新计入
          var retryItems = extractReport.failed.concat(extractReport.empty).map(function (f) { return f.it; }).filter(Boolean);
          extractReport.failed = [];
          extractReport.empty = [];
          var allOk = true;
          for (var j = 0; j < retryItems.length; j++) {
            var rit = retryItems[j];
            if (window.kanbanAutoAbortController && window.kanbanAutoAbortController.signal.aborted) { allOk = false; break; }
            if (statusEl) statusEl.textContent = "重试提取中: " + rit.name + "...";
            var ok = await extractWithRetry(rit, primaryEngine, MAX_RETRIES);
            if (!ok) allOk = false;
          }
          autoSaveCache();
          if (window.kanbanAutoAbortController && window.kanbanAutoAbortController.signal.aborted) return;
          if (allOk) {
            // 全部补齐，递归调用自身进入 AI 分析（已成功的会走缓存分支）
            await window.startReviewAnalysis(selectedIdxs);
          } else {
            // 仍有失败，重新渲染失败面板
            renderFailedPanel();
          }
        });
      };
      renderFailedPanel();
      return;
    }

    // 无失败：进入 AI 分析阶段
    var cachedCount = extractReport.success.filter(function (s) { return s.cached; }).length;
    var newCount = successCount - cachedCount;
    var msg = "全部文档就绪，AI 梳理中...";
    if (cachedCount > 0 && newCount > 0) {
      msg = "复用 " + cachedCount + " 个已OCR文档 + 新提取 " + newCount + " 个文档，AI 梳理中...";
    } else if (cachedCount > 0 && newCount === 0) {
      msg = "复用 " + cachedCount + " 个已OCR文档，AI 梳理中...";
    } else {
      msg = "全部文档提取完成，AI 梳理中...";
    }
    if (statusEl) statusEl.textContent = msg;
    analysisContent.innerHTML = renderAiProgressUI("analyzing", msg, -1);
    analysisContent.innerHTML = renderAiProgressUI("analyzing", "AI 正在梳理审查历史...", -1);

    var hasBlocks = oaItems.some(function (it) {
      var ext = window.kanbanState.extractions[it.idx];
      return ext && ext.blocks && ext.blocks.length > 0;
    });

    var annotatedLines = [];
    var timelineSummary = buildTimelineSummary(window.currentData.office, window.kanbanState.documents);

    var sortedOaItems = oaItems.slice().sort(function (a, b) {
      var da = parseDate(a.date);
      var db = parseDate(b.date);
      return da - db;
    });

    sortedOaItems.forEach(function (it) {
      var ext = window.kanbanState.extractions[it.idx];
      if (!ext) {
        var isClaimsDoc = CLAIMS_CODES_MANUAL.indexOf(it.docCode) >= 0;
        var missingHeader = isClaimsDoc
          ? "【" + it.idx + "】" + it.docCode + " - " + it.name + "（" + it.date + "）[权利要求参考]"
          : "【" + it.idx + "】" + it.docCode + " - " + it.name + "（" + it.date + "）";
        annotatedLines.push(missingHeader + "\n[未能提取内容]");
        return;
      }
      var isClaimsDoc2 = CLAIMS_CODES_MANUAL.indexOf(it.docCode) >= 0;
      var header = isClaimsDoc2
        ? "【" + it.idx + "】" + it.docCode + " - " + it.name + "（" + it.date + "）[权利要求参考]"
        : "【" + it.idx + "】" + it.docCode + " - " + it.name + "（" + it.date + "）";
      if (hasBlocks && ext.blocks && ext.blocks.length > 0) {
        var blockParts = ext.blocks
          .filter(function (b) { return b.content && b.content.trim(); })
          .map(function (b) { return "[ref:D" + it.idx + "_" + b.block_id + "]" + b.content + "[/ref:D" + it.idx + "_" + b.block_id + "]"; })
          .join("\n\n");
        annotatedLines.push(header + "\n" + blockParts);
      } else {
        var fullContent = ext.markdown || ext.text || "";
        var content = fullContent.length > 50000 ? fullContent.substring(0, 50000) + "\n\n[...内容过长，已截断...]" : fullContent;
        annotatedLines.push(header + "\n" + content);
      }
    });

    var promptConfig = window.AI.loadAIConfig();
    var systemPrompt = hasBlocks
      ? window.AI.getCustomPrompt(promptConfig, "kanbanAnalysis")
      : window.AI.getCustomPrompt(promptConfig, "kanbanAnalysisSimple");

    var userMessage = timelineSummary + annotatedLines.join("\n\n---\n\n");

    try {
      var fullText = "";
      window.kanbanState.analysis = "";
      window.kanbanState.analysisSystemPrompt = systemPrompt;
      window.kanbanState.analysisUserMessage = userMessage;
      window.kanbanState.hasUnsavedWork = true;
      analysisContent.innerHTML = "";
      var progressPlaceholder = document.createElement("div");
      progressPlaceholder.innerHTML = renderAiProgressUI("analyzing", "AI 正在梳理审查历史，等待响应...", -1);
      analysisContent.appendChild(progressPlaceholder);
      var thinkingContainer = document.createElement("div");
      analysisContent.appendChild(thinkingContainer);
      var answerContainer = document.createElement("div");
      answerContainer.className = "markdown-body";
      analysisContent.appendChild(answerContainer);
      var thinkingHost = _createThinkingHost(thinkingContainer);
      var _streamContentStarted = false;
      var _streamRafPending = false;
      var _lastRenderLen = 0;
      for await (var chunk of window.AI.streamChat(
        provider.type, provider.apiKey, provider.baseUrl,
        {
          model: provider.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          temperature: 0.3,
          maxTokens: 32768,
        },
        window.kanbanAutoAbortController ? window.kanbanAutoAbortController.signal : undefined
      )) {
        if (chunk.reasoningContent && thinkingHost) {
          if (progressPlaceholder.parentNode) progressPlaceholder.remove();
          thinkingHost.appendReasoning(chunk.reasoningContent);
        }
        if (chunk.content) {
          if (!_streamContentStarted) {
            _streamContentStarted = true;
            if (progressPlaceholder.parentNode) progressPlaceholder.remove();
            if (thinkingHost) thinkingHost.startContent();
          }
          fullText += chunk.content;
          if (!_streamRafPending && (fullText.length - _lastRenderLen > 20 || fullText.length < 200)) {
            _streamRafPending = true;
            requestAnimationFrame(function () {
              if (answerContainer) {
                answerContainer.innerHTML = renderAnalysisModules(fullText);
              }
              window.kanbanState.analysis = fullText;
              window.kanbanState.hasUnsavedWork = true;
              _lastRenderLen = fullText.length;
              _streamRafPending = false;
            });
          }
        }
      }
      if (thinkingHost) thinkingHost.finish();
      if (thinkingContainer.parentNode) thinkingContainer.remove();
      if (progressPlaceholder.parentNode) progressPlaceholder.remove();
      // 最终渲染确保所有内容显示（含模块分节）
      analysisContent.innerHTML = renderAnalysisModules(fullText);
      window.kanbanState.analysis = fullText;
      window.kanbanState.hasUnsavedWork = true;
      if (window._analysisScrollObserver) {
        analysisContent.querySelectorAll(".analysis-module[data-module-id]").forEach(function (mod) {
          window._analysisScrollObserver.observe(mod);
        });
      }
      window.kanbanState.analysisSystemPrompt = systemPrompt;
      window.kanbanState.analysisUserMessage = userMessage;
      window.kanbanState.lastAnalyzedIdxs = selectedIdxs.slice();
      analysisChatHistory = [];
      showAnalysisChatToggle();
      autoSaveCache();
      prefetchPatentLinks();
      if (statusEl) statusEl.innerHTML = icon('check') + " AI 整理完成 共 " + oaItems.length + " 份文档" + (hasBlocks ? "（含溯源标记）" : "");

      // 提取完整性报告（修复：原代码引用未定义的 streamContainer，改为 analysisContent.firstChild）
      var reportHtml = "";
      if (extractReport.empty.length > 0 || extractReport.failed.length > 0) {
        reportHtml = '<div class="extract-report"><h4>提取完整性报告</h4>';
        if (extractReport.success.length > 0) {
          reportHtml += '<div class="report-success" style="display:flex;align-items:center;gap:6px;">' + icon('check') + ' 成功: ' + extractReport.success.map(function (s) { return escapeHtml(s.name) + ' (' + s.chars + '字/' + s.engine + ')'; }).join('、') + '</div>';
        }
        if (extractReport.empty.length > 0) {
          reportHtml += '<div class="report-warning">内容为空: ' + extractReport.empty.map(function (s) { return escapeHtml(s.name); }).join('、') + '</div>';
        }
        if (extractReport.failed.length > 0) {
          reportHtml += '<div class="report-error" style="display:flex;align-items:center;gap:6px;">' + icon('x') + ' 提取失败: ' + extractReport.failed.map(function (s) { return escapeHtml(s.name) + ' (' + escapeHtml(s.reason) + ')'; }).join('、') + '</div>';
        }
        reportHtml += '</div>';
        var reportDiv = document.createElement("div");
        reportDiv.innerHTML = reportHtml;
        if (reportDiv.firstChild) analysisContent.insertBefore(reportDiv.firstChild, analysisContent.firstChild);
      }
    } catch (e) {
      analysisContent.innerHTML = '<p class="placeholder" style="color:var(--danger)">' + escapeHtml(e.toString()) + "</p>";
      if (statusEl) statusEl.innerHTML = icon('x') + " AI 整理失败";
    } finally {
      window.activeAnalysisProcess = null;
      ["kanban-manual-select-btn", "cited-refs-manual-btn"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) { el.disabled = false; el.classList.remove("hidden"); }
      });
      var abortBtn2 = document.getElementById("cited-refs-abort-btn");
      if (abortBtn2) abortBtn2.classList.add("hidden");
      window.kanbanAutoAbortController = null;
      if (typeof _updateAIAnalysisView === "function") _updateAIAnalysisView();
    }
  };
})();
