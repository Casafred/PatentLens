# web-app.js 新代码冻结规则

## 结论

`src/scripts/web-app.js` 已进入“只减不增”阶段。之后新增功能、缺陷修复、状态、事件监听、渲染函数和工具函数都不得继续写入该文件。

以后只允许两类操作：

1. 将已经迁移并验证完成的旧代码从 `web-app.js` 删除；
2. 在极少数经过明确批准的兼容性清理中删除旧分支。

新增代码统一放到：

```text
src/scripts/app/
  shared/       # 无状态共享工具、常量、纯函数
  platform/     # Electron bridge、本地 API、生命周期 facade
  features/     # 浏览器扩展、批量查询、智能抽取等完整功能
  dossier/      # Dossier、缓存、看板、时间线
  analysis/     # AI 分析、聊天、PatentAsk、溯源
  reader/       # Reader、PDF、OCR、翻译、标注
  export/       # Word、PDF、合并、CSV 导出
```

## 新功能提交流程

1. 先选择目标模块目录；如果没有合适目录，新增一个模块文件，不回写 `web-app.js`。
2. 在新模块中实现功能、状态、事件绑定和清理逻辑。
3. 在 `src/web.html` 和必要时 `src/index.html` 增加脚本标签，严格放在依赖之后。
4. 确认 `package.json` 的 electron-builder 已通过 `scripts/app/**` 包含模块。
5. 为新功能增加单测、契约测试或 Electron E2E 测试。
6. 执行 `npm run verify:refactor:full`。
7. 执行 `npm run verify:web-app`，确认 `web-app.js` 没有新增行。
8. 一个功能一个提交，提交内容不混入无关格式化或其他模块改造。

## 自动门禁

`scripts/guard-web-app.cjs` 有两种工作模式：

- 本地：`npm run verify:web-app`，比较当前工作树/暂存区与 `HEAD`；
- CI：根据 GitHub push 或 pull request 的基线 commit 比较整个提交范围。

只要 diff 中出现 `web-app.js` 的新增行，门禁立即失败。删除行是允许的，因为拆分阶段的目标就是将已迁移代码从旧文件移除。

## 为什么不能只依赖约定

仅在文档里写“以后不要继续写 web-app.js”很容易在修 bug 时被绕过。冻结门禁把这个错误变成提交前的明确失败，并给出新增行预览。这样后续开发者必须把代码放进可维护的模块，而不是为了快速修复再次扩大巨型文件。

## 例外

如果确实需要修改 `web-app.js` 的现有逻辑，必须先说明为什么无法迁移到模块，并由负责人明确批准。通常应先把相关旧代码整体迁移到模块，再在新模块中修改。

## AI 修复现有功能时的决策流程

门禁失败不代表功能不能修改，而是表示修改位置不正确。AI 或开发者应按以下顺序处理：

1. 定位 `web-app.js` 中承载该功能的完整函数、状态和事件监听。
2. 在 `src/scripts/app/**` 创建对应的功能模块，先保持原行为不变；需要的 Electron、API 或 DOM 依赖通过模块内部 facade 访问。
3. 在 HTML 壳中按依赖顺序加载新模块，补充行为契约测试或 Electron smoke 场景。
4. 从 `web-app.js` 删除已经迁移的旧实现，运行 `npm run verify:refactor:full`。
5. 在新模块中实施实际 bug 修复并增加回归测试；不要把修复重新写回 `web-app.js`。

如果门禁输出新增行预览，禁止反复重试同一处旧文件修改；应回到第 1 步。只有经过明确批准的兼容性清理才可以走例外流程，并且必须记录原因、验证结果和移除期限。

## 合并保障

`.github/workflows/verify-refactor.yml` 会在面向 `main` 的 pull request 上执行门禁。仓库管理员应将 `Verify Renderer Refactor` 设置为 main 分支的 required status check；这样即使 AI 忘记本地运行验证，也无法将新增代码合入主分支。
