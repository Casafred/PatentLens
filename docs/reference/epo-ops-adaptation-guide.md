# EPO OPS API 适配说明文档

> **目标**：将 EPO OPS（Open Patent Services）作为 Google Patents 的降级查询源。当 Google Patents 抓取失败（404 / 网络错误 / 内容为空）时，自动切换到 OPS 查询，并返回与现有 `renderPatentDetail(data)` 完全兼容的 JSON 结构，前端无需任何改动即可渲染。
>
> **适用范围**：本项目（PatentLens）的 Node.js 代理层 `server.js` + 前端 `src/scripts/web-app.js`。
>
> **认证前提**：用户已拥有 EPO OPS 的 `consumer key` 和 `consumer secret`。

---

## 一、项目现状与适配目标

### 1.1 现有 Google Patents 查询链路

```
前端 web-app.js                    Node.js server.js                  外部
─────────────────                  ─────────────────                  ─────────
searchPatentDetail(input)
  ├─ parsePatentNumber(input)        /api/gp/{patentNumber}
  ├─ fetch(gpApiUrl(raw))    ──────►  scrapeGooglePatent()
  │                                    ├─ normalizePatentNumber()
  │                                    ├─ curl https://patents.google.com/patent/{id}
  │                                    ├─ extractPatentFromHtml(html)
  │                                    └─ { success:true, data:{...}, patent_number }
  └─ renderPatentDetail(json.data)
```

**关键代码位置**：

