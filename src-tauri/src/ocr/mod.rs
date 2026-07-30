use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const PADDLE_OCR_V2_URL: &str = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
const PADDLE_OCR_V2_MODEL: &str = "PaddleOCR-VL-1.6";

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToString::to_string)
}

fn get_paddle_ocr_token(override_token: Option<&str>) -> Option<String> {
    non_empty(override_token)
        .or_else(|| std::env::var("PADDLE_OCR_V2_TOKEN").ok().and_then(|v| non_empty(Some(&v))))
        .or_else(|| std::env::var("PADDLE_OCR_TOKEN").ok().and_then(|v| non_empty(Some(&v))))
}
const PADDLE_OCR_V2_POLL_INTERVAL_SECS: u64 = 5;
const PADDLE_OCR_V2_POLL_TIMEOUT_SECS: u64 = 300;
const GLM_OCR_URL: &str = "https://open.bigmodel.cn/api/paas/v4/layout_parsing";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OcrBlock {
    pub block_id: String,
    pub page: u32,
    pub label: String,
    pub content: String,
    pub bbox: Option<Vec<f64>>,
    pub order: u32,
    pub group_id: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PageDimension {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OcrResult {
    pub text: String,
    pub markdown: String,
    pub engine: String,
    pub char_count: usize,
    pub blocks: Vec<OcrBlock>,
    pub page_dimensions: std::collections::HashMap<u32, PageDimension>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct OcrClient {
    client: Client,
}

fn empty_ocr_result(error: Option<String>) -> OcrResult {
    OcrResult {
        text: String::new(),
        markdown: String::new(),
        engine: "none".to_string(),
        char_count: 0,
        blocks: vec![],
        page_dimensions: std::collections::HashMap::new(),
        error,
    }
}

impl OcrClient {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(180))
            .build()
            .unwrap_or_default();
        Self { client }
    }

    pub async fn extract_with_paddle_vl(
        &self,
        pdf_base64: &str,
        paddle_url: Option<&str>,
        paddle_token: Option<&str>,
        paddle_model: Option<&str>,
    ) -> OcrResult {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

        let token = match get_paddle_ocr_token(paddle_token) {
            Some(token) => token,
            None => {
                return empty_ocr_result(Some(
                    "PaddleOCR Token 未配置，请在 OCR 设置中填写 Token，或设置环境变量 PADDLE_OCR_V2_TOKEN。".to_string(),
                ));
            }
        };
        let api_url = non_empty(paddle_url).unwrap_or_else(|| PADDLE_OCR_V2_URL.to_string());
        let model = non_empty(paddle_model).unwrap_or_else(|| PADDLE_OCR_V2_MODEL.to_string());

        // Step 1: Submit Job (multipart upload)
        let pdf_bytes = match BASE64.decode(pdf_base64) {
            Ok(b) => b,
            Err(e) => {
                log::error!("PaddleOCR-V2 base64 decode error: {}", e);
                return empty_ocr_result(Some(format!("base64 decode error: {}", e)));
            }
        };

        let optional_payload = serde_json::json!({
            "useDocOrientationClassify": true,
            "useDocUnwarping": false,
            "useChartRecognition": false,
        });

        let form = reqwest::multipart::Form::new()
            .text("model", model)
            .text("optionalPayload", optional_payload.to_string())
            .part(
                "file",
                reqwest::multipart::Part::bytes(pdf_bytes)
                    .file_name("document.pdf")
                    .mime_str("application/pdf")
                    .unwrap_or_else(|_| {
                        reqwest::multipart::Part::bytes(vec![]).file_name("document.pdf")
                    }),
            );

        let submit_resp = match self
            .client
            .post(&api_url)
            .header("Authorization", format!("bearer {}", token))
            .multipart(form)
            .timeout(Duration::from_secs(30))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!("PaddleOCR-V2 submit error: {}", e);
                return empty_ocr_result(Some(format!("submit error: {}", e)));
            }
        };

        let submit_status = submit_resp.status();
        if !submit_status.is_success() {
            let body = submit_resp.text().await.unwrap_or_default();
            log::error!(
                "PaddleOCR-V2 submit HTTP {}: {}",
                submit_status,
                &body[..body.len().min(300)]
            );
            return empty_ocr_result(Some(format!(
                "submit HTTP {}: {}",
                submit_status,
                &body[..body.len().min(200)]
            )));
        }

        let submit_data: serde_json::Value = match submit_resp.json().await {
            Ok(d) => d,
            Err(e) => {
                log::error!("PaddleOCR-V2 submit JSON parse error: {}", e);
                return empty_ocr_result(Some(format!("submit JSON parse error: {}", e)));
            }
        };

        let job_id = submit_data
            .get("data")
            .and_then(|d| d.get("jobId"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if job_id.is_empty() {
            log::error!("PaddleOCR-V2 no jobId in response");
            return empty_ocr_result(Some("no jobId in response".to_string()));
        }

        log::info!("PaddleOCR-V2 job submitted: {}", job_id);

        // Step 2: Poll until done
        let poll_client = Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_default();

        let start = std::time::Instant::now();
        let mut jsonl_url = String::new();

        loop {
            if start.elapsed().as_secs() > PADDLE_OCR_V2_POLL_TIMEOUT_SECS {
                log::error!("PaddleOCR-V2 poll timeout");
                return empty_ocr_result(Some("poll timeout".to_string()));
            }

            let poll_resp = match poll_client
                .get(format!("{}/{}", api_url, job_id))
                .header("Authorization", format!("bearer {}", token))
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("PaddleOCR-V2 poll request error: {}, retrying...", e);
                    tokio::time::sleep(Duration::from_secs(PADDLE_OCR_V2_POLL_INTERVAL_SECS)).await;
                    continue;
                }
            };

            let poll_data: serde_json::Value = match poll_resp.json().await {
                Ok(d) => d,
                Err(e) => {
                    log::warn!("PaddleOCR-V2 poll JSON parse error: {}, retrying...", e);
                    tokio::time::sleep(Duration::from_secs(PADDLE_OCR_V2_POLL_INTERVAL_SECS)).await;
                    continue;
                }
            };

            let d = poll_data.get("data").cloned().unwrap_or_default();
            let state = d.get("state").and_then(|v| v.as_str()).unwrap_or("");

            match state {
                "done" => {
                    jsonl_url = d
                        .get("resultUrl")
                        .and_then(|r| r.get("jsonUrl"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if jsonl_url.is_empty() {
                        log::error!("PaddleOCR-V2 done but no jsonUrl");
                        return empty_ocr_result(Some("done but no jsonUrl".to_string()));
                    }
                    log::info!("PaddleOCR-V2 job done, fetching result");
                    break;
                }
                "failed" => {
                    let error_msg = d
                        .get("errorMsg")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    log::error!("PaddleOCR-V2 job failed: {}", error_msg);
                    return empty_ocr_result(Some(format!("job failed: {}", error_msg)));
                }
                "running" => {
                    if let Some(prog) = d.get("extractProgress") {
                        let extracted = prog
                            .get("extractedPages")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);
                        let total = prog.get("totalPages").and_then(|v| v.as_u64()).unwrap_or(0);
                        log::info!("PaddleOCR-V2 running: {}/{}", extracted, total);
                    } else {
                        log::info!("PaddleOCR-V2 running...");
                    }
                }
                _ => {
                    log::info!("PaddleOCR-V2 state={}", state);
                }
            }

            tokio::time::sleep(Duration::from_secs(PADDLE_OCR_V2_POLL_INTERVAL_SECS)).await;
        }

        // Step 3: Fetch JSONL result
        let jsonl_resp = match self
            .client
            .get(&jsonl_url)
            .timeout(Duration::from_secs(60))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!("PaddleOCR-V2 JSONL fetch error: {}", e);
                return empty_ocr_result(Some(format!("JSONL fetch error: {}", e)));
            }
        };

        let jsonl_text = match jsonl_resp.text().await {
            Ok(t) => t,
            Err(e) => {
                log::error!("PaddleOCR-V2 JSONL read error: {}", e);
                return empty_ocr_result(Some(format!("JSONL read error: {}", e)));
            }
        };

        // Parse JSONL
        let mut all_markdown = Vec::new();
        let mut all_text = Vec::new();
        let mut all_blocks = Vec::new();
        let mut page_dimensions = std::collections::HashMap::new();
        let mut page_num: u32 = 0;

        for line in jsonl_text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let parsed: serde_json::Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(e) => {
                    log::warn!("PaddleOCR-V2 JSONL line parse error: {}", e);
                    continue;
                }
            };

            let results = parsed
                .get("result")
                .and_then(|r| r.get("layoutParsingResults"))
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            for page_result in &results {
                page_num += 1;

                if let Some(md_text) = page_result
                    .get("markdown")
                    .and_then(|m| m.get("text"))
                    .and_then(|t| t.as_str())
                {
                    if !md_text.is_empty() {
                        all_markdown.push(md_text.to_string());
                    }
                }

                let pruned = page_result.get("prunedResult").cloned().unwrap_or_default();
                let pw = pruned.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                let ph = pruned.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                if pw > 0 && ph > 0 {
                    page_dimensions.insert(
                        page_num,
                        PageDimension {
                            width: pw,
                            height: ph,
                        },
                    );
                }

                let parsing_list = pruned
                    .get("parsing_res_list")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();

                for block in &parsing_list {
                    let content = block
                        .get("block_content")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let label = block
                        .get("block_label")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let bbox = block
                        .get("block_bbox")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|v| v.as_f64()).collect::<Vec<f64>>());
                    let block_order = block
                        .get("block_order")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as u32;
                    let group_id =
                        block.get("group_id").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    let block_id_num = block
                        .get("block_id")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(all_blocks.len() as u64);

                    let block_id = format!("B_p{}_{}", page_num, block_id_num);

                    let is_text_label =
                        ["text", "title", "table", "formula"].contains(&label.as_str());
                    all_blocks.push(OcrBlock {
                        block_id,
                        page: page_num,
                        label,
                        content: content.clone(),
                        bbox,
                        order: block_order,
                        group_id,
                    });

                    if !content.is_empty() && is_text_label {
                        all_text.push(content);
                    }
                }
            }
        }

        let markdown = all_markdown.join("\n\n---\n\n");
        let text = all_text.join("\n");
        let char_count = text.len();

        log::info!(
            "PaddleOCR-V2 result: markdown={} chars, text={} chars, blocks={}",
            markdown.len(),
            text.len(),
            all_blocks.len()
        );

        OcrResult {
            text,
            markdown,
            engine: "paddle_ocr_vl".to_string(),
            char_count,
            blocks: all_blocks,
            page_dimensions,
            error: None,
        }
    }

    pub async fn extract_with_glm(&self, pdf_base64: &str, api_key: &str) -> OcrResult {
        let file_data = format!("data:application/pdf;base64,{}", pdf_base64);

        let payload = serde_json::json!({
            "model": "glm-ocr",
            "file": file_data,
            "return_crop_images": false,
            "need_layout_visualization": false,
        });

        let resp = match self
            .client
            .post(GLM_OCR_URL)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                log::error!("GLM OCR request error: {}", e);
                return OcrResult {
                    text: String::new(),
                    markdown: String::new(),
                    engine: "none".to_string(),
                    char_count: 0,
                    blocks: vec![],
                    page_dimensions: std::collections::HashMap::new(),
                    error: Some(format!("GLM OCR request failed: {}", e)),
                };
            }
        };

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            log::error!(
                "GLM OCR HTTP error {}: {}",
                status,
                &body[..body.len().min(300)]
            );
            return OcrResult {
                text: String::new(),
                markdown: String::new(),
                engine: "none".to_string(),
                char_count: 0,
                blocks: vec![],
                page_dimensions: std::collections::HashMap::new(),
                error: Some(format!(
                    "GLM OCR HTTP {}: {}",
                    status,
                    &body[..body.len().min(200)]
                )),
            };
        }

        let data: serde_json::Value = match resp.json().await {
            Ok(d) => d,
            Err(e) => {
                log::error!("GLM OCR JSON parse error: {}", e);
                return OcrResult {
                    text: String::new(),
                    markdown: String::new(),
                    engine: "none".to_string(),
                    char_count: 0,
                    blocks: vec![],
                    page_dimensions: std::collections::HashMap::new(),
                    error: Some(format!("GLM OCR JSON parse error: {}", e)),
                };
            }
        };

        let mut all_markdown = Vec::new();
        let mut all_text = Vec::new();
        let mut all_blocks = Vec::new();
        let mut page_dimensions = std::collections::HashMap::new();

        if let Some(md) = data.get("md_results").and_then(|v| v.as_str()) {
            if !md.is_empty() {
                all_markdown.push(md.to_string());
            }
        }

        let pages_info = data
            .get("data_info")
            .and_then(|d| d.get("pages"))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let layout_details = data
            .get("layout_details")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        for (page_idx, page_details) in layout_details.iter().enumerate() {
            let page_num = (page_idx + 1) as u32;

            if page_idx < pages_info.len() {
                let pi = &pages_info[page_idx];
                let pw = pi.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                let ph = pi.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                if pw > 0 && ph > 0 {
                    page_dimensions.insert(
                        page_num,
                        PageDimension {
                            width: pw,
                            height: ph,
                        },
                    );
                }
            }

            if let Some(blocks_arr) = page_details.as_array() {
                for (block_idx, block) in blocks_arr.iter().enumerate() {
                    let content = block
                        .get("content")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let label = block
                        .get("label")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let bbox_2d = block
                        .get("bbox_2d")
                        .and_then(|v| v.as_array())
                        .map(|arr| arr.iter().filter_map(|v| v.as_f64()).collect::<Vec<f64>>());

                    let pixel_bbox = if let Some(ref bbox) = bbox_2d {
                        if bbox.len() == 4 {
                            if let Some(dim) = page_dimensions.get(&page_num) {
                                Some(vec![
                                    (bbox[0] * dim.width as f64) as f64,
                                    (bbox[1] * dim.height as f64) as f64,
                                    (bbox[2] * dim.width as f64) as f64,
                                    (bbox[3] * dim.height as f64) as f64,
                                ])
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    let block_order = block
                        .get("index")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(block_idx as u64) as u32;

                    let block_id = format!("B_p{}_{}", page_num, block_idx);

                    let is_text_label =
                        ["text", "title", "table", "formula"].contains(&label.as_str());
                    all_blocks.push(OcrBlock {
                        block_id,
                        page: page_num,
                        label,
                        content: content.clone(),
                        bbox: pixel_bbox,
                        order: block_order,
                        group_id: 0,
                    });

                    if !content.is_empty() && is_text_label {
                        all_text.push(content);
                    }
                }
            }
        }

        let markdown = all_markdown.join("\n\n---\n\n");
        let text = all_text.join("\n");
        let char_count = text.len();

        log::info!(
            "GLM OCR result: markdown={} chars, text={} chars, blocks={}",
            markdown.len(),
            text.len(),
            all_blocks.len()
        );

        OcrResult {
            text,
            markdown,
            engine: "glm_ocr".to_string(),
            char_count,
            blocks: all_blocks,
            page_dimensions,
            error: None,
        }
    }

    pub async fn extract(
        &self,
        pdf_base64: &str,
        engine: &str,
        api_key: &str,
        paddle_url: Option<&str>,
        paddle_token: Option<&str>,
        paddle_model: Option<&str>,
    ) -> OcrResult {
        let mut result = OcrResult {
            text: String::new(),
            markdown: String::new(),
            engine: "none".to_string(),
            char_count: 0,
            blocks: vec![],
            page_dimensions: std::collections::HashMap::new(),
            error: None,
        };

        if engine == "paddle_ocr_vl" || engine == "auto" {
            let paddle_result = self
                .extract_with_paddle_vl(pdf_base64, paddle_url, paddle_token, paddle_model)
                .await;
            if !paddle_result.text.is_empty() || !paddle_result.markdown.is_empty() {
                return paddle_result;
            }
            if paddle_result.error.is_some() && engine == "paddle_ocr_vl" {
                return paddle_result;
            }
            log::warn!("PaddleOCR-VL returned empty, trying fallback...");
        }

        if (engine == "glm_ocr" || !api_key.is_empty()) && result.text.is_empty() {
            let glm_result = self.extract_with_glm(pdf_base64, api_key).await;
            if !glm_result.text.is_empty() || !glm_result.markdown.is_empty() {
                return glm_result;
            }
            if glm_result.error.is_some() && engine == "glm_ocr" {
                return glm_result;
            }
        }

        if engine != "paddle_ocr_vl" && result.text.is_empty() && result.markdown.is_empty() {
            let paddle_result = self
                .extract_with_paddle_vl(pdf_base64, paddle_url, paddle_token, paddle_model)
                .await;
            if !paddle_result.text.is_empty() || !paddle_result.markdown.is_empty() {
                return paddle_result;
            }
        }

        result.error = Some("所有 OCR 引擎均未能提取文本".to_string());
        result
    }
}

impl Default for OcrClient {
    fn default() -> Self {
        Self::new()
    }
}
