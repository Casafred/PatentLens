# PatentLens - 专利审查文档获取与梳理工具

> **当前桌面架构：Electron。** `electron-main.js`、`preload.js` 和 `src/web.html` 构成正式运行链路。`src-tauri/` 仅为冻结的历史参考代码，不参与当前开发、运行或打包；新功能和缺陷修复不得同步修改 Tauri。详见 [`docs/00-ACTIVE-ARCHITECTURE.md`](docs/00-ACTIVE-ARCHITECTURE.md)。

一款面向专利从业人员的专业工具，支持从 USPTO/EPO/JPO/CNIPA 等专利局自动获取审查历史文档，通过看板式管理和 AI 智能分析，高效梳理审查意见、答复策略及引用文献。

---

## 功能概览

### 核心功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 多专利局查询 | ✅ | 支持 US / EP / JP / DE / CN 专利审查信息查询，自动识别专利号类型 |
| 审查文档获取 | ✅ | 通过 Global Dossier API 获取审查历史文档，自动分类归档 |
| 审查时间线 | ✅ | 按时间倒序展示审查事件，分类标记（审查意见/答复/授权/通知等） |
| 同族专利 | ✅ | IP5 五局同族审查信息展示 |
| AI 智能梳理 | ✅ | 支持 DeepSeek / 智谱 GLM / OpenAI 兼容 API，流式生成审查意见梳理报告 |
| OCR 文字提取 | ✅ | PaddleOCR-VL（免费）/ GLM OCR 双引擎，PDF 版面识别与文字提取 |
| 全文翻译 | ✅ | 独立翻译模型配置，全文合并翻译，流式实时显示 |
| 阅读模式 | ✅ | 沉浸式阅读，左侧收起 + 右侧 Tab 面板（翻译/AI 对话） |
| AI 文档对话 | ✅ | 基于当前文档内容与 AI 实时对话，流式响应 |
| Word 导出 | ✅ | 审查报告导出为 Word 文档，自动填充概览信息 |
| 溯源对照 | ✅ | AI 分析结果可溯源至原文位置，点击跳转对照阅读 |
| 浏览器扩展 | ✅ | Chrome 扩展，在 J-PlatPat / DPMA 网站一键跳转 PatentLens |

### 文档分类

自动识别并分类审查文档，支持 US / EP / JP / DE / CN 五局文档代码映射：

| 类型 | 说明 | 颜色标记 |
|------|------|----------|
| 审查意见 | 驳回、限制性要求等 | 红色 |
| 申请人答复 | 修改、意见陈述等 | 蓝色 |
| 授权通知 | 授权通知、授权决定等 | 绿色 |
| 申请人请求 | RCE、审查请求等 | 橙色 |
| 通知 | 官方通知类文件 | 灰色 |
| 其他文件 | 说明书、权利要求等 | 默认 |

---

## 技术架构

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | Electron | 跨平台桌面应用 |
| 前端 | HTML / CSS / JavaScript | 纯原生，无框架依赖 |
| PDF 渲染 | pdf.js + Canvas | PDF 文档在线渲染与 Block Overlay |
| Markdown | marked.js | 审查报告 Markdown 渲染 |
| Word 导出 | docx.js | 审查报告导出为 .docx |
| AI 服务 | DeepSeek / GLM / OpenAI | SSE 流式对话，支持自定义 Base URL |
| OCR | PaddleOCR-VL / GLM OCR | Python 调用，版面识别与文字提取 |
| 专利数据 | Global Dossier API | USPTO/EPO/JPO/CNIPA 代理获取 |
| 本地服务 | Node.js (Express) | 开发服务器 + API 代理 |

---

## 项目结构

