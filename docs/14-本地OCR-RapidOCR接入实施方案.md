# 14 - 本地 OCR（RapidOCR）接入实施方案

> 状态：设计稿（未实施）
> 适用版本：PatentLens Electron 桌面端
> 目标：新增一个完全本地的 OCR 选项，用户选择后不发起任何云端 OCR 请求。

---

## 0. 结论摘要

1. **RapidOCR 本身只做“文本行检测 + 方向分类 + 识别”**，输出每行文本、四角坐标和置信度；它**不具备** PaddleOCR-VL 那种版面语义（标题、段落、表格、公式、阅读顺序）。
2. **RapidOCR Lite 存在**：`RapidAI/RapidOCRLite`（5.x 预发布，纯 C++ PP-OCRv6 引擎，零推理框架依赖，API 兼容 `rapidocr`）；另有 `model_type="lite"` 的内置 Indra 权重（约 17MB），但许可证为修改版 OpenRAIL-M，有商用限制。**本项目不应使用该 lite 权重，应使用 Apache-2.0 的 PP-OCRv6 small 模型。**
3. 要接近现有 PaddleOCR-VL 的“版面识别 + 文字提取”，有两条路：
   - **RapidLayout + RapidOCR**：版面框 + 行文本，阅读顺序/表格/公式需自行补。
   - **RapidDoc（`rapid-doc`）**：本地完整流水线，直接输出 Markdown/JSON，含版面、阅读顺序、表格、公式；更接近 PaddleOCR-VL，但依赖和模型体积大、CPU 较慢。
4. **推荐落地路径**：第一期用 `rapidocr` + `PyMuPDF` 做“混合本地引擎”（纯文本 PDF 走文字层，扫描页走 OCR），输出与云端完全一致的 `blocks / page_dimensions` 契约；第二期再按需接 RapidLayout 或 RapidDoc。
5. 当前 Electron 主进程**没有 Python 依赖**，OCR 全部由 JS 直接调用云端 API。引入本地 OCR 会重新引入 Python 运行时；要真正做到“内置、开箱即用”，需要随应用分发 **PyInstaller sidecar**，而不是要求用户自己 `pip install`。

---

## 1. 现状

### 1.1 两条 OCR 调用链

| 运行形态 | 入口 | OCR 实现 | 说明 |
|---|---|---|---|
| **Electron 生产版** | `electron-main.js` 的 `extractPdfText()` | `ocrWithPaddleVl()` / `ocrWithGlm()`，纯 JS HTTPS | 当前桌面端真正使用的链路 |
| 浏览器开发模式 | `server.js` 的 `/api/gd/extract-text` | `execFile("python3", ["extract_pdf.py", ...])` | README 里的 `node server.js` 开发模式 |
| Tauri 遗留版 | `src-tauri/` | Rust 实现 | **冻结，不修改** |

关键位置：

- Electron：`electron-main.js:3825` `extractPdfText`，`:4067-4093` 引擎分支，`:3294` `ocrWithPaddleVl`，`:3351` `ocrWithGlm`。
- 开发服务器：`server.js:2178-2323`，`extract_pdf.py:238-337`。
- 渲染层：`src/scripts/web-app.js:11139` `doExtractText`，`:10364` `extractDocumentText`，`:21549` `runExtractOcr`。
- 设置 UI：`src/web.html:848-879`，`src/index.html:729`（需确认是否镜像）。
- 第二个 OCR 入口：`preload.js:36` `ocrSharePdf` → `electron-main.js:5288`，当前固定调用 Paddle 云端。
- 现有 Python 依赖只有 `requests`（`requirements.txt`）。

> 注意：`docs/reference/OCR引擎调用逻辑文档.md` 描述的是另一套旧 Python 后端（`backend/utils/ocr_utils.py`），本仓库中不存在该目录。不要按那份文档直接接入。

### 1.2 下游依赖的数据契约

`extractPdfText` 返回给渲染层：

```json
{
  "text": "...",
  "markdown": "...",
  "engine": "paddle_ocr_vl",
  "char_count": 1234,
  "blocks": [
    {
      "block_id": "B_p1_0",
      "page": 1,
      "label": "text",
      "content": "...",
      "bbox": [x1, y1, x2, y2],
      "order": 0,
      "group_id": 0
    }
  ],
  "page_dimensions": { "1": { "width": 1654, "height": 2339 } },
  "ocr_pages": [1, 2]
}
```

硬性要求：

- `block_id` 必须是 `B_p{page}_{index}`，`page` 从 1 开始。
- `bbox` 是**渲染图像像素坐标**，必须落在 `page_dimensions` 范围内。
- `page_dimensions` 用于阅读器 OCR 框叠加与溯源高亮（`web-app.js:14086`），不能缺失或比例不一致。
- `blocks` 为空时，AI 分析会退化为纯文本模式，溯源标记失效。

### 1.3 架构约束

- `src/scripts/web-app.js` **禁止新增任何一行**，`npm run verify:web-app` 会检查。
- 新功能代码必须放到 `src/scripts/app/**`。
- Tauri 相关代码不得修改或扩展。
- 功能改动不得与大规模模块拆分混在一起；如必须改 `web-app.js`，要先完成有特征测试的完整切片提取。

