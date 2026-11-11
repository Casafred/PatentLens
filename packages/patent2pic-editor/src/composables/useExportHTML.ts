/**
 * 可交互 HTML 导出器
 * 使用 graphEngine.toSVG() 获取已渲染的 SVG，
 * 然后通过 data-cell-id 属性添加交互功能。
 *
 * 支持节点/边线点击高亮对应文本，左键拖拽平移画布，滚轮缩放。
 */

import { graphEngine } from '@/services/graph/engine'
import { useGraphStore } from '@/stores/graph'
import { useClaimStore } from '@/stores/claim'
import { useTranslationStore } from '@/stores/translation'
import type { ExtractNode } from '@/types/ai'

interface CellInfo {
  id: string
  type: 'node' | 'edge' | 'group' | 'attr-tag' | 'attr-stem' | 'fork'
  originalText?: string
  chineseText?: string
  sourceNodeId?: string
  edgeSourceId?: string
  edgeTargetId?: string
  realSourceId?: string
  realTargetId?: string
  isTrunk?: boolean
  isBranch?: boolean
  isContainment?: boolean
  forkNodeId?: string
  memberNodeIds?: string[]
  groupLabel?: { original: string; chinese: string }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function scriptJSON(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

/** 从 toJSON 数据构建 cell 信息映射 */
function buildCellInfoMap(): Map<string, CellInfo> {
  const cellsRaw = graphEngine.toJSON() as { cells?: Array<Record<string, unknown>> }
  const cells = cellsRaw?.cells ?? []
  const cellInfoMap = new Map<string, CellInfo>()

  for (const cell of cells) {
    const id = cell.id as string
    if (!id) continue
    const d = (cell.data || {}) as Record<string, unknown>
    const shape = cell.shape as string

    let type: CellInfo['type'] = 'node'
    if (d.isGroup) type = 'group'
    else if (d.isAttributeTag) type = 'attr-tag'
    else if (d.isAttributeStem) type = 'attr-stem'
    else if (d.isForkNode) type = 'fork'
    else if (shape === 'edge' || shape === 'edge-with-gap') type = 'edge'

    const source = cell.source as Record<string, unknown> | undefined
    const target = cell.target as Record<string, unknown> | undefined
    const edgeSourceId = (source?.cell as string) || undefined
    const edgeTargetId = (target?.cell as string) || undefined

    cellInfoMap.set(id, {
      id,
      type,
      originalText: d.originalText as string,
      chineseText: d.chineseText as string,
      sourceNodeId: d.sourceNodeId as string,
      edgeSourceId,
      edgeTargetId,
      realSourceId: d.realSourceId as string,
      realTargetId: d.realTargetId as string,
      isTrunk: d.isTrunk as boolean,
      isBranch: d.isBranch as boolean,
      isContainment: (d.isContainmentGroupEdge as boolean) || (id.startsWith('containment-edge-')),
      forkNodeId: d.forkNodeId as string,
      memberNodeIds: d.memberNodeIds as string[] | undefined,
      groupLabel: d.label as { original: string; chinese: string } | undefined,
    })
  }

  return cellInfoMap
}

/**
 * 后处理 X6 toSVG() 输出的 SVG：
 * 1. 根据 data-cell-id 添加交互属性
 * 2. 移除 fork 节点
 * 3. 清理可能导致 file:// 安全问题的外部引用
 * 4. 设置 pointer-events（节点可点击，边线可点击线条）
 */
function processSVG(svgStr: string, cellInfoMap: Map<string, CellInfo>): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgStr, 'image/svg+xml')

  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    console.error('SVG 解析失败，返回原始 SVG')
    return svgStr
  }

  // 辅助函数：设置元素的 pointer-events（同时修改 XML 属性和内联 style）
  const setPointerEvents = (el: Element, value: string) => {
    el.setAttribute('pointer-events', value)
    const existingStyle = el.getAttribute('style') || ''
    if (existingStyle) {
      const cleanedStyle = existingStyle.replace(/pointer-events\s*:\s*[^;]+;?\s*/gi, '')
      el.setAttribute('style', cleanedStyle + ';pointer-events:' + value + '!important')
    } else {
      el.setAttribute('style', 'pointer-events:' + value + '!important')
    }
  }

  const setPointerEventsRecursive = (el: Element, value: string) => {
    setPointerEvents(el, value)
    Array.from(el.children).forEach(child => setPointerEventsRecursive(child, value))
  }

  const cellElements = doc.querySelectorAll('[data-cell-id]')

  cellElements.forEach(el => {
    const cellId = el.getAttribute('data-cell-id') || ''
    el.setAttribute('data-id', cellId)

    const info = cellInfoMap.get(cellId)
    // 移除 fork 节点
    if (info?.type === 'fork') {
      el.remove()
      return
    }

    if (!info) return

    switch (info.type) {
      case 'node':
        el.classList.add('p2p-node')
        if (info.originalText) el.setAttribute('data-original', info.originalText)
        if (info.chineseText) el.setAttribute('data-chinese', info.chineseText)
        setPointerEventsRecursive(el, 'all')
        break
      case 'edge':
        el.classList.add('p2p-edge')
        if (info.isTrunk) el.classList.add('p2p-trunk')
        if (info.isBranch) el.classList.add('p2p-branch')
        if (info.isContainment) el.classList.add('p2p-containment')
        el.setAttribute('data-source', info.realSourceId || info.edgeSourceId || '')
        el.setAttribute('data-target', info.realTargetId || info.edgeTargetId || '')
        setPointerEventsRecursive(el, 'stroke')
        break
      case 'group':
        el.classList.add('p2p-group')
        if (info.memberNodeIds && info.memberNodeIds.length > 0) {
          el.setAttribute('data-member-ids', info.memberNodeIds.join(','))
        }
        if (info.groupLabel) {
          if (info.groupLabel.original) el.setAttribute('data-group-original', info.groupLabel.original)
          if (info.groupLabel.chinese) el.setAttribute('data-group-chinese', info.groupLabel.chinese)
        }
        setPointerEventsRecursive(el, 'all')
        break
      case 'attr-tag':
        el.classList.add('p2p-attr-tag')
        if (info.sourceNodeId) el.setAttribute('data-source', info.sourceNodeId)
        setPointerEventsRecursive(el, 'all')
        break
      case 'attr-stem':
        el.classList.add('p2p-attr-stem')
        setPointerEventsRecursive(el, 'none')
        break
    }
  })

  // 添加 pan/zoom wrapper
  const viewport = doc.querySelector('.x6-graph-svg-stage') || doc.querySelector('.x6-graph-svg-viewport')
  if (viewport && viewport.parentNode) {
    const wrapper = doc.createElementNS('http://www.w3.org/2000/svg', 'g')
    wrapper.setAttribute('class', 'p2p-pan-zoom-wrapper')
    viewport.parentNode.insertBefore(wrapper, viewport)
    wrapper.appendChild(viewport)
  }

  // 清理外部引用
  const images = doc.querySelectorAll('image')
  images.forEach(img => {
    const href = img.getAttribute('href') || img.getAttribute('xlink:href') || ''
    if (href && !href.startsWith('data:')) {
      img.remove()
    }
  })

  const styledElements = doc.querySelectorAll('[style]')
  styledElements.forEach(el => {
    const style = el.getAttribute('style') || ''
    if (style.includes('url(') && !style.includes('url(data:')) {
      el.setAttribute('style', style.replace(/url\([^)]*\)/g, 'none'))
    }
  })

  const serializer = new XMLSerializer()
  return serializer.serializeToString(doc)
}

