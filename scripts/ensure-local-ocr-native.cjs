"use strict";

// 在 Windows 上确保本地 OCR 的平台原生包存在。
// 该包是 optionalDependency；部分 npm 配置（--omit=optional）或 CI 缓存
// 会跳过它，导致应用能启动但一点“本地 OCR”就报缺少原生包。
const path = require("node:path");

if (process.platform !== "win32") {
  process.exit(0);
}

const { ensureWindowsNativePackage } = require("./before-pack.cjs");

ensureWindowsNativePackage(path.resolve(__dirname, "..")).then(() => {
  console.log("[Local OCR] Windows native package ready");
}).catch((error) => {
  // 不阻断 npm install：离线或代理异常时仍允许开发；打包前会再次确保，
  // 若仍缺失则 beforePack 会中止打包，避免发布坏安装包。
  console.warn("[Local OCR] Could not prepare Windows native package yet:", error && error.message);
});
