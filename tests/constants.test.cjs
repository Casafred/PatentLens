const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadConstants() {
  const file = path.resolve(__dirname, '../src/scripts/app/shared/constants.js');
  const source = fs.readFileSync(file, 'utf8');
  const context = vm.createContext({});
  vm.runInContext(`${source}\nglobalThis.__constantsTest = { GD_API_BASE, OFFICE_NAMES };`, context, { filename: file });
  return context.__constantsTest;
}

test('Global Dossier API base remains unchanged', () => {
  assert.equal(loadConstants().GD_API_BASE, '/api/gd');
});

test('office labels retain the renderer mapping contract', () => {
  const { OFFICE_NAMES } = loadConstants();
  assert.deepEqual({ ...OFFICE_NAMES }, {
    US: '美国 (USPTO)',
    EP: '欧洲 (EPO)',
    JP: '日本 (JPO)',
    DE: '德国 (DPMA)',
    KR: '韩国 (KIPO)',
    WO: 'WIPO (PCT)',
    WIPO: 'WIPO (PCT)',
    CN: '中国 (CNIPA)',
  });
});

