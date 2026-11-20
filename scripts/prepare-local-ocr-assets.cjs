"use strict";

/**
 * 准备本地 OCR 回退引擎（tesseract.js）的语言数据。
 *
 * tesseract.js 需要把 .traineddata 放在同一个目录里；而 @tesseract.js-data
 * 每个语言是独立包，因此安装时把需要的语言复制到 assets/ocr-tessdata。
 */

const fs = require("node:fs");
const path = require("node:path");

const LANGS = ["chi_sim", "eng", "deu"];
const ASSET_DIR = path.join(__dirname, "..", "assets", "ocr-tessdata");

function findSource(lang) {
  const pkgDir = path.join(__dirname, "..", "node_modules", "@tesseract.js-data", lang);
  const candidates = [
    // 整数化的 best 模型体积更小（约 6MB 三语言），识别质量优于 fast
    path.join(pkgDir, "4.0.0_best_int", lang + ".traineddata.gz"),
    path.join(pkgDir, "4.0.0", lang + ".traineddata.gz"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function main() {
  fs.mkdirSync(ASSET_DIR, { recursive: true });
  const missing = [];
  for (const lang of LANGS) {
    const source = findSource(lang);
    if (!source) {
      missing.push(lang);
      continue;
    }
    const target = path.join(ASSET_DIR, lang + ".traineddata.gz");
    if (fs.existsSync(target) && fs.statSync(target).size === fs.statSync(source).size) continue;
    fs.copyFileSync(source, target);
  }
  if (missing.length) {
    console.warn("[Local OCR] 缺少语言数据：" + missing.join(", ") + "，回退引擎可能不可用");
  }
}

if (require.main === module) main();

module.exports = { main, LANGS };
