// 时间轴折叠节点弹窗稳定性补丁（v2）
// 彻底修复：
//  1) 闪动：去掉 2×rAF + opacity 切换 + CSS 动画；改为「隐藏定位→一次测量→定好坐标再显示」的同步流程。
//  2) 飞地/错位：折叠节点一律从起点 rect.bottom 向下展开；下方空间不足时就地收缩 maxHeight 并内部滚动，
//     绝不把弹窗整体移到视口中央/顶部。仅在下方极度不足且上方显著更宽裕时才翻转。
//  3) 折叠圆点视觉：在 CSS 中放大、加粗计数；hover 用外光环代替 scale，避免布局抖动。
// 直接覆盖全局函数（web-app.js 中的 _tl* 函数），不修改 legacy 文件。

// 兼容未定义变量（patch 先于 web-app.js 某些路径执行时）
if (typeof _tlPopupPinned === "undefined") { /* web-app.js 会随后定义并复用同一全局 */ }

window._tlClosePopup = function() {
  if (typeof _tlPopupPinned !== "undefined" && _tlPopupPinned) return;
  if (typeof _tlPopupCloseTimer !== "undefined" && _tlPopupCloseTimer) {
    clearTimeout(_tlPopupCloseTimer);
    _tlPopupCloseTimer = null;
  }
  if (typeof _tlOpenPopupInfo === "undefined" || !_tlOpenPopupInfo) return;
  var el = _tlOpenPopupInfo.el, home = _tlOpenPopupInfo.home;
  el.classList.remove("tl-s-popup-open");
  // 清掉所有内联定位/尺寸样式，回到 CSS 默认（隐藏态）
  el.style.left = "";
  el.style.top = "";
  el.style.bottom = "";
  el.style.maxHeight = "";
  el.style.overflowY = "";
  el.style.width = "";
  el.style.visibility = "";
  el.style.opacity = "";
  el.style.transform = "";
  el.style.animation = "";
  // 归还到原节点（若节点已被重渲染移除，则直接丢弃弹层）
  if (home && home.isConnected) home.appendChild(el);
  else if (el.parentNode) el.parentNode.removeChild(el);
  _tlOpenPopupInfo = null;
};

window._tlPositionPopup = function(popup, node, rect) {
  var vh = window.innerHeight, vw = window.innerWidth;
  var MARGIN = 8, GAP = 8;
  var MIN_USABLE = 90;     // 低于此高度才视为「下方几乎没空间」
  var FLIP_MARGIN = 80;    // 滞回阈值：避免临界位置上下翻转闪动
  var HARD_CAP = Math.floor(vh * 0.55);

  // 给弹窗一个明确宽度，避免内容长短不一导致宽度跳动 → 位置随之跳动
  var pw = Math.min(320, vw - MARGIN * 2);
  popup.style.width = pw + "px";

  // 先用宽松上限测量真实内容高度
  popup.style.maxHeight = HARD_CAP + "px";
  popup.style.overflowY = "auto";
  // 强制同步布局以拿到准确 offsetHeight
  void popup.offsetWidth;
  var ph = popup.offsetHeight;

  // 水平：以节点中心对齐，但不超出视口
  var centerX = rect.left + rect.width / 2;
  var left = Math.max(MARGIN, Math.min(centerX - pw / 2, vw - pw - MARGIN));

  var isFolded = node.classList.contains("tl-s-folded-node");
  var spaceBelow = vh - rect.bottom - GAP - MARGIN;
  var spaceAbove = rect.top - GAP - MARGIN;

  var placeBelow;
  if (isFolded) {
    // 折叠节点：默认从起点直接向下展开（用户期望）。
    // 仅当「下方几乎放不下(< MIN_USABLE) 且 上方显著更宽裕(> 下方 + FLIP_MARGIN)」时才翻向上方，
    // 否则就吸附在节点下方，按可用高度收缩 + 内部滚动。
    placeBelow = !(spaceBelow < MIN_USABLE && spaceAbove > spaceBelow + FLIP_MARGIN);
  } else {
    placeBelow = node.classList.contains("tl-s-above");
    if (placeBelow && spaceBelow < ph * 0.5 && spaceAbove > spaceBelow + FLIP_MARGIN) placeBelow = false;
    else if (!placeBelow && spaceAbove < ph * 0.5 && spaceBelow > spaceAbove + FLIP_MARGIN) placeBelow = true;
  }

  var top, maxH;
  if (placeBelow) {
    // 锚定在节点正下方
    top = rect.bottom + GAP;
    var availH = vh - MARGIN - top;
    if (availH >= ph) {
      maxH = HARD_CAP;            // 放得下，用宽松上限
    } else if (availH >= MIN_USABLE) {
      maxH = availH;              // 就地收缩，内部滚动，仍吸附在节点下方
    } else {
      // 下方几乎没空间：仍尝试吸附下方（给最小高度 + 内部滚动），
      // 避免出现「飞地」。只有当下方连 MIN_USABLE 都没有且上方明显更大时，才退到上方。
      if (spaceAbove > spaceBelow + FLIP_MARGIN && spaceAbove >= MIN_USABLE) {
        top = Math.max(MARGIN, rect.top - GAP - Math.min(ph, spaceAbove));
        maxH = Math.min(ph, spaceAbove);
      } else {
        maxH = Math.max(MIN_USABLE, availH);
      }
    }
  } else {
    top = rect.top - GAP - ph;
    if (top < MARGIN) {
      var aboveAvail = rect.top - GAP - MARGIN;
      if (aboveAvail >= MIN_USABLE) {
        maxH = Math.min(ph, aboveAvail);
        top = MARGIN;
      } else {
        top = MARGIN;
        maxH = Math.min(ph, vh - 2 * MARGIN);
      }
    } else {
      maxH = HARD_CAP;
    }
  }

  popup.style.maxHeight = maxH + "px";
  popup.style.left = left + "px";
  popup.style.top = Math.max(MARGIN, top) + "px";
  popup.style.bottom = "auto";
};

