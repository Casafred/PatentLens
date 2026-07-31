# web-app.js 拆解前盘点与低风险执行计划

> 盘点基线：`main@e990b50769e042672772fd2ccc1d54a12095eaa9`  
> 盘点日期：2026-07-31  
> 当前架构：Electron-only；`src-tauri/` 不在本计划范围内

> 实施进度与每批验证证据见 [`web-app-refactor-progress.md`](web-app-refactor-progress.md)。

## 1. 结论摘要

`src/scripts/web-app.js` 已明显超过可维护范围，应拆解，但现在不适合直接“按行剪切”。当前文件同时承担启动防护、全局状态、专利查询、渲染、缓存、AI、PDF、OCR、导出、设置、批量任务和智能抽取等职责；代码依靠经典脚本的全局词法环境、加载顺序、函数声明、顶层 DOM 查询、顶层事件绑定和大量异步闭包协同工作。

正确顺序是：

1. 固化 Electron-only 架构和唯一运行入口；
2. 建立可重复的行为基线与自动化回归测试；
3. 生成当前版本的符号、状态、事件和依赖清单；
4. 先提取低耦合叶子模块，再提取完整业务纵切；
5. 最后才处理共享状态、初始化和旧 Tauri 分支。

拆解目标不是单纯减少行数，而是建立明确的模块所有权、受控依赖和可验证的变更边界。

## 2. 当前量化基线

| 指标 | 当前值 | 判断 |
|---|---:|---|
| 文件行数 | 22,429 | 严重超大 |
| UTF-8 字节数 | 995,228 | 接近 1 MB 单文件 |
| 具名 `function` 声明 | 约 366 个（正则统计 414 个声明形态） | 职责过多 |
| `addEventListener` | 371 处 | 初始化和生命周期高度分散 |
| `setTimeout` / `setInterval` | 101 处 | 存在竞态与清理风险 |
| local/session storage 引用 | 65 处 | 持久化契约分散 |
| 主 `DOMContentLoaded` | L18090 起 | 巨型集中初始化块 |
| 自动化测试 | 未发现 | 当前最大拆解阻塞项 |
| 最近一次提交前行数 | 约 20,616 | 单次增长约 1,800 行 |

相关文件同样较大：

| 文件 | 行数 | 角色 |
|---|---:|---|
| `electron-main.js` | 4,803 | Electron 主进程、本地服务、IPC 和多站点抓取 |
| `src/web.html` | 1,253 | Electron 实际主页面 |
| `src/index.html` | 1,169 | 次级/历史页面，不能默认与 web.html 等价 |

## 3. 当前代码结构盘点

以下范围基于当前提交，只用于盘点和建立模块候选；执行时必须重新生成边界，不允许照抄静态行号。

