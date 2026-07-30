# web-app.js 拆分规则与指导手册

> 本文件供 AI Agent 执行代码拆分时遵循。必须严格按照本文档的规则操作，违反任何一条都可能导致功能失效。

---

## 一、核心铁律（不可违反）

### 铁律1：模块文件必须在 web-app.js 之后加载

**原因**：模块文件中存在顶层同步执行的代码（如 `if (patentDetailContent) { ... }`），引用了 web-app.js 中用 `const`/`let` 声明的全局变量。`const`/`let` 不会提升（TDZ），如果模块在 web-app.js 之前加载，会触发 `ReferenceError`。

**正确顺序**：
```html
<script src="scripts/web-ai.js"></script>
<script src="scripts/patent-status.js"></script>
<script src="scripts/web-app.js"></script>
<!-- 模块文件必须在主文件之后 -->
<script src="scripts/web-export.js"></script>
<script src="scripts/web-merge.js"></script>
<script src="scripts/web-extension.js"></script>
<script src="scripts/web-chat.js"></script>
<script src="scripts/web-pdf-viewer.js"></script>
<script src="scripts/web-translate.js"></script>
```

### 铁律2：function 声明会提升，let/const 不会

- `function foo() {}` — 声明会提升到作用域顶部，可在声明前调用
- `let bar = ...` / `const bar = ...` — 不会提升，声明前访问会触发 `ReferenceError`（TDZ）

**拆分时**：函数可以自由移动（提升保证可用），但 `let`/`const` 变量必须与其引用它的代码在同一个文件中，或确保引用方在变量声明之后加载。

### 铁律3：不移动任何全局变量声明

所有 `let`/`const` 全局变量声明必须留在 web-app.js。只移动 `function` 声明。

**例外**：如果某个 `let` 变量仅被某个模块内部使用（如 `_pdfCtxMenu` 仅被 PDF 查看器使用），可以连同模块一起移出，但必须确认无其他文件引用。

### 铁律4：不移动 DOMContentLoaded 事件绑定块

行6759-7259 的 `document.addEventListener("DOMContentLoaded", () => { ... })` 块必须完整留在 web-app.js。它引用了几乎所有函数和全局变量。

### 铁律5：不移动顶层同步执行代码

以下代码在脚本加载时同步执行（不在函数内），必须留在原文件：

| 行范围 | 代码内容 | 引用的全局变量 |
|--------|---------|--------------|
| 341-398 | patentInput/searchBtn 事件绑定 | patentInput, searchBtn, officeBadge, searchMode, kanbanState, currentData |
| 5563-5585 | patentDetailContent 右键菜单事件绑定 | patentDetailContent, _patentDetailCtxMenu |
| 5569-5572 | _pdfCtxMenu 相关全局事件监听 | _pdfCtxMenu |
| 7916-7976 | historySidebar/cacheClearBtn/gpProxy 事件绑定 + refreshHistoryList() | 多个 const DOM 引用 |

### 铁律6：onclick 内联事件引用的函数必须是全局的

以下函数被动态生成的 HTML 中的 `onclick="..."` 引用，**必须保持在全局作用域**（不能放在 IIFE 或模块闭包内）：

| 函数名 | 声明行 | onclick 引用位置 |
|--------|--------|-----------------|
| `toggleGoogleTranslate` | 1056 | 行463 |
| `switchPatentTab` | 755 | 行484-487 |
| `switchPpvTab` | 763 | 行1293-1296 |
| `translatePatentSection` | 773 | 行633, 658, 1382, 1407 |
| `copyPatentSectionText` | 1025 | 行634, 659, 1383, 1408 |
| `switchPpvPatent` | 1617 | 行1277 |
| `closePpvPatentTab` | 1646 | 行1279 |
| `openPatentImageViewer` | 1118 | 行1347 |

---

## 二、全局变量清单（必须留在 web-app.js）

### 2.1 let 声明的全局变量（21个）

