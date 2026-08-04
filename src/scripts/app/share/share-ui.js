/*!
 * PatentLens - 专利分享工作台UI工具
 *
 * Electron 环境禁用 window.prompt/alert/confirm，此处提供安全的模态对话框替代。
 */
(function () {
  "use strict";

  function byId(id) { return document.getElementById(id); }
  function makeElement(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function ensureModalRoot() {
    var root = byId("share-modal-root");
    if (root) return root;
    root = makeElement("div", "share-modal-root", "");
    root.id = "share-modal-root";
    document.body.appendChild(root);
    return root;
  }

  function showModal(options) {
    return new Promise(function (resolve) {
      var root = ensureModalRoot();
      var overlay = makeElement("div", "share-modal-overlay");
      var dialog = makeElement("div", "share-modal-dialog");
      var header = makeElement("div", "share-modal-header");
      header.appendChild(makeElement("h3", "share-modal-title", options.title || "提示"));
      dialog.appendChild(header);
      var body = makeElement("div", "share-modal-body");
      if (options.message) body.appendChild(makeElement("p", "share-modal-message", options.message));
      var input = null;
      var select = null;
      var textarea = null;
      if (options.type === "prompt") {
        if (options.options && options.options.length) {
          select = document.createElement("select");
          select.className = "share-modal-select";
          options.options.forEach(function (opt, idx) {
            var o = document.createElement("option");
            o.value = String(idx + 1);
            o.textContent = opt;
            if (options.defaultValue != null && String(idx + 1) === String(options.defaultValue)) o.selected = true;
            select.appendChild(o);
          });
          body.appendChild(select);
        } else if (options.multiline) {
          textarea = document.createElement("textarea");
          textarea.className = "share-modal-textarea";
          textarea.value = options.defaultValue || "";
          textarea.rows = options.rows || 6;
          textarea.maxLength = options.maxLength || 10000;
          body.appendChild(textarea);
        } else {
          input = document.createElement("input");
          input.type = "text";
          input.className = "share-modal-input";
          input.value = options.defaultValue || "";
          input.maxLength = options.maxLength || 200;
          body.appendChild(input);
        }
      }
      dialog.appendChild(body);
      var footer = makeElement("div", "share-modal-footer");
      function close(value) {
        overlay.classList.add("closing");
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          resolve(value);
        }, 150);
      }
      if (options.type !== "alert") {
        var cancel = makeElement("button", "share-modal-btn share-modal-btn-cancel", options.cancelText || "取消");
        cancel.type = "button";
        cancel.addEventListener("click", function () { close(null); });
        footer.appendChild(cancel);
      }
      var ok = makeElement("button", "share-modal-btn share-modal-btn-ok", options.okText || "确定");
      ok.type = "button";
      ok.addEventListener("click", function () {
        if (input) close(input.value);
        else if (select) close(select.value);
        else if (textarea) close(textarea.value);
        else close(true);
      });
      footer.appendChild(ok);
      dialog.appendChild(footer);
      overlay.appendChild(dialog);
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay && options.type !== "alert") close(null);
      });
      document.addEventListener("keydown", function keyHandler(e) {
        if (e.key === "Escape" && options.type !== "alert") {
          document.removeEventListener("keydown", keyHandler);
          close(null);
        }
        if (e.key === "Enter" && !e.shiftKey && !textarea) {
          e.preventDefault();
          document.removeEventListener("keydown", keyHandler);
          if (input) close(input.value);
          else if (select) close(select.value);
          else close(true);
        }
      });
      root.appendChild(overlay);
      requestAnimationFrame(function () {
        overlay.classList.add("open");
        if (input) input.focus();
        else if (textarea) textarea.focus();
        else if (select) select.focus();
        else ok.focus();
      });
    });
  }

  function alert(message, title) {
    return showModal({ type: "alert", message: message, title: title || "提示", okText: "知道了" });
  }

  function confirm(message, title) {
    return showModal({ type: "confirm", message: message, title: title || "确认", okText: "确定", cancelText: "取消" });
  }

  function prompt(message, defaultValue, options, title) {
    var opts = null;
    if (options) {
      if (Array.isArray(options)) {
        opts = options;
      } else if (typeof options === "string") {
        opts = options.split(/\n/).map(function(s) { return s.trim(); }).filter(Boolean);
      }
    }
    return showModal({
      type: "prompt",
      message: message,
      defaultValue: defaultValue || "",
      options: opts,
      title: title || "输入",
      okText: "确定",
      cancelText: "取消"
    });
  }

  function selectOption(message, options, defaultIndex, title) {
    return showModal({
      type: "prompt",
      message: message,
      options: options,
      defaultValue: defaultIndex != null ? defaultIndex : 0,
      title: title || "选择",
      okText: "确定",
      cancelText: "取消"
    });
  }

  function multilinePrompt(message, defaultValue, title, rows) {
    return showModal({
      type: "prompt",
      message: message,
      defaultValue: defaultValue || "",
      multiline: true,
      rows: rows || 8,
      title: title || "编辑",
      okText: "保存",
      cancelText: "取消"
    });
  }

  window.PatentShareUI = {
    alert: alert,
    confirm: confirm,
    prompt: prompt,
    selectOption: selectOption,
    multilinePrompt: multilinePrompt,
  };
})();
