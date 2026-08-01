# web-app.js 拆分实施台账

> 基线：`main@e990b50769e042672772fd2ccc1d54a12095eaa9`  
> 架构：Electron-only  
> 原始行数：22,429

## 执行规则

- 每个批次只迁移一个有明确边界的模块或状态簇。
- 每批次记录来源、依赖、行为契约、验证命令和回滚范围。
- 前一批次未通过全部门禁，不开始下一批次。
- 不修改 `src-tauri/`，不在拆分中夹带功能变化。

## Batch 0：拆分防护基础设施

状态：已完成

新增：

- `scripts/verify-refactor.cjs`
- `tests/electron-smoke-main.cjs`
- `package.json` 中的 `test`、`test:electron-smoke`、`verify:refactor` 命令

门禁覆盖：

- 全部 `.js` / `.cjs` 语法检查；
- `src/web.html`、`src/index.html` 本地脚本存在性和重复引用检查；
- 拆出模块必须在 `web-app.js` 之前加载；
- electron-builder 必须包含 `scripts/app/**`；
- `package.json.main`、Electron 开发/构建命令、`web.html` 映射和 preload bridge 契约；
- 工作树和暂存区都不得修改 `src-tauri/`；
- 隐藏 BrowserWindow 的真实 Electron renderer/preload 烟测。

## Batch 1：提取共享 SVG 图标模块

状态：已完成

来源：原 `src/scripts/web-app.js` 的 `SVG_ICONS` 和 `icon()`。

目标：`src/scripts/app/shared/icons.js`

风险判断：低。

- 无 DOM 读取或写入；
- 无网络、IPC、缓存、timer、observer 或异步状态；
- 输入输出均为字符串；
- 保持 classic script 和原全局词法绑定语义；
- 同时更新两个 HTML 壳和 electron-builder 白名单。

行为契约：

- 初始 22 个图标 key 完整保留；
- 未知图标名回退到 `file`；
- 默认、`sm` 和额外 class 的替换行为不变；
- `web-app.js` 和后续脚本仍可直接调用 `icon()`。

验证结果：

- `npm run verify:refactor`：通过；
- 3 个 `node:test` 图标行为测试：通过；
- `npm run test:electron-smoke`：通过；
- Electron 中 `window.electronAPI`、`#patent-input` 和跨脚本 `icon()` 可访问性：通过；
- `src-tauri/` 变更：0。

回滚范围：

- 恢复 `web-app.js` 中的 `SVG_ICONS` / `icon()`；
- 删除 `src/scripts/app/shared/icons.js`；
- 删除两个 HTML 中的 icons script 标签；
- 删除 package build filter 中的 `scripts/app/**`（仅当不存在其他已提取模块时）。

## Batch 2：提取只读 Renderer 常量

状态：已完成

来源：原 `src/scripts/web-app.js` 的 `GD_API_BASE` 和 `OFFICE_NAMES`。

目标：`src/scripts/app/shared/constants.js`

风险判断：低。

- 全仓检查未发现重新赋值或对象成员写入；
- 仅被查询、展示和导出路径读取；
- 保持 classic script 全局词法绑定；
- 两个 HTML 壳均在 `web-app.js` 之前加载。

行为契约：

- `GD_API_BASE === "/api/gd"`；
- US/EP/JP/DE/KR/WO/WIPO/CN 的中文显示名称不变；
- Electron renderer 中两个绑定均可被后续 classic scripts 读取。

验证结果：

- `npm run verify:refactor:full`：通过；
- 5 个单元测试全部通过；
- 两个 HTML 壳均加载 26 个本地脚本且顺序检查通过；
- Electron renderer 中 `GD_API_BASE` 与 `OFFICE_NAMES.US` 读取正常；
- `src-tauri/` 变更：0。

Batch 2 完成后，`web-app.js` 为 22,382 行，相比原始基线减少 47 行。当前减少量不是主要成功指标；完整测试门禁和可回滚模块边界才是本阶段目标。

## Batch 3：提取文档日期纯函数

状态：已完成

来源：原 `src/scripts/web-app.js` 的 `parseDocDateToTimestamp()`。

目标：`src/scripts/app/shared/dates.js`

风险判断：低。

- 只依赖输入值、字符串转换、正则和 `Date`；
- 无 DOM、网络、IPC、缓存、timer、observer 或异步状态；
- 全仓检查确认没有同名重新赋值；
- 保持 classic script 全局词法绑定和原函数签名。

行为契约：

- 空值/空字符串返回 `0`；
- 优先保持原生 `Date` 解析；
- 支持年优先、日优先和点号分隔格式；
- 非法月份/日期继续按原实现回退到合法默认值；
- Electron renderer 中后续脚本仍可直接调用 `parseDocDateToTimestamp()`。

验证结果：

- `npm run verify:refactor:full`：通过；
- 9 个单元测试全部通过；
- 多格式日期样本和非法值样本通过；
- Electron renderer 日期调用结果与原实现一致；
- `src-tauri/` 变更：0。

Batch 3 完成后，`web-app.js` 为 22,368 行，相比原始基线减少 61 行。

## 下一批候选

Batch 4 只考虑低耦合共享工具，候选顺序：

1. `parseDate`，先固定时间线排序样本；
2. `escapeHtml`，需要固定浏览器 HTML 转义样本后再迁移；
3. 专利链接/号码格式化函数。

暂不允许：PDF、缓存、Dossier 状态、OCR、AI 流式处理、DOMContentLoaded、Tauri 历史分支。
