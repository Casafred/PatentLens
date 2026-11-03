/*!
 * PatentLens Global Dossier 登录辅助预加载脚本
 * Copyright (c) 2026 Alfred Shi. All rights reserved.
 *
 * 仅在 USPTO Okta 登录页生效：
 *  - 从主进程读取本机加密保存的用户名/密码，自动填入登录表单；
 *  - 自动填入失败时，可点击登录页右下角面板中的“填入”按钮手动回填；
 *  - 登录页右下角提供“记住密码”开关，可在登录成功后保存凭据；
 *  - 提交时只把候选凭据交给主进程，真正登录成功后才加密落盘。
 */

const { ipcRenderer } = require("electron");

const LOGIN_HOST_RE = /(^|\.)(auth\.uspto\.gov|uspto-gov\.okta\.com)$/i;
const PANEL_ID = "__patentlens_gd_remember_panel";
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;
// 新版 Okta Sign-In Widget 的密码字段名是 credentials.passcode，
// 旧版才是 password / #okta-signin-password，这里全部兼容。
const PASSWORD_SELECTORS = [
  'input[name="password"]',
  'input[name="credentials.passcode"]',
  "#okta-signin-password",
  'input[autocomplete="current-password"]',
  'input[data-se*="credentials.passcode"]',
];
const NON_LOGIN_PASSWORD_RE =
  /(reset|recover|forgot|new[-_ ]?password|change[-_ ]?password|enroll|activate|setup)/i;
const LINK_BUTTON_STYLE = [
  "border:0",
  "background:transparent",
  "color:#0969da",
  "cursor:pointer",
  "padding:0 2px",
  "font:inherit",
].join(";");

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
// 用户自己输入过的字段不再自动覆盖，避免用户清空重输时被旧密码反复填回。
const userEditedFields = new WeakSet();

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
    'input[autocomplete="username"]',
  ]);
}

function passwordField() {
  return findFirst([
    'input[name="password"]',
    'input[name="credentials.passcode"]',
    "#okta-signin-password",
    'input[autocomplete="current-password"]',
    'input[type="password"]',
  ]);
}

// 只在明确的“当前密码”输入框里自动填充，避免把旧密码填进改密/重置密码表单。
function isNonLoginPasswordField(el) {
  let node = el;
  for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
    const attrs = [
      node.id,
      node.getAttribute && node.getAttribute("name"),
      node.getAttribute && node.getAttribute("action"),
      node.getAttribute && node.getAttribute("data-se"),
      typeof node.className === "string" ? node.className : "",
    ];
    if (attrs.some((value) => value && NON_LOGIN_PASSWORD_RE.test(value))) return true;
    if (node.tagName === "FORM") break;
  }
  return false;
}

function loginPasswordField() {
  const explicit = findFirst(PASSWORD_SELECTORS);
  if (explicit) return explicit;
  // 部分 Okta 页面不会标注 current-password；回退到页面上第一个可见密码框，
  // 但排除改密/重置密码等非登录表单（见 isNonLoginPasswordField）。
  let nodes;
  try {
    nodes = document.querySelectorAll('input[type="password"]');
  } catch (_) {
    return null;
  }
  for (const node of nodes) {
    if (!node || node.disabled) continue;
    if (typeof node.getClientRects === "function" && node.getClientRects().length === 0) continue;
    if (isNonLoginPasswordField(node)) continue;
    return node;
  }
  return null;
}

function setNativeValue(el, value) {
  try {
    if (!el || el.disabled || el.readOnly) return false;
    try {
      if (document.activeElement !== el) el.focus({ preventScroll: true });
    } catch (_) {}
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
  if (savedCredentials && savedCredentials.password) return "已记住密码，进入密码页自动填入（也可点“填入”）";
  if (state.hasSaved) return "已记住密码";
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

  const fillBtn = document.createElement("button");
  fillBtn.type = "button";
  fillBtn.textContent = "填入";
  fillBtn.title = "用本机保存的账号密码填入";
  fillBtn.setAttribute("style", LINK_BUTTON_STYLE);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.textContent = "清除";
  clearBtn.setAttribute("style", LINK_BUTTON_STYLE);

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

  fillBtn.addEventListener("click", () => {
    void manualFill();
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
  panel.appendChild(fillBtn);
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

function isUserEditedField(field) {
  return !!field && userEditedFields.has(field);
}

// 返回实际填入结果，auto 模式下不覆盖用户已经输入/修改过的内容。
function fillSavedCredentials(options) {
  const overwrite = !!(options && options.overwrite);
  const result = { usernameFilled: false, passwordFilled: false };
  if (!savedCredentials) return result;
  const userField = usernameField();
  if (userField && savedCredentials.username && !userField.disabled && !userField.readOnly) {
    if (overwrite || (!isUserEditedField(userField) && !String(userField.value || "").trim())) {
      result.usernameFilled = setNativeValue(userField, savedCredentials.username);
    }
  }
  const passField = loginPasswordField();
  if (passField && savedCredentials.password && !passField.disabled && !passField.readOnly) {
    if (overwrite || (!isUserEditedField(passField) && !String(passField.value || ""))) {
      result.passwordFilled = setNativeValue(passField, savedCredentials.password);
    }
  }
  return result;
}

function tryAutofill() {
  if (!stateLoaded || !state.remember || !state.encryptionAvailable) return;
  if (!savedCredentials || !savedCredentials.password) return;
  const result = fillSavedCredentials({ overwrite: false });
  if (result.passwordFilled) {
    updateStatus(result.usernameFilled ? "已自动填入保存的账号和密码" : "已自动填入保存的密码");
  } else if (result.usernameFilled) {
    updateStatus("已自动填入保存的账号，进入密码页后自动填入密码");
  }
}

async function manualFill() {
  if (!stateLoaded) await loadState();
  if (!state.encryptionAvailable) {
    updateStatus("当前系统不支持安全存储，无法填入");
    return;
  }
  if (!state.remember) {
    updateStatus("已关闭密码记忆，请勾选“记住密码”后再填入");
    return;
  }
  if (!savedCredentials || !savedCredentials.password) {
    updateStatus("尚未保存密码，请先登录一次并保持“记住密码”勾选");
    return;
  }
  const result = fillSavedCredentials({ overwrite: true });
  if (result.passwordFilled) {
    updateStatus(result.usernameFilled ? "已填入保存的账号和密码" : "已填入保存的密码");
  } else if (result.usernameFilled) {
    updateStatus("已填入保存的账号，未找到密码输入框");
  } else {
    updateStatus("未找到可填写的登录输入框");
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
  // 页面切换（identifier-first 的 Next）后的密码提交可能紧接在上一次捕获之后，
  // 阈值过大会把密码捕获丢掉，导致密码从未落盘。
  if (now - lastCaptureAt < 300) return;
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
  document.addEventListener("input", (event) => {
    if (!event.isTrusted) return;
    const target = event.target;
    if (
      target
      && typeof target.matches === "function"
      && target.matches('input[type="password"], input[name="identifier"], input[name="username"]')
    ) {
      userEditedFields.add(target);
    }
  }, true);
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
