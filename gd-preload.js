/*!
 * PatentLens Global Dossier 登录辅助预加载脚本
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 *
 * 仅在 USPTO Okta 登录页生效：
 *  - 从主进程读取本机加密保存的用户名/密码，自动填入登录表单；
 *  - 登录页右下角提供“记住密码”开关，可在登录成功后保存凭据；
 *  - 提交时只把候选凭据交给主进程，真正登录成功后才加密落盘。
 */

const { ipcRenderer } = require("electron");

const LOGIN_HOST_RE = /(^|\.)(auth\.uspto\.gov|uspto-gov\.okta\.com)$/i;
const PANEL_ID = "__patentlens_gd_remember_panel";
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

const state = {
  remember: true,
  hasSaved: false,
  encryptionAvailable: true,
};
let savedCredentials = null;
let stateLoaded = false;
let panel = null;
let checkbox = null;
let statusText = null;
let pollStartedAt = 0;
let pollTimer = null;
let lastCaptureAt = 0;

function findFirst(selectors) {
  for (const selector of selectors) {
    let nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (_) {
      continue;
    }
    for (const node of nodes) {
      if (!node || node.disabled) continue;
      if (typeof node.getClientRects === "function" && node.getClientRects().length === 0) continue;
      return node;
    }
  }
  return null;
}

function usernameField() {
  return findFirst([
    'input[name="identifier"]',
    'input[name="username"]',
    "#okta-signin-username",
    "#identifier",
  ]);
}

function passwordField() {
  return findFirst([
    'input[name="password"]',
    "#okta-signin-password",
    'input[autocomplete="current-password"]',
    'input[type="password"]',
  ]);
}

// 只在明确的“当前密码”输入框里自动填充，避免把旧密码填进改密/重置密码表单。
function loginPasswordField() {
  return findFirst([
    'input[name="password"]',
    "#okta-signin-password",
    'input[autocomplete="current-password"]',
  ]);
}

function setNativeValue(el, value) {
  try {
    const proto = Object.getPrototypeOf(el);
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && typeof descriptor.set === "function") descriptor.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch (_) {
    return false;
  }
}

function statusMessage() {
  if (!state.encryptionAvailable) return "当前系统不支持安全存储，无法记住密码";
  if (!state.remember) return "已关闭密码记忆";
  if (state.hasSaved || savedCredentials) return "已记住密码，本次已自动填充";
  return "登录成功后将记住密码（仅本机加密保存）";
}

function updateStatus(text) {
  if (statusText) statusText.textContent = text || statusMessage();
}

function removePanel() {
  if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
  panel = null;
  checkbox = null;
  statusText = null;
}

function createPanel() {
  if (panel && panel.isConnected) return panel;
  panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.setAttribute("style", [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:2147483647",
    "display:flex",
    "align-items:center",
    "gap:8px",
    "padding:8px 10px",
    "border-radius:8px",
    "background:#ffffff",
    "color:#1f2328",
    "border:1px solid rgba(31,35,40,.22)",
    "box-shadow:0 6px 20px rgba(0,0,0,.18)",
    "font:12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
  ].join(";"));

  checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = "__patentlens_gd_remember_cb";
  checkbox.checked = !!state.remember;
  checkbox.disabled = !state.encryptionAvailable;
  checkbox.style.margin = "0";

  const label = document.createElement("label");
  label.htmlFor = checkbox.id;
  label.textContent = "记住密码";
  label.style.cursor = "pointer";
  label.style.whiteSpace = "nowrap";

  statusText = document.createElement("span");
  statusText.style.color = "#57606a";
  statusText.style.maxWidth = "280px";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.textContent = "清除";
  clearBtn.setAttribute("style", [
    "border:0",
    "background:transparent",
    "color:#0969da",
    "cursor:pointer",
    "padding:0 2px",
    "font:inherit",
  ].join(";"));

  checkbox.addEventListener("change", async () => {
    state.remember = checkbox.checked;
    try {
      const next = await ipcRenderer.invoke("gd-remember-set", checkbox.checked);
      if (next) {
        state.remember = !!next.remember;
        state.hasSaved = !!next.hasSaved;
      }
    } catch (_) {}
    if (!checkbox.checked) {
      savedCredentials = null;
      state.hasSaved = false;
    }
    updateStatus();
  });

  clearBtn.addEventListener("click", async () => {
    savedCredentials = null;
    state.hasSaved = false;
    state.remember = false;
    checkbox.checked = false;
    try {
      await ipcRenderer.invoke("gd-credentials-clear");
    } catch (_) {}
    updateStatus("已清除本机保存的密码");
  });

  panel.appendChild(checkbox);
  panel.appendChild(label);
  panel.appendChild(statusText);
  panel.appendChild(clearBtn);
  document.body.appendChild(panel);
  updateStatus();
  return panel;
}

