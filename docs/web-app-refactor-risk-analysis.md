# web-app.js 拆解完整风险注意事项

> **历史文档提示（2026-07-31）：** 本文基于 2026-07-12 的 15,709 行版本，行号、统计和部分架构判断已经过期，且仍包含 Tauri 双端假设。不得直接按本文行号执行拆分。当前盘点与执行依据请使用 [`web-app-refactor-plan-2026-07-31.md`](web-app-refactor-plan-2026-07-31.md)。

> 基于对 `src/scripts/web-app.js`（15,709行、253个函数、48个全局let变量）的深度代码分析  
> 生成日期：2026-07-12

---

## 目录

- [一、风险等级总览](#一风险等级总览)
- [二、致命风险（7类）](#二致命风险7类必须正确处理)
  - [致命风险 1：函数声明提升（hoisting）消失](#致命风险-1函数声明提升hoisting消失)
  - [致命风险 2：全局变量在IIFE中变为局部变量](#致命风险-2全局变量在iife中变为局部变量)
  - [致命风险 3：顶层 getElementById 执行时机](#致命风险-3顶层-getelementbyid-执行时机)
  - [致命风险 4：顶层裸 addEventListener 执行时机](#致命风险-4顶层裸-addeventlistener-执行时机)
  - [致命风险 5：闭包绑定不可拆分](#致命风险-5闭包绑定不可拆分)
  - [致命风险 6：DOMContentLoaded 巨型初始化块](#致命风险-6domcontentloaded-内的巨型初始化块)
  - [致命风险 7：动态HTML中onclick字符串引用](#致命风险-7动态生成的html中的-onclick-字符串引用)
- [三、高危风险（9类）](#三高危风险9类需特殊处理)
- [四、中危风险（6类）](#四中危风险6类)
- [五、低危风险（3类）](#五低危风险3类)
- [六、拆解操作红线清单](#六拆解操作红线清单)
- [七、拆解后验证清单](#七拆解后验证清单)
- [附录：完整数据统计](#附录完整数据统计)

---

## 一、风险等级总览

| 风险等级 | 含义 | 数量 |
|---|---|---|
| 🔴 致命 | 拆分后必定导致功能异常 | 7类 |
| 🟠 高危 | 特定条件下导致功能异常，需特殊处理 | 9类 |
| 🟡 中危 | 编码时容易遗漏，但不一定立即出错 | 6类 |
| 🟢 低危 | 理论上存在但实际影响小 | 3类 |

---

## 二、致命风险（7类，必须正确处理）

### 致命风险 1：函数声明提升（hoisting）消失

**原理**：当前代码中所有 `function foo() {}` 声明会被JS引擎提升到作用域顶部，因此函数定义顺序不影响调用。但拆分到IIFE模块后，函数变为模块内部的局部函数，**只有执行到定义行后才可用**。

**具体影响**：

```javascript
// 当前 web-app.js 中可以这样写（提升保证可用）：
doSearch("xxx");           // 调用在 L1183
function doSearch() { ... } // 定义在 L3544（后面才定义）

// 拆分到 IIFE 后，如果 doSearch 在另一个模块：
// 模块A: 调用 doSearch() → ReferenceError: doSearch is not defined
// 模块B: function doSearch() {}  ← 还没加载
```

**受影响函数**：所有通过 `function` 关键字声明的函数（253个），特别是：
- 被其他模块**同步调用**的函数（非事件回调中调用）
- 在顶层代码中直接调用的函数

**应对方案**：
- 所有需要跨模块访问的函数，通过 `window.functionName = function() {}` 暴露
- `window.xxx = function` 赋值语句在函数定义之后执行，保证赋值时函数已存在
- 依赖模块的 script 标签必须在调用模块之前加载
- **绝对不能**在模块顶层（IIFE执行时）同步调用其他模块的函数

---

### 致命风险 2：全局变量在IIFE中变为局部变量

**原理**：当前所有 `let currentData = null` 等声明在文件顶层，是全局变量。拆分到IIFE后变成模块私有变量，其他模块无法访问。

**受影响变量**（48个 `let` 全局变量）：

| 变量 | 声明行 | 被其他函数修改的行数 | 风险 |
|---|---|---|---|
| `currentData` | L83 | 8处修改 | 🔴 核心状态，几乎所有模块都用 |
| `kanbanState` | L3639 | 40+处属性修改 | 🔴 8个属性被分散修改 |
| `pdfViewState` | L819 | 150+处属性修改 | 🔴 30+属性被分散修改 |
| `searchMode` | L189 | 8处修改 | 🔴 全局模式开关 |
| `chatHistory` | L863 | 5处修改 | 🟠 异步push+同步清空竞态 |
| `analysisChatHistory` | L867 | 5处修改 | 🟠 同上 |
| `_dossierTabs` | L195 | 3处修改 | 🟠 |
| `_dossierActiveKey` | L196 | 5处修改 | 🟠 |
| `_pdfDocCache` | L861 | 5处修改 | 🟠 |
| `_forceCloseApp` | L4103 | 多处修改 | 🟡 |
| `_patentAskMessages` | L5171 | 3处修改 | 🟡 |
| `_patentAskStreaming` | L5172 | 多处修改 | 🟡 |
| `_googleTranslateActive` | L2758 | 多处修改 | 🟡 |
| `_patentPopupCache` | L2957 | 嵌套修改 | 🟡 |
| `_ppvOpenPatents` | L2955 | 多处修改 | 🟡 |
| `_ppvActivePatent` | L2956 | 多处修改 | 🟡 |
| `_tocItems` / `_activeTocIndex` | L8939-8940 | 多处修改 | 🟡 |
| `_pdActivePatent` / `_pdBatchMode` / `_pdBatchController` | L13752-13755 | 多处修改 | 🟡 |
| `_pdFindMatches` / `_pdFindCurrentIdx` / `_pdFindOriginalHTML` | L14334-14336 | 多处修改 | 🟡 |
| `chatProviderOverride` / `chatModelOverride` | L865-866 | 各2处 | 🟡 |
| `analysisChatProviderOverride` / `analysisChatModelOverride` | L869-870 | 各2处 | 🟡 |
| `_patentAskProviderOverride` / `_patentAskModelOverride` | L871-872 | 各2处 | 🟡 |
| `translateAbortController` / `translatePageCache` | L873-874 | 多处 | 🟡 |
| `kanbanAutoAbortController` / `citedRefsAbortController` | L84-85 | 多处 | 🟡 |
| `activeAnalysisProcess` | L88 | 多处 | 🟡 |
| 其余变量 | - | 各1-3处 | 🟡 |

**应对方案**：
- **方案A（推荐）**：所有全局变量保留在 `web-app.js` 顶层（不迁入IIFE），模块通过 `window.xxx` 访问。这是改动最小、风险最低的方案。
- **方案B**：集中到 `state.js` 模块，通过 `window.AppState = { currentData: null, kanbanState: {...}, ... }` 暴露。所有引用改为 `AppState.currentData`。改动量大但更规范。
- **绝对不能**把全局变量迁入某个模块的IIFE内部，除非该变量只被该模块使用。

---

### 致命风险 3：顶层 `getElementById` 执行时机

**原理**：`web-app.js` L176-810+ 有大量顶层DOM引用：

```javascript
const patentInput = document.getElementById("patent-input");  // L176
const searchBtn = document.getElementById("search-btn");       // L177
// ... 共60+个顶层DOM引用
```

这些代码在**脚本求值时立即执行**。当前能工作是因为 `<script>` 标签在 `web.html` 的 `<body>` 末尾（L978），此时DOM已全部解析。

**拆分后风险**：
- 如果模块的 `<script>` 被放到 `<head>` 或DOM未就绪时加载，所有 `getElementById` 返回 `null`
- 后续 `patentInput.addEventListener(...)`（L1139，**无if守卫**）会直接抛 `TypeError: Cannot read properties of null`
- 有 `if (xxx)` 守卫的绑定会静默失败，功能丢失但无报错——更难发现

**应对方案**：
- 所有模块的 `<script>` 标签**必须保持在 `<body>` 末尾**，在 `</body>` 之前
- 模块加载顺序：constants → core-utils → state → ... → app-init → web-app.js
- 或者：将所有DOM引用集中在 `app-init.js` 的 `DOMContentLoaded` 回调中执行
- **绝对不能**将模块script标签移到 `<head>` 中

---

### 致命风险 4：顶层裸 `addEventListener` 执行时机

**原理**：文件中除了 `DOMContentLoaded` 内的绑定外，还有大量**顶层裸绑定**（无DOMContentLoaded包裹），它们在脚本求值时立即执行：

| 行号 | 绑定代码 | 依赖 |
|---|---|---|
| L1139 | `patentInput.addEventListener("input", ...)` | patentInput非null |
| L1151 | `patentInput.addEventListener("keydown", ...)` | 同上 |
| L1155 | `searchBtn.addEventListener("click", ...)` | searchBtn非null |
| L2936 | `document.addEventListener("click", ...)` | 无DOM依赖，安全 |
| L4107 | `window.addEventListener("beforeunload", ...)` | 安全 |
| L4173 | `document.addEventListener("visibilitychange", ...)` | 安全 |
| L5953-6116 | AI设置面板大量裸绑定 | 各DOM元素非null |
| L9230 | `document.addEventListener("keydown", ...)` | 安全 |
| L10160-10431 | 右键菜单/scroll/resize绑定 | 部分依赖DOM元素 |
| L14511 | `document.addEventListener("keydown", ...)` | 安全 |

**应对方案**：
- 绑定到 `document`/`window` 的不依赖DOM元素，可以裸执行
- 绑定到具体DOM元素的**必须**在DOMContentLoaded中或确保DOM已就绪
- 拆分时保留原有执行顺序，不要把裸绑定提前

---

### 致命风险 5：闭包绑定不可拆分

**原理**：以下4个代码块内的 `addEventListener` 回调**捕获了函数作用域内的 `let` 变量**，整块代码必须保持在同一个作用域中：

#### 5a. Patent Ask 拖拽（L5432-5569）

```javascript
function _initPatentAskBindings() {
  let isDragging = false, resizeMode = null;
  let startX, startY, startLeft, startTop, startWidth, startHeight;
  // ...
  dragHandle.addEventListener("mousedown", ...)   // L5487 - 捕获 isDragging, startX...
  document.addEventListener("mousemove", ...)     // L5531 - 捕获同一组变量
  document.addEventListener("mouseup", ...)       // L5560 - 捕获同一组变量
}
```

→ **整个函数体不可拆**，必须整体迁入 patent-ask.js

#### 5b. Analysis Chat 拖拽（IIFE L12922-13077）

```javascript
// IIFE 内
let isDragging = false, isResizing = false;
let startX, startY, startLeft, startTop, startWidth, startHeight;
dragHandle.addEventListener("mousedown", ...)   // L13001
document.addEventListener("mousemove", ...)     // L13042 - 捕获isDragging/isResizing
document.addEventListener("mouseup", ...)       // L13070
```

→ **整个IIFE不可拆**，必须整体迁入 chat.js

#### 5c. PPV弹窗缩放（L12253-12277，在DOMContentLoaded内）

```javascript
ppvResizeHandle.addEventListener("mousedown", ...)  // L12253
document.addEventListener("mousemove", ...)          // L12263 - 捕获闭包let
document.addEventListener("mouseup", ...)            // L12271
```

→ 必须与同一作用域的拖拽状态变量一起迁入

#### 5d. PDF标注拖拽（L8653-9705，函数内）

```javascript
// startPdfAnnotDrag 函数体内
wrapper.addEventListener("mousedown", ...)      // L8653
document.addEventListener("mousemove", ...)      // L8708/8774 - 捕获annotDragging等
document.addEventListener("mouseup", ...)         // L8732/8848
```

→ **整个PDF标注事件系统不可拆**，必须整体迁入 pdf-annotations.js

#### 5e. 选区菜单闭包（L12420-12562）

```javascript
let _justOpenedMenu = false;  // L12420
// setTimeout(() => { _justOpenedMenu = false; }, 150)  // L12457
// document.addEventListener("mousedown", ...)  // L12539 - 读取 _justOpenedMenu
```

→ 这整块代码必须保持在同一作用域

**应对方案**：以上5个代码块**整体迁移**，不做内部拆分。在目标模块中保持原始结构。

---

### 致命风险 6：`DOMContentLoaded` 内的巨型初始化块

**原理**：L11787 有一个唯一的 `DOMContentLoaded` 回调，包含**100+个事件绑定**（L11802-L12449）。这个回调引用了大量模块级函数和DOM元素。

**拆分后风险**：
- 如果把这个回调拆到某个模块中，该模块必须能访问所有被引用的函数
- 如果分散到多个模块的多个 `DOMContentLoaded` 回调中，**执行顺序不可控**（多个DOMContentLoaded回调按注册顺序执行，但跨模块时依赖script加载顺序）

**受影响绑定**（部分关键项）：

| 行号 | 绑定 | 依赖的函数 |
|---|---|---|
| L11802 | themeToggleBtn click | 主题切换逻辑 |
| L11814 | window message | handleExtensionData |
| L11832 | documentsContent click | 多个文档操作函数 |
| L11848 | kanbanBoard click | Kanban相关函数 |
| L12060-12197 | PDF工具栏所有按钮 | pdfGoToPage, setPdfAnnotTool等20+函数 |
| L12282 | tab click (循环) | switchPatentTab |
| L12380-12409 | 聊天发送/导出/中止 | sendChatMessage等 |

**应对方案**：
- **方案A（推荐）**：保留为一个整体的 `app-init.js` 模块，DOMContentLoaded回调不拆分。所有被引用的函数通过 `window.xxx` 访问。
- **方案B**：按功能域拆分到各模块的 `DOMContentLoaded` 回调，但必须确保script加载顺序正确。
- **关键**：拆分后必须验证所有100+绑定都正常工作

---

### 致命风险 7：动态生成的HTML中的 `onclick` 字符串引用

**原理**：15个函数通过字符串拼接生成HTML，函数名以**字符串**形式嵌入 `onclick` 属性中。这些函数必须在全局作用域可访问：

| 被引用函数 | 出现行号 | 生成HTML的函数 |
|---|---|---|
| `openInAppWebview` | L746, L747, L1833, L1837, L13993 | patentLinkButtons, renderPatentDetail等 |
| `openJPlatPat` | L749, L1835 | patentLinkButtons |
| `openCNQuery` | L752 | patentLinkButtons |
| `openPatentAsk` | L1831 | renderPatentDetail |
| `toggleGoogleTranslate` | L1832 | renderPatentDetail |
| `switchPatentTab` | L1857-1860 | renderPatentDetail |
| `runPatentInterpretation` | L1877, L3032 | renderPatentDetail, renderPatentPopupContent |
| `copyPatentSectionText` | L2012, L2054, L3150, L3192 | 同上 |
| `switchPpvPatent` | L3002 | renderPatentPopupContent |
| `closePpvPatentTab` | L3004 | 同上 |
| `switchPpvTab` | L3018-3021 | 同上 |
| `openPatentImageViewer` | L3115 | 同上 |
| `_openPdPatent` | L14022 | _renderPdTabs |
| `_retryBatchCard` | L14040 | _updateBatchCardError |

**应对方案**：
- 这15个函数**必须**通过 `window.xxx` 暴露到全局
- 拆分后验证：点击所有动态生成的按钮，确认onclick能找到函数
- **绝对不能**将这些函数放入IIFE内部不导出

---

## 三、高危风险（9类，需特殊处理）

### 高危风险 1：异步函数与状态清空的竞态条件

**原理**：`chatHistory`、`analysisChatHistory`、`_patentAskMessages` 三个数组在 `async` 函数中 `push`，但在其他地方被同步清空。

| 数组 | push位置（async） | 清空位置（同步） | 竞态场景 |
|---|---|---|---|
| `chatHistory` | L12621, L12740 (sendChatMessage) | L8086 (selectReaderDoc), L11905/L11963 (关闭阅读器) | 用户在AI回复流式输出时切换文档→回复写入错误上下文 |
| `analysisChatHistory` | L12843, L12909 (sendAnalysisChatMessage) | L4617 (renderKanban), L7321 (buildReviewManualSelectPanel) | 切换dossier标签→renderKanban清空→流式回复写入新数组 |
| `_patentAskMessages` | L5361, L5363 (sendPatentAsk) | L5248 (clearPatentAsk) | 同上 |

**拆分影响**：如果chat模块和reader模块分开，`selectReaderDoc` 清空 `chatHistory` 的行为必须保留。若 `chatHistory` 迁入chat.js的IIFE中变为私有变量，reader.js无法清空它。

**应对方案**：
- `chatHistory` 等状态变量**保留在全局**（window上），不迁入IIFE
- 或提供 `window.clearChatHistory()` 函数供其他模块调用
- 验证：在AI流式回复期间切换文档/标签，确认不会串数据

---

### 高危风险 2：`kanbanState` 重置-恢复时序耦合

**原理**：`_dossierApplyTab`（L237）和 `PatentCache.restoreState`（L3835）依赖固定的执行顺序：

```
1. renderKanban(currentData)
   → 内部重置 kanbanState.documents=[], .analysis="", .hasUnsavedWork=false
2. 然后覆盖 kanbanState.extractions = savedExtractionState
3. 然后覆盖 kanbanState.analysis = savedAnalysis
4. 然后覆盖 kanbanState.traceIndex = savedTraceIndex
```

**拆分影响**：如果 `renderKanban` 在kanban.js模块，而 `_dossierApplyTab` 在dossier-tabs.js模块，`PatentCache.restoreState` 在patent-cache.js模块——三处都修改同一个 `kanbanState` 对象。如果 `kanbanState` 是全局变量（window上），对象引用一致，则没有问题。但如果某处创建了副本，时序就会错乱。

**应对方案**：
- `kanbanState` 必须是全局唯一的对象引用（window.kanbanState），**不可复制**
- 拆分后验证：切换dossier标签→确认extractions/analysis/traceIndex都正确恢复
- 验证：从缓存恢复→确认renderKanban的重置不会覆盖恢复的数据

---

### 高危风险 3：`pdfViewState.renderVersion` 并发防护

**原理**：L8291 `++pdfViewState.renderVersion` 是唯一的自增全局变量，用于PDF异步渲染的竞态防护：

```javascript
const myVersion = ++pdfViewState.renderVersion;  // L8291
// ... await renderAllPdfPages() ...
if (myVersion !== pdfViewState.renderVersion) return;  // L8361/8382/8394/8400 版本检查
```

**拆分影响**：如果 `pdfViewState` 被复制或重新赋值（而非保持同一引用），版本号检查会失效，导致旧渲染覆盖新渲染。

**应对方案**：
- `pdfViewState` 必须保持全局唯一引用
- pdf-annotations.js 和 reader.js 共享同一个 `pdfViewState` 对象
- 验证：快速连续切换PDF文档→确认不会出现旧页面闪现

---

### 高危风险 4：MutationObserver 隐式依赖链

**原理**：L14327-14328 的 MutationObserver：

```javascript
const _pdObserver = new MutationObserver((mutations) => {
  _injectFindButton();  // L14315 - 引用模块级函数
});
_pdObserver.observe(patentDetailContent, _obsConfig);  // 依赖 patentDetailContent (L182)
```

而 `_injectFindButton()` 内部：

```javascript
function _injectFindButton() {
  // ...
  findBtn.addEventListener("click", togglePdFindBar);  // L14323 - 引用 togglePdFindBar (L14338)
}
```

`togglePdFindBar` 又引用 `_clearFindHighlights`（L14357）、`_doFind`（L14370）、`pdFindInput`（L14328 const）等。

**拆分影响**：如果 MutationObserver 在一个模块，`togglePdFindBar` 在另一个模块，`pdFindInput` 在第三个模块——任何一个缺失都会导致页内查找功能失效。

**应对方案**：
- `_pdObserver`、`_injectFindButton`、`togglePdFindBar`、`_clearFindHighlights`、`_doFind`、`pdFindInput` **必须在同一模块**
- 验证：打开专利详情→确认查找按钮被注入→Ctrl+F能搜索

---

### 高危风险 5：`setInterval` 的延迟失败

**原理**：两个顶层 `setInterval` 捕获了模块级变量：

| 行号 | 间隔 | 捕获变量 | 风险 |
|---|---|---|---|
| L2961 | 30秒 | `_patentPopupCache`（L2957）, `PATENT_POPUP_CACHE_TTL` | 如果变量在另一个模块→30秒后报错 |
| L13739 | 20分钟 | `getOpsSettings`（L758）, `refreshOpsQuota` | 20分钟后报错，难以发现 |

**拆分影响**：这些setInterval在脚本求值时立即启动，如果捕获的变量/函数在另一个尚未加载的模块中，首次触发时会报错。由于间隔很长（30秒/20分钟），测试时可能遗漏。

**应对方案**：
- 确保这些变量/函数在setInterval执行前已定义
- 或将setInterval启动延迟到 `DOMContentLoaded` 中
- 验证：等待30秒以上，检查控制台无错误

---

### 高危风险 6：`typeof === "function"` 守卫调用中的死代码

**原理**：10处使用 `typeof funcName === "function"` 进行条件调用，其中 `closeReader` **从未被定义**：

| 行号 | 条件调用 | 实际状态 |
|---|---|---|
| L244 | `typeof closeReader === "function"` → `closeReader()` | 🔴 **函数不存在**，条件永远为false |
| L416 | 同上 | 🔴 同上 |
| L557 | 同上 | 🔴 同上 |
| L1237 | 同上 | 🔴 同上 |
| L250 | `typeof togglePdfView === "function"` → `togglePdfView(true)` | ✅ 已定义 |
| L1167 | `typeof fetchAndAddPatent === "function"` → `fetchAndAddPatent()` | ✅ 已定义 |
| L3614 | `typeof buildReviewManualSelectPanel === "function"` | ✅ 已定义（仅判断存在性） |
| L6203 | `typeof loadOpsSettingsToForm === "function"` → `loadOpsSettingsToForm()` | ✅ 已定义 |
| L15656 | `typeof openReader === "function"` → `openReader()` | ✅ 已定义 |
| L15664 | `typeof pdfGoToPage === "function"` → `pdfGoToPage()` | ✅ 已定义 |

**拆分影响**：
- `closeReader` 从未定义，4处typeof守卫永远跳过——如果拆分后某个模块定义了 `closeReader` 函数，这些原本死代码的分支会突然执行，可能产生意外行为
- 其他5处typeof守卫依赖函数在全局可访问——拆分后必须确保这些函数通过window暴露

**应对方案**：
- **不要**新定义 `closeReader` 函数（除非明确要启用这些死代码分支）
- 被typeof守卫调用的5个函数（togglePdfView, fetchAndAddPatent, loadOpsSettingsToForm, openReader, pdfGoToPage）必须通过window暴露
- 验证：切换dossier标签→确认reader modal正确关闭（当前靠 `rm.classList.add("hidden")` 而非closeReader）

---

### 高危风险 7：枢纽函数跨模块依赖

**原理**：39个函数被调用>5次，最核心的：

| 函数 | 调用次数 | 定义行 | 被哪些模块的函数调用 |
|---|---|---|---|
| `escapeHtml` | 274次 | L4986 | 几乎所有UI渲染模块 |
| `showError` | 68次 | L876 | 几乎所有模块 |
| `icon` | 56次 | L62 | 几乎所有UI模块 |
| `refreshHistoryList` | 25次 | L4182 | cache/dossier/search等 |
| `_getCurrentPdfAnnotKey` | 20次 | L9162 | pdf-annotations内部 |
| `renderExtractDocList` | 19次 | L14916 | extract内部 |
| `renderMarkdown` | 16次 | L7359 | ai-analysis/reader/chat等 |
| `renderMarkdownWithTrace` | 15次 | L7371 | 同上 |
| `savePdfAnnotations` | 12次 | L9176 | pdf-annotations内部 |
| `updateFloatingBallsVisibility` | 12次 | L1189 | dossier/cache/detail等 |
| `autoSaveCache` | 11次 | L4092 | kanban/ai-analysis/reader等 |
| `showToast` | 11次 | L882 | 几乎所有模块 |
| `_clearFindHighlights` | 11次 | L14357 | batch-search内部 |
| `_pushAnnotUndo` | 10次 | L9261 | pdf-annotations内部 |
| `renderPdfAnnotsForPage` | 10次 | L9587 | pdf-annotations内部 |
| `renderPatentDetail` | 9次 | L1821 | patent-detail/search等 |
| `_dossierRenderTabs` | 9次 | L339 | dossier-tabs内部 |
| `updateExtractDocCount` | 9次 | L15153 | extract内部 |
| `showOcrProgressOverlay` | 9次 | L8210 | reader内部 |
| `hidePdfBlockContextMenu` | 8次 | L10232 | pdf-annotations内部 |
| `renderAiProgressUI` | 8次 | L6842 | ai-analysis内部 |
| `_createThinkingHost` | 8次 | L6775 | ai-analysis内部 |
| `patentLinkButtons` | 8次 | L743 | patent-office/patent-detail等 |
| `parseDate` | 8次 | L8025 | reader/timeline等 |
| `switchPatentTab` | 8次 | L2177 | patent-detail内部 |
| `switchPpvTab` | 7次 | L2230 | patent-detail内部 |
| `populateChatProviderSelect` | 7次 | L928 | ai-analysis/chat等 |
| `refreshPdfAnnotMultiSelectionVisual` | 7次 | L10029 | pdf-annotations内部 |
| `hidePdfAnnotContextMenu` | 7次 | L10410 | pdf-annotations内部 |
| `gdFetch` | 6次 | L1107 | search/patent-detail等 |
| `parseDocDateToTimestamp` | 6次 | L4529 | kanban/timeline等 |
| `_updatePdfAnnotation` | 6次 | L10248 | pdf-annotations内部 |
| `_openPdPatent` | 6次 | L14177 | batch-search内部 |
| `_updateAnnotCloseFlag` | 6次 | L9207 | pdf-annotations内部 |
| `tauriInvoke` | 6次 | L166 | 多处Tauri调用 |
| `doExtractText` | 6次 | L6241 | reader/kanban等 |

**拆分影响**：如果 `escapeHtml` 在core-utils.js模块中通过 `window.escapeHtml` 暴露，但某个模块在core-utils.js加载前就调用了它→报错。由于script按顺序加载，只要core-utils.js在所有依赖它的模块之前加载即可。

**应对方案**：
- 枢纽函数所在的模块必须在所有依赖模块之前加载
- constants.js和core-utils.js必须是**最先加载**的两个模块
- 验证：搜索后检查所有HTML渲染正常（escapeHtml工作）

---

### 高危风险 8：`searchMode` 切换不保存dossier状态

**原理**：`searchMode` 在8处被修改，其中L4371/L4378（refreshHistoryList内的历史项点击）直接修改 `searchMode` 但**没有调用 `_dossierSaveActiveTab()`** 保存当前dossier标签状态。

| 行号 | 所在函数/回调 | 修改方式 | 是否保存dossier状态 |
|---|---|---|---|
| L1233 | `.search-mode-btn` click 回调 | `searchMode = btn.dataset.mode` | 否 |
| L4371 | `refreshHistoryList` 内 history item click | `searchMode = "patent"` | **否** |
| L4378 | 同上 | `searchMode = "dossier"` | **否** |
| L4476 | `doRestoreFromHistory(patentNumber)` | `searchMode = "dossier"` | 是 |
| L4499 | `doRestoreFromCache(patentNumber)` | `searchMode = "dossier"` | 是 |
| L14199 | `_openPdPatent(pn)` | `searchMode = "patent"` | 否 |
| L14586 | `initExtractMode` 内 back 按钮回调 | `searchMode = "dossier"` | 否 |
| L15645 | `openExtractDocAndJump(...)` | `searchMode = "dossier"` | 否 |

**拆分影响**：如果 `searchMode` 迁入state.js模块，`refreshHistoryList` 在patent-cache.js模块中修改它时需要通过window访问。如果接口不一致，可能导致模式切换但UI状态不同步。

**应对方案**：
- `searchMode` 保留为全局变量
- 验证：在dossier模式下有未保存工作→点击历史记录中的专利→确认是否有数据丢失
- 注意：这可能是一个**已存在的bug**，拆分不应改变现有行为

---

### 高危风险 9：`_dossierApplyTab` 调用多个render函数的顺序依赖

**原理**：`_dossierApplyTab`（L237）恢复标签状态时调用：

```javascript
renderKanban(currentData);     // L278 - 重置kanbanState
// ... 覆盖kanbanState属性 ...
renderOverview(currentData);   // L316
renderFamily(currentData);     // L317
renderTimeline(currentData);   // L318
_dossierRenderTabs();          // L334
refreshHistoryList();           // L335
updateFloatingBallsVisibility();// L336
```

**拆分影响**：这些render函数分散在kanban.js、patent-detail.js、ai-analysis.js、dossier-tabs.js、patent-cache.js、ui-common.js中。如果某个函数因模块加载问题不存在（undefined），`try { renderKanban(currentData); } catch` 会捕获错误但不影响后续——但功能会缺失。

**应对方案**：
- 所有被 `_dossierApplyTab` 调用的render函数必须通过window暴露
- 注意L278/L316/L317/L318都有 `try...catch` 包裹，错误不会中断流程但功能会丢失
- 验证：切换dossier标签→确认Kanban/Overview/Family/Timeline都正确渲染

---

## 四、中危风险（6类）

### 中危风险 1：`this` 绑定丢失

**原理**：如果函数内部使用了 `this`，拆分到IIFE后 `this` 的值可能改变。

**实际分析**：经过全面检查，web-app.js中**几乎没有使用 `this`** 的函数（事件处理器都用箭头函数或显式参数）。唯一需要注意的是：

- L9581/9582: `document.addEventListener("mousemove", handler, true)` 使用capture模式——拆分后保持capture参数
- 动态设置的 `element.onclick = function(e) { ... }` 中的 `this` 指向element——保持不变即可

**应对方案**：迁移时保持原有函数形式，不改变箭头函数/function关键字的选用。

---

### 中危风险 2：死代码函数可能被误删

| 函数 | 定义位置 | 状态 |
|---|---|---|
| `searchPatentDetail` | L1307 | 从未被调用 |
| `restoreFromCache` | L4442 | 从未被调用（`doRestoreFromCache` 有被调用） |
| `restoreFromHistory` | L4460 | 从未被调用（`doRestoreFromHistory` 有被调用） |
| `closeReader` | 未定义 | 4处typeof守卫引用，永不执行 |

**应对方案**：
- 拆分时**保留**这些函数（即使看起来是死代码），避免意外破坏
- 可以标注 `// DEAD CODE: never called` 注释
- **不要**在拆分过程中删除任何函数

---

### 中危风险 3：循环依赖（6处）

| 循环 | 模块A | 模块B | 依赖方式 |
|---|---|---|---|
| 1 | `_dossierRenderTabs` | `_dossierCloseTab` | 事件回调 |
| 2 | `_dossierRenderTabs` | `_dossierSwitchTo` | 事件回调 |
| 3 | `_renderPdTabs` | `_switchPdTab` | 事件回调 |
| 4 | `_renderPdTabs` | `_closePdTab` | 事件回调 |
| 5 | `renderExtractDocList` | `refreshExtractGroup` | 事件回调 |
| 6 | `renderExtractDocList` | `removeExtractGroup` | 事件回调 |

**影响**：IIFE模式下不存在ES module的循环import问题。只要两个函数都通过window暴露，事件回调中的调用在运行时（而非加载时）执行，此时两个函数都已定义。

**应对方案**：确保循环依赖的函数对在同一模块中，或都通过window暴露。

---

### 中危风险 4：内联 `.onclick =` 设置的闭包

| 行号 | 元素 | 捕获的闭包变量 |
|---|---|---|
| L1358 | `loadingGpLink.onclick` | `gpUrl`, `raw` |
| L1363 | `loadingEspacenetLink.onclick` | `espUrl`, `raw` |
| L3320/L3339 | `gpLink.onclick` | `raw` |
| L3321/L3340 | `espacenetBtn.onclick` | `raw` |
| L3451 | `gpLink.onclick` | `patentNumber` |
| L3454 | `espacenetBtn.onclick` | `patentNumber` |
| L13997/L14026 | `card.onclick` | `pn` |

**影响**：这些 `.onclick = function() { ... openInAppWebview(gpUrl) }` 设置在函数内部，捕获了局部变量。只要函数体不拆分，闭包就不受影响。

**应对方案**：包含这些设置的函数整体迁移，不拆分函数体。

---

### 中危风险 5：`_forceCloseApp` 与 `beforeunload` 交互

**原理**：L4103 `let _forceCloseApp = false` 和 L4107 `window.addEventListener("beforeunload", ...)` 配合使用。`_forceCloseApp` 在多处被设为 `true`（如关闭标签时），用于跳过未保存工作提示。

**拆分影响**：如果 `_forceCloseApp` 迁入某个模块变为私有变量，其他模块无法设置它→beforeunload回调无法正确判断是否应该提示。

**应对方案**：`_forceCloseApp` 保留为全局变量，或提供 `window.setForceCloseApp(true)` 接口。

---

### 中危风险 6：模块级 `const` 与引用函数的绑定关系

**原理**：一些 `const` 声明在模块顶层，被同模块的多个函数引用：

| const | 行号 | 引用它的函数 |
|---|---|---|
| `_obsConfig` | 需确认 | `_pdObserver` |
| `PATENT_POPUP_CACHE_TTL` | 需确认 | L2961 `setInterval` |
| `_pdOpenPatents` | L13750附近 | `_renderPdTabs`, `_switchPdTab`等 |
| `_pdPatentCache` | L13750附近 | `_openPdPatent`等 |
| `_extractState` | 需确认 | extract.js所有函数 |
| `readerPdfContainer` | 需确认 | reader相关函数 |
| `patentInput` / `searchBtn` 等60+个 | L176-810+ | 多处事件绑定 |

**应对方案**：这些const与其引用函数必须在同一模块。不要将const和引用它的函数拆到不同模块。

---

## 五、低危风险（3类）

### 低危风险 1：CSS类名依赖

**原理**：JS代码中大量操作CSS类名（`classList.add/remove/toggle`）。拆分不影响CSS，但如果HTML中的class名与JS中的不一致会导致样式问题。

**应对方案**：拆分不涉及HTML/CSS变更，风险极低。

---

### 低危风险 2：`localStorage` key一致性

**原理**：`PatentCache` 使用多个localStorage key：

| key名 | 定义位置 | 用途 |
|---|---|---|
| `patentlens-cache` | L3649 | 专利数据缓存 |
| `patentlens-history` | L3650 | 轻量历史记录 |
| `patentlens_patent_history` | L3651 | 专利历史 |
| `history-helper-ai-config` | web-ai.js | AI配置 |
| `patentlens_${prefix}_${office}_${appNum}` | L116 | 手动选择状态 |
| `_PDF_ANNOT_STORAGE_PREFIX + docKey` | L9207附近 | PDF标注 |

**应对方案**：拆分不改任何key名。`_PDF_ANNOT_STORAGE_PREFIX` 必须在pdf-annotations.js中定义或在全局保留。

---

### 低危风险 3：第三方库依赖顺序

**原理**：web.html中第三方库（pdf.js, marked, docx, FileSaver, pdf-lib, fontkit）在web-app.js之前加载。拆分后模块也在第三方库之后加载即可。

**应对方案**：模块script标签放在所有第三方库之后，保持现有顺序。

---

## 六、拆解操作红线清单

以下是拆解过程中**绝对不能违反**的规则：

| # | 红线规则 | 违反后果 |
|---|---|---|
| 1 | 所有模块 `<script>` 标签必须在 `<body>` 末尾，在 `</body>` 之前 | DOM引用全部为null，功能完全失效 |
| 2 | `constants.js` 和 `core-utils.js` 必须是最先加载的业务模块 | escapeHtml/icon/showError等枢纽函数不可用 |
| 3 | `app-init.js` 必须是最后加载的业务模块（在web-app.js之前） | 初始化时其他模块函数未定义 |
| 4 | 15个被onclick字符串引用的函数必须通过 `window.xxx` 暴露 | 动态生成的按钮点击无反应 |
| 5 | `currentData`/`kanbanState`/`pdfViewState`/`searchMode` 必须保持全局唯一引用 | 多标签状态错乱、数据丢失 |
| 6 | 5个闭包绑定代码块（5a-5e）必须整体迁移，不可拆分 | 拖拽/缩放功能失效 |
| 7 | MutationObserver + _injectFindButton + togglePdFindBar 必须在同一模块 | 页内查找功能失效 |
| 8 | 2个 `setInterval` 捕获的变量/函数必须在setInterval执行前已定义 | 30秒/20分钟后延迟报错 |
| 9 | 不删除任何函数（包括死代码） | 可能意外破坏功能 |
| 10 | 不改变任何localStorage key名 | 用户缓存/设置丢失 |
| 11 | 不改变任何函数名 | onclick字符串引用失效 |
| 12 | `_dossierApplyTab` 调用的render函数顺序不变 | 标签状态恢复错乱 |
| 13 | 异步函数中push的数组（chatHistory等）必须可被其他模块清空 | 异步竞态导致数据串入错误上下文 |
| 14 | `pdfViewState` 的 `renderVersion` 自增防护必须保持同一对象引用 | PDF渲染竞态防护失效 |
| 15 | `typeof === "function"` 守卫调用的5个函数必须通过window暴露 | 条件调用永远跳过，功能静默失效 |

---

## 七、拆解后验证清单

每完成一个模块的迁移，必须验证以下功能：

### 基础功能验证（每步必做）

- [ ] 页面加载无JS控制台错误
- [ ] 搜索专利正常（dossier模式）
- [ ] 专利详情页正常渲染
- [ ] 所有SVG图标正常显示
- [ ] 错误提示/Toast正常弹出

### 多标签验证（dossier-tabs迁移后）

- [ ] 打开多个专利标签（最多3个）
- [ ] 切换标签→Kanban/Overview/Family/Timeline正确恢复
- [ ] 关闭有未保存工作的标签→弹出确认框
- [ ] 超过3个标签→驱逐逻辑正常
- [ ] 切换标签→PDF标注状态正确恢复

### PDF阅读器验证（reader迁移后）

- [ ] 打开阅读器→文本/PDF模式切换正常
- [ ] PDF翻页/缩放正常
- [ ] 快速连续切换文档→无旧页面闪现（renderVersion防护）
- [ ] OCR进度显示正常
- [ ] PDF目录(TOC)正常

### PDF标注验证（pdf-annotations迁移后）

- [ ] 高亮/下划线/箭头/注释工具正常
- [ ] 拖动标注位置正常
- [ ] 撤销/重做正常
- [ ] 框选多个标注正常
- [ ] 批量改色/字号/线宽正常
- [ ] 标注自动保存/恢复正常
- [ ] 右键菜单正常

### AI功能验证（ai-analysis/chat迁移后）

- [ ] AI分析按钮正常→Markdown渲染正常
- [ ] 溯源跳转正常
- [ ] 模型选择下拉正常
- [ ] AI对话发送/接收正常
- [ ] AI流式回复期间切换文档→不串数据
- [ ] 导出Word正常

### 其他功能验证

- [ ] 划词翻译正常
- [ ] 整页翻译正常
- [ ] 缓存保存/恢复正常
- [ ] 历史列表正常
- [ ] 批量查询/下载正常
- [ ] 批量信息抽取→导出Excel正常
- [ ] 浏览器扩展消息接收正常
- [ ] 页内查找(Ctrl+F)正常
- [ ] 等待30秒+→控制台无setInterval错误

---

## 附录：完整数据统计

### 全局变量统计

| 类型 | 数量 | 说明 |
|---|---|---|
| `let` 全局变量 | 48个 | 可变状态，有修改风险 |
| `const` 全局常量/引用 | 70+个 | 不可变，风险较低 |
| `var` 全局变量 | 0个 | 无 |

### 函数统计

| 类型 | 数量 |
|---|---|
| `function` 声明 | 253个 |
| 被调用>5次的枢纽函数 | 39个 |
| 死代码函数（从未被调用） | 3个 |
| 被onclick字符串引用的函数 | 15个 |
| 被typeof守卫调用的函数 | 10个（其中4个为死代码） |
| `eval` / `new Function` 使用 | 0个 |

### 事件绑定统计

| 类型 | 数量 |
|---|---|
| `addEventListener` 调用 | 100+个 |
| `DOMContentLoaded` 回调 | 1个 |
| 顶层裸绑定（无DOMContentLoaded包裹） | 30+个 |
| 内联 `.onclick =` 设置 | 16个 |
| `setInterval` | 4个 |
| `setTimeout` | 50+个 |
| `MutationObserver` | 1个 |
| `IntersectionObserver` | 1个 |
| `ResizeObserver` | 0个 |

### 状态修改统计

| 变量 | 修改点数量 |
|---|---|
| `pdfViewState`（30+属性） | 150+处 |
| `kanbanState`（8个属性） | 40+处 |
| `currentData` | 8处 |
| `searchMode` | 8处 |
| `chatHistory` | 5处 |
| `analysisChatHistory` | 5处 |
| 其余变量 | 各1-3处 |
