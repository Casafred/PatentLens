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
- 若继续优化，优先补充分享工作台的 Electron 交互测试和逐条标注删除入口。
- 本轮明确不做 P2：协作、版本历史、多格式导出、组织模板、负责人/任务治理均未扩展。
