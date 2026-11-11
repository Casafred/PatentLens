const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshot } = require('../src/scripts/app/features/patent2pic-source.js');
test('source snapshot preserves exact originals and publication kind and does not follow later tab changes', () => {
  const data = { patent_number: 'US12345678B2', language: 'en', title: 'Example', claims: [
    { num: '7', text: '7. A device\n  comprising a housing.', type: 'independent' },
    { num: '19', text: 'A method comprising receiving a signal.', type: 'independent' },
  ] };
  const request = snapshot(data, [0, 1, 0]);
  assert.equal(request.claims.length, 2);
  assert.equal(request.claims[0].originalText, data.claims[0].text);
  assert.equal(request.claims[1].sourceClaimNumber, '19');
  data.patent_number = 'US12345678A1'; data.claims[0].text = 'changed';
  assert.equal(request.claims[0].publicationNumber, 'US12345678B2');
  assert.equal(request.claims[0].originalText, '7. A device\n  comprising a housing.');
});
test('missing, empty or out-of-range claims are rejected', () => {
  const data = { patent_number: 'US1B2', claims: [{ num: '1', text: '' }] };
  assert.throws(() => snapshot(data, [0]));
  assert.throws(() => snapshot(data, [9]));
  assert.throws(() => snapshot(data, []));
});