- 前端入口：[src/scripts/web-app.js#L401](file:///workspace/src/scripts/web-app.js#L401) `searchPatentDetail(input)`
- URL 构造：[src/scripts/web-app.js#L129](file:///workspace/src/scripts/web-app.js#L129) `gpApiUrl(patentNumber)` → `/api/gp/{patentNumber}?proxy=1&proxyUrl=...`
- 后端路由：[server.js#L1151](file:///workspace/server.js#L1151) `/api/gp/` → `scrapeGooglePatent()`
- 后端抓取：[server.js#L1048](file:///workspace/server.js#L1048) `scrapeGooglePatent(patentNumber, res, useProxy, proxyUrl)`
- HTML 解析：[server.js#L391](file:///workspace/server.js#L391) `extractPatentFromHtml(html, patentId)`

### 1.2 现有数据结构（`renderPatentDetail` 期望的字段）

`extractPatentFromHtml` 返回的对象结构（[server.js#L401-L426](file:///workspace/server.js#L401)），OPS 适配器**必须输出完全相同的结构**：

```javascript
{
  patent_number: "US12345678B2",        // 专利号（含国家代码+kind code）
  title: "...",                          // 标题（英文）
  abstract: "...",                       // 摘要
  url: "https://patents.google.com/...", // Google Patents 链接
  pdf_link: "https://...",               // PDF 下载链接（可空）
  application_date: "YYYY-MM-DD",        // 申请日
  publication_date: "YYYY-MM-DD",        // 公开日
  priority_date: "YYYY-MM-DD",           // 优先权日（可空）
  inventors: ["Name1", "Name2"],         // 发明人列表
  assignees: ["Company1"],               // 申请人/受让人列表
  drawings: ["https://...", ...],        // 附图 URL 列表
  patent_citations: [                    // 引用文献（向后引用）
    {
      patent_number: "US...",
      title: "...",
      publication_date: "...",
      assignee: "...",
      link: "https://patents.google.com/patent/...",
      citation_type: "examiner" | "applicant"
    }
  ],
  cited_by: [...],                       // 被引用文献（同上结构）
  similar_documents: [...],              // 相似文献（同上结构）
  classifications: [                     // CPC 分类
    { code: "H04L9/40", description: "..." }
  ],
  claims: [                              // 权利要求
    { num: 1, type: "independent"|"dependent", text: "..." }
  ],
  description: "...",                    // 说明书全文（HTML 或纯文本）
  events_timeline: [                     // 法律事件时间线
    { date: "...", code: "...", description: "...", category: "..." }
  ],
  legal_events: [...],                   // 法律事件（同上）
  family_id: "...",                      // 同族 ID
  family_applications: [...],            // 同族申请列表
  country_status: [...],                 // 各国状态
  external_links: {                      // 外部链接
    ep_register: { url: "...", text: "EP Register" },
    uspto: { url: "...", text: "USPTO" }
  },
  landscapes: []                         // 专利景观（可空）
}
```

### 1.3 适配目标

1. **零前端改动**：OPS 返回的 JSON 必须与 `extractPatentFromHtml` 输出结构一致，`renderPatentDetail` 直接消费。
2. **自动降级**：Google Patents 返回 404 / 空内容 / 网络错误时，自动调用 OPS，前端无感知。
3. **配置化**：OPS 的 `consumer_key` / `consumer_secret` 通过环境变量注入，不硬编码。
4. **可观测**：日志中明确标注数据来源（GP / OPS），便于排查。

---

## 二、EPO OPS API 概览

### 2.1 基本信息

| 项目 | 值 |
|------|-----|
| 生产环境 Base URL | `https://ops.epo.org/3.2/rest-services` |
| 测试环境 Base URL | `https://ops.epo.org/3.2/rest-services`（同一地址，按配额区分） |
| 认证方式 | OAuth 2.0 Client Credentials Grant |
| Token 端点 | `https://ops.epo.org/3.2/auth/accesstoken` |
| 返回格式 | XML（默认）/ JSON（部分端点支持 `Accept: application/json`） |
| 文档地址 | https://www.epo.org/searching-for-patents/data/coverage/ops.html |
| 每周配额 | 匿名 50MB / 注册用户 10GB / 商业用户更高 |

### 2.2 OAuth 2.0 认证流程

OPS 使用 Client Credentials Grant，**无需用户参与**，适合服务端调用。

**请求**：
```
POST https://ops.epo.org/3.2/auth/accesstoken
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(consumer_key:consumer_secret)

grant_type=client_credentials
```

**响应**：
```json
{
  "access_token": "xxxxx...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**关键点**：
- `Authorization` 头是 `Basic base64(consumer_key:consumer_secret)`，**不是**直接传 key/secret。
- Token 有效期 1 小时（3600 秒），需缓存并在过期前 5 分钟刷新。
- consumer_key 末尾通常需要追加 `@` 前缀的版本号（视注册情况而定），实测时按实际 key 使用即可。

### 2.3 核心端点清单（与本项目字段映射）

OPS 端点格式：`{base}/published-data/publication/epodoc/{number}/{component}`

| OPS 端点 | 返回内容 | 映射到本项目字段 |
|---------|---------|----------------|
| `/published-data/publication/epodoc/{num}/biblio` | 著录项目（标题、申请人、发明人、日期、分类号、引用文献） | `title`, `inventors`, `assignees`, `application_date`, `publication_date`, `priority_date`, `classifications`, `patent_citations`, `cited_by`, `family_id` |
| `/published-data/publication/epodoc/{num}/abstract` | 摘要 | `abstract` |
| `/published-data/publication/epodoc/{num}/claims` | 权利要求全文 | `claims[]` |
| `/published-data/publication/epodoc/{num}/description` | 说明书全文 | `description` |
| `/published-data/publication/epodoc/{num}/images` | 附图缩略图信息 | `drawings[]` |
| `/published-data/publication/epodoc/{num}/equivalent` | 同族等效文献 | `family_applications[]`, `country_status[]` |
| `/family/publication/epodoc/{num}` | 简单同族（INPADOC） | `family_id`, `family_applications[]` |
| `/published-data/publication/epodoc/{num}/legal` | 法律状态 | `legal_events[]`, `events_timeline[]` |
| `/register/publication/epodoc/{num}/events` | 注册簿法律事件（仅 EP 有效） | `legal_events[]`（EP 专利补充） |
| `/published-data/search/?q=ct={num}` | **向前引用查询**（谁引用了本专利，CQL 检索） | `cited_by[]` |
| `/published-data/publication/docdb/{country}.{num}.{kind}/images` | 文档可用性信息（总页数、各部分页码范围） | PDF 下载前置 |
| `/published-data/images/{country}/{num}/{kind}/fullimage.pdf?Range={N}` | **单页 PDF**（逐页获取） | `pdf_link`（需后端合并） |

**号码格式**：OPS 使用 `epodoc` 格式，例如 `US12345678B2`、`EP4252965A1`、`WO2024123456A1`。与本项目 `parsePatentNumber` 输出的格式基本兼容，但需去除空格和多余分隔符。

> **重要说明**：
> - `biblio` 端点返回的 `references-cited` 节点只包含**向后引用**（本专利引用了哪些文献，即 `patent_citations`）。
> - **向前引用**（谁引用了本专利，即 `cited_by`）必须通过 CQL 搜索端点 `q=ct={num}` 单独查询。
> - PDF 下载需两步：先查 `images` 端点获取总页数和各部分页码范围，再逐页请求 `fullimage.pdf?Range=N`，最后后端合并为完整 PDF。

---

## 三、降级触发逻辑设计

### 3.1 触发条件

在 `scrapeGooglePatent` 中，以下情况触发 OPS 降级：

| 情况 | 当前行为 | 改造后行为 |
|------|---------|-----------|
| Google Patents 返回 HTTP 404 | 直接返回 `{ success:false, error }` | **触发 OPS 降级** |
| Google Patents 返回 HTTP 429 | 返回 429 错误 | 不降级（限流应让用户等待） |
| Google Patents 返回 200 但 body < 1000 字符 | 尝试下一个 variant | 所有 variant 都失败后**触发 OPS 降级** |
| Google Patents 返回 200 但 `extractPatentFromHtml` 无 title 且无 abstract | 返回 404 | **触发 OPS 降级** |
| curl 网络错误（超时/DNS） | 尝试下一个 variant | 所有 variant 都失败后**触发 OPS 降级** |

### 3.2 降级流程

```
scrapeGooglePatent(patentNumber, res, useProxy, proxyUrl)
  ├─ 尝试所有 GP variants
  │   ├─ 成功 → 返回 { success:true, data, source:"gp" }
  │   └─ 失败 → 继续尝试
  ├─ 所有 GP variants 失败
  ├─ 检查 OPS 是否配置（consumer_key/secret 存在）
  │   ├─ 未配置 → 返回原 404 错误
  │   └─ 已配置 → 调用 queryOpsPatent(patentNumber)
  ├─ queryOpsPatent
  │   ├─ getOpsToken()
  │   ├─ 并发请求 biblio + abstract + claims + description + images + equivalent + legal
  │   ├─ 解析 XML → 转换为本项目 JSON 结构
  │   └─ 返回 { success:true, data, source:"ops" }
  └─ 返回结果（成功或失败）
```

### 3.3 响应头标识

为便于前端调试（可选），在响应中增加 `X-Data-Source` 头：

```
X-Data-Source: gp    # 数据来自 Google Patents
X-Data-Source: ops   # 数据来自 EPO OPS（降级）
```

前端 `searchPatentDetail` 无需改动，但可在 loading 文案中体现（可选增强，非必须）。

---

## 四、后端实现方案（Node.js server.js）

### 4.1 新增模块结构

在 `server.js` 中新增以下函数（保持与现有 `proxyJpoDoc` / `proxyDpmaRegisterInfo` 相同的代码风格，使用 `execFile("curl", ...)`）：

```
server.js
├── 现有代码...
├── // ── EPO OPS proxy ──
├── const OPS_API_BASE = "https://ops.epo.org/3.2/rest-services";
├── const OPS_AUTH_URL = "https://ops.epo.org/3.2/auth/accesstoken";
├── let opsAccessToken = null;
├── let opsTokenExpires = 0;
├── function getOpsToken()              // 获取/缓存 OAuth token
├── function opsRequest(path)            // 单个 OPS 端点请求（返回 XML 字符串）
├── function queryOpsPatent(number, res) // 主入口：并发请求 + XML→JSON 转换
├── function parseOpsBiblio(xml)         // 解析 biblio XML
├── function parseOpsAbstract(xml)       // 解析 abstract XML
├── function parseOpsClaims(xml)         // 解析 claims XML
├── function parseOpsDescription(xml)    // 解析 description XML
├── function parseOpsImages(xml)         // 解析 images XML → 拼接图 URL
├── function parseOpsEquivalent(xml)     // 解析同族 XML
├── function parseOpsLegal(xml)          // 解析法律状态 XML
└── function buildOpsPatentData(...)     // 组装最终 JSON 结构
```

### 4.2 环境变量配置

在 `server.js` 启动时读取（与现有 `JPO_API_USERNAME` 风格一致）：

```javascript
const OPS_CONSUMER_KEY = process.env.OPS_CONSUMER_KEY || "";
const OPS_CONSUMER_SECRET = process.env.OPS_CONSUMER_SECRET || "";
```

**启动命令示例**：
```bash
OPS_CONSUMER_KEY="your_key" OPS_CONSUMER_SECRET="your_secret" node server.js
```

### 4.3 OAuth Token 获取与缓存

参考现有 `getJpoToken()`（[server.js#L152](file:///workspace/server.js#L152)）的实现模式：

```javascript
async function getOpsToken() {
  if (!OPS_CONSUMER_KEY || !OPS_CONSUMER_SECRET) return null;

  // 缓存未过期则直接返回
  if (opsAccessToken && Date.now() < opsTokenExpires) return opsAccessToken;

  const credentials = Buffer.from(`${OPS_CONSUMER_KEY}:${OPS_CONSUMER_SECRET}`).toString("base64");
  const body = "grant_type=client_credentials";

  const result = await new Promise((resolve) => {
    execFile("curl", [
      "-s", "-w", "\n__HTTP_CODE__%{http_code}",
      "--max-time", "15",
      "-X", "POST",
      "-H", `Authorization: Basic ${credentials}`,
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "-d", body,
      OPS_AUTH_URL,
    ], { maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const marker = "\n__HTTP_CODE__";
      const idx = stdout.lastIndexOf(marker);
      let httpCode = 200;
      let jsonBody = stdout;
      if (idx !== -1) {
        httpCode = parseInt(stdout.substring(idx + marker.length), 10);
        jsonBody = stdout.substring(0, idx);
      }
      if (httpCode !== 200) { resolve(null); return; }
      try { resolve(JSON.parse(jsonBody)); } catch { resolve(null); }
    });
  });

  if (!result || !result.access_token) return null;
  opsAccessToken = result.access_token;
  opsTokenExpires = Date.now() + ((result.expires_in || 3600) - 300) * 1000; // 提前 5 分钟过期
  return opsAccessToken;
}
```

### 4.4 单端点请求封装

```javascript
function opsRequest(path) {
  return new Promise(async (resolve) => {
    const token = await getOpsToken();
    if (!token) { resolve(null); return; }

    const url = `${OPS_API_BASE}${path}`;
    execFile("curl", [
      "-s", "-w", "\n__HTTP_CODE__%{http_code}",
      "--max-time", "30",
      "-H", `Authorization: Bearer ${token}`,
      "-H", "Accept: application/xml",   // OPS XML 返回更稳定，JSON 支持不完整
      url,
    ], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const marker = "\n__HTTP_CODE__";
      const idx = stdout.lastIndexOf(marker);
      let httpCode = 200;
      let body = stdout;
      if (idx !== -1) {
        httpCode = parseInt(stdout.substring(idx + marker.length), 10);
        body = stdout.substring(0, idx);
      }
      if (httpCode !== 200) { resolve(null); return; }
      resolve(body);
    });
  });
}
```

### 4.5 主入口：并发请求 + 组装

```javascript
async function queryOpsPatent(number, res) {
  console.log(`[OPS] 开始查询: ${number}`);

  // 号码规范化：去除空格，转大写
  const num = number.toUpperCase().replace(/[\s\/]/g, "");

  // 并发请求所有端点（失败的端点返回 null，不影响其他）
  const [biblio, abstract, claims, description, images, equivalent, legal] = await Promise.all([
    opsRequest(`/published-data/publication/epodoc/${encodeURIComponent(num)}/biblio`),
    opsRequest(`/published-data/publication/epodoc/${encodeURIComponent(num)}/abstract`),
    opsRequest(`/published-data/publication/epodoc/${encodeURIComponent(num)}/claims`),
    opsRequest(`/published-data/publication/epodoc/${encodeURIComponent(num)}/description`),
    opsRequest(`/published-data/publication/epodoc/${encodeURIComponent(num)}/images`),
    opsRequest(`/published-data/publication/epodoc/${encodeURIComponent(num)}/equivalent`),
    opsRequest(`/published-data/publication/epodoc/${encodeURIComponent(num)}/legal`),
  ]);

  // 至少要有 biblio（标题/申请人等基础信息）
  if (!biblio) {
    res.writeHead(404, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "X-Data-Source": "ops",
    });
    res.end(JSON.stringify({
      success: false,
      error: `OPS 未找到专利: ${num}`,
      patent_number: num,
    }));
    return;
  }

  const data = buildOpsPatentData(num, biblio, abstract, claims, description, images, equivalent, legal);

  if (!data.title && !data.abstract) {
    res.writeHead(404, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "X-Data-Source": "ops",
    });
    res.end(JSON.stringify({
      success: false,
      error: `OPS 数据解析为空: ${num}`,
      patent_number: num,
    }));
    return;
  }

  console.log(`[OPS] 查询成功: ${num}, title=${data.title?.substring(0, 50)}`);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "X-Data-Source": "ops",
  });
  res.end(JSON.stringify({ success: true, data, patent_number: num }));
}
```

### 4.6 降级接入点

修改 `scrapeGooglePatent`（[server.js#L1111-L1113](file:///workspace/server.js#L1111)）的失败分支：

```javascript
// 原代码：
res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
res.end(JSON.stringify({ success: false, error: `未找到专利: ${patentNumber}`, patent_number: normalized }));

// 改造为：
console.log(`[GP] 所有 variants 失败，尝试 OPS 降级: ${patentNumber}`);
if (OPS_CONSUMER_KEY && OPS_CONSUMER_SECRET) {
  await queryOpsPatent(normalized, res);
} else {
  res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify({ success: false, error: `未找到专利: ${patentNumber}（OPS 未配置，无法降级）`, patent_number: normalized }));
}
```

**注意**：`scrapeGooglePatent` 当前是 `(async () => { ... })()` 包裹的，可以直接在内部 `await`。失败分支位于 IIFE 内部，改造时确保 `await queryOpsPatent(...)` 在 IIFE 作用域内。

---

## 五、XML 解析与字段映射

### 5.1 XML 解析方案选择

OPS 返回 XML（`application/xml`），需在 Node.js 中解析。**推荐方案**：

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| `fast-xml-parser` | 纯 JS、零依赖、性能好、支持属性 | 需新增依赖 | ⭐⭐⭐⭐⭐ |
| 正则提取 | 无依赖 | 脆弱、XML 嵌套复杂时易错 | ⭐⭐ |
| `xml2js` | 老牌稳定 | 回调风格、性能一般 | ⭐⭐⭐ |

**推荐使用 `fast-xml-parser`**，与项目现有"零依赖 + curl"风格略有冲突，但 XML 解析用正则不可靠。安装：

```bash
npm install fast-xml-parser
```

若坚持零依赖，可用 Node.js 内置的字符串解析 + 正则做**最小化解析**（仅提取本项目需要的字段），但维护成本高。

### 5.2 OPS XML 命名空间

OPS XML 使用大量命名空间，解析时需处理：

```xml
<ops:world-patent-data xmlns:ops="http://ops.epo.org"
                       xmlns:ft="http://www.epo.org/fulltext"
                       xmlns:reg="http://www.epo.org/register"
                       xmlns="http://www.epo.org/exchange">
  ...
