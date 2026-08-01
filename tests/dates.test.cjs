const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadDateHelper() {
  const file = path.resolve(__dirname, '../src/scripts/app/shared/dates.js');
  const source = fs.readFileSync(file, 'utf8');
  const context = vm.createContext({ Date, String, Number, parseInt, isNaN });
  vm.runInContext(`${source}\nglobalThis.__datesTest = { parseDocDateToTimestamp };`, context, { filename: file });
  return context.__datesTest.parseDocDateToTimestamp;
}

test('parseDocDateToTimestamp handles empty input without inventing a date', () => {
  const parseDocDateToTimestamp = loadDateHelper();
  assert.equal(parseDocDateToTimestamp(null), 0);
  assert.equal(parseDocDateToTimestamp(''), 0);
  assert.equal(parseDocDateToTimestamp('   '), 0);
});

test('parseDocDateToTimestamp preserves native ISO date parsing', () => {
  const parseDocDateToTimestamp = loadDateHelper();
  assert.equal(parseDocDateToTimestamp('2024-02-29'), new Date('2024-02-29').getTime());
});

test('parseDocDateToTimestamp handles common year-first and day-first variants', () => {
  const parseDocDateToTimestamp = loadDateHelper();
  assert.equal(parseDocDateToTimestamp('2024/02/29'), new Date('2024/02/29').getTime());
  assert.equal(parseDocDateToTimestamp('29/02/2024'), new Date(2024, 1, 29).getTime());
  assert.equal(parseDocDateToTimestamp('29.02.2024'), new Date(2024, 1, 29).getTime());
});

test('parseDocDateToTimestamp clamps invalid month/day values as before', () => {
  const parseDocDateToTimestamp = loadDateHelper();
  assert.equal(parseDocDateToTimestamp('2024/99/99'), new Date(2024, 0, 1).getTime());
});