---

## 2. 方案选型

| 方案 | 版面 | 表格/公式 | 阅读顺序 | 部署体积 | 与现有契约匹配 | 结论 |
|---|---|---|---|---|---|---|
| A. RapidOCR + PyMuPDF（混合） | ❌ | ❌ | 自建 XY-cut | 小（约 100–150MB） | 高 | **第一期推荐** |
| B. RapidOCR + RapidLayout | ✅ 框 | ❌ | 自建/按版面 | 中 | 高 | 第二期增强 |
| C. RapidDoc（`rapid-doc`） | ✅ | ✅ | ✅ | 大（数百 MB 模型） | 中，需要适配 JSON | 需要表格/公式时再上 |
| D. JS + onnxruntime-node 重写 | ✅ | ❌ | 自建 | 中 | 高 | **不推荐**，后处理工作量过大 |
| E. 继续仅云端 | ✅ | ✅ | ✅ | 0 | 现有 | 保留为备选 |

### 2.1 推荐

**第一期：方案 A。**

- 纯文本 PDF：用 PyMuPDF 直接读取文字层，速度快、坐标精确、不经过模型。
- 扫描页：渲染为图片后调用 RapidOCR。
- 两条路径统一进入“行排序 → 段落合并 → blocks/markdown”后处理。

这样能在不引入版面模型的前提下，先满足“离线、不调用 API、可溯源”的核心诉求。

### 2.2 明确不用

- 不使用 `RapidOCRLite` 5.x 作为生产依赖（预发布）。
- 不使用 `model_type="lite"` 的 Indra 权重（许可证限制）。
- 不在第一期引入 RapidDoc（体积、CPU、项目成熟度风险）。
- 不修改 Tauri。

---

## 3. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer (src/scripts/app/features/ocr-local-settings.js)   │
│  - 引擎下拉新增 rapidocr_local                              │
│  - 本地配置、状态检测、隐私提示                             │
│  - doExtractText 运输层守卫：本地模式下强制本地，禁止上云   │
└──────────────────────────┬──────────────────────────────────┘
                           │ GET /api/gd/extract-text/...?engine=rapidocr_local
┌──────────────────────────▼──────────────────────────────────┐
│ Electron main (electron-main.js)                            │
│  extractPdfText → if local → ocr-local.js                   │
│   - 下载/截取 PDF（复用现有逻辑）                            │
│   - 写临时文件，spawn sidecar / python3                      │
│   - 解析 JSON，映射 pageDimensions → page_dimensions         │
│   - 本地失败直接返回错误，绝不降级到云端                      │
└──────────────────────────┬──────────────────────────────────┘
                           │ spawn
┌──────────────────────────▼──────────────────────────────────┐
│ Sidecar (ocr_local.py / PyInstaller)                        │
│  PyMuPDF: 打开 PDF、取文字层、渲染页面                       │
│  RapidOCR: 扫描页文本检测+分类+识别                          │
│  统一后处理: XY-cut 阅读顺序、段落合并、Markdown            │
│  输出: text / markdown / blocks / page_dimensions           │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Python 后端设计

新建 `ocr_local.py`，作为独立入口，不放进 `extract_pdf.py`，避免云端路径被迫加载重依赖。

### 4.1 调用接口

```bash
python3 ocr_local.py \
  --pdf /tmp/patentlens_xxx.pdf \
  --dpi 200 \
  --model small \
  --mode auto \
  --max-pages 200
```

参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--pdf` | 必填 | 本地 PDF 路径 |
| `--dpi` | 200 | 渲染 DPI，建议 200；可选 150/250/300 |
| `--model` | `small` | PP-OCRv6 `tiny` / `small` / `medium` |
| `--mode` | `auto` | `auto` / `text` / `ocr`；`auto` 优先文字层 |
| `--max-pages` | 200 | 防止超大文档拖死进程 |
| `--lang` | `ch` | PP-OCRv6 small 支持中英等多语种 |
| `--no-cls` | false | 关闭方向分类可提速，但不建议 |

输出：**stdout 只输出一个 JSON**；日志一律写 stderr。

### 4.2 处理流水线

```
打开 PDF (PyMuPDF)
  │
  ├─ 加密 / 损坏 → 结构化错误
  │
  └─ 逐页
       ├─ 1. 取文字层 line/span + bbox（PDF 点坐标）
       ├─ 2. 判断文字层是否可用
       │      - 有效字符数 >= 20
       │      - 非空白字符占比 >= 60%
       │      - 行数 >= 2（封面/图页除外）
       ├─ 是 → source="text"
       └─ 否 → 渲染 pixmap(dpi) → RapidOCR → source="ocr"
       │
       ├─ 3. 统一 lines: [{text, bbox(px), score, source}]
       ├─ 4. XY-cut 阅读顺序
       ├─ 5. 行 → 段合并
       ├─ 6. 生成 blocks / markdown / text
       └─ 7. 记录 page_dimensions
