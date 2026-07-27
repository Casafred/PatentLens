/*!
 * PatentLens - 智能比对模块 - UI渲染
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 * @author Alfred Shi
 * @version 260727
 */

var ComparisonUI = (function () {
  var _container = null;
  var _streamContent = '';
  var _onStreamUpdate = null;
  var _initialized = false;
  var _historyDropdownOpen = false;
  var _lastActiveTab = 'prepare';

  function getContainer() {
    if (!_container) {
      _container = document.getElementById('comparison-section');
    }
    return _container;
  }

  function getSimilarityColor(score) {
    if (score >= 0.8) return { bg: '#dcfce7', fg: '#166534', pct: Math.round(score * 100) };
    if (score >= 0.6) return { bg: '#fef9c3', fg: '#854d0e', pct: Math.round(score * 100) };
    if (score >= 0.4) return { bg: '#ffedd5', fg: '#9a3412', pct: Math.round(score * 100) };
    if (score >= 0.2) return { bg: '#fee2e2', fg: '#991b1b', pct: Math.round(score * 100) };
    return { bg: '#f3f4f6', fg: '#6b7280', pct: Math.round(score * 100) };
  }

  function getSimilarityLabel(score) {
    if (score >= 0.8) return '高度相似';
    if (score >= 0.6) return '较为相似';
    if (score >= 0.4) return '部分相似';
    if (score >= 0.2) return '低度相似';
    return '差异较大';
  }

  function render() {
    var container = getContainer();
    if (!container) return;

    var oldTabContent = container.querySelector('.cmp-tab-content');
    var savedScrollTop = oldTabContent ? oldTabContent.scrollTop : 0;
    var prevActiveTab = _lastActiveTab;

    var items = ComparisonCore.getItems();
    var selected = ComparisonCore.getSelectedItems();
    var anchor = ComparisonCore.getAnchor();
    var isLoading = ComparisonCore.isLoading();
    var result = ComparisonCore.getResult();
    var inputMode = ComparisonCore.getState().inputMode;
    var activeTab = ComparisonCore.getActiveTab();

    var canGoAnchor = items.length >= 1;
    var canPreview = selected.length >= 2 && anchor && !isLoading;
    if (result && activeTab !== 'result') {
      activeTab = 'result';
    }
    if (!isLoading && !result && activeTab === 'result') {
      activeTab = canPreview ? 'preview' : (canGoAnchor ? 'anchor' : 'prepare');
    }
    if (!isLoading && !result && activeTab === 'preview' && !canPreview) {
      activeTab = canGoAnchor ? 'anchor' : 'prepare';
    }
    if (!isLoading && !result && activeTab === 'anchor' && !canGoAnchor) {
      activeTab = 'prepare';
    }

    var tabChanged = (activeTab !== prevActiveTab);
    _lastActiveTab = activeTab;

    var html = '';

    html += '<div class="comparison-header">';
    html += '  <div class="comparison-title">';
    html += '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/><path d="M9 9l6 6"/><path d="M15 9l-6 6"/></svg>';
    html += '    智能比对';
    html += '    <span class="comparison-mode-badge">锚定模式</span>';
    html += '  </div>';
    html += '  <div class="comparison-header-actions">';
    html += '    <button class="btn-secondary btn-small cmp-history-btn" onclick="ComparisonUI.toggleHistoryDropdown(event)" title="比对历史记录">';
    html += '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:4px;vertical-align:-2px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    html += '      历史';
    html += '    </button>';
    html += '    <button class="btn-secondary btn-small" onclick="ComparisonCore.clearItems();ComparisonUI.render();">清空全部</button>';
    html += '  </div>';
    html += '</div>';

    html += '<div class="cmp-step-tabs">';
    html += renderStepTab('prepare', '①', '准备数据', '添加文本或查询专利权利要求', activeTab === 'prepare', true);
    html += '<div class="cmp-step-connector' + (canGoAnchor || activeTab !== 'prepare' ? ' done' : '') + '"></div>';
    html += renderStepTab('anchor', '②', '选择锚点', '设置锚点与勾选比对项', activeTab === 'anchor', canGoAnchor || activeTab === 'anchor' || activeTab === 'preview' || activeTab === 'result');
    html += '<div class="cmp-step-connector' + (canPreview || activeTab === 'preview' || activeTab === 'result' ? ' done' : '') + '"></div>';
    html += renderStepTab('preview', '③', '预览确认', '确认锚点与并排对照', activeTab === 'preview', canPreview || activeTab === 'preview' || activeTab === 'result');
    html += '<div class="cmp-step-connector' + (result ? ' done' : '') + '"></div>';
    html += renderStepTab('result', '④', '分析结果', 'AI比对分析报告', activeTab === 'result', !!result);
    html += '</div>';

    html += '<div class="cmp-tab-content">';

    if (activeTab === 'prepare') {
      html += renderPrepareTab(inputMode);
    } else if (activeTab === 'anchor') {
      html += renderAnchorTab(items, selected, anchor);
    } else if (activeTab === 'preview') {
      html += renderPreviewTab(selected, anchor);
    } else if (activeTab === 'result') {
      html += '<div id="comparison-result-container" style="min-height:300px;"></div>';
    }

    html += '</div>';

    html += renderActionBar(activeTab, isLoading, selected, anchor, result, canPreview, canGoAnchor);

    html += renderHistoryDropdown();

    container.innerHTML = html;
    bindEvents(container);

    var newTabContent = container.querySelector('.cmp-tab-content');
    if (newTabContent) {
      if (tabChanged) {
        newTabContent.scrollTop = 0;
      } else if (savedScrollTop > 0) {
        newTabContent.scrollTop = savedScrollTop;
      }
    }

    if (activeTab === 'prepare') {
      ComparisonInput.renderInputArea(document.getElementById('comparison-input-area'), inputMode);
    }
    if (activeTab === 'result') {
      renderResultArea(document.getElementById('comparison-result-container'));
    }
  }

  function renderStepTab(tabId, num, title, subtitle, isActive, isEnabled) {
    var cls = 'cmp-step-tab';
    if (isActive) cls += ' active';
    if (!isEnabled) cls += ' disabled';
    var onclick = isEnabled ? ' onclick="ComparisonCore.setActiveTab(\'' + tabId + '\');ComparisonUI.render();"' : '';
    var html = '<div class="' + cls + '" data-tab="' + tabId + '"' + onclick + '>';
    html += '  <div class="cmp-step-num">' + num + '</div>';
    html += '  <div class="cmp-step-text">';
    html += '    <div class="cmp-step-title">' + title + '</div>';
    html += '    <div class="cmp-step-subtitle">' + subtitle + '</div>';
    html += '  </div>';
    html += '</div>';
    return html;
  }

  function renderPrepareTab(inputMode) {
    var html = '';

    html += '<div class="comparison-input-tabs">';
    html += '  <button class="comparison-input-tab' + (inputMode === 'manual' ? ' active' : '') + '" data-input-mode="manual">手动输入文本</button>';
    html += '  <button class="comparison-input-tab' + (inputMode === 'patent' ? ' active' : '') + '" data-input-mode="patent">专利号查询</button>';
    html += '</div>';
    html += '<div id="comparison-input-area"></div>';

    return html;
  }

  function renderAnchorTab(items, selected, anchor) {
    var html = '';

    html += '<div class="cmp-anchor-hint">';
    html += '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;color:var(--accent);flex-shrink:0;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    html += '  <span>点击项右侧的 ⭐ 按钮将该项设为<strong>锚点</strong>（比对基准），勾选复选框选择需要参与比对的项。至少需要选中2项（含锚点）才能进入下一步。</span>';
    html += '</div>';

    html += '<div class="comparison-items-panel">';
    html += '  <div class="comparison-items-header">';
    html += '    <div>';
    html += '      <span class="comparison-items-title">待比对项列表</span>';
    html += '      <span class="comparison-items-count">共 ' + items.length + ' 项，已选 ' + selected.length + ' 项</span>';
    html += '      ' + (anchor ? '<span class="comparison-anchor-indicator"><svg viewBox="0 0 24 24" fill="currentColor" style="width:12px;height:12px;"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>锚点: ' + ComparisonUtils.escapeHtml(anchor.label) + '</span>' : '');
    html += '    </div>';
    html += '    <div class="comparison-items-actions">';
    if (items.length > 0) {
      html += '      <button class="btn-secondary btn-small" onclick="ComparisonCore.selectAll();ComparisonUI.render();">全选</button>';
      html += '      <button class="btn-secondary btn-small" onclick="ComparisonCore.deselectAll();ComparisonUI.render();">取消全选</button>';
    }
    html += '    </div>';
    html += '  </div>';
    html += '  <div class="comparison-items-list" style="max-height:none;overflow-y:visible;">';

    if (items.length === 0) {
      html += '    <div class="comparison-empty-list">';
      html += '      <p>暂无待比对项</p>';
      html += '      <p style="font-size:12px;margin-top:8px;">请在"①准备数据"步骤中通过手动输入或专利号查询添加比对项。</p>';
      html += '    </div>';
    } else {
      items.forEach(function(item, idx) {
        html += renderItem(item, idx, anchor);
      });
    }

    html += '  </div>';
    html += '</div>';

    return html;
  }

  function renderPreviewTab(selected, anchor) {
    var html = '';

    html += '<div class="cmp-preview-summary">';
    html += '  <div class="cmp-preview-summary-item">';
    html += '    <svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;color:var(--accent);"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    html += '    <span><strong>锚点：</strong>' + ComparisonUtils.escapeHtml(anchor ? anchor.label : '未设置') + '</span>';
    html += '  </div>';
    html += '  <div class="cmp-preview-summary-item">';
    html += '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;color:var(--accent);"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>';
    html += '    <span>共 <strong>' + selected.length + '</strong> 项待比对（含锚点），将对比 <strong>' + (selected.length - 1) + '</strong> 组</span>';
    html += '  </div>';
    html += '</div>';

    html += renderSimilarityMatrix(selected, anchor);
    html += renderSideBySide(selected, anchor);

    return html;
  }

  function renderActionBar(activeTab, isLoading, selected, anchor, result, canPreview, canGoAnchor) {
    var html = '<div class="cmp-action-bar">';

    if (isLoading) {
      html += '  <div class="cmp-loading-indicator">';
      html += '    <div class="cmp-spinner"></div>';
      html += '    <span>AI正在分析比对，请稍候...</span>';
      html += '  </div>';
      html += '  <button class="btn-danger" onclick="ComparisonCore.abort()">中止比对</button>';
    } else if (activeTab === 'prepare') {
      var hint = '';
      var items = ComparisonCore.getItems();
      if (items.length === 0) {
        hint = '请先添加文本或查询专利权利要求';
      } else {
        hint = '已添加 ' + items.length + ' 项，可继续添加或进入下一步选择锚点';
      }
      html += '  <span class="comparison-hint">' + hint + '</span>';
      html += '  <button class="btn-primary" onclick="ComparisonCore.setActiveTab(\'anchor\');ComparisonUI.render();" ' + (canGoAnchor ? '' : 'disabled') + '>下一步：选择锚点 →</button>';
    } else if (activeTab === 'anchor') {
      var hint2 = '';
      if (!anchor) {
        hint2 = '请先点击 ⭐ 按钮选择一个文本作为锚点（比对基准）';
      } else if (selected.length < 2) {
        hint2 = '请至少勾选2项（含锚点）才能进入预览';
      } else {
        hint2 = '锚点: ' + ComparisonUtils.truncateText(anchor.label, 30) + '，已选 ' + selected.length + ' 项';
      }
      html += '  <button class="btn-secondary" onclick="ComparisonCore.setActiveTab(\'prepare\');ComparisonUI.render();">← 返回准备</button>';
      html += '  <span class="comparison-hint">' + hint2 + '</span>';
      html += '  <span style="flex:1;"></span>';
      html += '  <button class="btn-primary" onclick="ComparisonCore.setActiveTab(\'preview\');ComparisonUI.render();" ' + (canPreview ? '' : 'disabled') + '>下一步：预览确认 →</button>';
    } else if (activeTab === 'preview') {
      html += '  <button class="btn-secondary" onclick="ComparisonCore.setActiveTab(\'anchor\');ComparisonUI.render();">← 返回修改</button>';
      html += '  <span style="flex:1;"></span>';
      html += '  <span class="comparison-hint">确认锚点和比对项无误后，开始AI分析</span>';
      html += '  <button class="btn-primary comparison-run-btn" onclick="ComparisonUI.runComparison();">开始锚定比对</button>';
    } else if (activeTab === 'result') {
      html += '  <button class="btn-secondary" onclick="ComparisonCore.setActiveTab(\'anchor\');ComparisonUI.render();">← 返回选择</button>';
      html += '  <span style="flex:1;"></span>';
      if (result && result.markdownContent) {
        html += '  <button class="btn-secondary" onclick="if(confirm(\'确定清空当前结果重新比对吗？\')){ComparisonCore.clearItems();ComparisonUI.render();}">重新比对</button>';
        html += '  <button class="btn-primary" onclick="ComparisonReport.exportHtml();">';
        html += '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:4px;"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
        html += '    导出HTML报告';
        html += '  </button>';
      } else {
        html += '  <button class="btn-primary" onclick="ComparisonUI.runComparison();">重新开始比对</button>';
      }
    }

    html += '</div>';
    return html;
  }

  function renderHistoryDropdown() {
    var history = ComparisonCore.history.getAll();
    var html = '<div id="cmp-history-dropdown" class="cmp-history-dropdown' + (_historyDropdownOpen ? ' open' : '') + '" onclick="event.stopPropagation();">';
    html += '  <div class="cmp-history-dropdown-header">';
    html += '    <span>比对历史记录 (' + history.length + ')</span>';
    if (history.length > 0) {
      html += '    <button class="btn-secondary btn-small" onclick="if(confirm(\'确定清空全部历史？\')){ComparisonCore.history.clear();ComparisonUI.render();}" style="color:#ef4444;border-color:#fca5a5;font-size:11px;padding:2px 8px;">清空全部</button>';
    }
    html += '  </div>';
    html += '  <div class="cmp-history-dropdown-list">';
    if (history.length === 0) {
      html += '  <div class="cmp-history-empty">暂无比对历史记录</div>';
    } else {
      history.forEach(function(entry) {
        var date = new Date(entry.timestamp || 0);
        var dateStr = (date.getMonth() + 1) + '/' + date.getDate() + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
        var patentStr = (entry.patentNumbers || []).join(', ');
        if (patentStr.length > 50) patentStr = patentStr.substring(0, 50) + '...';
        html += '<div class="cmp-history-dropdown-item" data-history-id="' + entry.id + '">';
        html += '  <div class="cmp-history-dd-item-main" onclick="ComparisonUI.viewHistoryEntry(\'' + entry.id + '\')">';
        html += '    <span class="cmp-history-dd-date">' + dateStr + '</span>';
        html += '    <span class="cmp-history-dd-patents">' + ComparisonUtils.escapeHtml(patentStr || '手动输入') + '</span>';
        html += '    <span class="cmp-history-dd-meta">' + (entry.itemCount || 0) + '项' + (entry.anchorLabel ? ' | 锚点: ' + ComparisonUtils.escapeHtml(entry.anchorLabel) : '') + '</span>';
        html += '  </div>';
        html += '  <div class="cmp-history-dd-item-actions">';
        html += '    <button class="btn-secondary btn-small" onclick="ComparisonUI.restoreHistory(\'' + entry.id + '\')">恢复</button>';
        html += '    <button class="btn-secondary btn-small" onclick="if(confirm(\'确定删除？\')){ComparisonCore.history.remove(\'' + entry.id + '\');ComparisonUI.render();}" style="color:#ef4444;border-color:#fca5a5;">删除</button>';
        html += '  </div>';
        html += '</div>';
      });
    }
    html += '  </div>';
    html += '</div>';
    return html;
  }

  function toggleHistoryDropdown(e) {
    if (e) e.stopPropagation();
    _historyDropdownOpen = !_historyDropdownOpen;
    var dd = document.getElementById('cmp-history-dropdown');
    if (dd) {
      dd.classList.toggle('open', _historyDropdownOpen);
    }
    if (_historyDropdownOpen) {
      setTimeout(function() {
        document.addEventListener('click', _closeHistoryDropdown, { once: true });
      }, 10);
    }
  }

  function _closeHistoryDropdown() {
    _historyDropdownOpen = false;
    var dd = document.getElementById('cmp-history-dropdown');
    if (dd) dd.classList.remove('open');
  }

  function viewHistoryEntry(id) {
    _showHistoryDetail(id);
    _historyDropdownOpen = false;
    var dd = document.getElementById('cmp-history-dropdown');
    if (dd) dd.classList.remove('open');
  }

  function renderItem(item, idx, anchor) {
    var isAnchor = anchor && anchor.id === item.id;
    var html = '';
    html += '<div class="comparison-item' + (item.isSelected ? ' selected' : '') + (isAnchor ? ' is-anchor' : '') + '" data-item-id="' + item.id + '">';
    html += '  <input type="checkbox" class="comparison-item-checkbox" ' + (item.isSelected ? 'checked' : '') + ' onchange="ComparisonCore.toggleItemSelected(\'' + item.id + '\');ComparisonUI.render();">';
    html += '  <div class="comparison-item-content">';
    html += '    <div class="comparison-item-top">';
    html += '      <input type="text" class="comparison-item-label-input" value="' + ComparisonUtils.escapeHtml(item.label) + '" onchange="ComparisonCore.updateItem(\'' + item.id + '\', {label: this.value});">';
    if (isAnchor) {
      html += '  <span class="comparison-item-badge anchor-badge"><svg viewBox="0 0 24 24" fill="currentColor" style="width:10px;height:10px;margin-right:3px;vertical-align:-1px;"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>锚点</span>';
    } else if (item.source === 'patent') {
      var badgeClass = item.metadata && item.metadata.claimType === 'independent' ? 'independent' : 'dependent';
      var badgeText = item.metadata && item.metadata.claimType === 'independent' ? '独权' : '从权';
      html += '  <span class="comparison-item-badge ' + badgeClass + '">' + badgeText + '</span>';
    } else {
      html += '  <span class="comparison-item-badge manual">手动输入</span>';
    }
    if (item.patentNumber) {
      html += '  <span style="font-size:11px;color:var(--text-secondary);">' + ComparisonUtils.escapeHtml(item.patentNumber) + '</span>';
    }
    html += '    </div>';
    html += '    <div class="comparison-item-preview" title="' + ComparisonUtils.escapeHtml(item.originalText) + '">' + ComparisonUtils.escapeHtml(ComparisonUtils.truncateText(item.originalText, 200)) + '</div>';
    html += '  </div>';
    html += '  <div class="comparison-item-actions">';
    if (!isAnchor && item.isSelected) {
      html += '    <button class="comparison-item-btn anchor-btn" title="设为锚点（基准文本）" onclick="ComparisonCore.setAnchor(\'' + item.id + '\');ComparisonUI.render();"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>';
    }
    html += '    <button class="comparison-item-btn" title="预览全文" onclick="ComparisonUI.previewItem(\'' + item.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>';
    if (idx > 0) {
      html += '  <button class="comparison-item-btn" title="上移" onclick="ComparisonCore.moveItem(\'' + item.id + '\', -1);ComparisonUI.render();"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg></button>';
    }
    if (idx < ComparisonCore.getItems().length - 1) {
      html += '  <button class="comparison-item-btn" title="下移" onclick="ComparisonCore.moveItem(\'' + item.id + '\', 1);ComparisonUI.render();"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button>';
    }
    html += '    <button class="comparison-item-btn danger" title="删除" onclick="ComparisonCore.removeItem(\'' + item.id + '\');ComparisonUI.render();"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>';
    html += '  </div>';
    html += '</div>';
    return html;
  }

  function renderSimilarityMatrix(selected, anchor) {
    var html = '<div class="comparison-sim-panel">';
    html += '  <div class="comparison-sim-header">';
    html += '    <div class="comparison-sim-title">';
    html += '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;color:var(--accent)"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>';
    html += '      语义相似度矩阵';
    html += '    </div>';
    html += '  </div>';
    html += '  <div style="padding:16px;text-align:center;color:var(--text-secondary);font-size:13px;">';
    html += '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;margin:0 auto 8px;display:block;opacity:0.5;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    html += '    点击"开始锚定比对"后，AI将基于技术方案实质内容（保护范围、技术特征、技术效果）评估跨语言相似度，结果将显示在此处';
    html += '  </div>';
    html += '</div>';
    return html;
  }

  function renderSideBySide(selected, anchor) {
    var others = selected.filter(function(i) { return i.id !== anchor.id; });
    if (others.length === 0) return '';

    var html = '<div class="comparison-sxs-panel">';
    html += '  <div class="comparison-sxs-header">';
    html += '    <div class="comparison-sxs-title">';
    html += '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;color:var(--accent)"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>';
    html += '      原文并排对照';
    html += '    </div>';
    html += '  </div>';

    others.forEach(function(other) {
      html += '<div class="comparison-sxs-pair">';
      html += '  <div class="comparison-sxs-pair-header">';
      html += '    <span class="comparison-sxs-vs">' + ComparisonUtils.escapeHtml(anchor.label) + ' ⭐</span>';
      html += '    <span class="comparison-sxs-sim" style="background:#f3f4f6;color:#6b7280;">AI待评估</span>';
      html += '    <span class="comparison-sxs-vs">vs ' + ComparisonUtils.escapeHtml(other.label) + '</span>';
      html += '  </div>';
      html += '  <div class="comparison-sxs-grid">';

      html += '    <div class="comparison-sxs-col anchor-col">';
      html += '      <div class="comparison-sxs-col-header"><svg viewBox="0 0 24 24" fill="currentColor" style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>锚点原文</div>';
      html += '      <div class="comparison-sxs-text">' + formatTextForDisplay(anchor.originalText) + '</div>';
      html += '    </div>';

      html += '    <div class="comparison-sxs-col compare-col">';
      html += '      <div class="comparison-sxs-col-header">比对原文</div>';
      html += '      <div class="comparison-sxs-text">' + formatTextForDisplay(other.originalText) + '</div>';
      html += '    </div>';

      html += '  </div>';
      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  function formatTextForDisplay(text) {
    if (!text) return '<em style="color:var(--text-secondary)">无内容</em>';
    return ComparisonUtils.escapeHtml(text).replace(/\n/g, '<br>');
  }

  function bindEvents(container) {
    var tabs = container.querySelectorAll('.comparison-input-tab');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var mode = this.dataset.inputMode;
        ComparisonCore.setInputMode(mode);
        render();
      });
    });
  }

  function _showHistoryDetail(id) {
    var entry = ComparisonCore.history.get(id);
    if (!entry) return;
    var modal = document.getElementById('comparison-history-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'comparison-history-modal';
      modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
      document.body.appendChild(modal);
    }
    var date = new Date(entry.timestamp || 0);
    var dateStr = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0') + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    var html = '<div style="background:var(--bg-card);border-radius:12px;max-width:800px;width:90%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);">';
    html += '<div style="padding:16px 20px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;">';
    html += '<div><strong>比对历史详情</strong><span style="margin-left:12px;font-size:12px;color:var(--text-secondary);">' + ComparisonUtils.escapeHtml(dateStr) + '</span></div>';
    html += '<button class="btn-secondary btn-small" onclick="document.getElementById(\'comparison-history-modal\').style.display=\'none\';">关闭</button>';
    html += '</div>';
    html += '<div style="padding:16px 20px;overflow-y:auto;flex:1;">';

    if (entry.patentNumbers && entry.patentNumbers.length > 0) {
      html += '<div style="margin-bottom:12px;"><strong>专利号:</strong> ' + ComparisonUtils.escapeHtml(entry.patentNumbers.join(', ')) + '</div>';
    }

    if (entry.itemsSummary && entry.itemsSummary.length > 0) {
      html += '<div style="margin-bottom:12px;"><strong>比对项 (' + entry.itemsSummary.length + '):</strong></div>';
      html += '<ul style="margin:0 0 12px 20px;padding:0;font-size:13px;">';
      entry.itemsSummary.forEach(function(i) {
        html += '<li>' + ComparisonUtils.escapeHtml(i.label) + (i.patentNumber ? ' <span style="color:var(--text-secondary);">(' + ComparisonUtils.escapeHtml(i.patentNumber) + ')</span>' : '') + '</li>';
      });
      html += '</ul>';
    }

    if (entry.claimsSnapshot && Object.keys(entry.claimsSnapshot).length > 0) {
      html += '<details style="margin-bottom:12px;"><summary style="cursor:pointer;font-weight:600;">权利要求原文快照</summary>';
      html += '<div style="margin-top:8px;">';
      Object.keys(entry.claimsSnapshot).forEach(function(pn) {
        var p = entry.claimsSnapshot[pn];
        html += '<div style="margin-bottom:10px;padding:10px;background:var(--bg-main);border-radius:6px;">';
        html += '<div style="font-weight:600;margin-bottom:4px;">' + ComparisonUtils.escapeHtml(p.patentNumber) + (p.title ? ' - ' + ComparisonUtils.escapeHtml(p.title) : '') + '</div>';
        if (p.applicant) html += '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:4px;">申请人: ' + ComparisonUtils.escapeHtml(p.applicant) + '</div>';
        if (p.claims && p.claims.length > 0) {
          html += '<div style="font-size:12px;max-height:200px;overflow-y:auto;">';
          p.claims.forEach(function(c) {
            var label = c.isIndependent ? ' (独权)' : '';
            html += '<div style="margin-bottom:4px;"><strong>权' + ComparisonUtils.escapeHtml(String(c.num)) + label + ':</strong> ' + ComparisonUtils.escapeHtml((c.text || '').substring(0, 200)) + (c.text && c.text.length > 200 ? '...' : '') + '</div>';
          });
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</div></details>';
    }

    if (entry.htmlContent) {
      html += '<div style="margin-top:12px;"><strong>比对结果:</strong></div>';
      html += '<div class="markdown-body" style="margin-top:8px;">' + entry.htmlContent + '</div>';
    }

    html += '</div>';
    html += '<div style="padding:12px 20px;border-top:1px solid var(--border-color);display:flex;gap:8px;justify-content:flex-end;">';
    html += '<button class="btn-secondary btn-small" onclick="document.getElementById(\'comparison-history-modal\').style.display=\'none\';">关闭</button>';
    html += '<button class="btn-primary btn-small" onclick="document.getElementById(\'comparison-history-modal\').style.display=\'none\';ComparisonUI.restoreHistory(\'' + entry.id + '\');">恢复到此比对</button>';
    html += '</div>';
    html += '</div>';
    modal.innerHTML = html;
    modal.style.display = 'flex';
  }

  function _restoreHistory(id) {
    var entry = ComparisonCore.history.get(id);
    if (!entry) return;
    ComparisonCore.clearItems();
    var restoredItems = [];
    var anchorItem = null;
    if (entry.itemsSummary) {
      entry.itemsSummary.forEach(function(i, idx) {
        var item = {
          id: i.id || ('restored_' + idx + '_' + Date.now()),
          label: i.label,
          source: i.source || 'manual',
          patentNumber: i.patentNumber || '',
          claimNumber: i.claimNumber || '',
          originalText: i.originalText || '',
          isSelected: i.isSelected !== false
        };
        ComparisonCore.addItem(item);
        restoredItems.push(item);
        if (entry.anchorId && entry.anchorId === i.id) {
          anchorItem = item;
        }
      });
    }
    if (entry.patentNumbersText) {
      ComparisonCore.setPatentNumbersText(entry.patentNumbersText);
    } else if (entry.patentNumbers && entry.patentNumbers.length > 0) {
      ComparisonCore.setPatentNumbersText(entry.patentNumbers.join('\n'));
    }
    if (entry.claimsSnapshot && Object.keys(entry.claimsSnapshot).length > 0) {
      var fetched = {};
      Object.keys(entry.claimsSnapshot).forEach(function(key) {
        var p = entry.claimsSnapshot[key];
        fetched[key] = {
          patentNumber: p.patentNumber,
          title: p.title,
          applicant: p.applicant,
          claims: p.claims || []
        };
      });
      ComparisonCore.setFetchedPatents(fetched, [], {});
    }
    if (restoredItems.length > 0) {
      if (!anchorItem) anchorItem = restoredItems[0];
      ComparisonCore.setAnchor(anchorItem.id);
    }
    if (entry.markdownContent || entry.htmlContent) {
      var resultItems = restoredItems.length > 0 ? restoredItems : (entry.itemsSummary || []).map(function(i, idx) {
        return {
          id: i.id || ('restored_' + idx + '_' + Date.now()),
          label: i.label,
          patentNumber: i.patentNumber,
          source: i.source,
          claimNumber: i.claimNumber || '',
          originalText: i.originalText || '',
          isSelected: true
        };
      });
      var resultAnchor = anchorItem || { label: entry.anchorLabel || '', id: 'restored_anchor', isSelected: true, originalText: '' };
      ComparisonCore.setResult({
        sessionId: entry.id,
        timestamp: entry.timestamp,
        anchor: resultAnchor,
        items: resultItems,
        others: resultItems.filter(function(i) { return i.id !== resultAnchor.id; }),
        markdownContent: entry.markdownContent || '',
        htmlContent: entry.htmlContent || '',
        similarityMatrix: null,
        aiSimilarityScores: null,
        aiSimilarityMatrix: null
      });
    }
    if (entry.patentNumbersText || (entry.claimsSnapshot && Object.keys(entry.claimsSnapshot).length > 0)) {
      ComparisonCore.setInputMode('patent');
    } else {
      ComparisonCore.setInputMode('manual');
    }
    render();
  }

  function renderAiSimMatrix(result) {
    var items = result.items || [];
    var anchor = result.anchor;
    var aiMatrix = result.aiSimilarityMatrix;
    var aiScores = result.aiSimilarityScores || {};
    if (!anchor || items.length < 2) return '';

    var html = '<div class="comparison-sim-panel" style="margin-top:0;">';
    html += '  <div class="comparison-sim-header">';
    html += '    <div class="comparison-sim-title">';
    html += '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;color:var(--accent)"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>';
    html += '      AI语义相似度矩阵';
    html += '      <span style="font-size:11px;font-weight:normal;color:var(--text-secondary);margin-left:8px;">（基于技术方案实质内容评估，支持跨语言）</span>';
    html += '    </div>';
    html += '  </div>';
    html += '  <div class="comparison-sim-scroll">';
    html += '  <table class="comparison-sim-matrix">';
    html += '    <thead><tr><th></th>';
    items.forEach(function(item) {
      var isAnc = item.id === anchor.id;
      html += '<th class="' + (isAnc ? 'sim-anchor-col' : '') + '">' + ComparisonUtils.escapeHtml(ComparisonUtils.truncateText(item.label, 12)) + (isAnc ? ' ⭐' : '') + '</th>';
    });
    html += '    </tr></thead><tbody>';

    var anchorIdx = items.findIndex(function(i) { return i.id === anchor.id; });
    items.forEach(function(item, i) {
      var isAncRow = item.id === anchor.id;
      html += '<tr><th class="' + (isAncRow ? 'sim-anchor-row' : '') + '">' + ComparisonUtils.escapeHtml(ComparisonUtils.truncateText(item.label, 12)) + (isAncRow ? ' ⭐' : '') + '</th>';
      items.forEach(function(_, j) {
        if (i === j) {
          html += '<td class="sim-cell sim-diag" style="background:#dcfce7;color:#166534;">100%</td>';
        } else {
          var score = null;
          if (aiMatrix && aiMatrix.matrix && aiMatrix.matrix[i] && aiMatrix.matrix[i][j] !== null && aiMatrix.matrix[i][j] !== undefined) {
            score = aiMatrix.matrix[i][j];
          }
          if (score !== null) {
            var pct = Math.round(score * 100);
            var color = getSimilarityColor(score);
            var isAnchorCell = isAncRow || items[j].id === anchor.id;
            html += '<td class="sim-cell' + (isAnchorCell ? ' sim-anchor-cell' : '') + '" style="background:' + color.bg + ';color:' + color.fg + ';font-weight:' + (isAnchorCell ? '600' : '400') + ';" title="' + ComparisonUtils.escapeHtml(items[i].label) + ' vs ' + ComparisonUtils.escapeHtml(items[j].label) + ': ' + pct + '%">' + pct + '%</td>';
          } else {
            html += '<td class="sim-cell" style="background:#f9fafb;color:#9ca3af;" title="AI未评估此对比对">—</td>';
          }
        }
      });
      html += '</tr>';
    });

    html += '    </tbody></table>';
    html += '  </div>';
    html += '  <div class="comparison-sim-legend">';
    html += '    <span class="sim-legend-item" style="background:#dcfce7;color:#166534;">高度相似 ≥80%</span>';
    html += '    <span class="sim-legend-item" style="background:#fef9c3;color:#854d0e;">较为相似 60-79%</span>';
    html += '    <span class="sim-legend-item" style="background:#ffedd5;color:#9a3412;">部分相似 40-59%</span>';
    html += '    <span class="sim-legend-item" style="background:#fee2e2;color:#991b1b;">低度相似 20-39%</span>';
    html += '    <span class="sim-legend-item" style="background:#f3f4f6;color:#6b7280;">差异较大 &lt;20%</span>';
    html += '    <span class="sim-legend-item" style="background:#f9fafb;color:#9ca3af;border:1px dashed #d1d5db;">— AI未评估</span>';
    html += '  </div>';
    html += '</div>';
    return html;
  }

  function renderResultArea(container) {
    if (!container) return;
    var isLoading = ComparisonCore.isLoading();
    var result = ComparisonCore.getResult();

    var html = '';
    if (isLoading) {
      html += '<div class="comparison-result-panel">';
      html += '  <div class="comparison-loading">';
      html += '    <div class="comparison-spinner"></div>';
      html += '    <div class="comparison-loading-text">AI正在锚定分析比对，请稍候...</div>';
      html += '    <div id="comparison-stream-preview" class="comparison-stream-preview"></div>';
      html += '  </div>';
      html += '</div>';
    } else if (result) {
      var anchor = result.anchor;
      var others = result.others || [];

      html += '<div class="comparison-result-panel">';
      html += '  <div class="comparison-result-header">';
      html += '    <div class="comparison-result-title">';
      html += '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:var(--accent)"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
      html += '      锚定比对分析结果';
      html += '    </div>';
      html += '    <div class="comparison-result-actions">';
      html += '      <button class="btn-secondary btn-small" onclick="ComparisonReport.exportHtml()" id="comparison-export-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:4px;vertical-align:-2px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>导出HTML报告</button>';
      html += '    </div>';
      html += '  </div>';

      html += renderAiSimMatrix(result);

      html += '  <div class="comparison-result-content markdown-body">';
      html += result.htmlContent;
      html += '  </div>';

      html += '  <div class="comparison-result-originals">';
      html += '    <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;color:var(--text-secondary);">附录：原文完整对照</h3>';

      html += '    <div class="comparison-result-anchor">';
      html += '      <div class="comparison-sxs-col-header" style="margin-bottom:8px;"><svg viewBox="0 0 24 24" fill="currentColor" style="width:12px;height:12px;margin-right:4px;vertical-align:-1px;color:#f59e0b;"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>锚点：' + ComparisonUtils.escapeHtml(anchor.label) + '</div>';
      html += '      <div class="comparison-original-block">' + formatTextForDisplay(anchor.originalText) + '</div>';
      html += '    </div>';

      var aiScores = result.aiSimilarityScores || {};
      others.forEach(function(other) {
        var sim = aiScores[other.label];
        var simBadge;
        if (sim !== null && sim !== undefined) {
          var simColor = getSimilarityColor(sim);
          var simLabel = getSimilarityLabel(sim);
          simBadge = '<span class="comparison-sxs-sim" style="background:' + simColor.bg + ';color:' + simColor.fg + ';margin-left:8px;font-size:11px;padding:1px 8px;border-radius:10px;" title="AI语义相似度">' + Math.round(sim * 100) + '% ' + simLabel + '</span>';
        } else {
          simBadge = '<span class="comparison-sxs-sim" style="background:#f3f4f6;color:#6b7280;margin-left:8px;font-size:11px;padding:1px 8px;border-radius:10px;">—</span>';
        }
        html += '    <div class="comparison-result-other">';
        html += '      <div class="comparison-sxs-col-header" style="margin-bottom:8px;">比对：' + ComparisonUtils.escapeHtml(other.label) + simBadge + '</div>';
        html += '      <div class="comparison-original-block">' + formatTextForDisplay(other.originalText) + '</div>';
        html += '    </div>';
      });

      html += '  </div>';
      html += '</div>';
    }

    container.innerHTML = html;

    if (isLoading) {
      _streamContent = '';
      var preview = document.getElementById('comparison-stream-preview');
      if (_onStreamUpdate) {
        ComparisonCore.off('streamUpdate', _onStreamUpdate);
      }
      _onStreamUpdate = function(content) {
        _streamContent = content;
        var el = document.getElementById('comparison-stream-preview');
        if (el) {
          el.textContent = content;
          el.scrollTop = el.scrollHeight;
        }
      };
      if (preview) {
        ComparisonCore.on('streamUpdate', _onStreamUpdate);
      }
    }
  }

  function runComparison() {
    _streamContent = '';
    ComparisonCore.setActiveTab('result');
    ComparisonCore.runComparison().then(function() {
      render();
    }).catch(function(err) {
      alert('比对失败: ' + err.message);
      render();
    });
    render();
  }

  function previewItem(id) {
    var item = ComparisonCore.getItems().find(function(i) { return i.id === id; });
    if (!item) return;

    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };

    var box = document.createElement('div');
    box.style.cssText = 'background:var(--bg-card);border-radius:12px;max-width:800px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);';

    var isAnchor = ComparisonCore.getAnchor() && ComparisonCore.getAnchor().id === item.id;
    var anchorBadge = isAnchor ? ' <span style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;margin-left:8px;">⭐ 锚点</span>' : '';

    box.innerHTML = '<div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">' +
      '<h3 style="margin:0;font-size:16px;">' + ComparisonUtils.escapeHtml(item.label) + anchorBadge + '</h3>' +
      '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="width:32px;height:32px;border:none;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;border-radius:6px;" onmouseover="this.style.background=\'var(--bg-hover)\'" onmouseout="this.style.background=\'transparent\'">&times;</button>' +
      '</div>' +
      '<div style="padding:20px;overflow-y:auto;flex:1;"><pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit;line-height:1.8;font-size:13px;margin:0;">' + ComparisonUtils.escapeHtml(item.originalText) + '</pre></div>';

    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  function showError(message) {
    console.error('Comparison error:', message);
  }

  function _scrollToClaimsSelector() {
    setTimeout(function() {
      var el = document.getElementById('cmp-claims-selector');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  }

  function _scrollToAnchorTab() {
    ComparisonCore.setActiveTab('anchor');
    render();
    setTimeout(function() {
      var container = getContainer();
      if (container) {
        var cmpSection = container.closest('.comparison-section') || container.parentElement;
        if (cmpSection) cmpSection.scrollTop = 0;
      }
      var tabContent = document.querySelector('.cmp-tab-content');
      if (tabContent) {
        tabContent.scrollTop = 0;
      }
    }, 80);
  }

  function init() {
    if (_initialized) return;
    _initialized = true;
    ComparisonCore.on('itemsChanged', function() {
      render();
    });
    ComparisonCore.on('anchorChanged', function() {
      render();
    });
    ComparisonCore.on('resultReady', function() {
      render();
    });
    ComparisonCore.on('error', function(msg) {
      showError(msg);
    });
  }

  return {
    render: render,
    runComparison: runComparison,
    previewItem: previewItem,
    restoreHistory: _restoreHistory,
    toggleHistoryDropdown: toggleHistoryDropdown,
    viewHistoryEntry: viewHistoryEntry,
    scrollToClaimsSelector: _scrollToClaimsSelector,
    scrollToAnchorTab: _scrollToAnchorTab,
    init: init
  };
})();