| 变量名 | 声明行 | 引用次数 | 是否可随模块移出 |
|--------|--------|---------|----------------|
| `currentData` | 14 | 94 | ❌ 否（全局核心） |
| `kanbanAutoAbortController` | 15 | 8 | ❌ 否 |
| `citedRefsAbortController` | 16 | 7 | ❌ 否 |
| `activeAnalysisProcess` | 19 | 8 | ❌ 否 |
| `searchMode` | 118 | 4 | ❌ 否 |
| `pdfViewState` | 188 | 155 | ❌ 否（全局核心） |
| `_pdfDocCache` | 209 | 5 | ❌ 否（被 renderPdfView 和 clearPrefetchCache 引用） |
| `chatHistory` | 211 | 6 | ❌ 否（被 DOMContentLoaded 引用） |
| `chatAbortController` | 212 | 4 | ❌ 否 |
| `analysisChatHistory` | 213 | 6 | ❌ 否（被 PatentCache.restoreState 引用） |
| `analysisChatAbortController` | 214 | 7 | ❌ 否 |
| `translateAbortController` | 215 | 4 | ✅ 可随翻译模块移出（仅翻译模块引用） |
| `translatePageCache` | 216 | 4 | ✅ 可随翻译模块移出 |
| `_patentDetailCtxMenu` | 915 | 5 | ❌ 否（被段落D和段落M引用） |
| `_googleTranslateInjected` | 1054 | 4 | ❌ 否（留在段落D） |
| `_prefetchCache` | 1198 | 5 | ❌ 否（被段落D和段落J引用） |
| `_patentPopupData` | 1249 | 4 | ❌ 否（留在段落D） |
| `_ppvOpenPatents` | 1250 | 11 | ❌ 否（留在段落D） |
| `_ppvActivePatent` | 1251 | 7 | ❌ 否（留在段落D） |
| `kanbanState` | 1788 | 146 | ❌ 否（全局核心） |
| `_pdfCtxMenu` | 5506 | 5 | ✅ 可随PDF查看器模块移出 |

### 2.2 const 声明的非 DOM 全局变量

| 变量名 | 声明行 | 引用次数 | 说明 |
|--------|--------|---------|------|
| `GD_API_BASE` | 1 | 1 | API 基础路径 |
| `OFFICE_NAMES` | 3 | 4 | 局名映射表 |
| `isTauri` | 95 | 8 | Tauri 环境检测 |
| `PatentCache` | 1797 | 24 | 缓存管理对象（含18个方法） |

### 2.3 const 声明的 DOM 引用变量（约75个）

分布在以下行范围：
- 行107-186：主搜索区、AI设置、阅读器、PDF视图的 DOM 引用
- 行3322-3424：AI设置表单内的 DOM 引用
- 行3903-3921：审查意见相关 DOM 引用
- 行7917-7945：历史侧边栏、网络设置 DOM 引用

**所有 DOM 引用变量必须留在 web-app.js。**

---

## 三、桥梁函数清单（必须留在 web-app.js）

以下函数被多个不同模块调用，是全局基础设施，**不可移出**：

| 函数名 | 声明行 | 被调用次数 | 说明 |
|--------|--------|-----------|------|
| `showError` | 218 | 26 | 错误提示，最高频 |
| `escapeHtml` | 2887 | 25 | XSS 防护 |
| `renderMarkdown` | 4547 | 8 | Markdown 渲染 |
| `renderMarkdownWithTrace` | 4559 | 3 | 带溯源的 Markdown 渲染 |
| `autoSaveCache` | 2196 | 7 | 自动保存缓存 |
| `refreshHistoryList` | 2220 | 9 | 刷新历史列表 |
| `doExtractText` | 3550 | 5 | OCR 提取核心 |
| `extractFamilyMembers` | 2872 | 4 | 提取同族成员 |
| `openReader` | 4830 | 4 | 打开阅读器 |
| `selectReaderDoc` | 4879 | 3 | 选择阅读器文档 |
| `onTraceClick` | 4638 | 1 | 溯源跳转（被事件委托调用） |
| `abortActiveProcess` | 20 | 4 | 中断分析进程 |
| `getManualSelectKey` | 43 | 2 | 手动选择键名 |
| `saveManualSelection` | 50 | 2 | 保存手动选择 |
| `loadManualSelection` | 60 | 2 | 加载手动选择 |
| `mapJpDocType` | 77 | 3 | JP 文档类型映射 |
| `gpApiUrl` | 129 | 4 | Google Patents API URL |
| `clearPrefetchCache` | 1224 | 2 | 清除预取缓存 |
| `prefetchPatentLinks` | 1200 | 2 | 预取专利链接 |
| `linkifyPatentNumbers` | 1155 | 1 | 专利号链接化（被 renderMarkdownWithTrace 调用） |
| `parseDate` | 4821 | 2 | 日期解析 |