</ops:world-patent-data>
```

`fast-xml-parser` 配置建议：

```javascript
const { XMLParser } = require("fast-xml-parser");
const parser = new XMLParser({
  ignoreAttributes: false,        // 保留属性（如 lang、status）
  removeNSPrefix: true,           // 去除命名空间前缀，简化访问
  isArray: (name) => [            // 这些节点强制为数组（即使只有一个）
    "inventor", "applicant", "classification-ipcr",
    "priority-claim", "citation", "family-member",
    "claim", "claim-text", "p", "img",
    "publication-reference", "application-reference"
  ].includes(name),
});
```

### 5.3 各端点字段映射详解

#### 5.3.1 biblio → 基础信息

**OPS XML 结构**（简化）：
```xml
<ops:world-patent-data>
  <exchange-document country="US" doc-number="12345678" kind="B2">
    <bibliographic-data>
      <invention-title lang="en">Title here</invention-title>
      <parties>
        <applicants>
          <applicant app-type="applicant" data-format="epodoc">
            <applicant-name><name>COMPANY INC</name></applicant-name>
          </applicant>
        </applicants>
        <inventors>
          <inventor data-format="epodoc">
            <inventor-name><name>DOE JOHN</name></inventor-name>
          </inventor>
        </inventors>
      </parties>
      <dates-of-public-availability>
        <publication-reference>
          <document-id><date>20230101</date></document-id>
        </publication-reference>
      </dates-of-public-availability>
      <application-reference>
        <document-id><date>20200101</date></document-id>
      </application-reference>
      <priority-claims>
        <priority-claim sequence="1">
          <document-id><date>20191201</date></document-id>
        </priority-claim>
      </priority-claims>
      <classifications-ipcr>
        <classification-ipcr><text>H04L9/40</text></classification-ipcr>
      </classifications-ipcr>
      <references-cited>
        <citation cited-by="examiner">
          <patcit><document-id><doc-number>US5555555</doc-number></document-id></patcit>
        </citation>
      </references-cited>
    </bibliographic-data>
  </exchange-document>
</ops:world-patent-data>
```

**映射函数**：
```javascript
function parseOpsBiblio(xml) {
  const obj = parser.parse(xml);
  const doc = obj["world-patent-data"]?.["exchange-document"];
  if (!doc) return null;

  // 处理可能是数组或单对象的情况
  const exDoc = Array.isArray(doc) ? doc[0] : doc;
  const biblio = exDoc["bibliographic-data"] || {};
  const parties = biblio["parties"] || {};

  // 日期格式：OPS 返回 YYYYMMDD，需转为 YYYY-MM-DD
  const formatDate = (d) => {
    if (!d || d.length !== 8) return "";
    return `${d.substring(0,4)}-${d.substring(4,6)}-${d.substring(6,8)}`;
  };

  // 发明人
  const inventors = [];
  const inventorList = parties?.inventors?.inventor;
  if (inventorList) {
    (Array.isArray(inventorList) ? inventorList : [inventorList]).forEach(inv => {
      const name = inv?.["inventor-name"]?.name;
      if (name) inventors.push(name);
    });
  }

  // 申请人
  const assignees = [];
  const applicantList = parties?.applicants?.applicant;
  if (applicantList) {
    (Array.isArray(applicantList) ? applicantList : [applicantList]).forEach(app => {
      const name = app?.["applicant-name"]?.name;
      if (name && !assignees.includes(name)) assignees.push(name);
    });
  }

  // 日期
  const pubRef = biblio?.["dates-of-public-availability"]?.["publication-reference"];
  const pubDate = Array.isArray(pubRef) ? pubRef[0] : pubRef;
  const publicationDate = formatDate(pubDate?.["document-id"]?.date);

  const appRef = biblio?.["application-reference"];
  const applicationDate = formatDate(
    (Array.isArray(appRef) ? appRef[0] : appRef)?.["document-id"]?.date
  );

  // 优先权
  const priorityClaims = biblio?.["priority-claims"]?.["priority-claim"];
  let priorityDate = "";
  if (priorityClaims) {
    const first = Array.isArray(priorityClaims) ? priorityClaims[0] : priorityClaims;
    priorityDate = formatDate(first?.["document-id"]?.date);
  }

  // IPC 分类
  const classifications = [];
  const ipcr = biblio?.["classifications-ipcr"]?.["classification-ipcr"];
  if (ipcr) {
    (Array.isArray(ipcr) ? ipcr : [ipcr]).forEach(c => {
      const text = c?.text || c?.["#text"];
      if (text) classifications.push({ code: text.trim(), description: "" });
    });
  }

  // 引用文献
  const patent_citations = [];
  const cited_by = [];
  const refs = biblio?.["references-cited"]?.citation;
  if (refs) {
    (Array.isArray(refs) ? refs : [refs]).forEach(cit => {
      const patcit = cit.patcit;
      if (patcit) {
        const docId = patcit["document-id"];
        const country = docId?.country || "";
        const num = docId?.["doc-number"] || "";
        const kind = docId?.kind || "";
        const pn = `${country}${num}${kind}`;
        const citedBy = cit["@_cited-by"] || "applicant";
        const entry = {
          patent_number: pn,
          title: patcit?.["invention-title"]?._ || "",
          publication_date: formatDate(docId?.date),
          assignee: "",
          link: `https://patents.google.com/patent/${pn}`,
          citation_type: citedBy === "examiner" ? "examiner" : "applicant",
        };
        patent_citations.push(entry);
      }
    });
  }

  return {
    patent_number: `${exDoc["@_country"]}${exDoc["@_doc-number"]}${exDoc["@_kind"]}`,
    title: biblio?.["invention-title"]?._ || biblio?.["invention-title"] || "",
    inventors,
    assignees,
    application_date: applicationDate,
    publication_date: publicationDate,
    priority_date: priorityDate,
    classifications,
    patent_citations,
    cited_by,  // biblio 中通常无 cited_by，需从其他端点或留空
  };
}
```

#### 5.3.2 abstract → 摘要

```xml
<ops:world-patent-data>
  <exchange-document>
    <abstract lang="en">
      <p>Abstract text...</p>
    </abstract>
  </exchange-document>
</ops:world-patent-data>
```

```javascript
function parseOpsAbstract(xml) {
  const obj = parser.parse(xml);
  const doc = obj["world-patent-data"]?.["exchange-document"];
  if (!doc) return "";
  const exDoc = Array.isArray(doc) ? doc[0] : doc;
  const abstract = exDoc?.abstract;
  if (!abstract) return "";
  // abstract 可能是 { p: "text" } 或 { p: ["p1","p2"] } 或直接字符串
  const p = abstract.p;
  if (Array.isArray(p)) return p.join("\n").trim();
  if (typeof p === "string") return p.trim();
  if (typeof p === "object") return (p._ || "").trim();
  return "";
}
```

#### 5.3.3 claims → 权利要求

```xml
<ops:world-patent-data>
  <exchange-document>
    <claims lang="en">
      <claim id="CLM00001" num="1">
        <claim-text>1. A method comprising...</claim-text>
      </claim>
      <claim id="CLM00002" num="2">
        <claim-text>2. The method of claim 1, wherein...</claim-text>
      </claim>
    </claims>
  </exchange-document>
</ops:world-patent-data>
```

```javascript
function parseOpsClaims(xml) {
  const obj = parser.parse(xml);
  const doc = obj["world-patent-data"]?.["exchange-document"];
  if (!doc) return [];
  const exDoc = Array.isArray(doc) ? doc[0] : doc;
  const claimsNode = exDoc?.claims?.claim;
  if (!claimsNode) return [];

  const claimList = Array.isArray(claimsNode) ? claimsNode : [claimsNode];
  return claimList.map((c, i) => {
    const num = parseInt(c["@_num"] || (i + 1), 10);
    const claimText = c["claim-text"];
    // claim-text 可能是字符串、数组或对象
    let text = "";
    if (Array.isArray(claimText)) {
      text = claimText.map(t => typeof t === "string" ? t : (t._ || "")).join("");
    } else if (typeof claimText === "string") {
      text = claimText;
    } else if (typeof claimText === "object") {
      text = claimText._ || "";
    }
    // 去除开头的 "1." 编号（OPS 通常已包含）
    text = text.replace(/^\s*\d+\.\s*/, "").trim();

    // 简单判断独立/从属
    const isDependent = /claim\s+\d+/i.test(text) || /根据权利要求/.test(text);
    return {
      num,
      type: isDependent ? "dependent" : "independent",
      text,
    };
  });
}
```

#### 5.3.4 description → 说明书

```xml
<ops:world-patent-data>
  <exchange-document>
    <description lang="en">
      <heading>FIELD OF INVENTION</heading>
      <p>This invention relates to...</p>
      <heading>BACKGROUND</heading>
      <p>...</p>
    </description>
  </exchange-document>
</ops:world-patent-data>
```

```javascript
function parseOpsDescription(xml) {
  const obj = parser.parse(xml);
  const doc = obj["world-patent-data"]?.["exchange-document"];
  if (!doc) return "";
  const exDoc = Array.isArray(doc) ? doc[0] : doc;
  const desc = exDoc?.description;
  if (!desc) return "";

  // description 下的子节点混合了 heading 和 p
  // fast-xml-parser 解析后，heading 和 p 会成为 desc 对象的不同键
  // 需要保留顺序，建议用 preserveOrder: true 或手动遍历
  const parts = [];
  for (const key of Object.keys(desc)) {
    if (key.startsWith("@")) continue;  // 跳过属性
    const val = desc[key];
    if (key === "heading") {
      (Array.isArray(val) ? val : [val]).forEach(h => {
        parts.push(`\n## ${typeof h === "string" ? h : (h._ || "")}\n`);
      });
    } else if (key === "p") {
      (Array.isArray(val) ? val : [val]).forEach(p => {
        const text = typeof p === "string" ? p : (p._ || "");
        if (text) parts.push(text);
      });
    }
  }
  return parts.join("\n\n").trim();
}
```

> **注意**：`fast-xml-parser` 默认不保留节点顺序。若需严格保留 heading 与 p 的交错顺序，需使用 `preserveOrder: true` 选项，解析结果为数组形式。本项目 `description` 渲染对顺序要求不高，可接受按 heading/p 分组拼接。

#### 5.3.5 images → 附图

```xml
<ops:world-patent-data>
  <document-inquiry>
    <publication-reference>
      <document-id>
        <country>US</country>
        <doc-number>12345678</doc-number>
        <kind>B2</kind>
      </document-id>
    </publication-reference>
    <inquiry-result>
      <document-instance desc="Drawing" number-of-pages="5">
        <document-section>
          <name>drawings</name>
          <start-page>1</start-page>
          <end-page>5</end-page>
        </document-section>
        <link>http://ops.epo.org/3.2/rest-services/published-data/images/US/12345678/B2/fullimage?Range=1</link>
      </document-instance>
    </inquiry-result>
  </document-inquiry>
