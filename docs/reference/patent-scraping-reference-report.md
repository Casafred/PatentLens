# Google Patents 专利信息抓取与展示对接参考报告

> 生成日期：2026-06-24
> 涉及核心文件：
> - 后端爬虫：`backend/scraper/simple_scraper.py`
> - 浏览器管理：`backend/scraper/browser_manager.py`
> - API路由：`backend/routes/patent.py`
> - 前端入口：`js/patentDetailNewTab.js`
> - 新标签页核心：`js/modules/patent-detail-newtab/index.js`
> - HTML构建：`js/modules/patent-detail-newtab/html-builder.js`
> - 内容区块：`js/modules/patent-detail-newtab/sections.js`
> - 缓存：`js/modules/patent-detail-newtab/cache.js`
> - 附图查看：`js/modules/patent-detail-newtab/viewer.js`
> - 翻译：`js/modules/patent-detail-newtab/translation.js`
> - AI对话：`js/modules/patent-detail-newtab/chat.js`
> - 关系爬取：`js/modules/patent-batch/relation-batch-crawler.js`

---

## 一、系统架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                        用户交互层                                 │
│  输入专利号 → 点击爬取 → 查看结果 → 点击"新标签页打开"           │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ↓
┌──────────────────────────────────────────────────────────────────┐
│                      前端数据层                                   │
│  main.js                                                         │
│    apiCall('/patent/search') → window.patentResults[]            │
│    apiCall('/patent/analyze') → window.patentBatchAnalysisResults│
└──────────────────────┬───────────────────────────────────────────┘
                       │ HTTP POST/GET (JSON)
                       ↓
┌──────────────────────────────────────────────────────────────────┐
│                     后端 API 路由层                               │
│  patent.py (Flask Blueprint: patent_bp)                          │
│    /patent/search       → 批量爬取                               │
│    /patent/analyze      → AI解读                                 │
│    /patent/chat         → AI对话                                 │
│    /patent/translate    → 翻译                                   │
│    /patent/family/<id>  → 同族专利                               │
│    /patent/family/claims-preview → 权利要求预览                  │
│    /patent/family/compare → 同族对比                             │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ↓
┌──────────────────────────────────────────────────────────────────┐
│                      爬虫引擎层                                   │
│  SimplePatentScraper (requests + BeautifulSoup)                  │
│    ↓ HTTP GET patents.google.com/patent/{patent_number}         │
│    ↓ HTML解析 → SimplePatentData (20+字段)                      │
│    ↓ 封装 → SimplePatentResult.to_dict()                        │
│                                                                  │
│  PlaywrightBrowserManager (备用，需JS渲染时)                     │
│    ↓ Playwright无头浏览器                                        │
│    ↓ 等待动态内容加载 → 获取完整HTML                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 二、爬虫数据结构完整定义

### 2.1 SimplePatentData 字段清单

```python
@dataclass
class SimplePatentData:
    patent_number: str           # 专利号（规范化后的大写格式）
    title: str = ""             # 专利标题
    abstract: str = ""          # 摘要
    inventors: List[str]        # 发明人列表
    assignees: List[str]        # 申请人/受让人列表
    application_date: str = ""  # 申请日期
    publication_date: str = ""  # 公开日期
    claims: List[str]           # 权利要求列表（含独立/从属标记）
    description: str = ""       # 说明书全文
    url: str = ""               # Google Patents URL
    drawings: List[str]         # 附图URL列表
    pdf_link: str = ""          # PDF原文下载链接
    patent_citations: List[Dict] # 引用专利列表
    cited_by: List[Dict]        # 被引用专利列表
    events_timeline: List[Dict] # 事件时间轴
    legal_events: List[Dict]    # 法律事件
    similar_documents: List[Dict] # 相似文档
    classifications: List[Dict] # CPC分类信息
    landscapes: List[Dict]      # 技术领域
    family_id: str = ""         # 同族ID
    family_applications: List[Dict] # 同族申请
    country_status: List[Dict]  # 国家状态
    priority_date: str = ""     # 优先权日期
    external_links: Dict[str, Dict] # 外部链接
```