---

## 四、可安全移出的段落

### 模块1：web-export.js（Word导出）

| 属性 | 值 |
|------|-----|
| 来源行范围 | 6345-6757 |
| 行数 | 412 |
| 风险等级 | ⭐ 极低 |
| 函数 | `exportToWord` |
| 全局变量 | 无（纯函数） |
| 依赖 | currentData, kanbanState, OFFICE_NAMES, showError, extractFamilyMembers, escapeHtml, renderMarkdown |
| 被调用位置 | DOMContentLoaded 行6954, 6958（exportWordBtn/readerExportBtn 的 click 事件） |

**注意事项**：
- 内部定义了多个局部函数（parseInlineMarkdown, parseMarkdownTable, processMarkdownLines），这些是 `exportToWord` 内部的嵌套函数，必须一起移出
- 依赖 `docx` 和 `saveAs` 全局库（通过 CDN 引入）

**移出检查清单**：
- [ ] 确认 `exportToWord` 函数完整移出（含所有内部嵌套函数）
- [ ] 确认 web-app.js 中不再有 `exportToWord` 的定义
- [ ] 确认 DOMContentLoaded 中 `exportWordBtn.addEventListener("click", exportToWord)` 仍能找到函数（function 声明提升）
- [ ] 确认模块文件在 web-app.js 之后加载

---

### 模块2：web-merge.js（看板手动提取与合并导出）

| 属性 | 值 |
|------|-----|
| 来源行范围 | 7539-7914 |
| 行数 | 375 |
| 风险等级 | ⭐ 极低 |
| 函数 | `kanbanManualExtract`, `buildMergeDownloadUrl`, `openMergeExportModal`, `updateMergeSelectedCount`, `doMergeExportWithItems`, `doMergeExport` |
| 全局变量 | 无（纯函数） |
| 依赖 | currentData, kanbanState, isTauri, doExtractText, autoSaveCache, mapJpDocType, extractFamilyMembers, showError, escapeHtml |
| 被调用位置 | DOMContentLoaded 行7245-7249（合并导出按钮事件）、行6804-6833（documentsContent click 委托中的 ai-analyze-doc）、buildReviewManualSelectPanel（行4336 调用 doMergeExportWithItems） |

**注意事项**：
- `doMergeExportWithItems` 被 `buildReviewManualSelectPanel`（留在主文件）调用，由于 function 声明提升，跨文件调用安全
- `kanbanManualExtract` 被 `renderDocuments` 生成的 HTML 中的 `data-action="kanban-extract"` 调用（通过 documentsContent 事件委托）

**移出检查清单**：
- [ ] 确认所有6个函数完整移出
- [ ] 确认 web-app.js 中不再有这些函数的定义
- [ ] 确认 `buildReviewManualSelectPanel` 中的 `doMergeExportWithItems(...)` 调用仍能找到函数
- [ ] 确认 DOMContentLoaded 中合并导出按钮事件绑定仍能找到函数

---

### 模块3：web-extension.js（浏览器插件对接）

| 属性 | 值 |
|------|-----|
| 来源行范围 | 6175-6341 |
| 行数 | 166 |
| 风险等级 | ⭐ 低 |
| 函数 | `handleExtensionData`, `handleExtensionAnalyze`, `showNotification`, `showDocumentContent` |
| 全局变量 | 无（纯函数） |
| 依赖 | currentData, kanbanState, AI.loadAIConfig, AI.getCurrentProvider, AI.getDefaultPrompt, AI.streamChat, marked.parse, showNotification（内部调用） |
| 被调用位置 | DOMContentLoaded 行6792, 6798（window message 事件监听器） |

**注意事项**：
- `handleExtensionData` 内部调用 `getKanbanColumnIndex` 和 `createKanbanCard`（这些是外部库函数，通过全局引入）
- `showNotification` 和 `showDocumentContent` 仅被 `handleExtensionData` 调用