| 大致范围 | 主要职责 | 典型状态/函数 | 风险 |
|---|---|---|---|
| L1-L621 | 版权、Google Translate 防护、焦点恢复、图标、人工选择辅助、历史 Tauri 桥 | `_protectEarly`、`icon`、`isTauri`、`tauriInvoke` | 顶层同步执行，启动时序敏感 |
| L622-L1496 | DOM 引用、搜索模式、Dossier 多标签、Reader/PDF/Chat 全局状态 | `currentData`、`pdfViewState`、多组 AbortController | 共享可变状态中心 |
| L1350-L6759 | OPS/GD/EPO 查询、专利详情、网页弹窗、翻译、图号链接、专利弹窗、主搜索 | `gdFetch`、`searchPatentDetail`、`renderPatentDetail`、`doSearch` | 网络降级链复杂，Electron 能力耦合高 |
| L6761-L8316 | Kanban 状态、IndexedDB/Storage 缓存、历史记录 | `kanbanState`、`PatentBlobDB`、`PatentCache`、`GPCache` | 数据兼容与恢复顺序敏感 |
| L8317-L11208 | 看板、概览、文档列表、分屏、PatentAsk、单文档提取、AI 设置 | `renderKanban`、`renderOverview`、`renderDocuments`、`sendPatentAsk` | DOM 渲染和状态修改交叉 |
| L11209-L12732 | OCR 文本提取、引用分析、审查分析、Markdown 溯源 | `doExtractText`、`runCitedRefsAnalysis`、`startReviewAnalysis`、`onTraceClick` | 流式请求、取消、溯源状态复杂 |
| L12733-L17179 | 时间线、阅读器、PDF 渲染/目录/标注/搜索/OCR/翻译 | `renderTimeline`、`renderPdfView`、`renderAllPdfPages`、`exportPdfWithAnnotations`、`ocrPdf` | 风险最高；Canvas、坐标、异步渲染和持久化耦合 |
| L17252-L17673 | 浏览器扩展数据接入 | `handleExtensionData`、`handleExtensionAnalyze` | 消息协议兼容风险 |
| L17675-L18968 | Word 导出 | `exportToWord` 及其内部 Markdown/表格处理 | 单函数约 2,294 行，优先独立测试 |
| L18090 起 | 主初始化和大量事件绑定 | 页面、PDF、聊天、弹窗事件 | 约 76 个监听集中在 L18000-L18999 |
| L18969-L19886 | 阅读器/分析聊天、合并导出 | `sendChatMessage`、`sendAnalysisChatMessage`、`doMergeExport` | 流式状态和下载流程 |
| L19887-L21191 | 历史侧栏、网络/OPS 设置、批量查询、详情标签与查找 | `_openPdPatent`、`fetchPatentWithRetry`、`togglePdFindBar` | 顶层绑定多、状态分散 |
| L21192-L22428 | 智能抽取全流程 | `_extractState`、OCR 同步、字段模板、抽取、CSV 导出 | 新增业务大块，尚无回归保护 |

## 4. 关键依赖与高风险点

### 4.1 Electron 与页面入口

- Electron 和 `server.js` 都将 `/` 映射到 `src/web.html`；它是主页面。
- `src/web.html` 与 `src/index.html` 的脚本版本号已经不一致，说明二者存在漂移风险。
- `preload.js` 暴露的 `window.electronAPI` 是桌面能力的正式边界。
- 拆分不得新增 Tauri 实现；历史 `isTauri` 分支只做隔离盘点，不在普通模块拆分中顺手删除。

### 4.2 全局词法绑定

当前经典脚本依赖顶层 `let` / `const` / `function` 的共享全局环境。把代码包进 IIFE、ES Module 或改变 script 顺序，可能让其他代码无法访问原绑定。禁止在第一轮拆分中同时完成“搬文件 + 改作用域 + 改命名 + 改模块系统”。

### 4.3 初始化时序

- 文件开头存在必须尽早执行的 Google Translate 屏蔽和焦点恢复逻辑。
- 大量 DOM 引用在顶层同步获取，要求脚本仍位于页面主体末尾。
- 主 `DOMContentLoaded` 和大量顶层监听并存；监听所有权必须按功能整体迁移。
- `src/web.html` 后续还加载 comparison、image annotation 和 agent 子系统，拆分不能改变它们观察到的全局 API 和 DOM 时机。

### 4.4 异步和取消

多个搜索、AI、OCR、翻译和批处理流程使用共享 AbortController、定时器和流式回调。迁移时必须保留：

- 谁创建、覆盖和 abort controller；
- 页面/标签切换时谁负责取消；
- 回调落地前如何确认当前 patent/doc/tab 仍有效；
- loading、按钮 disabled 和进度层的 finally 清理；
- 定时器、MutationObserver、object URL 和事件监听的释放。

### 4.5 持久化契约

`PatentCache`、`PatentBlobDB`、`GPCache`、localStorage 和标注存储键属于数据契约。拆文件阶段不得修改键名、数据形状、TTL、迁移逻辑或恢复顺序。任何存储升级必须单独实施并提供向后兼容测试。

### 4.6 动态 DOM 与隐式 API