### 2.2 SimplePatentResult 输出格式

爬虫最终通过 `SimplePatentResult.to_dict()` 返回给前端的JSON结构：

```json
{
  "patent_number": "US12390907B2",
  "success": true,
  "processing_time": 3.52,
  "data": {
    "patent_number": "US12390907B2",
    "title": "Method for ...",
    "abstract": "A method for ...",
    "inventors": ["John Doe", "Jane Smith"],
    "assignees": ["Example Corp"],
    "application_date": "2023-01-15",
    "publication_date": "2024-06-20",
    "claims": ["[1] A method comprising...", "[2][从属] The method of claim 1..."],
    "description": "TECHNICAL FIELD\n\nThe present invention...",
    "url": "https://patents.google.com/patent/US12390907B2",
    "drawings": ["https://patentimages.storage.googleapis.com/.../US12390907B2-00001.png"],
    "pdf_link": "https://patentimages.storage.googleapis.com/.../US12390907B2.pdf",
    "patent_citations": [{"patent_number": "US9876543B2", "title": "...", "priority_date": "...", "publication_date": "...", "assignee": "...", "link": "...", "examiner_cited": true}],
    "cited_by": [{"patent_number": "US11111111B2", "title": "...", "priority_date": "...", "publication_date": "...", "assignee": "...", "link": "..."}],
    "events_timeline": [{"date": "2023-01-15", "title": "Application Filed", "type": "Filed", "is_critical": false, "is_current": false, "document_id": "", "description": "Application Filed (Filed)"}],
    "legal_events": [{"date": "2024-01-10", "code": "STPP", "title": "Patent Issued", "description": "Patent Issued", "free_format_text": ""}],
    "similar_documents": [{"patent_number": "US22222222B2", "language": "en", "link": "..."}],
    "classifications": [{"code": "G06F → G06F8 → G06F8/30", "description": "Physics → Computing → Software design", "leaf_code": "G06F8/30", "leaf_description": "Software design", "is_cpc": true, "is_leaf": true}],
    "landscapes": [{"name": "Engineering", "type": ""}],
    "family_id": "12345",
    "family_applications": [{"application_number": "US17/123456", "status": "Granted", "expiration": "2043-01-15", "publication_number": "US12390907B2", "language": "en", "priority_date": "2023-01-15", "filing_date": "2023-01-15", "title": "...", "link": "..."}],
    "country_status": [{"country_code": "US", "count": "1", "publication_number": "US12390907B2", "language": "en", "is_this_country": true, "link": "..."}],
    "priority_date": "2023-01-15",
    "external_links": {"USPTO": {"text": "USPTO", "url": "https://..."}}
  },
  "url": "https://patents.google.com/patent/US12390907B2"
}
```

---

## 三、各字段抓取策略详解

### 3.1 基础字段（始终抓取）

#### patent_number — 专利号

| 项目 | 说明 |
|---|---|
| 输入 | 用户输入的原始专利号 |
| 规范化 | `normalize_patent_number()`: 转大写、去空格/斜杠 |
| 变体回退 | 生成变体列表，依次尝试：`US12390907B2` → `US12390907` → `US12390907B` |
| 输出 | 规范化后的专利号 |

#### title — 专利标题

| 优先级 | 策略 | CSS选择器/路径 |
|---|---|---|
| 1 | JSON-LD | `script[type='application/ld+json']` → `@graph` → `@type=Patent` → `name` |
| 2 | HTML回退 | `h1` 标签文本 |
| 清理 | 去除后缀 | 移除 ` - Google Patents`、专利号前缀 |

#### abstract — 摘要

| 优先级 | 策略 | CSS选择器 |
|---|---|---|
| 1 | JSON-LD | `@graph` → `@type=Patent` → `abstract` |
| 2 | itemprop | `section[itemprop='abstract']` |
| 3 | class | `div.abstract` |
| 4 | 标签名 | `abstract` 标签 |

#### inventors — 发明人

