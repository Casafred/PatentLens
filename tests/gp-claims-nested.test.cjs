// 特征测试：Google Patents 权利要求解析
// 背景：新版 GP HTML 将续行嵌套在父 div.claim-text 内部（首行为父级直接文本，续行为子 div），
// extractClaimTextDivs 曾把父、子各提取一次导致同一段文段重复（如 US20160359151A1 claim 1）。
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { extractPatentFromHtml } = require(path.join(__dirname, '..', 'patent-parser.js'));

const CLAIM1_HEAD = '1. A battery pack connectable to and supportable by a power tool, the battery pack comprising:';
const CLAIM1_TAIL = 'a housing that includes a support portion operable to interface the battery pack with the power tool, the support portion including a support member operable to reinforce the support portion, the support member made of a different material than the housing.';
const CLAIM2_TEXT = '2. The battery pack of claim 1, wherein the support member is made of a metal.';

function page(claimsHtml) {
  return `<html><head><title>Battery pack</title></head><body>
<h1>US20160359151A1 - Battery pack</h1>
<section itemprop="abstract"><div class="abstract">A battery pack.</div></section>
${claimsHtml}
</body></html>`;
}

// 新版 GP：续行嵌套在父 claim-text 内部
const nestedClaims = `
<section itemprop="claims">
<div class="claims">
<div class="claim" id="CLM-00001" num="1">
<div class="claim-text">${CLAIM1_HEAD}
<div class="claim-text">${CLAIM1_TAIL}</div>
</div>
</div>
<div class="claim" id="CLM-00002" num="2">
<div class="claim-text">${CLAIM2_TEXT}</div>
</div>
</div>
</section>`;

// 旧版 GP：续行与首行平铺为兄弟 claim-text
const siblingClaims = `
<section itemprop="claims">
<div class="claims">
<div class="claim" id="CLM-00001" num="1">
<div class="claim-text">${CLAIM1_HEAD}</div>
<div class="claim-text">${CLAIM1_TAIL}</div>
</div>
<div class="claim" id="CLM-00002" num="2">
<div class="claim-text">${CLAIM2_TEXT}</div>
</div>
</div>
</section>`;

// 深层嵌套：两个续行逐级嵌套
const deepNestedClaims = `
<section itemprop="claims">
<div class="claims">
<div class="claim" id="CLM-00001" num="1">
<div class="claim-text">${CLAIM1_HEAD}
<div class="claim-text">${CLAIM1_TAIL}
<div class="claim-text">wherein the metal is steel.</div>
</div>
</div>
</div>
</div>
</section>`;

test('nested claim-text continuation lines are extracted exactly once (US20160359151A1 regression)', () => {
  const data = extractPatentFromHtml(page(nestedClaims), 'US20160359151A1');
  assert.equal(data.claims.length, 2, 'should find both claims');
  const claim1 = data.claims.find((c) => String(c.num) === '1');
  assert.ok(claim1, 'claim 1 should exist');
  assert.equal(
    claim1.text,
    `${CLAIM1_HEAD} ${CLAIM1_TAIL}`,
    'claim 1 text must be head + tail with no duplicated segment'
  );
  const occurrences = claim1.text.split(CLAIM1_TAIL).length - 1;
  assert.equal(occurrences, 1, 'continuation segment must appear exactly once');
});

test('nested format keeps single-line claims and dependency detection intact', () => {
  const data = extractPatentFromHtml(page(nestedClaims), 'US20160359151A1');
  const claim2 = data.claims.find((c) => String(c.num) === '2');
  assert.ok(claim2, 'claim 2 should exist');
  assert.equal(claim2.text, CLAIM2_TEXT);
  assert.equal(claim2.type, 'dependent', 'claim 2 references claim 1');
});

test('legacy sibling claim-text layout still merges continuation lines', () => {
  const data = extractPatentFromHtml(page(siblingClaims), 'US20160359151A1');
  const claim1 = data.claims.find((c) => String(c.num) === '1');
  assert.ok(claim1, 'claim 1 should exist');
  assert.equal(claim1.text, `${CLAIM1_HEAD} ${CLAIM1_TAIL}`);
});

test('deeply nested claim-text continuations are extracted exactly once', () => {
  const data = extractPatentFromHtml(page(deepNestedClaims), 'US20160359151A1');
  const claim1 = data.claims.find((c) => String(c.num) === '1');
  assert.ok(claim1, 'claim 1 should exist');
  assert.equal(
    claim1.text,
    `${CLAIM1_HEAD} ${CLAIM1_TAIL} wherein the metal is steel.`,
    'all continuation lines must appear exactly once, in order'
  );
});
