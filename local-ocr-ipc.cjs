"use strict";

/**
 * 本地轻量 OCR（实验）
 *
 * 主引擎：PP-OCRv6 Tiny 原生运行时（体积小、速度快）。
 * 回退引擎：tesseract.js（纯 WASM，离线），当原生运行时无法加载
 *（例如系统缺少依赖 DLL、显卡驱动异常）时自动接管，保证功能可用。
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const TESSERACT_LANGS = "chi_sim+eng+deu";
const RECOGNIZE_TIMEOUT_MS = 120 * 1000;
// 与 @arcships/light-ocr-runtime 的平台包映射保持一致
const PLATFORM_PACKAGES = {
  "win32-x64": "@arcships/light-ocr-win32-x64",
  "win32-arm64": "@arcships/light-ocr-win32-arm64",
  "darwin-arm64": "@arcships/light-ocr-darwin-arm64",
  "darwin-x64": "@arcships/light-ocr-darwin-x64",
  "linux-x64": "@arcships/light-ocr-linux-x64-gnu",
  "linux-arm64": "@arcships/light-ocr-linux-arm64-gnu",
};
// 原生插件（onnxruntime）动态链接的 VC++ 运行库
const WINDOWS_CRT_DLLS = ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll", "concrt140.dll"];

let queue = Promise.resolve();
let nativeEnginePromise = null;
let nativeFailure = null;
let nativeUnavailable = false;
let tessWorkerPromise = null;
let assetPaths = null;

// Electron 打包后 require.resolve 返回 app.asar 内的路径；原生 .node 及其
// 依赖 DLL 必须在 app.asar.unpacked 中按实体文件加载。
function unpackAsarPath(target) {
  if (!target) return target;
  // 兼容 Windows 原生分隔符与 Electron 可能返回的正斜杠路径
  if (target.includes("\\app.asar\\")) {
    return target.replace("\\app.asar\\", "\\app.asar.unpacked\\");
  }
  if (target.includes("/app.asar/")) {
    return target.replace("/app.asar/", "/app.asar.unpacked/");
  }
  return target;
}

function resolvePackagedNative() {
  const packageName = PLATFORM_PACKAGES[process.platform + "-" + process.arch];
  if (!packageName) return null;
  let binary;
  try {
    binary = require.resolve(packageName);
  } catch (_) {
    return null;
  }
  const unpacked = unpackAsarPath(binary);
  if (unpacked === binary) return null;
  const descriptor = path.join(path.dirname(unpacked), "runtime-descriptor.json");
  if (!fs.existsSync(unpacked) || !fs.existsSync(descriptor)) return null;
  return { binary: unpacked, descriptor };
}

// 模型文件由原生代码直接读取，同样不能位于 asar 内。
// 开发环境返回 null，保持 facade 原有的模型解析逻辑。
function resolveModelBundlePath() {
  try {
    const manifest = require.resolve("@arcships/light-ocr-model-ppocrv6-tiny/bundle/manifest.json");
    const unpacked = unpackAsarPath(manifest);
    if (unpacked !== manifest && fs.existsSync(unpacked)) return path.dirname(unpacked);
  } catch (_) {}
  return null;
}

function firstLine(text) {
  return String(text || "").split(/\r?\n/)[0].trim();
}

function missingWindowsCrt() {
  if (process.platform !== "win32") return [];
  const dirs = [];
  for (const root of [process.env.SystemRoot, process.env.windir, "C:\\Windows"]) {
    if (root) dirs.push(path.join(root, "System32"));
  }
  for (const entry of String(process.env.PATH || "").split(";")) {
    const dir = entry.trim().replace(/^"|"$/g, "");
    if (dir) dirs.push(dir);
  }
  return WINDOWS_CRT_DLLS.filter((name) => !dirs.some((dir) => {
    try { return fs.existsSync(path.join(dir, name)); } catch (_) { return false; }
  }));
}

function loadFailureMessage(error) {
  const cause = error && error.cause;
  const code = (cause && cause.code) || (error && error.code) || "";
  const detail = firstLine(cause && cause.message).replace(/^Error:\s*/, "");
  const missing = missingWindowsCrt();
  if (missing.length) {
    return "原生组件加载失败：系统缺少 Microsoft Visual C++ 运行库（" + missing[0] +
      "），请安装 VC++ 2015-2022 x64 运行库";
  }
  const suffix = [code, detail].filter(Boolean).join("：");
  return "原生组件加载失败" + (suffix ? "（" + suffix + "）" : "");
}