```

### 4.3 文字层路径

- `page.get_text("dict")` 取 `blocks[].lines[].spans[]`。
- 拼接 span 文本为行文本；空行跳过。
- bbox 从 PDF 点坐标换算：`scale = dpi / 72`。
- `page_dimensions` 用 `round(rect.width * scale)` / `round(rect.height * scale)`，与后续 pixmap 尺寸保持一致。
- 字号可用于轻量标题判断：`max_span_size >= 1.2 * 页面中位字号` 且文本较短 → `label="title"`。
- 文字层路径不调用任何模型，适合绝大多数 USPTO/EPO 电子版审查意见。

### 4.4 OCR 路径

- 渲染：`fitz.Matrix(dpi/72, dpi/72)`，`colorspace=fitz.csRGB`，`alpha=False`。
- 转 NumPy：`np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)`。
- RapidOCR 初始化参数：
  ```python
  RapidOCR(params={
      "Det.model_type": model,      # tiny/small/medium
      "Rec.model_type": model,
      "Rec.lang_type": "ch",
  })
  ```
- 调用：`engine(img, use_det=True, use_cls=True, use_rec=True)`。
- 结果字段：`boxes`（N,4,2）、`txts`、`scores`。
- 过滤：`score < 0.5` 丢弃；文本为空丢弃。
- bbox 转轴对齐矩形：`[min(x), min(y), max(x), max(y)]`，并 clamp 到页面范围。
- 页面尺寸直接用 `pix.width / pix.height`。

### 4.5 阅读顺序

第一期内置轻量 XY-cut，不引入版面模型：

1. 若所有行在水平方向没有明显分栏间隙 → 按 `(y, x)` 排序。
2. 否则在区域内寻找最宽竖向空白带；若空白带宽度 ≥ 页面宽度的 2%，且两侧都有行 → 按左右分栏递归。
3. 先做横向分区（大竖向间距），再在分区内做分栏。
4. 输出顺序即 `blocks.order`。

> 已知限制：复杂三栏、跨栏表格、竖排文本仍可能错序。第一期以单栏/双栏审查意见为主，第二期用 RapidLayout 的版面框修正。

### 4.6 行 → 段合并

- 计算页面中位行高 `h`。
- 同一栏内，相邻行满足以下条件则合并：
  - 竖向间隙 `gap <= 0.8 * h`
  - 左边界差 `<= 1.5 * h`
  - 字号变化 < 20%
- 单块最大 1500 字符，超出强制截断。
- 块文本用 `\n` 连接，保留原始换行。
- `label` 默认 `text`；标题候选设为 `title`。
- `block_id = B_p{page}_{index}`，`index` 从 0 递增。
- `group_id = 0`，`order` 为全局阅读顺序。

### 4.7 输出契约

```json
{
  "text": "全文纯文本",
  "markdown": "段落间空行，页间 --- 分隔",
  "engine": "rapidocr_local",
  "char_count": 1234,
  "blocks": [
    {
      "block_id": "B_p1_0",
      "page": 1,
      "label": "text",
      "content": "...",
      "bbox": [120, 80, 1450, 130],
      "order": 0,
      "group_id": 0
    }
  ],
  "page_dimensions": {
    "1": { "width": 1654, "height": 2339 }
  },
  "meta": {
    "dpi": 200,
    "model": "PP-OCRv6_small",
    "pages": 5,
    "sources": { "1": "text", "5": "ocr" },
    "elapsed_ms": 4200,
    "warnings": []
  }
}
```

- 下游只依赖 `text/markdown/engine/blocks/page_dimensions`，`meta` 为新增调试字段，可忽略。
- `markdown` 页间分隔必须保持 `"\n\n---\n\n"`，与云端一致。
- 空页也要写入 `page_dimensions`，`blocks` 为空。

### 4.8 错误契约

所有可预期错误也要输出合法 JSON，便于 Node 统一处理：

```json
{
  "error": "本地 OCR 依赖未安装：请安装 rapidocr、onnxruntime、PyMuPDF",
  "error_code": "LOCAL_OCR_DEPS_MISSING",
  "engine": "none",
  "text": "",
  "markdown": "",
  "blocks": [],
  "page_dimensions": {}
}
```

错误码：

| code | 含义 |
|---|---|
| `LOCAL_OCR_DEPS_MISSING` | Python 包缺失 |
| `LOCAL_OCR_MODEL_MISSING` | 模型文件缺失（禁止静默联网下载） |
| `LOCAL_OCR_PDF_OPEN_FAILED` | PDF 无法打开 |
| `LOCAL_OCR_PDF_ENCRYPTED` | PDF 加密 |
| `LOCAL_OCR_PAGE_LIMIT` | 超过 `max-pages` |
| `LOCAL_OCR_TIMEOUT` | 子进程超时（由 Node 侧标记） |
| `LOCAL_OCR_EMPTY` | 全文档无文本 |
| `LOCAL_OCR_RUNTIME` | 模型推理异常 |

### 4.9 资源与性能

- 单进程串行逐页处理，避免 ONNX Runtime 多实例抢内存。
- 每页处理后释放 `pixmap` / `numpy` 引用。
- 200 DPI A4 单页图像约 11–12MB；20 页文档峰值可控。
- 参考性能：4 vCPU 上 PP-OCRv6 small 单页约 0.3–1.5 秒（取决于行数），另加 50–150ms 渲染。
- Node 侧串行化本地 OCR 任务，避免用户连续点击多个文档导致内存峰值。
- 超时：Node `spawn` 10 分钟；超时 `kill` 子进程并返回错误。

---

## 5. Electron 主进程设计

### 5.1 新模块 `ocr-local.js`

职责：

- 解析 sidecar / Python 运行方式。
- 检查可用性并返回状态。
- 构造命令行参数、写临时 PDF、spawn、收集 stdout/stderr。
- 解析 JSON、校验关键字段、映射为内部 camelCase。
- 串行队列与超时控制。

导出接口：

```js
isLocalOcrAvailable(): Promise<{ available, mode, version, error }>
getLocalOcrStatus(): Promise<Status>
ocrWithRapidLocal(pdfBuffer, options): Promise<{
  text, markdown, blocks, pageDimensions, error, errorCode, meta
}>
setLocalOcrOptions(options): void
```

运行方式解析：

1. 打包环境：`process.resourcesPath/ocr-sidecar/patentlens-ocr[.exe]`
2. 开发环境：`PATENTLENS_PYTHON || "python3"` + `ocr_local.py`
3. `PATENTLENS_OCR_DISABLE_LOCAL=1` 强制关闭

安全检查：

- 仅允许处理 `app.getPath("temp")` 下由主进程创建的临时 PDF。
- 不使用 shell，`spawn(cmd, args)`，参数数组化。
- 限制 PDF 大小（沿用现有文档大小限制）。
- 校验输出 JSON 的 `blocks` 数量、bbox 数值、`page_dimensions` 完整性。

### 5.2 `extractPdfText` 接入

在 `electron-main.js:3825` 的 `extractPdfText` 中，在现有 `ocrBuffer` / `pageMap` 计算之后、云端分支之前插入：

```js
if (engine === "rapidocr_local") {
  const local = await ocrWithRapidLocal(ocrBuffer, getLocalOcrOptions());
  if (local.error) {
    // 直接返回错误，禁止云降级
  } else {
    text = local.text;
    markdown = local.markdown;
    blocks = local.blocks;
    pageDimensions = local.pageDimensions;
    usedEngine = "rapidocr_local";
  }
  // 跳到 pageMap remap 与响应
}
```

要点：

- 本地引擎**不得**进入 `ocrWithPaddleVl` / `ocrWithGlm` 的兜底分支（`:4085`）。
- 返回错误时 `engine: "none"`，并附 `error_code`。
- `pageMap` remap 复用现有 `remapOcrResult`，它只改 `page` 和 `block_id` 页码，本地顺序号不受影响。
- 结果缓存：现有 `_ocrCacheKey` 只对 PDF 内容哈希，未区分引擎，存在跨引擎串结果风险。本地路径的缓存键必须加入 `engine + dpi + model + mode`；云端路径保持原样以免影响现有行为。
- 进度：现有接口是同步等待，无法上报页级进度；第一期沿用“处理中”。第二期可在 sidecar stderr 输出 `PROGRESS n/N`，主进程解析后通过 SSE 推送。

### 5.3 状态接口

新增：

```http
GET /api/ocr/local/status
```

响应：

```json
{
  "available": true,
  "engine": "rapidocr_local",
  "runner": "sidecar",
  "version": "3.9.2",
  "deps": {
    "rapidocr": true,
    "onnxruntime": true,
    "pymupdf": true
  },
  "model": "PP-OCRv6_small",
  "error": null
}
```

用于设置页“检测本地环境”按钮，也可在启动时探测并给出提示。

### 5.4 分享 OCR 入口

`electron-main.js:5288` 的 `ocr-share-pdf` 当前固定走 Paddle：

- 建议 `preload.js` 的 `ocrSharePdf` 增加可选 `{ engine, options }`。
- 用户当前引擎为本地时，分享 OCR 也走本地，避免隐私承诺被绕过。
- 若暂不改分享入口，必须在设置页明确说明“分享 OCR 仍使用云端”，否则属于隐性上传。

### 5.5 本地配置持久化

渲染层设置存在 `localStorage`，主进程读不到。建议：

- `preload.js` 增加：
  - `getLocalOcrStatus()`
  - `setLocalOcrOptions({ dpi, model, mode })`
- 主进程监听 IPC，写入 `app.getPath("userData")/ocr-local.json`，并用于文档 OCR 与分享 OCR。
- 浏览器开发模式没有 `electronAPI` 时，回退到 `localStorage` + 查询参数。

---

## 6. 渲染层设计

### 6.1 HTML

`src/web.html` 的 OCR 设置区（`:848-879`）新增：

```html
<select id="ocr-engine-select">
  <option value="paddle_ocr_vl">PaddleOCR-VL（免费，无需 Key）</option>
  <option value="glm_ocr">GLM OCR（需要智谱 API Key）</option>
  <option value="rapidocr_local">RapidOCR（本地离线，不上传文件）</option>