</ops:world-patent-data>
```

**附图获取**：OPS 的 images 端点只返回元信息，实际图片需通过 `link` 中的 `/fullimage?Range=N` 端点逐页获取（返回 PDF 或 TIFF）。**简化方案**：

```javascript
function parseOpsImages(xml, patentNumber) {
  const obj = parser.parse(xml);
  const inquiry = obj["world-patent-data"]?.["document-inquiry"];
  if (!inquiry) return [];

  const instances = inquiry?.["inquiry-result"]?.["document-instance"];
  if (!instances) return [];

  const drawingInstance = (Array.isArray(instances) ? instances : [instances])
    .find(inst => inst["@_desc"] === "Drawing");
  if (!drawingInstance) return [];

  const totalPages = parseInt(drawingInstance["@_number-of-pages"] || "0", 10);
  const link = drawingInstance.link;
  if (!link || totalPages === 0) return [];

  // 拼接每页的 fullimage URL
  const drawings = [];
  for (let i = 1; i <= totalPages; i++) {
    // fullimage 端点返回的是图片二进制，前端 <img> 无法直接用（需 Authorization）
    // 方案 A：后端代理，提供 /api/ops/image?num=US...&page=1 端点
    // 方案 B：使用 thumbnail 端点（若有）
    drawings.push(`/api/ops/image?num=${encodeURIComponent(patentNumber)}&page=${i}`);
  }
  return drawings;
}
```

> **附图代理端点**（需额外实现）：由于 OPS 图片需要 Bearer token，前端 `<img>` 标签无法直接请求。需在 `server.js` 新增 `/api/ops/image?num=...&page=N` 路由，后端获取 token 后 curl 图片并返回 `image/jpeg` 或 `image/tiff`。TIFF 格式浏览器不原生支持，建议转换为 PNG/JPEG（可用 `sharp` 或 `imagemagick`）。
>
> **MVP 阶段可先不实现附图**，`drawings` 返回空数组，前端会自动隐藏附图区域。

#### 5.3.6 equivalent → 同族

```xml
<ops:world-patent-data>
  <patent-family>
    <family-member>
      <publication-reference>
        <document-id>
          <country>US</country>
          <doc-number>12345678</doc-number>
          <kind>B2</kind>
        </document-id>
      </publication-reference>
      <application-reference>
        <document-id>
          <country>US</country>
          <doc-number>16123456</doc-number>
          <kind>A</kind>
        </document-id>
      </application-reference>
    </family-member>
    <family-member>...</family-member>
  </patent-family>
</ops:world-patent-data>
```

```javascript
function parseOpsEquivalent(xml) {
  const obj = parser.parse(xml);
  const family = obj["world-patent-data"]?.["patent-family"];
  if (!family) return { family_id: "", family_applications: [], country_status: [] };

  const members = family?.["family-member"];
  if (!members) return { family_id: "", family_applications: [], country_status: [] };

  const memberList = Array.isArray(members) ? members : [members];
  const family_applications = [];
  const countries = new Set();

  memberList.forEach(m => {
    const pubRef = m?.["publication-reference"]?.["document-id"];
    const pubRefs = Array.isArray(pubRef) ? pubRef : [pubRef];
    pubRefs.forEach(did => {
      if (did?.country && did?.["doc-number"]) {
        const pn = `${did.country}${did["doc-number"]}${did.kind || ""}`;
        family_applications.push({
          patent_number: pn,
          country: did.country,
          link: `https://patents.google.com/patent/${pn}`,
        });
        countries.add(did.country);
      }
    });
  });

  return {
    family_id: "",  // OPS equivalent 不直接返回 family_id，需调用 /family 端点
    family_applications,
    country_status: Array.from(countries).map(c => ({ country: c, status: "unknown" })),
  };
}
```

#### 5.3.7 legal → 法律状态

```xml
<ops:world-patent-data>
  <legal-event>
    <date>20230115</date>
    <code>MM4A</code>
    <description lang="en">The patent is deemed to have been withdrawn</description>
  </legal-event>
  ...
</ops:world-patent-data>
```

```javascript
function parseOpsLegal(xml) {
  const obj = parser.parse(xml);
  const events = obj["world-patent-data"]?.["legal-events"]?.["legal-event"]
             || obj["world-patent-data"]?.["legal-event"];
  if (!events) return [];

  const eventList = Array.isArray(events) ? events : [events];
  const formatDate = (d) => {
    if (!d || d.length !== 8) return "";
    return `${d.substring(0,4)}-${d.substring(4,6)}-${d.substring(6,8)}`;
  };

  // 简单分类映射（可扩展，参考 patent-status.js）
  const categorize = (code) => {
    if (/^(MM|WW|RE|FE|FG|PG|PC)/.test(code)) return "fee";
    if (/^(EE|EG|EF)/.test(code)) return "pub";
    if (/^(MM4A|MM8A|WW4A)/.test(code)) return "oa";
    return "other";
  };

  return eventList.map(e => ({
    date: formatDate(e.date),
    code: e.code || "",
    description: typeof e.description === "string" ? e.description : (e.description?._ || ""),
    category: categorize(e.code || ""),
  }));
}
```

### 5.4 组装最终数据

```javascript
function buildOpsPatentData(num, biblioXml, abstractXml, claimsXml, descriptionXml, imagesXml, equivalentXml, legalXml) {
  const biblio = biblioXml ? parseOpsBiblio(biblioXml) : null;
  if (!biblio) return null;

  const abstract = abstractXml ? parseOpsAbstract(abstractXml) : "";
  const claims = claimsXml ? parseOpsClaims(claimsXml) : [];
  const description = descriptionXml ? parseOpsDescription(descriptionXml) : "";
  const drawings = imagesXml ? parseOpsImages(imagesXml, num) : [];
  const family = equivalentXml ? parseOpsEquivalent(equivalentXml) : { family_id: "", family_applications: [], country_status: [] };
  const legalEvents = legalXml ? parseOpsLegal(legalXml) : [];

  return {
    patent_number: biblio.patent_number || num,
    title: biblio.title,
    abstract,
    url: `https://patents.google.com/patent/${num}`,
    pdf_link: "",  // OPS 不直接提供 PDF 链接，可留空或拼接 Google Patents PDF
    application_date: biblio.application_date,
    publication_date: biblio.publication_date,
    priority_date: biblio.priority_date,
    inventors: biblio.inventors,
    assignees: biblio.assignees,
    drawings,
    patent_citations: biblio.patent_citations,
    cited_by: biblio.cited_by,
    similar_documents: [],  // OPS 无此概念，留空
    classifications: biblio.classifications,
    claims,
    description,
    events_timeline: legalEvents,
    legal_events: legalEvents,
    family_id: family.family_id,
    family_applications: family.family_applications,
    country_status: family.country_status,
    external_links: {
      ep_register: num.startsWith("EP") ? {
        url: `https://register.epo.org/application?number=${num.substring(2)}`,
        text: "EP Register",
      } : null,
      ops: {
        url: `https://worldwide.espacenet.com/patent/search/family/${num}`,
        text: "Espacenet",
      },
    },
    landscapes: [],
  };
}
```

---

## 六、PDF 下载实现

OPS 不直接提供完整 PDF 文件，而是按页提供 PDF/TIFF。需三步流程：查询页数 → 逐页下载 → 后端合并。

### 6.1 OPS PDF 下载流程

**Step 1：查询文档可用性**

```
GET /published-data/publication/docdb/{country}.{doc-number}.{kind}/images
Authorization: Bearer {token}
```

> **注意**：images 端点使用 `docdb` 格式，号码需拆分为 `country.doc-number.kind`（用点分隔），而非 epodoc 的连写形式。例如 `EP.1000000.A1`。

返回 XML 包含总页数和各部分（摘要/说明书/权利要求/附图/检索报告）的页码范围：

```xml
<ops:world-patent-data>
  <document-inquiry>
    <publication-reference>
      <document-id>
        <country>EP</country>
        <doc-number>1000000</doc-number>
        <kind>A1</kind>
      </document-id>
    </publication-reference>
    <inquiry-result>
      <document-instance desc="FullDocument" number-of-pages="12">
        <document-section>
          <name>BIBLIOGRAPHIC INFORMATION</name>
          <start-page>1</start-page>
          <end-page>1</end-page>
        </document-section>
        <document-section>
          <name>DESCRIPTION</name>
          <start-page>2</start-page>
          <end-page>4</end-page>
        </document-section>
        <document-section>
          <name>CLAIMS</name>
          <start-page>5</start-page>
          <end-page>5</end-page>
        </document-section>
        <document-section>
          <name>DRAWINGS</name>
          <start-page>6</start-page>
          <end-page>10</end-page>
        </document-section>
        <document-section>
          <name>SEARCH REPORT</name>
          <start-page>11</start-page>
          <end-page>12</end-page>
        </document-section>
        <link>published-data/images/EP/1000000/A1/fullimage</link>
      </document-instance>
    </inquiry-result>
  </document-inquiry>
