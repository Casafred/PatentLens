# web-app.js 完整拆解执行计划

> **已被新计划取代（2026-07-31）：** 本文基于 15,709 行旧版本，当前 `web-app.js` 已增长到 22,429 行，并已明确采用 Electron-only 架构。请勿按本文静态行号、Tauri 步骤或旧模块顺序直接实施。当前计划见 [`web-app-refactor-plan-2026-07-31.md`](web-app-refactor-plan-2026-07-31.md)。

> 基于 `src/scripts/web-app.js`（15,709行 / 296个函数 / 177个顶层变量）最新代码分析  
> 生成日期：2026-07-12

---

## 目录

- [一、核心原则与策略](#一核心原则与策略)
- [二、模块全景图](#二模块全景图)
- [三、分阶段执行计划](#三分阶段执行计划)
  - [Phase 0：基础设施搭建](#phase-0基础设施搭建)
  - [Phase 1：提取无依赖的叶子模块](#phase-1提取无依赖的叶子模块)
  - [Phase 2：提取独立功能模块](#phase-2提取独立功能模块)
  - [Phase 3：提取渲染引擎模块](#phase-3提取渲染引擎模块)
  - [Phase 4：提取AI与文档分析模块](#phase-4提取ai与文档分析模块)
  - [Phase 5：提取PDF相关模块](#phase-5提取pdf相关模块)
  - [Phase 6：提取交互层模块](#phase-6提取交互层模块)
  - [Phase 7：提取初始化与收尾](#phase-7提取初始化与收尾)
- [四、每步通用操作流程](#四每步通用操作流程)
- [五、完整验收清单](#五完整验收清单)
- [六、回滚策略](#六回滚策略)
- [七、模块函数归属总表](#七模块函数归属总表)

---

## 一、核心原则与策略

### 1.1 绞杀者模式（Strangler Fig Pattern）

```
拆解前：                         拆解中（逐步）：               拆解后：
┌───────────────┐               ┌───────────────┐             ┌──────────┐
│               │               │ web-app.js    │             │ module-a │
│  web-app.js   │  ────────→    │  (逐渐缩小)   │  ────────→  │ module-b │
│  (15,709行)   │               │ + module-a.js │             │ ...      │
│               │               │ + module-b.js │             │ app-init │
└───────────────┘               └───────────────┘             └──────────┘
```

- **不一次性重写**，而是从 web-app.js 中**剪切**代码到新模块文件
- 每步只迁移一个模块，web-app.js 逐步缩小
- 最终 web-app.js 变为空壳或彻底删除

### 1.2 新代码不添加到原文件

- 所有新增代码（IIFE包裹、window暴露语句）写在新模块文件中
- web-app.js 只做**删减**，不做**新增**
- 唯一例外：极少数情况下需要在 web-app.js 中将 `function foo()` 改为 `window.foo = function()`，此时只改声明方式不增代码量

### 1.3 每步可回滚

- 每步一个 git commit，commit message 格式：`refactor: extract module-X from web-app.js (Step N)`
- 回滚方式：`git revert <commit>` 或 `git checkout <prev-commit> -- src/`
- 任何一步出问题，不影响之前已完成的步骤

### 1.4 暴露策略

所有新模块采用统一模式：

```javascript
// module-example.js
(function () {
  "use strict";

  // ===== 模块私有变量 =====
  let privateVar = null;

  // ===== 模块私有函数 =====
  function privateFunc() { ... }

  // ===== 对外暴露的函数 =====
  window.funcName = function funcName() { ... };

  // ===== 对外暴露的变量 =====
  window.moduleVar = privateVar;  // 仅对需要跨模块共享的变量
})();
```

- 函数通过 `window.funcName = function funcName() {}` 暴露
- 保留函数名便于调试（DevTools 中显示为 `funcName` 而非 `anonymous`）
- 仅被本模块使用的函数不暴露，保持私有

### 1.5 script加载顺序

在 `web.html` 的 `<body>` 末尾，按依赖顺序排列：

```html
<!-- 第三方库（不变） -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script src="scripts/marked.min.js?v=20260623c"></script>
<!-- ...其他第三方库... -->

<!-- ===== 拆解后的业务模块（按依赖顺序）===== -->
<script src="scripts/modules/constants.js?v=260712"></script>
<script src="scripts/modules/core-utils.js?v=260712"></script>
<script src="scripts/modules/state.js?v=260712"></script>
<script src="scripts/modules/patent-links.js?v=260712"></script>
<!-- ...其他模块... -->
<script src="scripts/modules/app-init.js?v=260712"></script>

<!-- 主文件（逐渐缩小，最终删除） -->
<script src="scripts/web-app.js?v=260712"></script>

<!-- Agent子系统（不变） -->
<script src="scripts/agent/event-bus.js?v=260716"></script>
<!-- ... -->
```

- 新模块放在 `scripts/modules/` 目录下
- 所有模块在 web-app.js 之前加载
- 版本号统一为 `260712`（当前迭代日期）

---

## 二、模块全景图

### 2.1 模块清单（28个模块 + 最终收尾）

| 模块文件 | 行数(约) | 函数数 | Phase | 依赖模块 |
|----------|---------|--------|-------|----------|
| `constants.js` | 60 | 1 | 1 | 无 |
| `core-utils.js` | 200 | 12 | 1 | constants |
| `state.js` | 120 | 0 | 1 | 无 |
| `patent-links.js` | 150 | 13 | 2 | core-utils |
| `patent-parser.js` | 90 | 2 | 2 | patent-links |
| `patent-office.js` | 100 | 3 | 2 | patent-links |
| `dossier-tabs.js` | 450 | 16 | 2 | state, core-utils |
| `search.js` | 650 | 3 | 3 | patent-parser, gdFetch |
| `cache-history.js` | 450 | 11 | 3 | state, core-utils, dossier-tabs |
| `render-engine.js` | 520 | 8 | 3 | state, core-utils |
| `patent-detail.js` | 450 | 10 | 3 | render-engine, core-utils |
| `patent-popup.js` | 540 | 8 | 3 | patent-detail, core-utils |
| `translation.js` | 540 | 10 | 3 | core-utils |
| `ai-settings.js` | 410 | 7 | 4 | core-utils, state |
| `patent-ask.js` | 500 | 14 | 4 | ai-settings, patent-detail |
| `ai-analysis.js` | 900 | 12 | 4 | ai-settings, render-engine, patent-detail |
| `documents.js` | 350 | 5 | 4 | render-engine, ai-analysis |
| `chat.js` | 570 | 6 | 4 | ai-settings, core-utils |
| `reader.js` | 1000 | 12 | 5 | documents, core-utils |
| `pdf-toc.js` | 200 | 5 | 5 | reader |
| `pdf-annotations.js` | 1300 | 35 | 5 | reader, core-utils |
| `pdf-search-ocr.js` | 490 | 8 | 5 | reader, pdf-annotations |
| `extract-panel.js` | 440 | 8 | 5 | reader, pdf-annotations |
| `export.js` | 840 | 3 | 5 | core-utils, documents |
| `merge-export.js` | 470 | 5 | 6 | cache-history, export |
| `ops-settings.js` | 220 | 3 | 6 | ai-settings |
| `batch-search.js` | 340 | 7 | 6 | ops-settings, patent-detail |
| `pd-tabs-find.js` | 430 | 12 | 6 | core-utils |
| `extract-mode.js` | 1160 | 26 | 6 | reader, pdf-annotations |
| `app-init.js` | 810 | 0 | 7 | 所有模块 |
| **合计** | **~13,200** | **~277** | | |

> 注：行数为近似值，含IIFE包裹和window暴露语句的额外行数。剩余约2500行为顶层事件绑定和初始化代码，归入各模块或 app-init.js。

### 2.2 依赖关系图（简化）

```
constants ──→ core-utils ──→ state
                 │              │
                 ├──→ patent-links ──→ patent-parser
                 │         │
                 │         ├──→ patent-office
                 │
                 ├──→ dossier-tabs ←── state
                 │
                 ├──→ search ←── patent-parser, patent-links
                 │
                 ├──→ cache-history ←── dossier-tabs
                 │
                 ├──→ render-engine ←── state
                 │         │
                 │         ├──→ patent-detail
                 │         │         │
                 │         │         ├──→ patent-popup
                 │         │         ├──→ patent-ask
                 │         │         └──→ ai-analysis
                 │         │
                 │         └──→ documents ←── ai-analysis
                 │
                 ├──→ translation
                 ├──→ ai-settings ──→ chat
                 │
                 ├──→ reader ←── documents
                 │         │
                 │         ├──→ pdf-toc
                 │         ├──→ pdf-annotations
                 │         │         ├──→ pdf-search-ocr
                 │         │         └──→ extract-panel
                 │         └──→ extract-mode
                 │
                 ├──→ export ←── documents
                 │
                 ├──→ merge-export ←── cache-history, export
                 ├──→ ops-settings ←── ai-settings
                 ├──→ batch-search ←── ops-settings
                 └──→ pd-tabs-find

app-init ←── 所有模块（最后提取）
```

---

## 三、分阶段执行计划

### Phase 0：基础设施搭建

#### Step 0.1：创建模块目录和加载入口

**操作**：
1. 创建目录 `src/scripts/modules/`
2. 在 `web.html` 的 `<body>` 末尾（web-app.js 之前）添加一个注释占位符：
   ```html
   <!-- ===== 拆解模块（逐步添加）===== -->
   <!-- 模块script标签将在此处逐步添加 -->
   ```
3. 更新 web-app.js 版本号为 `?v=260712`

**验收标准**：
- [ ] 页面功能完全不变（此时还没有任何模块被提取）
- [ ] `src/scripts/modules/` 目录存在
- [ ] web.html 中有模块加载占位注释

**Commit**: `refactor: create modules directory and placeholder (Step 0.1)`

---

### Phase 1：提取无依赖的叶子模块

此阶段提取的模块不依赖任何其他业务模块，只依赖浏览器API和第三方库。

---

#### Step 1.1：提取 `constants.js`

**迁移内容**：

| 行号范围 | 内容 | 暴露方式 |
|----------|------|----------|
| L36 | `__PATENTLENS_COPYRIGHT__` | `window.__PATENTLENS_COPYRIGHT__` |
| L37-L60 | `SVG_ICONS` | `window.SVG_ICONS` |
| L70 | `GD_API_BASE` | `window.GD_API_BASE` |
| L72-L81 | `OFFICE_NAMES` | `window.OFFICE_NAMES` |
| L62-L88 | `icon()` 函数 | `window.icon` |
| L164 | `isTauri` 检测 | `window.isTauri` |

**新文件**：`src/scripts/modules/constants.js`

**web.html 变更**：
```html
<script src="scripts/modules/constants.js?v=260712"></script>
```

**web-app.js 变更**：删除上述代码（约60行）

**验收标准**：
- [ ] 页面加载无控制台错误
- [ ] 所有SVG图标正常显示（`icon()` 函数工作）
- [ ] 版权信息正常显示
- [ ] Tauri环境检测正常（桌面端如有）

**验证方法**：
1. 打开页面，检查控制台无 `ReferenceError`
2. 搜索一个专利号，确认搜索按钮的SVG图标显示
3. 检查页面底部版权信息

**Commit**: `refactor: extract constants.js from web-app.js (Step 1.1)`

---

#### Step 1.2：提取 `core-utils.js`

**迁移内容**：

| 行号 | 函数/变量 | 暴露方式 |
|------|----------|----------|
| L89-L111 | `abortActiveProcess()` | `window.abortActiveProcess` |
| L876-L881 | `showError(msg)` | `window.showError` |
| L882-L895 | `showToast(msg, duration)` | `window.showToast` |
| L1022-L1025 | `hideError()` | `window.hideError` |
| L2185-L2192 | `copyToClipboard(text)` | `window.copyToClipboard` |
| L2193-L2206 | `_fallbackCopy(text)` | `window._fallbackCopy` |
| L2461-L2477 | `copyTextToClipboard(text)` | `window.copyTextToClipboard` |
| L4019-L4036 | `timeAgo(timestamp)` | `window.timeAgo` |
| L4986-L4991 | `escapeHtml(str)` | `window.escapeHtml` |
| L8025-L8033 | `parseDate(str)` | `window.parseDate` |
| L4529-L4561 | `parseDocDateToTimestamp(dateStr)` | `window.parseDocDateToTimestamp` |
| L112-L118 | `getManualSelectKey(prefix, office, appNum)` | `window.getManualSelectKey` |
| L119-L128 | `saveManualSelection(...)` | `window.saveManualSelection` |
| L129-L145 | `loadManualSelection(...)` | `window.loadManualSelection` |
| L187 | `errorToast` (const) | `window.errorToast` |

**新文件**：`src/scripts/modules/core-utils.js`

**依赖**：`constants.js`（需要 `icon()`）

**验收标准**：
- [ ] 页面加载无控制台错误
- [ ] 搜索专利→错误提示功能正常（`showError`）
- [ ] Toast提示正常（`showToast`）
- [ ] 复制功能正常（`copyToClipboard`）
- [ ] 历史列表的"X分钟前"显示正常（`timeAgo`）
- [ ] HTML转义正常（`escapeHtml`）——搜索后检查专利详情中无XSS
- [ ] 手动选择状态保存/恢复正常（`saveManualSelection`/`loadManualSelection`）

**验证方法**：
1. 搜索一个不存在的专利号→确认错误提示弹出
2. 搜索一个有效专利号→确认详情页正常渲染（escapeHtml工作）
3. 点击复制按钮→确认剪贴板内容正确
4. 查看历史列表→确认时间显示正常
5. 在Kanban中手动选择一个文档→刷新页面→确认选择状态保持

**Commit**: `refactor: extract core-utils.js from web-app.js (Step 1.2)`

---

#### Step 1.3：提取 `state.js`

**迁移内容**：所有 `let` 类型的全局状态变量（48个），集中管理。

| 行号 | 变量名 | 暴露方式 |
|------|--------|----------|
| L83 | `currentData` | `window.currentData` |
| L84 | `kanbanAutoAbortController` | `window.kanbanAutoAbortController` |
| L85 | `citedRefsAbortController` | `window.citedRefsAbortController` |
| L88 | `activeAnalysisProcess` | `window.activeAnalysisProcess` |
| L189 | `searchMode` | `window.searchMode` |
| L195 | `_dossierTabs` | `window._dossierTabs` |
| L196 | `_dossierActiveKey` | `window._dossierActiveKey` |
| L819-L860 | `pdfViewState` | `window.pdfViewState` |
| L861 | `_pdfDocCache` | `window._pdfDocCache` |
| L863 | `chatHistory` | `window.chatHistory` |
| L864 | `chatAbortController` | `window.chatAbortController` |
| L865-L866 | `chatProviderOverride`, `chatModelOverride` | `window.chatProviderOverride` 等 |
| L867-L870 | `analysisChatHistory` 等4个 | `window.analysisChatHistory` 等 |
| L871-L872 | `_patentAskProviderOverride` 等2个 | 同名暴露 |
| L873-L874 | `translateAbortController`, `translatePageCache` | 同名暴露 |
| L2380 | `_patentDetailCtxMenu` | 同名暴露 |
| L2757-L2758 | `_googleTranslateInjected`, `_googleTranslateActive` | 同名暴露 |
| L2903 | `_prefetchCache` | 同名暴露 |
| L2954-L2957 | `_patentPopupData` 等4个 | 同名暴露 |
| L3639 | `kanbanState` | `window.kanbanState` |
| L4103 | `_forceCloseApp` | `window._forceCloseApp` |
| L5170-L5174 | `_patentAskSource` 等5个 | 同名暴露 |
| L5258 | `_patentAskTraceIndex` | 同名暴露 |
| L8208 | `_currentOcrJobIdx` | 同名暴露 |
| L8939-L8941 | `_tocItems` 等3个 | 同名暴露 |
| L10191 | `_pdfCtxMenu` | 同名暴露 |
| L10239 | `_pdfAnnotCtxMenu` | 同名暴露 |
| L11112 | `_extractCtxMenu` | 同名暴露 |
| L13752-L13755 | `_pdActivePatent` 等4个 | 同名暴露 |
| L14314 | `_findBtnInjected` | 同名暴露 |
| L14334-L14336 | `_pdFindMatches` 等3个 | 同名暴露 |

**新文件**：`src/scripts/modules/state.js`

**关键注意**：
- `state.js` 只声明变量并暴露，不包含任何函数
- 所有变量初始化为 `null` / `[]` / `{}` / `false`，与原始代码一致
- `pdfViewState` 需要保持完整的初始对象结构（30+属性）
- `kanbanState` 需要保持完整的初始对象结构（8个属性）
- **不迁移 `const` 类型的DOM引用**（这些留在各功能模块中）

**验收标准**：
- [ ] 页面加载无控制台错误
- [ ] 搜索功能正常（`currentData` 被正确赋值）
- [ ] Kanban看板正常（`kanbanState` 被正确操作）
- [ ] PDF阅读器正常（`pdfViewState` 被正确操作）
- [ ] 聊天功能正常（`chatHistory` 被正确push/clear）
- [ ] Dossier多标签正常（`_dossierTabs` 被正确操作）

**验证方法**：
1. 搜索专利→确认结果正常显示（currentData赋值）
2. 打开Kanban看板→确认文档卡片正常（kanbanState操作）
3. 打开阅读器→查看PDF→确认翻页/缩放正常（pdfViewState操作）
4. 发送一条AI对话→确认消息显示（chatHistory push）
5. 打开多个dossier标签→切换→确认状态恢复（_dossierTabs操作）

**Commit**: `refactor: extract state.js from web-app.js (Step 1.3)`

---

### Phase 2：提取独立功能模块

此阶段提取的模块依赖 Phase 1 的模块（constants/core-utils/state），但彼此之间依赖较少。

---

#### Step 2.1：提取 `patent-links.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L613-L617 | `getGpProxySettings()` | `window.getGpProxySettings` |
| L618-L621 | `saveGpProxySettings(enabled, url)` | `window.saveGpProxySettings` |
| L622-L640 | `gpApiUrl(patentNumber)` | `window.gpApiUrl` |
| L641-L644 | `isJPPatent(pn)` | `window.isJPPatent` |
| L645-L677 | `parseJPPatentNo(pn)` | `window.parseJPPatentNo` |
| L678-L691 | `jplatpatDocUrl(pn)` | `window.jplatpatDocUrl` |
| L692-L695 | `jplatpatSimpleSearchUrl()` | `window.jplatpatSimpleSearchUrl` |
| L696-L705 | `jplatpatSearchNumber(pn)` | `window.jplatpatSearchNumber` |
| L706-L712 | `openJPlatPat(pn)` | `window.openJPlatPat` |
| L713-L716 | `isCNPatent(pn)` | `window.isCNPatent` |
| L717-L720 | `cnQueryUrl(pn)` | `window.cnQueryUrl` |
| L721-L742 | `openCNQuery(pn)` | `window.openCNQuery` |
| L743-L757 | `patentLinkButtons(raw, opts)` | `window.patentLinkButtons` |

**新文件**：`src/scripts/modules/patent-links.js`

**依赖**：`core-utils`（可能用到 `showError`）

**验收标准**：
- [ ] 搜索结果中的专利链接按钮正常显示
- [ ] 点击Google Patents链接→正确跳转
- [ ] 点击J-PlatPat链接→正确跳转（日本专利）
- [ ] 点击CN查询链接→正确跳转（中国专利）
- [ ] GP代理设置保存/读取正常

**验证方法**：
1. 搜索一个美国专利→确认Google Patents链接可点击
2. 搜索一个日本专利→确认J-PlatPat链接可点击
3. 搜索一个中国专利→确认CN查询链接可点击
4. 在设置中开启GP代理→刷新→确认设置保持

**Commit**: `refactor: extract patent-links.js from web-app.js (Step 2.1)`

---

#### Step 2.2：提取 `patent-parser.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L1026-L1037 | `detectOffice(pn)` | `window.detectOffice` |
| L1038-L1106 | `parsePatentNumber(pn)` | `window.parsePatentNumber` |
| L146-L207 | `mapJpDocType(code)` | `window.mapJpDocType` |

**新文件**：`src/scripts/modules/patent-parser.js`

**依赖**：`patent-links`（`isJPPatent`/`isCNPatent`）

**验收标准**：
- [ ] 搜索各种格式的专利号都能正确识别（US/EP/JP/CN/WO等）
- [ ] 输入框中的局名badge正确显示
- [ ] 日本专利文档类型映射正确

**验证方法**：
1. 输入 `US1234567B2` → 确认识别为美国专利
2. 输入 `EP1234567A1` → 确认识别为欧洲专利
3. 输入 `JP2020123456A` → 确认识别为日本专利
4. 输入 `CN123456A` → 确认识别为中国专利

**Commit**: `refactor: extract patent-parser.js from web-app.js (Step 2.2)`

---

#### Step 2.3：提取 `patent-office.js`

**迁移内容**：OPS相关设置和tauri调用

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L758-L875 | `getOpsSettings()` | `window.getOpsSettings` |
| L166-L197 | `tauriInvoke(cmd, args)` | `window.tauriInvoke` |

**新文件**：`src/scripts/modules/patent-office.js`

**依赖**：`core-utils`（`showError`）

**验收标准**：
- [ ] OPS设置读取正常
- [ ] Tauri桌面端调用正常（如在Tauri环境中）
- [ ] 设置页面中OPS配置区域正常显示

**Commit**: `refactor: extract patent-office.js from web-app.js (Step 2.3)`

---

#### Step 2.4：提取 `dossier-tabs.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L198-L202 | `_dossierMakeKey(raw)` | `window._dossierMakeKey` |
| L203-L221 | `_dossierCaptureState()` | `window._dossierCaptureState` |
| L222-L236 | `_dossierSaveActiveTab()` | `window._dossierSaveActiveTab` |
| L237-L338 | `_dossierApplyTab(tab)` | `window._dossierApplyTab` |
| L339-L375 | `_dossierRenderTabs()` | `window._dossierRenderTabs` |
| L376-L384 | `_dossierSwitchTo(key)` | `window._dossierSwitchTo` |
| L385-L407 | `_dossierGetTabAnnotSummary(tab)` | `window._dossierGetTabAnnotSummary` |
| L408-L474 | `_dossierCloseTab(key)` | `window._dossierCloseTab` |
| L475-L492 | `_dossierCleanupTabPdfAnnots(docKey)` | `window._dossierCleanupTabPdfAnnots` |
| L493-L506 | `_dossierFindVictimTab()` | `window._dossierFindVictimTab` |
| L507-L523 | `_dossierConfirmEvict(tab)` | `window._dossierConfirmEvict` |
| L524-L530 | `_dossierEvictTab(tab)` | `window._dossierEvictTab` |
| L531-L563 | `_dossierCreateEmptyTab(key, label)` | `window._dossierCreateEmptyTab` |
| L564-L586 | `_dossierPrepareTab(raw)` | `window._dossierPrepareTab` |
| L587-L598 | `_dossierNewTabFromSearch(raw)` | `window._dossierNewTabFromSearch` |
| L599-L611 | `_dossierRegisterCurrentTab(raw)` | `window._dossierRegisterCurrentTab` |
| L194 | `DOSSIER_MAX_TABS` (const) | `window.DOSSIER_MAX_TABS` |

**新文件**：`src/scripts/modules/dossier-tabs.js`

**依赖**：`state`（`currentData`/`kanbanState`/`searchMode`/`_dossierTabs`/`_dossierActiveKey`/`pdfViewState`）

**关键注意**：
- `_dossierApplyTab` 内部调用 `renderKanban`/`renderOverview`/`renderFamily`/`renderTimeline`/`_dossierRenderTabs`/`refreshHistoryList`/`updateFloatingBallsVisibility` —— 这些函数此时仍在 web-app.js 中，通过 window 全局可访问，**不需要特殊处理**
- `_dossierRenderTabs` 的事件回调中调用 `_dossierSwitchTo`/`_dossierCloseTab` —— 同一模块内，IIFE内部可直接访问
- 闭包绑定：此模块无 document 级闭包绑定，安全

**验收标准**：
- [ ] 搜索专利→自动创建新标签
- [ ] 切换标签→Kanban/Overview/Family/Timeline正确恢复
- [ ] 关闭标签→弹出未保存确认（如有未保存工作）
- [ ] 超过3个标签→驱逐逻辑正常
- [ ] 关闭有PDF标注的标签→标注数据被清理

**验证方法**：
1. 搜索专利A→搜索专利B→确认两个标签存在
2. 在标签A的Kanban中做修改→切换到标签B→切回A→确认修改保持
3. 打开3个标签→搜索第4个→确认弹出驱逐确认
4. 在某标签的PDF中添加标注→关闭该标签→重新打开→确认标注已清理

**Commit**: `refactor: extract dossier-tabs.js from web-app.js (Step 2.4)`

---

### Phase 3：提取渲染引擎模块

---

#### Step 3.1：提取 `search.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L1107-L1188 | `gdFetch(input)` (async) | `window.gdFetch` |
| L3504-L4018 | `doSearch(input)` (async) | `window.doSearch` |
| L1307-L1466 | `searchPatentDetail(query)` (async) | `window.searchPatentDetail` |
| L1139-L1188 | 顶层事件绑定（patentInput input/keydown, searchBtn click） | 在IIFE末尾执行 |

**新文件**：`src/scripts/modules/search.js`

**依赖**：`patent-parser`（`parsePatentNumber`/`detectOffice`）、`patent-links`（`gpApiUrl`）、`state`（`currentData`/`searchMode`）、`core-utils`（`showError`/`showToast`）、`dossier-tabs`（`_dossierNewTabFromSearch`）

**关键注意**：
- `doSearch` 是515行的大函数，内部调用大量渲染函数（`renderKanban`/`renderOverview`等）——这些函数此时仍在web-app.js中，通过window可访问
- `doSearch` 内部修改 `kanbanState`（L3544-3547 重置属性）——确保state.js中的kanbanState引用一致
- `doSearch` 内部调用 `PatentCache.restoreState` / `autoSaveCache` / `refreshHistoryList` —— 此时这些函数仍在web-app.js中
- 顶层事件绑定（L1139/L1151/L1155）必须在DOM已就绪后执行——由于script在body末尾，安全
- `searchPatentDetail` 是死代码（从未被调用），但仍然迁移

**验收标准**：
- [ ] 输入专利号→回车→搜索正常执行
- [ ] 点击搜索按钮→搜索正常执行
- [ ] 搜索结果正确显示（Kanban/Overview/Family/Timeline）
- [ ] 输入时局名badge实时更新
- [ ] 搜索错误时显示错误提示
- [ ] 搜索结果被正确缓存

**验证方法**：
1. 输入 `US1234567B2` → 回车 → 确认搜索结果正常
2. 输入无效专利号 → 确认错误提示
3. 输入时 → 确认局名badge实时变化
4. 搜索后切换标签再切回 → 确认结果保持

**Commit**: `refactor: extract search.js from web-app.js (Step 3.1)`

---

#### Step 3.2：提取 `cache-history.js`

**迁移内容**：

| 行号 | 函数/对象 | 暴露方式 |
|------|----------|----------|
| L3648-L3981 | `PatentCache` 对象 | `window.PatentCache` |
| L3982-L4018 | `GPCache` 对象 | `window.GPCache` |
| L4037-L4080 | `showCacheConfirmDialog(...)` | `window.showCacheConfirmDialog` |
| L4081-L4091 | `promptSaveCache(...)` | `window.promptSaveCache` |
| L4092-L4181 | `autoSaveCache()` | `window.autoSaveCache` |
| L4182-L4441 | `refreshHistoryList()` | `window.refreshHistoryList` |
| L4442-L4459 | `restoreFromCache(...)` (死代码) | `window.restoreFromCache` |
| L4460-L4474 | `restoreFromHistory(...)` (死代码) | `window.restoreFromHistory` |
| L4475-L4495 | `doRestoreFromHistory(pn)` | `window.doRestoreFromHistory` |
| L4496-L4528 | `doRestoreFromCache(pn)` | `window.doRestoreFromCache` |
| L4103-L4106 | `_forceCloseApp` 相关Electron绑定 | 在IIFE末尾执行 |
| L4107-L4119 | `beforeunload` 事件绑定 | 在IIFE末尾执行 |
| L4173-L4179 | `visibilitychange` 事件绑定 | 在IIFE末尾执行 |
| L2961 | `setInterval`（30分钟清理PPV缓存） | 在IIFE末尾执行 |

**新文件**：`src/scripts/modules/cache-history.js`

**依赖**：`state`、`core-utils`、`dossier-tabs`（`_dossierSaveActiveTab`）

**关键注意**：
- `PatentCache` 和 `GPCache` 是对象（含方法），不是函数——整体暴露
- `beforeunload`/`visibilitychange` 绑定引用 `_forceCloseApp`（state.js中）和 `autoSaveCache`（本模块内）——安全
- `setInterval`（L2961）引用 `_patentPopupCache`（state.js中）和 `PATENT_POPUP_CACHE_TTL`——需将 `PATENT_POPUP_CACHE_TTL` 也迁移到本模块或state.js
- `refreshHistoryList` 是枢纽函数（被调用25次），必须暴露

**验收标准**：
- [ ] 历史列表正常显示
- [ ] 点击历史项→恢复专利详情
- [ ] 缓存保存/恢复正常
- [ ] 关闭有未保存工作的页面→弹出提示
- [ ] 页面可见性切换→自动保存
- [ ] 清空历史/缓存功能正常

**验证方法**：
1. 搜索几个专利→确认历史列表更新
2. 刷新页面→确认历史列表保持
3. 点击历史项→确认专利详情恢复
4. 搜索后不做操作→切换浏览器标签页→切回→确认自动保存
5. 在Kanban中修改→关闭标签→确认弹出未保存提示
6. 点击"清空历史"→确认历史被清空
7. 等待30秒+→确认控制台无setInterval错误

**Commit**: `refactor: extract cache-history.js from web-app.js (Step 3.2)`

---

#### Step 3.3：提取 `render-engine.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L4562-L4766 | `renderKanban(data)` | `window.renderKanban` |
| L4767-L4902 | `renderOverview(data)` | `window.renderOverview` |
| L4903-L4915 | `countFamilyMembers(data)` | `window.countFamilyMembers` |
| L4916-L4927 | `countDocuments(data)` | `window.countDocuments` |
| L4928-L4970 | `renderFamily(data)` | `window.renderFamily` |
| L4971-L4985 | `extractFamilyMembers(data)` | `window.extractFamilyMembers` |
| L4992-L5077 | `renderDescriptionHtml(desc)` | `window.renderDescriptionHtml` |

**新文件**：`src/scripts/modules/render-engine.js`

**依赖**：`state`（`kanbanState`/`currentData`）、`core-utils`（`escapeHtml`/`icon`）、`patent-links`（`patentLinkButtons`）

**关键注意**：
- `renderKanban` 内部重置 `kanbanState` 属性（L4571/L4599/L4601/L4605）——确保state.js中的引用一致
- `renderKanban` 内部清空 `analysisChatHistory`（L4617）——state.js中已暴露
- `renderKanban` 调用 `renderExtractDocList`（此时仍在web-app.js中）——通过window可访问
- `renderOverview`/`renderFamily` 调用 `escapeHtml`/`icon`/`patentLinkButtons`——core-utils和patent-links中已暴露

**验收标准**：
- [ ] 搜索后Kanban看板正确渲染
- [ ] Overview概览正确显示
- [ ] Family同族信息正确显示
- [ ] Description描述正确渲染（Markdown→HTML）
- [ ] Kanban中的文档卡片交互正常

**验证方法**：
1. 搜索专利→确认Kanban看板正常显示
2. 切换到Overview→确认概览信息正确
3. 切换到Family→确认同族信息正确
4. 在Kanban中拖拽文档→确认功能正常
5. 查看描述区域→确认HTML渲染正常

**Commit**: `refactor: extract render-engine.js from web-app.js (Step 3.3)`

---

#### Step 3.4：提取 `patent-detail.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L1791-L1801 | `closeInAppWebview()` | `window.closeInAppWebview` |
| L1802-L1820 | `showDataSourceBadge(source)` | `window.showDataSourceBadge` |
| L1821-L2176 | `renderPatentDetail(data, tab)` | `window.renderPatentDetail` |
| L2177-L2184 | `switchPatentTab(idx)` | `window.switchPatentTab` |
| L2207-L2226 | `_handleCopyCitationNums(...)` | `window._handleCopyCitationNums` |
| L2224-L2229 | `_makeCopyNumsBtn(...)` | `window._makeCopyNumsBtn` |
| L2729-L2759 | `copyPatentSectionText(...)` | `window.copyPatentSectionText` |
| L2823-L2859 | `openPatentImageViewer(...)` | `window.openPatentImageViewer` |
| L2860-L2904 | `linkifyPatentNumbers(...)` | `window.linkifyPatentNumbers` |
| L2905-L2928 | `prefetchPatentLinks(...)` | `window.prefetchPatentLinks` |
| L2929-L2968 | `clearPrefetchCache()` | `window.clearPrefetchCache` |
| L1467-L1790 | `openInAppWebview(...)` | `window.openInAppWebview` |
| L1189-L1466 | `updateFloatingBallsVisibility()` | `window.updateFloatingBallsVisibility` |
| L2936-L2960 | 顶层 `document.addEventListener("click", ...)` | 在IIFE末尾执行 |

**新文件**：`src/scripts/modules/patent-detail.js`

**依赖**：`render-engine`、`core-utils`（`escapeHtml`/`icon`/`copyToClipboard`）、`patent-links`、`state`

**关键注意**：
- `renderPatentDetail` 是356行的大函数，生成大量HTML，其中包含onclick字符串引用的函数：`openInAppWebview`/`openJPlatPat`/`openCNQuery`/`openPatentAsk`/`toggleGoogleTranslate`/`switchPatentTab`/`runPatentInterpretation`/`copyPatentSectionText` —— 这些函数必须通过window暴露（本模块暴露5个，其余在其他模块中）
- `updateFloatingBallsVisibility` 是枢纽函数（被调用12次），必须在顶层调用（L14535）
- `openInAppWebview` 是324行的大函数，内部有大量DOM操作和闭包
- 顶层 `document.addEventListener("click", ...)`（L2936）是事件委托，处理专利号链接点击——安全

**验收标准**：
- [ ] 专利详情页正确渲染（标题/摘要/权利要求/说明书等）
- [ ] 专利号链接可点击→打开内嵌webview
- [ ] Google Patents/J-PlatPat/CN查询链接正常
- [ ] 标签页切换正常（摘要/权利要求/说明书等）
- [ ] 复制功能正常（引用号/段落文本）
- [ ] 图片查看器正常
- [ ] 专利号链接化正常（文本中的专利号变成可点击链接）
- [ ] 悬浮球可见性正确（根据搜索模式变化）

**验证方法**：
1. 搜索专利→确认详情页正常渲染
2. 点击详情页中的专利号链接→确认弹出webview
3. 切换标签页（摘要/权利要求等）→确认内容切换
4. 点击复制按钮→确认剪贴板内容正确
5. 点击图片→确认图片查看器打开
6. 检查悬浮球可见性→确认根据搜索模式正确显示/隐藏

**Commit**: `refactor: extract patent-detail.js from web-app.js (Step 3.4)`

---

#### Step 3.5：提取 `patent-popup.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L2970-L2995 | `_bindPpvContentEvents(content, data)` | `window._bindPpvContentEvents` |
| L2996-L3009 | `_renderPpvPatentTabs()` | `window._renderPpvPatentTabs` |
| L3010-L3285 | `renderPatentPopupContent(data)` | `window.renderPatentPopupContent` |
| L3286-L3428 | `openPatentPopup(raw)` (async) | `window.openPatentPopup` |
| L3429-L3465 | `switchPpvPatent(raw)` | `window.switchPpvPatent` |
| L3466-L3485 | `closePpvPatentTab(raw)` | `window.closePpvPatentTab` |
| L3486-L3496 | `closePatentPopup()` | `window.closePatentPopup` |
| L3497-L3503 | `showPatentPopup(raw)` | `window.showPatentPopup` |

**新文件**：`src/scripts/modules/patent-popup.js`

**依赖**：`patent-detail`（`renderPatentDetail`等）、`core-utils`、`patent-links`、`state`（`_patentPopupData`/`_ppvOpenPatents`/`_ppvActivePatent`/`_patentPopupCache`）

**关键注意**：
- `renderPatentPopupContent` 包含onclick字符串引用：`switchPpvPatent`/`closePpvPatentTab`/`switchPpvTab`/`openPatentImageViewer`/`runPatentInterpretation`/`copyPatentSectionText` —— 必须通过window暴露
- `_bindPpvContentEvents` 内部有闭包绑定（捕获`data.drawings`和`idx`）——函数体不拆分

**验收标准**：
- [ ] 鼠标悬停专利号链接→弹出专利预览
- [ ] 弹窗中切换专利标签正常
- [ ] 关闭弹窗标签正常
- [ ] 弹窗中的翻译/解读按钮正常
- [ ] 弹窗缓存正常（30分钟内不重复请求）

**验证方法**：
1. 在专利详情页中悬停一个引用专利号→确认弹窗出现
2. 在弹窗中打开多个专利→确认标签切换正常
3. 关闭一个标签→确认正常
4. 再次悬停同一专利号→确认使用缓存（快速显示）

**Commit**: `refactor: extract patent-popup.js from web-app.js (Step 3.5)`

---

#### Step 3.6：提取 `translation.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L2230-L2239 | `switchPpvTab(idx)` | `window.switchPpvTab` |
| L2240-L2381 | `translatePatentSection(...)` (async) | `window.translatePatentSection` |
| L2382-L2433 | `showPatentDetailContextMenu(...)` | `window.showPatentDetailContextMenu` |
| L2434-L2455 | `hidePatentDetailContextMenu()` | `window.hidePatentDetailContextMenu` |
| L2441-L2455 | `googleTranslateText(...)` (async) | `window.googleTranslateText` |
| L2456-L2460 | `openInGoogleTranslate(text)` | `window.openInGoogleTranslate` |
| L2478-L2643 | `showFloatingTranslationPopup(...)` | `window.showFloatingTranslationPopup` |
| L2644-L2647 | `showFloatingTranslation(...)` (async) | `window.showFloatingTranslation` |
| L2648-L2660 | `translateSelectedPatentText()` (async) | `window.translateSelectedPatentText` |
| L2661-L2728 | `translateClaimByIndex(...)` (async) | `window.translateClaimByIndex` |
| L2760-L2822 | `toggleGoogleTranslate()` | `window.toggleGoogleTranslate` |

**新文件**：`src/scripts/modules/translation.js`

**依赖**：`core-utils`、`state`（`translateAbortController`/`translatePageCache`/`_googleTranslateInjected`/`_googleTranslateActive`/`_patentDetailCtxMenu`）

**关键注意**：
- `showFloatingTranslationPopup` 内部定义了嵌套函数 `runTranslation`（L2559），被setTimeout引用（L2635）——函数体不拆分
- `toggleGoogleTranslate` 注入Google翻译脚本——依赖 `_googleTranslateInjected` 状态
- `showPatentDetailContextMenu`/`hidePatentDetailContextMenu` 引用 `_patentDetailCtxMenu`

**验收标准**：
- [ ] 专利段落翻译正常（点击翻译按钮）
- [ ] 划词翻译弹窗正常
- [ ] 整页Google翻译正常
- [ ] 右键上下文菜单正常
- [ ] 权利要求按条翻译正常
- [ ] 翻译中止功能正常

**验证方法**：
1. 在专利详情页点击某段落的翻译按钮→确认翻译结果显示
2. 选中一段文本→确认浮动翻译弹窗出现
3. 点击整页翻译→确认Google翻译加载
4. 右键点击→确认上下文菜单出现
5. 翻译过程中点击中止→确认翻译停止

**Commit**: `refactor: extract translation.js from web-app.js (Step 3.6)`

---

### Phase 4：提取AI与文档分析模块

---

#### Step 4.1：提取 `ai-settings.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L896-L909 | `getChatProvider()` | `window.getChatProvider` |
| L910-L927 | `populateModelDatalist(...)` | `window.populateModelDatalist` |
| L928-L955 | `populateChatProviderSelect(...)` | `window.populateChatProviderSelect` |
| L956-L1021 | `exportChatToWord(...)` | `window.exportChatToWord` |
| L6131-L6142 | `updateTranslateModelOptions()` | `window.updateTranslateModelOptions` |
| L6143-L6205 | `loadAISettingsToForm()` | `window.loadAISettingsToForm` |
| L6206-L6229 | `toggleOcrGlmKeyVisibility()` | `window.toggleOcrGlmKeyVisibility` |
| L6230-L6234 | `updateModelOptions()` | `window.updateModelOptions` |
| L6235-L6240 | `showTestResult(...)` | `window.showTestResult` |
| L765-L817 | AI设置模态框DOM引用（52个const） | 模块私有 |
| L5953-L6115 | 顶层AI设置事件绑定（约20个） | 在IIFE末尾执行 |

**新文件**：`src/scripts/modules/ai-settings.js`

**依赖**：`core-utils`、`constants`

**关键注意**：
- 52个DOM引用（L765-L817）在此模块中声明为模块私有变量
- 顶层事件绑定（L5953-L6115）引用这些DOM变量——必须在同一IIFE中
- `loadAISettingsToForm` 被 DOMContentLoaded 回调调用——此时DOMContentLoaded仍在web-app.js中，通过window调用
- `populateChatProviderSelect` 是枢纽函数（被调用7次）
- 事件绑定中的 `if (aiSettingsBtn)` 等守卫——保留

**验收标准**：
- [ ] AI设置面板打开/关闭正常
- [ ] AI提供商切换正常→模型列表更新
- [ ] API Key/Base URL/Model保存正常
- [ ] 测试连接功能正常
- [ ] OCR引擎切换正常→GLM Key输入框显隐
- [ ] 翻译提供商切换正常
- [ ] Prompts保存正常
- [ ] 导出聊天到Word正常

**验证方法**：
1. 点击设置按钮→确认AI设置面板打开
2. 切换AI提供商→确认模型列表更新
3. 输入API Key→保存→刷新页面→确认保持
4. 点击测试→确认测试结果
5. 切换OCR引擎→确认GLM Key输入框显隐
6. 导出聊天→确认Word文件下载

**Commit**: `refactor: extract ai-settings.js from web-app.js (Step 4.1)`

---

#### Step 4.2：提取 `patent-ask.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L5078-L5081 | `_getPatentDataSource()` | `window._getPatentDataSource` |
| L5082-L5087 | `_buildClaimsText(data)` | `window._buildClaimsText` |
| L5088-L5175 | `runPatentInterpretation(...)` (async) | `window.runPatentInterpretation` |
| L5176-L5179 | `_patentAskCacheKey(raw)` | `window._patentAskCacheKey` |
| L5180-L5191 | `_savePatentAskCache(...)` | `window._savePatentAskCache` |
| L5192-L5206 | `_loadPatentAskCache(raw)` | `window._loadPatentAskCache` |
| L5207-L5222 | `_renderPatentAskMessages()` | `window._renderPatentAskMessages` |
| L5223-L5240 | `openPatentAsk(raw)` | `window.openPatentAsk` |
| L5241-L5247 | `closePatentAsk()` | `window.closePatentAsk` |
| L5248-L5259 | `clearPatentAsk()` | `window.clearPatentAsk` |
| L5260-L5311 | `_buildPatentAskContext(raw)` | `window._buildPatentAskContext` |
| L5312-L5328 | `_appendPatentAskMessage(...)` | `window._appendPatentAskMessage` |
| L5329-L5431 | `sendPatentAsk()` (async) | `window.sendPatentAsk` |
| L5432-L5569 | `_initPatentAskBindings()` | `window._initPatentAskBindings` |
| L5569 | 顶层调用 `_initPatentAskBindings()` | 在IIFE末尾执行 |

**新文件**：`src/scripts/modules/patent-ask.js`

**依赖**：`ai-settings`、`patent-detail`、`core-utils`、`state`（`_patentAskSource`/`_patentAskMessages`/`_patentAskStreaming`/`_patentAskTraceIndex`/`_patentAskProviderOverride`/`_patentAskModelOverride`）

**关键注意**：
- 🔴 **闭包绑定不可拆**：`_initPatentAskBindings()`（L5432-L5569）内部有document级的mousemove/mouseup监听器，捕获函数作用域内的 `isDragging`/`resizeMode`/`startX/Y` 等 let 变量——整个函数体必须保持完整
- `_initPatentAskBindings()` 在顶层被调用（L5569）——必须在DOM就绪后执行
- `sendPatentAsk` 是async函数，内部push `_patentAskMessages`——注意与 `clearPatentAsk` 的竞态
- `openPatentAsk` 被onclick字符串引用——必须通过window暴露

**验收标准**：
- [ ] 点击"问一问"按钮→悬浮窗打开
- [ ] 发送问题→AI回复正常（流式输出）
- [ ] 悬浮窗拖拽正常
- [ ] 悬浮窗缩放正常
- [ ] 清空对话正常
- [ ] 关闭悬浮窗正常
- [ ] 缓存功能正常（同一专利的对话历史）

**验证方法**：
1. 在专利详情页点击"问一问"→确认悬浮窗打开
2. 输入问题→发送→确认AI流式回复
3. 拖拽悬浮窗→确认位置移动
4. 拖拽悬浮窗右下角→确认缩放
5. 点击清空→确认对话清除
6. 关闭再打开→确认对话历史恢复（缓存）

**Commit**: `refactor: extract patent-ask.js from web-app.js (Step 4.2)`

---

#### Step 4.3：提取 `ai-analysis.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L6241-L6330 | `doExtractText(...)` (async) | `window.doExtractText` |
| L6331-L6387 | `buildTimelineSummary(data)` | `window.buildTimelineSummary` |
| L6388-L6774 | `runCitedRefsAnalysis(...)` (async) | `window.runCitedRefsAnalysis` |
| L6775-L6841 | `_createThinkingHost(...)` | `window._createThinkingHost` |
| L6842-L6877 | `renderAiProgressUI(...)` | `window.renderAiProgressUI` |
| L6878-L7358 | `buildReviewManualSelectPanel()` | `window.buildReviewManualSelectPanel` |
| L7359-L7370 | `renderMarkdown(md)` | `window.renderMarkdown` |
| L7371-L7470 | `renderMarkdownWithTrace(...)` | `window.renderMarkdownWithTrace` |
| L7471-L7479 | `cleanModuleHeading(text)` | `window.cleanModuleHeading` |
| L7480-L7525 | `parseAnalysisModules(text)` | `window.parseAnalysisModules` |
| L7526-L7579 | `renderAnalysisModules(...)` | `window.renderAnalysisModules` |
| L7580-L7586 | `extractModuleText(...)` | `window.extractModuleText` |
| L7587-L7603 | `replaceModuleText(...)` | `window.replaceModuleText` |
| L7604-L7706 | `regenerateAnalysisModule(...)` (async) | `window.regenerateAnalysisModule` |
| L7707-L7763 | `showModuleRegenPopup(...)` | `window.showModuleRegenPopup` |
| L7764-L7824 | `_jumpToPatentTrace(...)` | `window._jumpToPatentTrace` |
| L7825-L7830 | `_highlightElement(el)` | `window._highlightElement` |
| L7831-L7938 | `onTraceClick(e)` | `window.onTraceClick` |
| L6610-L6630 | 顶层中止按钮绑定 | 在IIFE末尾执行 |

**新文件**：`src/scripts/modules/ai-analysis.js`

**依赖**：`ai-settings`、`render-engine`、`patent-detail`、`core-utils`、`state`（`kanbanState`/`activeAnalysisProcess`/`kanbanAutoAbortController`/`citedRefsAbortController`）

**关键注意**：
- `runCitedRefsAnalysis` 是387行的大async函数——函数体不拆分
- `buildReviewManualSelectPanel` 是481行的大函数——函数体不拆分
- `renderMarkdown`/`renderMarkdownWithTrace` 是枢纽函数（被调用16/15次）
- `buildReviewManualSelectPanel` 内部修改 `kanbanState.extractions`/`analysis`/`traceIndex`/`hasUnsavedWork`——确保state.js中引用一致
- L6610-L6630 的顶层按钮绑定引用 `citedRefsAbortBtn`/`manualSelectBtn`/`citedRefsManualBtn`——这些DOM引用需要在此模块中声明

**验收标准**：
- [ ] 引用文献分析正常（点击分析按钮→AI思考过程→结果渲染）
- [ ] 手动选择面板正常
- [ ] Markdown渲染正常（标题/列表/代码块/表格）
- [ ] 溯源跳转正常（点击溯源标记→跳转到原文）
- [ ] 模块重生功能正常（点击重新生成→弹窗→新内容）
- [ ] 中止分析功能正常
- [ ] 时间线摘要正常

**验证方法**：
1. 搜索有引用文献的专利→点击"引用文献分析"→确认AI思考过程显示
2. 等待分析完成→确认结果以Markdown渲染
3. 点击溯源标记→确认跳转到原文位置
4. 点击某个模块的"重新生成"→确认弹窗→确认新内容
5. 分析过程中点击"中止"→确认停止
6. 点击"手动选择"→确认面板打开

**Commit**: `refactor: extract ai-analysis.js from web-app.js (Step 4.3)`

---

#### Step 4.4：提取 `documents.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L5571-L5692 | `renderDocuments(data)` | `window.renderDocuments` |
| L5693-L5781 | `extractDocumentText(doc)` (async) | `window.extractDocumentText` |
| L5782-L5868 | `aiAnalyzeDocument(doc)` (async) | `window.aiAnalyzeDocument` |
| L5869-L5922 | `downloadDocument(doc)` (async) | `window.downloadDocument` |
| L5923-L6130 | `extractDocuments()` | `window.extractDocuments` |

**新文件**：`src/scripts/modules/documents.js`

**依赖**：`render-engine`、`ai-analysis`、`core-utils`、`state`（`kanbanState`/`currentData`）

**关键注意**：
- `extractDocumentText` 修改 `kanbanState.extractions`/`traceIndex`/`hasUnsavedWork`
- `extractDocuments` 是208行的函数——函数体不拆分
- `renderDocuments` 内部调用 `linkifyPatentNumbers`/`prefetchPatentLinks`——patent-detail模块中已暴露

**验收标准**：
- [ ] 文档列表正确渲染
- [ ] 文档文本提取正常（PDF→文本）
- [ ] AI文档分析正常
- [ ] 文档下载正常
- [ ] 批量文本提取正常

**验证方法**：
1. 搜索有PDF文档的专利→确认文档列表显示
2. 点击某文档的"提取文本"→确认文本提取成功
3. 点击"AI分析"→确认AI分析结果
4. 点击"下载"→确认文件下载
5. 点击"批量提取"→确认所有文档提取

**Commit**: `refactor: extract documents.js from web-app.js (Step 4.4)`

---

#### Step 4.5：提取 `chat.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L10964-L10977 | `refreshAllChatProviderSelects()` | `window.refreshAllChatProviderSelects` |
| L12590-L12752 | `sendChatMessage()` (async) | `window.sendChatMessage` |
| L12753-L12770 | `appendChatMessage(...)` | `window.appendChatMessage` |
| L12771-L12774 | `showAnalysisChatToggle(show)` | `window.showAnalysisChatToggle` |
| L12775-L12818 | `appendAnalysisChatMessage(...)` | `window.appendAnalysisChatMessage` |
| L12819-L13078 | `sendAnalysisChatMessage()` (async) + IIFE `initAnalysisChat()` | `window.sendAnalysisChatMessage` |

**新文件**：`src/scripts/modules/chat.js`

**依赖**：`ai-settings`（`getChatProvider`/`populateChatProviderSelect`）、`core-utils`（`escapeHtml`/`showToast`）、`state`（`chatHistory`/`chatAbortController`/`chatProviderOverride`/`chatModelOverride`/`analysisChatHistory`/`analysisChatAbortController`/`analysisChatProviderOverride`/`analysisChatModelOverride`）

**关键注意**：
- 🔴 **闭包绑定不可拆**：IIFE `initAnalysisChat()`（L12922-L13078）内部有document级mousemove/mouseup监听器——整个IIFE必须保持完整
- `sendChatMessage` 是async，push `chatHistory`——与 `selectReaderDoc`（reader模块）的清空有竞态
- `sendAnalysisChatMessage` 是async，push `analysisChatHistory`——与 `renderKanban`（render-engine模块）的清空有竞态
- IIFE注释"script loaded at end of body, DOM is ready"——保持script在body末尾

**验收标准**：
- [ ] 阅读器中的聊天面板正常（发送/接收）
- [ ] 分析聊天浮球正常（打开/关闭/拖拽/缩放）
- [ ] AI流式回复正常
- [ ] 中止回复功能正常
- [ ] 导出聊天记录正常
- [ ] 聊天模型切换正常
- [ ] 在AI流式回复期间切换文档→不串数据

**验证方法**：
1. 打开阅读器→发送一条消息→确认AI回复
2. 打开分析聊天浮球→发送消息→确认回复
3. 拖拽浮球→确认位置移动
4. 拖拽浮球右下角→确认缩放
5. 在AI回复过程中点击"中止"→确认停止
6. 在AI回复过程中切换文档→确认不会串数据
7. 导出聊天→确认文件下载

**Commit**: `refactor: extract chat.js from web-app.js (Step 4.5)`

---

### Phase 5：提取PDF相关模块

---

#### Step 5.1：提取 `reader.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L8034-L8082 | `openReader()` | `window.openReader` |
| L8083-L8167 | `selectReaderDoc(idx, preserveChat)` | `window.selectReaderDoc` |
| L8168-L8181 | `selectReaderAnalysis(idx)` | `window.selectReaderAnalysis` |
| L8182-L8209 | `togglePdfView(show)` | `window.togglePdfView` |
| L8210-L8255 | `showOcrProgressOverlay(...)` | `window.showOcrProgressOverlay` |
| L8256-L8269 | `hideOcrProgressOverlay()` | `window.hideOcrProgressOverlay` |
| L8270-L8277 | `restoreOcrProgressForDoc(idx)` | `window.restoreOcrProgressForDoc` |
| L8278-L8471 | `renderPdfView(doc, idx)` (async) | `window.renderPdfView` |
| L8472-L8924 | `renderAllPdfPages()` (async) | `window.renderAllPdfPages` |
| L8925-L8942 | `rerenderPdfPages()` (async) | `window.rerenderPdfPages` |
| L7939-L8024 | `renderTimeline(data)` | `window.renderTimeline` |
| L8025-L8033 | `parseDate(str)` → 已在core-utils | - |
| L8207-L8208 | `ocrJobs`/`_currentOcrJobIdx` | 模块私有/state.js |

**新文件**：`src/scripts/modules/reader.js`

**依赖**：`documents`、`core-utils`、`state`（`pdfViewState`/`_pdfDocCache`/`chatHistory`）、`ai-settings`（`populateChatProviderSelect`）

**关键注意**：
- `renderPdfView` 内部 `++pdfViewState.renderVersion` 做并发防护——确保state.js中pdfViewState引用一致
- `selectReaderDoc` 清空 `chatHistory`（L8086）——与chat模块的async push有竞态，确保通过window访问同一引用
- `renderAllPdfPages` 是453行的大async函数——函数体不拆分
- `showOcrProgressOverlay` 是枢纽函数（被调用9次）

**验收标准**：
- [ ] 打开阅读器正常
- [ ] 选择文档→内容显示正常
- [ ] 文本/PDF模式切换正常
- [ ] PDF翻页/缩放正常
- [ ] 快速连续切换文档→无旧页面闪现
- [ ] OCR进度显示正常
- [ ] 时间线渲染正常

**验证方法**：
1. 点击"阅读器"按钮→确认阅读器打开
2. 选择一个文档→确认内容显示
3. 切换到PDF模式→确认PDF渲染
4. 翻页/缩放→确认正常
5. 快速切换多个文档→确认无旧页面闪现
6. 对PDF进行OCR→确认进度显示

**Commit**: `refactor: extract reader.js from web-app.js (Step 5.1)`

---

#### Step 5.2：提取 `pdf-toc.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L8943-L9013 | `buildPdfToc()` | `window.buildPdfToc` |
| L9014-L9039 | `jumpToTocItem(idx)` | `window.jumpToTocItem` |
| L9040-L9058 | `setActiveTocItem(idx)` | `window.setActiveTocItem` |
| L9059-L9088 | `updateActiveTocByScroll()` | `window.updateActiveTocByScroll` |
| L9089-L9102 | `installPdfTocScrollTracker()` | `window.installPdfTocScrollTracker` |
| L9103-L9117 | `updatePdfToolbar()` | `window.updatePdfToolbar` |
| L9118-L9127 | `pdfGoToPage(page)` | `window.pdfGoToPage` |
| L9128-L9132 | `pdfZoomInAction()` | `window.pdfZoomInAction` |
| L9133-L9137 | `pdfZoomOutAction()` | `window.pdfZoomOutAction` |
| L9138-L9151 | `pdfZoomFitAction()` | `window.pdfZoomFitAction` |
| L8939-L8941 | `_tocItems`/`_activeTocIndex`/`_tocScrollRafPending` | state.js已暴露 |

**新文件**：`src/scripts/modules/pdf-toc.js`

**依赖**：`reader`、`state`（`pdfViewState`/`_tocItems`/`_activeTocIndex`/`_tocScrollRafPending`）

**验收标准**：
- [ ] PDF目录显示正常
- [ ] 点击目录项→跳转到对应页面
- [ ] 滚动PDF→目录高亮当前章节
- [ ] 翻页/缩放工具栏正常
- [ ] 页码输入→跳转正常

**验证方法**：
1. 打开一个有多页的PDF→点击目录按钮→确认目录显示
2. 点击目录中的某项→确认跳转到对应页面
3. 滚动PDF→确认目录中的高亮项变化
4. 输入页码→回车→确认跳转
5. 点击缩放按钮→确认缩放正常

**Commit**: `refactor: extract pdf-toc.js from web-app.js (Step 5.2)`

---

#### Step 5.3：提取 `pdf-annotations.js`（最大模块，约1300行）

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L9152-L9161 | `_buildPdfDocKey(doc, idx)` | `window._buildPdfDocKey` |
| L9162-L9165 | `_getCurrentPdfAnnotKey()` | `window._getCurrentPdfAnnotKey` |
| L9166-L9175 | `loadPdfAnnotations(docKey)` | `window.loadPdfAnnotations` |
| L9176-L9185 | `savePdfAnnotations(docKey)` | `window.savePdfAnnotations` |
| L9186-L9190 | `_hasAnyPdfAnnotations(docKey)` | `window._hasAnyPdfAnnotations` |
| L9191-L9206 | `_getUnsavedAnnotsSummary()` | `window._getUnsavedAnnotsSummary` |
| L9207-L9214 | `_updateAnnotCloseFlag(...)` | `window._updateAnnotCloseFlag` |
| L9215-L9246 | `setPdfAnnotTool(tool)` | `window.setPdfAnnotTool` |
| L9247-L9260 | `togglePdfOcrHide()` | `window.togglePdfOcrHide` |
| L9261-L9268 | `_pushAnnotUndo(docKey, snapshot)` | `window._pushAnnotUndo` |
| L9269-L9278 | `_updateAnnotUndoRedoBtns()` | `window._updateAnnotUndoRedoBtns` |
| L9279-L9291 | `undoPdfAnnotation()` | `window.undoPdfAnnotation` |
| L9292-L9304 | `redoPdfAnnotation()` | `window.redoPdfAnnotation` |
| L9305-L9312 | `_hexToRgb(hex)` | `window._hexToRgb` |
| L9313-L9341 | `_showAnnotNotePrompt(...)` | `window._showAnnotNotePrompt` |
| L9342-L9356 | `_snapAngle(x1, y1, x2, y2)` | `window._snapAngle` |
| L9357-L9586 | `_createAnnotElement(...)` | `window._createAnnotElement` |
| L9587-L9605 | `renderPdfAnnotsForPage(pageNum)` (async) | `window.renderPdfAnnotsForPage` |
| L9606-L9614 | `renderAllPdfAnnots()` (async) | `window.renderAllPdfAnnots` |
| L9615-L9705 | `startPdfAnnotDrag(...)` | `window.startPdfAnnotDrag` |
| L9659-L9705 | `_finalizePdfAnnotation(...)` (async) | `window._finalizePdfAnnotation` |
| L9706-L9738 | `removePdfAnnotation(annotId)` | `window.removePdfAnnotation` |
| L9739-L9924 | `exportPdfWithAnnotations()` (async) | `window.exportPdfWithAnnotations` |
| L9925-L9934 | `highlightPdfBlock(blockId)` | `window.highlightPdfBlock` |
| L9935-L9941 | `clearPdfBlockSelection()` | `window.clearPdfBlockSelection` |
| L9942-L9953 | `refreshPdfBlockSelectionVisual()` | `window.refreshPdfBlockSelectionVisual` |
| L9954-L9973 | `refreshPdfBoxSelectionVisual()` | `window.refreshPdfBoxSelectionVisual` |
| L9974-L9997 | `selectBlocksInRect(...)` | `window.selectBlocksInRect` |
| L9998-L10022 | `selectAnnotsInRect(...)` | `window.selectAnnotsInRect` |
| L10023-L10028 | `clearPdfAnnotMultiSelection()` | `window.clearPdfAnnotMultiSelection` |
| L10029-L10036 | `refreshPdfAnnotMultiSelectionVisual()` | `window.refreshPdfAnnotMultiSelectionVisual` |
| L10037-L10043 | `_getAnnotsByIds(ids)` | `window._getAnnotsByIds` |
| L10044-L10061 | `deleteSelectedAnnots()` | `window.deleteSelectedAnnots` |
| L10062-L10082 | `batchSetAnnotColor(color)` | `window.batchSetAnnotColor` |
| L10083-L10101 | `batchSetAnnotFontSize(size)` | `window.batchSetAnnotFontSize` |
| L10102-L10120 | `batchSetAnnotLineWidth(w)` | `window.batchSetAnnotLineWidth` |
| L10121-L10153 | `showAnnotMultiToolbar()` | `window.showAnnotMultiToolbar` |
| L10154-L10173 | `hideAnnotMultiToolbar()` | `window.hideAnnotMultiToolbar` |
| L10174-L10192 | `updatePdfSelectionInfo()` | `window.updatePdfSelectionInfo` |
| L10193-L10231 | `showPdfBlockContextMenu(...)` | `window.showPdfBlockContextMenu` |
| L10232-L10240 | `hidePdfBlockContextMenu()` | `window.hidePdfBlockContextMenu` |
| L10241-L10247 | `_findPdfAnnotationById(id)` | `window._findPdfAnnotationById` |
| L10248-L10259 | `_updatePdfAnnotation(...)` | `window._updatePdfAnnotation` |
| L10260-L10409 | `showPdfAnnotContextMenu(...)` | `window.showPdfAnnotContextMenu` |
| L10410-L10440 | `hidePdfAnnotContextMenu()` | `window.hidePdfAnnotContextMenu` |
| L9150 | `_PDF_ANNOT_STORAGE_PREFIX` (const) | 模块私有 |
| L10191 | `_pdfCtxMenu` | state.js已暴露 |
| L10239 | `_pdfAnnotCtxMenu` | state.js已暴露 |
| L9230 | 顶层 `document.addEventListener("keydown", ...)` | 在IIFE末尾执行 |
| L10160 | 顶层 `document.addEventListener("keydown", ...)` (Delete) | 在IIFE末尾执行 |
| L10417-L10431 | 顶层 contextmenu/mousedown/scroll/resize 绑定 | 在IIFE末尾执行 |

**新文件**：`src/scripts/modules/pdf-annotations.js`

**依赖**：`reader`、`core-utils`、`state`（`pdfViewState`）

**关键注意**：
- 🔴 **闭包绑定不可拆**：`startPdfAnnotDrag`（L9615-L9705）内部有document级mousemove/mouseup监听器，捕获 `annotDragging`/`annotDragStart`/`annotDragEnd` 等——整个函数体保持完整
- `_createAnnotElement` 是230行的大函数——函数体不拆分
- `exportPdfWithAnnotations` 是186行的async函数——函数体不拆分
- `showPdfAnnotContextMenu` 是150行的大函数——函数体不拆分
- 顶层键盘/鼠标绑定（L9230/L10160/L10417-L10431）引用本模块函数——必须在同一IIFE中
- `_PDF_ANNOT_STORAGE_PREFIX` 是const——模块私有，不暴露
- 5个被typeof守卫调用的函数中无本模块函数

**验收标准**：
- [ ] 高亮工具正常（选择高亮→拖选区域→生成高亮）
- [ ] 下划线工具正常
- [ ] 箭头工具正常
- [ ] 注释工具正常（添加文字注释）
- [ ] 标注拖拽移动正常
- [ ] 标注缩放正常（拖拽手柄）
- [ ] 撤销/重做正常
- [ ] 删除标注正常（Delete键/右键菜单）
- [ ] 框选多个标注正常
- [ ] 批量改色/字号/线宽正常
- [ ] 标注自动保存/恢复正常
- [ ] 导出带标注的PDF正常
- [ ] 右键菜单正常（标注右键/块右键）
- [ ] OCR隐藏/显示正常

**验证方法**：
1. 打开PDF→选择高亮工具→拖选区域→确认高亮生成
2. 选择箭头工具→画箭头→确认生成
3. 选择注释工具→点击→输入文字→确认注释生成
4. 拖拽标注→确认位置移动
5. 拖拽标注手柄→确认缩放
6. Ctrl+Z→确认撤销 / Ctrl+Y→确认重做
7. 选中标注→按Delete→确认删除
8. 框选多个标注→确认批量选中
9. 批量改色→确认颜色变化
10. 关闭阅读器→重新打开→确认标注恢复
11. 点击导出→确认PDF下载

**Commit**: `refactor: extract pdf-annotations.js from web-app.js (Step 5.3)`

---

#### Step 5.4：提取 `pdf-search-ocr.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L10441-L10489 | `searchPdfKeyword(keyword)` | `window.searchPdfKeyword` |
| L10490-L10508 | `searchPdfNext()` | `window.searchPdfNext` |
| L10509-L10524 | `searchPdfPrev()` | `window.searchPdfPrev` |
| L10525-L10535 | `updateSearchInfo()` | `window.updateSearchInfo` |
| L10536-L10685 | `ocrPdf(...)` (async) | `window.ocrPdf` |
| L10686-L10713 | `_buildBlockText(block)` | `window._buildBlockText` |
| L10714-L10807 | `_doTranslateBlocks(...)` (async) | `window._doTranslateBlocks` |
| L10808-L10863 | `translatePdfPage(pageNum)` (async) | `window.translatePdfPage` |
| L10864-L10924 | `translateSelectedBlocks()` (async) | `window.translateSelectedBlocks` |
| L10925-L10932 | `renderTranslateContent(...)` | `window.renderTranslateContent` |
| L10933-L10945 | `enterReadingMode()` | `window.enterReadingMode` |
| L10946-L10963 | `exitReadingMode()` | `window.exitReadingMode` |

**新文件**：`src/scripts/modules/pdf-search-ocr.js`

**依赖**：`reader`、`pdf-annotations`、`core-utils`、`state`（`pdfViewState`）

**验收标准**：
- [ ] PDF关键词搜索正常（输入→高亮匹配→上一个/下一个）
- [ ] OCR功能正常（选择引擎→执行→进度→结果）
- [ ] PDF页面翻译正常
- [ ] 选中文本块翻译正常
- [ ] 翻译面板内容渲染正常
- [ ] 阅读模式切换正常

**验证方法**：
1. 打开PDF→输入关键词→确认搜索匹配高亮
2. 点击上一个/下一个→确认跳转
3. 对PDF执行OCR→确认进度→确认结果
4. 翻译PDF页面→确认翻译结果显示
5. 选中PDF中的文本块→翻译→确认翻译结果
6. 切换阅读模式→确认显示变化

**Commit**: `refactor: extract pdf-search-ocr.js from web-app.js (Step 5.4)`

---

#### Step 5.5：提取 `extract-panel.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L10978-L11008 | `switchRightPanelTab(tab)` | `window.switchRightPanelTab` |
| L11009-L11048 | `updateExtractPanel(...)` | `window.updateExtractPanel` |
| L11049-L11071 | `navigateExtractPanelToBlock(...)` | `window.navigateExtractPanelToBlock` |
| L11072-L11113 | `syncExtractPanelToPdfPage()` | `window.syncExtractPanelToPdfPage` |
| L11114-L11143 | `showExtractContextMenu(...)` | `window.showExtractContextMenu` |
| L11144-L11172 | `hideExtractContextMenu()` | `window.hideExtractContextMenu` |
| L11173-L11187 | `openReaderForDoc(idx)` | `window.openReaderForDoc` |
| L11188-L11282 | `handleExtensionData(data)` | `window.handleExtensionData` |
| L11283-L11345 | `handleExtensionAnalyze(data)` | `window.handleExtensionAnalyze` |
| L11346-L11361 | `showNotification(...)` | `window.showNotification` |
| L11362-L11371 | `showDocumentContent(idx)` | `window.showDocumentContent` |
| L11112 | `_extractCtxMenu` | state.js已暴露 |
| L11152-L11169 | 顶层 contextmenu/mousedown/scroll 绑定 | 在IIFE末尾执行 |

**新文件**：`src/scripts/modules/extract-panel.js`

**依赖**：`reader`、`pdf-annotations`、`core-utils`、`state`（`currentData`/`_extractCtxMenu`）

**关键注意**：
- `handleExtensionData` 修改 `currentData`（L11246-11248）——通过window访问同一引用
- `showDocumentContent` 是425行的大函数——注意是否应该拆分到此模块
- 顶层绑定（L11152-L11169）引用 `_extractCtxMenu`——state.js已暴露

**验收标准**：
- [ ] 右侧面板标签切换正常
- [ ] 提取面板内容更新正常
- [ ] 提取面板跳转到PDF块正常
- [ ] PDF翻页→提取面板同步正常
- [ ] 右键菜单正常
- [ ] 浏览器扩展消息接收正常
- [ ] 通知显示正常

**验证方法**：
1. 打开阅读器→切换右侧面板标签→确认正常
2. 在PDF中点击一个文本块→确认提取面板跳转
3. 翻页→确认提取面板同步
4. 右键点击→确认菜单出现
5. 如有浏览器扩展→发送消息→确认接收

**Commit**: `refactor: extract extract-panel.js from web-app.js (Step 5.5)`

---

#### Step 5.6：提取 `export.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L11372-L11786 | `exportToWord(...)` (async, 415行) | `window.exportToWord` |
| L11362-L11371 | `showDocumentContent(idx)` → 如未在上步迁移 | `window.showDocumentContent` |

**新文件**：`src/scripts/modules/export.js`

**依赖**：`core-utils`、`documents`、`state`（`currentData`/`kanbanState`）

**关键注意**：
- `exportToWord` 是415行的大async函数——函数体不拆分
- 依赖第三方库 `docx`/`FileSaver`——已在web.html中加载

**验收标准**：
- [ ] 导出Word功能正常（点击导出→Word文件下载）
- [ ] 导出内容完整（标题/摘要/权利要求/说明书等）
- [ ] 导出格式正确（标题层级/加粗/列表等）

**验证方法**：
1. 搜索专利→点击导出Word→确认文件下载
2. 打开Word文件→确认内容完整
3. 检查格式→确认标题层级/加粗等正确

**Commit**: `refactor: extract export.js from web-app.js (Step 5.6)`

---

### Phase 6：提取交互层模块

---

#### Step 6.1：提取 `merge-export.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L13157-L13175 | `buildMergeDownloadUrl(...)` | `window.buildMergeDownloadUrl` |
| L13176-L13278 | `openMergeExportModal()` | `window.openMergeExportModal` |
| L13279-L13289 | `updateMergeSelectedCount()` | `window.updateMergeSelectedCount` |
| L13290-L13409 | `doMergeExportWithItems(...)` (async) | `window.doMergeExportWithItems` |
| L13410-L13494 | `doMergeExport()` (async) | `window.doMergeExport` |
| L13495-L13620 | `updateHistoryBatchCount()` | `window.updateHistoryBatchCount` |
| L13459-L13618 | 顶层历史侧栏/设置事件绑定 | 在IIFE末尾执行 |
| L13460-L13618 | 历史侧栏/设置DOM引用（约30个const） | 模块私有 |

**新文件**：`src/scripts/modules/merge-export.js`

**依赖**：`cache-history`、`export`、`core-utils`

**关键注意**：
- 30个DOM引用（L13460-L13618）在此模块中声明为模块私有
- 顶层事件绑定引用这些DOM变量——必须在同一IIFE中
- `updateHistoryBatchCount` 是126行的函数

**验收标准**：
- [ ] 合并导出模态框正常（打开/关闭）
- [ ] 选择专利→合并导出正常
- [ ] 历史批量选择正常
- [ ] 历史批量计数正常
- [ ] 历史侧栏折叠正常
- [ ] 历史搜索正常
- [ ] 清空历史/缓存正常
- [ ] GP代理设置保存正常
- [ ] 网络设置保存正常

**验证方法**：
1. 点击合并导出→确认模态框打开
2. 选择多个专利→确认导出
3. 点击历史批量选择→确认进入批量模式
4. 搜索历史→确认过滤正常
5. 折叠/展开历史侧栏→确认正常
6. 修改GP代理设置→保存→刷新→确认保持

**Commit**: `refactor: extract merge-export.js from web-app.js (Step 6.1)`

---

#### Step 6.2：提取 `ops-settings.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L13621-L13633 | `loadOpsSettingsToForm()` | `window.loadOpsSettingsToForm` |
| L13634-L13831 | `refreshOpsQuota()` (async) | `window.refreshOpsQuota` |
| L13739 | `setInterval`（20分钟刷新OPS配额） | 在IIFE末尾执行 |

**新文件**：`src/scripts/modules/ops-settings.js`

**依赖**：`patent-office`（`getOpsSettings`）、`core-utils`

**关键注意**：
- `setInterval`（L13739）引用 `getOpsSettings`（patent-office模块）和 `refreshOpsQuota`（本模块）——确保在IIFE末尾启动
- `loadOpsSettingsToForm` 被 DOMContentLoaded 回调调用——通过window可访问
- `refreshOpsQuota` 是198行的async函数

**验收标准**：
- [ ] OPS设置加载到表单正常
- [ ] OPS配额显示正常
- [ ] OPS配额自动刷新正常（20分钟）
- [ ] OPS测试连接正常

**验证方法**：
1. 打开设置→确认OPS配置加载
2. 查看OPS配额→确认显示
3. 等待20分钟+→确认配额自动刷新（或手动刷新）
4. 点击OPS测试→确认测试结果

**Commit**: `refactor: extract ops-settings.js from web-app.js (Step 6.2)`

---

#### Step 6.3：提取 `batch-search.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L13832-L13864 | `fetchPatentWithRetry(...)` (async) | `window.fetchPatentWithRetry` |
| L13865-L13979 | `_delay(ms)` + 批量查询逻辑 | `window._delay` |
| L13980-L14028 | `_updateBatchCardDone(...)` | `window._updateBatchCardDone` |
| L14029-L14046 | `_updateBatchCardError(...)` | `window._updateBatchCardError` |
| L14047-L14071 | `_retryBatchCard(pn)` (async) | `window._retryBatchCard` |
| L14072-L14078 | `_returnToBatchResults()` | `window._returnToBatchResults` |
| L13758-L13811 | 批量查询DOM引用 | 模块私有 |
| L13777-L13869 | 顶层批量查询事件绑定 | 在IIFE末尾执行 |

**新文件**：`src/scripts/modules/batch-search.js`

**依赖**：`ops-settings`、`patent-detail`、`search`（`gdFetch`）、`core-utils`

**关键注意**：
- `_retryBatchCard` 被onclick字符串引用——必须通过window暴露
- `_updateBatchCardError` 中设置 `card.onclick = null`——正常
- 批量查询DOM引用（L13758-L13811）在此模块中声明为模块私有

**验收标准**：
- [ ] 批量查询面板打开/关闭正常
- [ ] 输入多个专利号→批量查询正常
- [ ] 查询进度显示正常
- [ ] 查询结果卡片正常
- [ ] 重试失败专利正常
- [ ] 返回搜索结果正常

**验证方法**：
1. 点击批量查询→确认面板打开
2. 输入多个专利号→点击查询→确认进度
3. 等待查询完成→确认结果卡片显示
4. 对失败的专利点击重试→确认重新查询
5. 点击返回→确认回到搜索结果

**Commit**: `refactor: extract batch-search.js from web-app.js (Step 6.3)`

---

#### Step 6.4：提取 `pd-tabs-find.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L14079-L14123 | `_renderPdTabs()` | `window._renderPdTabs` |
| L14124-L14139 | `_switchPdTab(key)` | `window._switchPdTab` |
| L14140-L14176 | `_closePdTab(key)` | `window._closePdTab` |
| L14177-L14314 | `_openPdPatent(pn)` | `window._openPdPatent` |
| L14315-L14337 | `_injectFindButton()` | `window._injectFindButton` |
| L14338-L14356 | `togglePdFindBar()` | `window.togglePdFindBar` |
| L14357-L14369 | `_clearFindHighlights()` | `window._clearFindHighlights` |
| L14370-L14441 | `_doFind(keyword)` | `window._doFind` |
| L14442-L14452 | `_updateFindCount(...)` | `window._updateFindCount` |
| L14453-L14475 | `_scrollToCurrentMatch()` | `window._scrollToCurrentMatch` |
| L14476-L14482 | `_findPrev()` | `window._findPrev` |
| L14483-L14506 | `_findNext()` | `window._findNext` |
| L13751-L13755 | `_pdOpenPatents`/`_pdActivePatent`/`_pdPatentCache`/`_pdBatchMode`/`_pdBatchController` | state.js已暴露 |
| L13769-L13774 | `pdFindBar`等DOM引用 | 模块私有 |
| L14313-L14336 | `_obsConfig`/`_findBtnInjected`/`_pdObserver`/`_pdFindMatches`/`_pdFindCurrentIdx`/`_pdFindOriginalHTML` | state.js已暴露 |
| L14328 | `_pdObserver.observe(...)` | 在IIFE末尾执行 |
| L14507-L14511 | 顶层查找按钮绑定+Ctrl+F监听 | 在IIFE末尾执行 |

**新文件**：`src/scripts/modules/pd-tabs-find.js`

**依赖**：`core-utils`、`state`、`search`（`gdFetch`）、`patent-detail`（`renderPatentDetail`）

**关键注意**：
- 🔴 **MutationObserver隐式依赖链**：`_pdObserver`→`_injectFindButton`→`togglePdFindBar`→`_clearFindHighlights`/`_doFind`→`pdFindInput`——全部在本模块中，安全
- `_openPdPatent` 被onclick字符串引用——必须通过window暴露
- `_openPdPatent` 修改 `searchMode`（L14199）——通过window访问
- `_renderPdTabs`/`_switchPdTab`/`_closePdTab` 有循环依赖（事件回调）——同一模块内，安全
- `pdFindBar`/`pdFindInput` 等DOM引用在此模块中声明为模块私有

**验收标准**：
- [ ] 专利详情标签页正常（打开/切换/关闭）
- [ ] 页内查找按钮注入正常
- [ ] Ctrl+F→查找栏打开
- [ ] 输入关键词→高亮匹配
- [ ] 上一个/下一个跳转正常
- [ ] 关闭查找栏→清除高亮

**验证方法**：
1. 在批量查询结果中点击一个专利→确认详情标签页打开
2. 打开多个标签→切换→确认正常
3. 关闭标签→确认正常
4. 打开一个专利详情→确认查找按钮被注入
5. 按Ctrl+F→确认查找栏打开
6. 输入关键词→确认高亮
7. 点击上一个/下一个→确认跳转
8. 关闭查找栏→确认高亮清除

**Commit**: `refactor: extract pd-tabs-find.js from web-app.js (Step 6.4)`

---

#### Step 6.5：提取 `extract-mode.js`

**迁移内容**：

| 行号 | 函数 | 暴露方式 |
|------|------|----------|
| L14558-L14563 | `loadExtractTemplates()` | `window.loadExtractTemplates` |
| L14564-L14567 | `saveExtractTemplates()` | `window.saveExtractTemplates` |
| L14568-L14650 | `initExtractMode()` | `window.initExtractMode` |
| L14651-L14730 | `seedGroupsFromCache()` | `window.seedGroupsFromCache` |
| L14731-L14737 | `showExtractStep(step)` | `window.showExtractStep` |
| L14738-L14832 | `fetchAndAddPatent(pn)` (async) | `window.fetchAndAddPatent` |
| L14833-L14905 | `refreshExtractGroup(...)` (async) | `window.refreshExtractGroup` |
| L14906-L14915 | `removeExtractGroup(...)` | `window.removeExtractGroup` |
| L14916-L15152 | `renderExtractDocList()` | `window.renderExtractDocList` |
| L15153-L15173 | `updateExtractDocCount()` | `window.updateExtractDocCount` |
| L15174-L15273 | `_syncExtractOcrToCache(...)` | `window._syncExtractOcrToCache` |
| L15274-L15323 | `runExtractOcr(...)` (async) | `window.runExtractOcr` |
| L15324-L15325 | `_extractFieldId(...)` | `window._extractFieldId` |
| L15326-L15335 | `addExtractField()` | `window.addExtractField` |
| L15336-L15366 | `renderExtractFieldList()` | `window.renderExtractFieldList` |
| L15367-L15377 | `renderExtractTemplateSelect()` | `window.renderExtractTemplateSelect` |
| L15378-L15386 | `saveExtractTemplate()` | `window.saveExtractTemplate` |
| L15387-L15396 | `deleteExtractTemplate(...)` | `window.deleteExtractTemplate` |
| L15397-L15405 | `loadExtractTemplate(...)` | `window.loadExtractTemplate` |
| L15406-L15525 | `getSelectedExtractDocPairs()` | `window.getSelectedExtractDocPairs` |
| L15526-L15541 | `findBlockByEvidence(...)` | `window.findBlockByEvidence` |
| L15542-L15625 | `renderExtractResults(...)` | `window.renderExtractResults` |
| L15626-L15631 | `confirmAllExtracts()` | `window.confirmAllExtracts` |
| L15632-L15641 | `restartExtract()` | `window.restartExtract` |
| L15642-L15684 | `openExtractDocAndJump(...)` (async) | `window.openExtractDocAndJump` |
| L15685-L15709 | `exportExtractExcel()` | `window.exportExtractExcel` |
| L14547-L14556 | `_extractState`/`EXTRACT_TEMPLATES_KEY` | 模块私有/state.js |

**新文件**：`src/scripts/modules/extract-mode.js`

**依赖**：`reader`、`pdf-annotations`、`pdf-search-ocr`（`ocrPdf`）、`core-utils`、`state`（`searchMode`/`currentData`/`kanbanState`）

**关键注意**：
- `fetchAndAddPatent` 被 DOMContentLoaded 中的 `typeof` 守卫调用——必须通过window暴露
- `renderExtractDocList` 是枢纽函数（被调用19次）
- `initExtractMode` 修改 `searchMode`（L14586）——通过window访问
- `openExtractDocAndJump` 修改 `searchMode`（L15645）——同上
- `_extractState` 是const对象——模块私有
- `EXTRACT_TEMPLATES_KEY` 是const字符串——模块私有

**验收标准**：
- [ ] 智能抽取模式入口正常
- [ ] 添加专利到抽取列表正常
- [ ] 文档列表渲染正常
- [ ] OCR识别正常
- [ ] 字段管理正常（添加/删除/编辑）
- [ ] 模板保存/加载/删除正常
- [ ] 抽取结果渲染正常
- [ ] 跳转到原文位置正常
- [ ] 确认所有抽取正常
- [ ] 重新开始正常
- [ ] 导出Excel正常

**验证方法**：
1. 进入智能抽取模式→确认界面正常
2. 添加专利→确认列表更新
3. 运行OCR→确认进度→确认结果
4. 添加字段→确认字段列表更新
5. 保存模板→加载模板→确认正常
6. 执行抽取→确认结果渲染
7. 点击结果中的证据→确认跳转到原文
8. 确认所有抽取→确认状态更新
9. 导出Excel→确认文件下载

**Commit**: `refactor: extract extract-mode.js from web-app.js (Step 6.5)`

---

### Phase 7：提取初始化与收尾

---

#### Step 7.1：提取 `app-init.js`（DOMContentLoaded主初始化块）

**迁移内容**：

| 行号范围 | 内容 | 暴露方式 |
|----------|------|----------|
| L11787-L12588 | `DOMContentLoaded` 回调（802行） | IIFE内执行 |
| L14532 | 顶层调用 `refreshHistoryList()` | 在IIFE末尾执行 |
| L14535 | 顶层调用 `updateFloatingBallsVisibility()` | 在IIFE末尾执行 |
| L14538-L14541 | 兜底 `setTimeout`（8秒移除启动画面） | 在IIFE末尾执行 |
| L12581 | `setTimeout`（4500ms移除启动画面，在DOMContentLoaded内） | 随DOMContentLoaded一起迁移 |

**新文件**：`src/scripts/modules/app-init.js`

**依赖**：**所有模块**（通过window访问所有函数）

**关键注意**：
- 这是最大的一步——802行的DOMContentLoaded回调包含100+个事件绑定
- 🔴 **所有被引用的函数必须已在前面的步骤中通过window暴露**
- 🔴 **所有被引用的DOM元素必须在DOMContentLoaded执行时已存在**——由于script在body末尾，安全
- DOMContentLoaded回调中的事件绑定按原始顺序保留
- 如果某些函数仍在web-app.js中（未迁移），通过window也能访问——因为web-app.js中的函数声明在全局作用域

**操作步骤**：
1. 将 L11787-L12588 的 `document.addEventListener("DOMContentLoaded", () => {...})` 整体复制到 app-init.js
2. 将 L14532/L14535 的顶层调用也复制到 app-init.js 的IIFE末尾
3. 将 L14538-L14541 的兜底setTimeout也复制
4. 从 web-app.js 中删除上述代码
5. 在 web.html 中将 app-init.js 放在 web-app.js 之前

**验收标准**：
- [ ] 页面加载后所有功能正常
- [ ] 启动画面正常消失（4.5秒或8秒兜底）
- [ ] 主题切换正常
- [ ] 阅读器模态框所有按钮正常
- [ ] PDF工具栏所有按钮正常
- [ ] 标注工具栏所有按钮正常
- [ ] 聊天面板所有按钮正常
- [ ] 合并导出所有按钮正常
- [ ] 历史侧栏所有按钮正常
- [ ] 批量查询面板所有按钮正常

**验证方法**：
1. 刷新页面→确认启动画面出现→4.5秒后消失
2. 逐一点击页面上的每个按钮→确认功能正常
3. 打开阅读器→逐一测试PDF工具栏按钮
4. 测试标注工具栏→逐一测试每个工具
5. 打开聊天→测试发送/导出/中止
6. 打开合并导出→测试选择/导出
7. 测试历史侧栏→折叠/搜索/清空
8. 测试批量查询→面板切换

**Commit**: `refactor: extract app-init.js from web-app.js (Step 7.1)`

---

#### Step 7.2：清理 web-app.js 残余代码

**操作**：
1. 检查 web-app.js 中剩余的代码——应该只有极少量未被迁移的代码（可能是某些遗漏的函数或变量）
2. 将残余代码分配到最相关的模块中
3. 如果 web-app.js 为空或只剩注释→删除 web-app.js 的 `<script>` 标签
4. 更新版本号

**验收标准**：
- [ ] web-app.js 文件行数 < 100行（或已删除）
- [ ] 页面功能完全正常
- [ ] 控制台无任何错误
- [ ] 所有模块加载顺序正确

**Commit**: `refactor: cleanup remaining code in web-app.js (Step 7.2)`

---

#### Step 7.3：统一版本号

**操作**：
1. 将 web.html 中所有 `?v=260710` 更新为 `?v=260712`
2. 将 `?v=20260623c` 更新为 `?v=260712`（第三方库版本号统一）
3. 将 `?v=260716`（Agent模块）保持不变或统一为 `?v=260712`
4. 更新 HTML 注释中的 `@version`
5. 更新页脚版本号

**Commit**: `chore: unify version numbers (Step 7.3)`

---

## 四、每步通用操作流程

每个Step的执行流程如下：

```
1. 【创建新模块文件】
   └─ 创建 src/scripts/modules/module-name.js
   └─ 写入 IIFE 包裹结构
   └─ 从 web-app.js 中【复制】目标代码到新文件
   └─ 在 IIFE 末尾添加 window.xxx = xxx 暴露语句
   └─ 在 IIFE 末尾添加顶层事件绑定/调用（如有）

2. 【添加 script 标签】
   └─ 在 web.html 的模块区域添加 <script src="scripts/modules/module-name.js?v=260712"></script>
   └─ 确保放在依赖模块之后、web-app.js 之前

3. 【从 web-app.js 删除已迁移代码】
   └─ 删除已迁移的函数定义
   └─ 删除已迁移的变量声明
   └─ 删除已迁移的顶层代码

4. 【验证】
   └─ 刷新页面
   └─ 检查控制台无错误
   └─ 执行该步的验收标准中的验证方法
   └─ 如有问题→修复→重新验证

5. 【提交】
   └─ git add 相关文件
   └─ git commit -m "refactor: extract module-name from web-app.js (Step N.N)"
```

---

## 五、完整验收清单

### 5.1 最终全功能验收清单（所有步骤完成后）

#### 基础功能
- [ ] 页面加载无JS控制台错误
- [ ] 页面加载无CSS样式错误
- [ ] 启动画面正常消失
- [ ] 所有SVG图标正常显示
- [ ] 页面主题正常

#### 搜索功能
- [ ] 输入专利号→局名badge实时更新
- [ ] 回车/点击搜索按钮→搜索正常
- [ ] 各种格式专利号识别正常（US/EP/JP/CN/WO/KR等）
- [ ] 搜索错误→错误提示弹出
- [ ] 搜索结果缓存正常

#### Dossier多标签
- [ ] 搜索→自动创建新标签
- [ ] 切换标签→所有面板正确恢复
- [ ] 关闭有未保存工作的标签→弹出确认
- [ ] 超过3个标签→驱逐逻辑正常
- [ ] 关闭有PDF标注的标签→标注清理

#### 专利详情
- [ ] 详情页正确渲染（标题/摘要/权利要求/说明书）
- [ ] 专利号链接→webview弹窗
- [ ] 外部链接（Google Patents/J-PlatPat/CN查询）
- [ ] 标签页切换正常
- [ ] 复制功能正常
- [ ] 图片查看器正常
- [ ] 专利号链接化正常
- [ ] 悬浮球可见性正确

#### 专利弹窗（PPV）
- [ ] 悬停专利号→弹窗出现
- [ ] 弹窗中切换专利标签
- [ ] 关闭弹窗标签
- [ ] 弹窗缓存正常

#### 翻译功能
- [ ] 段落翻译正常
- [ ] 划词翻译弹窗正常
- [ ] 整页Google翻译正常
- [ ] 右键上下文菜单正常
- [ ] 权利要求按条翻译正常
- [ ] 翻译中止正常

#### 缓存与历史
- [ ] 历史列表正常显示
- [ ] 点击历史项→恢复详情
- [ ] 缓存保存/恢复正常
- [ ] 关闭页面→未保存提示
- [ ] 页面可见性切换→自动保存
- [ ] 清空历史/缓存正常

#### Kanban看板
- [ ] 看板正确渲染
- [ ] 文档卡片拖拽正常
- [ ] 文档文本提取正常
- [ ] AI文档分析正常
- [ ] 文档下载正常
- [ ] 批量提取正常

#### AI分析
- [ ] 引用文献分析正常（思考过程→结果）
- [ ] 手动选择面板正常
- [ ] Markdown渲染正常
- [ ] 溯源跳转正常
- [ ] 模块重生正常
- [ ] 中止分析正常
- [ ] 时间线摘要正常

#### PatentAsk问一问
- [ ] 悬浮窗打开/关闭正常
- [ ] 发送问题→AI流式回复
- [ ] 悬浮窗拖拽正常
- [ ] 悬浮窗缩放正常
- [ ] 清空对话正常
- [ ] 缓存功能正常

#### 阅读器
- [ ] 打开/关闭阅读器正常
- [ ] 选择文档→内容显示
- [ ] 文本/PDF模式切换
- [ ] PDF翻页/缩放
- [ ] 快速切换文档→无旧页面闪现
- [ ] OCR进度显示
- [ ] 时间线渲染

#### PDF目录与工具栏
- [ ] PDF目录显示
- [ ] 点击目录项→跳转
- [ ] 滚动→目录高亮
- [ ] 页码输入→跳转
- [ ] 缩放按钮正常

#### PDF标注
- [ ] 高亮工具正常
- [ ] 下划线工具正常
- [ ] 箭头工具正常
- [ ] 注释工具正常
- [ ] 标注拖拽移动
- [ ] 标注缩放
- [ ] 撤销/重做
- [ ] 删除标注（Delete/右键）
- [ ] 框选多个标注
- [ ] 批量改色/字号/线宽
- [ ] 标注自动保存/恢复
- [ ] 导出带标注PDF
- [ ] 右键菜单正常
- [ ] OCR隐藏/显示

#### PDF搜索与翻译
- [ ] 关键词搜索→高亮匹配
- [ ] 上一个/下一个跳转
- [ ] OCR功能正常
- [ ] PDF页面翻译
- [ ] 选中块翻译
- [ ] 阅读模式切换

#### 聊天功能
- [ ] 阅读器聊天正常
- [ ] 分析聊天浮球正常
- [ ] AI流式回复正常
- [ ] 中止回复正常
- [ ] 导出聊天记录
- [ ] 模型切换正常
- [ ] AI回复期间切换文档→不串数据

#### 导出功能
- [ ] 导出Word正常
- [ ] 导出内容完整
- [ ] 合并导出正常
- [ ] 导出Excel正常

#### 批量查询
- [ ] 批量查询面板正常
- [ ] 批量查询执行正常
- [ ] 查询进度显示
- [ ] 重试失败专利
- [ ] 返回搜索结果

#### 专利详情标签与查找
- [ ] 标签页打开/切换/关闭正常
- [ ] 查找按钮注入正常
- [ ] Ctrl+F→查找栏打开
- [ ] 关键词高亮正常
- [ ] 上一个/下一个跳转
- [ ] 关闭查找栏→清除高亮

#### 智能抽取
- [ ] 抽取模式入口正常
- [ ] 添加专利正常
- [ ] 文档列表渲染正常
- [ ] OCR识别正常
- [ ] 字段管理正常
- [ ] 模板保存/加载/删除正常
- [ ] 抽取结果渲染正常
- [ ] 跳转到原文正常
- [ ] 导出Excel正常

#### 设置
- [ ] AI设置保存/读取正常
- [ ] AI测试连接正常
- [ ] OCR引擎切换正常
- [ ] 翻译提供商切换正常
- [ ] OPS设置保存/读取正常
- [ ] OPS配额显示/刷新正常
- [ ] GP代理设置正常
- [ ] 网络设置正常

#### 浏览器扩展
- [ ] 扩展消息接收正常
- [ ] 扩展数据分析正常

#### 延迟验证
- [ ] 等待30秒+→控制台无setInterval错误
- [ ] 等待20分钟+→OPS配额自动刷新无错误

### 5.2 性能验收

- [ ] 页面首次加载时间无明显增加（模块化后多了HTTP请求，但文件总大小不变）
- [ ] 搜索响应时间正常
- [ ] PDF渲染速度正常
- [ ] AI回复速度正常
- [ ] 无明显的脚本加载阻塞

### 5.3 代码质量验收

- [ ] web-app.js 行数 < 100 或已删除
- [ ] 每个模块文件行数 < 1500
- [ ] 每个模块文件函数数 < 40
- [ ] 无循环依赖问题
- [ ] 无未暴露的跨模块引用
- [ ] 控制台无任何警告/错误

---

## 六、回滚策略

### 6.1 单步回滚

如果某一步验证失败且无法快速修复：

```bash
# 回滚到上一步
git revert HEAD

# 或直接恢复文件
git checkout HEAD~1 -- src/scripts/web-app.js src/web.html
# 然后删除失败的新模块文件
rm src/scripts/modules/failed-module.js
```

### 6.2 完全回滚

如果整体拆解方案不可行，需要完全回到拆解前：

```bash
# 找到拆解前的commit
git log --oneline --grep="Step 0.1"

# 回滚到该commit之前
git reset --hard <commit-before-step-0.1>

# 或创建回滚分支
git checkout -b rollback-pre-refactor <commit-before-step-0.1>
```

### 6.3 部分保留

如果某些模块拆解成功但某些失败：

```bash
# 保留成功的模块，回滚失败的
# 1. 确认成功的模块的script标签在web.html中
# 2. 将失败模块的代码从web-app.js中恢复
# 3. 删除失败的模块文件
# 4. 提交
```

### 6.4 紧急切换

如果线上出问题需要紧急切换回原版：

```bash
# 方案A：回滚web.html（最快的紧急方案）
# 将web.html中的模块script标签注释掉
# 恢复 web-app.js?v=260710 的完整版本

# 方案B：git回滚
git checkout <stable-commit> -- src/
```

---

## 七、模块函数归属总表

以下是全部296个函数与28个模块的归属关系，按模块排列：

| 模块 | 函数列表 | 函数数 | 行数(约) |
|------|---------|--------|---------|
| `constants.js` | `icon` | 1 | 60 |
| `core-utils.js` | `abortActiveProcess`, `showError`, `showToast`, `hideError`, `copyToClipboard`, `_fallbackCopy`, `copyTextToClipboard`, `timeAgo`, `escapeHtml`, `parseDate`, `parseDocDateToTimestamp`, `getManualSelectKey`, `saveManualSelection`, `loadManualSelection` | 14 | 200 |
| `state.js` | (无函数，仅变量) | 0 | 120 |
| `patent-links.js` | `getGpProxySettings`, `saveGpProxySettings`, `gpApiUrl`, `isJPPatent`, `parseJPPatentNo`, `jplatpatDocUrl`, `jplatpatSimpleSearchUrl`, `jplatpatSearchNumber`, `openJPlatPat`, `isCNPatent`, `cnQueryUrl`, `openCNQuery`, `patentLinkButtons` | 13 | 150 |
| `patent-parser.js` | `detectOffice`, `parsePatentNumber`, `mapJpDocType` | 3 | 90 |
| `patent-office.js` | `getOpsSettings`, `tauriInvoke` | 2 | 100 |
| `dossier-tabs.js` | `_dossierMakeKey`, `_dossierCaptureState`, `_dossierSaveActiveTab`, `_dossierApplyTab`, `_dossierRenderTabs`, `_dossierSwitchTo`, `_dossierGetTabAnnotSummary`, `_dossierCloseTab`, `_dossierCleanupTabPdfAnnots`, `_dossierFindVictimTab`, `_dossierConfirmEvict`, `_dossierEvictTab`, `_dossierCreateEmptyTab`, `_dossierPrepareTab`, `_dossierNewTabFromSearch`, `_dossierRegisterCurrentTab` | 16 | 450 |
| `search.js` | `gdFetch`, `doSearch`, `searchPatentDetail` | 3 | 650 |
| `cache-history.js` | `PatentCache`, `GPCache`, `showCacheConfirmDialog`, `promptSaveCache`, `autoSaveCache`, `refreshHistoryList`, `restoreFromCache`, `restoreFromHistory`, `doRestoreFromHistory`, `doRestoreFromCache` | 10 | 450 |
| `render-engine.js` | `renderKanban`, `renderOverview`, `countFamilyMembers`, `countDocuments`, `renderFamily`, `extractFamilyMembers`, `renderDescriptionHtml` | 7 | 520 |
| `patent-detail.js` | `closeInAppWebview`, `showDataSourceBadge`, `renderPatentDetail`, `switchPatentTab`, `_handleCopyCitationNums`, `_makeCopyNumsBtn`, `copyPatentSectionText`, `openPatentImageViewer`, `linkifyPatentNumbers`, `prefetchPatentLinks`, `clearPrefetchCache`, `openInAppWebview`, `updateFloatingBallsVisibility` | 13 | 450 |
| `patent-popup.js` | `_bindPpvContentEvents`, `_renderPpvPatentTabs`, `renderPatentPopupContent`, `openPatentPopup`, `switchPpvPatent`, `closePpvPatentTab`, `closePatentPopup`, `showPatentPopup` | 8 | 540 |
| `translation.js` | `switchPpvTab`, `translatePatentSection`, `showPatentDetailContextMenu`, `hidePatentDetailContextMenu`, `googleTranslateText`, `openInGoogleTranslate`, `showFloatingTranslationPopup`, `showFloatingTranslation`, `translateSelectedPatentText`, `translateClaimByIndex`, `toggleGoogleTranslate` | 11 | 540 |
| `ai-settings.js` | `getChatProvider`, `populateModelDatalist`, `populateChatProviderSelect`, `exportChatToWord`, `updateTranslateModelOptions`, `loadAISettingsToForm`, `toggleOcrGlmKeyVisibility`, `updateModelOptions`, `showTestResult` | 9 | 410 |
| `patent-ask.js` | `_getPatentDataSource`, `_buildClaimsText`, `runPatentInterpretation`, `_patentAskCacheKey`, `_savePatentAskCache`, `_loadPatentAskCache`, `_renderPatentAskMessages`, `openPatentAsk`, `closePatentAsk`, `clearPatentAsk`, `_buildPatentAskContext`, `_appendPatentAskMessage`, `sendPatentAsk`, `_initPatentAskBindings` | 14 | 500 |
| `ai-analysis.js` | `doExtractText`, `buildTimelineSummary`, `runCitedRefsAnalysis`, `_createThinkingHost`, `renderAiProgressUI`, `buildReviewManualSelectPanel`, `renderMarkdown`, `renderMarkdownWithTrace`, `cleanModuleHeading`, `parseAnalysisModules`, `renderAnalysisModules`, `extractModuleText`, `replaceModuleText`, `regenerateAnalysisModule`, `showModuleRegenPopup`, `_jumpToPatentTrace`, `_highlightElement`, `onTraceClick` | 18 | 900 |
| `documents.js` | `renderDocuments`, `extractDocumentText`, `aiAnalyzeDocument`, `downloadDocument`, `extractDocuments` | 5 | 350 |
| `chat.js` | `refreshAllChatProviderSelects`, `sendChatMessage`, `appendChatMessage`, `showAnalysisChatToggle`, `appendAnalysisChatMessage`, `sendAnalysisChatMessage` | 6 | 570 |
| `reader.js` | `openReader`, `selectReaderDoc`, `selectReaderAnalysis`, `togglePdfView`, `showOcrProgressOverlay`, `hideOcrProgressOverlay`, `restoreOcrProgressForDoc`, `renderPdfView`, `renderAllPdfPages`, `rerenderPdfPages`, `renderTimeline` | 11 | 1000 |
| `pdf-toc.js` | `buildPdfToc`, `jumpToTocItem`, `setActiveTocItem`, `updateActiveTocByScroll`, `installPdfTocScrollTracker`, `updatePdfToolbar`, `pdfGoToPage`, `pdfZoomInAction`, `pdfZoomOutAction`, `pdfZoomFitAction` | 10 | 200 |
| `pdf-annotations.js` | `_buildPdfDocKey`, `_getCurrentPdfAnnotKey`, `loadPdfAnnotations`, `savePdfAnnotations`, `_hasAnyPdfAnnotations`, `_getUnsavedAnnotsSummary`, `_updateAnnotCloseFlag`, `setPdfAnnotTool`, `togglePdfOcrHide`, `_pushAnnotUndo`, `_updateAnnotUndoRedoBtns`, `undoPdfAnnotation`, `redoPdfAnnotation`, `_hexToRgb`, `_showAnnotNotePrompt`, `_snapAngle`, `_createAnnotElement`, `renderPdfAnnotsForPage`, `renderAllPdfAnnots`, `startPdfAnnotDrag`, `_finalizePdfAnnotation`, `removePdfAnnotation`, `exportPdfWithAnnotations`, `highlightPdfBlock`, `clearPdfBlockSelection`, `refreshPdfBlockSelectionVisual`, `refreshPdfBoxSelectionVisual`, `selectBlocksInRect`, `selectAnnotsInRect`, `clearPdfAnnotMultiSelection`, `refreshPdfAnnotMultiSelectionVisual`, `_getAnnotsByIds`, `deleteSelectedAnnots`, `batchSetAnnotColor`, `batchSetAnnotFontSize`, `batchSetAnnotLineWidth`, `showAnnotMultiToolbar`, `hideAnnotMultiToolbar`, `updatePdfSelectionInfo`, `showPdfBlockContextMenu`, `hidePdfBlockContextMenu`, `_findPdfAnnotationById`, `_updatePdfAnnotation`, `showPdfAnnotContextMenu`, `hidePdfAnnotContextMenu` | 45 | 1300 |
| `pdf-search-ocr.js` | `searchPdfKeyword`, `searchPdfNext`, `searchPdfPrev`, `updateSearchInfo`, `ocrPdf`, `_buildBlockText`, `_doTranslateBlocks`, `translatePdfPage`, `translateSelectedBlocks`, `renderTranslateContent`, `enterReadingMode`, `exitReadingMode` | 12 | 490 |
| `extract-panel.js` | `switchRightPanelTab`, `updateExtractPanel`, `navigateExtractPanelToBlock`, `syncExtractPanelToPdfPage`, `showExtractContextMenu`, `hideExtractContextMenu`, `openReaderForDoc`, `handleExtensionData`, `handleExtensionAnalyze`, `showNotification`, `showDocumentContent` | 11 | 440 |
| `export.js` | `exportToWord` | 1 | 420 |
| `merge-export.js` | `buildMergeDownloadUrl`, `openMergeExportModal`, `updateMergeSelectedCount`, `doMergeExportWithItems`, `doMergeExport`, `updateHistoryBatchCount` | 6 | 470 |
| `ops-settings.js` | `loadOpsSettingsToForm`, `refreshOpsQuota` | 2 | 220 |
| `batch-search.js` | `fetchPatentWithRetry`, `_delay`, `_updateBatchCardDone`, `_updateBatchCardError`, `_retryBatchCard`, `_returnToBatchResults` | 6 | 340 |
| `pd-tabs-find.js` | `_renderPdTabs`, `_switchPdTab`, `_closePdTab`, `_openPdPatent`, `_injectFindButton`, `togglePdFindBar`, `_clearFindHighlights`, `_doFind`, `_updateFindCount`, `_scrollToCurrentMatch`, `_findPrev`, `_findNext` | 12 | 430 |
| `extract-mode.js` | `loadExtractTemplates`, `saveExtractTemplates`, `initExtractMode`, `seedGroupsFromCache`, `showExtractStep`, `fetchAndAddPatent`, `refreshExtractGroup`, `removeExtractGroup`, `renderExtractDocList`, `updateExtractDocCount`, `_syncExtractOcrToCache`, `runExtractOcr`, `_extractFieldId`, `addExtractField`, `renderExtractFieldList`, `renderExtractTemplateSelect`, `saveExtractTemplate`, `deleteExtractTemplate`, `loadExtractTemplate`, `getSelectedExtractDocPairs`, `findBlockByEvidence`, `renderExtractResults`, `confirmAllExtracts`, `restartExtract`, `openExtractDocAndJump`, `exportExtractExcel` | 26 | 1160 |
| `app-init.js` | (无函数，仅DOMContentLoaded回调) | 0 | 810 |
| **合计** | | **296** | **~13,200** |