</select>

<div class="form-group" id="ocr-local-config-group" style="display:none">
  <label>本地 OCR 配置</label>
  <select id="ocr-local-dpi">
    <option value="150">150 DPI（快，适合清晰电子版）</option>
    <option value="200" selected>200 DPI（推荐）</option>
    <option value="250">250 DPI</option>
    <option value="300">300 DPI（慢，适合小字扫描件）</option>
  </select>
  <select id="ocr-local-model">
    <option value="tiny">PP-OCRv6 tiny（最快）</option>
    <option value="small" selected>PP-OCRv6 small（推荐）</option>
    <option value="medium">PP-OCRv6 medium（更准，更慢）</option>
  </select>
  <div id="ocr-local-status" class="test-result"></div>
  <button id="ocr-local-test-btn" class="btn-secondary" type="button">检测本地环境</button>
  <small>本地模式不会把 PDF 上传到任何云端服务。纯文本 PDF 优先读取文字层；扫描页在本机识别。</small>
</div>
```

同时检查 `src/index.html:729` 是否需要镜像（浏览器开发壳）。

### 6.2 `web-ai.js`

该文件未被冻结，可新增：

```js
var LOCAL_OCR_DEFAULTS = {
  dpi: 200,
  model: "small",
  mode: "auto",
  maxPages: 200,
};