/** 收集导出数据（节点信息、句子、翻译、组合框） */
function collectExportData() {
  const graphStore = useGraphStore()
  const claimStore = useClaimStore()
  const translationStore = useTranslationStore()

  const version = graphStore.activeVersion
  const nodes: ExtractNode[] = version?.extractResult?.nodes ?? []
  const groups = version?.extractResult?.groups ?? []

  const claim = claimStore.getActiveClaim() ?? null
  const sentences = claim?.sentences.map(s => ({ id: s.id, text: s.text })) ?? []

  const translations: Array<{ sentenceId: string; translatedText: string }> = []
  if (claim) {
    const claimTrans = translationStore.getClaimTranslation(claim.id)
    if (claimTrans) {
      for (const s of claimTrans.sentences) {
        translations.push({
          sentenceId: s.sentenceId,
          translatedText: s.translatedText,
        })
      }
    }
  }

  return {
    nodes: nodes.map(n => ({
      id: n.id,
      originalText: n.originalText,
      chineseText: n.chineseText,
    })),
    groups: groups.map(g => ({
      id: g.id,
      originalText: g.label.original,
      chineseText: g.label.chinese,
      memberNodeIds: g.memberNodeIds,
    })),
    sentences: sentences.map(s => {
      const trans = translations.find(t => t.sentenceId === s.id)
      return { id: s.id, text: s.text, translation: trans?.translatedText || '' }
    }),
    claimTitle: claim ? `权利要求 ${claim.index}` : '权利要求',
  }
}