虽然 HTML 源文件没有内联 handler，但 `web-app.js` 会通过模板字符串生成带事件语义的 DOM，并依赖委托监听、data-action、class 和 id。CSS selector、dataset 名、事件冒泡路径和渲染后绑定都视为公开契约。

## 5. 目标模块边界

建议采用“少而清晰”的一级领域目录，避免一次拆成 30 个相互依赖的小文件。

```text
src/scripts/app/
  bootstrap/
    early-protection.js
    app-init.js
    diagnostics.js
  platform/
    electron-bridge.js
    local-api.js
  shared/
    icons.js
    dom.js
    errors.js
    dates.js
    clipboard.js
  state/
    app-state.js
    lifecycle.js
  patent/
    links.js
    query.js
    detail-renderer.js
    popup.js
    translation.js
  dossier/
    tabs.js
    cache.js
    history.js
    kanban.js
    timeline.js
    documents.js
  analysis/
    settings.js
    patent-ask.js
    review-analysis.js
    cited-references.js
    trace.js
    chat.js
  reader/
    reader.js
    pdf-renderer.js
    pdf-toc.js
    pdf-annotations.js
    pdf-search.js
    ocr.js
    translation.js
  export/
    word.js
    annotated-pdf.js
    merge.js
    csv.js
  features/
    browser-extension.js
    batch-search.js
    patent-find.js
    smart-extract.js
```

这是一张目标职责图，不是要求一次性创建全部文件。每个模块必须有明确 owner state、输入、输出、清理函数和测试。

## 6. 分阶段实施计划

### Phase 0：冻结基线与消除架构歧义

目标：任何参与者都知道只维护 Electron，并能重现当前行为。

任务：

1. 以当前 `main` 创建专用重构分支和基线 tag/commit。
2. 保留根 `AGENTS.md` 和 `docs/00-ACTIVE-ARCHITECTURE.md` 的 Electron-only 约束。
3. 确认 `src/web.html` 为唯一 Electron shell；决定 `src/index.html` 是删除、重定向还是仅保留开发用途。在决定前不得假设二者需要机械同步。
4. 记录 Node、Electron、Windows、Python/OCR 和构建环境版本。
5. 建立启动、搜索、打开阅读器、关闭应用的手工基线录像或截图。

退出条件：架构、入口、支持平台和回滚点都有书面记录。

### Phase 1：建立测试与可观测性（拆文件前必做）

目标：把“看起来能运行”变成可重复验收。

建议测试层级：

1. **静态门禁**：所有业务 JS `node --check`；检查 HTML 引用文件存在；检查 Electron 打包白名单包含新增模块。
2. **纯函数单测**：专利号解析、日期解析、HTML escape、图号链接、Markdown/Word 转换、抽取证据匹配。
3. **Renderer characterization tests**：使用 jsdom 或 Playwright + 本地 mock API，覆盖加载、模式切换、缓存恢复、事件委托。
4. **Electron smoke tests**：启动 Electron，确认 `web.html`、preload bridge、IPC、弹窗/下载主路径可用。
5. **契约 fixtures**：保存脱敏后的 US/EP/JP/DE/CN、Espacenet、GD、EPO Register 响应样本，测试解析结果不漂移。

必须新增的自动门禁：

- 未捕获异常和 console.error 计数；
- 关键 DOM id 存在性；
- 重复事件监听/重复初始化探测；
- 页面切换后遗留 timer/observer/request 探测；
- storage schema 快照；
- preload API 契约快照。

退出条件：核心 happy path 和至少一个失败/取消路径可自动验证。没有这一条件，不进入大规模拆分。

### Phase 2：生成依赖清单，不改行为

目标：用机器生成的清单替代易失效的手工行号。

产物：