**移出检查清单**：
- [ ] 确认所有4个函数完整移出
- [ ] 确认 DOMContentLoaded 中 message 事件监听器仍能找到 `handleExtensionData` 和 `handleExtensionAnalyze`

---

### 模块4：web-chat.js（AI对话）

| 属性 | 值 |
|------|-----|
| 来源行范围 | 7261-7537 |
| 行数 | 276 |
| 风险等级 | ⭐⭐ 低 |
| 函数 | `sendChatMessage`, `appendChatMessage`, `showAnalysisChatToggle`, `appendAnalysisChatMessage`, `sendAnalysisChatMessage` |
| 全局变量 | 无 |
| 顶层同步代码 | 行7503-7537 的 IIFE `initAnalysisChat()`（在顶层同步执行） |
| 依赖 | chatInput, chatSendBtn, chatMessages, chatHistory, chatAbortController, analysisChatHistory, analysisChatAbortController, pdfViewState, kanbanState, showError, renderMarkdown, AI.loadAIConfig, AI.getCurrentProvider, AI.streamChat |
| 被调用位置 | DOMContentLoaded 行7217, 7224（chatSendBtn/chatInput 事件）、PatentCache.restoreState（行2516 调用 showAnalysisChatToggle）、buildReviewManualSelectPanel（行4509 调用 showAnalysisChatToggle） |

**注意事项**：
- `initAnalysisChat` IIFE 在顶层同步执行，内部通过 `document.getElementById` 获取 DOM 元素并绑定事件
- 由于模块在 web-app.js 之后加载，DOMContentLoaded 可能已触发（如果 web-app.js 的 DOMContentLoaded 回调执行很快），但 IIFE 中的 `document.getElementById` 仍能找到元素（因为 HTML 已解析完毕）
- `showAnalysisChatToggle` 被 `PatentCache.restoreState` 和 `buildReviewManualSelectPanel` 调用，必须确保函数已定义（function 声明提升保证）

**移出检查清单**：
- [ ] 确认所有5个函数完整移出
- [ ] 确认 IIFE `initAnalysisChat()` 完整移出
- [ ] 确认 `showAnalysisChatToggle` 在主文件中的调用方（restoreState, buildReviewManualSelectPanel）仍能找到函数
- [ ] 确认 DOMContentLoaded 中 chatSendBtn/chatInput 事件绑定仍能找到 `sendChatMessage`

---

### 模块5：web-pdf-viewer.js（PDF查看器）

| 属性 | 值 |
|------|-----|
| 来源行范围 | 4976-5591 |
| 行数 | 615 |
| 风险等级 | ⭐⭐⭐ 中 |
| 函数 | `togglePdfView`, `showOcrProgressOverlay`, `hideOcrProgressOverlay`, `renderPdfView`, `renderAllPdfPages`, `rerenderPdfPages`, `updatePdfToolbar`, `pdfGoToPage`, `pdfZoomInAction`, `pdfZoomOutAction`, `pdfZoomFitAction`, `highlightPdfBlock`, `clearPdfBlockSelection`, `refreshPdfBlockSelectionVisual`, `refreshPdfBoxSelectionVisual`, `selectBlocksInRect`, `updatePdfSelectionInfo`, `showPdfBlockContextMenu`, `hidePdfBlockContextMenu`, `searchPdfKeyword`, `searchPdfNext`, `searchPdfPrev`, `updateSearchInfo` |
| 全局变量 | `_pdfCtxMenu`（let, 行5506）— 可随模块移出 |
| 顶层同步代码 | 行5563-5585（patentDetailContent 右键菜单事件绑定）、行5569-5572（_pdfCtxMenu 全局事件监听） |
| 依赖 | pdfViewState, kanbanState, currentData, readerPdfContainer, readerPdfView, readerContent, readerPdfToggle, pdfPageInfo, pdfZoomLevel, _pdfDocCache, patentDetailContent, _patentDetailCtxMenu, showError, escapeHtml, ocrPdf, translateSelectedBlocks, updateExtractPanel, renderMarkdown, AI.loadAIConfig, AI.getOCRConfig |
| 被调用位置 | DOMContentLoaded（多处事件绑定）、onTraceClick（行4660-4703）、openReader（行4849）、selectReaderDoc（行4902）、openReaderForDoc（行6167） |