function getLocalOcrConfig(config) { ... }
```

只新增读取/默认值，不改动现有 `getOCRConfig` 行为。

### 6.3 新模块 `src/scripts/app/features/ocr-local-settings.js`

职责：

- 监听 `#ocr-engine-select` 的 `change`：
  - 选中 `rapidocr_local` 时显示本地配置组，隐藏 Paddle 配置组。
  - 其他引擎恢复原有显示逻辑。
- 监听 `#ocr-save-btn`（在 `web-app.js` 的保存监听之后执行）：
  - 读取 DPI/模型，写入 `config.ocr.local`，调用 `saveAIConfig`。
  - 若 `window.electronAPI.setLocalOcrOptions` 存在，同步给主进程。
- 监听 `#ai-settings-btn` 的 `click`（在 `web-app.js` 的 `loadAISettingsToForm` 之后执行）：
  - 回填本地配置字段。
  - 若当前引擎是本地，立即探测状态。
- 点击“检测本地环境”调用 `/api/ocr/local/status`，展示可用性、版本、模型。
- 启动时探测一次；不可用时给出明确提示，但不擅自改用户选择。

### 6.4 运输层守卫（关键）

`web-app.js` 中存在多处自动降级：

- `:11380`、`:11754`、`:11771`、`:16214`、`:16225`、`:16378`、`:19090` 等。
- 逻辑为 `fallbackEngine = engine === "paddle_ocr_vl" ? "glm_ocr" : "paddle_ocr_vl"`。

如果用户选择本地，而本地失败，这些逻辑会把引擎切成 `paddle_ocr_vl`，**造成 PDF 静默上传**。必须在渲染层加运输层守卫，且不能改 `web-app.js`。

新模块中：

```js
(function () {
  var original = window.doExtractText;
  if (typeof original !== "function") return;

  window.doExtractText = function (...args) {
    var cfg = window.AI.getOCRConfig(window.AI.loadAIConfig());
    if (cfg.engine === "rapidocr_local") {
      // 参数位置：office, docNum, docId, pages, docFormat, engine, apiKey, ...
      args[5] = "rapidocr_local";
      args[6] = "";
    }
    return original.apply(this, args);
  };
})();
```

效果：

- 无论上层调用方传入 `glm_ocr` 还是 `paddle_ocr_vl`，只要用户当前选择是本地，实际请求都只会是本地。
- 自动重试会重复本地调用，但不会触网。
- 这是本项目已有的模块覆盖模式（`review-analysis-ocr-retry.js` 就是覆盖全局函数），符合现行约定。

另外：

- `runExtractOcr`（`web-app.js:21549`）直接读取 `ocrConfig.engine` 构造 URL，本身没有降级，天然正确。
- `review-analysis-ocr-retry.js` 可编辑，应同步修改降级链：本地模式只重试本地，不切云端。

### 6.5 重试策略

- 本地引擎的重试只对“推理临时失败”有意义；依赖缺失、加密 PDF 等硬错误不应重试。
- `review-analysis-ocr-retry.js` 中根据 `error_code` 提前终止：
  - `LOCAL_OCR_DEPS_MISSING` / `LOCAL_OCR_MODEL_MISSING` / `LOCAL_OCR_PDF_ENCRYPTED` → 不重试。
  - `LOCAL_OCR_TIMEOUT` / `LOCAL_OCR_RUNTIME` → 可重试 1 次。
- `web-app.js` 内的冻结重试循环无法感知 `error_code`，第一期接受“会多等几轮”，但绝不会上云；第二期随 OCR 路由切片提取一起治理。

### 6.6 冻结合规检查

最终必须满足：