function friendlyOcrError(error) {
  const message = String((error && error.message) || error || "");
  const match = message.match(/Unable to locate (@arcships\/light-ocr-[^\s]+)/);
  if (match) {
    return new Error("本地 OCR 原生组件缺失（" + match[1] + "）。请运行 npm install 或安装最新版应用。");
  }
  if (/Unable to load the verified native addon/.test(message)) {
    return new Error(loadFailureMessage(error) + "。");
  }
  if (/Descriptor artifact|payload inventory mismatch|hash mismatch|byte count mismatch/.test(message)) {
    return new Error("本地 OCR 原生组件文件不完整或已损坏，请重新安装最新版应用。");
  }
  return error;
}

function getNativeEngine() {
  if (!nativeEnginePromise) {
    nativeEnginePromise = (async () => {
      const packaged = resolvePackagedNative();
      if (packaged && !process.env.LIGHT_OCR_NODE_BINARY) {
        process.env.LIGHT_OCR_NODE_BINARY = packaged.binary;
        process.env.LIGHT_OCR_RUNTIME_DESCRIPTOR = packaged.descriptor;
      }
      const { createEngine } = require("@arcships/light-ocr-tiny");
      const bundlePath = resolveModelBundlePath();
      return createEngine(bundlePath ? { bundlePath } : undefined);
    })().catch((error) => {
      nativeEnginePromise = null;
      throw friendlyOcrError(error);
    });
  }
  return nativeEnginePromise;
}

function resolveAssetPaths() {
  return {
    langPath: path.join(__dirname, "assets", "ocr-tessdata"),
    cachePath: path.join(os.tmpdir(), "patentlens-ocr-cache"),
  };
}

function getTesseractWorker() {
  if (!tessWorkerPromise) {
    tessWorkerPromise = (async () => {
      const paths = assetPaths || resolveAssetPaths();
      if (!fs.existsSync(paths.langPath)) {
        throw new Error("本地 OCR 语言数据缺失，请重新安装最新版应用");
      }
      const { createWorker, OEM } = require("tesseract.js");
      let workerPath;
      try {
        const main = unpackAsarPath(require.resolve("tesseract.js"));
        workerPath = path.join(path.dirname(path.dirname(main)), "src", "worker-script", "node", "index.js");
      } catch (_) {}
      return createWorker(TESSERACT_LANGS, OEM.LSTM_ONLY, {
        workerPath,
        langPath: paths.langPath,
        cachePath: paths.cachePath,
        gzip: true,
        logger: () => {},
      });
    })().catch((error) => {
      tessWorkerPromise = null;
      throw error;
    });
  }
  return tessWorkerPromise;
}

function pngSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature) || buffer.toString("ascii", 12, 16) !== "IHDR") {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// tesseract 会在中文字符之间插入空格；去掉 CJK 与全角标点之间的空格。
function tidyOcrText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(
      /(?<=[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef])\s+(?=[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef])/g,
      "",
    )
    .trim();
}

function tesseractLines(data) {
  const lines = [];
  for (const block of (data && data.blocks) || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const text = tidyOcrText(line.text);
        const box = line.bbox;
        if (!text || !box) continue;
        lines.push({
          text,
          confidence: Number(line.confidence || 0) / 100,
          box: [
            { x: box.x0, y: box.y0 },
            { x: box.x1, y: box.y0 },
            { x: box.x1, y: box.y1 },
            { x: box.x0, y: box.y1 },
          ],
        });
      }
    }
  }
  return lines;
}

