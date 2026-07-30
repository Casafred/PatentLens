# PaddleOCR 同步→异步 API 迁移指南

> PaddleOCR 官方即将下线同步版面解析接口，仅保留异步 Job 模式。本文档梳理当前代码中所有 PaddleOCR 调用点，对比新旧 API 差异，并给出逐步迁移方案，确保切换后功能不中断。

---

## 1. 新旧 API 对照

| 对比项 | 旧接口（同步，即将下线） | 新接口（异步，官方唯一支持） |
|--------|------------------------|---------------------------|
| API 地址 | `https://k2neb1qcy1u6g4k5.aistudio-app.com/layout-parsing` | `https://paddleocr.aistudio-app.com/api/v2/ocr/jobs` |
| 请求方式 | 单次 POST，阻塞等待结果 | POST 提交 Job → 轮询 GET 查询状态 → 获取结果 |
| 认证头 | `Authorization: token {TOKEN}` | `Authorization: bearer {TOKEN}` |
| 文件上传 | JSON body 中 `file` 字段放 base64 | 本地文件用 multipart `file` 字段；URL 用 `fileUrl` 字段 |
| 模型指定 | 无（隐含 PaddleOCR-VL-1.5） | 必须指定 `model: "PaddleOCR-VL-1.6"` |
| 可选参数 | 直接放在 JSON body 顶层 | 放在 `optionalPayload` 对象中 |
| 响应格式 | 直接返回解析结果 | 返回 `jobId`，需轮询获取结果 |
| 结果获取 | 同一请求的响应体 | 完成后从 `resultUrl.jsonUrl` 下载 JSONL |
| 耗时 | 单次请求 30-180 秒 | 提交 <1s，处理 30-180 秒，轮询间隔 5s |
| 进度信息 | 无 | 有 `extractProgress`（totalPages / extractedPages） |

---

## 2. 当前代码调用点清单

### 2.1 Electron 主进程（Node.js）

**文件**: `electron-main.js`

| 函数 | 行号 | 说明 |
|------|------|------|
| `ocrWithPaddleVl(pdfBase64)` | ~214 | 核心调用函数，同步 POST 请求 |
| 常量 `PADDLE_OCR_VL_URL` | ~11 | 旧 API 地址 |
| 常量 `PADDLE_OCR_VL_TOKEN` | ~12 | Token（注意：旧用 `token` 前缀，新用 `bearer`） |

当前调用流程：
```
ocrWithPaddleVl(pdfBase64)
  → POST https://k2neb1qcy1u6g4k5.aistudio-app.com/layout-parsing
  → headers: Authorization: token {TOKEN}
  → body: { file: base64, fileType: 2, useDocOrientationClassify: true, ... }
  → 同步等待响应，解析 layoutParsingResults
  → 返回 { markdown, text, blocks, pageDimensions }
```

### 2.2 调用入口

| 调用位置 | 说明 |
|---------|------|
| `electron-main.js` ~786 | `ocrWithPaddleVl(pdfBase64)` 首选引擎 |
| `electron-main.js` ~802 | 自动降级时再次调用 |

### 2.3 响应解析逻辑（需保持兼容）

当前 `ocrWithPaddleVl` 解析旧 API 响应的关键逻辑：

```javascript
// 旧 API 响应结构
{
  errorCode: 0,
  result: {
    layoutParsingResults: [
      {
        markdown: { text: "..." },
        prunedResult: {
          width: 1190, height: 1684,
          parsing_res_list: [
            { block_content, block_label, block_bbox, block_id, block_order, group_id }
          ]
        }
      }
    ]
  }
}
```

---

## 3. 新 API 详细说明

### 3.1 提交 Job

**URL**: `POST https://paddleocr.aistudio-app.com/api/v2/ocr/jobs`

**认证**: `Authorization: bearer {TOKEN}`（注意是 `bearer`，不是 `token`）

#### 方式一：上传本地文件（multipart）

```javascript
const formData = new FormData();
formData.append("file", fileBuffer, { filename: "document.pdf" });
formData.append("model", "PaddleOCR-VL-1.6");
formData.append("optionalPayload", JSON.stringify({
  useDocOrientationClassify: false,
  useDocUnwarping: false,
  useChartRecognition: false,
}));

const response = await fetch(JOB_URL, {
  method: "POST",
  headers: { "Authorization": `bearer ${TOKEN}` },
  body: formData,
});
```

