# OCR 引擎调用逻辑详细文档

> 本文档梳理了项目中 RapidOCR、GLM OCR、PaddleOCR 三种 OCR 引擎的完整调用逻辑，
> 供新项目复用 OCR 能力时参考。

---

## 目录

1. [架构总览](#1-架构总览)
2. [RapidOCR（本地离线引擎）](#2-rapidocr本地离线引擎)
3. [GLM OCR（智谱AI云端引擎）](#3-glm-ocr智谱ai云端引擎)
4. [PaddleOCR（百度AI Studio云端引擎）](#4-paddleocr百度ai-studio云端引擎)
5. [统一调度层 ocr_concurrent.py](#5-统一调度层-ocr_concurrentpy)
6. [后处理管道](#6-后处理管道)
7. [路由层集成](#7-路由层集成)
8. [配置与依赖](#8-配置与依赖)
9. [新项目复用指南](#9-新项目复用指南)

---

## 1. 架构总览

### 1.1 两大使用场景

项目中 OCR 能力服务于两个不同的业务场景，对应不同的引擎组合：

| 使用场景 | 可用引擎 | 核心文件 | 输出格式 |
|---------|---------|---------|---------|
| **附图标记识别**（drawing-marker） | RapidOCR / GLM OCR / PP-OCRv5 | `ocr_utils.py` / `glm_ocr_utils.py` / `paddle_ocr_utils.py` | 标记列表 `[{number, x, y, width, height, confidence}]` |
| **PDF文档版面解析**（pdf-ocr） | GLM OCR / PaddleOCR-VL-1.5 | `pdf_ocr.py` / `paddle_ocr_vl_utils.py` | 文档结构 `{pages, markdown, layout_details}` |

### 1.2 文件结构

```
backend/
├── utils/
│   ├── ocr_utils.py            # RapidOCR 引擎封装 + 通用后处理函数
│   ├── glm_ocr_utils.py        # GLM OCR 引擎封装（手写体 + 版面解析）
│   ├── paddle_ocr_utils.py     # PP-OCRv5 引擎封装（附图标记识别）
│   ├── paddle_ocr_vl_utils.py  # PaddleOCR-VL-1.5 引擎封装（文档版面解析）
│   ├── ocr_concurrent.py       # 统一调度层（并发、缓存、降级）
│   └── smart_split_utils.py    # 智能分割工具（处理OCR合并问题）
├── routes/
│   ├── drawing_marker.py       # 附图标记识别路由
│   └── pdf_ocr.py              # PDF文档版面解析路由
└── config/
    └── providers.json          # OCR 引擎配置（API地址、模型信息等）
```

### 1.3 调用架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        路由层 (Routes)                          │
│  ┌──────────────────────┐    ┌────────────────────────────┐    │
│  │  drawing_marker.py   │    │      pdf_ocr.py            │    │
│  │  /drawing-marker/*   │    │  /pdf-ocr/parse            │    │
│  └──────────┬───────────┘    └─────────────┬──────────────┘    │
└─────────────┼──────────────────────────────┼───────────────────┘
              │                              │
              ▼                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     统一调度层 (ocr_concurrent.py)               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  process_drawings_concurrent()                          │    │
│  │  ├── 信号量限流 (Semaphore)                              │    │
│  │  ├── 线程池并发 (ThreadPoolExecutor)                     │    │
│  │  ├── 缓存管理 (DrawingCacheManager)                     │    │
│  │  └── 降级回退 (GLM/PP-OCR → RapidOCR)                   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────┬────────────────┬─────────────────┬───────────────┘
              │                │                 │
              ▼                ▼                 ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   RapidOCR       │ │   GLM OCR        │ │   PaddleOCR      │
│   (本地)         │ │   (智谱云端)      │ │   (百度云端)      │
│                  │ │                  │ │                  │
│  ocr_utils.py    │ │ glm_ocr_utils.py │ │paddle_ocr_utils  │
│                  │ │                  │ │      .py         │
│  rapidocr-       │ │ 手写体OCR API    │ │ PP-OCRv5 API    │
│  onnxruntime     │ │ 版面解析API      │ │                  │
│                  │ │                  │ ├──────────────────┤
│                  │ │                  │ │paddle_ocr_vl     │
│                  │ │                  │ │    _utils.py     │
│                  │ │                  │ │ PaddleOCR-VL API │
└──────────────────┘ └──────────────────┘ └──────────────────┘
              │                │                 │
              └────────────────┼─────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      后处理管道 (共用)                           │
│  deduplicate_results() → filter_by_confidence() →              │
│  smart_split_ocr_results() → match_with_reference_map()        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. RapidOCR（本地离线引擎）

### 2.1 引擎概述

| 属性 | 说明 |
|------|------|
| 引擎类型 | 本地离线 |
| 依赖包 | `rapidocr-onnxruntime` |
| 运行方式 | ONNX Runtime 推理，CPU 即可运行 |
| 是否需要 API Key | 否 |
| 适用场景 | 附图标记识别（专利图纸中的数字/字母标记） |
| 核心文件 | `backend/utils/ocr_utils.py` |

### 2.2 完整调用链路

```
perform_ocr(image_data: bytes)
  │
  ├─ 1. check_memory_available(required_mb=500)
  │     检查系统可用内存（需 psutil）
  │
  ├─ 2. initialize_ocr_engine()
  │     单例模式初始化 RapidOCR 引擎
  │     全局变量 _ocr_engine 缓存实例
  │
  ├─ 3. 图像解码
  │     Image.open(BytesIO(image_data))  →  PIL Image
  │     pil_image.convert('RGB')         →  确保 RGB 格式
  │     np.array(pil_image)              →  numpy array
  │     cv2.cvtColor(image, COLOR_RGB2BGR) → OpenCV BGR 格式
  │
  ├─ 4. preprocess_image_for_ocr(image)
  │     生成多个预处理变体：
  │     ├── 变体1: 原图（最重要）
  │     └── 变体2: 灰度化 + CLAHE 对比度增强
  │
  ├─ 5. 多尺度 OCR 识别
  │     for proc_img in processed_images:
  │       result, elapse = ocr_engine(proc_img)
  │       transformed = transform_rapidocr_result(result)
  │       if 原图识别 >= 3个标记 → 跳过增强变体
  │
  ├─ 6. filter_alphanumeric_markers(all_results)
  │     过滤非字母数字标记（正则匹配）
  │
  └─ 7. deduplicate_results(filtered_results, position_threshold=30)
        位置去重，保留置信度最高的
```

### 2.3 引擎初始化

```python
from rapidocr_onnxruntime import RapidOCR

_ocr_engine = RapidOCR(
    text_score=0.3,      # 文本置信度阈值（默认0.5，降低以检测更多标记）
    box_thresh=0.1,      # 文本框检测阈值（默认0.5，降低以检测更多文本框）
    unclip_ratio=1.8,    # 文本框扩展比例（默认1.6，增大以覆盖更完整）
    max_side_len=2500    # 最大处理边长（默认960，增大以处理高分辨率图纸）
)
```

**参数调优说明**：

- `text_score=0.3`：专利图纸中标记通常较小、笔画细，降低阈值可提高召回率
- `box_thresh=0.1`：降低文本框检测阈值，避免遗漏小标记
- `unclip_ratio=1.8`：增大扩展比例，确保标记文本框完整覆盖
- `max_side_len=2500`：专利图纸分辨率较高，增大处理尺寸保留细节

### 2.4 图像预处理

```python
def preprocess_image_for_ocr(image: np.ndarray) -> List[np.ndarray]:
    processed_images = []

    # 变体1: 原图（最重要，优先使用）
    processed_images.append(image.copy())

    # 变体2: 灰度化 + CLAHE 对比度增强
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    processed_images.append(cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR))

    return processed_images
```

**策略**：先用原图识别，如果识别到的标记数 >= 3，则跳过增强变体，节省时间。

### 2.5 RapidOCR 原始输出格式

```python
# RapidOCR 返回格式
[
    [
        [[x1,y1], [x2,y2], [x3,y3], [x4,y4]],  # 四角坐标
        'text',                                    # 识别文本
        confidence_float                           # 置信度 (0-1)
    ],
    ...
]
```

### 2.6 结果格式转换

```python
def transform_rapidocr_result(rapid_result) -> List[Dict]:
    # 将四角坐标转换为中心点 + 宽高
    xs = [point[0] for point in box]
    ys = [point[1] for point in box]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)

    return {
        'number': text.strip(),
        'x': int((x_min + x_max) / 2),       # 中心X
        'y': int((y_min + y_max) / 2),       # 中心Y
        'width': int(x_max - x_min),          # 宽度
        'height': int(y_max - y_min),         # 高度
        'confidence': float(score) * 100      # 置信度 (0-100)
    }
```

### 2.7 超时控制

```python
# 通过 Thread + join(timeout) 实现超时控制
result_container = {'result': None, 'error': None}

def ocr_worker():
    # ... OCR 处理逻辑 ...
    result_container['result'] = deduplicated_results

thread = Thread(target=ocr_worker)
thread.daemon = True
thread.start()
thread.join(timeout=60)  # 60秒超时

if thread.is_alive():
    raise TimeoutError("OCR processing exceeded 60 seconds timeout")
```

### 2.8 标记过滤

```python
def filter_alphanumeric_markers(ocr_results: List[Dict]) -> List[Dict]:
    # 支持的标记模式：
    # - 纯数字: 1, 10, 100
    # - 字母+数字: A1, B2
    # - 数字+字母: 1A, 2B, 10a
    # - 纯字母: A, B, C
    # - 带撇号: 1', 2', 10'
    pattern = re.compile(
        r"^[0-9]+[A-Za-z]*'*$|^[A-Z]+[0-9]*[a-z]*'*$|^[A-Za-z]'*$",
        re.IGNORECASE
    )
    # 过滤条件：
    # 1. 匹配字母数字模式
    # 2. 长度 <= 8 个字符
    # 3. 清理前后的标点符号
```

---

## 3. GLM OCR（智谱AI云端引擎）

### 3.1 引擎概述

| 属性 | 说明 |
|------|------|
| 引擎类型 | 云端 API |
| 依赖包 | `requests` |
| 运行方式 | HTTP API 调用 |
| 是否需要 API Key | 是（智谱AI API Key） |
| 适用场景 | 附图标记识别（手写体API）+ PDF文档版面解析（版面解析API） |
| 核心文件 | `backend/utils/glm_ocr_utils.py` |

### 3.2 两个 API 端点

GLM OCR 提供两个不同的 API，分别服务于不同场景：

| API | 端点 | 用途 | 上传方式 | 坐标类型 |
|-----|------|------|---------|---------|
| 手写体 OCR | `/api/paas/v4/files/ocr` | 附图标记识别 | multipart/form-data | 像素坐标 |
| 版面解析 OCR | `/api/paas/v4/layout_parsing` | PDF文档解析 | JSON + base64 | 归一化坐标 (0-1) |

### 3.3 手写体 OCR API

#### 调用链路

```
perform_glm_ocr(image_data, api_key, ocr_type="handwriting")
  → call_glm_handwriting_ocr(image_data, api_key, language_type="CHN_ENG")
    → POST https://open.bigmodel.cn/api/paas/v4/files/ocr
    → _transform_handwriting_ocr_response(response)
```

#### 请求构造

```python
headers = {
    "Authorization": f"Bearer {api_key}"
}

# 注意：使用 multipart/form-data 上传，不是 JSON
files = {
    'file': ('image.png', BytesIO(image_data), 'image/png')
}

data = {
    'tool_type': 'hand_write',       # 手写体识别模式
    'language_type': 'CHN_ENG',      # 中英文混合
    'probability': 'true'            # 返回置信度
}

response = requests.post(
    "https://open.bigmodel.cn/api/paas/v4/files/ocr",
    headers=headers,
    files=files,
    data=data,
    timeout=90
)
```

#### 响应格式

```json
{
    "status": "succeeded",
    "words_result": [
        {
            "location": {
                "left": 100,
                "top": 200,
                "width": 50,
                "height": 30
            },
            "words": "文本内容",
            "probability": {
                "average": 0.95
            }
        }
    ]
}
```

#### 响应转换

```python
def _transform_handwriting_ocr_response(response: dict) -> List[Dict]:
    for item in response.get('words_result', []):
        location = item.get('location', {})
        left = location.get('left', 0)
        top = location.get('top', 0)
        width = location.get('width', 0)
        height = location.get('height', 0)

        results.append({
            'number': words.strip(),
            'x': left + width // 2,                    # 中心X
            'y': top + height // 2,                    # 中心Y
            'width': width,
            'height': height,
            'confidence': prob.get('average', 1.0) * 100  # 转为0-100
        })
```

### 3.4 版面解析 OCR API

#### 调用链路

```
perform_glm_ocr(image_data, api_key, ocr_type="layout_parsing")
  → call_glm_layout_parsing_ocr(image_data, api_key)
    → POST https://open.bigmodel.cn/api/paas/v4/layout_parsing
    → _transform_layout_parsing_response(response)
```

#### 请求构造

```python
# 注意：使用 JSON + base64 上传，不是 multipart
image_base64 = base64.b64encode(image_data).decode('utf-8')
image_data_url = f"data:image/png;base64,{image_base64}"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

payload = {
    "model": "glm-ocr",
    "file": image_data_url,                      # data URL 格式
    "return_crop_images": False,
    "need_layout_visualization": False
}

response = requests.post(
    "https://open.bigmodel.cn/api/paas/v4/layout_parsing",
    headers=headers,
    json=payload,
    timeout=180
)
```

#### 响应格式

```json
{
    "layout_details": [
        [
            {
                "label": "text",
                "content": "识别的文本内容",
                "bbox_2d": [0.1, 0.2, 0.5, 0.6],
                "width": 1224,
                "height": 1584,
                "native_label": "text_block"
            }
        ]
    ],
    "data_info": {
        "pages": [{"width": 1224, "height": 1584}]
    },
    "md_results": "markdown格式的文本",
    "request_id": "uuid"
}
```

#### 响应转换

```python
def _transform_layout_parsing_response(response: dict) -> List[Dict]:
    # 归一化坐标 → 像素坐标
    x1_px = int(x1 * page_width)
    y1_px = int(y1 * page_height)
    x2_px = int(x2 * page_width)
    y2_px = int(y2 * page_height)

    results.append({
        'number': content.strip(),
        'x': (x1_px + x2_px) // 2,
        'y': (y1_px + y2_px) // 2,
        'width': x2_px - x1_px,
        'height': y2_px - y1_px,
        'confidence': 100  # 版面解析不返回置信度，默认100
    })
```

### 3.5 PDF路由中的 GLM OCR 版面解析

在 `pdf_ocr.py` 路由中，GLM OCR 版面解析有独立的实现（与 `glm_ocr_utils.py` 不同）：

```python
def _parse_with_glm_ocr(file_base64: str, options: dict) -> dict:
    api_key = get_api_key_from_request('zhipu')

    # 自动添加 data URL 前缀（如果不存在）
    if file_base64.startswith('data:'):
        file_data = file_base64
    else:
        file_data = f"data:image/png;base64,{file_base64}"

    payload = {
        "model": "glm-ocr",
        "file": file_data
    }

    response = requests.post(
        "https://open.bigmodel.cn/api/paas/v4/layout_parsing",
        headers=headers, json=payload, timeout=180
    )

    return _transform_glm_ocr_response(result)
```

**与 `glm_ocr_utils.py` 的区别**：

| 对比项 | glm_ocr_utils.py | pdf_ocr.py |
|--------|-------------------|------------|
| 输入格式 | `image_data: bytes` | `file_base64: str` |
| base64 处理 | 内部编码 | 外部已编码，自动补 data URL 前缀 |
| 输出格式 | `List[Dict]`（标记列表） | `Dict`（文档结构：pages + markdown） |
| API Key 来源 | 参数传入 | 从请求头获取 |

### 3.6 合并数字拆分

GLM 手写体 OCR 有时会将相邻数字合并识别（如 "102300" 实际是 "102" 和 "300"）：

```python
def split_merged_numbers(text: str, max_length: int = 4) -> List[str]:
    if len(text) <= max_length:
        return [text]

    # 尝试在中间位置拆分
    for i in range(1, len(text)):
        left = text[:i]
        right = text[i:]
        if len(left) <= max_length and len(right) <= max_length:
            return [left, right]

    return [text]
```

---

## 4. PaddleOCR（百度AI Studio云端引擎）

### 4.1 引擎概述

项目中存在 **两个不同的 PaddleOCR 封装**，服务于不同场景：

| 封装 | API | 用途 | 核心文件 |
|------|-----|------|---------|
| PP-OCRv5 | 文字识别 API | 附图标记识别 | `paddle_ocr_utils.py` |
| PaddleOCR-VL-1.5 | 版面解析 API | PDF文档版面解析 | `paddle_ocr_vl_utils.py` |

### 4.2 PP-OCRv5（附图标记识别）

#### 引擎属性

| 属性 | 说明 |
|------|------|
| 引擎类型 | 云端 API |
| 依赖包 | `requests` |
| 是否需要 Token | 是（百度AI Studio Token） |
| API 地址 | `https://x9pal7t2e9t4lff3.aistudio-app.com/ocr` |
| 超时时间 | 120 秒 |
| 核心文件 | `backend/utils/paddle_ocr_utils.py` |

#### 调用链路

```
perform_pp_ocr(image_data, token)
  → call_pp_ocrv5(image_data, token, ...)
    → POST https://x9pal7t2e9t4lff3.aistudio-app.com/ocr
    → _transform_pp_ocrv5_response(response)
```

#### 请求构造

```python
image_base64 = base64.b64encode(image_data).decode('ascii')

headers = {
    "Authorization": f"token {token}",
    "Content-Type": "application/json"
}

payload = {
    "file": image_base64,                          # base64 编码图片
    "fileType": 1,                                 # 图片类型
    "useDocOrientationClassify": True,             # 文档方向分类
    "useDocUnwarping": False,                      # 文档去弯曲
    "useTextlineOrientation": True,                # 文本行方向分类
    "textDetLimitType": "min",                     # 检测限制类型
    "textDetLimitSideLen": 64,                     # 最小检测边长
    "textDetThresh": 0.3,                          # 文本检测阈值
    "textDetBoxThresh": 0.2,                       # 文本框检测阈值
    "textDetUnclipRatio": 1.5,                     # 文本框扩展比例
    "textRecScoreThresh": 0,                       # 识别分数阈值（0=返回所有）
}

response = requests.post(url, json=payload, headers=headers, timeout=120)
```

#### 响应格式

```json
{
    "errorCode": 0,
    "errorMsg": "Success",
    "result": {
        "ocrResults": [
            {
                "prunedResult": {
                    "dt_polys": [
                        [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
                    ],
                    "rec_texts": ["text1", "text2"],
                    "rec_scores": [0.95, 0.98]
                }
            }
        ]
    }
}
```

#### 响应转换

```python
def _transform_pp_ocrv5_response(response: dict) -> List[Dict]:
    ocr_results = response.get('result', {}).get('ocrResults', [])

    for page_result in ocr_results:
        pruned_result = page_result.get('prunedResult', {})
        dt_polys = pruned_result.get('dt_polys', [])
        rec_texts = pruned_result.get('rec_texts', [])
        rec_scores = pruned_result.get('rec_scores', [])

        for poly, text, score in zip(dt_polys, rec_texts, rec_scores):
            xs = [p[0] for p in poly]
            ys = [p[1] for p in poly]
            x_min, x_max = min(xs), max(xs)
            y_min, y_max = min(ys), max(ys)

            results.append({
                'number': text.strip(),
                'x': (x_min + x_max) // 2,
                'y': (y_min + y_max) // 2,
                'width': x_max - x_min,
                'height': y_max - y_min,
                'confidence': float(score) * 100 if score <= 1 else float(score)
            })
```

### 4.3 PaddleOCR-VL-1.5（PDF文档版面解析）

#### 引擎属性

| 属性 | 说明 |
|------|------|
| 引擎类型 | 云端 API |
| 依赖包 | `requests` |
| 是否需要 Token | 否（预置 Token） |
| API 地址 | `https://k2neb1qcy1u6g4k5.aistudio-app.com/layout-parsing` |
| 预置 Token | 不内置；从 OCR 设置或 `PADDLE_OCR_V2_TOKEN` 环境变量读取 |
| 超时时间 | 180 秒 |
| 核心文件 | `backend/utils/paddle_ocr_vl_utils.py` |
| 精度 | 94.5%（OmniDocBench v1.5） |

#### 调用链路

```
perform_paddle_ocr_vl(image_data, api_url, token, options)
  → call_paddle_ocr_vl(image_data, ...)
    → POST https://k2neb1qcy1u6g4k5.aistudio-app.com/layout-parsing
    → _transform_paddle_ocr_vl_response(response)
      → _extract_blocks_from_pruned_result(pruned_result, page_index)
```

#### 请求构造

```python
image_base64 = base64.b64encode(image_data).decode('ascii')

headers = {
    "Authorization": f"token {auth_token}",
    "Content-Type": "application/json"
}

payload = {
    "file": image_base64,
    "fileType": 1,
    "useDocOrientationClassify": True,        # 文档方向分类 (0°/90°/180°/270°)
    "useDocUnwarping": False,                 # 文档去弯曲
    "useLayoutDetection": True,               # 版面区域检测和排序
    "useChartRecognition": False,             # 图表解析（柱状图、饼图等）
    "layoutThreshold": 0.5,                   # 版面检测分数阈值
    "prettifyMarkdown": True,                 # 输出美化 Markdown
    "showFormulaNumber": False,               # 公式编号
    "visualize": False                        # 返回可视化图像
}

response = requests.post(url, json=payload, headers=headers, timeout=180)
```

#### 响应格式

```json
{
    "logId": "uuid",
    "errorCode": 0,
    "errorMsg": "Success",
    "result": {
        "layoutParsingResults": [
            {
                "prunedResult": {
                    "width": 1190,
                    "height": 1684,
                    "parsing_res_list": [
                        {
                            "block_label": "text",
                            "block_content": "识别的文本",
                            "block_bbox": [x1, y1, x2, y2],
                            "block_polygon_points": [[x1,y1], [x2,y1], [x2,y2], [x1,y2]],
                            "block_id": 0,
                            "block_order": 0,
                            "group_id": 0
                        }
                    ],
                    "text_regions": [...],
                    "tables": [...],
                    "formulas": [...]
                },
                "markdown": {
                    "text": "markdown格式的文本",
                    "images": {"path": "base64_image_data"}
                },
                "outputImages": {...},
                "inputImage": "base64"
            }
        ],
        "dataInfo": {
            "pages": [{"width": 1190, "height": 1684}]
        }
    }
}
```

#### 响应转换（统一文档格式）

```python
def _transform_paddle_ocr_vl_response(response: dict) -> Dict:
    # 输出格式（与 GLM OCR 版面解析兼容）
    return {
        'pages': [
            {
                'pageIndex': 1,
                'width': 1190,
                'height': 1684,
                'blocks': [
                    {
                        'index': 0,
                        'type': 'text',           # text / table / formula
                        'text': '识别的文本',
                        'content': '识别的文本',
                        'label': 'text',
                        'bbox': {
                            'lt': [x1, y1],
                            'rb': [x2, y2],
                            'page_width': 1190,
                            'page_height': 1684
                        },
                        'bbox_2d': [x1, y1, x2, y2],
                        'polygon_points': [...],
                        'order': 0,
                        'group_id': 0,
                        'pageIndex': 1
                    }
                ],
                'markdown': 'markdown文本'
            }
        ],
        'markdown': '合并的markdown文本（页面间用 --- 分隔）',
        'images': {'path': 'base64_image_data'},
        'engine': 'paddle_ocr_vl',
        'md_results': '合并的markdown文本',
        'layout_details': [[{...}]],       # 兼容 GLM OCR 格式
        'data_info': {...},
        'request_id': 'uuid',
        'created': 1234567890,
        'model': 'PaddleOCR-VL-1.5'
    }
```

#### Block 类型提取

```python
def _extract_blocks_from_pruned_result(pruned_result, page_index):
    # 三种类型的 block：
    # 1. text_regions → type='text'
    # 2. tables → type='table'（含 html + markdown）
    # 3. formulas → type='formula'（含 latex）

    for region in text_regions:
        blocks.append({
            'type': 'text',
            'text': text,
            'bbox': {'lt': [bbox[0], bbox[1]], 'rb': [bbox[2], bbox[3]]},
            'confidence': confidence
        })

    for table in tables:
        blocks.append({
            'type': 'table',
            'html': html,
            'markdown': markdown,
            'bbox': {...}
        })

    for formula in formulas:
        blocks.append({
            'type': 'formula',
            'latex': latex,
            'bbox': {...}
        })
```

### 4.4 PDF路由中的 PaddleOCR-VL

在 `pdf_ocr.py` 路由中，PaddleOCR-VL 也有独立实现：

```python
def _parse_with_paddle_ocr_vl(file_base64: str, options: dict) -> dict:
    normalized_file_base64 = normalize_base64_payload(file_base64)

    payload = {
        "file": normalized_file_base64,
        "fileType": 1,
        "useDocOrientationClassify": options.get('use_doc_orientation_classify', True),
        "useDocUnwarping": options.get('use_doc_unwarping', False),
        "useLayoutDetection": options.get('use_layout_detection', True),
        "useChartRecognition": options.get('use_chart_recognition', False),
        "layoutThreshold": options.get('layout_threshold', 0.5),
        "prettifyMarkdown": options.get('prettify_markdown', True),
        "showFormulaNumber": options.get('show_formula_number', False),
        "visualize": False
    }

    response = requests.post(PADDLE_OCR_VL_API_URL, json=payload, headers=headers, timeout=180)
    return _transform_paddle_ocr_vl_response(result)
```

**注意**：`pdf_ocr.py` 中的 `_transform_paddle_ocr_vl_response` 与 `paddle_ocr_vl_utils.py` 中的实现略有不同：
- `pdf_ocr.py` 版本从 `parsing_res_list` 提取 blocks（包含 `block_id`, `block_order`, `group_id`）
- `paddle_ocr_vl_utils.py` 版本从 `text_regions/tables/formulas` 提取 blocks

---

## 5. 统一调度层 ocr_concurrent.py

### 5.1 概述

`ocr_concurrent.py` 是三种 OCR 引擎的统一调度入口，负责：
- 根据 `ocr_mode` 参数路由到对应引擎
- 并发控制（信号量限流）
- 线程池并发处理多张图片
- 缓存管理
- 失败降级回退

### 5.2 并发限制配置

```python
OCR_CONCURRENCY_LIMITS = {
    'rapidocr': 5,     # 本地引擎，可高并发
    'glm_ocr': 2,      # 云端API，限制并发
    'paddle_ocr': 3    # 云端API，中等并发
}

OCR_DISPLAY_NAMES = {
    'rapidocr': '内置OCR引擎',
    'glm_ocr': 'GLM OCR API',
    'paddle_ocr': 'PP-OCRv5 (百度)'
}
```

### 5.3 单图处理流程

```python
def process_single_drawing(drawing, ocr_mode, cache_manager, force_refresh,
                           glm_api_key=None, paddle_token=None) -> Dict:
    # 1. 解码图片
    image_data = base64.b64decode(drawing['data'])
    image_hash = hashlib.md5(image_data).hexdigest()
    cache_key = f"{ocr_mode}_{drawing_name}_{image_hash}"

    # 2. 检查缓存
    if not force_refresh:
        cached_result = cache_manager.get_cache(cache_key)
        if cached_result:
            all_detected_numbers = cached_result['ocr_results']
            # 跳过 OCR 处理，直接使用缓存

    # 3. 获取信号量并执行 OCR
    semaphore = get_ocr_semaphore(ocr_mode)
    with semaphore:
        if ocr_mode == 'glm_ocr':
            from backend.utils.glm_ocr_utils import perform_glm_ocr
            from backend.utils.ocr_utils import perform_ocr
            try:
                all_detected_numbers = perform_glm_ocr(
                    image_data, glm_api_key,
                    ocr_type="handwriting",
                    language_type="CHN_ENG"
                )
            except Exception as e:
                # 降级回退到 RapidOCR
                all_detected_numbers = perform_ocr(image_data)

        elif ocr_mode == 'paddle_ocr':
            from backend.utils.paddle_ocr_utils import perform_pp_ocr
            from backend.utils.ocr_utils import perform_ocr
            try:
                all_detected_numbers = perform_pp_ocr(image_data, paddle_token)
            except Exception as e:
                # 降级回退到 RapidOCR
                all_detected_numbers = perform_ocr(image_data)

        else:  # rapidocr
            from backend.utils.ocr_utils import perform_ocr
            all_detected_numbers = perform_ocr(image_data)

    # 4. 缓存结果
    cache_manager.set_cache(cache_key, {
        'drawing_name': drawing_name,
        'ocr_results': all_detected_numbers,
        'image_hash': image_hash,
        'ocr_mode': ocr_mode
    })

    # 5. 后处理
    all_detected_numbers = deduplicate_results(all_detected_numbers, position_threshold=25)
    all_detected_numbers = filter_by_confidence(all_detected_numbers, min_confidence=80)
```

### 5.4 多图并发处理

```python
def process_drawings_concurrent(drawings, ocr_mode, cache_manager,
                                 force_refresh=False, glm_api_key=None,
                                 paddle_token=None, max_workers=None,
                                 timeout_per_image=60):
    if max_workers is None:
        max_workers = OCR_CONCURRENCY_LIMITS.get(ocr_mode, 3)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_drawing = {
            executor.submit(
                process_single_drawing,
                drawing, ocr_mode, cache_manager,
                force_refresh, glm_api_key, paddle_token
            ): drawing
            for drawing in drawings
        }

        for future in as_completed(future_to_drawing):
            result = future.result(timeout=timeout_per_image)
            # 收集结果...

    return processed_results, cache_info, all_ocr_markers
```

### 5.5 降级回退策略

```
GLM OCR 失败 ──→ RapidOCR（本地引擎，始终可用）
PP-OCRv5 失败 ──→ RapidOCR（本地引擎，始终可用）
RapidOCR 失败 ──→ 返回空结果 + 错误信息
```

---

## 6. 后处理管道

所有 OCR 引擎的输出都经过统一的后处理管道：

### 6.1 处理流程

```
OCR 原始结果
  │
  ├─ 1. deduplicate_results(results, position_threshold=25)
  │     位置去重：相同文本 + 距离 < 25px → 保留置信度最高的
  │
  ├─ 2. filter_by_confidence(results, min_confidence=80)
  │     置信度过滤：只保留 confidence >= 80 的结果
  │
  ├─ 3. smart_split_ocr_results(results, spec_markers, enable_split=True)
  │     智能分割：仅对 GLM/PP-OCR 启用
  │     基于说明书标记长度分布拆分合并数字
  │
  └─ 4. match_with_reference_map(detected_numbers, reference_map)
        业务匹配：将 OCR 结果与说明书标记映射匹配
```

### 6.2 智能分割详解

云端 OCR（GLM、PP-OCR）容易将相邻数字合并识别，智能分割基于说明书标记长度分布进行拆分：

```python
def smart_split_ocr_results(ocr_results, spec_markers, enable_split=True):
    # 1. 分析说明书标记长度分布
    dist = get_marker_length_distribution(spec_markers)
    # 例如: spec_markers = ['100', '101', '102', '200', '201']
    # → common_lengths = [3, 2], max_len = 3

    # 2. 对每个 OCR 结果检查是否需要分割
    for item in ocr_results:
        if len(clean_text) <= max_spec_len:
            continue  # 长度正常，不需要分割

        # 3. 尝试按空格分割
        if ' ' in text:
            # 按空格拆分，均分宽度

        # 4. 尝试智能分割
        pattern = find_split_pattern(len(clean_text), common_lengths)
        # 例如: total_len=6, common_lengths=[3,2]
        # → 3+3=6 ✓ → pattern=[3,3]

        parts = split_text_by_pattern(clean_text, pattern)

        # 5. 验证分割结果
        is_valid, match_conf = check_parts_in_spec(parts, spec_markers)
```

**分割示例**：

| OCR 原始结果 | 说明书标记 | 分割结果 |
|-------------|-----------|---------|
| "200103" | 100,101,102,200,201 | ["200", "103"] |
| "102300" | 10,12,102,300 | ["102", "300"] |

### 6.3 仅云端 OCR 启用智能分割

```python
def apply_smart_split_to_ocr(ocr_results, spec_markers, ocr_mode='rapidocr'):
    enable_split = ocr_mode in ['glm_ocr', 'paddle_ocr']
    return smart_split_ocr_results(ocr_results, spec_markers, enable_split)
```

原因：RapidOCR 本地引擎对相邻数字的分离能力较好，不容易合并；而云端 API 倾向于将相邻标记合并为一个文本块。

---

## 7. 路由层集成

### 7.1 附图标记识别路由

**端点**：`POST /drawing-marker/process`

```python
@drawing_marker_bp.route('/drawing-marker/process', methods=['POST'])
def process_drawing_marker():
    req_data = request.get_json()
    drawings = req_data.get('drawings')          # 图片列表
    specification = req_data.get('specification') # 说明书文本
    ocr_mode = req_data.get('ocr_mode', 'rapidocr')  # OCR模式选择

    # 1. 获取对应引擎的认证信息
    if ocr_mode == 'glm_ocr':
        glm_api_key = request.headers.get('Authorization').split(' ')[1]
    if ocr_mode == 'paddle_ocr':
        paddle_token = req_data.get('paddle_token') or request.headers.get('X-Paddle-Token')

    # 2. 并发 OCR 处理
    processed_results, cache_info, all_ocr_markers = process_drawings_concurrent(
        drawings=drawings,
        ocr_mode=ocr_mode,
        cache_manager=cache_manager,
        force_refresh=force_refresh,
        glm_api_key=glm_api_key,
        paddle_token=paddle_token
    )

    # 3. 解析说明书
    if ai_mode:
        reference_map = ai_extract(specification, model_name, provider)
    else:
        reference_map = extract_reference_markers(specification)  # jieba分词

    # 4. 智能分割 + 匹配
    for drawing_result in processed_results:
        if ocr_mode in ['glm_ocr', 'paddle_ocr']:
            ocr_results = smart_split_ocr_results(ocr_results, spec_markers, enable_split=True)
        detected_numbers, unknown, missing = match_with_reference_map(ocr_results, reference_map)

    # 5. 返回结果
```

### 7.2 PDF文档版面解析路由

**端点**：`POST /pdf-ocr/parse`

```python
@pdf_ocr_bp.route('/pdf-ocr/parse', methods=['POST'])
def parse_document():
    req_data = request.get_json()
    file_base64 = req_data.get('file')           # base64编码图片
    engine = req_data.get('engine', 'glm_ocr')   # 引擎选择
    options = req_data.get('options', {})         # 解析选项

    if engine == 'paddle_ocr_vl':
        result = _parse_with_paddle_ocr_vl(file_base64, options)
    else:
        result = _parse_with_glm_ocr(file_base64, options)

    return create_response(data={"result": result, "engine": engine})
```

**可用引擎查询**：`GET /pdf-ocr/engines`

```python
engines = [
    {
        'id': 'glm_ocr',
        'name': 'GLM OCR',
        'provider': '智谱AI',
        'requires_api_key': True,
        'features': {'layout_parsing': True, 'formula_recognition': True, 'table_recognition': True}
    },
    {
        'id': 'paddle_ocr_vl',
        'name': 'PaddleOCR-VL-1.5',
        'provider': '百度AI Studio',
        'requires_api_key': False,
        'features': {'layout_parsing': True, 'formula_recognition': True,
                     'table_recognition': True, 'chart_recognition': True,
                     'markdown_output': True}
    }
]
```

### 7.3 分阶段处理路由

**端点**：`POST /drawing-marker/process-staged`

支持分阶段处理，适合需要实时反馈的前端场景：

| 阶段 | stage 参数 | 说明 |
|------|-----------|------|
| OCR 识别 | `ocr` | 只执行 OCR，返回识别到的标记 |
| 文本提取 | `extract` | 从说明书中提取相关段落 |
| AI 处理 | `ai` | 匹配标记与部件名称 |
| 全部 | `all` | 一次性完成所有阶段 |

---

## 8. 配置与依赖

### 8.1 providers.json 配置

```json
{
    "providers": {
        "zhipu": {
            "name": "智谱AI",
            "api_base": "https://open.bigmodel.cn/api/paas/v4",
            "models": [
                {"id": "glm-ocr", "name": "GLM-OCR", "type": "ocr"}
            ],
            "features": {"ocr": true}
        },
        "baidu": {
            "name": "百度AI Studio",
            "ocr_engines": {
                "paddle_ocr_vl": {
                    "name": "PaddleOCR-VL-1.5",
                    "requires_api_key": false,
                    "preconfigured": true
                }
            }
        }
    },
    "ocr_engines": {
        "glm_ocr": {
            "requires_api_key": true,
            "features": {"layout_parsing": true, "formula_recognition": true, "table_recognition": true}
        },
        "paddle_ocr_vl": {
            "requires_api_key": false,
            "preconfigured": true,
            "features": {"layout_parsing": true, "formula_recognition": true,
                         "table_recognition": true, "chart_recognition": true,
                         "markdown_output": true, "multi_page": true}
        }
    }
}
```

### 8.2 依赖包

| 引擎 | Python 依赖 | 说明 |
|------|-------------|------|
| RapidOCR | `rapidocr-onnxruntime` | ONNX Runtime 推理 |
| 通用 | `opencv-python` (cv2) | 图像处理 |
| 通用 | `Pillow` (PIL) | 图像解码 |
| 通用 | `numpy` | 数组操作 |
| 通用 | `requests` | HTTP API 调用 |
| 可选 | `psutil` | 内存监控 |

### 8.3 API Key 获取方式

| 引擎 | 获取方式 | 请求头 |
|------|---------|--------|
| GLM OCR | 智谱AI开放平台 | `Authorization: Bearer {api_key}` |
| PP-OCRv5 | 百度AI Studio | `Authorization: token {token}` 或请求体 `paddle_token` |
| PaddleOCR-VL | 预置（无需用户配置） | 内部硬编码 Token |
| RapidOCR | 无需 Key | - |

---

## 9. 新项目复用指南

### 9.1 最小可复用架构

```
新项目结构建议：
├── ocr/
│   ├── base.py              # 统一输出格式定义
│   ├── rapidocr_engine.py   # RapidOCR 适配器
│   ├── glm_ocr_engine.py    # GLM OCR 适配器
│   ├── paddle_ocr_engine.py # PaddleOCR 适配器
│   ├── dispatcher.py        # 调度层（路由 + 降级 + 并发）
│   └── postprocess.py       # 后处理管道（去重 + 过滤 + 分割）
```

### 9.2 统一输出格式

**标记识别场景**：
```python
@dataclass
class OCRDetection:
    number: str          # 识别文本
    x: int              # 中心X坐标（像素）
    y: int              # 中心Y坐标（像素）
    width: int          # 边界框宽度（像素）
    height: int         # 边界框高度（像素）
    confidence: float   # 置信度 (0-100)
```

**文档解析场景**：
```python
@dataclass
class DocumentPage:
    page_index: int
    width: int
    height: int
    blocks: List[DocumentBlock]
    markdown: str

@dataclass
class DocumentBlock:
    type: str           # text / table / formula / image / title
    text: str
    content: str
    bbox: Dict          # {'lt': [x1,y1], 'rb': [x2,y2]}
    confidence: float
    page_index: int

@dataclass
class DocumentResult:
    pages: List[DocumentPage]
    markdown: str
    images: Dict
    engine: str
    layout_details: List
```

### 9.3 引擎适配器模式

每个引擎实现统一的接口：

```python
class OCREngine(ABC):
    @abstractmethod
    def recognize(self, image_data: bytes) -> List[OCRDetection]:
        """识别图片中的文本标记"""
        pass

class RapidOCREngine(OCREngine):
    def __init__(self):
        from rapidocr_onnxruntime import RapidOCR
        self._engine = RapidOCR(text_score=0.3, box_thresh=0.1, unclip_ratio=1.8, max_side_len=2500)

    def recognize(self, image_data: bytes) -> List[OCRDetection]:
        # 图像解码 → 预处理 → OCR → 格式转换
        pass

class GLMOCREngine(OCREngine):
    def __init__(self, api_key: str):
        self.api_key = api_key

    def recognize(self, image_data: bytes) -> List[OCRDetection]:
        # API调用 → 响应转换
        pass

class PaddleOCREngine(OCREngine):
    def __init__(self, token: str):
        self.token = token

    def recognize(self, image_data: bytes) -> List[OCRDetection]:
        # API调用 → 响应转换
        pass
```

### 9.4 PDF 文档 OCR 推荐流程

```
PDF 文件
  │
  ├─ 1. PDF 转图片（每页一张）
  │     使用 pdf2image / PyMuPDF / pdfplumber
  │
  ├─ 2. 逐页调用 OCR API
  │     推荐 PaddleOCR-VL-1.5（无需API Key，精度高，支持Markdown输出）
  │     备选 GLM OCR 版面解析（需API Key）
  │
  ├─ 3. 合并各页结果
  │     页面间用分隔符合并 Markdown
  │     合并 layout_details
  │
  └─ 4. 输出结构化结果
        ├── Markdown 全文
        ├── 按类型分类的 blocks（文本/表格/公式）
        └── 带坐标的版面信息
```

### 9.5 引擎选择建议

| 场景 | 推荐引擎 | 理由 |
|------|---------|------|
| 离线环境 / 内网部署 | RapidOCR | 无需网络，ONNX Runtime 推理 |
| 专利图纸标记识别 | GLM OCR 手写体 | 手写体识别效果好，返回像素坐标 |
| PDF 文档版面解析 | PaddleOCR-VL-1.5 | 精度高(94.5%)，无需API Key，支持Markdown |
| 高并发标记识别 | RapidOCR | 本地推理，5并发无压力 |
| 需要表格/公式识别 | PaddleOCR-VL-1.5 | 原生支持表格HTML和公式LaTeX输出 |

### 9.6 关键注意事项

1. **图像格式转换**：RapidOCR 需要 BGR 格式的 numpy 数组，云端 API 需要 base64 编码
2. **坐标系统**：GLM 版面解析返回归一化坐标(0-1)，需要乘以页面宽高转为像素坐标
3. **合并数字问题**：云端 OCR 容易将相邻标记合并，需要智能分割后处理
4. **降级策略**：始终保留 RapidOCR 作为 fallback，确保云端 API 不可用时仍可工作
5. **缓存设计**：缓存键应包含 `ocr_mode` + `图片hash`，不同引擎的结果分开缓存
6. **超时控制**：云端 API 建议设置 90-180 秒超时，本地引擎建议 60 秒
7. **并发限制**：云端 API 需要限流（2-3并发），本地引擎可高并发（5+）
