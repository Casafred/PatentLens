/*!
 * PatentLens - Agent 转移模式 · 打包器
 *
 * 职责：
 *   1. 把提示词 + 勾选的上下文块 + 补充备注渲染为可直接粘贴的完整指令
 *   2. 统一信封格式（块标题带来源与字符数，便于人工与 Agent 溯源）
 *   3. 提供剪贴板写入（Electron 桥优先，Web API 兜底）
 *
 * 纯函数 buildPackage 可在 Node vm 中单测。
 *
 * 对外暴露 window.TransferPackager
 */
var TransferPackager = (function () {
  "use strict";

  function todayText() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function formatPatentNumber(data) {
    if (!data) return "";
    return data.patent_number || data.raw || data.patentNumber || "";
  }

  // blocks: 已勾选的块对象数组；prompt: 已含底线条款的完整指令
  function buildPackage(options) {
    var opts = options || {};
    var blocks = (opts.blocks || []).filter(function (b) {
      return b && b.available !== false && b.text && b.text.trim();
    });
    var prompt = (opts.prompt || "").trim();
    var note = (opts.note || "").trim();
    var sceneLabel = opts.sceneLabel || "上下文交接";
    var pn = opts.patentNumber || formatPatentNumber(opts.data) || "未知专利";

    var lines = [];
    lines.push("# PatentLens 上下文交接 · " + sceneLabel);
    lines.push("生成日期：" + todayText() + "　专利号：" + pn + "　块数量：" + blocks.length);
    lines.push("");
    lines.push("## 一、任务指令");
    lines.push(prompt || "（未配置任务指令，请直接说明你的分析需求）");
    lines.push("");
    lines.push("## 二、背景上下文");

    var blockStats = [];
    if (!blocks.length) {
      lines.push("（本次未勾选任何可用上下文块）");
    }
    blocks.forEach(function (b, i) {
      var header = "【块" + (i + 1) + "｜" + b.label + "｜来源：" + (b.source || "PatentLens") +
        "｜" + b.chars + " 字" + (b.truncated ? "｜已截断" : "") + "】";
      lines.push("");
      lines.push(header);
      if (b.note) lines.push("> 备注：" + b.note);
      lines.push(b.text);
      blockStats.push({ key: b.key, label: b.label, chars: b.chars, truncated: !!b.truncated });
    });

    if (note) {
      lines.push("");
      lines.push("## 三、补充要求（用户手工填写）");
      lines.push(note);
    }

    var text = lines.join("\n");
    return {
      text: text,
      chars: text.length,
      blockCount: blocks.length,
      blockStats: blockStats,
    };
  }

  // 仅统计勾选块的字符数（面板实时预算用，不含模板固定文本）
  function sumBlockChars(blocks) {
    return (blocks || []).reduce(function (sum, b) {
      return sum + (b && b.available !== false ? (b.chars || 0) : 0);
    }, 0);
  }

  function listUnavailable(blocks) {
    return (blocks || []).filter(function (b) {
      return b && (b.available === false || !b.text || !b.text.trim());
    });
  }

  // 剪贴板写入：Electron 桥 → navigator.clipboard → execCommand 三级降级
  function copyText(text) {
    return new Promise(function (resolve) {
      try {
        if (typeof window !== "undefined" && window.electronAPI &&
          typeof window.electronAPI.copyToClipboard === "function") {
          var ok = window.electronAPI.copyToClipboard(text);
          if (ok) return resolve({ ok: true, via: "electron" });
        }
      } catch (e) { /* 继续降级 */ }

      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          resolve({ ok: true, via: "navigator" });
        }).catch(function () {
          resolve({ ok: false, via: "navigator", error: "clipboard-api-denied" });
        });
        return;
      }

      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var done = document.execCommand("copy");
        document.body.removeChild(ta);
        resolve({ ok: !!done, via: "exec-command" });
      } catch (e) {
        resolve({ ok: false, via: "exec-command", error: e.message });
      }
    });
  }

  return {
    buildPackage: buildPackage,
    sumBlockChars: sumBlockChars,
    listUnavailable: listUnavailable,
    copyText: copyText,
  };
})();

if (typeof window !== "undefined") {
  window.TransferPackager = TransferPackager;
}