```bash
npm run verify:web-app
```

即 `web-app.js` 净新增行数为 0。所有新增逻辑都在：

- `src/scripts/app/features/ocr-local-settings.js`
- `src/scripts/app/features/ocr-engine-guard.js`（可与上者合并）
- `src/scripts/web-ai.js`（新增配置 helper）
- `src/web.html` / `src/index.html`

---

## 7. 打包与分发

### 7.1 三种形态

| 形态 | 适用 | 优点 | 缺点 |
|---|---|---|---|
| **PyInstaller sidecar** | 正式发布 | 用户无需 Python，真正开箱即用 | 安装包增大，需分平台构建/签名 |
| 系统 Python + pip | 开发/高级用户 | 实现最简单 | 用户需装 Python 和依赖，不算“内置” |
| 下载本地 OCR 组件包 | 可选 | 主安装包轻 | 首次使用仍需联网下载，违背离线初衷 |

**正式版推荐 sidecar。**

### 7.2 Sidecar 构建

新增 `requirements-ocr-local.txt`（锁定版本）：

```
rapidocr==3.9.2
onnxruntime==1.22.*
PyMuPDF==1.26.*
numpy>=1.26,<3
```

> 版本以实现时最新稳定 3.x 为准；不要使用 5.x 预发布。

PyInstaller：

```bash
pyinstaller --noconfirm --onedir --name patentlens-ocr \
  --collect-all rapidocr \
  --collect-all onnxruntime \
  --hidden-import fitz \
  ocr_local.py
```

注意：

- `--onedir` 比 `--onefile` 启动快，且便于检查模型文件。
- `rapidocr` 的 `models/*.onnx` 和 `config.yaml` 必须打进产物；构建后检查 `dist/patentlens-ocr/rapidocr/models/`。
- `onnxruntime` 的 DLL/dylib 必须完整；在无 Python 的干净机器上验证。
- 关闭任何首次运行自动下载行为：启动前检查模型文件，缺失则返回 `LOCAL_OCR_MODEL_MISSING`。
- 预估体积：解压后约 120–180MB（rapidocr 包约 27MB + onnxruntime + PyMuPDF + OpenCV headless + 依赖）。
- 分平台构建：Windows x64（当前 `package.json` 仅配置 win nsis）、macOS arm64/x64、Linux（如需）。
- macOS 需要逐个签名内嵌 dylib 并公证；当前构建配置未覆盖 macOS，属于新增工作。

### 7.3 electron-builder

`package.json` 的 `build`：

```json
{
  "extraResources": [
    {
      "from": "dist/ocr-sidecar",
      "to": "ocr-sidecar"
    }
  ],
  "files": [
    "ocr-local.js",
    "..."
  ]
}
```

运行时解析：

```js
const exe = process.platform === "win32" ? "patentlens-ocr.exe" : "patentlens-ocr";
const sidecar = path.join(process.resourcesPath, "ocr-sidecar", exe);
```

### 7.4 许可证

- RapidOCR：Apache-2.0。
- PP-OCRv6 模型：随 PaddleOCR 生态，Apache-2.0。
- 禁止内置 Indra “lite” 权重（修改版 OpenRAIL-M，含收入/竞品限制）。
- 在 `NOTICE` 或关于页补充 RapidOCR / PaddleOCR 归属说明。

### 7.5 版本与回归

- 锁定 `rapidocr`、`onnxruntime`、`PyMuPDF` 版本，升级前跑完整 OCR 回归集。
- 模型文件记录 SHA256，构建时校验。

---

## 8. 浏览器开发模式对齐（可选）

`server.js` + `extract_pdf.py` 是开发模式链路，可选但建议对齐：

- `extract_pdf.py` 新增 `rapidocr_local` 分支，懒加载 `ocr_local` 模块，避免影响云端路径。
- `server.js` 透传 `ocrDpi` / `ocrModel` 环境变量。
- `server.js` 的 `execFile` 超时从 5 分钟提高到 10 分钟（仅本地引擎）。
- 如果决定不维护开发模式 parity，需在 README 明确：本地 OCR 仅 Electron 版可用，避免两条链路行为不一致。

---

## 9. 测试计划

### 9.1 Python 单元/集成

用 `node:test` 驱动 Python 脚本（项目已用 `node:test`，不额外引入 pytest）：

1. **文字层 PDF**：用 `pdf-lib` 动态生成两页带坐标的 PDF，断言：
   - 不进入 OCR（`meta.sources` 全为 `text`）
   - `blocks` 数量、`bbox` 缩放正确
   - `page_dimensions` 与 DPI 换算一致
2. **扫描页 PDF**：使用仓库内小体积扫描样本，断言：
   - `source="ocr"`
   - 至少 N 个 block
   - 所有 bbox 在页面范围内
3. **双栏样本**：断言左栏块的 `order` 全部先于右栏。
4. **空页/纯图页**：不崩溃，返回空 blocks。
5. **加密 PDF**：返回 `LOCAL_OCR_PDF_ENCRYPTED`。
6. **缺依赖**：模拟 ImportError，返回 `LOCAL_OCR_DEPS_MISSING`。
7. **页数上限**：超过 `max-pages` 返回 `LOCAL_OCR_PAGE_LIMIT`。

