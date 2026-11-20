"use strict";

/**
 * 本地轻量 OCR（实验）
 * 使用 PP-OCRv6 Tiny（约 6MB 模型，CPU 推理）在端侧识别扫描页，
 * 不上传文档，供阅读器生成可选文字层。
 */

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

let enginePromise = null;
// 单引擎内部已有一个 worker；这里再串行化调用，避免多页同时识别抢占 CPU。
let queue = Promise.resolve();

function getEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const { createEngine } = require("@arcships/light-ocr-tiny");
      return createEngine();
    })().catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  return null;
}

async function recognizeImage(bytes, engineOverride) {
  const buffer = toBuffer(bytes);
  if (!buffer || buffer.length < 8) throw new Error("图片数据为空");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("图片超过 32MB");

  const engine = engineOverride || await getEngine();
  const startedAt = Date.now();
  const run = queue.then(() => engine.recognizeEncoded(buffer));
  queue = run.then(() => {}, () => {});
  const result = await run;

  return {
    ok: true,
    imageWidth: result.imageWidth,
    imageHeight: result.imageHeight,
    lines: (result.lines || []).map((line) => ({
      text: line.text,
      confidence: line.confidence,
      box: line.box,
    })),
    modelBundleId: result.modelBundleId || "",
    durationMs: Date.now() - startedAt,
  };
}

async function closeEngine() {
  const pending = enginePromise;
  enginePromise = null;
  if (!pending) return;
  try {
    const engine = await pending;
    if (engine && typeof engine.close === "function") await engine.close();
  } catch (_) {}
}

function registerLocalOcrIPC({ ipcMain, app }) {
  ipcMain.handle("local-ocr:recognize", async (_event, payload) => {
    try {
      return await recognizeImage(payload && payload.bytes);
    } catch (error) {
      console.error("[Local OCR] recognize failed:", error && error.message);
      return { ok: false, error: (error && error.message) || "本地 OCR 失败" };
    }
  });
  ipcMain.handle("local-ocr:preload", async () => {
    try {
      await getEngine();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error && error.message) || "本地 OCR 初始化失败" };
    }
  });
  if (app && typeof app.on === "function") {
    app.on("will-quit", () => { closeEngine(); });
  }
}

module.exports = { registerLocalOcrIPC, recognizeImage, closeEngine };