#### 方式二：通过 URL 引用

```javascript
const response = await fetch(JOB_URL, {
  method: "POST",
  headers: {
    "Authorization": `bearer ${TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    fileUrl: "https://example.com/document.pdf",
    model: "PaddleOCR-VL-1.6",
    optionalPayload: {
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      useChartRecognition: false,
    },
  }),
});
```

#### 提交响应

```json
{
  "data": {
    "jobId": "abc123"
  }
}
```

### 3.2 轮询 Job 状态

**URL**: `GET https://paddleocr.aistudio-app.com/api/v2/ocr/jobs/{jobId}`

**认证**: `Authorization: bearer {TOKEN}`

#### 状态值

| state | 含义 |
|-------|------|
| `pending` | 排队中 |
| `running` | 处理中，可查看进度 |
| `done` | 完成，可获取结果 |
| `failed` | 失败，查看 `errorMsg` |

#### 轮询响应（running 状态）

```json
{
  "data": {
    "state": "running",
    "extractProgress": {
      "totalPages": 10,
      "extractedPages": 5,
      "startTime": "2026-06-16T10:00:00Z"
    }
  }
}
```

#### 轮询响应（done 状态）

```json
{
  "data": {
    "state": "done",
    "extractProgress": {
      "extractedPages": 10,
      "startTime": "2026-06-16T10:00:00Z",
      "endTime": "2026-06-16T10:02:30Z"
    },
    "resultUrl": {
      "jsonUrl": "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs/abc123/result"
    }
  }
}
```

### 3.3 获取结果

从 `resultUrl.jsonUrl` 下载 JSONL 文件，每行一个 JSON 对象：

```jsonl
{"result":{"layoutParsingResults":[{"markdown":{"text":"...","images":{}},"outputImages":{}}]}}
{"result":{"layoutParsingResults":[{"markdown":{"text":"...","images":{}},"outputImages":{}}]}}
```

**关键差异**：新 API 结果是 JSONL 格式（每行一个页面的结果），旧 API 是一次性返回所有页面的 JSON。

---

## 4. 迁移方案

### 4.1 核心改造：`ocrWithPaddleVl` 函数

将同步调用改为"提交→轮询→取结果"三步异步流程，**保持函数签名和返回值不变**，上层调用无需修改。

```javascript
const PADDLE_OCR_V2_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
const PADDLE_OCR_V2_TOKEN = process.env.PADDLE_OCR_V2_TOKEN || "";
const PADDLE_OCR_V2_MODEL = "PaddleOCR-VL-1.6";
const POLL_INTERVAL = 5000;  // 轮询间隔 5 秒
const POLL_TIMEOUT = 300000; // 总超时 5 分钟

function ocrWithPaddleVl(pdfBase64) {
  return new Promise(async (resolve) => {
    try {
      // ===== 第一步：提交 Job =====
      const jobResult = await submitJob(pdfBase64);
      if (!jobResult || !jobResult.jobId) {
        return resolve({ markdown: "", text: "", blocks: [], pageDimensions: {} });
      }
      const jobId = jobResult.jobId;

      // ===== 第二步：轮询等待完成 =====
      const pollResult = await pollJobUntilDone(jobId);
      if (!pollResult || pollResult.state !== "done") {
        return resolve({ markdown: "", text: "", blocks: [], pageDimensions: {} });
      }

      // ===== 第三步：获取 JSONL 结果 =====
      const jsonlUrl = (pollResult.resultUrl || {}).jsonUrl || "";
      if (!jsonlUrl) {
        return resolve({ markdown: "", text: "", blocks: [], pageDimensions: {} });
      }

      const result = await fetchAndParseJsonl(jsonlUrl);
      resolve(result);
    } catch (e) {
      console.error("PaddleOCR V2 error:", e);
      resolve({ markdown: "", text: "", blocks: [], pageDimensions: {} });
    }
  });
}
```

### 4.2 提交 Job 实现

