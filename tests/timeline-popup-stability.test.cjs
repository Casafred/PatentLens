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