window._tlOpenPopupFor = function(node) {
  if (typeof _tlPopupCloseTimer !== "undefined" && _tlPopupCloseTimer) {
    clearTimeout(_tlPopupCloseTimer);
    _tlPopupCloseTimer = null;
  }
  // 切换到不同节点时解除锁定
  if (typeof _tlOpenPopupInfo !== "undefined" && _tlOpenPopupInfo && _tlOpenPopupInfo.home !== node) {
    _tlPopupPinned = false;
  }
  // 已经打开的是同一节点的弹层 → 保持
  if (typeof _tlOpenPopupInfo !== "undefined" && _tlOpenPopupInfo && _tlOpenPopupInfo.home === node) return;
  window._tlClosePopup();

  var popup = node.querySelector(".tl-s-popup");
  if (!popup) return;

  if (node.classList.contains("tl-s-folded-node")) node.style.cursor = "pointer";

  // 关键：先移到 body 并保持隐藏（visibility 继承自 base .tl-s-popup 的 hidden），
  // 同步完成「测量 + 定位 + 设 maxHeight」，最后再加 .tl-s-popup-open 显示。
  // 全程一次同步流程，无 rAF 延迟、无 opacity 切换、无 CSS 动画 → 零闪动。
  document.body.appendChild(popup);
  // 关闭 CSS 渐入动画，避免每次打开都有 opacity 0→1 的闪现
  popup.style.animation = "none";
  popup.classList.toggle("select-mode", typeof _tlSelectMode !== "undefined" && _tlSelectMode !== null);

  // 同步定位（visibility 仍为 hidden，不会看到任何中间态）
  window._tlPositionPopup(popup, node, node.getBoundingClientRect());

  // 立即显示（一次类切换，无动画）
  popup.classList.add("tl-s-popup-open");

  if (!popup._tlHoverBoundPatched) {
    popup.addEventListener("mouseenter", function() {
      if (typeof _tlPopupCloseTimer !== "undefined" && _tlPopupCloseTimer) {
        clearTimeout(_tlPopupCloseTimer);
        _tlPopupCloseTimer = null;
      }
    });
    popup.addEventListener("mouseleave", function() {
      if (typeof _tlScheduleClosePopup === "function") _tlScheduleClosePopup();
    });
    popup._tlHoverBoundPatched = true;
  }
  _tlOpenPopupInfo = { el: popup, home: node };
};
