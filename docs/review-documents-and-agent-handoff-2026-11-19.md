# 审查文档访问与 Agent 材料交接复查

基线：`fad3184`（main，#127）。仅修改 Electron 链路；未修改冻结的
`web-app.js` 和 `src-tauri/`。

## 使用方式

1. 在时间轴或审查文档页点击「交给 Agent」，直接进入材料面板。
2. 默认包含全案时间轴、已选文档清单和可用 OCR。按需勾选 PDF，填写要求。
3. 点击「准备材料并拖给 Agent」，将文件卡片拖到外部 Agent 的上传区。
   一次拖出 `context.md` 和 PDF / 附图；ZIP 为另一种交接方式。
4. 下载失败的附件会在面板、上下文和清单中列明，可重试；不会标为完整。
5. 如需将分析结果保存回 PatentLens，展开可选区域创建审查分析任务，或继续已有任务。

文件交接包含已选 OCR、权项和说明书全文，复制预览仍采用原有长度限制。
ZIP / 文件夹另外包含来源清单和 SHA-256 校验记录。更改材料、指令或附件状态后，
旧文件卡片失效；异步准备完成时不能写入后来打开的另一个案卷面板。

## 网络排查与修正

| 问题 | 修正 |
| --- | --- |
| 登录等待、重试和多种 family 查询逐层叠加 | GD 阶段共享预算：JSON 35 秒、PDF 60 秒；token 等待约 4 秒，鉴权传播只在剩余预算内重试一次 |
| GD family 失败后 doclist 又等待同一失败路线 | 服务或鉴权失败后短暂跳过 GD（60 秒）；获取新 token 即恢复 |
| 相同点击分别触发 EPO 窗口 / 下载 | 合并整个代理请求，覆盖 GD 与 EPO 降级流程 |
| 重复查同族和文档列表 | 8 分钟会话缓存，最多 100 项 / 32 MB；错误不缓存 |
| 收到响应头后取消超时，文件 body 仍可一直等待 | Chromium 下载超时覆盖 body；EPO 查看器跳转共享下载预算 |
| 明确 EP 申请号仍搜索 Espacenet | 8 位 EP 申请号直接到 Register；公开号和其他局保留申请号解析路线 |
| 已解析 EPO 档案仍重新弹窗 | 复用真实档案 / PDF 链接和 Chromium session，暖会话先后台获取列表 |
| Chromium 失败后再用 curl 重复同样超时 | 正常 Chromium 网络超时直接进入可见验证路径；仅能力不可用时使用兼容兜底 |
| 页面加载时持续排队执行注入脚本 | GD token / EPO 工具栏轮询避开主框架加载，token 脚本读取另设短超时 |
| 不知道卡在哪个数据源 | 主进程发送 GD / EPO 阶段；响应头记录来源、缓存、耗时，前端保存最近 30 条诊断 |
| PDF 首次打开依赖 CDN | 随应用打包同版本 PDF.js 和 worker，两套 HTML shell 均使用本地文件 |

这些限制消除了应用内部重复等待；外部登录、Cloudflare 验证和专利局处理时间仍需单独观察。

## 验证证据

- 单元测试覆盖 GD→EPO 路由、登录后恢复、完整请求合并、缓存淘汰、body 卡顿超时、
  ZIP / 多文件交接、非法路径和大小限制、全文与字段别名、时间轴和旧任务兼容。
- `npm run test:document-workflow-smoke` 使用真实 `electron-main.js`、preload、HTTP 服务和 IPC，
  阻断所有外部 HTTPS 后仍能加载真实 PDF 和 worker。通过鼠标拖选及剪贴板读取验证选字，
  在 100% / 130% 下通过；扫描页没有伪造的原生文字层。
- 同一测试验证完整 OCR / 说明书末尾证据、全案时间轴、实际落盘文件、原生多文件拖拽 IPC、
  失败附件提示，以及材料变更 / 面板关闭时的旧包保护。
- `test:agent-handoff-smoke` 回归原文按钮无遮挡、悬浮工具栏 / 轮盘、阅读器问答 / OCR / 翻译
  的 Agent 返回采用流程、翻译加载球关闭、任务持久化；模型调用为 0。
- 同时执行 Electron 基础、权项对比、生图工作台 smoke 与 renderer 冻结 / 重构检查。

### 现场网络测试的边界

已打开真实 GD 登录窗口，页面到达 USPTO / Okta 登录页；尚未完成用户登录，
因此没有宣称已验证登录后的 GD 文档速度。

EP19703079 现场测试先复现 Espacenet Cloudflare 等待；修正后确认直接进入
`https://register.epo.org/application?number=EP19703079&lng=en&tab=doclist`。
该环境的新会话仍触发 Register Cloudflare，未完成人工验证时约 120.6 秒返回 503，
响应准确标记 `source=epo` / `cloudflare=true`。这不能证明验证后的 PDF 获取成功。
需要在测试窗口完成登录 / 验证，再以用户常用案卷补充冷、暖请求与 PDF 的实际耗时。

外部 Agent 接收文件后的理解能力及上传数量限制由对应 Agent 决定；本轮验证的是
PatentLens 的完整材料生成和 Electron 原生拖拽参数。截图与本机网络记录在忽略的
`.local-qa/document-workflow/`、`.local-qa/epo-live-result.json`，不随源码发布。
