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
  popup.style.maxHeight = Math.floor(vh * 0.5) + "px";
  popup.style.overflowY = "auto";
  void popup.offsetHeight;
  var pw = popup.offsetWidth, ph = popup.offsetHeight;
  var centerX = rect.left + rect.width / 2;
  var left = Math.max(MARGIN, Math.min(centerX - pw / 2, vw - pw - MARGIN));
  var isFolded = node.classList.contains("tl-s-folded-node");
  var spaceBelow = vh - rect.bottom - GAP - MARGIN;
  var spaceAbove = rect.top - GAP - MARGIN;
  var placeBelow;
  if (isFolded) {
    placeBelow = spaceBelow >= ph ? true : (spaceAbove >= ph ? false : spaceBelow >= spaceAbove);
  } else {
    placeBelow = node.classList.contains("tl-s-above");
    if (placeBelow && spaceBelow < ph * 0.5 && spaceAbove > spaceBelow + 50) placeBelow = false;
    else if (!placeBelow && spaceAbove < ph * 0.5 && spaceBelow > spaceAbove + 50) placeBelow = true;
  }
  var top;
  if (placeBelow) {
    top = rect.bottom + GAP;
    if (top + ph > vh - MARGIN) top = Math.max(MARGIN, vh - MARGIN - ph);
  } else {
    top = rect.top - GAP - ph;
    if (top < MARGIN) top = MARGIN;
  }
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