- `function -> referenced globals -> called functions -> DOM selectors` 清单；
- 顶层 `let/const/var` 的读写者清单；
- event target/type/handler/owner 清单；
- timer/observer/abort controller 的创建与清理清单；
- localStorage/IndexedDB key 与数据形状清单；
- Electron bridge 和 HTTP endpoint 调用清单；
- 动态 HTML 的 id/class/data-action 清单；
- `web.html` 脚本加载顺序清单。

退出条件：每个候选模块都能列出其输入、输出、共享状态、事件和清理职责。

### Phase 3：先提取无状态叶子模块

优先顺序：

1. icons/constants；
2. 日期、HTML escape、clipboard fallback 等纯工具；
3. patent link/number 格式化；
4. Word 导出内部的 Markdown 解析纯函数；
5. 智能抽取的 evidence 匹配、CSV 序列化纯函数。

规则：

- 一次只提取一个小模块；
- 不改函数签名、返回值、DOM selector、错误文本和存储键；
- 不顺手格式化原文件；
- 不在搬迁时切换到 ES Modules；
- 每个提交比较拆分前后的函数级测试和 UI smoke 结果。

退出条件：工具模块有单测，`web-app.js` 行为零变化。

### Phase 4：提取平台与基础设施边界

目标：让业务代码不再直接散落访问 Electron、fetch 和存储细节。

候选边界：

- `platform/electron-bridge.js`：封装 `window.electronAPI` 能力检测与调用；
- `platform/local-api.js`：封装 GD/EPO/OCR/下载 endpoint；
- `state/lifecycle.js`：统一注册 timer、observer、AbortController 和 dispose；
- `dossier/cache.js`：保持原 schema 的缓存 facade。

注意：本阶段只引入 facade 并逐点替换，不能同时删除 Tauri 历史分支。Tauri 清理另设独立阶段和审批。

退出条件：新业务模块只能通过明确 facade 使用平台能力，且 Electron smoke test 通过。

### Phase 5：按完整业务纵切提取低至中风险功能

推荐顺序：

1. browser-extension 消息接入；
2. OPS/network settings；
3. batch-search + patent detail tabs/find；
4. merge export；
5. smart-extract；
6. PatentAsk；
7. analysis chat。

每个纵切必须一起迁移：状态、渲染、事件绑定、异步取消、错误处理、清理函数和测试，不能只搬函数体。

退出条件：模块可单独初始化和销毁；切换页面/专利/标签后不残留请求和监听。

### Phase 6：提取 Dossier 核心

顺序：

1. tabs/session；
2. cache/history；
3. document list；
4. kanban；
5. timeline；
6. review/cited analysis 与 trace。

重点验证多标签切换、缓存恢复、分析中断、选中文档集合、trace 跳转和历史记录兼容。

退出条件：Dossier 领域只有一个明确状态 owner，外部通过 API 读取/触发，不再直接任意改内部数组。

### Phase 7：提取 Reader/PDF 高风险域

这是最后处理的业务域，建议分为：

1. reader shell 和文档切换；
2. PDF loading/rendering；
3. TOC/search/navigation；
4. selection/context menu；
5. annotations persistence/export；
6. OCR jobs；
7. translation；
8. trace jump integration。

专项测试矩阵：缩放、适宽、滚动页码、文本块选择、框选、右键菜单、标注创建/编辑/删除/恢复、导出坐标、OCR 单页/范围/全文、取消、Reader 切文档、Dossier 切标签、窗口 resize、缓存恢复。

退出条件：PDF 状态和 DOM 生命周期由 reader 域统一管理，导出前后坐标结果一致。

### Phase 8：拆解 Word/PDF 导出大函数

`exportToWord` 当前从 L17675 开始，内部包含多组局部解析和文档构建函数；`exportPdfWithAnnotations` 约 1,424 行。两者应采用“先纯化、后编排”的方式：

- Markdown AST/行解析；
- trace label 转换；
- docx paragraph/table builders；
- document metadata/header/footer；
- PDF annotation coordinate mapping；
- resource loading；
- 最终 orchestrator。

必须使用 golden-file 或结构化快照比较拆分前后的 docx/PDF 内容、页数、文本、图片和标注位置。

