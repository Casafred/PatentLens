const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadIcons() {
  const file = path.resolve(__dirname, '../src/scripts/app/shared/icons.js');
  const source = fs.readFileSync(file, 'utf8');
  const context = vm.createContext({});
  vm.runInContext(`${source}\nglobalThis.__iconsTest = { SVG_ICONS, icon };`, context, { filename: file });
  return context.__iconsTest;
}

test('shared icon registry retains the complete initial icon set', () => {
  const { SVG_ICONS } = loadIcons();
  assert.deepEqual(Object.keys(SVG_ICONS), [
    'search', 'folder', 'refresh', 'edit', 'globe', 'copy', 'close', 'check',
    'bot', 'paperclip', 'file', 'lightbulb', 'alert', 'type', 'trash', 'square',
    'checkSquare', 'brain', 'loader', 'x', 'checkCircle', 'external',
  ]);
});

test('icon renders the requested icon and preserves default class behavior', () => {
  const { icon } = loadIcons();
  assert.match(icon('search'), /^<svg class="svg-icon"/);
  assert.match(icon('search', 'sm'), /^<svg class="svg-icon-sm"/);
  assert.match(icon('search', 'sm', 'toolbar-icon'), /^<svg class="svg-icon-sm toolbar-icon"/);
});

test('icon falls back to the file icon for unknown names', () => {
  const { SVG_ICONS, icon } = loadIcons();
  assert.equal(icon('does-not-exist'), SVG_ICONS.file);
});

