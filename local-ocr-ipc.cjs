"use strict";

/**
 * 本地轻量 OCR（实验）
 * 使用 PP-OCRv6 Tiny（约 6MB 模型，CPU 推理）在端侧识别扫描页，
 * 不上传文档，供阅读器生成可选文字层。
 */

const fs = require("node:fs");
const path = require("node:path");

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
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

let enginePromise = null;
// 单引擎内部已有一个 worker；这里再串行化调用，避免多页同时识别抢占 CPU。
let queue = Promise.resolve();

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
    return "本地 OCR 原生组件加载失败：系统缺少 Microsoft Visual C++ 运行库（" + missing[0] +
      "）。请安装 VC++ 2015-2022 x64 运行库后重启应用。";
  }
  const suffix = [code, detail].filter(Boolean).join("：");
  return "本地 OCR 原生组件加载失败" + (suffix ? "（" + suffix + "）" : "") + "。";
}

function friendlyOcrError(error) {
  const message = String((error && error.message) || error || "");
  const match = message.match(/Unable to locate (@arcships\/light-ocr-[^\s]+)/);
  if (match) {
    return new Error(
      "本地 OCR 原生组件缺失（" + match[1] + "）。请关闭应用后在项目目录运行 npm install" +
      "（不要加 --omit=optional），或安装最新版安装包。"
    );
  }
  if (/Unable to load the verified native addon/.test(message)) {
    return new Error(loadFailureMessage(error));
  }
  if (/Descriptor artifact|payload inventory mismatch|hash mismatch|byte count mismatch/.test(message)) {
    return new Error("本地 OCR 原生组件文件不完整或已损坏，请重新安装最新版应用。");
  }
  return error;
}

function getEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const packaged = resolvePackagedNative();
      if (packaged && !process.env.LIGHT_OCR_NODE_BINARY) {
        process.env.LIGHT_OCR_NODE_BINARY = packaged.binary;
        process.env.LIGHT_OCR_RUNTIME_DESCRIPTOR = packaged.descriptor;
      }
      const { createEngine } = require("@arcships/light-ocr-tiny");
      const bundlePath = resolveModelBundlePath();
      return createEngine(bundlePath ? { bundlePath } : undefined);
    })().catch((error) => {
      enginePromise = null;
      throw friendlyOcrError(error);
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
  let result;
  try {
    result = await run;
  } catch (error) {
    throw friendlyOcrError(error);
  }

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
      console.error("[Local OCR] recognize failed:", error && error.message, (error && error.cause) || "");
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

module.exports = {
  registerLocalOcrIPC,
  recognizeImage,
  closeEngine,
  friendlyOcrError,
  unpackAsarPath,
};