### 9.2 Node 单元

新增 `tests/ocr-local.test.cjs`：

- 纯函数：
  - `normalizeLocalResult(raw)`：snake_case → camelCase。
  - `validateLocalResult(result, pageCount)`：bbox/尺寸/ID 校验。
  - `buildLocalArgs(options)`。
  - `resolveLocalOnly(engine, userConfig)`：策略判定。
- 注入假 runner（输出固定 JSON 的脚本）测试：
  - 正常解析。
  - 非 JSON 输出。
  - 超时 kill。
  - 非零退出码。
  - 超大 stdout。
- 缓存键：同一 PDF、不同 dpi/model/engine 不命中同一缓存。

### 9.3 渲染层

- `tests/ocr-local-settings.test.cjs`（vm 加载模块）：
  - 默认配置。
  - 选中本地时显示/隐藏配置组。
  - 保存后 `config.ocr.local` 正确。
  - 运输层守卫：当配置为本地时，调用 `doExtractText` 传入 `glm_ocr`，实际参数被改写为 `rapidocr_local`。
- 回归：`review-analysis-ocr-retry.js` 本地模式只重试本地。

### 9.4 Electron 冒烟

- `GET /api/ocr/local/status` 在无依赖时返回 `available:false` 且不崩溃。
- 有 sidecar 时返回 `available:true`。
- 可选：启动后跑一个 1 页文字层 PDF，断言返回 `engine=rapidocr_local`。

### 9.5 手动回归清单

| 场景 | 检查点 |
|---|---|
| 纯文本 USPTO Office Action | 不触发 OCR，block 文本正确，阅读器高亮对齐 |
| 扫描版 EPO 文档 | OCR 文本可用，bbox 不越界 |
| 双栏文档 | 阅读顺序正确，AI 引用不串栏 |
| 含表格页 | 至少文字可提取；表格结构不保证 |
| 中文 CNIPA 文档 | 中文识别正常 |
| 指定页 OCR（pageRange） | 页码 remap 正确，block_id 页号正确 |
| 断网 | 本地引擎仍可用；选择本地时无任何云端请求 |
| 超长文档 | 触发页数上限或超时，错误可读，应用不崩 |
| 分享 OCR | 与当前引擎策略一致，或明确提示仍走云端 |

### 9.6 验收指标

- `npm test` 通过。
- `npm run verify:web-app` 通过，`web-app.js` 净新增 0 行。
- `npm run test:electron-smoke` 通过。
- 本地模式下抓包/网络面板确认无 `paddleocr.aistudio-app.com` / `open.bigmodel.cn` 请求。
- 20 页电子版 PDF：本地处理 < 5 秒，block 数合理。
- 20 页扫描 PDF：4 核 CPU 目标 < 90 秒（需实测校准）。
- 阅读器 OCR 框与原文对齐，无系统性偏移。
- 纯文本样本字符召回率 ≥ 98%；扫描样本人工抽检可读率 ≥ 90%。

---

## 10. 实施阶段与任务拆解

### P0 技术验证（不改产品代码）

- 在目标机器安装 `rapidocr + onnxruntime + PyMuPDF`。
- 用 3 类样本验证：电子版、扫描版、双栏。
- 记录耗时、内存、阅读顺序问题、中文/英文准确率。
- 确认 PP-OCRv6 small 模型随 wheel 内置、离线可用。
- 产出一页验证报告，决定 DPI 默认值和是否需要 RapidLayout。

**退出条件**：扫描件文本可读、单页耗时满足预算、模型完全离线。

### P1 Python 后端

- 新建 `ocr_local.py`，实现第 4 节流水线。
- 新建 `requirements-ocr-local.txt`。
- 完成文字层、OCR、XY-cut、段落合并、错误码。
- 用 Node 测试脚本跑通 JSON 契约。

**退出条件**：第 9.1 全部通过。

### P2 Electron 主进程

- 新建 `ocr-local.js`（runner 解析、spawn、超时、队列、校验）。
- `electron-main.js` 接入 `rapidocr_local` 分支，禁止云降级。
- 新增 `/api/ocr/local/status`。
- 缓存键加入引擎/参数。
- 处理 `pageRange` remap。
- 分享 OCR 入口策略（本地或显式提示）。

**退出条件**：第 9.2、9.4 通过；本地请求不触网。

### P3 设置 UI 与运输层守卫

- 修改 `src/web.html`（及 `src/index.html` 如需）。
- `web-ai.js` 新增本地配置 helper。
- 新建 `src/scripts/app/features/ocr-local-settings.js`。
- 新建/合并 `ocr-engine-guard.js`。
- 更新 `review-analysis-ocr-retry.js` 降级策略。
- 状态检测、隐私提示、错误提示。

**退出条件**：第 9.3 通过；`verify:web-app` 通过。

### P4 打包

