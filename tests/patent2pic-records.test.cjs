const test = require('node:test');
const assert = require('node:assert/strict');
const { index, forClaim, removeFile } = require('../src/scripts/app/features/patent2pic-records.js');
function fixture() {
  return { 'patent2pic-workspace': JSON.stringify({ projects: [{ id: 'p', name: '项目' }] }), 'patent2pic-project-p': JSON.stringify({ activeFileId: 'b', files: [
    { id: 'empty', versions: [] },
    ...['a', 'b'].map((id, i) => ({ id, name: id, claims: [{ id: 'c' + id, index: 7, rawText: 'edited', source: { publicationNumber: i ? 'US123B2' : 'US123A1', sourceClaimNumber: '7', originalText: 'original' } }], claimId: 'c' + id, versions: [{ id: 'v' + id, createdAt: i + 1, serializedGraph: { cells: [{ id: 'node' }] } }] })),
  ] }), 'patent2pic-trash': JSON.stringify({ items: [
    { kind: 'version', payload: { projectId: 'p', fileId: 'b' } },
    { kind: 'version', payload: { projectId: 'p', fileId: 'a' } },
  ] }) };
}
test('graph index excludes ungenerated inputs and preserves publication kind, claim number and project target', () => {
  const rows = index(fixture()); assert.equal(rows.length, 2); assert.equal(rows[0].fileId, 'b');
  assert.equal(forClaim(rows, { patent_number: 'US123B2' }, { num: '7', text: 'original' }).length, 1);
  assert.equal(forClaim(rows, { patent_number: 'US123B2' }, { num: '7', text: 'changed' }).length, 0);
  assert.equal(forClaim(rows, { patent_number: 'US123B2' }, { num: '8', text: 'original' }).length, 0);
});
test('removing one task retains other tasks and repairs active file without mutating original storage', () => {
  const values = fixture(), clean = removeFile(values, { projectId: 'p', fileId: 'b' });
  assert.equal(index(clean).length, 1); assert.equal(index(values).length, 2);
  assert.equal(JSON.parse(clean['patent2pic-project-p']).activeFileId, 'empty');
  assert.equal(JSON.parse(clean['patent2pic-trash']).items.length, 1);
  assert.equal(JSON.parse(clean['patent2pic-trash']).items[0].payload.fileId, 'a');
});