**注意事项**：
- **行5563-5585 是顶层同步代码**，引用 `patentDetailContent`（const, 行113）和 `_patentDetailCtxMenu`（let, 行915）。由于模块在 web-app.js 之后加载，这些变量已声明，不会触发 TDZ
- `_patentDetailCtxMenu` 留在 web-app.js（行915），模块中的代码通过闭包/全局引用访问它（回调是异步的，安全）
- `_pdfCtxMenu` 可随模块移出，但需确认主文件中无其他引用（已确认：仅行5506声明，行5537/5548/5549/5551/5555引用，全部在此模块内）
- `showPdfBlockContextMenu` 和 `hidePdfBlockContextMenu` 引用 `translateSelectedBlocks`（在 web-translate.js 中），需确保 web-translate.js 在 web-pdf-viewer.js 之前加载，或依赖 function 声明提升（安全）

**移出检查清单**：
- [ ] 确认所有23个函数完整移出
- [ ] 确认 `_pdfCtxMenu` 变量声明随模块移出
- [ ] 确认行5563-5585 的顶层同步代码随模块移出
- [ ] 确认行5569-5572 的全局事件监听随模块移出
- [ ] 确认 `_patentDetailCtxMenu` 留在 web-app.js（行915）
- [ ] 确认 `patentDetailContent` 留在 web-app.js（行113）
- [ ] 确认 DOMContentLoaded 中所有 PDF 相关事件绑定仍能找到函数
- [ ] 确认 `onTraceClick` 中的 `togglePdfView`、`highlightPdfBlock` 调用仍能找到函数
- [ ] 确认 `openReader` 中的 `togglePdfView` 调用仍能找到函数
- [ ] 确认 `selectReaderDoc` 中的 `renderPdfView` 调用仍能找到函数

---

### 模块6：web-translate.js（OCR/翻译/阅读模式）

| 属性 | 值 |
|------|-----|
| 来源行范围 | 5593-6172 |
| 行数 | 579 |
| 风险等级 | ⭐⭐ 低 |
| 函数 | `ocrPdf`, `_buildBlockText`, `_doTranslateBlocks`, `translatePdfPage`, `translateSelectedBlocks`, `renderTranslateContent`, `enterReadingMode`, `exitReadingMode`, `switchRightPanelTab`, `updateExtractPanel`, `openReaderForDoc` |
| 全局变量 | `translateAbortController`（let, 行215）、`translatePageCache`（let, 行216）— 可随模块移出 |
| 顶层同步代码 | 无 |
| 依赖 | pdfViewState, kanbanState, currentData, readerPdfContainer, readerFloatingBall, readerChatToggle, pdfTranslateBtn, pdfTranslatePanel, pdfTranslateContent, pdfTranslateLang, showError, escapeHtml, renderMarkdown, doExtractText, autoSaveCache, renderPdfView, ocrPdf（内部调用）, enterReadingMode（内部调用）, AI.loadAIConfig, AI.getTranslateProvider, AI.getOCRConfig, AI.getGlmOcrApiKey, AI.streamChat |
| 被调用位置 | DOMContentLoaded（多处事件绑定）、renderPdfView（行5188 自动OCR调用 ocrPdf）、selectReaderDoc（行4903 调用 updateExtractPanel）、onTraceClick（行4696 调用 selectReaderDoc）、openReaderForDoc（行6167 调用 selectReaderDoc/togglePdfView） |

**注意事项**：
- `translateAbortController` 和 `translatePageCache` 仅被此模块内部引用，可安全移出
- `ocrPdf` 被 `renderPdfView`（在 web-pdf-viewer.js 中）调用 → 需确保 web-translate.js 在 web-pdf-viewer.js 之前加载（或依赖 function 声明提升，安全）
- `enterReadingMode`/`exitReadingMode` 被 DOMContentLoaded 中的事件绑定调用
- `openReaderForDoc` 被 DOMContentLoaded 中的 kanbanBoard click 事件调用
- `updateExtractPanel` 被 `selectReaderDoc`（在主文件中）和 `switchRightPanelTab`（在此模块中）调用

