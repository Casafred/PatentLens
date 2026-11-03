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
    documentElement: { style: { setProperty: () => {} } },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ style: {}, appendChild() {}, select() {}, remove() {} }),
    body: { appendChild() {}, removeChild() {} },
  };
}

function loadFeature(file, extra = {}) {
  const window = { localStorage: null, addEventListener: () => {}, ...extra };
  const context = vm.createContext({
    window,
    document: extra.document || fakeDocument(),
    console,
    setTimeout,
    clearTimeout,
  });
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
    ['DIST.E.FILE', 'Terminal Disclaimer-Filed (Electronic)', 'response'],
    ['DISQ.E.FILE', 'Terminal Disclaimer-Electronic-Approved', 'notification'],
    ['PET.DEC.AUTO', 'ePetition Grant Letter', 'notification'],
    ['PET.AUTO', 'ePetition Request Form', 'applicant_request'],
    ['MES.GIB', 'Certification of Micro Entity (Gross Income Basis)', 'notification'],
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

test('document title recorder is enabled by default and prunes newly translated records', () => {
  const recordsKey = 'patentlens_doc_title_records_v1';
  const store = new Map();
  store.set(recordsKey, JSON.stringify({
    'advisory action': {
      title: 'Advisory Action',
      office: 'US',
      docCode: 'CTAD',
      count: 1,
      firstSeen: 1,
      lastSeen: 1,
    },
  }));
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  const window = loadFeature('src/scripts/app/features/doc-title-recorder.js', {
    localStorage: storage,
    getStatusInfo: () => ({ name: '建议性意见 (Advisory Action)' }),
  });
  const recorder = window.PatentLensDocTitleRecorder;
  assert.equal(recorder.isEnabled(), true);
  assert.equal(recorder.getRecords().length, 0);
  assert.equal(JSON.parse(store.get(recordsKey) || '{}')['advisory action'], undefined);
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

test('dossier citation tab builds GD candidates from the current dossier application', () => {
  const window = loadFeature('src/scripts/app/features/dossier-citation-tab.js', {
    renderOverview() {},
  });
  window.currentData = {
    office: 'US',
    applicationNumber: '16123456',
    raw: 'US16123456',
  };
  const context = window.PatentLensDossierCitation.getContext();
  assert.ok(context);
  assert.equal(context.office, 'US');
  assert.equal(context.appNum, '16123456');
  assert.equal(context.candidates[0].type, 'application');
  assert.equal(context.candidates[0].docNumber, '16123456');
});

test('family member links prefer publication numbers and fall back to office + application number', () => {
  const window = loadFeature('src/scripts/app/features/dossier-family-links.js', {
    renderFamily() {},
  });
  const links = window.PatentLensFamilyLinks;
  assert.ok(links);
  assert.equal(
    links.queryForMember({ countryCode: 'US', appNum: '16123456' }),
    'US16123456'
  );
  assert.equal(
    links.queryForMember({
      countryCode: 'EP',
      appNum: '21123456.7',
      pubList: [{ pubCountry: 'EP', pubNum: '4252965A3' }],
    }),
    'EP4252965A3'
  );
  assert.match(
    links.gdUrlForMember({ countryCode: 'US', appNum: '16123456', publicationNumber: 'US20220301610A1' }),
    /^https:\/\/globaldossier\.uspto\.gov\/#\/result\/publication\/US\/20220301610A1\/\d+$/
  );
});

test('GD citation renderer adds per-column filters and fixed-layout table classes', () => {
  const window = loadFeature('src/scripts/app/features/gd-citation-data.js', { renderPatentDetail() {} });
  const citation = window.PatentLensGdCitationData;

  let html = '';
  const body = {
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; },
    closest() { return null; },
    querySelectorAll() { return []; },
  };

  citation.renderCitationData(body, {
    citationList: [{
      citedDocument: { docCountry: 'US', docNumber: '1234567', docKindCode: 'B2', title: 'Test patent' },
      relevancyText: 'col. 2|c. 103|section 102|lines 48-57)|figure 5)|claim 10|claims 1, 2, 4',
      relevantInfos: [{ category: 'X', claims: '10' }, { category: 'Y', claims: '1, 2' }],
      citedIn: 'US, examiner',
      citedBy: 'EP',
    }],
    nplCitationList: [{ text: 'Test paper', citedIn: 'US', citedBy: 'EP' }],
  });

  assert.match(html, /Publication\/patent number/);
  assert.match(html, /gd-citation-table-patent/);
  assert.match(html, /gd-citation-table-npl/);
  assert.match(html, /gd-citation-filter-row/);
  assert.match(html, /class="gd-citation-filter"/);
  assert.match(html, /US1234567B2/);
  assert.match(html, /gd-tag-figure/);
  assert.match(html, /gd-tag-claim/);
  assert.match(html, /gd-tag-column/);
  assert.match(html, /gd-rel-badge gd-rel-x/);
  assert.match(html, /Claim 10/);
  assert.match(html, />Fig\. 5</);
  assert.match(html, />col\. 2</);
  assert.match(html, />c\. 103</);
  assert.match(html, />§ 102</);
  assert.match(html, />l\. 48-57</);
  assert.doesNotMatch(html, /Fig\. 5\)/);
  assert.doesNotMatch(html, /Relevancy code:/);
});

test('history alt action adds the opposite-mode query button without changing row click', () => {
  let appended = null;
  const restored = [];
  const main = { appendChild(el) { appended = el; } };
  const item = {
    dataset: { patent: 'US12030161B2', type: 'patent' },
    querySelector(selector) {
      if (selector === '.history-item-alt-actions') return null;
      if (selector === '.history-item-main') return main;
      return null;
    },
  };
  const list = {
    classList: { contains: () => false },
    querySelectorAll: () => [item],
  };
  const doc = Object.assign(fakeDocument(), {
    getElementById: (id) => (id === 'history-list' ? list : null),
    createElement: () => {
      const el = {
        className: '',
        textContent: '',
        title: '',
        type: '',
        style: {},
        children: [],
        appendChild(child) { this.children.push(child); },
        addEventListener(name, fn) { if (name === 'click') this.onclick = fn; },
      };
      return el;
    },
  });

  const window = loadFeature('src/scripts/app/features/history-alt-actions.js', {
    document: doc,
    refreshHistoryList: () => 'ok',
    restoreFromHistory: (patentNumber) => restored.push(patentNumber),
  });

  assert.ok(window.PatentLensHistoryAltActions);
  assert.ok(appended);
  const button = appended.children[0];
  assert.equal(button.textContent, '查审查文档');
  button.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(restored, ['US12030161B2']);
});