</ops:world-patent-data>
```

**Step 2：逐页下载 PDF**

```
GET /published-data/images/{country}/{doc-number}/{kind}/fullimage.pdf?Range={N}
Authorization: Bearer {token}
Accept: application/pdf
```

每页返回一个独立的 PDF 二进制（单页 PDF）。

**Step 3：后端合并**

将所有单页 PDF 合并为一个完整 PDF。推荐使用 `pdf-lib`（纯 JS，无系统依赖）：

```bash
npm install pdf-lib
```

### 6.2 后端实现

在 `server.js` 新增 PDF 下载代理路由 `/api/ops/pdf/{patentNumber}`：

```javascript
const { PDFDocument } = require("pdf-lib");

// 解析 images 端点返回的 XML，提取总页数和 link 前缀
function parseOpsImagesMeta(xml) {
  const obj = parser.parse(xml);
  const inquiry = obj["world-patent-data"]?.["document-inquiry"];
  if (!inquiry) return null;
  const inst = inquiry?.["inquiry-result"]?.["document-instance"];
  if (!inst) return null;
  // 优先取 FullDocument，否则取第一个
  const fullDoc = (Array.isArray(inst) ? inst : [inst])
    .find(i => i["@_desc"] === "FullDocument") || (Array.isArray(inst) ? inst[0] : inst);
  return {
    totalPages: parseInt(fullDoc["@_number-of-pages"] || "0", 10),
    link: fullDoc.link || "",  // 形如 "published-data/images/EP/1000000/A1/fullimage"
    sections: (Array.isArray(fullDoc["document-section"]) ? fullDoc["document-section"] : [fullDoc["document-section"]]).map(s => ({
      name: s.name,
      startPage: parseInt(s["start-page"], 10),
      endPage: parseInt(s["end-page"], 10),
    })),
  };
}

// 下载单页 PDF（返回 Buffer）
async function downloadOpsPdfPage(linkPrefix, page) {
  const token = await getOpsToken();
  if (!token) return null;
  const url = `${OPS_API_BASE}/${linkPrefix}.pdf?Range=${page}`;
  return new Promise((resolve) => {
    execFile("curl", [
      "-s", "-w", "\n__HTTP_CODE__%{http_code}",
      "--max-time", "30",
      "-H", `Authorization: Bearer ${token}`,
      "-H", "Accept: application/pdf",
      url,
    ], { maxBuffer: 20 * 1024 * 1024, encoding: "buffer" }, (err, stdoutBuffer) => {
      if (err) { resolve(null); return; }
      const markerBuffer = Buffer.from("\n__HTTP_CODE__");
      let idx = -1;
      for (let i = Math.max(0, stdoutBuffer.length - 20); i < stdoutBuffer.length; i++) {
        if (stdoutBuffer.slice(i, i + markerBuffer.length).equals(markerBuffer)) {
          idx = i; break;
        }
      }
      let httpCode = 200;
      let bodyBuffer = stdoutBuffer;
      if (idx !== -1) {
        httpCode = parseInt(stdoutBuffer.slice(idx + markerBuffer.length).toString().trim(), 10);
        bodyBuffer = stdoutBuffer.slice(0, idx);
      }
      if (httpCode !== 200) { resolve(null); return; }
      resolve(bodyBuffer);
    });
  });
}

// 主入口：合并所有页为一个 PDF
async function downloadOpsPatentPdf(patentNumber, res) {
  // 号码拆分：US12345678B2 → country=US, doc-number=12345678, kind=B2
  const match = patentNumber.toUpperCase().match(/^([A-Z]{2})(\d+)([A-Z]\d*)?$/);
  if (!match) {
    res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ error: "专利号格式错误" }));
    return;
  }
  const [, country, docNumber, kind] = match;
  const docdbNum = `${country}.${docNumber}.${kind || "A1"}`;

  // Step 1: 查询页数
  const imagesXml = await opsRequest(`/published-data/publication/docdb/${docdbNum}/images`);
  if (!imagesXml) {
    res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ error: "OPS 未找到该专利的 PDF" }));
    return;
  }
  const meta = parseOpsImagesMeta(imagesXml);
  if (!meta || meta.totalPages === 0) {
    res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ error: "OPS 该专利无可用 PDF" }));
    return;
  }

  console.log(`[OPS-PDF] ${patentNumber} 共 ${meta.totalPages} 页，开始下载`);

  // Step 2: 逐页下载（串行，避免触发限流）
  const pageBuffers = [];
  for (let i = 1; i <= meta.totalPages; i++) {
    const buf = await downloadOpsPdfPage(meta.link, i);
    if (buf) pageBuffers.push(buf);
    else console.warn(`[OPS-PDF] 第 ${i} 页下载失败，跳过`);
  }

  if (pageBuffers.length === 0) {
    res.writeHead(502, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ error: "PDF 页面下载全部失败" }));
    return;
  }

  // Step 3: 合并 PDF
  try {
    const mergedPdf = await PDFDocument.create();
    for (const buf of pageBuffers) {
      const singlePagePdf = await PDFDocument.load(buf);
      const pages = await mergedPdf.copyPages(singlePagePdf, singlePagePdf.getPageIndices());
      pages.forEach(p => mergedPdf.addPage(p));
    }
    const mergedBytes = await mergedPdf.save();
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${patentNumber}.pdf"`,
      "Access-Control-Allow-Origin": "*",
      "X-Data-Source": "ops",
    });
    res.end(Buffer.from(mergedBytes));
    console.log(`[OPS-PDF] ${patentNumber} 合并完成，${pageBuffers.length} 页`);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ error: "PDF 合并失败: " + e.message }));
  }
}
```

**路由注册**（在 `server.js` 的请求处理中）：

```javascript
if (req.url.startsWith("/api/ops/pdf/")) {
  const patentNumber = req.url.replace("/api/ops/pdf/", "").split("?")[0];
  downloadOpsPatentPdf(decodeURIComponent(patentNumber), res);
  return;
}
```

### 6.3 在 `buildOpsPatentData` 中填充 `pdf_link`

```javascript
// 在 buildOpsPatentData 返回对象中：
pdf_link: `/api/ops/pdf/${num}`,  // 前端点击 PDF 按钮时，由后端代理下载并合并
```

前端 `renderPatentDetail` 已有 PDF 按钮渲染逻辑（[web-app.js#L465](file:///workspace/src/scripts/web-app.js#L465)），`data.pdf_link` 直接作为 `<a href>`，无需改动。

### 6.4 性能与配额提示

- 单个专利 PDF 通常 5-30 页，串行下载约 10-60 秒。
- PDF 数据量较大，会快速消耗每周配额（按字节计算）。建议：
  - 仅在用户点击 PDF 按钮时按需下载，不在查询时预下载。
  - 合并后的 PDF 缓存到本地文件系统（`/tmp/ops_pdf_{num}.pdf`），24h 内复用。
  - 在设置界面显示配额消耗，让用户感知（见第八章）。

---

## 七、向前引用查询（cited_by）

### 7.1 端点说明

`biblio` 端点的 `references-cited` 只包含**向后引用**（本专利引用了谁）。要获取**向前引用**（谁引用了本专利，即 `cited_by`），必须使用 CQL 搜索端点：

```
GET /published-data/search/?q=ct={patentNumber}&Range=1-25
Authorization: Bearer {token}
```

- `ct=` 是 CQL 的 citation 字段，查询引用了指定专利的所有文献。
- `Range=1-25` 表示返回第 1-25 条结果（每页最多 25 条，可翻页）。
- 返回 XML 包含匹配的专利列表及其 bibliographic 摘要。

### 7.2 实现函数

```javascript
async function fetchOpsCiting(number) {
  const num = number.toUpperCase().replace(/[\s\/]/g, "");
  const citingList = [];
  let rangeStart = 1;

  // 翻页获取所有向前引用（最多 200 条，避免无限翻页）
  for (let page = 1; page <= 8; page++) {
    const xml = await opsRequest(
      `/published-data/search/?q=${encodeURIComponent("ct=" + num)}&Range=${rangeStart}-${rangeStart + 24}`
    );
    if (!xml) break;

    const obj = parser.parse(xml);
    const searchResult = obj["world-patent-data"]?.["search-result"];
    if (!searchResult) break;

    const exchangeDocs = searchResult?.["exchange-documents"]?.["exchange-document"];
    if (!exchangeDocs) break;

    const docList = Array.isArray(exchangeDocs) ? exchangeDocs : [exchangeDocs];
    if (docList.length === 0) break;

    for (const doc of docList) {
      const country = doc["@_country"] || "";
      const docNum = doc["@_doc-number"] || "";
      const kind = doc["@_kind"] || "";
      const pn = `${country}${docNum}${kind}`;
      const biblio = doc["bibliographic-data"] || {};
      const title = biblio["invention-title"]?._ || biblio["invention-title"] || "";
      const applicants = biblio?.parties?.applicants?.applicant;
      let assignee = "";
      if (applicants) {
        const firstApp = Array.isArray(applicants) ? applicants[0] : applicants;
        assignee = firstApp?.["applicant-name"]?.name || "";
      }
      citingList.push({
        patent_number: pn,
        title: typeof title === "string" ? title : "",
        assignee,
        publication_date: "",
        link: `https://patents.google.com/patent/${pn}`,
        citation_type: "citing",
      });
    }

    if (docList.length < 25) break;  // 最后一页
    rangeStart += 25;
  }

  return citingList;
}
```

### 7.3 接入 `queryOpsPatent`

修改 `queryOpsPatent` 的并发请求，增加 citing 查询：

```javascript
const [biblio, abstract, claims, description, images, equivalent, legal, citing] = await Promise.all([
  opsRequest(`/published-data/publication/epodoc/${encodeURIComponent(num)}/biblio`),
  opsRequest(`/published-data/publication/epodoc/${encodeURIComponent(num)}/abstract`),
  opsRequest(`/published-data/publication/epodoc/${encodeURIComponent(num)}/claims`),
  opsRequest(`/published-data/publication/epodoc/${encodeURIComponent(num)}/description`),
  opsRequest(`/published-data/publication/epodoc/${encodeURIComponent(num)}/images`),
  opsRequest(`/published-data/publication/epodoc/${encodeURIComponent(num)}/equivalent`),
  opsRequest(`/published-data/publication/epodoc/${encodeURIComponent(num)}/legal`),
  fetchOpsCiting(num),  // 向前引用（内部已处理翻页）
]);
```

在 `buildOpsPatentData` 中填充 `cited_by`：

```javascript
cited_by: citing || [],
```

### 7.4 注意事项

- CQL 搜索消耗配额较多（按返回字节数计算），且响应较慢（2-5 秒）。
- 若 `cited_by` 非核心需求，可作为**可选字段**，在设置中开关（见第八章）。
- 部分老专利可能无向前引用数据，返回空数组即可。

---

## 八、前端集成（可选增强）

### 8.1 零改动方案（推荐 MVP）

前端 `searchPatentDetail`（[web-app.js#L401](file:///workspace/src/scripts/web-app.js#L401)）**无需任何改动**。后端在 GP 失败时自动降级到 OPS，返回的 JSON 结构与 GP 完全一致，`renderPatentDetail` 直接渲染。

### 8.2 可选增强：显示数据来源

若希望用户感知数据来源，可在 `searchPatentDetail` 中读取响应头：

```javascript
// web-app.js searchPatentDetail 中
const resp = await fetch(gpApiUrl(raw));
const dataSource = resp.headers.get("X-Data-Source") || "gp";
const json = await resp.json();