| 优先级 | 策略 | CSS选择器 |
|---|---|---|
| 1 | JSON-LD | `@type=Patent` → `inventor` → `name` |
| 2 | meta标签 | `meta[name='DC.contributor'][scheme='inventor']` → `content` |
| 3 | itemprop | `dd[itemprop='inventor']` → `span[itemprop='name']` |

#### assignees — 申请人

| 优先级 | 策略 | CSS选择器 |
|---|---|---|
| 1 | JSON-LD | `@type=Patent` → `assignee` → `name` |
| 2 | itemprop | `dd[itemprop='assigneeCurrent']` → `span[itemprop='name']` |
| 3 | 备用 | `dd[itemprop='assigneeOriginal']` |

#### application_date / publication_date — 日期

| 优先级 | 策略 | CSS选择器 |
|---|---|---|
| 1 | JSON-LD | `filingDate` / `publicationDate` |
| 2 | time标签 | `time[itemprop='filingDate']` / `time[itemprop='publicationDate']` |

#### claims — 权利要求（始终抓取，不受 crawl_specification 限制）

| 优先级 | 策略 | CSS选择器 | 输出格式 |
|---|---|---|---|
| 1 | li元素 | `section[itemprop='claims']` → `li.claim` / `li.claim-dependent` | `[N] 文本` 或 `[N][从属] 文本` |
| 2 | num属性 | `div[num].claim` → `div.claim-text` | 纯文本 |
| 3 | class回退 | `div.claim` | 纯文本（去重） |
| 4 | 正则分割 | 整段文本按 `\d+\.\s*` 分割 | `N. 文本` |

**独立/从属权利要求识别：**
- `li.claim-dependent` → 从属权利要求，输出加 `[从属]` 标记
- `li.claim` → 独立权利要求
- 回退方案：检查文本是否包含 `claim-ref` 或 `claim \d+` 模式

#### drawings — 附图（始终抓取）

| 优先级 | 策略 | CSS选择器 | 说明 |
|---|---|---|---|
| 1 | JSON-LD | `@type=Patent` → `image` | 优先取 `url` 字段 |
| 2 | itemprop=images | `li[itemprop='images']` → `meta[itemprop='full']` → `content` | 高清图URL |
| 2b | 缩略图回退 | `li[itemprop='images']` → `img[itemprop='thumbnail']` → `src` | 补 `https:` 前缀 |
| 3 | PDF链接构造 | `a[itemprop='pdfLink']` → 提取hash路径 → 拼接 `{hash}/{patent}-{page}.png` | 最多5页或1页 |
| 4 | figure元素 | `figure` → `img` → `src` | 过滤宽高<100的图标 |
| 5 | 全局img | 所有 `img[src*='patentimages']` | 长度>50的URL |

**crawl_full_drawings 控制：**
- `false`（默认）：每种策略只取第一张
- `true`：取全部附图

#### pdf_link — PDF原文链接

| 策略 | CSS选择器 |
|---|---|
| 单一 | `a[itemprop='pdfLink']` → `href` |

---

### 3.2 进阶字段（需 crawl_specification=True）

#### description — 说明书

| 优先级 | 策略 | CSS选择器 | 输出格式 |
|---|---|---|---|
| 1 | ul.description | `section[itemprop='description']` → `ul.description` | heading → `## 标题`，li → 正文 |
| 2 | description-paragraph | `div.description-paragraph` | 双换行分隔段落 |
| 3 | heading+div | `div[itemprop='content']` → `heading` + `div.description-paragraph` | 标题加换行 |
| 4 | 纯文本 | `section[itemprop='description']` → `get_text()` | 压缩文本 |

> 不限制说明书长度，提取完整内容。

#### patent_citations — 引用专利

| 优先级 | 策略 | CSS选择器 |
|---|---|---|
| 1 | itemprop表格行 | `tr[itemprop='backwardReferencesOrig']` + `tr[itemprop='backwardReferencesFamily']` |
| 2 | h2标题回退 | `h2` 含 `Citations` → 下一个 `table` |

