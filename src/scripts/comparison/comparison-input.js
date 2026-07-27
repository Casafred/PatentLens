/*!
 * PatentLens - 智能比对模块 - 输入处理
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 * @author Alfred Shi
 * @version 260717
 */

var ComparisonInput = (function () {
  var _selectedClaims = {};
  var _failedPatents = {};
  var _manualTexts = {};
  var _tooltipEl = null;
  var _tooltipHideTimer = null;

  function _getTooltipEl() {
    if (!_tooltipEl) {
      _tooltipEl = document.getElementById('cmp-claim-tooltip');
      if (!_tooltipEl) {
        _tooltipEl = document.createElement('div');
        _tooltipEl.id = 'cmp-claim-tooltip';
        document.body.appendChild(_tooltipEl);
      }
    }
    return _tooltipEl;
  }

  function _showClaimTooltip(text, event) {
    if (_tooltipHideTimer) { clearTimeout(_tooltipHideTimer); _tooltipHideTimer = null; }
    var tip = _getTooltipEl();
    tip.textContent = text;
    tip.classList.add('show');
    var x = event.clientX + 12;
    var y = event.clientY + 16;
    var maxW = 600;
    var w = Math.min(maxW, window.innerWidth - 24);
    if (x + w > window.innerWidth - 12) x = window.innerWidth - w - 12;
    var h = tip.offsetHeight;
    if (y + h > window.innerHeight - 12) y = event.clientY - h - 8;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.style.maxWidth = w + 'px';
  }

  function _hideClaimTooltip() {
    var tip = _getTooltipEl();
    tip.classList.remove('show');
  }

  function _bindClaimTooltip(container) {
    if (!container) return;
    var selector = container.querySelector('.claims-selector');
    if (!selector) selector = container;
    selector.addEventListener('mouseover', function(e) {
      var item = e.target.closest('.claim-select-item');
      if (item && item.dataset.fullText) {
        _showClaimTooltip(item.dataset.fullText, e);
      }
    });
    selector.addEventListener('mousemove', function(e) {
      var item = e.target.closest('.claim-select-item');
      if (item && item.dataset.fullText) {
        _showClaimTooltip(item.dataset.fullText, e);
      }
    });
    selector.addEventListener('mouseout', function(e) {
      var item = e.target.closest('.claim-select-item');
      if (item) {
        _tooltipHideTimer = setTimeout(_hideClaimTooltip, 50);
      }
    });
  }

  function renderInputArea(container, inputMode) {
    if (!container) return;

    if (inputMode === 'manual') {
      renderManualInput(container);
    } else if (inputMode === 'patent') {
      renderPatentInput(container);
    }
  }

  function renderManualInput(container) {
    var savedLabel = ComparisonCore.getManualLabelText();
    var savedContent = ComparisonCore.getManualContentText();
    var nextLabel = '文本' + (ComparisonCore.getItems().length + 1);
    var html = '<div class="comparison-input-panel">';
    html += '  <div class="comparison-manual-add">';
    html += '    <div style="display:flex;gap:12px;align-items:center;">';
    html += '      <input type="text" id="cmp-manual-label" class="comparison-label-input" placeholder="标签名称（如：US权1、CN独权）" value="' + ComparisonUtils.escapeHtml(savedLabel) + '" style="max-width:200px;">';
    html += '      <button class="btn-primary comparison-add-btn" onclick="ComparisonInput.addManualText()">';
    html += '        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:4px;vertical-align:-2px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    html += '        添加文本';
    html += '      </button>';
    html += '    </div>';
    html += '    <textarea id="cmp-manual-text" class="comparison-textarea" placeholder="在此粘贴要比对的文本内容（如独立权利要求书）...">' + ComparisonUtils.escapeHtml(savedContent) + '</textarea>';
    html += '    <div class="comparison-patent-hint">提示：可添加多组文本，每组建议是一个独立权利要求或一段需要比对的内容</div>';
    html += '  </div>';
    html += '</div>';
    container.innerHTML = html;

    setTimeout(function() {
      var labelInput = document.getElementById('cmp-manual-label');
      var textarea = document.getElementById('cmp-manual-text');
      if (labelInput) {
        if (!savedLabel) labelInput.placeholder = nextLabel;
        labelInput.addEventListener('input', function() {
          var t = document.getElementById('cmp-manual-text');
          ComparisonCore.setManualInput(labelInput.value, t ? t.value : '');
        });
      }
      if (textarea) {
        textarea.addEventListener('keydown', function(e) {
          if (e.ctrlKey && e.key === 'Enter') {
            addManualText();
          }
        });
        textarea.addEventListener('input', function() {
          var l = document.getElementById('cmp-manual-label');
          ComparisonCore.setManualInput(l ? l.value : '', textarea.value);
        });
      }
    }, 100);
  }

  function addManualText() {
    var labelInput = document.getElementById('cmp-manual-label');
    var textInput = document.getElementById('cmp-manual-text');
    if (!labelInput || !textInput) return;

    var text = ComparisonUtils.cleanText(textInput.value);
    if (!text) {
      alert('请输入要比对的文本内容');
      return;
    }

    var label = labelInput.value.trim() || ('文本' + (ComparisonCore.getItems().length + 1));

    ComparisonCore.addItem({
      label: label,
      source: 'manual',
      originalText: text
    });

    textInput.value = '';
    labelInput.value = '';
    ComparisonCore.setManualInput('', '');
    var items = ComparisonCore.getItems();
    labelInput.placeholder = '文本' + (items.length + 1);
    ComparisonUI.scrollToAnchorTab();
  }

  function renderPatentInput(container) {
    var savedText = ComparisonCore.getPatentNumbersText();
    var html = '<div class="comparison-input-panel">';
    html += '  <div class="comparison-patent-input">';
    html += '    <label style="font-size:13px;font-weight:500;margin-bottom:4px;">输入专利号（每行一个，最多10个）</label>';
    html += '    <textarea id="cmp-patent-numbers" class="comparison-patent-textarea" placeholder="每行输入一个专利号，例如：\nUS12030161B2\nUS17204063\nEP4252965A3">' + ComparisonUtils.escapeHtml(savedText) + '</textarea>';
    html += '    <div class="comparison-patent-hint">支持Google Patents可查询的所有国家/地区专利号，已查询的专利自动缓存</div>';
    html += '    <div style="display:flex;gap:8px;margin-top:8px;">';
    html += '      <button class="btn-primary" id="cmp-fetch-patents-btn" onclick="ComparisonInput.fetchPatents()">查询并获取权利要求</button>';
    html += '      <button class="btn-secondary" onclick="ComparisonInput.clearPatentInput()">清空</button>';
    html += '    </div>';
    html += '  </div>';
    html += '  <div id="cmp-patent-progress"></div>';
    html += '  <div id="cmp-claims-selector"></div>';
    html += '</div>';
    container.innerHTML = html;

    var textarea = document.getElementById('cmp-patent-numbers');
    if (textarea) {
      textarea.addEventListener('input', function() {
        ComparisonCore.setPatentNumbersText(textarea.value);
      });
    }

    var savedPatents = ComparisonCore.getFetchedPatents();
    var savedErrors = ComparisonCore.getFetchErrors();
    var savedFailed = ComparisonCore.getFailedPatents();
    var claimsContainer = document.getElementById('cmp-claims-selector');
    var progressContainer = document.getElementById('cmp-patent-progress');

    var hasFailed = savedFailed && Object.keys(savedFailed).length > 0;
    if (hasFailed) {
      _failedPatents = Object.assign({}, savedFailed);
    }

    if (savedPatents && Object.keys(savedPatents).length > 0) {
      renderClaimsSelector(claimsContainer, savedPatents);
      var successCount = Object.keys(savedPatents).length;
      var errMsg = '';
      if (savedErrors.length > 0) {
        errMsg = '<div style="margin-top:8px;font-size:12px;color:#ef4444;">失败: ' + savedErrors.map(ComparisonUtils.escapeHtml).join('; ') + '</div>';
      }
      if (progressContainer) {
        progressContainer.innerHTML = '<div class="comparison-progress">' +
          '<div class="comparison-progress-text">查询完成: 成功 ' + successCount + ' 个' + (savedErrors.length > 0 ? '，失败 ' + savedErrors.length + ' 个' : '') + '</div>' +
          '<div class="comparison-progress-bar"><div class="comparison-progress-fill" style="width:100%"></div></div>' +
          errMsg +
          '</div>';
      }
    }
    if (hasFailed) {
      _renderFailedPatents(claimsContainer);
    }
  }

  function clearPatentInput() {
    var textarea = document.getElementById('cmp-patent-numbers');
    if (textarea) textarea.value = '';
    ComparisonCore.setPatentNumbersText('');
    ComparisonCore.setFetchedPatents(null, []);
    _selectedClaims = {};
    _failedPatents = {};
    _manualTexts = {};
    var progressContainer = document.getElementById('cmp-patent-progress');
    var claimsContainer = document.getElementById('cmp-claims-selector');
    if (progressContainer) progressContainer.innerHTML = '';
    if (claimsContainer) claimsContainer.innerHTML = '';
  }

  function _normalizeNum(input) {
    if (!input) return '';
    return input.trim().toUpperCase().replace(/[\s\/]/g, '');
  }

  async function _fetchSinglePatent(normalized, isRetry) {
    var cached = null;
    if (typeof GPCache !== 'undefined') {
      cached = GPCache.get(normalized);
    }
    if (window._pdPatentCache && window._pdPatentCache[normalized]) {
      cached = window._pdPatentCache[normalized];
    }
    if (cached && cached.claims && cached.claims.length > 0) {
      return cached;
    }

    var maxRetries = isRetry ? 4 : 3;
    var json = await fetchPatentWithRetry(normalized, maxRetries);
    if (json && json.success && json.data) {
      var data = json.data;
      if (data.claims && data.claims.length > 0 && data.data_source !== 'Espacenet') {
        if (typeof GPCache !== 'undefined') GPCache.set(normalized, data);
        if (window._pdPatentCache) window._pdPatentCache[normalized] = data;
      }
      return data;
    }
    throw new Error(json && json.error ? json.error : '查询失败');
  }

  function _renderFailedPatents(container) {
    if (!container) return;
    var existing = document.getElementById('cmp-failed-patents');
    if (existing) existing.remove();
    var failedNums = Object.keys(_failedPatents);
    if (failedNums.length === 0) return;
    var html = '<div id="cmp-failed-patents" style="margin-top:16px;padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">';
    html += '<div style="font-size:13px;font-weight:600;color:#991b1b;margin-bottom:10px;">以下专利查询失败，可重试或手动粘贴文本：</div>';
    failedNums.forEach(function(pn) {
      var err = _failedPatents[pn];
      html += '<div style="margin-bottom:10px;padding:10px;background:#fff;border-radius:6px;border:1px solid #fecaca;">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:6px;">';
      html += '<span style="font-weight:600;color:#991b1b;font-size:13px;">' + ComparisonUtils.escapeHtml(pn) + '</span>';
      html += '<span style="display:flex;gap:6px;">';
      html += '<button class="btn-secondary btn-small" onclick="ComparisonInput.retrySinglePatent(\'' + ComparisonUtils.escapeHtml(pn).replace(/'/g, "\\'") + '\')" style="font-size:11px;padding:2px 8px;">重试</button>';
      html += '<button class="btn-secondary btn-small" onclick="ComparisonInput.showManualInput(\'' + ComparisonUtils.escapeHtml(pn).replace(/'/g, "\\'") + '\')" style="font-size:11px;padding:2px 8px;">手动输入文本</button>';
      html += '</span>';
      html += '</div>';
      html += '<div style="font-size:11px;color:#b91c1c;margin-bottom:4px;">' + ComparisonUtils.escapeHtml(err) + '</div>';
      if (_manualTexts[pn]) {
        html += '<div style="margin-top:6px;">';
        html += '<textarea id="cmp-manual-' + ComparisonUtils.escapeHtml(pn) + '" class="comparison-textarea" placeholder="在此粘贴该专利的权利要求文本..." style="min-height:60px;font-size:12px;" oninput="ComparisonInput.updateManualText(\'' + ComparisonUtils.escapeHtml(pn).replace(/'/g, "\\'") + '\', this.value)">' + ComparisonUtils.escapeHtml(_manualTexts[pn].text || '') + '</textarea>';
        html += '<div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;">';
        html += '<input type="text" id="cmp-manual-label-' + ComparisonUtils.escapeHtml(pn) + '" class="comparison-label-input" placeholder="标签（如：US权1）" value="' + ComparisonUtils.escapeHtml(_manualTexts[pn].label || (pn + ' 权1')) + '" style="max-width:160px;font-size:12px;" oninput="ComparisonInput.updateManualText(\'' + ComparisonUtils.escapeHtml(pn).replace(/'/g, "\\'") + '\', null, this.value)">';
        html += '<button class="btn-primary btn-small" onclick="ComparisonInput.addManualTextForPatent(\'' + ComparisonUtils.escapeHtml(pn).replace(/'/g, "\\'") + '\')" style="font-size:11px;padding:2px 10px;">添加到比对列表</button>';
        html += '</div></div>';
      }
      html += '</div>';
    });
    html += '<button class="btn-secondary btn-small" onclick="ComparisonInput.retryAllFailed()" style="font-size:12px;margin-top:4px;">全部重试</button>';
    html += '</div>';
    container.insertAdjacentHTML('beforeend', html);
  }

  async function retrySinglePatent(pn) {
    var normalized = _normalizeNum(pn);
    var btn = document.getElementById('cmp-fetch-patents-btn');
    var progressContainer = document.getElementById('cmp-patent-progress');

    if (btn) btn.disabled = true;
    if (progressContainer) {
      progressContainer.innerHTML = '<div class="comparison-progress">' +
        '<div class="comparison-progress-text">正在重试 ' + ComparisonUtils.escapeHtml(pn) + ' ...</div>' +
        '<div class="comparison-progress-bar"><div class="comparison-progress-fill" style="width:50%"></div></div>' +
        '</div>';
    }

    try {
      var data = await _fetchSinglePatent(normalized, true);
      var claims = data.claims || [];
      if (claims.length > 0) {
        delete _failedPatents[normalized];
        var existingFetched = ComparisonCore.getFetchedPatents() || {};
        existingFetched[normalized] = {
          patentNumber: normalized,
          title: data.title || '',
          applicant: data.assignee || data.applicant || '',
          claims: claims
        };
        var errors = [];
        Object.keys(_failedPatents).forEach(function(k) {
          errors.push(k + ': ' + _failedPatents[k]);
        });
        ComparisonCore.setFetchedPatents(existingFetched, errors, Object.assign({}, _failedPatents));

        var claimsContainer = document.getElementById('cmp-claims-selector');
        renderClaimsSelector(claimsContainer, existingFetched);

        var errHtml = '';
        if (errors.length > 0) {
          errHtml = '<div style="margin-top:8px;font-size:12px;color:#ef4444;">失败: ' + errors.map(ComparisonUtils.escapeHtml).join('; ') + '</div>';
        }
        var succCount = Object.keys(existingFetched).length;
        if (progressContainer) {
          progressContainer.innerHTML = '<div class="comparison-progress">' +
            '<div class="comparison-progress-text">查询完成: 成功 ' + succCount + ' 个' + (errors.length > 0 ? '，失败 ' + errors.length + ' 个' : '') + '</div>' +
            '<div class="comparison-progress-bar"><div class="comparison-progress-fill" style="width:100%"></div></div>' +
            errHtml +
            '</div>';
        }
        _renderFailedPatents(claimsContainer);
      } else {
        throw new Error('未找到权利要求数据');
      }
    } catch (err) {
      _failedPatents[normalized] = err.message;
      var existingForRetry = ComparisonCore.getFetchedPatents() || {};
      var errsForRetry = Object.keys(_failedPatents).map(function(k) { return k + ': ' + _failedPatents[k]; });
      ComparisonCore.setFetchedPatents(existingForRetry, errsForRetry, Object.assign({}, _failedPatents));
      if (progressContainer) {
        progressContainer.innerHTML = '<div class="comparison-progress">' +
          '<div class="comparison-progress-text">重试 ' + ComparisonUtils.escapeHtml(pn) + ' 仍然失败: ' + ComparisonUtils.escapeHtml(err.message) + '</div>' +
          '<div class="comparison-progress-bar"><div class="comparison-progress-fill" style="width:100%"></div></div>' +
          '</div>';
      }
      var claimsContainer2 = document.getElementById('cmp-claims-selector');
      _renderFailedPatents(claimsContainer2);
    }

    if (btn) btn.disabled = false;
  }

  async function retryAllFailed() {
    var failedNums = Object.keys(_failedPatents);
    if (failedNums.length === 0) return;

    var btn = document.getElementById('cmp-fetch-patents-btn');
    var progressContainer = document.getElementById('cmp-patent-progress');
    var claimsContainer = document.getElementById('cmp-claims-selector');
    if (btn) btn.disabled = true;

    var existingFetched = ComparisonCore.getFetchedPatents() || {};
    var newErrors = {};

    for (var i = 0; i < failedNums.length; i++) {
      var pn = failedNums[i];
      if (progressContainer) {
        progressContainer.innerHTML = '<div class="comparison-progress">' +
          '<div class="comparison-progress-text">正在重试 ' + (i + 1) + '/' + failedNums.length + ': ' + ComparisonUtils.escapeHtml(pn) + '</div>' +
          '<div class="comparison-progress-bar"><div class="comparison-progress-fill" style="width:' + Math.round((i / failedNums.length) * 100) + '%"></div></div>' +
          '</div>';
      }
      try {
        var data = await _fetchSinglePatent(pn, true);
        var claims = data.claims || [];
        if (claims.length > 0) {
          existingFetched[pn] = {
            patentNumber: pn,
            title: data.title || '',
            applicant: data.assignee || data.applicant || '',
            claims: claims
          };
        } else {
          newErrors[pn] = '未找到权利要求数据';
        }
      } catch (err) {
        newErrors[pn] = err.message;
      }
      if (i < failedNums.length - 1) {
        await new Promise(function(r) { setTimeout(r, 300); });
      }
    }

    _failedPatents = newErrors;
    var errs = Object.keys(newErrors).map(function(k) { return k + ': ' + newErrors[k]; });
    ComparisonCore.setFetchedPatents(existingFetched, errs, Object.assign({}, newErrors));
    renderClaimsSelector(claimsContainer, existingFetched);

    var errHtml = '';
    if (errs.length > 0) errHtml = '<div style="margin-top:8px;font-size:12px;color:#ef4444;">失败: ' + errs.map(ComparisonUtils.escapeHtml).join('; ') + '</div>';
    if (progressContainer) {
      progressContainer.innerHTML = '<div class="comparison-progress">' +
        '<div class="comparison-progress-text">重试完成: 成功 ' + Object.keys(existingFetched).length + ' 个' + (errs.length > 0 ? '，失败 ' + errs.length + ' 个' : '') + '</div>' +
        '<div class="comparison-progress-bar"><div class="comparison-progress-fill" style="width:100%"></div></div>' +
        errHtml +
        '</div>';
    }
    _renderFailedPatents(claimsContainer);
    if (btn) btn.disabled = false;
  }

  function showManualInput(pn) {
    if (!_manualTexts[pn]) {
      _manualTexts[pn] = { label: pn + ' 权1', text: '' };
    } else {
      _manualTexts[pn]._show = true;
    }
    var claimsContainer = document.getElementById('cmp-claims-selector');
    _renderFailedPatents(claimsContainer);
  }

  function updateManualText(pn, text, label) {
    if (!_manualTexts[pn]) _manualTexts[pn] = { label: pn + ' 权1', text: '' };
    if (text !== null && text !== undefined) _manualTexts[pn].text = text;
    if (label !== null && label !== undefined) _manualTexts[pn].label = label;
  }

  function addManualTextForPatent(pn) {
    var textarea = document.getElementById('cmp-manual-' + pn);
    var labelInput = document.getElementById('cmp-manual-label-' + pn);
    var text = textarea ? ComparisonUtils.cleanText(textarea.value) : '';
    var label = (labelInput ? labelInput.value.trim() : '') || (pn + ' 权1');
    if (!text) {
      alert('请输入权利要求文本');
      return;
    }
    var existing = ComparisonCore.getItems().find(function(i) {
      return i.patentNumber === pn && i.source === 'manual-fallback';
    });
    if (existing) {
      alert('该专利的手动文本已添加到比对列表');
      return;
    }
    ComparisonCore.addItem({
      label: label,
      source: 'manual-fallback',
      patentNumber: pn,
      originalText: text,
      isSelected: true,
      metadata: { manualFallback: true }
    });
    delete _failedPatents[pn];
    delete _manualTexts[pn];
    var claimsContainer = document.getElementById('cmp-claims-selector');
    _renderFailedPatents(claimsContainer);
    ComparisonUI.scrollToAnchorTab();
  }

  async function fetchPatents() {
    var textarea = document.getElementById('cmp-patent-numbers');
    if (!textarea) return;

    var rawText = textarea.value;
    ComparisonCore.setPatentNumbersText(rawText);

    var numbers = ComparisonUtils.parsePatentNumbersInput(rawText);
    if (numbers.length === 0) {
      alert('请输入至少一个专利号');
      return;
    }
    if (numbers.length > 10) {
      alert('最多支持同时查询10个专利');
      return;
    }

    var btn = document.getElementById('cmp-fetch-patents-btn');
    var progressContainer = document.getElementById('cmp-patent-progress');
    var claimsContainer = document.getElementById('cmp-claims-selector');

    if (btn) btn.disabled = true;
    _selectedClaims = {};
    _failedPatents = {};

    var fetchedPatents = {};
    var errors = [];

    for (var i = 0; i < numbers.length; i++) {
      var num = numbers[i];
      var normalized = _normalizeNum(num);

      if (progressContainer) {
        progressContainer.innerHTML = '<div class="comparison-progress">' +
          '<div class="comparison-progress-text">正在查询 ' + (i + 1) + '/' + numbers.length + ': ' + ComparisonUtils.escapeHtml(num) + '</div>' +
          '<div class="comparison-progress-bar"><div class="comparison-progress-fill" style="width:' + Math.round((i / numbers.length) * 100) + '%"></div></div>' +
          '</div>';
      }

      try {
        if (i === 0) {
          await new Promise(function(r) { setTimeout(r, 300); });
        }
        var data = await _fetchSinglePatent(normalized, false);
        var claims = data.claims || [];
        if (claims.length > 0) {
          fetchedPatents[normalized] = {
            patentNumber: normalized,
            title: data.title || '',
            applicant: data.assignee || data.applicant || '',
            claims: claims
          };
        } else {
          _failedPatents[normalized] = '未找到权利要求数据';
          errors.push(num + ': 未找到权利要求数据');
        }
      } catch (err) {
        _failedPatents[normalized] = err.message;
        errors.push(num + ': ' + err.message);
      }

      if (i < numbers.length - 1) {
        await new Promise(function(r) { setTimeout(r, 200); });
      }
    }

    ComparisonCore.setFetchedPatents(fetchedPatents, errors, Object.assign({}, _failedPatents));

    if (progressContainer) {
      var errMsg = '';
      if (errors.length > 0) {
        errMsg = '<div style="margin-top:8px;font-size:12px;color:#ef4444;">失败: ' + errors.map(ComparisonUtils.escapeHtml).join('; ') + '</div>';
      }
      progressContainer.innerHTML = '<div class="comparison-progress">' +
        '<div class="comparison-progress-text">查询完成: 成功 ' + Object.keys(fetchedPatents).length + ' 个' + (errors.length > 0 ? '，失败 ' + errors.length + ' 个' : '') + '</div>' +
        '<div class="comparison-progress-bar"><div class="comparison-progress-fill" style="width:100%"></div></div>' +
        errMsg +
        '</div>';
    }

    if (Object.keys(fetchedPatents).length > 0) {
      renderClaimsSelector(claimsContainer, fetchedPatents);
      ComparisonUI.scrollToClaimsSelector();
    } else {
      if (claimsContainer) claimsContainer.innerHTML = '';
    }

    _renderFailedPatents(claimsContainer);

    if (btn) btn.disabled = false;
  }

  function renderClaimsSelector(container, patents) {
    if (!container) return;

    var html = '<div class="claims-selector" style="margin-top:16px;" id="cmp-claims-selector-inner">';

    html += '<div class="claims-selector-toolbar">';
    html += '  <span class="claims-selector-title">';
    html += '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;vertical-align:-2px;margin-right:4px;"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    html += '    权利要求列表';
    html += '  </span>';
    html += '  <div class="claims-selector-actions">';
    html += '    <button class="btn-secondary btn-small" onclick="ComparisonInput.expandAllPatentGroups()">展开全部</button>';
    html += '    <button class="btn-secondary btn-small" onclick="ComparisonInput.collapseAllPatentGroups()">折叠全部</button>';
    html += '  </div>';
    html += '</div>';

    Object.keys(patents).forEach(function(patentNum) {
      var patent = patents[patentNum];
      var claims = patent.claims;
      var indCount = 0;
      claims.forEach(function(c, i) {
        if (ComparisonCore.isIndependentClaim(c, i)) indCount++;
      });

      html += '<div class="patent-claims-group" data-patent="' + patentNum + '">';
      html += '  <div class="patent-claims-header collapsed" onclick="ComparisonInput.togglePatentGroup(this)">';
      html += '    <svg class="patent-claims-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
      html += '    <strong>' + ComparisonUtils.escapeHtml(patentNum) + '</strong>';
      if (patent.title) {
        html += '  <span class="patent-title-text">' + ComparisonUtils.escapeHtml(patent.title) + '</span>';
      }
      html += '    <span class="patent-claims-count">' + claims.length + '项 (' + indCount + '项独权)</span>';
      html += '  </div>';
      html += '  <div class="patent-claims-list collapsed">';

      claims.forEach(function(claim, idx) {
        var isInd = ComparisonCore.isIndependentClaim(claim, idx);
        var claimNum = claim.num || (idx + 1);
        var key = patentNum + '_' + claimNum;
        if (!_selectedClaims.hasOwnProperty(key)) {
          _selectedClaims[key] = isInd;
        }
        var isChecked = _selectedClaims[key];
        var fullText = (claim.text || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

        html += '<label class="claim-select-item" data-full-text="' + fullText + '">';
        html += '  <input type="checkbox" class="claim-select-checkbox" data-patent="' + patentNum + '" data-claim-num="' + claimNum + '" data-claim-idx="' + idx + '" ' + (isChecked ? 'checked' : '') + ' onchange="ComparisonInput.toggleClaimSelect(this)">';
        html += '  <div class="claim-select-content">';
        html += '    <span class="claim-select-num">' + claimNum + (isInd ? ' 独权' : ' 从权') + '</span>';
        html += '    <span class="claim-select-text">' + ComparisonUtils.escapeHtml(ComparisonUtils.truncateText(claim.text, 150)) + '</span>';
        html += '  </div>';
        html += '</label>';
      });

      html += '  </div>';
      html += '</div>';
    });

    html += '</div>';

    html += '<div style="display:flex;gap:8px;margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">';
    html += '  <button class="btn-primary" onclick="ComparisonInput.addSelectedClaims()">添加选中权利要求到比对列表 →</button>';
    html += '  <button class="btn-secondary" onclick="ComparisonInput.selectAllClaims(true)">全选独权</button>';
    html += '  <button class="btn-secondary" onclick="ComparisonInput.selectAllClaims(false)">全选/取消全选</button>';
    html += '</div>';

    container.innerHTML = html;
    container._patentsData = patents;
    _bindClaimTooltip(container);
  }

  function expandAllPatentGroups() {
    var container = document.getElementById('cmp-claims-selector-inner');
    if (!container) return;
    var headers = container.querySelectorAll('.patent-claims-header');
    headers.forEach(function(h) {
      h.classList.remove('collapsed');
      var list = h.nextElementSibling;
      if (list) list.classList.remove('collapsed');
    });
  }

  function collapseAllPatentGroups() {
    var container = document.getElementById('cmp-claims-selector-inner');
    if (!container) return;
    var headers = container.querySelectorAll('.patent-claims-header');
    headers.forEach(function(h) {
      h.classList.add('collapsed');
      var list = h.nextElementSibling;
      if (list) list.classList.add('collapsed');
    });
  }

  function _restoreClaimSelections() {
    var container = document.getElementById('cmp-claims-selector');
    if (!container) return;
    var checkboxes = container.querySelectorAll('.claim-select-checkbox');
    checkboxes.forEach(function(cb) {
      var key = cb.dataset.patent + '_' + cb.dataset.claimNum;
      if (_selectedClaims.hasOwnProperty(key)) {
        cb.checked = _selectedClaims[key];
      }
    });
  }

  function togglePatentGroup(headerEl) {
    headerEl.classList.toggle('collapsed');
    var list = headerEl.nextElementSibling;
    if (list) list.classList.toggle('collapsed');
  }

  function toggleClaimSelect(checkbox) {
    var key = checkbox.dataset.patent + '_' + checkbox.dataset.claimNum;
    _selectedClaims[key] = checkbox.checked;
  }

  function selectAllClaims(indOnly) {
    var container = document.getElementById('cmp-claims-selector');
    if (!container) return;
    var patents = ComparisonCore.getFetchedPatents();
    if (!patents) {
      patents = container._patentsData;
    }
    if (!patents) return;

    var checkboxes = container.querySelectorAll('.claim-select-checkbox');
    var allChecked = true;
    checkboxes.forEach(function(cb) {
      if (indOnly) {
        var idx = parseInt(cb.dataset.claimIdx);
        var patent = patents[cb.dataset.patent];
        if (patent && patent.claims[idx]) {
          var isInd = ComparisonCore.isIndependentClaim(patent.claims[idx], idx);
          cb.checked = isInd;
          _selectedClaims[cb.dataset.patent + '_' + cb.dataset.claimNum] = isInd;
        }
      } else {
        allChecked = allChecked && cb.checked;
      }
    });

    if (!indOnly) {
      checkboxes.forEach(function(cb) {
        cb.checked = !allChecked;
        _selectedClaims[cb.dataset.patent + '_' + cb.dataset.claimNum] = cb.checked;
      });
    }
  }

  function addSelectedClaims() {
    var container = document.getElementById('cmp-claims-selector');
    var patents = ComparisonCore.getFetchedPatents();
    if (!patents && container) {
      patents = container._patentsData;
    }
    if (!patents) return;

    var addedCount = 0;

    Object.keys(patents).forEach(function(patentNum) {
      var patent = patents[patentNum];
      patent.claims.forEach(function(claim, idx) {
        var claimNum = claim.num || (idx + 1);
        var key = patentNum + '_' + claimNum;
        if (_selectedClaims[key]) {
          var isInd = ComparisonCore.isIndependentClaim(claim, idx);
          var existing = ComparisonCore.getItems().find(function(i) {
            return i.patentNumber === patentNum && i.claimNumber === claimNum;
          });
          if (!existing) {
            ComparisonCore.addItem({
              label: patentNum + ' 权' + claimNum + (isInd ? ' (独权)' : ' (从权)'),
              source: 'patent',
              patentNumber: patentNum,
              claimNumber: claimNum,
              originalText: claim.text || '',
              isSelected: true,
              metadata: {
                title: patent.title,
                applicant: patent.applicant,
                claimType: isInd ? 'independent' : 'dependent',
                claimIndex: idx
              }
            });
            addedCount++;
          }
        }
      });
    });

    if (addedCount > 0) {
      ComparisonUI.scrollToAnchorTab();
    } else {
      alert('请至少选择一项权利要求');
    }
  }

  async function loadFromFamilyPatents(patents) {
    ComparisonCore.clearItems();
    ComparisonCore.setInputMode('patent');
    ComparisonUI.render();

    var progressContainer = document.getElementById('cmp-patent-progress');
    var claimsContainer = document.getElementById('cmp-claims-selector');
    var textarea = document.getElementById('cmp-patent-numbers');

    var patentNums = patents.map(function(p) { return p.patentNumber || p.publication_number || ''; }).filter(Boolean);
    var numsText = patentNums.join('\n');

    if (textarea) {
      textarea.value = numsText;
    }
    ComparisonCore.setPatentNumbersText(numsText);

    await fetchPatents();
  }

  return {
    renderInputArea: renderInputArea,
    addManualText: addManualText,
    fetchPatents: fetchPatents,
    clearPatentInput: clearPatentInput,
    togglePatentGroup: togglePatentGroup,
    toggleClaimSelect: toggleClaimSelect,
    selectAllClaims: selectAllClaims,
    addSelectedClaims: addSelectedClaims,
    loadFromFamilyPatents: loadFromFamilyPatents,
    retrySinglePatent: retrySinglePatent,
    retryAllFailed: retryAllFailed,
    showManualInput: showManualInput,
    updateManualText: updateManualText,
    addManualTextForPatent: addManualTextForPatent,
    expandAllPatentGroups: expandAllPatentGroups,
    collapseAllPatentGroups: collapseAllPatentGroups
  };
})();