if (!json.success) {
  showError(json.error || "未找到该专利");
  // ...
  return;
}

renderPatentDetail(json.data);
// 可选：在标题旁显示数据来源徽章
if (dataSource === "ops") {
  console.log("数据来源: EPO OPS（降级）");
  // 可在 UI 上加一个 "OPS" 小标签，提示用户数据来自 OPS
}
```

### 8.3 可选增强：loading 文案

```javascript
loadingText.textContent = "正在从 Google Patents 获取专利信息...";
// 若 GP 超时较长，可改为：
// loadingText.textContent = "正在获取专利信息（GP 失败时自动切换 OPS）...";
```

---

## 九、设置界面配置 OPS Key 与配额显示

### 9.1 设计目标

在现有设置弹窗（[web.html#L291](file:///workspace/src/web.html#L291) `ai-settings-modal`）中新增一个 **"EPO OPS"** tab，提供：

1. **OPS 开关**：启用/禁用 OPS 降级
2. **Consumer Key / Secret 输入**：用户填入自己的 OPS 凭证
3. **配额信息显示**：显示本周已用配额、剩余配额、重置时间
4. **可选字段开关**：是否查询向前引用（cited_by）、是否下载 PDF
5. **测试连接按钮**：验证 key/secret 是否有效

### 9.2 前端 HTML 结构

在 [web.html](file:///workspace/src/web.html) 的 `settings-tabs` 中新增 tab 按钮（第 305 行后）：

```html
<button class="settings-tab-btn" data-settings-tab="ops">EPO OPS</button>
```

在 `settings-tab-network` div 后新增 tab 内容（第 508 行后）：

```html
<!-- EPO OPS Tab -->
<div id="settings-tab-ops" class="settings-tab-content">
  <div class="form-group">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
      <input type="checkbox" id="ops-enabled-checkbox">
      启用 EPO OPS 降级查询（Google Patents 查询失败时自动切换）
    </label>
    <small style="color:var(--text-secondary);margin-top:4px;display:block;margin-left:24px">
      OPS 是欧洲专利局的开放专利服务，覆盖范围广，可作为 Google Patents 的降级数据源
    </small>
  </div>

  <div class="form-group">
    <label>Consumer Key</label>
    <input type="text" id="ops-consumer-key-input" placeholder="OPS Consumer Key">
    <small style="color:var(--text-secondary);margin-top:4px;display:block">
      在 <a href="https://developers.epo.org" target="_blank">developers.epo.org</a> 注册应用获取
    </small>
  </div>

  <div class="form-group">
    <label>Consumer Secret</label>
    <input type="password" id="ops-consumer-secret-input" placeholder="OPS Consumer Secret">
  </div>

  <!-- 配额信息卡片 -->
  <div class="form-group" id="ops-quota-card" style="background:var(--bg-secondary);padding:12px;border-radius:8px;display:none">
    <div style="font-weight:600;margin-bottom:8px;color:var(--text-primary)">本周配额使用情况</div>
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
      <span style="color:var(--text-secondary)">已用 / 总量</span>
      <span id="ops-quota-used" style="color:var(--text-primary)">-</span>
    </div>
    <div style="background:var(--bg-card);border-radius:4px;height:8px;overflow:hidden;margin-bottom:6px">
      <div id="ops-quota-bar" style="background:var(--accent);height:100%;width:0%;transition:width 0.3s"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted)">
      <span>重置时间：<span id="ops-quota-reset">-</span></span>
      <span id="ops-quota-percent">0%</span>
    </div>
  </div>

  <!-- 可选字段开关 -->
  <div class="form-group">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
      <input type="checkbox" id="ops-citing-checkbox" checked>
      查询向前引用（cited_by，谁引用了本专利）
    </label>
    <small style="color:var(--text-secondary);margin-top:4px;display:block;margin-left:24px">
      关闭可节省配额，但"被引用"板块将为空
    </small>
  </div>

  <div class="form-group">
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
      <input type="checkbox" id="ops-pdf-checkbox" checked>
      启用 PDF 下载（按需，点击 PDF 按钮时触发）
    </label>
    <small style="color:var(--text-secondary);margin-top:4px;display:block;margin-left:24px">
      PDF 下载消耗配额较大（按字节计算），关闭后 PDF 按钮将隐藏
    </small>
  </div>

  <div class="form-actions">
    <button id="ops-test-btn" class="btn-secondary">测试连接</button>
    <button id="ops-save-btn" class="btn-primary">保存</button>
  </div>
  <div id="ops-test-result" class="test-result hidden"></div>
</div>
```

### 9.3 配置存储（localStorage）

参考现有 AI 配置的存储方式（[web-ai.js](file:///workspace/src/scripts/web-ai.js) `STORAGE_KEY = "history-helper-ai-config"`），新增独立的 OPS 配置存储：

```javascript
// web-ops.js（新文件）或直接在 web-app.js 中
var OPS = (function () {
  var STORAGE_KEY = "patentlens-ops-config";

  function loadConfig() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return {
      enabled: false,
      consumerKey: "",
      consumerSecret: "",
      fetchCiting: true,
      enablePdf: true,
    };
  }

  function saveConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  return {
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    STORAGE_KEY: STORAGE_KEY,
  };
})();
```

### 9.4 前端设置逻辑

在 `web-app.js` 中（参考现有 `aiSaveBtn` 的事件绑定风格）新增 OPS 设置逻辑：

```javascript
// DOM 元素引用
const opsEnabledCheckbox = document.getElementById("ops-enabled-checkbox");
const opsConsumerKeyInput = document.getElementById("ops-consumer-key-input");
const opsConsumerSecretInput = document.getElementById("ops-consumer-secret-input");
const opsQuotaCard = document.getElementById("ops-quota-card");
const opsQuotaUsed = document.getElementById("ops-quota-used");
const opsQuotaBar = document.getElementById("ops-quota-bar");
const opsQuotaReset = document.getElementById("ops-quota-reset");
const opsQuotaPercent = document.getElementById("ops-quota-percent");
const opsCitingCheckbox = document.getElementById("ops-citing-checkbox");
const opsPdfCheckbox = document.getElementById("ops-pdf-checkbox");
const opsTestBtn = document.getElementById("ops-test-btn");
const opsSaveBtn = document.getElementById("ops-save-btn");
const opsTestResult = document.getElementById("ops-test-result");

// 加载配置到表单
function loadOpsSettings() {
  const config = OPS.loadConfig();
  opsEnabledCheckbox.checked = config.enabled;
  opsConsumerKeyInput.value = config.consumerKey || "";
  opsConsumerSecretInput.value = config.consumerSecret || "";
  opsCitingCheckbox.checked = config.fetchCiting !== false;
  opsPdfCheckbox.checked = config.enablePdf !== false;
}

// 保存配置
opsSaveBtn.addEventListener("click", () => {
  const config = {
    enabled: opsEnabledCheckbox.checked,
    consumerKey: opsConsumerKeyInput.value.trim(),
    consumerSecret: opsConsumerSecretInput.value.trim(),
    fetchCiting: opsCitingCheckbox.checked,
    enablePdf: opsPdfCheckbox.checked,
  };
  OPS.saveConfig(config);
  opsTestResult.textContent = "已保存";
  opsTestResult.classList.remove("hidden");
  setTimeout(() => opsTestResult.classList.add("hidden"), 2000);
  // 刷新配额显示
  if (config.enabled && config.consumerKey) refreshOpsQuota();
});

// 测试连接
opsTestBtn.addEventListener("click", async () => {
  const key = opsConsumerKeyInput.value.trim();
  const secret = opsConsumerSecretInput.value.trim();
  if (!key || !secret) {
    opsTestResult.textContent = "请填写 Consumer Key 和 Secret";
    opsTestResult.classList.remove("hidden");
    return;
  }
  opsTestBtn.disabled = true;
  opsTestResult.textContent = "测试中...";
  opsTestResult.classList.remove("hidden");
  try {
    // 调用后端测试端点，把 key/secret 临时传过去验证
    const resp = await fetch("/api/ops/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consumerKey: key, consumerSecret: secret }),
    });
    const json = await resp.json();
    if (json.success) {
      opsTestResult.textContent = "连接成功！配额信息已获取";
      opsTestResult.style.color = "var(--success)";
      // 显示配额
      if (json.quota) renderOpsQuota(json.quota);
    } else {
      opsTestResult.textContent = "连接失败：" + (json.error || "未知错误");
      opsTestResult.style.color = "var(--danger)";
    }
  } catch (e) {
    opsTestResult.textContent = "请求失败：" + e.message;
    opsTestResult.style.color = "var(--danger)";
  }
  opsTestBtn.disabled = false;
});

