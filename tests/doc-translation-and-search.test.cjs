const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadPatentStatus() {
  const context = vm.createContext({ console });
  vm.runInContext(read('src/scripts/patent-status.js'), context, { filename: 'patent-status.js' });
  return context;
}

function fakeDocument() {
  return {
    readyState: 'complete',
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ style: {}, appendChild() {}, select() {}, remove() {} }),
    body: { appendChild() {}, removeChild() {} },
  };
}

function loadFeature(file, extra = {}) {
  const window = { localStorage: null, ...extra };
  const context = vm.createContext({ window, document: fakeDocument(), console, setTimeout, clearTimeout });
  vm.runInContext(read(file), context, { filename: file });
  return window;
}

test('US GD fallback titles have Chinese translations for newly requested documents', () => {
  const status = loadPatentStatus();
  const cases = [
    ['DO.EO.MISS', 'Notice of DO/EO Missing Requirements Mailed', 'notification'],
    ['INTV.REQ', 'Electronic Request for Interview with Examiner', 'applicant_request'],
    ['EXIN', 'Examiner Initiated Interview Summary', 'notification'],
    ['CTAD', 'Advisory Action', 'office_action'],
  ];

  for (const [code, title, type] of cases) {
    const info = status.getStatusInfo('US', code, title);
    assert.match(info.name, /[\u4e00-\u9fff]/, `${title} should resolve to a Chinese name`);
    assert.equal(info.type, type, `${title} should be classified as ${type}`);
  }
});

test('document title recorder only treats real English titles as recordable', () => {
  const window = loadFeature('src/scripts/app/features/doc-title-recorder.js');
  const recorder = window.PatentLensDocTitleRecorder;
  assert.ok(recorder);
  assert.equal(recorder._looksLikeEnglishTitle('Advisory Action'), true);
  assert.equal(recorder._looksLikeEnglishTitle('拒绝通知'), false);
  assert.equal(recorder._looksLikeEnglishTitle('12345/2026'), false);
  assert.equal(recorder._looksLikeEnglishTitle('ABC'), false);
});

test('document search builds searchable text from name, description, code and date', () => {
  const window = loadFeature('src/scripts/app/features/doc-list-search.js');
  const search = window.PatentLensDocSearch;
  assert.ok(search);
  const text = search._documentSearchText({
    name: 'Advisory Action',
    desc: 'Advisory Action',
    docCode: 'CTAD',
    date: '2024-03-01',
    stage: '审查中',
  });
  assert.match(text, /advisory action/);
  assert.match(text, /ctad/);
  assert.match(text, /2024-03-01/);
});

test('GD citation helpers parse patent numbers and citation fields', () => {
  const window = loadFeature('src/scripts/app/features/gd-citation-data.js', { renderPatentDetail() {} });
  const citation = window.PatentLensGdCitationData;
  assert.ok(citation);

  const parsed = citation._parseNumberFallback('US20220301610A1');
  assert.equal(parsed.office, 'US');
  assert.equal(parsed.applicationNumber, '20220301610');
  assert.equal(parsed.kindCode, 'A1');
  assert.equal(parsed.queryType, 'publication');

  assert.equal(
    citation.citationNumber({
      citedDocument: { docCountry: 'US', docNumber: '11000000', docKindCode: 'B2' },
    }),
    'US11000000B2'
  );
  assert.equal(citation.splitSections('Section 1\n\nSection 2').join('|'), 'Section 1|Section 2');
  assert.equal(citation.cleanCitedIn('US\norigin\nEP'), 'US\nEP');
});
