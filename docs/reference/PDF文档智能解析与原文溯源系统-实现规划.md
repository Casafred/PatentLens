# PDF 文档智能解析与原文溯源系统 — 实现规划

> 核心目标：解析 PDF 文档文本内容送入 AI 总结，同时为总结的每段话提供原文溯源链接，
> 用户点击可定位到原文的页码和区域，自行查看确认。

---

## 目录

1. [需求分析与核心挑战](#1-需求分析与核心挑战)
2. [整体架构设计](#2-整体架构设计)
3. [数据流与核心数据结构](#3-数据流与核心数据结构)
4. [阶段一：PDF 文档解析与分块](#4-阶段一pdf-文档解析与分块)
5. [阶段二：AI 总结与溯源关联](#5-阶段二ai-总结与溯源关联)
6. [阶段三：溯源还原与前端展示](#6-阶段三溯源还原与前端展示)
7. [OCR 引擎选型建议](#7-ocr-引擎选型建议)
8. [API 接口设计](#8-api-接口设计)
9. [关键实现细节](#9-关键实现细节)
10. [完整调用示例](#10-完整调用示例)
11. [风险与应对](#11-风险与应对)

---

## 1. 需求分析与核心挑战

### 1.1 功能需求

```
用户上传 PDF
  → 系统自动解析文档文本内容
  → AI 对文本进行结构化总结
  → 总结的每段话旁显示「原文溯源」按钮/链接
  → 用户点击后跳转到原文对应页码的对应区域
  → 用户可自行查看确认 AI 总结是否准确
```

### 1.2 核心挑战

| 挑战 | 说明 |
|------|------|
| **文本-位置绑定** | OCR 解析出的文本必须与页码+区域坐标一一绑定，且这个绑定关系要贯穿整个处理流程 |
| **分块策略** | PDF 文本需按语义分块送入 AI，分块时不能丢失位置信息；块太大则 AI 处理困难，块太小则上下文不足 |
| **AI 溯源标注** | 需要让 AI 在总结时引用来源块 ID，且 AI 必须严格遵循标注格式 |
| **溯源精度** | 坐标精度只需"大致区域"即可（高亮段落级别），不需要精确到行 |
| **长文档处理** | PDF 可能数十页，需要分批送入 AI，且跨页段落需正确处理 |

### 1.3 设计原则

1. **块 ID 贯穿始终**：从 OCR 解析到 AI 总结到前端展示，使用统一的 block_id 串联
2. **宽松区域定位**：溯源只需定位到页面上的大致区域（段落级），不追求行级精度
3. **AI 友好的标注格式**：用简洁的 `[ref:ID]` 标记，让 AI 容易理解和遵循
4. **容错设计**：AI 可能遗漏或错误引用，前端需优雅降级

---

## 2. 整体架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                          前端 (Frontend)                            │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ PDF 上传组件 │  │ AI 总结展示  │  │ 原文溯源查看器           │   │
│  │             │  │ (带溯源标记) │  │ (PDF预览 + 区域高亮)     │   │
│  └──────┬──────┘  └──────┬───────┘  └────────────┬─────────────┘   │
└─────────┼────────────────┼───────────────────────┼─────────────────┘
          │                │                       │
          ▼                ▼                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         后端 API 层                                 │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────────┐    │
│  │ /upload      │  │ /summarize     │  │ /trace/:block_id     │    │
│  │ PDF上传+解析 │  │ AI总结+溯源    │  │ 溯源定位查询         │    │
│  └──────┬───────┘  └───────┬────────┘  └──────────┬───────────┘    │
└─────────┼──────────────────┼───────────────────────┼────────────────┘
          │                  │                       │
          ▼                  ▼                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        核心处理层                                   │
│                                                                     │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │ 1. PDF 解析引擎  │    │ 2. 文本分块引擎   │    │ 3. AI 总结引擎│  │
│  │                 │    │                  │    │               │  │
│  │ PDF → 图片      │    │ 按语义/页码分块   │    │ 分块文本+ID   │  │
│  │ → OCR识别       │──▶│ 注入 block_id    │──▶│ → AI总结      │  │
│  │ → 带坐标的block │    │ 构建位置索引     │    │ → 解析引用    │  │
│  └─────────────────┘    └──────────────────┘    └───────────────┘  │
│                                                                     │
│  ┌─────────────────┐    ┌──────────────────┐                       │
│  │ 4. 溯源索引存储  │    │ 5. PDF 预览服务  │                       │
│  │                 │    │                  │                       │
│  │ block_id → {    │    │ PDF 页面渲染     │                       │
│  │   page, bbox,   │    │ 区域高亮叠加     │                       │
│  │   original_text │    │                  │                       │
│  │ }               │    │                  │                       │
│  └─────────────────┘    └──────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 数据流与核心数据结构

### 3.1 全流程数据流

```
PDF 文件
  │
  ▼ [Step 1: PDF拆页]
图片列表 (每页一张 PNG)
  │
  ▼ [Step 2: OCR版面解析]
原始 Block 列表 (含页码+坐标)
  │
  ▼ [Step 3: 文本分块 + ID注入]
带 ID 的 Chunk 列表 (每个chunk绑定页码+区域)
  │
  ▼ [Step 4: 构建送AI的文本]
标注文本: "[ref:B3]原始文本...[/ref:B3]\n[ref:B4]原始文本...[/ref:B4]"
  │
  ▼ [Step 5: AI总结]
AI 返回带引用标记的总结文本
  │
  ▼ [Step 6: 解析AI输出]
总结段落 + 溯源引用列表
  │
  ▼ [Step 7: 前端渲染]
总结展示 + 溯源链接 → 点击跳转原文区域
```

### 3.2 核心数据结构

#### DocumentBlock — OCR 解析的最小单元

```python
class DocumentBlock:
    block_id: str          # 全局唯一ID，如 "B_p1_0", "B_p3_5"
    page_number: int       # 页码 (1-based)
    bbox: BBox             # 区域坐标
    polygon: List[Point]   # 多边形角点（可选，PaddleOCR-VL提供）
    label: str             # 区域类型: text / table / formula / title / header / footer
    content: str           # 识别的文本内容
    confidence: float      # 置信度
    order: int             # 阅读顺序（PaddleOCR-VL提供）
    group_id: int          # 逻辑分组ID（PaddleOCR-VL提供）
```

#### BBox — 区域坐标

```python
class BBox:
    x1: int    # 左上角X (像素)
    y1: int    # 左上角Y (像素)
    x2: int    # 右下角X (像素)
    y2: int    # 右下角Y (像素)

    @property
    def center(self) -> Tuple[int, int]:
        return ((self.x1 + self.x2) // 2, (self.y1 + self.y2) // 2)

    @property
    def width(self) -> int:
        return self.x2 - self.x1

    @property
    def height(self) -> int:
        return self.y2 - self.y1
```

#### TextChunk — 送入 AI 的文本分块

```python
class TextChunk:
    chunk_id: str                  # 分块ID，如 "C_0", "C_1"
    source_block_ids: List[str]    # 来源 block ID 列表
    content: str                   # 拼接后的文本内容
    page_range: Tuple[int, int]    # 涉及的页码范围 (start, end)
    primary_region: BBox           # 主区域（取第一个block的bbox，用于粗略定位）
    char_count: int                # 字符数
```

#### TraceReference — 溯源引用

```python
class TraceReference:
    ref_id: str              # 引用ID，对应 block_id
    page_number: int         # 原文页码
    bbox: BBox               # 原文区域坐标
    original_text: str       # 原文文本（截取前后各50字作为上下文）
    label: str               # 区域类型
```

#### SummarizedParagraph — AI 总结段落

```python
class SummarizedParagraph:
    paragraph_id: str               # 段落ID
    summary_text: str               # 总结文本
    source_refs: List[str]          # 引用的 block_id 列表
    source_chunks: List[str]        # 引用的 chunk_id 列表
```

#### DocumentTraceIndex — 溯源索引（全文档级别）

```python
class DocumentTraceIndex:
    document_id: str                           # 文档唯一ID
    blocks: Dict[str, DocumentBlock]           # block_id → DocumentBlock
    chunks: Dict[str, TextChunk]               # chunk_id → TextChunk
    page_dimensions: Dict[int, Tuple[int,int]] # page_number → (width, height)
    pdf_image_store: str                       # PDF页面图片存储路径/S3前缀
```

---

## 4. 阶段一：PDF 文档解析与分块

### 4.1 Step 1: PDF 拆页

```python
def pdf_to_page_images(pdf_path: str, dpi: int = 200) -> List[PageImage]:
    """
    将 PDF 逐页转为图片。

    Args:
        pdf_path: PDF 文件路径
        dpi: 渲染分辨率，200dpi 兼顾清晰度和文件大小

    Returns:
        List[PageImage]: 每页的图片数据 + 页码 + 尺寸
    """
    import fitz  # PyMuPDF

    doc = fitz.open(pdf_path)
    pages = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        # 渲染为图片
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=mat)

        pages.append(PageImage(
            page_number=page_num + 1,
            image_data=pix.tobytes("png"),
            width=pix.width,
            height=pix.height
        ))

    return pages
```

**推荐库**：`PyMuPDF (fitz)` — 纯 Python，渲染质量高，支持加密 PDF

### 4.2 Step 2: OCR 版面解析

```python
def ocr_parse_pages(pages: List[PageImage], engine: str = "paddle_ocr_vl") -> List[DocumentBlock]:
    """
    对每页图片进行 OCR 版面解析，提取带坐标的文本块。

    策略：逐页调用 OCR API，每页结果自动带页码。
    """
    all_blocks = []

    for page in pages:
        if engine == "paddle_ocr_vl":
            result = perform_paddle_ocr_vl(page.image_data)
            page_blocks = _extract_blocks_from_paddle_result(result, page.page_number)
        elif engine == "glm_ocr":
            result = perform_glm_ocr_layout(page.image_data, api_key)
            page_blocks = _extract_blocks_from_glm_result(result, page.page_number)
        else:
            raise ValueError(f"Unsupported engine: {engine}")

        all_blocks.extend(page_blocks)

    return all_blocks


def _extract_blocks_from_paddle_result(result: dict, page_number: int) -> List[DocumentBlock]:
    """从 PaddleOCR-VL 结果提取 blocks"""
    blocks = []

    for page_data in result.get('pages', []):
        for block in page_data.get('blocks', []):
            bbox = block.get('bbox', {})
            block_id = f"B_p{page_number}_{block.get('index', len(blocks))}"

            blocks.append(DocumentBlock(
                block_id=block_id,
                page_number=page_number,
                bbox=BBox(
                    x1=bbox.get('lt', [0,0])[0],
                    y1=bbox.get('lt', [0,0])[1],
                    x2=bbox.get('rb', [0,0])[0],
                    y2=bbox.get('rb', [0,0])[1]
                ),
                polygon=block.get('polygon_points', []),
                label=block.get('label', block.get('type', 'text')),
                content=block.get('content', block.get('text', '')),
                confidence=block.get('confidence', 1.0),
                order=block.get('order'),
                group_id=block.get('group_id')
            ))

    return blocks


def _extract_blocks_from_glm_result(result: dict, page_number: int) -> List[DocumentBlock]:
    """从 GLM OCR 版面解析结果提取 blocks"""
    blocks = []

    for page_idx, page_blocks in enumerate(result.get('layout_details', [])):
        actual_page = page_number  # 单页调用时直接用传入的页码
        for block_idx, block in enumerate(page_blocks):
            bbox_2d = block.get('bbox_2d', [0, 0, 0, 0])
            page_width = block.get('width', 1224)
            page_height = block.get('height', 1584)

            # GLM OCR bbox_2d 实际返回像素坐标（需验证）
            x1, y1, x2, y2 = bbox_2d

            block_id = f"B_p{actual_page}_{block_idx}"

            blocks.append(DocumentBlock(
                block_id=block_id,
                page_number=actual_page,
                bbox=BBox(x1=x1, y1=y1, x2=x2, y2=y2),
                polygon=[],
                label=block.get('label', 'text'),
                content=block.get('content', ''),
                confidence=1.0,
                order=block.get('index'),
                group_id=None
            ))

    return blocks
```

### 4.3 Step 3: 文本分块 + ID 注入

分块是将 OCR 识别的零散 blocks 组合成适合送入 AI 的语义单元，同时保留位置溯源信息。

#### 分块策略

```
策略选择优先级：
1. 按 OCR 的 group_id 分组（PaddleOCR-VL 提供，最准确）
2. 按页码 + 阅读顺序 + 标题切分（通用方案）
3. 按固定字符数切分（兜底方案）
```

```python
def chunk_blocks(blocks: List[DocumentBlock],
                 max_chunk_chars: int = 2000,
                 overlap_chars: int = 200) -> List[TextChunk]:
    """
    将 blocks 分块，每个 chunk 包含连续的 blocks，
    并记录来源 block_ids 用于溯源。

    分块规则：
    1. 遇到标题 (label=paragraph_title) 则开新 chunk
    2. 遇到新页则开新 chunk（跨页段落不合并，便于溯源定位）
    3. chunk 字符数超过 max_chunk_chars 则在最近的段落边界切分
    4. 切分时保留 overlap_chars 的重叠，避免语义断裂
    """
    chunks = []
    current_blocks = []
    current_text = ""

    for block in sorted(blocks, key=lambda b: (b.page_number, b.order or 0)):
        # 规则1: 标题开新 chunk
        if block.label in ('paragraph_title', 'title') and current_blocks:
            chunks.append(_build_chunk(current_blocks, len(chunks)))
            current_blocks = []

        # 规则2: 新页开新 chunk
        if current_blocks and block.page_number != current_blocks[-1].page_number:
            chunks.append(_build_chunk(current_blocks, len(chunks)))
            current_blocks = []

        current_blocks.append(block)
        current_text += block.content + "\n"

        # 规则3: 超长切分
        if len(current_text) >= max_chunk_chars:
            chunks.append(_build_chunk(current_blocks, len(chunks)))
            # 保留最后 overlap_chars 的 blocks 作为重叠
            current_blocks = _keep_tail_blocks(current_blocks, overlap_chars)
            current_text = "".join(b.content + "\n" for b in current_blocks)

    if current_blocks:
        chunks.append(_build_chunk(current_blocks, len(chunks)))

    return chunks


def _build_chunk(blocks: List[DocumentBlock], chunk_index: int) -> TextChunk:
    """构建一个 TextChunk，记录来源 block_ids 和位置信息"""
    content = "\n".join(b.content for b in blocks if b.content.strip())

    return TextChunk(
        chunk_id=f"C_{chunk_index}",
        source_block_ids=[b.block_id for b in blocks],
        content=content,
        page_range=(blocks[0].page_number, blocks[-1].page_number),
        primary_region=blocks[0].bbox,
        char_count=len(content)
    )
```

---

## 5. 阶段二：AI 总结与溯源关联

### 5.1 Step 4: 构建送 AI 的标注文本

这是整个系统的**核心环节** — 将分块文本注入溯源标记后送入 AI。

#### 标注格式设计

```
设计原则：
1. 标记简洁，不干扰 AI 理解文本语义
2. 标记唯一，AI 可以准确引用
3. 标记明确，AI 容易遵循引用规则
```

**推荐格式**：`[ref:BLOCK_ID]...[/ref:BLOCK_ID]`

```
示例输入给 AI 的文本：

[ref:B_p1_0]## POWER TOOL[/ref:B_p1_0]

[ref:B_p1_1]## BACKGROUND OF THE INVENTION[/ref:B_p1_1]

[ref:B_p1_2]The present invention relates to a power tool that performs
a screw-tightening operation or a drilling operation...[/ref:B_p1_2]

[ref:B_p1_3]Japanese non-examined laid-open Patent Publication No.
2000-218412 discloses a driver bit mounting device...[/ref:B_p1_3]
```

#### 构建代码

```python
def build_annotated_text(chunks: List[TextChunk],
                         blocks: Dict[str, DocumentBlock]) -> str:
    """
    将 chunks 中的文本按 block 级别注入溯源标记。

    策略：按 chunk 顺序拼接，每个 chunk 内按 block 逐个包裹 ref 标记。
    """
    annotated_parts = []

    for chunk in chunks:
        chunk_parts = []

        for block_id in chunk.source_block_ids:
            block = blocks[block_id]
            content = block.content.strip()
            if content:
                chunk_parts.append(f"[ref:{block_id}]{content}[/ref:{block_id}]")

        annotated_parts.append("\n\n".join(chunk_parts))

    return "\n\n---\n\n".join(annotated_parts)
```

### 5.2 Step 5: AI 总结 Prompt 设计

Prompt 是溯源准确性的关键，需要明确要求 AI 引用来源：

```python
SUMMARIZE_SYSTEM_PROMPT = """你是一个专业的文档分析助手。你的任务是对用户提供的文档内容进行结构化总结。

## 关键规则

1. **必须引用来源**：你的每一段总结都必须标注来源，使用 [ref:BLOCK_ID] 格式引用。
   - 在总结的每一段末尾，用 【来源: ref_id1, ref_id2】 标注该段总结依据的原文块
   - 可以引用多个来源块

2. **总结格式**：
   - 使用 Markdown 格式
   - 按主题分节，每节有标题
   - 每段总结后紧跟来源标注

3. **输出示例**：

### 发明背景

该发明涉及一种电动工具，能够执行拧紧螺丝或钻孔操作，特别涉及一种以简单结构将工具钻头安装到电动工具上的技术。【来源: B_p1_2, B_p1_3】

现有技术中，日本专利公开 No. 2000-218412 公开了一种冲击钻头的安装装置，通过将钻头插入工具保持器的安装孔来安装钻头。【来源: B_p1_3】

### 技术方案

该发明通过在工具保持器上设置径向延伸的细长孔...【来源: B_p2_0, B_p2_1】

4. **注意事项**：
   - 不要编造文档中没有的内容
   - 如果某段总结综合了多个来源，全部列出
   - 保持来源标注的准确性，不要张冠李戴
"""

SUMMARIZE_USER_PROMPT_TEMPLATE = """请对以下文档内容进行结构化总结，注意在每段总结后标注来源引用。

文档内容：
{annotated_text}
"""
```

### 5.3 Step 6: 解析 AI 输出，提取溯源引用

```python
import re

def parse_ai_summary(ai_output: str) -> List[SummarizedParagraph]:
    """
    解析 AI 输出，提取总结段落和溯源引用。

    AI 输出格式示例：
    ### 发明背景
    该发明涉及一种电动工具...【来源: B_p1_2, B_p1_3】

    返回：
    [
        SummarizedParagraph(
            paragraph_id="P_0",
            summary_text="该发明涉及一种电动工具...",
            source_refs=["B_p1_2", "B_p1_3"],
            source_chunks=["C_0"]
        )
    ]
    """
    paragraphs = []

    # 按 【来源: ...】 分割
    pattern = re.compile(
        r'(.*?)【来源:\s*([^\】]+)】',
        re.DOTALL
    )

    para_index = 0
    for match in pattern.finditer(ai_output):
        text = match.group(1).strip()
        refs_str = match.group(2).strip()

        if not text:
            continue

        # 解析引用ID列表
        source_refs = [r.strip() for r in refs_str.split(',') if r.strip()]

        # 过滤无效引用（验证 block_id 存在）
        source_refs = [r for r in source_refs if r.startswith('B_')]

        paragraphs.append(SummarizedParagraph(
            paragraph_id=f"P_{para_index}",
            summary_text=text,
            source_refs=source_refs,
            source_chunks=[]  # 后续填充
        ))
        para_index += 1

    # 处理没有来源标注的尾部文本（容错）
    remaining = ai_output[match.end():].strip() if pattern.finditer(ai_output) else ai_output
    # ... 可选：将未标注来源的文本作为独立段落

    return paragraphs


def enrich_paragraphs_with_chunks(
    paragraphs: List[SummarizedParagraph],
    blocks: Dict[str, DocumentBlock],
    chunks: List[TextChunk]
) -> List[SummarizedParagraph]:
    """为每个段落补充 source_chunks 信息"""
    block_to_chunk = {}
    for chunk in chunks:
        for block_id in chunk.source_block_ids:
            block_to_chunk[block_id] = chunk.chunk_id

    for para in paragraphs:
        para.source_chunks = list(set(
            block_to_chunk.get(ref, "")
            for ref in para.source_refs
            if ref in block_to_chunk
        ))
        para.source_chunks = [c for c in para.source_chunks if c]

    return paragraphs
```

### 5.4 长文档分批处理

当文档超过 AI 上下文窗口时，需要分批处理：

```python
def summarize_long_document(
    chunks: List[TextChunk],
    blocks: Dict[str, DocumentBlock],
    ai_client,
    max_tokens_per_request: int = 6000
) -> List[SummarizedParagraph]:
    """
    长文档分批总结策略：
    1. 按 chunk 字符数分批，每批不超过 max_tokens_per_request
    2. 每批独立总结，保留溯源标记
    3. 可选：最后对所有批次总结做一次全局整合
    """
    batches = _split_chunks_into_batches(chunks, max_tokens_per_request)
    all_paragraphs = []

    for batch_idx, batch_chunks in enumerate(batches):
        # 构建该批次的标注文本
        annotated = build_annotated_text(batch_chunks, blocks)

        # 调用 AI
        ai_output = ai_client.chat(
            system=SUMMARIZE_SYSTEM_PROMPT,
            user=SUMMARIZE_USER_PROMPT_TEMPLATE.format(annotated_text=annotated)
        )

        # 解析输出
        paragraphs = parse_ai_summary(ai_output)
        paragraphs = enrich_paragraphs_with_chunks(paragraphs, blocks, batch_chunks)

        all_paragraphs.extend(paragraphs)

    # 可选：全局整合
    if len(batches) > 1:
        all_paragraphs = _merge_batch_summaries(all_paragraphs, ai_client)

    return all_paragraphs


def _split_chunks_into_batches(chunks: List[TextChunk],
                                max_chars: int) -> List[List[TextChunk]]:
    """按字符数分批"""
    batches = []
    current_batch = []
    current_chars = 0

    for chunk in chunks:
        if current_chars + chunk.char_count > max_chars and current_batch:
            batches.append(current_batch)
            current_batch = []
            current_chars = 0

        current_batch.append(chunk)
        current_chars += chunk.char_count

    if current_batch:
        batches.append(current_batch)

    return batches
```

---

## 6. 阶段三：溯源还原与前端展示

### 6.1 溯源查询 API

```python
def get_trace_info(block_id: str, trace_index: DocumentTraceIndex) -> TraceReference:
    """根据 block_id 查询溯源信息"""
    block = trace_index.blocks[block_id]
    page_width, page_height = trace_index.page_dimensions[block.page_number]

    return TraceReference(
        ref_id=block.block_id,
        page_number=block.page_number,
        bbox=block.bbox,
        original_text=block.content,
        label=block.label
    )


def get_trace_info_for_paragraph(
    paragraph: SummarizedParagraph,
    trace_index: DocumentTraceIndex
) -> List[TraceReference]:
    """获取一个总结段落的所有溯源引用"""
    refs = []
    for block_id in paragraph.source_refs:
        if block_id in trace_index.blocks:
            refs.append(get_trace_info(block_id, trace_index))
    return refs
```

### 6.2 前端溯源展示方案

#### 方案 A：PDF.js 渲染 + 区域高亮叠加（推荐）

```
┌───────────────────────────────────────────────────────┐
│  AI 总结面板              │   原文溯源查看器            │
│                           │                            │
│  ### 发明背景             │   ┌────────────────────┐   │
│                           │   │  PDF 页面渲染       │   │
│  该发明涉及一种电动工具，  │   │  (PDF.js canvas)   │   │
│  能够执行拧紧螺丝...      │   │                    │   │
│                           │   │  ┌──────────────┐  │   │
│  [溯源 🔗] ← 点击        │   │  │ 高亮区域      │  │   │
│                           │   │  │ (黄色半透明)  │  │   │
│  ### 技术方案             │   │  └──────────────┘  │   │
│                           │   │                    │   │
│  该发明通过在工具保持器    │   └────────────────────┘   │
│  上设置径向延伸的...       │                            │
│                           │   第 1 页 / 共 5 页  < >   │
│  [溯源 🔗] ← 点击        │                            │
└───────────────────────────┴────────────────────────────┘
```

**实现要点**：

```javascript
// 1. 点击溯源链接
function onTraceClick(sourceRefs: string[]) {
    // sourceRefs = ["B_p1_2", "B_p1_3"]

    // 2. 查询溯源信息
    const traceInfo = await fetch(`/api/trace`, {
        method: 'POST',
        body: JSON.stringify({ block_ids: sourceRefs })
    });

    // 3. 跳转到第一个引用的页面
    const firstRef = traceInfo[0];
    renderPDFPage(firstRef.page_number);

    // 4. 在 PDF canvas 上叠加高亮区域
    for (const ref of traceInfo) {
        highlightRegion(ref.bbox, ref.page_number);
    }
}

// 5. 高亮区域绘制
function highlightRegion(bbox: BBox, pageNumber: number) {
    const canvas = getPDFCanvas(pageNumber);
    const ctx = canvas.getContext('2d');
    const scale = canvas.width / pageWidth;

    ctx.fillStyle = 'rgba(255, 255, 0, 0.3)';
    ctx.fillRect(
        bbox.x1 * scale,
        bbox.y1 * scale,
        (bbox.x2 - bbox.x1) * scale,
        (bbox.y2 - bbox.y1) * scale
    );

    // 添加边框
    ctx.strokeStyle = 'rgba(255, 165, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(
        bbox.x1 * scale,
        bbox.y1 * scale,
        (bbox.x2 - bbox.x1) * scale,
        (bbox.y2 - bbox.y1) * scale
    );
}
```

#### 方案 B：图片预览 + 区域高亮（更轻量）

如果不想引入 PDF.js，可以用 PDF 拆页时生成的图片：

```javascript
// 使用 <img> + 绝对定位的 <div> 叠加高亮
function renderPageWithHighlight(pageNumber, bbox) {
    const container = document.getElementById('pdf-viewer');
    container.innerHTML = '';

    // 底层：页面图片
    const img = document.createElement('img');
    img.src = `/api/pages/${pageNumber}/image`;
    img.style.width = '100%';
    container.appendChild(img);

    // 叠加层：高亮区域
    const highlight = document.createElement('div');
    highlight.style.position = 'absolute';
    highlight.style.left = `${(bbox.x1 / pageWidth) * 100}%`;
    highlight.style.top = `${(bbox.y1 / pageHeight) * 100}%`;
    highlight.style.width = `${((bbox.x2 - bbox.x1) / pageWidth) * 100}%`;
    highlight.style.height = `${((bbox.y2 - bbox.y1) / pageHeight) * 100}%`;
    highlight.style.backgroundColor = 'rgba(255, 255, 0, 0.3)';
    highlight.style.border = '2px solid orange';
    highlight.style.pointerEvents = 'none';
    container.appendChild(highlight);

    // 滚动到高亮区域
    highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
```

### 6.3 溯源链接样式

```html
<!-- 总结段落 + 溯源链接 -->
<div class="summary-paragraph">
    <p class="summary-text">
        该发明涉及一种电动工具，能够执行拧紧螺丝或钻孔操作...
    </p>
    <div class="trace-links">
        <span class="trace-label">原文溯源：</span>
        <a class="trace-link" onclick="onTraceClick(['B_p1_2', 'B_p1_3'])">
            📄 第1页 · 2处引用
        </a>
    </div>
</div>
```

---

## 7. OCR 引擎选型建议

### 7.1 对比分析

| 维度 | PaddleOCR-VL-1.5 | GLM OCR 版面解析 |
|------|-------------------|-----------------|
| **PDF 直传** | ❌ 需自行拆页 | ✅ 原生支持（≤100页） |
| **坐标精度** | ✅ 像素坐标 + 多边形 | ⚠️ 坐标类型需验证 |
| **阅读顺序** | ✅ block_order | ❌ 仅 index |
| **逻辑分组** | ✅ group_id | ❌ |
| **API Key** | ❌ 预置Token | ✅ 需要 |
| **区域类型** | 丰富（含seal/footnote等） | 基础（text/table/formula/image） |
| **Markdown输出** | ✅ | ✅ |
| **多页结果** | 每次一页，需自行拼 | 一次返回所有页 |

### 7.2 推荐方案

**首选：PaddleOCR-VL-1.5 + 自行拆页**

理由：
1. 坐标始终为像素值，无归一化歧义
2. 提供 `block_order`（阅读顺序）和 `group_id`（逻辑分组），分块更准确
3. 提供多边形坐标，高亮区域更精确
4. 无需 API Key，降低部署门槛
5. 自行拆页虽然多一步，但页码控制更精确

**备选：GLM OCR 版面解析**

适用场景：
- 需要直接处理 PDF 文件（不想自行拆页）
- 已有智谱AI API Key
- 文档页数较多（一次API调用处理整个PDF更高效）

### 7.3 混合方案（推荐）

```python
def parse_document(pdf_path: str, engine: str = "auto") -> List[DocumentBlock]:
    """
    混合方案：
    - 文档 ≤ 20 页：使用 GLM OCR 直传 PDF（一次调用，效率高）
    - 文档 > 20 页：使用 PaddleOCR-VL 逐页解析（避免超时，更稳定）
    """
    page_count = get_pdf_page_count(pdf_path)

    if engine == "auto":
        engine = "glm_ocr" if page_count <= 20 else "paddle_ocr_vl"

    if engine == "glm_ocr":
        return parse_with_glm_ocr(pdf_path)    # 直传PDF
    else:
        return parse_with_paddle_ocr_vl(pdf_path)  # 拆页后逐页调用
```

---

## 8. API 接口设计

### 8.1 文档上传与解析

```
POST /api/documents/upload
Content-Type: multipart/form-data

请求：
  file: PDF文件

响应：
{
    "document_id": "doc_abc123",
    "page_count": 15,
    "status": "parsed",
    "blocks_count": 87,
    "chunks_count": 12
}
```

### 8.2 AI 总结

```
POST /api/documents/{document_id}/summarize
Content-Type: application/json

请求：
{
    "summary_type": "structured",     // structured / brief / detailed
    "focus_areas": [],                // 可选：聚焦领域
    "language": "zh"                  // 输出语言
}

响应：
{
    "document_id": "doc_abc123",
    "summary": [
        {
            "paragraph_id": "P_0",
            "section_title": "发明背景",
            "summary_text": "该发明涉及一种电动工具...",
            "source_refs": ["B_p1_2", "B_p1_3"],
            "trace_preview": {
                "pages": [1],
                "ref_count": 2,
                "primary_page": 1
            }
        }
    ]
}
```

### 8.3 溯源查询

```
POST /api/documents/{document_id}/trace
Content-Type: application/json

请求：
{
    "block_ids": ["B_p1_2", "B_p1_3"]
}

响应：
{
    "document_id": "doc_abc123",
    "traces": [
        {
            "ref_id": "B_p1_2",
            "page_number": 1,
            "bbox": {"x1": 150, "y1": 266, "x2": 588, "y2": 345},
            "page_dimensions": {"width": 1224, "height": 1584},
            "original_text": "The present invention relates to a power tool...",
            "label": "text"
        },
        {
            "ref_id": "B_p1_3",
            "page_number": 1,
            "bbox": {"x1": 150, "y1": 365, "x2": 588, "y2": 824},
            "page_dimensions": {"width": 1224, "height": 1584},
            "original_text": "Japanese non-examined laid-open Patent Publication...",
            "label": "text"
        }
    ]
}
```

### 8.4 页面图片获取

```
GET /api/documents/{document_id}/pages/{page_number}/image

响应：图片文件 (image/png)
```

### 8.5 原文上下文查询

```
POST /api/documents/{document_id}/context
Content-Type: application/json

请求：
{
    "block_id": "B_p1_3",
    "context_blocks": 1          // 前后各扩展1个block的上下文
}

响应：
{
    "target": {
        "block_id": "B_p1_3",
        "page_number": 1,
        "bbox": {...},
        "content": "Japanese non-examined..."
    },
    "before": {
        "block_id": "B_p1_2",
        "content": "The present invention relates to..."
    },
    "after": {
        "block_id": "B_p1_4",
        "content": "In the known art..."
    }
}
```

---

## 9. 关键实现细节

### 9.1 block_id 编码规范

```
格式: B_p{页码}_{块序号}

示例:
  B_p1_0   → 第1页第0个块
  B_p1_1   → 第1页第1个块
  B_p3_5   → 第3页第5个块

优点:
  - 人类可读，一眼看出页码
  - 字符串排序自然有序
  - AI 容易理解和引用
```

### 9.2 坐标一致性保障

```
关键问题：OCR 返回的坐标基于渲染图片的像素，而前端展示时
         图片可能被缩放，需要做坐标换算。

解决方案：
1. 存储时保存原始像素坐标 + 页面原始尺寸
2. 前端渲染时根据实际显示尺寸计算缩放比

前端换算公式：
  display_x = original_x * (display_width / page_width)
  display_y = original_y * (display_height / page_height)
```

### 9.3 AI 引用准确率提升策略

| 策略 | 说明 |
|------|------|
| **Few-shot 示例** | 在 Prompt 中提供 2-3 个完整的标注+总结示例 |
| **引用格式约束** | 使用 `【来源: ID1, ID2】` 这种中文标记，AI 不容易忽略 |
| **二次校验** | 解析 AI 输出后，验证引用的 block_id 是否存在于输入中 |
| **温度参数** | 使用较低温度 (0.3-0.5)，减少 AI 幻觉 |
| **分块粒度** | 块不宜过大（≤2000字），AI 对小块的引用更准确 |
| **引用覆盖率检查** | 统计 AI 引用了多少比例的输入块，过低则提示重新总结 |

### 9.4 容错与降级

```python
def parse_ai_summary_robust(ai_output: str, valid_block_ids: Set[str]) -> List[SummarizedParagraph]:
    """容错解析 AI 输出"""
    paragraphs = parse_ai_summary(ai_output)

    for para in paragraphs:
        # 1. 过滤无效引用
        para.source_refs = [r for r in para.source_refs if r in valid_block_ids]

        # 2. 无引用的段落：尝试通过文本相似度匹配原文块
        if not para.source_refs:
            matched = fuzzy_match_blocks(para.summary_text, blocks)
            para.source_refs = [m.block_id for m in matched[:3]]
            para.is_fuzzy_match = True  # 标记为模糊匹配

        # 3. 引用过多：只保留最相关的
        if len(para.source_refs) > 5:
            para.source_refs = para.source_refs[:5]

    return paragraphs
```

### 9.5 文本层 PDF 的优化处理

如果 PDF 本身包含可提取的文本层（非扫描件），可以跳过 OCR：

```python
def extract_text_from_pdf(pdf_path: str) -> List[DocumentBlock]:
    """
    从含文本层的 PDF 直接提取文本+位置信息。
    比 OCR 更快更准确，适合非扫描件 PDF。
    """
    import fitz

    doc = fitz.open(pdf_path)
    blocks = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        # PyMuPDF 提供文本块+坐标
        text_blocks = page.get_text("dict")["blocks"]

        for block_idx, text_block in enumerate(text_blocks):
            if text_block.get('type') != 0:  # 0=文本块
                continue

            bbox = text_block['bbox']  # (x0, y0, x1, y1)
            content = ""
            for line in text_block.get('lines', []):
                for span in line.get('spans', []):
                    content += span.get('text', '')
                content += "\n"

            blocks.append(DocumentBlock(
                block_id=f"B_p{page_num+1}_{block_idx}",
                page_number=page_num + 1,
                bbox=BBox(x1=bbox[0], y1=bbox[1], x2=bbox[2], y2=bbox[3]),
                polygon=[],
                label='text',
                content=content.strip(),
                confidence=1.0,
                order=block_idx,
                group_id=None
            ))

    return blocks


def smart_parse_document(pdf_path: str) -> List[DocumentBlock]:
    """
    智能解析：优先用文本层提取，文本层不足时回退到 OCR。
    """
    blocks = extract_text_from_pdf(pdf_path)

    # 检查提取质量：如果提取的文本太少，说明可能是扫描件
    total_chars = sum(len(b.content) for b in blocks)
    page_count = get_pdf_page_count(pdf_path)
    avg_chars_per_page = total_chars / max(page_count, 1)

    if avg_chars_per_page < 100:
        # 文本层不足，回退到 OCR
        logger.info(f"文本层不足 ({avg_chars_per_page:.0f} 字/页)，回退到 OCR")
        pages = pdf_to_page_images(pdf_path)
        blocks = ocr_parse_pages(pages, engine="paddle_ocr_vl")

    return blocks
```

---

## 10. 完整调用示例

### 10.1 后端完整流程

```python
def process_document(pdf_path: str, ai_client) -> dict:
    """完整的文档处理流程"""

    # === 阶段一：解析 ===

    # Step 1: 智能解析（文本层优先，OCR兜底）
    blocks = smart_parse_document(pdf_path)
    blocks_dict = {b.block_id: b for b in blocks}

    # Step 2: 文本分块
    chunks = chunk_blocks(blocks, max_chunk_chars=2000)

    # Step 3: 构建溯源索引
    page_images = pdf_to_page_images(pdf_path)
    trace_index = DocumentTraceIndex(
        document_id=f"doc_{uuid4().hex[:8]}",
        blocks=blocks_dict,
        chunks={c.chunk_id: c for c in chunks},
        page_dimensions={p.page_number: (p.width, p.height) for p in page_images},
        pdf_image_store=save_page_images(page_images)
    )

    # === 阶段二：AI 总结 ===

    # Step 4: 构建标注文本
    annotated_text = build_annotated_text(chunks, blocks_dict)

    # Step 5: AI 总结
    ai_output = summarize_long_document(chunks, blocks_dict, ai_client)

    # Step 6: 解析 AI 输出
    paragraphs = parse_ai_summary_robust(ai_output, set(blocks_dict.keys()))
    paragraphs = enrich_paragraphs_with_chunks(paragraphs, blocks_dict, chunks)

    # === 阶段三：输出 ===

    return {
        "document_id": trace_index.document_id,
        "page_count": len(trace_index.page_dimensions),
        "blocks_count": len(blocks),
        "chunks_count": len(chunks),
        "summary": [
            {
                "paragraph_id": p.paragraph_id,
                "summary_text": p.summary_text,
                "source_refs": p.source_refs,
                "trace_preview": {
                    "pages": sorted(set(
                        blocks_dict[ref].page_number
                        for ref in p.source_refs
                        if ref in blocks_dict
                    )),
                    "ref_count": len(p.source_refs)
                }
            }
            for p in paragraphs
        ],
        "trace_index": {
            block_id: {
                "page_number": b.page_number,
                "bbox": {"x1": b.bbox.x1, "y1": b.bbox.y1,
                         "x2": b.bbox.x2, "y2": b.bbox.y2},
                "label": b.label,
                "content_preview": b.content[:100]
            }
            for block_id, b in blocks_dict.items()
        }
    }
```

### 10.2 前端调用流程

```javascript
// 1. 上传 PDF
const uploadResult = await fetch('/api/documents/upload', {
    method: 'POST',
    body: formData  // PDF file
});
const { document_id } = await uploadResult.json();

// 2. 请求 AI 总结
const summaryResult = await fetch(`/api/documents/${document_id}/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary_type: 'structured' })
});
const { summary } = await summaryResult.json();

// 3. 渲染总结 + 溯源链接
for (const para of summary) {
    renderSummaryParagraph(para.summary_text, para.source_refs, para.trace_preview);
}

// 4. 点击溯源链接
async function onTraceClick(sourceRefs) {
    const traceResult = await fetch(`/api/documents/${document_id}/trace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ block_ids: sourceRefs })
    });
    const { traces } = await traceResult.json();

    // 跳转到第一个引用所在页面
    const firstTrace = traces[0];
    await renderPDFPage(firstTrace.page_number);

    // 高亮所有引用区域
    for (const trace of traces) {
        highlightRegion(trace.bbox, trace.page_dimensions);
    }
}
```

---

## 11. 风险与应对

### 11.1 AI 引用遗漏或错误

| 风险 | 应对 |
|------|------|
| AI 总结时未标注来源 | 解析后检测无引用段落，通过文本相似度模糊匹配原文块 |
| AI 标注了不存在的 block_id | 解析时过滤无效 ID，只保留存在于 trace_index 中的引用 |
| AI 将来源张冠李戴 | 前端展示时同时显示原文片段预览，用户可快速判断是否匹配 |
| AI 幻觉（编造文档中没有的内容） | Prompt 中强调"不要编造"，前端对无引用段落标黄警告 |

### 11.2 OCR 识别质量

| 风险 | 应对 |
|------|------|
| 扫描件模糊，OCR 识别率低 | 预处理时增强对比度（CLAHE），或使用更高 DPI 渲染 |
| 表格/公式识别不准确 | PaddleOCR-VL 原生支持表格HTML和公式LaTeX输出 |
| 跨页段落被截断 | 分块时检测段落连续性，同一段落跨页时合并但保留两个页码的位置信息 |

### 11.3 性能与成本

| 风险 | 应对 |
|------|------|
| 大文档 OCR 处理慢 | 逐页并行调用（信号量限流），缓存 OCR 结果 |
| AI Token 消耗大 | 分块送入，每块 ≤2000 字；使用低成本模型（如 glm-4-flash） |
| 页面图片存储占用大 | 压缩存储（WebP 格式），或按需生成 |

### 11.4 坐标偏移

| 风险 | 应对 |
|------|------|
| OCR 坐标与实际显示位置不对应 | 统一使用像素坐标 + 页面尺寸，前端按比例换算 |
| GLM OCR 归一化/像素坐标不一致 | 首次集成时做实际 API 调用验证，确认坐标类型 |
| PDF 渲染 DPI 不同导致坐标差异 | 固定 DPI（如200），存储时记录 DPI 参数 |

---

## 附录 A：技术栈推荐

| 组件 | 推荐方案 | 备选 |
|------|---------|------|
| PDF 拆页 | PyMuPDF (fitz) | pdf2image + Poppler |
| 文本层提取 | PyMuPDF `get_text("dict")` | pdfplumber |
| OCR 引擎 | PaddleOCR-VL-1.5 | GLM OCR 版面解析 |
| AI 总结 | GLM-4-Flash（低成本） | Qwen-Plus / GPT-4o-mini |
| 页面图片存储 | 本地文件系统 / S3 | — |
| 前端 PDF 渲染 | PDF.js | react-pdf |
| 后端框架 | Flask / FastAPI | — |
| 缓存 | Redis（OCR结果缓存） | 文件系统缓存 |

## 附录 B：核心依赖

```
# Python 后端
PyMuPDF>=1.24.0          # PDF 解析和渲染
requests>=2.31.0         # OCR API 调用
Pillow>=10.0.0           # 图像处理
numpy>=1.24.0            # 数组操作

# 可选（本地OCR）
rapidocr-onnxruntime     # 本地 OCR 引擎

# 前端
pdfjs-dist               # PDF 渲染
```
