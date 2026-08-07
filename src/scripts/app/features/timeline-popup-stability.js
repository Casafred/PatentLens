// 时间轴折叠节点弹窗稳定性补丁
// 修复：1) 页面底部展开时闪动/抖动 2) 临界位置上下翻转 3) 先布局后显示避免跳动
// 直接覆盖全局函数（web-app.js 中的 _tl* 函数），不修改 legacy 文件
var _tlOrigClosePopup = window._tlClosePopup;
window._tlClosePopup = function() {
  if (_tlPopupPinned) return;
  clearTimeout(_tlPopupCloseTimer);
  _tlPopupCloseTimer = null;
  if (!_tlOpenPopupInfo) return;
  var el = _tlOpenPopupInfo.el, home = _tlOpenPopupInfo.home;
  el.classList.remove("tl-s-popup-open");
  el.style.left = el.style.top = el.style.bottom = el.style.opacity = "";
  el.style.visibility = el.style.pointerEvents = el.style.transform = "";
  el.style.maxHeight = el.style.overflowY = "";
  if (home && home.isConnected) home.appendChild(el);
  else if (el.parentNode) el.parentNode.removeChild(el);
  _tlOpenPopupInfo = null;
};
window._tlPositionPopup = function(popup, node, rect) {
  var vh = window.innerHeight, vw = window.innerWidth, MARGIN = 8, GAP = 8;
  var MIN_H = 150;        // 最小可用高度：低于此才考虑放弃该方向
  var FLIP_MARGIN = 60;   // 滞回阈值：避免临界位置上下翻转闪动
  var HARD_CAP = Math.floor(vh * 0.5);

  // 先给宽松上限，测量真实尺寸
  popup.style.maxHeight = HARD_CAP + "px";
  popup.style.overflowY = "auto";
  void popup.offsetWidth;
  var pw = popup.offsetWidth, ph = popup.offsetHeight;

  var centerX = rect.left + rect.width / 2;
  var left = Math.max(MARGIN, Math.min(centerX - pw / 2, vw - pw - MARGIN));

  var isFolded = node.classList.contains("tl-s-folded-node");
  var spaceBelow = vh - rect.bottom - GAP - MARGIN;
  var spaceAbove = rect.top - GAP - MARGIN;

  var placeBelow;
  if (isFolded) {
    // 折叠节点：默认从起点直接向下展开（用户期望）。
    // 仅当「下方放不下且上方显著更宽裕」时才翻到上方，避免临界位置来回翻转闪动。
    var fitsBelow = spaceBelow >= ph;
    var fitsAbove = spaceAbove >= ph;
    if (fitsBelow) {
      placeBelow = true;
    } else if (fitsAbove && spaceAbove >= spaceBelow + FLIP_MARGIN) {
      placeBelow = false;
    } else {
      placeBelow = spaceBelow >= MIN_H || spaceBelow >= spaceAbove;
    }
  } else {
    placeBelow = node.classList.contains("tl-s-above");
    if (placeBelow && spaceBelow < ph * 0.5 && spaceAbove > spaceBelow + FLIP_MARGIN) placeBelow = false;
    else if (!placeBelow && spaceAbove < ph * 0.5 && spaceBelow > spaceAbove + FLIP_MARGIN) placeBelow = true;
  }

  var top;
  var maxH = HARD_CAP;
  if (placeBelow) {
    top = rect.bottom + GAP;
    var availH = vh - MARGIN - top;
    if (availH < ph) {
      // 下方放不下完整高度：就地收缩高度并内部滚动，吸附在节点下方，
      // 而不是把弹窗整体移到视口中央/顶部的「莫名其妙的位置」。
      if (availH >= MIN_H) {
        maxH = availH;
      } else if (spaceAbove >= MIN_H && spaceAbove > spaceBelow + FLIP_MARGIN) {
        // 下方几乎没有空间：回退到节点上方并按可用高度收缩
        top = Math.max(MARGIN, rect.top - GAP - Math.min(ph, spaceAbove));
        maxH = Math.min(ph, spaceAbove);
      } else {
        top = Math.max(MARGIN, vh - MARGIN - Math.min(ph, vh - 2 * MARGIN));
        maxH = Math.min(ph, vh - 2 * MARGIN);
      }
    }
  } else {
    top = rect.top - GAP - ph;
    if (top < MARGIN) {
      var aboveAvail = rect.top - GAP - MARGIN;
      if (aboveAvail >= MIN_H) {
        maxH = Math.min(ph, aboveAvail);
        top = MARGIN;
      } else {
        top = MARGIN;
        maxH = Math.min(ph, vh - 2 * MARGIN);
      }
    }
  }
  popup.style.maxHeight = maxH + "px";
  popup.style.left = left + "px";
  popup.style.top = Math.max(MARGIN, top) + "px";
  popup.style.bottom = "auto";
};
window._tlOpenPopupFor = function(node) {
  clearTimeout(_tlPopupCloseTimer);
  if (_tlOpenPopupInfo && _tlOpenPopupInfo.home !== node) _tlPopupPinned = false;
  if (_tlOpenPopupInfo && _tlOpenPopupInfo.home === node) return;
  _tlClosePopup();
  var popup = node.querySelector(".tl-s-popup");
  if (!popup) return;
  if (node.classList.contains("tl-s-folded-node")) node.style.cursor = "pointer";
  document.body.appendChild(popup);
  popup.style.opacity = "0";
  popup.style.visibility = "hidden";
  popup.style.pointerEvents = "none";
  popup.style.transform = "none";
  popup.classList.toggle("select-mode", typeof _tlSelectMode !== "undefined" && _tlSelectMode !== null);
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      if (!popup.isConnected) return;
      _tlPositionPopup(popup, node, node.getBoundingClientRect());
      popup.style.visibility = "";
      popup.style.pointerEvents = "";
      popup.style.opacity = "";
      popup.style.transform = "";
      popup.classList.add("tl-s-popup-open");
    });
  });
  if (!popup._tlHoverBoundPatched) {
    popup.addEventListener("mouseenter", function() { clearTimeout(_tlPopupCloseTimer); });
    popup.addEventListener("mouseleave", _tlScheduleClosePopup);
    popup._tlHoverBoundPatched = true;
  }
  _tlOpenPopupInfo = { el: popup, home: node };
};