**每条引用专利数据结构：**
```json
{
  "patent_number": "US9876543B2",
  "title": "Related patent title",
  "priority_date": "2020-05-10",
  "publication_date": "2022-03-15",
  "assignee": "Other Corp",
  "link": "https://patents.google.com/patent/US9876543B2",
  "examiner_cited": true
}
```

> 不限制数量，提取所有引用专利。

#### cited_by — 被引用专利

| 优先级 | 策略 | CSS选择器 |
|---|---|---|
| 1 | h3标题 | `h3#citedBy` → 下一个 `table` |
| 2 | 同族引用 | `section[itemprop='family']` → `h2` 含 `Families Citing this family` → `tr[itemprop='forwardReferencesFamily']` |

**每条被引用专利数据结构：**
```json
{
  "patent_number": "US11111111B2",
  "title": "Citing patent",
  "language": "en",
  "examiner_cited": false,
  "priority_date": "2024-01-01",
  "publication_date": "2025-06-01",
  "assignee": "Citing Corp",
  "link": "https://patents.google.com/patent/US11111111B2"
}
```

> 限制前20条。

#### events_timeline — 事件时间轴

| 策略 | CSS选择器 |
|---|---|
| 单一 | `dd[itemprop='events']` |

**每条事件数据结构：**
```json
{
  "date": "2023-01-15",
  "title": "Application Filed",
  "type": "Filed",
  "is_critical": false,
  "is_current": false,
  "document_id": "",
  "description": "Application Filed (Filed)"
}
```

> 限制前20条。

#### legal_events — 法律事件

| 优先级 | 策略 | CSS选择器 |
|---|---|---|
| 1 | itemprop表格行 | `tr[itemprop='legalEvents']` |
| 2 | h2标题回退 | `h2` 含 `Legal Events` → 下一个 `table` |

**每条法律事件数据结构：**
```json
{
  "date": "2024-01-10",
  "code": "STPP",
  "title": "Patent Issued",
  "description": "Patent Issued - Free format text content",
  "free_format_text": "Free format text content"
}
```

> 限制前30条。

#### similar_documents — 相似文档

| 策略 | CSS选择器 |
|---|---|
| 单一 | `tr[itemprop='similarDocuments']` → 仅取 `isPatent=true` 的行 |

**每条相似文档数据结构：**
```json
{
  "patent_number": "US22222222B2",
  "language": "en",
  "link": "https://patents.google.com/patent/US22222222B2"
}
```

> 限制前10条。

#### family_id / family_applications / country_status — 同族信息

| 字段 | 策略 | CSS选择器 |
|---|---|---|
| family_id | 文本解析 | `section[itemprop='family']` → `h2` 含 `ID=` → 提取ID值 |
| family_applications | 表格行 | `h2` 含 `Family Applications` → `tr[itemprop='applications']` |
| family_applications补充 | docdbFamily | `tr[itemprop='docdbFamily']`（Also Published As） |
| country_status | 表格行 | `h2` 含 `Country Status` → `tr[itemprop='countryStatus']` |

**family_applications 每条数据结构：**
```json
{
  "application_number": "US17/123456",
  "status": "Granted",
  "expiration": "2043-01-15",
  "publication_number": "US12390907B2",
  "language": "en",
  "priority_date": "2023-01-15",
  "filing_date": "2023-01-15",
  "title": "Method for ...",
  "link": "https://patents.google.com/patent/US12390907B2",
  "source": "worldwide"
}
```

**country_status 每条数据结构：**
```json
{
  "country_code": "US",
  "count": "1",
  "publication_number": "US12390907B2",
  "language": "en",
  "is_this_country": true,
  "link": "https://patents.google.com/patent/US12390907B2"
}
```

> family_applications 限制前30条，country_status 不限制。

---

### 3.3 条件抓取字段（受 selected_fields 控制）

| 字段 | 默认是否抓取 | 控制 |
|---|---|---|
| classifications | 是 | `should_crawl_field('classifications')` |
| landscapes | 是 | `should_crawl_field('landscapes')` |
| priority_date | 是 | `should_crawl_field('priority_date')` |
| external_links | 是 | `should_crawl_field('external_links')` |

