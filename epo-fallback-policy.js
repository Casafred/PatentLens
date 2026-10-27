/**
 * EPO Register 降级流程的页面判定策略。
 *
 * 这里的函数只做纯字符串/URL 判断，方便单元测试覆盖。
 * Electron 主进程用它判断弹窗当前停留在哪个阶段，避免把
 * Cloudflare、检索中、空档案、限流等页面误判为“已就绪”，
 * 从而长时间卡在 EPO Global Dossier 页面。
 */

"use strict";

const CLOUDFLARE_TITLE_KEYWORDS = [
  "just a moment",
  "attention required",
  "checking your browser",
  "performing security",
  "verifying you are human",
  "verify you are human",
  "请稍候",
  "请稍等",
  "正在检查",
  "正在验证",
  "需要关注",
  "执行安全",
  "稍候片刻",
];

const CLOUDFLARE_BODY_KEYWORDS = [
  "performing security verification",
  "just a moment",
  "ray id:",
];

const RETRIEVING_KEYWORDS = [
  "dossier documents are being retrieved",
  "documents are being retrieved",
  "being retrieved",
  "正在检索",
];

const EMPTY_DOSSIER_KEYWORDS = [
  "no files were found",
  "no files containing",
  "no dossier",
  "application not found",
  "no documents found",
  "no documents are available",
  "the application number is not valid",
];

const RATE_LIMIT_KEYWORDS = [
  "rate limit",
  "too many requests",
  "rate-limited",
  "access denied",
];

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function includesAny(text, keywords) {
  if (!text) return false;
  return keywords.some((keyword) => text.includes(keyword));
}

function isEpoCloudflareTitle(title) {
  return includesAny(lower(title), CLOUDFLARE_TITLE_KEYWORDS);
}

function isEpoCloudflareBody(html) {
  const text = lower(html);
  return text.includes("cloudflare") && includesAny(text, CLOUDFLARE_BODY_KEYWORDS);
}

function isEpoCloudflarePage(value) {
  return isEpoCloudflareTitle(value) || isEpoCloudflareBody(value);
}

function isEpoRetrievingPage(html) {
  return includesAny(lower(html), RETRIEVING_KEYWORDS);
}

function isEpoEmptyDossierPage(html) {
  return includesAny(lower(html), EMPTY_DOSSIER_KEYWORDS);
}

function isEpoRateLimitedPage(html) {
  return includesAny(lower(html), RATE_LIMIT_KEYWORDS);
}

/**
 * 对当前 EPO 弹窗页面做阶段判定。
 * 既支持直接传 html/title，也支持传 Electron 页面里已经计算好的布尔标记。
 *
 * 返回：cloudflare | retrieving | rateLimited | empty | ready | waiting
 */
function classifyEpoPage(input) {
  const options = input || {};
  const flags = options.flags || {};
  const html = typeof options.html === "string" ? options.html : "";
  const title = typeof options.title === "string" ? options.title : "";

  if (flags.isCloudflare || isEpoCloudflareTitle(title) || isEpoCloudflareBody(html)) {
    return "cloudflare";
  }
  if (flags.isRetrieving || isEpoRetrievingPage(html)) {
    return "retrieving";
  }
  if (flags.isRateLimited || isEpoRateLimitedPage(html)) {
    return "rateLimited";
  }
  if (flags.isEmpty || isEpoEmptyDossierPage(html)) {
    return "empty";
  }
  if (flags.hasDocLinks || flags.hasDocListTable || flags.hasDocList) {
    return "ready";
  }
  return "waiting";
}

/**
 * 只缓存确认可用、能稳定打开文档列表的 EPO Register URL。
 * 拒绝 espacenet / regviewer / documentView / 首页等无效入口，
 * 防止一次失败解析把坏 URL 永久写进缓存，导致后续查询一直跳到错误页面。
 */
function isUsableEpoDossierCacheUrl(url) {
  if (typeof url !== "string" || !url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.hostname !== "register.epo.org") return false;

  const path = parsed.pathname || "";
  if (!path || path === "/") return false;
  if (/documentView|regviewer|espacenet/i.test(path)) return false;

  if (path.includes("ipfwretrieve")) {
    return Boolean(parsed.searchParams.get("apn"));
  }
  if (path.includes("application")) {
    return Boolean(parsed.searchParams.get("number"));
  }
  return false;
}

module.exports = {
  isEpoCloudflareTitle,
  isEpoCloudflareBody,
  isEpoCloudflarePage,
  isEpoRetrievingPage,
  isEpoEmptyDossierPage,
  isEpoRateLimitedPage,
  classifyEpoPage,
  isUsableEpoDossierCacheUrl,
};