// 渲染配额信息
function renderOpsQuota(quota) {
  opsQuotaCard.style.display = "block";
  const usedMB = (quota.usedBytes / 1024 / 1024).toFixed(1);
  const totalMB = (quota.totalBytes / 1024 / 1024).toFixed(1);
  const percent = Math.min(100, (quota.usedBytes / quota.totalBytes) * 100);
  opsQuotaUsed.textContent = `${usedMB} MB / ${totalMB} MB`;
  opsQuotaBar.style.width = percent + "%";
  opsQuotaPercent.textContent = percent.toFixed(1) + "%";
  // 配额条颜色：超过 80% 变红
  opsQuotaBar.style.background = percent > 80 ? "var(--danger)" : (percent > 50 ? "var(--warning)" : "var(--accent)");
  // 重置时间（OPS 每周一 UTC 0点重置）
  if (quota.resetAt) {
    const d = new Date(quota.resetAt);
    opsQuotaReset.textContent = d.toLocaleString("zh-CN");
  }
}

// 刷新配额（使用已保存的 key）
async function refreshOpsQuota() {
  try {
    const resp = await fetch("/api/ops/quota");
    const json = await resp.json();
    if (json.success && json.quota) renderOpsQuota(json.quota);
  } catch (e) { /* ignore */ }
}

// 打开设置弹窗时加载配置
aiSettingsModal.addEventListener("shown", () => {
  loadOpsSettings();
  const config = OPS.loadConfig();
  if (config.enabled && config.consumerKey) refreshOpsQuota();
});
```

### 9.5 后端配额查询端点

OPS **本身不直接提供配额查询 API**，但响应头中包含配额信息。需在每次 OPS 请求时解析响应头并缓存：

**OPS 配额响应头**（每次请求都会返回）：

```
X-Throttling-Control: status=green, week=12% (4MB/4GB)
X-Rejection-Reason: quota exceeded (仅在超限时出现)
```

在 `server.js` 中新增配额缓存和查询端点：

```javascript
// 全局配额缓存（从 OPS 响应头解析）
let opsQuotaCache = {
  usedBytes: 0,
  totalBytes: 4 * 1024 * 1024 * 1024,  // 默认 4GB（免费用户）
  resetAt: null,
  lastUpdated: 0,
};

// 在 opsRequest 中解析响应头并更新配额缓存
function opsRequest(path) {
  return new Promise(async (resolve) => {
    const token = await getOpsToken();
    if (!token) { resolve(null); return; }
    const url = `${OPS_API_BASE}${path}`;
    // 注意：用 -D - 同时输出响应头，或用 -i 包含头
    execFile("curl", [
      "-s", "-i",  // -i 包含响应头
      "-w", "\n__HTTP_CODE__%{http_code}",
      "--max-time", "30",
      "-H", `Authorization: Bearer ${token}`,
      "-H", "Accept: application/xml",
      url,
    ], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) { resolve(null); return; }

      // 分离响应头和正文
      const headerEndIdx = stdout.indexOf("\r\n\r\n");
      let headers = "";
      let body = stdout;
      if (headerEndIdx !== -1) {
        headers = stdout.substring(0, headerEndIdx);
        body = stdout.substring(headerEndIdx + 4);
      }

      // 解析 X-Throttling-Control 头
      const throttleMatch = headers.match(/X-Throttling-Control:\s*(.+)/i);
      if (throttleMatch) {
        const throttleInfo = throttleMatch[1].trim();
        // 格式：status=green, week=12% (4MB/4GB)
        const weekMatch = throttleInfo.match(/week=(\d+)%\s*\(([^/]+)\/([^)]+)\)/);
        if (weekMatch) {
          const percent = parseInt(weekMatch[1], 10);
          const usedStr = weekMatch[2].trim();
          const totalStr = weekMatch[3].trim();
          opsQuotaCache.usedBytes = parseSizeToBytes(usedStr);
          opsQuotaCache.totalBytes = parseSizeToBytes(totalStr);
          opsQuotaCache.lastUpdated = Date.now();
          // 计算下周一 UTC 0点重置时间
          const now = new Date();
          const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
          const reset = new Date(now);
          reset.setUTCDate(now.getUTCDate() + daysUntilMonday);
          reset.setUTCHours(0, 0, 0, 0);
          opsQuotaCache.resetAt = reset.toISOString();
        }
      }

      // 解析 HTTP code 和 body（与原 opsRequest 一致）
      const marker = "\n__HTTP_CODE__";
      const idx = body.lastIndexOf(marker);
      let httpCode = 200;
      let xmlBody = body;
      if (idx !== -1) {
        httpCode = parseInt(body.substring(idx + marker.length), 10);
        xmlBody = body.substring(0, idx);
      }
      if (httpCode !== 200) { resolve(null); return; }
      resolve(xmlBody);
    });
  });
}

// 辅助：解析 "4MB" / "4GB" 为字节数
function parseSizeToBytes(str) {
  const m = str.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)/i);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const mult = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
  return num * (mult[unit] || 1);
}
```

**新增配额查询和测试连接端点**：

```javascript
// 配额查询（使用已保存的 key）
if (req.url === "/api/ops/quota" && req.method === "GET") {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify({
    success: !!opsQuotaCache.lastUpdated,
    quota: opsQuotaCache,
  }));
  return;
}