#### classifications — CPC分类

| 策略 | CSS选择器 |
|---|---|
| 单一 | `ul[itemprop='classifications']` → `li[itemprop='classifications']` → `span[itemprop='Code']` + `span[itemprop='Description']` |

**每条分类数据结构：**
```json
{
  "code": "G06F → G06F8 → G06F8/30",
  "description": "Physics → Computing → Software design",
  "leaf_code": "G06F8/30",
  "leaf_description": "Software design",
  "is_cpc": true,
  "is_leaf": true
}
```

> 限制前20条。

#### landscapes — 技术领域

| 策略 | CSS选择器 |
|---|---|
| 单一 | `section` → `h2` 含 `Landscapes` → `li[itemprop='landscapes']` → `span[itemprop='name']` |

**每条数据结构：**
```json
{
  "name": "Engineering",
  "type": ""
}
```

#### priority_date — 优先权日期

| 策略 | CSS选择器 |
|---|---|
| 单一 | `time[itemprop='priorityDate']` → `datetime` 属性或文本 |

#### external_links — 外部链接

| 优先级 | 策略 | CSS选择器 |
|---|---|---|
| 1 | itemprop列表 | `li[itemprop='links']` → `meta[itemprop='id']` + `a[itemprop='url']` + `span[itemprop='text']` |
| 2 | h2标题回退 | `h2` 含 `Links` → 下一个 `ul` → `li` |

**数据结构：**
```json
{
  "USPTO": {
    "text": "USPTO",
    "url": "https://uspto.gov/..."
  },
  "Espacenet": {
    "text": "Espacenet",
    "url": "https://worldwide.espacenet.com/..."
  }
}
```

---

## 四、爬虫控制参数

### 4.1 全局参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `delay` | 2.0秒 | 请求间基础延迟 |
| `max_retries` | 3 | 单次请求最大重试次数 |
| `use_rate_limiter` | True | 是否启用全局速率限制 |

### 4.2 请求级参数

| 参数 | 类型 | 说明 |
|---|---|---|
| `crawl_specification` | bool | 是否抓取说明书、引用/被引用、事件时间轴、法律事件、相似文档、同族信息 |
| `crawl_full_drawings` | bool | 是否抓取全部附图（否则只取第一张） |
| `selected_fields` | List[str] | 精确控制抓取哪些字段，None表示全部 |
| `user_id` | str | 用户标识，用于速率限制 |

### 4.3 selected_fields 可选值

```
'description', 'patent_citations', 'cited_by', 'events_timeline',
'legal_events', 'similar_documents', 'classifications', 'landscapes',
'family_id', 'family_applications', 'country_status', 'priority_date',
'external_links'
```

> 注：`title`, `abstract`, `inventors`, `assignees`, `application_date`, `publication_date`, `claims`, `drawings`, `pdf_link` 始终抓取，不受 selected_fields 控制。

### 4.4 反爬策略

| 策略 | 实现 |
|---|---|
| User-Agent轮换 | 5种浏览器UA随机切换 |
| 速率限制 | 全局 RateLimiter + RequestQueue |
| 指数退避重试 | `delay * 2^attempt + random_jitter` |
| 429处理 | 读取 `Retry-After` 头，等待后重试 |
| 403处理 | 等待30-45秒后重试 |
| 专利号变体回退 | 规范化后生成变体列表依次尝试 |

---

## 五、API路由与爬虫调用关系

### 5.1 路由清单