**移出检查清单**：
- [ ] 确认所有11个函数完整移出
- [ ] 确认 `translateAbortController` 和 `translatePageCache` 变量声明随模块移出
- [ ] 确认 web-app.js 中不再有这些变量声明
- [ ] 确认 DOMContentLoaded 中所有翻译/阅读模式相关事件绑定仍能找到函数
- [ ] 确认 `renderPdfView`（在 web-pdf-viewer.js 中）中的 `ocrPdf()` 调用仍能找到函数
- [ ] 确认 `selectReaderDoc`（在主文件中）中的 `updateExtractPanel()` 调用仍能找到函数
- [ ] 确认 `onTraceClick`（在主文件中）中的 `selectReaderDoc()` 调用仍能找到函数

---

## 五、必须留在 web-app.js 的段落

| 段落 | 行范围 | 行数 | 说明 |
|------|--------|------|------|
| 全局常量与状态变量 | 1-216 | 216 | 所有全局变量声明 |
| 错误提示与专利号解析 | 218-339 | 121 | showError, detectOffice, parsePatentNumber, gdFetch（桥梁函数） |
| 搜索输入事件绑定 | 341-398 | 57 | 顶层同步代码 |
| 专利详情查询与渲染 | 400-1683 | 1283 | renderPatentDetail 等核心渲染函数 |
| 主搜索流程 | 1684-1786 | 102 | doSearch |
| kanbanState 与 PatentCache | 1788-2120 | 332 | 核心状态管理 |
| 缓存/历史对话框 | 2122-2460 | 338 | autoSaveCache, refreshHistoryList（桥梁函数） |
| 看板与概览渲染 | 2461-3241 | 780 | renderKanban, escapeHtml, extractFamilyMembers（桥梁函数） |
| 文档提取与AI设置 | 3015-3548 | 533 | doExtractText（桥梁函数）, AI设置表单 |
| AI分析 | 3550-4546 | 996 | buildReviewManualSelectPanel 等 |
| Markdown渲染与溯源 | 4547-4733 | 186 | renderMarkdown, onTraceClick（桥梁函数） |
| 时间线与阅读器 | 4735-4974 | 239 | openReader, selectReaderDoc（桥梁函数） |
| DOMContentLoaded | 6759-7259 | 500 | 事件绑定块 |
| 尾部顶层代码 | 7916-7976 | 60 | 顶层同步代码 |

---

## 六、变量遮蔽注意事项

以下全局变量在函数内部被同名的局部变量遮蔽，拆分时需注意不要破坏遮蔽关系：

| 全局变量 | 全局声明行 | 局部声明行 | 局部变量所在函数 | 说明 |
|---------|-----------|-----------|----------------|------|
| `loading` | 114 | 1519 | openPatentPopup | 局部变量指向不同 DOM 元素（ppv-loading） |
| `searchBtn` | 108 | 4910, 5806 | renderPdfView, ocrPdf | 局部变量指向 pdf-search-btn |
| `resultSection` | 111 | 3128 | aiAnalyzeDocument | 局部变量指向相同 DOM 元素 |
| `readerContent` | 162 | 6288, 6336 | handleExtensionData, showDocumentContent | 局部变量指向相同 DOM 元素 |
| `citedRefsAbortBtn` | 3903 | 3714, 3896 | runCitedRefsAnalysis | 局部变量指向相同 DOM 元素 |
| `manualSelectBtn` | 3913 | 1763 | doSearch | 局部变量指向相同 DOM 元素 |
| `citedRefsManualBtn` | 3921 | 1761, 3706 | doSearch, runCitedRefsAnalysis | 局部变量指向相同 DOM 元素 |

**规则**：拆分时不要移动局部变量声明，保持函数内部代码不变。

---

## 七、执行拆分的操作流程

### 步骤1：选择要移出的模块

从第四节中选择一个或多个模块。建议按风险等级从低到高依次执行：
1. web-export.js（⭐ 极低）
2. web-merge.js（⭐ 极低）
3. web-extension.js（⭐ 低）
4. web-chat.js（⭐⭐ 低）
5. web-translate.js（⭐⭐ 低）
6. web-pdf-viewer.js（⭐⭐⭐ 中）

### 步骤2：创建新模块文件

将源行范围的代码**原样复制**到新文件中。不修改任何字符。

**禁止的操作**：
- ❌ 重命名函数
- ❌ 修改函数参数
- ❌ 添加 import/export
- ❌ 包装在 IIFE 中
- ❌ 修改缩进
- ❌ 添加注释（除非在文件顶部添加模块说明）

