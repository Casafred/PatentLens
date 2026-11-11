# 权利要求成图工作台

Patent2Pic 已作为 PatentLens Electron 的内置功能接入，无需单独安装、启动第二个服务或复制 API Key。前端沿用 Vue / X6 / ELK，按首次打开加载；构建后静态资源约 4.1 MB（未压缩）。

## 使用

1. 在 PatentLens 的 AI 设置中配置供应商、服务地址、模型和密钥。
2. 打开专利详情或专利弹窗，在权利要求页点击「权利要求成图」。
3. 勾选权利要求，打开工作台。只导入原文，点击「生成分解图」才请求 AI。
4. 拖动、编辑节点与关系，调整布局与样式；「AI 重构」基于当前手动编辑结果生成新版本。
5. 可导出 PNG、SVG、可交互 HTML、翻译 Excel，以及可再编辑的 `.p2p` 项目。工具栏「保存」下载 `.p2p`；外层「保存项目」立即保存到本机。
6. 「返回专利」保留工作台。再次打开同一文献、相同原文和相同权项选择，会恢复原有项目。顶部「成图工作台」可独立打开已有工作区或粘贴文本。

## 共用 AI 设置

默认跟随 PatentLens 当前供应商和模型。编辑器可覆盖模型选择、配置提示词与翻译选项，但密钥和服务地址统一由 PatentLens 管理。保存主应用 AI 设置后，工作台会更新配置；进行中的请求使用开始时的配置快照。

支持内置 OpenAI、DeepSeek、智谱，以及自定义 OpenAI Chat、Responses、Anthropic、Gemini 协议。接口需要支持对应协议的流式或 JSON 响应；浏览器直连服务还需允许本地源访问。

## 数据与兼容

- 每条导入权项保留文献号（包括 A1/B2）、原始编号、语言、来源、URL/文献标识及精确原文；编辑输入不覆盖来源快照。
- 工作区经 Electron IPC 写入 `userData/patent2pic/workspace.json`，不依赖本地 HTTP 端口或浏览器 localStorage。
- 每 5 秒保存当前画布，退出前再保存；写盘采用临时文件、fsync 和替换，保留 `.bak`。保存失败时会提示并阻止正常关闭。
- 工作区上限 32 MB；可导出 `.p2p` 后整理旧项目。主文件损坏时尝试备份并提示；全部损坏时保留原文件，不自动清空。
- `.p2p` 保留上游 1.2.0 的多文件、多版本结构，并支持旧版 tabs/单图导入。导入创建新项目。
- 多选权项分别批量成图；**不会自动解析引用链或合并从属权项与母项**。需要完整继承关系图时，先在输入中补充引用内容。
- 此功能生成的是可编辑的技术特征关系图；生成质量取决于模型、原文与提示词。

## 开发与验证

`npm install` 自动安装编辑器锁定依赖；`npm start` / `npm run dev` 自动构建编辑器。Electron Builder 的 `beforePack` 也构建编辑器，覆盖直接运行打包命令的 CI 场景。

```powershell
npm run verify:refactor
npm run build:patent2pic
npm run test:electron-smoke
npm run test:patent2pic-smoke
npx electron tests/patent2pic-production-smoke.cjs
npx electron-builder --win --x64 --publish never
```

专用 Electron 冒烟测试使用实际编辑器、X6、下载和 IPC，但模型由本地 HTTP fixture 提供。覆盖来源导入、非连续编号、生成、手动编辑、版本重构、批量任务、跨端口重启恢复、项目往返、PNG/SVG/HTML/Excel 导出、主应用自定义供应商配置刷新与密钥不写入工作区。单元测试另覆盖四种协议、UTF-8 分片、取消、错误与截断、存储恢复和来源快照。

生产入口测试运行真实 `electron-main.js`、HTTP 服务与关闭流程，包括保存失败时保留窗口、正常关闭时保存最后编辑。设置 `P2P_APP_ROOT` 为 `dist-electron/win-unpacked/resources/app.asar` 可验证打包内容。

人工验收时，用实际供应商检查一条结构权项和一条方法权项；再试编辑、重构、返回专利和重启恢复。自动测试不消耗用户额度，也不代表真实模型的语义准确率已验证。

修改范围为 Electron、独立功能模块和嵌入式编辑器；未修改冻结的 `src/scripts/web-app.js` 与 `src-tauri/`。上游来源见 `packages/patent2pic-editor/UPSTREAM.md`。