| 路由 | 方法 | 调用的爬虫方法 | 爬虫参数 |
|---|---|---|---|
| `/patent/search` | POST | `scrape_patents_batch()` | `crawl_specification`, `selected_fields` |
| `/patent/analyze` | POST | 不调爬虫 | 接收前端传来的 `patent_data` |
| `/patent/chat` | POST | 不调爬虫 | 接收前端传来的 `patent_data` |
| `/patent/family/<patent_number>` | GET | `scrape_patent()` | `crawl_specification=True`, `selected_fields=['family_applications','country_status']` |
| `/patent/family/claims-preview` | POST | `scrape_patent()` | `crawl_specification=True`, `selected_fields=['claims']` |
| `/patent/family/compare` | POST | `scrape_patent()` | `crawl_specification=True`, `selected_fields=['claims']`（或使用预获取数据） |
| `/patent/translate` | POST | 不调爬虫 | 翻译前端传来的文本 |
| `/patent/version` | GET | 不调爬虫 | — |
| `/patent/stats` | GET | `get_stats()` | — |
| `/patent/rate-limit/status` | GET | `rate_limiter.get_user_stats()` | — |

### 5.2 请求/响应格式

#### POST /patent/search

**请求：**
```json
{
  "patent_numbers": ["US12390907B2", "EP4012345A1"],
  "crawl_specification": true,
  "selected_fields": null
}
```

**响应：**
```json
{
  "success": true,
  "data": [
    {
      "patent_number": "US12390907B2",
      "success": true,
      "processing_time": 3.52,
      "data": { /* SimplePatentData 全部字段 */ },
      "url": "https://patents.google.com/patent/US12390907B2"
    },
    {
      "patent_number": "EP4012345A1",
      "success": false,
      "error": "所有专利号变体查询均失败",
      "processing_time": 15.3
    }
  ]
}
```

#### POST /patent/translate

**请求：**
```json
{
  "text": ["1. A method comprising...", "2. The method of claim 1..."],
  "text_type": "claims",
  "model": "glm-4-flash",
  "source_lang": "en"
}
```

**响应：**
```json
{
  "success": true,
  "data": {
    "text_type": "claims",
    "translations": [
      {"original": "1. A method comprising...", "translated": "1. 一种包含...的方法", "index": 1},
      {"original": "2. The method of claim 1...", "translated": "2. 根据权利要求1所述的方法...", "index": 2}
    ],
    "source_lang": "en",
    "model": "glm-4-flash"
  }
}
```

---

## 六、前端展示模块对接详解

### 6.1 数据流转路径

```
1. 用户输入专利号 → main.js
2. apiCall('/patent/search', {...}) → 后端爬取
3. 后端返回结果 → window.patentResults = results
4. 渲染结果列表（含"新标签页打开"按钮）
5. 用户点击 → openPatentDetailInNewTab(patentNumber)
6. 从 window.patentResults 查找对应数据
7. 构建完整HTML → window.open() + document.write()
8. 缓存数据到 sessionStorage
```

### 6.2 新标签页模块加载顺序

```
patentDetailNewTab.js（入口，注册全局函数）
  ↓ 懒加载
utils.js → PatentDetailUtils（工具函数）
styles.js → PatentDetailStyles（CSS样式）
cache.js → PatentDetailCache（缓存管理）
html-builder.js → PatentDetailHtmlBuilder（HTML构建器）
sections.js → PatentDetailSections（内容区块构建器）
viewer.js → PatentDetailViewer（附图查看器）
modes.js → PatentDetailModes（双栏/图文模式）
translation.js → PatentDetailTranslation（翻译功能）
chat.js → PatentDetailChat（AI对话）
```

### 6.3 数据字段与展示区块映射

| 展示区块 | 构建模块 | 构建方法 | 使用的 data 字段 |
|---|---|---|---|
| 页面头部 | HtmlBuilder | `buildHeader()` | `title`, `application_date`, `publication_date`, `pdf_link`, `external_links` |
| 侧边导航 | HtmlBuilder | `buildSideNav()` | `drawings`(控制附图导航显隐), `analysisResult` |
| 基本信息 | HtmlBuilder | `buildBasicInfo()` | `inventors`, `assignees`, `priority_date`, `pdf_link` |
| 摘要 | HtmlBuilder | `buildAbstract()` | `abstract` |
| 附图 | HtmlBuilder | `buildDrawings()` | `drawings[]` |
| CPC分类 | Sections | `buildClassifications()` | `classifications[]` |
| 权利要求 | Sections | `buildClaims()` | `claims[]`（解析独立/从属标记） |
| 说明书 | Sections | `buildDescription()` | `description` |
| 事件信息 | Sections | `buildEventsCombined()` | `events_timeline[]`, `legal_events[]` |
| 同族信息 | Sections | `buildFamily()` | `family_id`, `family_applications[]`, `country_status[]` |
| 相关专利 | Sections | `buildRelatedPatents()` | `patent_citations[]`, `cited_by[]`, `similar_documents[]` |
| AI解读 | Sections | `buildAnalysisResult()` | `analysisResult`（非爬虫数据） |