```
PatentLens/
├── src/                              # 前端代码
│   ├── web.html                      # 主界面（看板 + 阅读器）
│   ├── index.html                    # 简版查询页面
│   ├── styles/main.css               # 暗色主题样式
│   └── scripts/
│       ├── web-app.js                # 主交互逻辑
│       ├── web-ai.js                 # AI 服务调用（DeepSeek/GLM/OpenAI）
│       ├── patent-status.js          # 文档分类与状态映射
│       ├── marked.min.js             # Markdown 渲染库
│       ├── docx.umd.js               # Word 导出库
│       └── FileSaver.min.js          # 文件保存库
├── src-tauri/                        # Tauri 后端（备选）
│   ├── src/api/                      # API 模块（USPTO/GD/JPO/DPMA）
│   ├── src/cache/                    # SQLite 缓存
│   ├── src/ocr/                      # OCR 模块
│   ├── src/parser/                   # 文档解析
│   └── src/patent/                   # 专利号转换
├── browser-extension/                # Chrome 浏览器扩展
│   ├── background.js                 # 后台脚本
│   ├── popup/                        # 扩展弹窗
│   └── content/                      # 内容脚本（J-PlatPat/DPMA）
├── docs/                             # 项目文档、说明书、参考资料
│   ├── manual/                       # 当前用户说明书与说明书图片
│   ├── manual/archive/               # 旧版说明书
│   ├── reference/                    # API、OCR、打包与实现参考
│   ├── research/                     # 抓取/调研资料
│   └── assets/                       # README 或文档截图资源
├── electron-main.js                  # Electron 主进程
├── extract_pdf.py                    # Python OCR 调用脚本
├── server.js                         # 本地开发服务器
├── requirements.txt                  # Python 依赖
└── package.json                      # Node.js 配置
```

---

## 快速开始

### 前置条件

- Node.js 18+
- Python 3.8+（OCR 功能需要）
- AI 服务 API Key（DeepSeek / 智谱 GLM / OpenAI 兼容，至少一个）

### 安装与运行

```bash
# 1. 克隆项目
git clone https://github.com/Casafred/history-helper.git
cd history-helper

# 2. 安装 Node.js 依赖
npm install

# 3. 安装 Python 依赖（OCR 功能）
pip install -r requirements.txt

# 4. 开发模式运行
node server.js
# 浏览器打开 http://localhost:8080
```

### Electron 桌面应用

```bash
# 开发模式
npm run dev

# 打包 Windows 安装程序
npm run build:electron
```

### 配置 AI 服务

首次使用需在设置页面配置 AI 服务：

1. 打开应用 → 点击右上角 ⚙️ 设置
2. 在 **AI 服务** Tab 中选择服务商并填入 API Key
3. 在 **OCR** Tab 中选择 OCR 引擎
4. 在 **翻译** Tab 中配置翻译模型（可独立于 AI 服务）
5. 在 **提示词** Tab 中自定义分析提示词

---

## 主要功能说明

### 1. 专利查询

输入专利号（如 `US12030161B2`、`EP4252965A3`），系统自动识别专利局和类型，获取审查历史文档。

### 2. AI 审查梳理

选择文档后点击"AI 梳理"，自动提取审查意见和答复内容，生成结构化梳理报告，支持溯源对照阅读。

### 3. OCR 文字提取

- **PaddleOCR-VL**：免费，无需 API Key
- **GLM OCR**：需要智谱 API Key，识别精度更高
- 自动清理 OCR 噪音符号（$ \Box $ → ☐ 等）

### 4. 全文翻译

- 独立翻译模型配置，默认模型：GLM → glm-4-flash，DeepSeek → deepseek-v4-flash
- 全文合并翻译，不分页不分块
- 流式实时显示翻译结果

### 5. 阅读模式

点击"翻译"或"AI 对话"按钮自动进入：
- 左侧文件列表自动收起
- PDF 阅读器向左扩展
- 右侧 Tab 面板显示翻译对照 / AI 对话
- 不遮挡 PDF 阅读区域

### 6. Word 导出

审查报告导出为 Word 文档，自动填充专利概览信息（专利号、标题、申请人、申请日等）。

---

## 支持的 AI 服务

| 服务商 | 默认分析模型 | 默认翻译模型 | Base URL |
|--------|-------------|-------------|----------|
| DeepSeek | deepseek-chat | deepseek-v4-flash | https://api.deepseek.com |
| 智谱 AI (GLM) | glm-4-plus | glm-4-flash | https://open.bigmodel.cn/api/paas |
| OpenAI 兼容 | gpt-4o | gpt-4o-mini | 可自定义 |

---

## 浏览器扩展

Chrome 扩展支持在以下网站一键跳转 PatentLens：

- **J-PlatPat**（日本专利局） — 专利详情页显示"在 PatentLens 中打开"按钮
- **DPMA**（德国专利局） — 专利详情页显示"在 PatentLens 中打开"按钮

安装方式：Chrome → 扩展程序 → 开发者模式 → 加载已解压的扩展程序 → 选择 `browser-extension/` 目录

---

## 许可证

内部使用。获取的专利文档仅限内部梳理使用，禁止对外传播或商用。
