/*!
 * PatentLens - 主应用专利详情页「加入分享项目」按钮注入
 *
 * 作用：
 * 在主应用「专利原文详情页」（#patent-detail-content）顶部 .pd-header .pd-links
 * 中注入一个「加入分享项目」按钮。点击后弹出项目选择对话框，可选择：
 *   - 已有的本机分享项目（listProjects 返回）
 *   - 新建分享项目（newProject）
 * 选择后切换激活项目并调用 PatentShareWorkspace.addCurrentPatent() 把当前
 * window._currentPatentData 对应的快照入库；可选择继续打开分享工作台。
 *
 * 实现方式：作为独立特性模块在 share-entry.js 之后加载。web-app.js 已冻结，
 * 此处不修改其渲染逻辑，仅通过 MutationObserver 监听 #patent-detail-content
 * 的子树变化，在 .pd-links 出现时幂等注入按钮。
 *
 * 依赖的全局：window.PatentShareWorkspace、window.PatentShareStore、
 * window.PatentShareUI、window._currentPatentData。
 */
(function () {
  "use strict";

  var INJECT_FLAG = "data-share-injected";
  var BUTTON_CLASS = "pd-header-link pd-share-add-btn";
  var BUTTON_ID = "pd-share-add-btn";
  var observer = null;

  function makeElement(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function isShareReady() {
    return !!(window.PatentShareWorkspace && window.PatentShareWorkspace.addCurrentPatent &&
      window.PatentShareStore && window.PatentShareUI);
  }

  function getCurrentPatentNumber() {
    var data = window._currentPatentData;
    if (!data) return "";
    return String(data.patent_number || data.publication_number || data.application_number || "").trim();
  }

  // 弹出项目选择对话框，返回 { mode: "existing"|"new", projectId?, projectName? } 或 null（取消）
  function pickTargetProject() {
    var store = window.PatentShareStore;
    var current = store.getSnapshot();
    return store.listProjects().then(function (items) {
      var safeItems = Array.isArray(items) ? items : [];
      // 选项：所有已有项目 + 「新建项目」
      var options = safeItems.map(function (item) {
        var flag = item.id === current.id ? "（当前）" : "";
        return (item.name || "未命名分享项目") + " · " + (item.patentCount || 0) + " 篇" + flag;
      });
      options.push("＋ 新建分享项目");

      var message = "选择目标分享项目，将把当前专利「" + (getCurrentPatentNumber() || "未命名") + "」加入其中。";
      return window.PatentShareUI.selectOption(message, options, 0, "加入分享项目").then(function (choice) {
        if (choice == null) return null;
        var idx = parseInt(choice, 10) - 1;
        if (Number.isNaN(idx) || idx < 0) return null;
        if (idx < safeItems.length) {
          var picked = safeItems[idx];
          return { mode: "existing", projectId: picked.id, projectName: picked.name };
        }
        return { mode: "new" };
      });
    });
  }

  function executeAdd(target) {
    var store = window.PatentShareStore;
    // 1. 切换目标项目（如需）
    var switchPromise;
    if (target.mode === "new") {
      if (store.getPersistenceState().mode === "loading") {
        return Promise.resolve({ ok: false, reason: "正在恢复本机分享项目，请稍候再试。" });
      }
      store.newProject();
      switchPromise = Promise.resolve(true);
    } else if (target.mode === "existing") {
      var current = store.getSnapshot();
      if (current && current.id === target.projectId) {
        switchPromise = Promise.resolve(true);
      } else {
        switchPromise = store.selectProject(target.projectId).then(function (r) {
          return !!(r && r.ok);
        });
      }
    } else {
      switchPromise = Promise.resolve(false);
    }
    return switchPromise.then(function (switched) {
      if (!switched && target.mode === "existing") {
        return { ok: false, reason: "未能切换到目标项目，可能已被删除。" };
      }
      // 2. 调用工作台 addCurrentPatent（quiet 模式，由本模块统一提示）
      return window.PatentShareWorkspace.addCurrentPatent({ quiet: true }).then(function (result) {
        return result;
      });
    });
  }

  function onButtonClick() {
    if (!isShareReady()) {
      window.PatentShareUI && window.PatentShareUI.alert("分享工作台尚未就绪，请稍后再试。", "无法加入");
      return;
    }
    if (!getCurrentPatentNumber()) {
      window.PatentShareUI.alert("未检测到当前专利原文。请先查询并打开一篇专利。", "无法加入");
      return;
    }
    if (window.PatentShareStore.getPersistenceState().mode === "loading") {
      window.PatentShareUI.alert("正在恢复本机分享项目，请稍候再试。", "请稍候");
      return;
    }
    var btn = document.getElementById(BUTTON_ID);
    if (btn) btn.disabled = true;
    pickTargetProject().then(function (target) {
      if (!target) return null;
      return executeAdd(target).then(function (result) {
        return { result: result, target: target };
      });
    }).then(function (payload) {
      if (!payload) return; // 用户取消
      var result = payload.result;
      var target = payload.target;
      var projectName = target.mode === "new" ? (window.PatentShareStore.getSnapshot().name || "新项目") : (target.projectName || "目标项目");
      if (result && result.ok) {
        return window.PatentShareUI.confirm(
          "已把专利「" + (result.patentNumber || getCurrentPatentNumber()) + "」加入分享项目「" + projectName + "」。\n是否立即打开分享工作台？",
          "加入成功"
        ).then(function (yes) {
          if (yes) window.PatentShareWorkspace.open();
        });
      }
      var reason = (result && result.reason) || "未知错误";
      var msg;
      if (reason === "duplicate") msg = "该专利已存在于分享项目「" + projectName + "」中，无需重复加入。";
      else if (reason === "no-current-patent") msg = "未检测到当前专利原文，无法加入。";
      else if (reason === "loading") msg = "正在恢复本机分享项目，请稍候再加入。";
      else msg = "加入失败：" + reason;
      return window.PatentShareUI.alert(msg, "加入失败");
    }).catch(function (err) {
      console.error("[share-detail-inject] addCurrentPatent error:", err);
      window.PatentShareUI.alert("加入出错：" + (err && err.message ? err.message : String(err)), "出错");
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function buildButton() {
    var btn = makeElement("button", BUTTON_CLASS, "加入分享项目");
    btn.id = BUTTON_ID;
    btn.type = "button";
    btn.title = "把当前专利加入分享项目（可选已有项目或新建）";
    btn.setAttribute(INJECT_FLAG, "1");
    btn.addEventListener("click", onButtonClick);
    return btn;
  }

  function injectInto(links) {
    if (!links || links.querySelector("." + "pd-share-add-btn")) return;
    links.appendChild(buildButton());
  }

  function scan() {
    var root = document.getElementById("patent-detail-content");
    if (!root) return;
    // 检查是否处于 hidden 状态（详情页未显示时不注入也无妨，但保留以防用户切换）
    var links = root.querySelector(".pd-header .pd-links");
    if (links) injectInto(links);
  }

  function startObserver() {
    if (observer) return;
    var root = document.getElementById("patent-detail-content");
    if (!root) return;
    observer = new MutationObserver(function () {
      scan();
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function init() {
    if (!isShareReady()) {
      // 分享模块未加载（如非 Electron 环境），静默退出
      return;
    }
    scan();
    startObserver();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