async function loadState() {
  try {
    const remoteState = await ipcRenderer.invoke("gd-credentials-state");
    if (remoteState && typeof remoteState === "object") {
      state.remember = remoteState.remember !== false;
      state.hasSaved = !!remoteState.hasSaved;
      state.encryptionAvailable = remoteState.encryptionAvailable !== false;
    }
    savedCredentials = await ipcRenderer.invoke("gd-credentials-get");
  } catch (_) {
    savedCredentials = null;
  }
  stateLoaded = true;
  if (checkbox) {
    checkbox.checked = !!state.remember;
    checkbox.disabled = !state.encryptionAvailable;
  }
  updateStatus();
}

function tryAutofill() {
  if (!stateLoaded || !state.remember || !state.encryptionAvailable) return;
  if (!savedCredentials || !savedCredentials.password) return;
  const userField = usernameField();
  const passField = loginPasswordField();
  if (userField && savedCredentials.username && !String(userField.value || "").trim()) {
    setNativeValue(userField, savedCredentials.username);
  }
  if (passField && !String(passField.value || "")) {
    if (setNativeValue(passField, savedCredentials.password)) {
      updateStatus("已自动填充密码（仅本机加密保存）");
    }
  }
}

function captureCredentials() {
  if (!stateLoaded || !state.encryptionAvailable) return;
  const userField = usernameField();
  const passField = passwordField();
  if (!userField && !passField) return;
  const username = userField ? String(userField.value || "").trim() : "";
  const password = passField ? String(passField.value || "") : "";
  if (!username && !password) return;
  const now = Date.now();
  if (now - lastCaptureAt < 1000) return;
  lastCaptureAt = now;
  ipcRenderer.send("gd-credentials-candidate", {
    username,
    password,
    remember: checkbox ? checkbox.checked : state.remember,
  });
}

function isSubmitTarget(target) {
  if (!target || typeof target.closest !== "function") return false;
  if (target.closest("#" + PANEL_ID)) return false;
  return !!(
    target.closest('button[type="submit"], input[type="submit"], #okta-signin-submit, [data-type="save"]')
    || target.closest("form")
  );
}

function tick() {
  if (Date.now() - pollStartedAt > POLL_TIMEOUT_MS) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    return;
  }
  if (!document.body) return;
  const userField = usernameField();
  const passField = passwordField();
  if (!userField && !passField) {
    if (panel) removePanel();
    return;
  }
  if (!panel) createPanel();
  tryAutofill();
}

function begin() {
  pollStartedAt = Date.now();
  loadState();
  document.addEventListener("submit", () => setTimeout(captureCredentials, 0), true);
  document.addEventListener("click", (event) => {
    if (isSubmitTarget(event.target)) setTimeout(captureCredentials, 0);
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.target && event.target.closest && event.target.closest("#" + PANEL_ID)) return;
    setTimeout(captureCredentials, 0);
  }, true);
  const timer = setInterval(tick, POLL_INTERVAL_MS);
  pollTimer = timer;
  tick();
}

if (LOGIN_HOST_RE.test(location.hostname)) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", begin, { once: true });
  } else {
    begin();
  }
}
