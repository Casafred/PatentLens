const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('../packages/patent2pic-editor/node_modules/typescript');
const source = fs.readFileSync(path.join(__dirname, '../packages/patent2pic-editor/src/services/claim/parser.ts'), 'utf8');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, context);
const { parseClaims, parseSingleClaim } = context.exports;
test('nonconsecutive source claim numbers survive initial parsing and new analysis sessions', () => {
  const claims = parseClaims('7. A housing.\n19. A method.');
  assert.deepEqual(Array.from(claims, claim => claim.index), [7, 19]);
  claims[0].source = { publicationNumber: 'US1B2', sourceClaimNumber: '7', originalText: 'A housing.' };
  const reparsed = parseClaims('7. A housing.\n19. A method.', 99, claims);
  assert.equal(reparsed[0].source.sourceClaimNumber, '7');
  assert.equal(reparsed[0].id, 'claim-99-1');
});
test('structured imports retain nested numbered method steps as one claim', () => {
  const body = 'A method comprising:\n1. receiving a signal;\n2. sending a signal.';
  const claim = { ...parseSingleClaim(body, 19, 'source-19'), source: { sourceClaimNumber: '19' } };
  const reparsed = parseClaims('19. ' + body, 10, [claim]);
  assert.equal(reparsed.length, 1);
  assert.equal(reparsed[0].index, 19);
  assert.equal(reparsed[0].rawText, body);
});