### 6.4 新标签页内交互功能与后端对接

| 功能 | 模块 | 触发方式 | 后端API |
|---|---|---|---|
| 附图全屏查看 | Viewer | 点击附图缩略图 | 无（纯前端） |
| 双栏对照 | Modes | 点击"双栏对照"按钮 | 无（纯前端DOM操作） |
| 图文对照 | Modes | 点击"图文对照"按钮 | 无（纯前端DOM操作） |
| 权利要求翻译 | Translation | 点击"翻译"按钮 | POST `/api/patent/translate` |
| 说明书翻译 | Translation | 点击"翻译"按钮 | POST `/api/patent/translate` |
| AI智能问答 | Chat | 点击"问一问"按钮 | POST `/api/patent/chat` |
| Word导出 | WordExport | 点击"下载Word"按钮 | 无（前端html-docx-js生成） |
| 关系专利分析 | — | 点击"分析"按钮 | 通过 `window.opener` 回调主窗口 → POST `/api/patent/search` |
| 同族对比 | — | 点击"同族对比"按钮 | 通过 `window.opener` 回调主窗口 → POST `/api/patent/family/compare` |

### 6.5 缓存机制

| 维度 | 说明 |
|---|---|
| 存储位置 | `sessionStorage` |
| 缓存键 | `patent_detail_cache_{patentNumber}` |
| 缓存内容 | `{ patentResult, analysisResult, timestamp }` |
| 有效期 | 30分钟 |
| 写入时机 | `openPatentDetailInNewTab()` 调用时 |
| 读取时机 | 新标签页通过URL参数 `?patent_detail=XXX` 刷新时恢复 |

### 6.6 主窗口与新标签页通信

| 方向 | 机制 | 用途 |
|---|---|---|
| 主窗口 → 新标签页 | `window.open()` + `document.write(htmlContent)` | 传递完整页面HTML |
| 主窗口 → 新标签页 | `sessionStorage` 缓存 | 刷新时恢复数据 |
| 新标签页 → 主窗口 | `window.opener.openRelationAnalysisTab()` | 触发关系专利分析 |
| 新标签页 → 主窗口 | `window.opener.startFamilyClaimsComparison()` | 触发同族对比 |
| 新标签页 → 主窗口 | `window.opener.localStorage` | 获取API Key |

---

## 七、关系专利批量爬取模块

### 7.1 触发流程

```
新标签页 → 点击"分析"按钮
  → analyzeRelationPatents(event, patentNumber, relationType)
  → 从DOM表格提取关系专利号列表
  → window.opener.openRelationAnalysisTab(sourcePatentNumber, relationType, relationData)
  → 主窗口创建新标签页
  → crawlRelationPatents(tabId, sourcePatentNumber, relationType, patentNumbers)
  → POST /api/patent/search 批量爬取
  → 结果存入 window.patentTabManager
```

### 7.2 关系类型与数据来源

| 关系类型 | relationType | DOM表格ID | 提取字段 |
|---|---|---|---|
| 同族专利 | `family` | `family-table` | `publication_number`, `application_number`, `status` |
| 引用专利 | `citations` | `citations-table` | `patent_number`, `title` |
| 被引用专利 | `cited_by` | `cited-by-table` | `patent_number`, `title` |
| 相似文档 | `similar` | `similar-table` | `patent_number`, `title` |

### 7.3 数量限制

| 用户类型 | 限制 |
|---|---|
| 游客 | 最多1条 |
| 登录用户 | 最多50条（超过需确认） |

---