### 步骤3：从 web-app.js 删除已移出的代码

使用 Edit 工具，将已移出的代码块替换为空（或替换为衔接注释）。

**注意**：删除时确保不破坏前后代码的衔接。删除函数时，保留前一个函数的结束 `}` 和后一个函数的声明之间的空行。

### 步骤4：更新 HTML 文件

在 `web.html` 和 `index.html` 中添加新的 `<script>` 标签。

**加载顺序**（严格遵守）：
```html
<!-- 第三方库 -->
<script src="...pdf.js"></script>
<script src="...marked.js"></script>
<script src="...docx.js"></script>
<script src="...FileSaver.js"></script>

<!-- 项目脚本 -->
<script src="scripts/web-ai.js"></script>
<script src="scripts/patent-status.js"></script>
<script src="scripts/web-app.js"></script>
<!-- 模块文件在主文件之后 -->
<script src="scripts/web-export.js"></script>
<script src="scripts/web-merge.js"></script>
<script src="scripts/web-extension.js"></script>
<script src="scripts/web-chat.js"></script>
<script src="scripts/web-translate.js"></script>
<script src="scripts/web-pdf-viewer.js"></script>
```

### 步骤5：验证

执行以下验证：

1. **语法检查**：对每个 JS 文件运行 `node --check`
2. **HTTP 可达性**：启动服务器，确认所有 JS 文件返回 200
3. **函数完整性**：用 Grep 确认每个移出的函数在新文件中有定义，在 web-app.js 中无定义
4. **全局变量完整性**：用 Grep 确认 `let`/`const` 全局变量仍在 web-app.js 中
5. **调用完整性**：用 Grep 确认 web-app.js 中对移出函数的调用仍然存在

### 步骤6：功能测试

在浏览器中测试以下功能：
- 专利搜索（dossier 模式 + patent 模式）
- 专利详情查看（Tab 切换、翻译、右键菜单）
- 阅读器打开/关闭
- PDF 查看（渲染、缩放、选块、搜索）
- OCR 提取
- 翻译（全文档 + 选中文本块）
- AI 对话（阅读器对话 + 分析报告对话）
- Word 导出
- 合并导出
- 缓存/历史记录
- 浏览器插件数据接收

---

## 八、错误排查指南

如果拆分后出现功能失效，按以下顺序排查：

### 错误1：ReferenceError: XXX is not defined

**原因**：引用了未声明的变量/函数。

**排查**：
1. 确认 XXX 是 `let`/`const` 变量 → 检查是否留在 web-app.js 中
2. 确认 XXX 是 `function` → 检查模块文件是否在 web-app.js 之后加载
3. 确认模块文件是否在 HTML 中正确引用

### 错误2：TypeError: XXX is not a function

**原因**：调用了未定义的函数。

**排查**：
1. 用 Grep 搜索函数定义位置
2. 确认函数在某个已加载的 JS 文件中定义
3. 确认定义该函数的文件在调用之前加载（function 声明提升可跨文件）

### 错误3：onclick 事件无效

**原因**：被 onclick 引用的函数不在全局作用域。

**排查**：
1. 检查函数是否被包装在 IIFE 或模块闭包中
2. 确认函数是 `function` 声明（不是 `const foo = () => {}`）

### 错误4：事件绑定失效

**原因**：DOMContentLoaded 中的事件绑定引用了未加载的函数。

**排查**：
1. 确认所有模块文件在 DOMContentLoaded 触发前加载完成
2. 确认模块文件在 web-app.js 之后加载（或确保 function 声明提升）

---

## 九、预期拆分结果

| 文件 | 行数 | 内容 |
|------|------|------|
| web-app.js | ~5553 | 主逻辑（全局变量、桥梁函数、核心流程、事件绑定） |
| web-pdf-viewer.js | ~615 | PDF查看器 |
| web-translate.js | ~579 | OCR/翻译/阅读模式 |
| web-export.js | ~412 | Word导出 |
| web-merge.js | ~375 | 合并导出 |
| web-chat.js | ~276 | AI对话 |
| web-extension.js | ~166 | 浏览器插件对接 |

**总计移出**：约2423行（30%）
**web-app.js 减少**：从7976行降至约5553行