退出条件：导出 orchestrator 控制在可读范围，转换逻辑可单测，产物视觉回归通过。

### Phase 9：最后处理初始化和共享状态

在所有功能模块已有 `init()/dispose()` 后，再把 L18090 起的巨型初始化拆成模块注册表。推荐：

```javascript
PatentLensApp.register(featureModule);
PatentLensApp.start();
```

启动器负责依赖顺序、重复初始化保护、失败隔离和统一清理。此时才评估把散落 globals 迁移到 `AppState`，每次只迁一个状态簇，并使用 getter/action 避免任意写入。

退出条件：`web-app.js` 只剩兼容入口或可以删除；启动顺序由一个清晰入口管理。

### Phase 10：独立的 Electron-only 遗留清理

仅在负责人明确批准后执行：

- 删除 `isTauri` / `tauriInvoke` 和所有不可达 Tauri 分支；
- 删除 package 中 Tauri scripts、CLI 依赖和 lockfile 条目；
- 决定是否整体移除 `src-tauri/`；
- 更新旧架构文档。

这一阶段不得与普通模块拆分合并，必须有 Electron 全量回归结果。

## 7. 每个拆分 PR/提交的固定模板

每次变更必须回答：

1. 搬走了哪些完整职责？
2. 模块拥有和修改哪些状态？
3. 它依赖哪些 DOM、全局变量、HTTP/IPC 和第三方库？
4. 注册了哪些事件、timer、observer、abort controller？何时清理？
5. 是否改变 script 顺序、经典脚本作用域或异步时序？
6. 自动测试覆盖哪些 happy/failure/cancel/switch 路径？
7. 手工 Electron 验证了哪些功能？
8. 如何用单个 revert 回滚？

提交粒度：一次一个模块或一个状态簇，禁止同时夹带新功能、UI 改版、依赖升级或大规模格式化。

## 8. 验收矩阵

最低全量回归范围：

- Electron 启动、关闭、强制关闭、焦点恢复；
- US/EP/JP/DE/CN 查询和错误降级；
- Espacenet/EPO/GD 路径；
- Dossier 多标签、新建/关闭/切换/缓存恢复；
- overview/timeline/documents/kanban/analysis 切换；
- 文档下载、OCR、翻译、PatentAsk、两类分析聊天；
- Reader 与 PDF 全工具链；
- Word、标注 PDF、合并、CSV 导出；
- history/cache/settings/OPS；
- batch search/detail find；
- smart extract；
- browser extension message；
- comparison、image annotations、agent 子系统未回归。

非功能验收：

- 无新增未捕获异常；
- 无重复监听和重复初始化；
- 无请求落入错误 tab/doc；
- 无 timer/observer/object URL 泄漏；
- 首屏、搜索、Reader/PDF 性能不劣化超过约定阈值；
- electron-builder 打包产物包含所有新增模块且可离线启动。

## 9. 明确禁止事项

- 不按旧文档静态行号直接剪切；
- 不一次性重写 22k 行；
- 不在拆分同时迁移到 React/Vue/TypeScript/ESM；
- 不把所有共享变量简单挂到 `window` 后宣称模块化完成；
- 不把事件绑定与其状态/清理逻辑拆到不同模块；
- 不修改 storage key 或缓存 shape；
- 不新增或同步 Tauri 实现；
- 不以 `node --check` 作为唯一验收；
- 不在没有自动化基线时先拆 PDF、缓存或主初始化。

## 10. 建议的成功指标

- 第一里程碑：测试与清单齐备，文件尚未大幅缩小也算成功；
- 第二里程碑：低风险模块迁出，`web-app.js` 低于 18k 行；
- 第三里程碑：Dossier/Analysis/Export 独立，低于 10k 行；
- 第四里程碑：Reader/PDF 和初始化完成，原文件低于 1k 行或删除；
- 每个阶段均保持 Electron 主路径、缓存兼容和导出产物稳定。
