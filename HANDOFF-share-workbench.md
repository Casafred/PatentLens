# 分享工作台 P0/P1 交接

## 已完成

- P0 标注体验：mousedown 保留选区，无选区即时反馈，按原始文本偏移处理重复文本和 HTML 特殊字符；AI 上下文包含 IPR 标注摘录。
- P0 AI 审核：AI 分析和加工字段默认为待审核；支持编辑、确认、退回草稿；存在未审核 AI 内容时发布页和实际导出都会阻断。
- P0 模块编排：加工模块按 `moduleOrder.processed` 真实影响预览和导出顺序；基础原文模块保持固定。
- P0 批量 AI：保留现有批量进度能力并接入新的审核状态。
- P1 项目分享设定：新增受众、分享目的、技术重点、保密范围，并注入 AI 上下文。
- P1 AI 加工：研发导向提示词和字段，包括一句话技术结论、核心方案、关键要素与参数、技术效果与证据、独立权项必要特征等，明确要求来源位置或待核验。
- P1 界面：研发洞察改为 AI 内容审核工作区；导航顺序和文案调整；加工模块可排序说明已收敛。

## 主要文件

- `src/scripts/app/share/share-project-store.js`
- `src/scripts/app/share/share-module-registry.js`
- `src/scripts/app/share/share-ai.js`
- `src/scripts/app/share/share-entry.js`
- `src/scripts/app/share/share-renderer.js`
- `src/web.html`
- `src/styles/main.css`
- `tests/share-project-store.test.cjs`

## 验证

- 5 个分享模块 `node --check`：通过。
- `git diff --check`：通过。
- `npm run verify:web-app`：通过，未修改冻结的 `src/scripts/web-app.js`。
- `npm test`：33/35 通过。失败项为已有服务器安全基线：服务器启动超时，以及 `file://` 代理请求返回 502 而测试期望 400；本次没有触及服务器代码。

## 后续建议

- 在 Electron 中手动确认：项目设定保存、AI 草稿编辑/确认/退回、未审核阻断、R2/R1 拖拽顺序、带 `&` 和重复文本的划线标注。
- 逐条标注删除入口已完成（见下节）；如继续优化，可补充完整的 Electron 自动化交互测试覆盖标注删除流程。
- 本轮明确不做 P2：协作、版本历史、多格式导出、组织模板、负责人/任务治理均未扩展。

## 本轮接手完成（2026-08-05）

- 逐条标注删除入口：在「内容加工与审核」的权利要求/说明书每段标注工具条下方，列出该段已有标注（类型徽标 + 文本片段 + 注释摘要 + 删除按钮），调用既有 `PatentShareStore.removeAnnotation(patentId, field, annotationId)` 逐条删除，删除前弹确认框，与其它破坏性操作一致。空列表不渲染。
- 标注偏移回归修复：`share-renderer.js` 中从属权利要求原先把 `escapeHtml(text)` 再交给 `applyAnnotationsToHtml`，导致偏移按转义后长度计算、特殊字符后定位漂移；改为与独立权项一致的原始文本输入。
- 新增 2 个 Node 级 characterization 测试（35→37 通过）：`removeAnnotation` 单条删除保留其余、从属权项标注按原始文本偏移；后者在未应用修复时会失败，作为回归守卫。
- 验证：`node --check` 通过；`npm run verify:web-app` 通过（未触及冻结的 `web-app.js`）；`npm test` 37/37 通过；`git diff --check` 通过。
- 改动文件：`src/scripts/app/share/share-entry.js`、`src/scripts/app/share/share-renderer.js`、`src/styles/main.css`、`src/web.html`（缓存版本号）、`tests/share-project-store.test.cjs`。
- 仍需人工在 Electron 中确认：逐条标注删除按钮的交互与渲染、删除后段落标注即时刷新。
