const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadParser() {
  const file = path.resolve(__dirname, '../src/scripts/app/features/amended-claims-ocr.js');
  const context = vm.createContext({ console, setTimeout, document: { readyState: 'loading', addEventListener() {} } });
  context.window = context;
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return context.AmendedClaimsOcr;
}

test('清洗修改标记并恢复未编号的修改版权利要求', () => {
  const parser = loadParser();
  const result = parser.parseClaims(`Please amend the claims as indicated in the marked-up version.\na housing;\na motor supported within the housing;\nan anvil configured to receive intermittent torque $ \\underline{\\text{to rotate the anvil about an axis}} $.\n3. (Previously Presented) The impact tool of claim 1, wherein the stress reducer includes a first recess.\n10. (Currently Amended) An impact tool comprising:\na housing;\na motor.\n18. (Original) The impact tool of claim 10, wherein the first recess is a cylindrical blind bore.\nan impact receiving portion having first and second anvil lugs;\na driving end portion opposite the impact receiving portion.\n20. (Previously Presented) The anvil of claim 19, wherein the first bore is offset.`);
  assert.deepEqual(Array.from(result.claims.map((claim) => claim.num)), ['1', '3', '10', '18', '19', '20']);
  assert.match(result.claims[0].text, /to rotate the anvil about an axis/);
  assert.doesNotMatch(result.cleanedText, /Currently Amended|Previously Presented|\\underline|\\text/);
  assert.equal(result.claims.find((claim) => claim.num === '3').type, 'dependent');
  assert.equal(result.claims.find((claim) => claim.num === '19').type, 'independent');
  assert.ok(result.diagnostics.some((message) => message.includes('权利要求 19')));
});

test('用户编辑后的编号文本可重新解析', () => {
  const parser = loadParser();
  const result = parser.parseClaims('1. An impact tool comprising a housing.\n\n2. The impact tool of claim 1, wherein the housing includes a grip.');
  assert.equal(result.claims.length, 2);
  assert.deepEqual(Array.from(result.claims[1].dependencies), ['1']);
  assert.equal(parser.serializeClaims(result.claims), '1. An impact tool comprising a housing.\n\n2. The impact tool of claim 1, wherein the housing includes a grip.');
});
