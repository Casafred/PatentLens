/*!
 * PatentLens - 智能比对模块 - 核心状态管理与AI调用
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 * @author Alfred Shi
 * @version 260729
 */

var ComparisonCore = (function () {
  var _state = {
    items: [],
    anchorId: null,
    result: null,
    isLoading: false,
    isAborted: false,
    abortController: null,
    mode: 'manual',
    inputMode: 'manual',
    activeTab: 'prepare',
    pendingPatentClaims: null,
    loadedPatents: {},
    similarityMatrix: null,
    aiSimilarityScores: null,
    fetchedPatents: null,
    fetchErrors: [],
    failedPatents: {},
    patentNumbersText: '',
    manualLabelText: '',
    manualContentText: '',
    progress: {
      current: 0,
      total: 0,
      message: ''
    }
  };

  var _listeners = {};

  function on(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
  }

  function off(event, fn) {
    if (!_listeners[event]) return;
    _listeners[event] = _listeners[event].filter(function(f) { return f !== fn; });
  }

  function emit(event, data) {
    if (!_listeners[event]) return;
    _listeners[event].forEach(function(fn) {
      try { fn(data); } catch(e) { console.error('Comparison event listener error:', e); }
    });
  }

  function getState() {
    return JSON.parse(JSON.stringify(_state));
  }

  function getItems() {
    return _state.items.slice();
  }

  function getSelectedItems() {
    return _state.items.filter(function(item) { return item.isSelected; });
  }

  function getAnchor() {
    if (!_state.anchorId) return null;
    return _state.items.find(function(i) { return i.id === _state.anchorId; }) || null;
  }

  function setAnchor(id) {
    var item = _state.items.find(function(i) { return i.id === id; });
    _state.items.forEach(function(i) { i.isAnchor = false; });
    if (!item) {
      _state.anchorId = null;
    } else {
      _state.anchorId = id;
      item.isAnchor = true;
      if (!item.isSelected) {
        item.isSelected = true;
      }
    }
    _state.similarityMatrix = null;
    emit('anchorChanged', getAnchor());
    emit('itemsChanged', getItems());
  }

  function clearAnchor() {
    _state.anchorId = null;
    _state.similarityMatrix = null;
    emit('anchorChanged', null);
  }

  function computeTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    var t1 = text1.toLowerCase().replace(/\s+/g, ' ').trim();
    var t2 = text2.toLowerCase().replace(/\s+/g, ' ').trim();
    if (t1 === t2) return 1;
    if (t1.length < 10 || t2.length < 10) return 0;

    function getNGrams(str, n) {
      var grams = {};
      var count = 0;
      for (var i = 0; i <= str.length - n; i++) {
        var gram = str.substring(i, i + n);
        grams[gram] = (grams[gram] || 0) + 1;
        count++;
      }
      return { grams: grams, count: count };
    }

    var n = 4;
    var a = getNGrams(t1, n);
    var b = getNGrams(t2, n);

    var intersection = 0;
    var union = a.count + b.count;
    for (var key in a.grams) {
      if (a.grams.hasOwnProperty(key) && b.grams.hasOwnProperty(key)) {
        intersection += Math.min(a.grams[key], b.grams[key]);
      }
    }

    if (union === 0) return 0;
    var jaccard = (2 * intersection) / union;

    var words1 = t1.split(/\s+/).filter(function(w) { return w.length > 2; });
    var words2 = t2.split(/\s+/).filter(function(w) { return w.length > 2; });
    var wordSet1 = {};
    words1.forEach(function(w) { wordSet1[w] = true; });
    var wordIntersection = 0;
    words2.forEach(function(w) { if (wordSet1[w]) wordIntersection++; });
    var wordJaccard = words1.length > 0 && words2.length > 0
      ? wordIntersection / (words1.length + words2.length - wordIntersection)
      : 0;

    var score = jaccard * 0.6 + wordJaccard * 0.4;
    return Math.min(1, Math.max(0, score));
  }

  function computeSimilarityMatrix() {
    var selected = getSelectedItems();
    if (selected.length < 2) {
      _state.similarityMatrix = null;
      return null;
    }

    var matrix = [];
    for (var i = 0; i < selected.length; i++) {
      var row = [];
      for (var j = 0; j < selected.length; j++) {
        if (i === j) {
          row.push(1);
        } else {
          row.push(computeTextSimilarity(selected[i].originalText, selected[j].originalText));
        }
      }
      matrix.push(row);
    }

    _state.similarityMatrix = {
      items: selected.map(function(it) { return it.id; }),
      labels: selected.map(function(it) { return it.label; }),
      matrix: matrix
    };
    return _state.similarityMatrix;
  }

  function getSimilarityMatrix() {
    return _state.similarityMatrix;
  }

  function parseAiSimilarityScores(markdownContent) {
    if (!markdownContent) return {};
    var scores = {};
    try {
      var jsonMatch = markdownContent.match(/```(?:json)?\s*\n?(\{[\s\S]*?"similarityScores"[\s\S]*?\})\s*\n?```/);
      if (!jsonMatch) {
        jsonMatch = markdownContent.match(/```(?:json)?\s*\n?(\{[\s\S]*?\})\s*\n?```/g);
        if (jsonMatch) {
          for (var k = 0; k < jsonMatch.length; k++) {
            var block = jsonMatch[k];
            var inner = block.match(/```(?:json)?\s*\n?([\s\S]*?)\s*\n?```/);
            if (inner) {
              try {
                var parsed = JSON.parse(inner[1].trim());
                if (parsed && parsed.similarityScores) {
                  jsonMatch = [null, inner[1].trim()];
                  break;
                }
              } catch (e2) { /* continue */ }
            }
          }
        }
      }
      if (jsonMatch && jsonMatch[1]) {
        var data = JSON.parse(jsonMatch[1].trim());
        if (data && Array.isArray(data.similarityScores)) {
          data.similarityScores.forEach(function(item) {
            if (item.label && typeof item.score === 'number') {
              scores[item.label] = Math.max(0, Math.min(100, item.score)) / 100;
            }
          });
        }
      }
    } catch (e) {
      console.warn('Failed to parse AI similarity scores:', e);
    }
    return scores;
  }

  function buildAiSimilarityMatrix(selected, anchor, aiScores) {
    if (!selected || selected.length < 2 || !anchor) return null;
    var matrix = [];
    var anchorIdx = selected.findIndex(function(i) { return i.id === anchor.id; });
    for (var i = 0; i < selected.length; i++) {
      var row = [];
      for (var j = 0; j < selected.length; j++) {
        if (i === j) {
          row.push(1);
        } else if (i === anchorIdx) {
          var label = selected[j].label;
          row.push(aiScores && aiScores[label] !== undefined ? aiScores[label] : null);
        } else if (j === anchorIdx) {
          var label2 = selected[i].label;
          row.push(aiScores && aiScores[label2] !== undefined ? aiScores[label2] : null);
        } else {
          row.push(null);
        }
      }
      matrix.push(row);
    }
    return {
      items: selected.map(function(it) { return it.id; }),
      labels: selected.map(function(it) { return it.label; }),
      matrix: matrix,
      source: 'ai'
    };
  }

  function getAiSimilarityScore(label) {
    if (!_state.aiSimilarityScores) return null;
    return _state.aiSimilarityScores[label] !== undefined ? _state.aiSimilarityScores[label] : null;
  }

  function addItem(options) {
    var item = {
      id: options.id || ComparisonUtils.generateId(),
      label: options.label || ('文本' + (_state.items.length + 1)),
      source: options.source || 'manual',
      patentNumber: options.patentNumber || '',
      claimNumber: options.claimNumber || null,
      originalText: ComparisonUtils.cleanText(options.originalText || ''),
      originalLang: options.originalLang || ComparisonUtils.detectLanguage(options.originalText || ''),
      translatedText: options.translatedText || '',
      isSelected: options.isSelected !== false,
      isAnchor: !!options.isAnchor,
      metadata: options.metadata || {}
    };
    _state.items.push(item);

    if (options.isAnchor) {
      _state.anchorId = item.id;
    } else if (!_state.anchorId && _state.items.length === 1) {
      _state.anchorId = item.id;
    }

    _state.similarityMatrix = null;
    emit('itemsChanged', getItems());
    emit('anchorChanged', getAnchor());
    return item;
  }

  function updateItem(id, updates) {
    var idx = _state.items.findIndex(function(i) { return i.id === id; });
    if (idx === -1) return null;
    _state.items[idx] = Object.assign({}, _state.items[idx], updates);
    _state.similarityMatrix = null;
    emit('itemsChanged', getItems());
    return _state.items[idx];
  }

  function removeItem(id) {
    _state.items = _state.items.filter(function(i) { return i.id !== id; });
    if (_state.anchorId === id) {
      _state.anchorId = _state.items.length > 0 ? _state.items[0].id : null;
    }
    _state.similarityMatrix = null;
    emit('itemsChanged', getItems());
    emit('anchorChanged', getAnchor());
  }

  function toggleItemSelected(id) {
    var item = _state.items.find(function(i) { return i.id === id; });
    if (item) {
      item.isSelected = !item.isSelected;
      if (!item.isSelected && _state.anchorId === id) {
        var firstSelected = _state.items.find(function(i) { return i.isSelected && i.id !== id; });
        _state.anchorId = firstSelected ? firstSelected.id : null;
      }
      _state.similarityMatrix = null;
      emit('itemsChanged', getItems());
      emit('anchorChanged', getAnchor());
    }
  }

  function selectAll() {
    _state.items.forEach(function(i) { i.isSelected = true; });
    _state.similarityMatrix = null;
    emit('itemsChanged', getItems());
  }

  function deselectAll() {
    _state.items.forEach(function(i) { i.isSelected = false; });
    _state.anchorId = null;
    _state.similarityMatrix = null;
    emit('itemsChanged', getItems());
    emit('anchorChanged', null);
  }

  function clearItems() {
    _state.items = [];
    _state.anchorId = null;
    _state.result = null;
    _state.loadedPatents = {};
    _state.similarityMatrix = null;
    _state.aiSimilarityScores = null;
    _state.fetchedPatents = null;
    _state.fetchErrors = [];
    _state.failedPatents = {};
    _state.manualLabelText = '';
    _state.manualContentText = '';
    _state.activeTab = 'prepare';
    emit('itemsChanged', getItems());
    emit('anchorChanged', null);
    emit('resultCleared', null);
  }

  function moveItem(id, direction) {
    var idx = _state.items.findIndex(function(i) { return i.id === id; });
    if (idx === -1) return;
    var newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= _state.items.length) return;
    var temp = _state.items[idx];
    _state.items[idx] = _state.items[newIdx];
    _state.items[newIdx] = temp;
    _state.similarityMatrix = null;
    emit('itemsChanged', getItems());
  }

  function setMode(mode) {
    _state.mode = mode;
    emit('modeChanged', mode);
  }

  function setInputMode(inputMode) {
    _state.inputMode = inputMode;
    emit('inputModeChanged', inputMode);
  }

  function setActiveTab(tab) {
    if (['prepare', 'anchor', 'preview', 'result'].indexOf(tab) === -1) return;
    _state.activeTab = tab;
    emit('activeTabChanged', tab);
  }

  function getActiveTab() {
    return _state.activeTab;
  }

  function abort() {
    if (_state.abortController) {
      _state.isAborted = true;
      _state.abortController.abort();
    }
  }

  function setProgress(current, total, message) {
    _state.progress = { current: current, total: total, message: message || '' };
    emit('progress', _state.progress);
  }

  async function runComparison() {
    var selected = getSelectedItems();
    var anchor = getAnchor();
    if (selected.length < 2) {
      throw new Error('请至少选择2项进行比对');
    }
    if (!anchor) {
      throw new Error('请先选择一个锚点文本作为比对基准');
    }

    computeSimilarityMatrix();

    var config = AI.loadAIConfig();
    var provider = AI.getCurrentProvider(config);
    if (!provider) {
      throw new Error('请先配置AI API Key');
    }

    _state.isLoading = true;
    _state.isAborted = false;
    _state.result = null;
    _state.abortController = new AbortController();
    emit('loading', true);
    emit('progress', { current: 0, total: selected.length, message: '正在准备比对...' });

    var resultContent = '';

    try {
      var others = selected.filter(function(i) { return i.id !== anchor.id; });

      var messages = [
        { role: 'system', content: ComparisonPrompts.SYSTEM_PROMPT },
        { role: 'user', content: ComparisonPrompts.buildAnchorPrompt(anchor, others) }
      ];

      var stream = AI.streamChat(
        provider.type,
        provider.apiKey,
        provider.baseUrl,
        {
          model: provider.model,
          messages: messages,
          maxTokens: 65536,
          temperature: 0.1
        },
        _state.abortController.signal
      );

      var step = 0;

      for await (var chunk of stream) {
        if (_state.isAborted) break;
        if (chunk.content) {
          resultContent += chunk.content;
          emit('streamUpdate', resultContent);
          step += chunk.content.length;
          var progress = Math.min(90, Math.floor(step / 50));
          setProgress(progress, 100, 'AI正在分析比对...');
        }
      }

      if (!_state.isAborted) {
        _state.aiSimilarityScores = parseAiSimilarityScores(resultContent);
        var aiSimMatrix = buildAiSimilarityMatrix(selected, anchor, _state.aiSimilarityScores);
        var cleanMarkdown = resultContent.replace(/```json\s*\n?\{"similarityScores":[\s\S]*?\}\s*\n?```/g, '').trim();
        _state.result = {
          sessionId: 'sess_' + Date.now(),
          timestamp: Date.now(),
          anchor: anchor,
          items: selected,
          others: others,
          markdownContent: resultContent,
          htmlContent: marked.parse(cleanMarkdown),
          similarityMatrix: _state.similarityMatrix,
          aiSimilarityScores: _state.aiSimilarityScores,
          aiSimilarityMatrix: aiSimMatrix
        };
        setProgress(100, 100, '比对完成');
        // Save to history cache
        try {
          _history.save(_state.result, _state.patentNumbersText, _state.fetchedPatents);
        } catch(e) { console.warn('History save failed:', e); }
        emit('resultReady', _state.result);
      }
    } catch (err) {
      if (_state.isAborted) {
        emit('aborted', null);
      } else {
        console.error('Comparison error:', err);
        emit('error', err.message || '比对失败');
      }
    } finally {
      _state.isLoading = false;
      _state.abortController = null;
      emit('loading', false);
    }

    return _state.result;
  }

  function getResult() {
    return _state.result;
  }

  function setResult(result) {
    _state.result = result;
    if (result && result.anchor) {
      _state.anchorId = result.anchor.id;
    }
    if (result) {
      _state.activeTab = 'result';
    }
    emit('resultReady', result);
  }

  function isLoading() {
    return _state.isLoading;
  }

  function addPatentClaims(patentNumber, claims, metadata) {
    if (!claims || claims.length === 0) return 0;
    _state.loadedPatents[patentNumber] = {
      patentNumber: patentNumber,
      claims: claims,
      metadata: metadata || {}
    };
    var count = 0;
    claims.forEach(function(claim, idx) {
      var isInd = isIndependentClaim(claim, idx);
      addItem({
        label: patentNumber + ' 权' + (claim.num || (idx + 1)) + (isInd ? ' (独权)' : ' (从权)'),
        source: 'patent',
        patentNumber: patentNumber,
        claimNumber: claim.num || (idx + 1),
        originalText: claim.text || '',
        originalLang: ComparisonUtils.detectLanguage(claim.text || ''),
        isSelected: isInd,
        metadata: Object.assign({}, metadata || {}, {
          claimType: isInd ? 'independent' : 'dependent',
          claimIndex: idx
        })
      });
      count++;
    });
    return count;
  }

  function isIndependentClaim(c, idx) {
    if (!c) return false;
    if (c.type === 'independent') return true;
    if (c.type === 'dependent') return false;
    if (c.dependent_on !== undefined && c.dependent_on !== null && c.dependent_on !== '' && c.dependent_on !== false) return false;
    var text = (c.text || '').trim();
    var head = text.substring(0, 300);
    if (/^(根据|如|按照|依据).*(权利要求|权项|claim|claims)/i.test(head)) return false;
    if (/請求項\s*\d+/i.test(head)) return false;
    if (/に記載/.test(head)) return false;
    if (/のいずれか/.test(head)) return false;
    if (/前記|所述的/.test(text.substring(0, 80))) return false;
    if (/\bclaim\s+\d+/i.test(head)) return false;
    return idx === 0 ? true : false;
  }

  function getLoadedPatents() {
    return Object.assign({}, _state.loadedPatents);
  }

  function setPendingFamilyPatents(patents) {
    window._pendingComparisonPatents = patents;
  }

  function getPendingFamilyPatents() {
    var p = window._pendingComparisonPatents;
    window._pendingComparisonPatents = null;
    return p || null;
  }

  function init() {
    _state.items = [];
    _state.anchorId = null;
    _state.result = null;
    _state.isLoading = false;
    _state.loadedPatents = {};
    _state.similarityMatrix = null;
    _state.aiSimilarityScores = null;
    _state.fetchedPatents = null;
    _state.fetchErrors = [];
    _state.patentNumbersText = '';
    _state.manualLabelText = '';
    _state.manualContentText = '';
    _state.activeTab = 'prepare';
    emit('itemsChanged', getItems());
    emit('anchorChanged', null);
    emit('resultCleared', null);
  }

  function setFetchedPatents(patents, errors, failedMap) {
    _state.fetchedPatents = patents || null;
    _state.fetchErrors = errors || [];
    _state.failedPatents = failedMap || {};
  }

  function getFetchedPatents() {
    return _state.fetchedPatents;
  }

  function getFetchErrors() {
    return (_state.fetchErrors || []).slice();
  }

  function getFailedPatents() {
    return _state.failedPatents || {};
  }

  function setFailedPatents(failed) {
    _state.failedPatents = failed || {};
  }

  function setPatentNumbersText(text) {
    _state.patentNumbersText = text || '';
  }

  function getPatentNumbersText() {
    return _state.patentNumbersText || '';
  }

  function setManualInput(label, content) {
    _state.manualLabelText = label || '';
    _state.manualContentText = content || '';
  }

  function getManualLabelText() {
    return _state.manualLabelText || '';
  }

  function getManualContentText() {
    return _state.manualContentText || '';
  }

  function hasState() {
    return _state.items.length > 0 ||
      !!_state.result ||
      !!_state.fetchedPatents ||
      (_state.patentNumbersText && _state.patentNumbersText.trim().length > 0) ||
      (_state.manualContentText && _state.manualContentText.trim().length > 0);
  }

  // ── 智能比对历史记录缓存 ──
  var _history = {
    STORAGE_KEY: 'patentlens-comparison-history',
    MAX_ENTRIES: 20,

    _getAll: function() {
      try {
        var raw = localStorage.getItem(this.STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch(e) { return []; }
    },

    _save: function(list) {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(list));
      } catch(e) {
        console.warn('ComparisonHistory save failed:', e);
      }
    },

    getAll: function() {
      var list = this._getAll();
      list.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
      return list;
    },

    save: function(result, patentNumbersText, fetchedPatents) {
      if (!result) {
        console.warn('[ComparisonHistory] save called with no result');
        return null;
      }
      console.log('[ComparisonHistory] saving comparison result:', result.sessionId, 'items:', (result.items||[]).length);
      var patentNums = [];
      if (patentNumbersText && patentNumbersText.trim()) {
        patentNums = patentNumbersText.trim().split(/[\n,;]+/).map(function(s) {
          return s.trim();
        }).filter(Boolean);
      }
      if (patentNums.length === 0 && fetchedPatents) {
        patentNums = Object.keys(fetchedPatents);
      }
      var claimsSnapshot = {};
      if (fetchedPatents) {
        Object.keys(fetchedPatents).forEach(function(key) {
          var p = fetchedPatents[key];
          claimsSnapshot[key] = {
            patentNumber: p.patentNumber,
            title: p.title || '',
            applicant: p.applicant || '',
            claims: (p.claims || []).map(function(c) {
              return { num: c.num, text: c.text, isIndependent: c.isIndependent };
            })
          };
        });
      }
      var anchor = result.anchor || {};
      var entry = {
        id: result.sessionId || ('cmp_' + Date.now()),
        timestamp: result.timestamp || Date.now(),
        patentNumbers: patentNums,
        anchorLabel: anchor.label || '',
        anchorId: anchor.id || '',
        patentNumbersText: patentNumbersText || '',
        itemCount: (result.items || []).length,
        markdownContent: result.markdownContent || '',
        htmlContent: result.htmlContent || '',
        claimsSnapshot: claimsSnapshot,
        itemsSummary: (result.items || []).map(function(i) {
          return {
            id: i.id,
            label: i.label,
            patentNumber: i.patentNumber || '',
            source: i.source || '',
            claimNumber: i.claimNumber || '',
            originalText: i.originalText || '',
            isSelected: i.isSelected !== false
          };
        })
      };
      var list = this._getAll();
      list = list.filter(function(e) { return e.id !== entry.id; });
      list.push(entry);
      list.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
      if (list.length > this.MAX_ENTRIES) {
        list = list.slice(0, this.MAX_ENTRIES);
      }
      this._save(list);
      console.log('[ComparisonHistory] saved successfully, total entries:', list.length);
      return entry;
    },

    remove: function(id) {
      var list = this._getAll();
      list = list.filter(function(e) { return e.id !== id; });
      this._save(list);
    },

    clear: function() {
      this._save([]);
    },

    get: function(id) {
      var list = this._getAll();
      return list.find(function(e) { return e.id === id; }) || null;
    }
  };

  return {
    on: on,
    off: off,
    getState: getState,
    getItems: getItems,
    getSelectedItems: getSelectedItems,
    getAnchor: getAnchor,
    setAnchor: setAnchor,
    clearAnchor: clearAnchor,
    computeSimilarityMatrix: computeSimilarityMatrix,
    computeTextSimilarity: computeTextSimilarity,
    getSimilarityMatrix: getSimilarityMatrix,
    addItem: addItem,
    updateItem: updateItem,
    removeItem: removeItem,
    toggleItemSelected: toggleItemSelected,
    selectAll: selectAll,
    deselectAll: deselectAll,
    clearItems: clearItems,
    moveItem: moveItem,
    setMode: setMode,
    setInputMode: setInputMode,
    setActiveTab: setActiveTab,
    getActiveTab: getActiveTab,
    runComparison: runComparison,
    abort: abort,
    getResult: getResult,
    setResult: setResult,
    isLoading: isLoading,
    addPatentClaims: addPatentClaims,
    getLoadedPatents: getLoadedPatents,
    setPendingFamilyPatents: setPendingFamilyPatents,
    getPendingFamilyPatents: getPendingFamilyPatents,
    parseAiSimilarityScores: parseAiSimilarityScores,
    buildAiSimilarityMatrix: buildAiSimilarityMatrix,
    getAiSimilarityScore: getAiSimilarityScore,
    setFetchedPatents: setFetchedPatents,
    getFetchedPatents: getFetchedPatents,
    getFetchErrors: getFetchErrors,
    getFailedPatents: getFailedPatents,
    setFailedPatents: setFailedPatents,
    setPatentNumbersText: setPatentNumbersText,
    getPatentNumbersText: getPatentNumbersText,
    setManualInput: setManualInput,
    getManualLabelText: getManualLabelText,
    getManualContentText: getManualContentText,
    hasState: hasState,
    history: _history,
    init: init,
    isIndependentClaim: isIndependentClaim
  };
})();