```javascript
function submitJob(pdfBase64) {
  return new Promise((resolve) => {
    // 将 base64 转为 Buffer
    const fileBuffer = Buffer.from(pdfBase64, "base64");

    // 构建 multipart body
    const boundary = "----FormBoundary" + Date.now();
    const parts = [];

    // model 字段
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${PADDLE_OCR_V2_MODEL}`
    );

    // optionalPayload 字段
    const optionalPayload = JSON.stringify({
      useDocOrientationClassify: true,
      useDocUnwarping: false,
      useChartRecognition: false,
    });
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="optionalPayload"\r\n\r\n${optionalPayload}`
    );

    // file 字段
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="document.pdf"\r\nContent-Type: application/pdf\r\n\r\n`
    );

    const headerBuf = Buffer.from(parts.join("\r\n"), "utf-8");
    const footerBuf = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
    const body = Buffer.concat([headerBuf, fileBuffer, footerBuf]);

    const urlObj = new URL(PADDLE_OCR_V2_URL);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: "POST",
      headers: {
        "Authorization": `bearer ${PADDLE_OCR_V2_TOKEN}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
      timeout: 30000,
    };

    const req = https.request(options, (resp) => {
      const chunks = [];
      resp.on("data", (chunk) => chunks.push(chunk));
      resp.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
          resolve(data.data || null);
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}
```

### 4.3 轮询 Job 状态

```javascript
function pollJobUntilDone(jobId) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    function poll() {
      if (Date.now() - startTime > POLL_TIMEOUT) {
        console.error("PaddleOCR V2 poll timeout");
        return resolve(null);
      }

      const urlObj = new URL(`${PADDLE_OCR_V2_URL}/${jobId}`);
      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: "GET",
        headers: {
          "Authorization": `bearer ${PADDLE_OCR_V2_TOKEN}`,
        },
        timeout: 10000,
      };

      const req = https.request(options, (resp) => {
        const chunks = [];
        resp.on("data", (chunk) => chunks.push(chunk));
        resp.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            const state = (data.data || {}).state;

            if (state === "done") {
              return resolve(data.data);
            } else if (state === "failed") {
              console.error("PaddleOCR V2 job failed:", (data.data || {}).errorMsg);
              return resolve(null);
            } else {
              // pending 或 running，继续轮询
              // 可选：上报进度 (data.data.extractProgress)
              setTimeout(poll, POLL_INTERVAL);
            }
          } catch (e) {
            resolve(null);
          }
        });
      });

      req.on("error", () => resolve(null));
      req.on("timeout", () => { req.destroy(); resolve(null); });
      req.end();
    }

    poll();
  });
}
```

### 4.4 解析 JSONL 结果

```javascript
function fetchAndParseJsonl(jsonlUrl) {
  return new Promise((resolve) => {
    const urlObj = new URL(jsonlUrl);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      timeout: 60000,
    };

    const req = https.request(options, (resp) => {
      const chunks = [];
      resp.on("data", (chunk) => chunks.push(chunk));
      resp.on("end", () => {
        try {
          const text = Buffer.concat(chunks).toString("utf-8");
          const lines = text.trim().split("\n").filter((l) => l.trim());

          const allMarkdown = [];
          const allText = [];
          const allBlocks = [];
          const pageDimensions = {};
          let pageNum = 0;

          for (const line of lines) {
            const parsed = JSON.parse(line);
            const results = (parsed.result || {}).layoutParsingResults || [];

            for (const r of results) {
              pageNum++;
              const md = (r.markdown || {}).text || "";
              if (md) allMarkdown.push(md);

              // 新 API 结果中可能没有 prunedResult，需要从 markdown 和 outputImages 推断
              // 如果有 prunedResult，保持原有解析逻辑
              const pruned = r.prunedResult || {};
              const pw = pruned.width || 0;
              const ph = pruned.height || 0;
              if (pw && ph) pageDimensions[pageNum] = { width: pw, height: ph };

              const parsingList = pruned.parsing_res_list || [];
              parsingList.forEach((block) => {
                const content = block.block_content || "";
                const label = block.block_label || "";
                const bbox = block.block_bbox || null;
                allBlocks.push({
                  block_id: `B_p${pageNum}_${block.block_id || allBlocks.length}`,
                  page: pageNum, label, content, bbox,
                  order: block.block_order || 0,
                  group_id: block.group_id || 0,
                });
                if (content && ["text", "title", "table", "formula"].includes(label)) {
                  allText.push(content);
                }
              });

              // 处理图片（如果需要保存到本地）
              const images = (r.markdown || {}).images || {};
              for (const [imgPath, imgUrl] of Object.entries(images)) {
                // 下载并保存图片（按需实现）
              }
            }
          }

          resolve({
            markdown: allMarkdown.join("\n\n---\n\n"),
            text: allText.join("\n"),
            blocks: allBlocks,
            pageDimensions,
          });
        } catch (e) {
          console.error("PaddleOCR V2 JSONL parse error:", e);
          resolve({ markdown: "", text: "", blocks: [], pageDimensions: {} });
        }
      });
    });

    req.on("error", () => resolve({ markdown: "", text: "", blocks: [], pageDimensions: {} }));
    req.on("timeout", () => { req.destroy(); resolve({ markdown: "", text: "", blocks: [], pageDimensions: {} }); });
    req.end();
  });
}
```

---

## 5. 关键差异与注意事项

### 5.1 认证头变更

```
旧: Authorization: token {PADDLE_OCR_TOKEN}
新: Authorization: bearer {PADDLE_OCR_TOKEN}
```

**注意**：Token 值不变，只是前缀从 `token` 改为 `bearer`。如果遗漏此修改，API 会返回 401。

### 5.2 模型版本变更

```
旧: 隐含 PaddleOCR-VL-1.5（无需指定）
新: 必须指定 model: "PaddleOCR-VL-1.6"
```

### 5.3 可选参数位置变更

```
旧: { file: base64, fileType: 2, useDocOrientationClassify: true, ... }  // 顶层
新: { model: "PaddleOCR-VL-1.6", optionalPayload: { useDocOrientationClassify: true, ... } }  // 嵌套
```

### 5.4 文件上传方式变更

```
旧: JSON body 中 file 字段放 base64 字符串
新: multipart/form-data 中 file 字段放二进制文件内容
```

这意味着不再需要在 JSON 中编码 base64，直接发送原始文件字节即可，**减少了约 33% 的请求体积**（base64 膨胀率）。

### 5.5 结果格式变更

```
旧: 单次 JSON 响应，所有页面在 result.layoutParsingResults 数组中
新: JSONL 文件，每行一个 JSON，每行包含一个页面的 result.layoutParsingResults
```

解析逻辑需要从"一次解析"改为"逐行解析再合并"。

### 5.6 超时处理

| 场景 | 旧 API | 新 API |
|------|--------|--------|
| 提交请求 | 180s 超时（包含处理时间） | 30s 超时（仅提交） |
| 等待结果 | 包含在上述 180s 中 | 轮询，总超时建议 5 分钟 |
| 下载结果 | 无需 | 60s 超时 |

### 5.7 进度上报（新增能力）

新 API 在 `running` 状态下返回 `extractProgress`，可向用户展示处理进度：

```javascript
// 可选：通过 IPC 向渲染进程发送进度
mainWindow.webContents.send("ocr-progress", {
  totalPages: extractProgress.totalPages,
  extractedPages: extractProgress.extractedPages,
});
```

### 5.8 错误处理

```
旧: HTTP 状态码非 200 或 errorCode !== 0
新: 
  - 提交失败: HTTP 状态码非 200
  - Job 失败: state === "failed"，查看 data.errorMsg
  - 轮询超时: 自行判断（POLL_TIMEOUT）
```

---

## 6. 迁移步骤（建议顺序）

### Step 1：添加新 API 函数，保留旧函数

在 `electron-main.js` 中新增 `ocrWithPaddleVlV2` 函数，**不修改** 旧 `ocrWithPaddleVl`。

### Step 2：添加开关控制

```javascript
const USE_PADDLE_V2 = true; // 切换开关

// 在调用处
if (USE_PADDLE_V2) {
  const r = await ocrWithPaddleVlV2(pdfBase64);
} else {
  const r = await ocrWithPaddleVl(pdfBase64);
}
```

### Step 3：验证新 API

- 用测试 PDF 文件调用新 API，确认返回结果格式正确
- 对比新旧 API 的 markdown 输出质量
- 确认 blocks / pageDimensions 解析无误

### Step 4：删除旧代码

确认新 API 稳定后，删除旧 `ocrWithPaddleVl` 函数和旧常量。

---

## 7. 完整新旧 API 请求对比

### 旧 API 请求（同步）

```javascript
// 请求
POST https://k2neb1qcy1u6g4k5.aistudio-app.com/layout-parsing
Authorization: token {PADDLE_OCR_TOKEN}
Content-Type: application/json

{
  "file": "<base64 encoded PDF>",
  "fileType": 2,
  "useDocOrientationClassify": true,
  "useDocUnwarping": false,
  "useLayoutDetection": true,
  "useChartRecognition": false,
  "layoutThreshold": 0.5,
  "prettifyMarkdown": true,
  "showFormulaNumber": false,
  "visualize": false
}

// 响应（单次返回）
{
  "errorCode": 0,
  "result": {
    "layoutParsingResults": [...]
  }
}
```

### 新 API 请求（异步）

```javascript
// 1. 提交 Job
POST https://paddleocr.aistudio-app.com/api/v2/ocr/jobs
Authorization: bearer {PADDLE_OCR_TOKEN}
Content-Type: multipart/form-data

--boundary
Content-Disposition: form-data; name="model"

PaddleOCR-VL-1.6
--boundary
Content-Disposition: form-data; name="optionalPayload"

{"useDocOrientationClassify":true,"useDocUnwarping":false,"useChartRecognition":false}
--boundary
Content-Disposition: form-data; name="file"; filename="document.pdf"
Content-Type: application/pdf

<binary PDF data>
--boundary--

// 响应
{ "data": { "jobId": "abc123" } }

// 2. 轮询状态
GET https://paddleocr.aistudio-app.com/api/v2/ocr/jobs/abc123
Authorization: bearer {PADDLE_OCR_TOKEN}

// 响应（完成时）
{
  "data": {
    "state": "done",
    "extractProgress": { "extractedPages": 10, "startTime": "...", "endTime": "..." },
    "resultUrl": { "jsonUrl": "https://...result" }
  }
}

// 3. 获取结果
GET https://...result

// 响应（JSONL，每行一页）
{"result":{"layoutParsingResults":[...]}}
{"result":{"layoutParsingResults":[...]}}
```

---

## 8. 可选参数映射

| 旧参数 | 新 optionalPayload 参数 | 默认值 | 说明 |
|--------|------------------------|--------|------|
| `useDocOrientationClassify` | `useDocOrientationClassify` | `false` | 文档方向分类 |
| `useDocUnwarping` | `useDocUnwarping` | `false` | 文档去弯曲 |
| `useChartRecognition` | `useChartRecognition` | `false` | 图表识别 |
| `useLayoutDetection` | ❌ 新 API 不支持 | - | 版面检测（可能已内置） |
| `layoutThreshold` | ❌ 新 API 不支持 | - | 版面检测阈值 |
| `prettifyMarkdown` | ❌ 新 API 不支持 | - | Markdown 美化（可能已内置） |
| `showFormulaNumber` | ❌ 新 API 不支持 | - | 公式编号 |
| `visualize` | ❌ 新 API 不支持 | - | 可视化图像 |
| `fileType` | ❌ 新 API 不需要 | - | 自动识别 |

**注意**：部分旧参数在新 API 中不再暴露，可能已作为默认行为内置。迁移时先不传这些参数，观察输出质量是否受影响。

---

## 9. 测试清单

- [ ] 提交 Job 成功返回 jobId
- [ ] 轮询状态正确返回 pending → running → done
- [ ] Job 失败时正确返回 failed + errorMsg
- [ ] JSONL 结果正确解析为 markdown / text / blocks / pageDimensions
- [ ] 多页 PDF 每页结果正确合并
- [ ] 中文内容正确识别（无乱码）
- [ ] 表格内容正确解析
- [ ] 公式内容正确解析
- [ ] 超时场景正确处理（轮询超时、网络断开）
- [ ] 与旧 API 输出质量对比无明显退化
- [ ] 前端展示无异常（溯源阅读器、AI 分析等下游功能）