async function recognizeWithTesseract(buffer) {
  const worker = await getTesseractWorker();
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("识别超时")), RECOGNIZE_TIMEOUT_MS);
      if (timer && typeof timer.unref === "function") timer.unref();
    });
    const outcome = await Promise.race([
      worker.recognize(buffer, {}, { text: true, blocks: true }),
      timeout,
    ]);
    const size = pngSize(buffer) || {};
    return {
      imageWidth: size.width || 0,
      imageHeight: size.height || 0,
      lines: tesseractLines(outcome && outcome.data),
    };
  } catch (error) {
    // 超时或 worker 崩溃后复位，下一次重新创建
    tessWorkerPromise = null;
    worker.terminate().catch(() => {});
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toResult(result, engine, durationMs) {
  const labels = { native: "PP-OCRv6 Tiny", tesseract: "Tesseract（兼容模式）" };
  return {
    ok: true,
    engine,
    engineLabel: labels[engine] || "",
    imageWidth: result.imageWidth,
    imageHeight: result.imageHeight,
    lines: (result.lines || []).map((line) => ({
      text: line.text,
      confidence: line.confidence,
      box: line.box,
    })),
    modelBundleId: result.modelBundleId || "",
    durationMs: durationMs || 0,
  };
}

async function recognizeWithBestEngine(buffer, engineOverride) {
  if (engineOverride) {
    return toResult(await engineOverride.recognizeEncoded(buffer), "custom");
  }
  const startedAt = Date.now();
  if (!nativeUnavailable) {
    try {
      const engine = await getNativeEngine();
      const result = await engine.recognizeEncoded(buffer);
      return toResult(result, "native", Date.now() - startedAt);
    } catch (error) {
      nativeUnavailable = true;
      nativeFailure = error;
      console.error("[Local OCR] 原生引擎不可用，切换到兼容引擎:", error && error.message);
    }
  }
  try {
    const result = await recognizeWithTesseract(buffer);
    return toResult(result, "tesseract", Date.now() - startedAt);
  } catch (error) {
    if (nativeFailure) {
      throw new Error(
        friendlyOcrError(nativeFailure).message + " 兼容引擎也未能启动：" +
        ((error && error.message) || error),
      );
    }
    throw error;
  }
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

  const run = queue.then(() => recognizeWithBestEngine(buffer, engineOverride));
  queue = run.then(() => {}, () => {});
  try {
    return await run;
  } catch (error) {
    throw friendlyOcrError(error);
  }
}

async function closeEngine() {
  const pendingNative = nativeEnginePromise;
  nativeEnginePromise = null;
  if (pendingNative) {
    try {
      const engine = await pendingNative;
      if (engine && typeof engine.close === "function") await engine.close();
    } catch (_) {}
  }
  const pendingTess = tessWorkerPromise;
  tessWorkerPromise = null;
  if (pendingTess) {
    try {
      const worker = await pendingTess;
      if (worker && typeof worker.terminate === "function") await worker.terminate();
    } catch (_) {}
  }
}

function registerLocalOcrIPC({ ipcMain, app }) {
  if (app && typeof app.getPath === "function") {
    const appRoot = typeof app.getAppPath === "function" ? app.getAppPath() : __dirname;
    assetPaths = {
      langPath: unpackAsarPath(path.join(appRoot, "assets", "ocr-tessdata")),
      cachePath: path.join(app.getPath("userData"), "ocr-cache"),
    };
  }
  ipcMain.handle("local-ocr:recognize", async (_event, payload) => {
    try {
      return await recognizeImage(payload && payload.bytes);
    } catch (error) {
      console.error("[Local OCR] recognize failed:", error && error.message, (error && error.cause) || "");
      return { ok: false, error: (error && error.message) || "本地 OCR 失败" };
    }
  });
  ipcMain.handle("local-ocr:preload", async () => {
    try {
      await getNativeEngine();
      return { ok: true, engine: "native" };
    } catch (_) {
      try {
        await getTesseractWorker();
        return { ok: true, engine: "tesseract" };
      } catch (error) {
        return { ok: false, error: (error && error.message) || "本地 OCR 初始化失败" };
      }
    }
  });
  if (app && typeof app.on === "function") {
    app.on("will-quit", () => { closeEngine(); });
  }
}

module.exports = {
  registerLocalOcrIPC,
  recognizeImage,
  recognizeWithTesseract,
  closeEngine,
  friendlyOcrError,
  unpackAsarPath,
  pngSize,
  tidyOcrText,
  tesseractLines,
};