// 测试连接（前端临时传入 key/secret 验证）
if (req.url === "/api/ops/test" && req.method === "POST") {
  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", async () => {
    try {
      const { consumerKey, consumerSecret } = JSON.parse(body);
      // 临时用传入的 key 获取 token 测试
      const token = await getOpsTokenWithCreds(consumerKey, consumerSecret);
      if (!token) {
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ success: false, error: "认证失败，请检查 Key/Secret" }));
        return;
      }
      // 用 token 发一个轻量请求（如查询一个已知专利的 abstract）触发配额头返回
      const testXml = await opsRequestWithToken(token, "/published-data/publication/epodoc/EP1000000A1/abstract");
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({
        success: !!testXml,
        quota: opsQuotaCache,  // 顺便返回配额
      }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
  });
  return;
}
```

> **说明**：`getOpsTokenWithCreds` 和 `opsRequestWithToken` 是 `getOpsToken` / `opsRequest` 的变体，接受临时凭证参数，用于测试连接时验证用户输入的 key/secret，不污染全局 token 缓存。

### 9.6 配置传递给后端

由于 OPS key/secret 存储在前端 localStorage，但后端 `server.js` 需要使用，有两种方案：

**方案 A（推荐）：前端通过请求头传递**

每次调用 `/api/gp/` 或 `/api/ops/*` 时，前端在请求头中携带 OPS 配置：

```javascript
// web-app.js 修改 gpApiUrl 或 fetch 调用
function gpApiUrl(patentNumber) {
  const s = getGpProxySettings();
  const opsConfig = OPS.loadConfig();
  let url = "/api/gp/" + encodeURIComponent(patentNumber);
  if (s.enabled) {
    url += "?proxy=1";
    if (s.proxyUrl) url += "&proxyUrl=" + encodeURIComponent(s.proxyUrl);
  }
  return url;
}

// 修改 fetch 调用，增加请求头
async function searchPatentDetail(input) {
  // ...
  const opsConfig = OPS.loadConfig();
  const resp = await fetch(gpApiUrl(raw), {
    headers: opsConfig.enabled && opsConfig.consumerKey ? {
      "X-Ops-Consumer-Key": opsConfig.consumerKey,
      "X-Ops-Consumer-Secret": opsConfig.consumerSecret,
      "X-Ops-Fetch-Citing": opsConfig.fetchCiting ? "1" : "0",
      "X-Ops-Enable-Pdf": opsConfig.enablePdf ? "1" : "0",
    } : {},
  });
  // ...
}
```

后端 `server.js` 在处理请求时优先读取请求头，回退到环境变量：

```javascript
function getOpsCredsFromReq(req) {
  const key = req.headers["x-ops-consumer-key"] || OPS_CONSUMER_KEY;
  const secret = req.headers["x-ops-consumer-secret"] || OPS_CONSUMER_SECRET;
  const fetchCiting = req.headers["x-ops-fetch-citing"] !== "0";
  const enablePdf = req.headers["x-ops-enable-pdf"] !== "0";
  return { key, secret, fetchCiting, enablePdf };
}
```

**方案 B：环境变量（适合自部署）**

启动时通过环境变量配置，前端设置仅用于显示配额。适合单用户自部署场景，但不适合多用户共享前端。

**推荐方案 A**，与现有"代理设置存储在前端 localStorage"的风格一致。

### 9.7 配额显示时机

- **打开设置弹窗时**：若已配置 key，自动调用 `/api/ops/quota` 刷新显示。
- **每次 OPS 请求后**：后端自动从响应头更新 `opsQuotaCache`，前端下次刷新即可看到最新值。
- **测试连接时**：测试请求会触发配额头返回，立即显示。

---

## 十、限流与缓存策略

### 10.1 OPS 配额管理

OPS 按周配额限制（免费用户 4GB/周，付费用户可超 4GB），需注意：

1. **按需请求**：仅在 GP 失败时才调用 OPS，避免无谓消耗。
2. **端点合并**：OPS 支持 `?` 查询参数合并部分端点，但本项目按字段分别请求更清晰。可考虑用 `/fulltext` 端点一次获取 claims+description（若配额紧张）。
3. **响应缓存**：相同专利号的 OPS 结果缓存 24 小时（专利数据不变）。
4. **配额监控**：通过响应头 `X-Throttling-Control` 实时追踪配额，在设置界面显示。

### 10.2 缓存实现

在 `server.js` 中增加简单的内存缓存（与现有 `jpoAccessToken` 缓存风格一致）：

```javascript
const opsCache = new Map();  // key: patentNumber, value: { data, timestamp }
const OPS_CACHE_TTL = 24 * 60 * 60 * 1000;  // 24 小时

function getOpsCache(number) {
  const entry = opsCache.get(number);
  if (entry && Date.now() - entry.timestamp < OPS_CACHE_TTL) {
    return entry.data;
  }
  opsCache.delete(number);
  return null;
}

function setOpsCache(number, data) {
  opsCache.set(number, { data, timestamp: Date.now() });
  // 简单的缓存大小限制
  if (opsCache.size > 500) {
    const firstKey = opsCache.keys().next().value;
    opsCache.delete(firstKey);
  }
}
```

在 `queryOpsPatent` 入口处检查缓存：

```javascript
async function queryOpsPatent(number, res) {
  const num = number.toUpperCase().replace(/[\s\/]/g, "");

  const cached = getOpsCache(num);
  if (cached) {
    console.log(`[OPS] 命中缓存: ${num}`);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "X-Data-Source": "ops-cache",
    });
    res.end(JSON.stringify({ success: true, data: cached, patent_number: num }));
    return;
  }

  // ... 原有逻辑 ...
  setOpsCache(num, data);
}
```

### 10.3 错误重试与降级保护

- OPS 单端点失败（如 claims 404）不阻断整体，仅该字段为空。
- OPS 整体失败（biblio 都拿不到）时，返回 404，前端显示"未找到"。
- **避免无限重试**：每个端点只请求 1 次，失败即放弃该字段。
- **配额超限保护**：当 `X-Throttling-Control` 显示 `status=red` 或收到 403 时，临时禁用 OPS 降级 1 小时，避免持续失败。

---

## 十一、实施阶段建议

### 阶段 1：MVP（最小可用）

**目标**：GP 失败时能从 OPS 拿到基础信息渲染。

- [ ] 安装 `fast-xml-parser` 依赖
- [ ] 实现 `getOpsToken()` + token 缓存
- [ ] 实现 `opsRequest(path)`（含响应头解析配额）
- [ ] 实现 `parseOpsBiblio` + `parseOpsAbstract`（最关键的两个）
- [ ] 实现 `buildOpsPatentData`（其他字段先返回空）
- [ ] 修改 `scrapeGooglePatent` 失败分支，接入 `queryOpsPatent`
- [ ] 配置环境变量 `OPS_CONSUMER_KEY` / `OPS_CONSUMER_SECRET`（或前端请求头传递）
- [ ] 测试：用一个 GP 上没有但 OPS 有的专利号验证

### 阶段 2：完整字段 + 向前引用

- [ ] 实现 `parseOpsClaims` + `parseOpsDescription`
- [ ] 实现 `parseOpsEquivalent`（同族）
- [ ] 实现 `parseOpsLegal`（法律状态）
- [ ] 实现 `fetchOpsCiting`（向前引用，CQL 搜索）
- [ ] 实现 `parseOpsImages`（附图元信息，附图代理端点可选）

### 阶段 3：PDF 下载 + 设置界面

- [ ] 安装 `pdf-lib` 依赖
- [ ] 实现 `downloadOpsPatentPdf`（逐页下载 + 合并）
- [ ] 新增 `/api/ops/pdf/{patentNumber}` 路由
- [ ] 在 `buildOpsPatentData` 中填充 `pdf_link`
- [ ] 前端新增 "EPO OPS" 设置 tab（HTML + JS 逻辑）
- [ ] 实现 `/api/ops/quota` 和 `/api/ops/test` 端点
- [ ] 前端配置通过请求头传递给后端

### 阶段 4：优化

- [ ] 实现 OPS 结果内存缓存（24h TTL）
- [ ] 实现附图代理端点 `/api/ops/image`
- [ ] 前端显示数据来源徽章（可选）
- [ ] 配额超限保护（status=red 时临时禁用 1 小时）
- [ ] PDF 文件缓存到 `/tmp/ops_pdf_{num}.pdf`

---

## 十二、测试用例

### 12.1 测试专利号

| 专利号 | 预期 GP 结果 | 预期 OPS 结果 | 测试目的 |
|--------|-------------|--------------|---------|
| `US12345678B2`（示例） | 成功 | 不触发 | 验证 GP 成功时不降级 |
| `EP4252965A1`（真实 EP） | 成功 | 不触发 | 验证 EP 专利 GP 正常 |
| 一个 GP 上 404 的号码 | 失败 | 触发 OPS | 验证降级触发 |
| `WO2024xxxxxxA1`（很新的 PCT） | 可能失败 | OPS 应有 | 验证新公开专利 |
| 空号 / 非法号 | 失败 | OPS 也失败 | 验证错误处理 |

### 12.2 手动测试命令

```bash
# 1. 测试 token 获取
curl -X POST https://ops.epo.org/3.2/auth/accesstoken \
  -H "Authorization: Basic $(echo -n 'YOUR_KEY:YOUR_SECRET' | base64)" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials"

# 2. 测试 biblio 端点（观察响应头 X-Throttling-Control）
curl -i -s "https://ops.epo.org/3.2/rest-services/published-data/publication/epodoc/EP4252965A1/biblio" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Accept: application/xml"

# 3. 测试向前引用查询
curl -s "https://ops.epo.org/3.2/rest-services/published-data/search/?q=ct%3DEP4252965A1&Range=1-25" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 4. 测试 PDF 页数查询（docdb 格式）
curl -s "https://ops.epo.org/3.2/rest-services/published-data/publication/docdb/EP.4252965.A1/images" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 5. 测试单页 PDF 下载
curl -s -o page1.pdf "https://ops.epo.org/3.2/rest-services/published-data/images/EP/4252965/A1/fullimage.pdf?Range=1" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 6. 测试完整降级流程（启动 server.js 后）
curl -v "http://localhost:8080/api/gp/SOME_INVALID_NUMBER" \
  -H "X-Ops-Consumer-Key: YOUR_KEY" \
  -H "X-Ops-Consumer-Secret: YOUR_SECRET" \
  -H "Accept: application/json"
# 观察响应头 X-Data-Source: ops

# 7. 测试配额查询
curl "http://localhost:8080/api/ops/quota"

# 8. 测试 PDF 下载端点
curl -o test.pdf "http://localhost:8080/api/ops/pdf/EP4252965A1"
```

---

## 十三、风险与注意事项

### 13.1 已知风险

1. **OPS XML 结构变化**：不同专利号的 XML 结构可能有差异（单值 vs 数组），解析时必须用 `Array.isArray` 兜底。
2. **命名空间处理**：`removeNSPrefix: true` 可简化访问，但需确认 `fast-xml-parser` 版本支持。
3. **附图代理**：OPS 图片需 Bearer token，前端无法直接访问，必须后端代理。MVP 阶段可先不实现附图。
4. **配额超限**：OPS 返回 403 时表示配额耗尽，需在日志中告警，并临时禁用 OPS 降级（避免持续失败）。
5. **号码格式差异**：OPS 的 `epodoc` 格式与 Google Patents 略有差异（如 JP 专利号补零规则），需在 `parseOpsBiblio` 中用返回的 `country/doc-number/kind` 重新组装，而非直接用输入号。
6. **PDF 合并失败**：部分单页 PDF 可能损坏，`pdf-lib` 加载时会抛错，需 try-catch 跳过坏页。
7. **向前引用配额消耗**：CQL 搜索返回数据量大，频繁查询 cited_by 会快速消耗配额，建议提供开关让用户按需关闭。
8. **配额头解析**：`X-Throttling-Control` 格式可能因 OPS 版本变化，需做容错处理。

### 13.2 与现有代码的兼容性

- **不修改前端渲染逻辑**：`renderPatentDetail` 零改动，OPS 返回的 JSON 结构与 GP 完全一致。
- **前端仅新增设置 tab**：`web-app.js` 新增 OPS 设置逻辑，不影响现有功能。
- **不影响 GP 正常流程**：降级仅在 GP 所有 variants 失败后触发，GP 成功时无任何开销。
- **不影响其他代理**：JPO / DPMA / GD 代理逻辑独立，互不干扰。
- **配置可选**：未配置 OPS key 时，降级逻辑自动跳过，回退到原 404 行为。

### 13.3 性能考量

- OPS 并发请求 8 个端点（含 citing），每个最多 30s 超时，最坏情况总耗时 30s（并发）。
- PDF 下载串行获取每页，10 页约需 10-30 秒，建议前端显示下载进度。
- 建议前端 loading 文案在 GP 失败后更新为"正在从 EPO OPS 获取..."（可选，需前端小改）。
- 24h 缓存可大幅降低重复查询的延迟和配额消耗。

---

## 十四、参考资源

- **EPO OPS 官方文档**：https://www.epo.org/searching-for-patents/data/coverage/ops.html
- **OPS FAQ（含 PDF 下载、引用查询）**：https://www.epo.org/en/service-support/faq/searching-patents/open-patent-services/search-queries-tips-and-tricks
- **OPS API 规范（PDF）**：https://link.epo.org/web/searching-for-patents/data/en-ops-v3.2-documentation-version-1.3.20.pdf
- **OPS OpenAPI 规范（YAML）**：http://ops.epo.org/wsdl/ops.yaml
- **GitHub SDK 参考**：
  - https://github.com/jpmairal/epo-ops（Python SDK，端点用法清晰）
  - https://github.com/parkerbaird/epo-ops-sdk（Node.js 思路参考）
  - https://docs.rs/epo-client（Rust 客户端，citing/citations 实现参考）
- **fast-xml-parser 文档**：https://github.com/NaturalIntelligence/fast-xml-parser
- **pdf-lib 文档**：https://pdf-lib.js.org/
- **本项目相关代码**：
  - Google Patents 抓取：[server.js#L1048](file:///workspace/server.js#L1048)
  - HTML 解析与数据结构：[server.js#L391](file:///workspace/server.js#L391)
  - 前端查询入口：[src/scripts/web-app.js#L401](file:///workspace/src/scripts/web-app.js#L401)
  - 前端渲染：[src/scripts/web-app.js#L453](file:///workspace/src/scripts/web-app.js#L453)
  - 设置弹窗结构：[src/web.html#L291](file:///workspace/src/web.html#L291)
  - JPO OAuth 参考：[server.js#L152](file:///workspace/server.js#L152)

---

**文档版本**：v2.0（新增 PDF 下载、向前引用查询、设置界面配置）
**最后更新**：2026-06-25
**适用项目**：PatentLens（/workspace）