/**
 * 生成完整的自包含 HTML
 * 支持节点/边线点击高亮，左键拖拽平移画布，滚轮缩放
 */
export function exportInteractiveHTML(): string {
  const rawSvg = graphEngine.toSVG()
  if (!rawSvg) {
    return '<!DOCTYPE html><html><body><h2>画布为空，无法导出</h2></body></html>'
  }

  const cellInfoMap = buildCellInfoMap()
  const processedSvg = processSVG(rawSvg, cellInfoMap)
  const data = collectExportData()

  const nodesJson = scriptJSON(data.nodes)
  const groupsJson = scriptJSON(data.groups)
  const sentencesJson = scriptJSON(data.sentences)
  const claimTitle = data.claimTitle

  // 序列化 cell 类型映射
  const cellTypesObj: Record<string, string> = {}
  cellInfoMap.forEach((info, id) => { cellTypesObj[id] = info.type })
  const cellTypesJson = scriptJSON(cellTypesObj)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Patent2Pic - ${escapeHtml(claimTitle)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; height: 100vh; overflow: hidden; background: #f0f2f5; }
.app { display: flex; height: 100vh; }
.sidebar { width: 420px; min-width: 320px; max-width: 50vw; background: #fff; border-right: 1px solid #e8e8e8; display: flex; flex-direction: column; overflow: hidden; }
.sidebar-header { padding: 12px 16px; background: #fafafa; border-bottom: 1px solid #e8e8e8; font-size: 14px; font-weight: 600; color: #1d2129; display: flex; align-items: center; justify-content: space-between; }
.sidebar-header .title { font-size: 15px; }
.sidebar-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
.sentence-block { margin-bottom: 16px; padding: 10px 12px; border-radius: 6px; background: #fafafa; transition: background 0.2s; }
.sentence-block:hover { background: #f0f7ff; }
.sentence-original { font-size: 14px; line-height: 1.7; color: #1d2129; margin-bottom: 6px; }
.sentence-translation { font-size: 13px; line-height: 1.6; color: #4e5969; font-style: italic; }
.sentence-translation:empty { display: none; }
mark.text-highlight { padding: 1px 3px; border-radius: 3px; font-weight: 600; cursor: pointer; }
.legend-bar { padding: 8px 16px; background: #fafafa; border-bottom: 1px solid #e8e8e8; display: flex; flex-wrap: wrap; gap: 8px; min-height: 36px; align-items: center; }
.legend-item { display: flex; align-items: center; gap: 4px; font-size: 12px; padding: 2px 8px; border-radius: 10px; cursor: pointer; }
.legend-item .dot { width: 10px; height: 10px; border-radius: 50%; }
.canvas-area { flex: 1; position: relative; overflow: hidden; background: #fff; cursor: grab; }
.canvas-area:active { cursor: grabbing; }
.canvas-area svg { width: 100%; height: 100%; }
.canvas-area, .canvas-area svg, .canvas-area svg * {
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  -webkit-user-drag: none;
}
.toolbar { position: absolute; top: 12px; right: 12px; display: flex; gap: 6px; z-index: 10; }
.toolbar button { width: 36px; height: 36px; border: 1px solid #ddd; background: #fff; border-radius: 6px; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.toolbar button:hover { background: #f5f5f5; }

/* 高亮样式 */
.p2p-node.p2p-highlighted rect { stroke: #e63946 !important; stroke-width: 3 !important; filter: drop-shadow(0 0 6px rgba(230,57,70,0.4)); }
.p2p-group.p2p-highlighted rect { stroke: #e63946 !important; stroke-width: 3 !important; filter: drop-shadow(0 0 6px rgba(230,57,70,0.4)); }
.p2p-attr-tag.p2p-highlighted rect { stroke: #e63946 !important; stroke-width: 3 !important; filter: drop-shadow(0 0 6px rgba(230,57,70,0.4)); }
.p2p-edge.p2p-highlighted path { stroke: #e63946 !important; stroke-width: 3 !important; }
.p2p-edge.p2p-highlighted-branch path { stroke: #f4a261 !important; stroke-width: 2.5 !important; }
.p2p-node { cursor: pointer !important; }
.p2p-node * { cursor: pointer !important; }
.p2p-group { cursor: pointer !important; }
.p2p-group * { cursor: pointer !important; }
.p2p-attr-tag { cursor: pointer !important; }
.p2p-attr-tag * { cursor: pointer !important; }
.p2p-edge { cursor: pointer !important; }
</style>
</head>
<body>
<div class="app">
  <div class="sidebar">
    <div class="sidebar-header">
      <span class="title">${escapeHtml(claimTitle)}</span>
      <span style="font-size:12px;color:#86909c">点击节点、边线或组合框高亮文本</span>
    </div>
    <div class="legend-bar" id="legend-bar"></div>
    <div class="sidebar-body" id="sidebar-body"></div>
  </div>
  <div class="canvas-area" id="canvas-area">
    ${processedSvg}
    <div class="toolbar">
      <button onclick="zoomIn()" title="放大">+</button>
      <button onclick="zoomOut()" title="缩小">−</button>
      <button onclick="resetView()" title="重置视图">⟲</button>
    </div>
  </div>
</div>
<script>
// ============================================================
// 数据
// ============================================================
var NODES = ${nodesJson};
var GROUPS = ${groupsJson};
var SENTENCES = ${sentencesJson};
var CELL_TYPES = ${cellTypesJson};

var svgEl = document.querySelector('.canvas-area svg');
var svgContainer = document.getElementById('canvas-area');
var sidebarBody = document.getElementById('sidebar-body');
var legendBar = document.getElementById('legend-bar');

var highlightedNodeIds = [];
var highlightedComboIds = [];

var HIGHLIGHT_PALETTE = [
  {bg:'#ffe3e3',border:'#e63946'},
  {bg:'#fff3cd',border:'#f4a261'},
  {bg:'#d4edda',border:'#2a9d8f'},
  {bg:'#d1ecf1',border:'#457b9d'},
  {bg:'#e2d9f3',border:'#7b2d8e'},
  {bg:'#fce4ec',border:'#c62828'},
  {bg:'#e0f2f1',border:'#00695c'},
  {bg:'#fff8e1',border:'#f9a825'},
];

// ============================================================
// 点击识别
// ============================================================
function findCellInfo(target) {
  var el = target;
  while (el && el !== svgEl && el !== document) {
    var cellId = el.getAttribute('data-cell-id') || el.getAttribute('data-id');
    if (cellId) {
      var type = CELL_TYPES[cellId] || 'node';
      return {cellId: cellId, type: type, el: el};
    }
    el = el.parentElement;
  }
  return null;
}

// ============================================================
// 画布平移和缩放
// ============================================================
var viewState = {x: 0, y: 0, scale: 1};
var wrapperEl = svgEl ? (svgEl.querySelector('.p2p-pan-zoom-wrapper') || svgEl.querySelector('.x6-graph-svg-stage') || svgEl.querySelector('.x6-graph-svg-viewport') || svgEl.querySelector('g')) : null;

function applyView() {
  if (wrapperEl) wrapperEl.setAttribute('transform', 'translate(' + viewState.x + ',' + viewState.y + ') scale(' + viewState.scale + ')');
}

// 左键拖拽平移画布
var panning = false, panStart = null;

if (svgContainer) {
  svgContainer.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;  // 只处理左键
    var info = findCellInfo(e.target);
    // 如果点击的是节点/边线/属性标签，不启动平移，让 click 事件处理高亮
    if (info && (info.type === 'node' || info.type === 'group' || info.type === 'attr-tag' || info.type === 'edge')) {
      return;
    }
    // 空白区域：启动平移
    panning = true;
    panStart = { x: e.clientX - viewState.x, y: e.clientY - viewState.y };
    e.preventDefault();
  });

  document.addEventListener('mousemove', function(e) {
    if (panning) {
      viewState.x = e.clientX - panStart.x;
      viewState.y = e.clientY - panStart.y;
      applyView();
    }
  });

  document.addEventListener('mouseup', function(e) {
    if (panning) {
      panning = false;
      panStart = null;
    }
  });

  // 滚轮缩放
  svgContainer.addEventListener('wheel', function(e) {
    e.preventDefault();
    var delta = e.deltaY > 0 ? 0.9 : 1.1;
    viewState.scale = Math.max(0.1, Math.min(3, viewState.scale * delta));
    applyView();
  }, {passive: false});
}

// ============================================================
// 点击高亮逻辑
// ============================================================
function clearAllHighlights() {
  if (!svgEl) return;
  svgEl.querySelectorAll('.p2p-highlighted').forEach(function(el) { el.classList.remove('p2p-highlighted'); });
  svgEl.querySelectorAll('.p2p-highlighted-branch').forEach(function(el) { el.classList.remove('p2p-highlighted-branch'); });
  highlightedNodeIds = [];
  highlightedComboIds = [];
}

function handleNodeClick(nodeId, ctrlKey) {
  if (ctrlKey) {
    var idx = highlightedNodeIds.indexOf(nodeId);
    if (idx >= 0) { highlightedNodeIds.splice(idx, 1); }
    else { highlightedNodeIds.push(nodeId); }
  } else {
    clearAllHighlights();
    highlightedNodeIds = [nodeId];
  }
  applyNodeHighlights();
  updateAllSentences();
  scrollToFirstHighlight();
}

function handleEdgeClick(edgeId, ctrlKey) {
  if (!ctrlKey) {
    clearAllHighlights();
  }

  var edgeEl = svgEl.querySelector('[data-cell-id="' + edgeId + '"]') ||
               svgEl.querySelector('[data-id="' + edgeId + '"]');
  if (!edgeEl) return;

  if (ctrlKey) {
    if (edgeEl.classList.contains('p2p-highlighted')) {
      edgeEl.classList.remove('p2p-highlighted');
      var srcId = edgeEl.getAttribute('data-source');
      if (srcId) {
        svgEl.querySelectorAll('.p2p-branch.p2p-highlighted-branch').forEach(function(be) {
          if (be.getAttribute('data-source') === srcId) be.classList.remove('p2p-highlighted-branch');
        });
      }
      applyNodeHighlights();
      updateAllSentences();
      return;
    }
  }

  edgeEl.classList.add('p2p-highlighted');
  var sourceId = edgeEl.getAttribute('data-source');
  var targetId = edgeEl.getAttribute('data-target');
  var isTrunk = edgeEl.classList.contains('p2p-trunk');

  if (isTrunk && sourceId) {
    svgEl.querySelectorAll('.p2p-branch').forEach(function(be) {
      if (be.getAttribute('data-source') === sourceId) be.classList.add('p2p-highlighted-branch');
    });
  }

  var nodeIds = [];
  if (isTrunk && sourceId) {
    nodeIds.push(sourceId);
    svgEl.querySelectorAll('.p2p-branch.p2p-highlighted-branch').forEach(function(be) {
      var tid = be.getAttribute('data-target'); if (tid && nodeIds.indexOf(tid) === -1) nodeIds.push(tid);
    });
  } else {
    if (sourceId) nodeIds.push(sourceId);
    if (targetId) nodeIds.push(targetId);
  }

  if (!ctrlKey) {
    highlightedNodeIds = nodeIds;
  } else {
    nodeIds.forEach(function(nid) { if (highlightedNodeIds.indexOf(nid) === -1) highlightedNodeIds.push(nid); });
  }

  applyNodeHighlights();
  updateAllSentences();
  scrollToFirstHighlight();
}

function handleGroupClick(groupId, ctrlKey) {
  var groupEl = svgEl.querySelector('[data-cell-id="' + groupId + '"]') ||
               svgEl.querySelector('[data-id="' + groupId + '"]');
  if (!groupEl) return;

  var group = GROUPS.find(function(g) { return g.id === groupId; });
  if (!group) return;

  if (!ctrlKey) {
    clearAllHighlights();
    highlightedComboIds = [groupId];
    // Also highlight member nodes on canvas
    if (group.memberNodeIds) {
      highlightedNodeIds = group.memberNodeIds.slice();
    }
  } else {
    var comboIdx = highlightedComboIds.indexOf(groupId);
    if (comboIdx >= 0) {
      highlightedComboIds.splice(comboIdx, 1);
      // Remove member nodes that belong only to this combo
      if (group.memberNodeIds) {
        highlightedNodeIds = highlightedNodeIds.filter(function(nid) {
          return group.memberNodeIds.indexOf(nid) === -1;
        });
      }
    } else {
      highlightedComboIds.push(groupId);
      // Add member nodes
      if (group.memberNodeIds) {
        group.memberNodeIds.forEach(function(nid) {
          if (highlightedNodeIds.indexOf(nid) === -1) highlightedNodeIds.push(nid);
        });
      }
    }
  }

  applyNodeHighlights();
  updateAllSentences();
  scrollToFirstHighlight();
}

function applyNodeHighlights() {
  if (!svgEl) return;
  svgEl.querySelectorAll('.p2p-node.p2p-highlighted').forEach(function(el) { el.classList.remove('p2p-highlighted'); });
  svgEl.querySelectorAll('.p2p-group.p2p-highlighted').forEach(function(el) { el.classList.remove('p2p-highlighted'); });
  svgEl.querySelectorAll('.p2p-attr-tag.p2p-highlighted').forEach(function(el) { el.classList.remove('p2p-highlighted'); });
  highlightedNodeIds.forEach(function(id) {
    var el = svgEl.querySelector('[data-cell-id="' + id + '"]') ||
             svgEl.querySelector('[data-id="' + id + '"]');
    if (el) el.classList.add('p2p-highlighted');
  });
  updateLegend();
}

// ============================================================
// 文本高亮
// ============================================================
function renderSentences() {
  sidebarBody.innerHTML = '';
  SENTENCES.forEach(function(sent) {
    var block = document.createElement('div');
    block.className = 'sentence-block';
    block.dataset.sentenceId = sent.id;
    var origDiv = document.createElement('div');
    origDiv.className = 'sentence-original';
    origDiv.id = 'orig-' + sent.id;
    var transDiv = document.createElement('div');
    transDiv.className = 'sentence-translation';
    transDiv.id = 'trans-' + sent.id;
    block.appendChild(origDiv);
    block.appendChild(transDiv);
    sidebarBody.appendChild(block);
    updateSentenceHighlight(sent.id);
  });
}

function escapeHtml(text) { var div = document.createElement('div'); div.textContent = text; return div.innerHTML; }

function highlightTextInSentence(text, mode) {
  var html = escapeHtml(text);
  var nodeTexts = [];
  highlightedNodeIds.forEach(function(nodeId, idx) {
    var node = NODES.find(function(n) { return n.id === nodeId; });
    if (!node) return;
    var t = mode === 'translation' ? (node.chineseText || node.originalText) : (node.originalText || node.chineseText);
    if (t && (t.length >= 2 || /[\\u4e00-\\u9fff\\u3400-\\u4dbf]/.test(t))) {
      nodeTexts.push({text: t, nodeId: nodeId, color: HIGHLIGHT_PALETTE[idx % HIGHLIGHT_PALETTE.length]});
    }
  });
  // Add combo label texts
  var comboBaseIdx = highlightedNodeIds.length;
  highlightedComboIds.forEach(function(comboId, idx) {
    var group = GROUPS.find(function(g) { return g.id === comboId; });
    if (!group) return;
    var t = mode === 'translation' ? (group.chineseText || group.originalText) : (group.originalText || group.chineseText);
    if (t && (t.length >= 2 || /[\\u4e00-\\u9fff\\u3400-\\u4dbf]/.test(t))) {
      nodeTexts.push({text: t, nodeId: comboId, color: HIGHLIGHT_PALETTE[(comboBaseIdx + idx) % HIGHLIGHT_PALETTE.length]});
    }
  });
  nodeTexts.sort(function(a, b) { return b.text.length - a.text.length; });
  nodeTexts.forEach(function(item) {
    var escapedText = escapeHtml(item.text);
    var regex = new RegExp(escapedText.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'), 'gi');
    var found = false;
    html = html.replace(regex, function(match) {
      if (!found) { found = true; return '<mark class="text-highlight" data-node-id="' + item.nodeId + '" style="background-color:' + item.color.bg + ';color:' + item.color.border + '" onclick="textNodeClick(\\'' + item.nodeId + '\\')">' + match + '</mark>'; }
      return match;
    });
  });
  return html;
}

function updateSentenceHighlight(sentId) {
  var sent = SENTENCES.find(function(s) { return s.id === sentId; });
  if (!sent) return;
  var origEl = document.getElementById('orig-' + sentId);
  var transEl = document.getElementById('trans-' + sentId);
  if (!origEl) return;
  origEl.innerHTML = highlightTextInSentence(sent.text, 'original');
  if (sent.translation) { transEl.innerHTML = highlightTextInSentence(sent.translation, 'translation'); }
  else { transEl.innerHTML = ''; }
}

function updateAllSentences() { SENTENCES.forEach(function(sent) { updateSentenceHighlight(sent.id); }); }

function updateLegend() {
  legendBar.innerHTML = '';
  highlightedNodeIds.forEach(function(nodeId, idx) {
    var node = NODES.find(function(n) { return n.id === nodeId; });
    if (!node) return;
    var color = HIGHLIGHT_PALETTE[idx % HIGHLIGHT_PALETTE.length];
    var item = document.createElement('div');
    item.className = 'legend-item';
    item.style.background = color.bg;
    item.style.border = '1px solid ' + color.border;
    item.innerHTML = '<span class="dot" style="background:' + color.border + '"></span><span>' + escapeHtml(node.chineseText || node.originalText) + '</span>';
    item.onclick = function() { handleNodeClick(nodeId, true); };
    legendBar.appendChild(item);
  });
  var comboBaseIdx = highlightedNodeIds.length;
  highlightedComboIds.forEach(function(comboId, idx) {
    var group = GROUPS.find(function(g) { return g.id === comboId; });
    if (!group) return;
    var color = HIGHLIGHT_PALETTE[(comboBaseIdx + idx) % HIGHLIGHT_PALETTE.length];
    var item = document.createElement('div');
    item.className = 'legend-item';
    item.style.background = color.bg;
    item.style.border = '1px solid ' + color.border;
    item.innerHTML = '<span class="dot" style="background:' + color.border + '"></span><span>' + escapeHtml(group.chineseText || group.originalText) + '</span>';
    item.onclick = function() { handleGroupClick(comboId, true); };
    legendBar.appendChild(item);
  });
}

function scrollToFirstHighlight() {
  if (highlightedNodeIds.length > 0 || highlightedComboIds.length > 0) {
    var blocks = sidebarBody.querySelectorAll('.sentence-block');
    for (var i = 0; i < blocks.length; i++) {
      var origEl = blocks[i].querySelector('.sentence-original');
      if (origEl && origEl.innerHTML.indexOf('<mark') !== -1) {
        blocks[i].scrollIntoView({behavior: 'smooth', block: 'center'});
        break;
      }
    }
  }
}

function textNodeClick(nodeId) { handleNodeClick(nodeId, true); }

// ============================================================
// 点击事件处理
// ============================================================
if (svgEl) {
  svgEl.addEventListener('click', function(e) {
    var info = findCellInfo(e.target);
    if (!info) {
      // 点击空白区域清除高亮
      clearAllHighlights();
      updateAllSentences();
      return;
    }
    if (info.type === 'node') {
      handleNodeClick(info.cellId, e.ctrlKey || e.metaKey);
    } else if (info.type === 'group') {
      handleGroupClick(info.cellId, e.ctrlKey || e.metaKey);
    } else if (info.type === 'attr-tag') {
      // 属性标签：高亮其源节点
      var tagEl = info.el;
      var sourceId = tagEl.getAttribute('data-source');
      if (sourceId) handleNodeClick(sourceId, e.ctrlKey || e.metaKey);
    } else if (info.type === 'edge') {
      handleEdgeClick(info.cellId, e.ctrlKey || e.metaKey);
    }
  });
}

// ============================================================
// 缩放
// ============================================================
function zoomIn() { viewState.scale = Math.min(3, viewState.scale * 1.2); applyView(); }
function zoomOut() { viewState.scale = Math.max(0.1, viewState.scale / 1.2); applyView(); }
function resetView() { viewState = {x: 0, y: 0, scale: 1}; applyView(); }

// 初始化
renderSentences();
</script>
</body>
</html>`
}
