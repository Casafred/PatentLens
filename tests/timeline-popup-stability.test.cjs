const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPlacement() {
  const file = path.resolve(__dirname, '../src/scripts/app/features/timeline-popup-stability.js');
  const context = vm.createContext({ window: {}, document: {} });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context.window._tlComputePopupPlacement;
}

test('timeline popup flips above when the preferred lower side is clipped', () => {
  const computePlacement = loadPlacement();
  const placement = computePlacement({
    rect: { left: 480, top: 760, bottom: 800, width: 24 },
    viewportWidth: 1200,
    viewportHeight: 900,
    popupWidth: 320,
    popupHeight: 300,
    preferredBelow: true,
  });

  assert.equal(placement.placeBelow, false);
  assert.ok(placement.top >= 8);
  assert.ok(placement.top + placement.maxHeight <= 892);
});

test('timeline popup chooses the side with more room before limiting list height', () => {
  const computePlacement = loadPlacement();
  const placement = computePlacement({
    rect: { left: 480, top: 460, bottom: 500, width: 24 },
    viewportWidth: 1200,
    viewportHeight: 900,
    popupWidth: 320,
    popupHeight: 600,
    preferredBelow: true,
  });

  assert.equal(placement.placeBelow, false);
  assert.ok(placement.maxHeight > 380);
  assert.ok(placement.top + placement.maxHeight <= 892);
});

test('timeline popup does not impose an artificial half-viewport height cap', () => {
  const computePlacement = loadPlacement();
  const placement = computePlacement({
    rect: { left: 480, top: 60, bottom: 100, width: 24 },
    viewportWidth: 1200,
    viewportHeight: 1200,
    popupWidth: 320,
    popupHeight: 900,
    preferredBelow: true,
  });

  assert.equal(placement.placeBelow, true);
  assert.equal(placement.maxHeight, 900);
});

test('timeline popup remains inside the viewport when both sides are tight', () => {
  const computePlacement = loadPlacement();
  const placement = computePlacement({
    rect: { left: 40, top: 95, bottom: 110, width: 20 },
    viewportWidth: 360,
    viewportHeight: 200,
    popupWidth: 320,
    popupHeight: 500,
    preferredBelow: true,
  });

  assert.ok(placement.left >= 8);
  assert.ok(placement.left + placement.width <= 352);
  assert.ok(placement.top >= 8);
  assert.ok(placement.top + placement.maxHeight <= 192);
  assert.ok(placement.maxHeight > 0);
});

test('timeline popup clamps narrow-screen width and horizontal position', () => {
  const computePlacement = loadPlacement();
  const placement = computePlacement({
    rect: { left: 0, top: 120, bottom: 150, width: 18 },
    viewportWidth: 220,
    viewportHeight: 700,
    popupWidth: 320,
    popupHeight: 180,
    preferredBelow: true,
  });

  assert.equal(placement.width, 204);
  assert.equal(placement.left, 8);
  assert.ok(placement.top >= 8);
  assert.ok(placement.top + placement.maxHeight <= 692);
});

function loadPopupModule() {
  const file = path.resolve(__dirname, '../src/scripts/app/features/timeline-popup-stability.js');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
  };
  sandbox.window = sandbox;
  sandbox.document = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context;
}

function makeElement() {
  const classes = new Set();
  return {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    style: {},
    isConnected: true,
    appendChild() {},
    contains() { return false; },
    _classes: classes,
  };
}

test('鼠标离开后关闭计时不会被连续 pointermove 无限推迟', async () => {
  const context = loadPopupModule();
  const popup = makeElement();
  const home = makeElement();
  context._tlOpenPopupInfo = { el: popup, home };
  context._tlPopupPinned = true;

  const startedAt = Date.now();
  context.window._tlScheduleClosePopup();
  await new Promise((resolve) => setTimeout(resolve, 80));
  // 模拟鼠标持续移动：再次安排关闭不能重置计时。
  context.window._tlScheduleClosePopup();
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.notEqual(context._tlOpenPopupInfo, null, '尚未到关闭时间时不应提前关闭');

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(context._tlOpenPopupInfo, null, '计时结束后应关闭弹层');
  assert.equal(context._tlPopupPinned, false, '指针离开节点/弹层后应解除固定');
  assert.ok(Date.now() - startedAt < 260, '关闭不应被后续 pointermove 推迟');
});