## 八、Playwright浏览器管理器（备用方案）

### 8.1 适用场景

当 `SimplePatentScraper` 无法获取需要JS渲染的内容时（如被引用专利、部分动态加载的附图），可使用 Playwright 方案。

### 8.2 核心方法

| 方法 | 说明 |
|---|---|
| `initialize()` | 启动Playwright、创建浏览器和上下文 |
| `navigate_to_patent(patent_number)` | 导航到专利页面，等待加载完成 |
| `get_page_content(page)` | 获取完整渲染后的HTML |
| `cleanup()` | 关闭浏览器资源 |
| `refresh_context()` | 刷新上下文（更换反检测设置） |

### 8.3 反检测集成

- `AntiDetectionManager` 提供浏览器启动参数、上下文选项、隐身设置
- 模拟人类行为（鼠标移动、滚动等）

---

## 九、错误处理与边界情况

### 9.1 爬虫层

| 场景 | 处理方式 |
|---|---|
| 专利号不存在 | 尝试所有变体后返回 `success=false` |
| 429 Too Many Requests | 读取 Retry-After，等待后重试 |
| 403 Forbidden | 等待30-45秒后重试 |
| 网络超时 | 指数退避重试（最多3次） |
| HTML结构变化 | 多级回退策略（JSON-LD → itemprop → class → 正则） |
| 部分字段缺失 | 字段保持默认空值，不影响其他字段提取 |

### 9.2 API层

| 场景 | 处理方式 |
|---|---|
| 游客超限 | 返回403 + 剩余额度提示 |
| 无有效专利号 | 返回400 |
| 爬虫异常 | 返回500 + 错误信息 |

### 9.3 前端层

| 场景 | 处理方式 |
|---|---|
| 数据不存在 | alert提示"专利数据不存在" |
| 新窗口被拦截 | `newWindow` 为 null 时无操作 |
| 页面刷新 | 通过URL参数 + sessionStorage 恢复数据 |
| 缓存过期 | alert提示"页面数据已过期" |
| 主窗口不可达 | alert提示"无法连接到主窗口" |

---

## 十、数据字段完整性速查表

| 字段 | 始终抓取 | 需crawl_specification | 受selected_fields控制 | 前端展示区块 | 数量限制 |
|---|---|---|---|---|---|
| patent_number | ✓ | | | 页面头部 | — |
| title | ✓ | | | 页面头部 | — |
| abstract | ✓ | | | 摘要 | — |
| inventors | ✓ | | | 基本信息 | — |
| assignees | ✓ | | | 基本信息 | — |
| application_date | ✓ | | | 页面头部 | — |
| publication_date | ✓ | | | 页面头部 | — |
| claims | ✓ | | | 权利要求 | — |
| description | | ✓ | ✓ | 说明书 | 不限长度 |
| drawings | ✓ | | | 附图 | crawl_full_drawings控制 |
| pdf_link | ✓ | | | 基本信息/头部 | — |
| patent_citations | | ✓ | ✓ | 相关专利(引用) | 不限 |
| cited_by | | ✓ | ✓ | 相关专利(被引用) | 前20条 |
| events_timeline | | ✓ | ✓ | 事件(时间轴tab) | 前20条 |
| legal_events | | ✓ | ✓ | 事件(法律事件tab) | 前30条 |
| similar_documents | | ✓ | ✓ | 相关专利(相似) | 前10条 |
| classifications | ✓(1) | | ✓ | CPC分类 | 前20条 |
| landscapes | ✓(1) | | ✓ | — | 不限 |
| family_id | | ✓ | ✓ | 同族信息 | — |
| family_applications | | ✓ | ✓ | 同族信息 | 前30条 |
| country_status | | ✓ | ✓ | 同族信息 | 不限 |
| priority_date | ✓(1) | | ✓ | 基本信息 | — |
| external_links | ✓(1) | | ✓ | 页面头部 | 不限 |

> (1) 这些字段不受 `crawl_specification` 控制，但受 `selected_fields` 控制。当 `selected_fields=None` 时默认抓取。