- 编写 sidecar 构建脚本 / PyInstaller spec。
- `package.json` 增加 `extraResources`、files、构建脚本。
- 在无 Python 的干净 Windows 机器验证。
- 校验模型文件、版本、许可证。
- macOS/Linux 如需，补充分平台构建与签名。

**退出条件**：安装包在干净机器上可选择本地引擎并完成 OCR。

### P5 增强（按需）

- 接入 RapidLayout：版面框 + 阅读顺序 + 标题/表格区域。
- 评估 RapidDoc：表格/公式场景是否值得引入。
- 页级进度上报。
- 页眉页脚过滤、跨页段落合并。
- 将冻结的 OCR 路由切片正式提取到 `src/scripts/app/features/ocr-*`，消除运输层 wrapper。

---

## 11. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 阅读顺序错误（双栏/表格） | AI 引用串栏、结论错误 | 第一期 XY-cut + 双栏测试；第二期 RapidLayout |
| 表格/公式无法结构化 | 表格页信息丢失 | 明确不支持；需要时切云端或 RapidDoc |
| Python sidecar 体积大 | 安装包显著增大 | 独立组件包/按需下载；或在设置中说明 |
| Python 运行时安全与维护 | 漏洞、版本漂移 | 锁定版本、最小依赖、不执行用户输入脚本 |
| macOS 签名/公证 | 无法分发 | 单独规划签名流水线 |
| `web-app.js` 冻结 | 无法直接修标签/重试 | 新模块 wrapper；第二期切片提取 |
| 云端静默降级 | 隐私承诺被破坏 | 主进程 + 渲染层双重禁止 |
| 缓存串结果 | 不同引擎结果混用 | 本地缓存键加入引擎与参数 |
| 模型首次联网下载 | 离线环境失败 | 模型随包分发，缺失即报错 |
| 大文档超时/内存 | 应用卡死 | 串行队列、页数上限、10 分钟 kill |
| Lite 许可证 | 商用合规风险 | 禁用 Indra 权重，仅用 Apache-2.0 模型 |
| 开发模式与 Electron 行为不一致 | 测试误判 | 对齐 server.js 或明确仅 Electron 支持 |

### 回滚策略

- 移除下拉选项即可关闭功能；默认引擎仍是 `paddle_ocr_vl`，无数据迁移。
- sidecar 不打包时，`/api/ocr/local/status` 返回不可用，不影响现有云端流程。
- 不修改现有云端函数，回滚无需还原云端逻辑。

---

## 12. 明确不做

- 不修改 `src-tauri/` 或新增 Tauri 命令。
- 不在第一期引入版面/表格/公式模型。
- 不自动把用户从云端切换到本地，也不在本地失败时自动切回云端。
- 不实现浏览器端 WASM OCR；RapidOCRWeb 是 Python 本地 Web 壳，不是 JS 包。
- 不将 `RapidOCRLite` 预发布版作为生产依赖。
- 不使用 `model_type="lite"` 的 Indra 权重。

---

## 13. 附录

### 13.1 参考链接

- RapidOCR：https://github.com/RapidAI/RapidOCR
- 安装文档：https://rapidai.github.io/RapidOCRDocs/main/install_usage/rapidocr/install/
- 模型列表：https://rapidai.github.io/RapidOCRDocs/main/model_list/
- 使用文档：https://rapidai.github.io/RapidOCRDocs/main/install_usage/rapidocr/usage/
- RapidOCRLite：https://github.com/RapidAI/RapidOCRLite
- RapidLayout：https://github.com/RapidAI/RapidLayout
- RapidDoc：https://pypi.org/project/rapid-doc/
- RapidOCRPDF：https://github.com/RapidAI/RapidOCRPDF

### 13.2 关键字段映射

| Python 输出 | Electron 内部 | 前端最终字段 |
|---|---|---|
| `page_dimensions` | `pageDimensions` | `page_dimensions` |
| `blocks[].bbox` | 同名 | 同名 |
| `blocks[].block_id` | 同名 | 同名 |
| `char_count` | 同名 | 同名 |
| `meta` | 同名 | 可选透传 |

### 13.3 关键文件清单

新增：

- `ocr_local.py`
- `ocr-local.js`
- `requirements-ocr-local.txt`
- `scripts/build-ocr-sidecar.*`
- `src/scripts/app/features/ocr-local-settings.js`
- `src/scripts/app/features/ocr-engine-guard.js`
- `tests/ocr-local.test.cjs`
- `tests/ocr-local-python.test.cjs`
- `tests/ocr-local-settings.test.cjs`

修改：

- `electron-main.js`（接入分支、状态接口、分享 OCR 策略）
- `preload.js`（本地 OCR 状态/配置 IPC）
- `package.json`（extraResources、构建脚本）
- `src/web.html`、`src/index.html`（引擎选项与配置组）
- `src/scripts/web-ai.js`（本地配置 helper）
- `src/scripts/app/features/review-analysis-ocr-retry.js`（本地降级策略）
- `server.js`、`extract_pdf.py`（可选，开发模式 parity）
- `README.md`（安装/离线说明）

禁止修改：

- `src/scripts/web-app.js`（净新增行必须为 0）
- `src-tauri/**`
