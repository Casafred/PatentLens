const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Minimal localStorage mock backed by a plain object, matching the subset of
// the Web Storage API the favorites store relies on (getItem/setItem).
function makeLocalStorage() {
  const store = Object.create(null);
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    _dump() { return store; },
  };
}

function loadFavoritesStore() {
  const file = path.resolve(__dirname, '../src/scripts/app/features/favorites-store.js');
  const storage = makeLocalStorage();
  const window = { localStorage: storage };
  // The store resolves storage via the bare `localStorage` global first, then
  // `window.localStorage`. Provide both so the store persists across calls.
  const context = vm.createContext({
    window,
    localStorage: storage,
    Date,
    Math,
    JSON,
    Object,
    console,
  });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return { window, storage };
}

test('add persists a favorite and snapshot is sorted pinned-first then by recency', () => {
  const { window, storage } = loadFavoritesStore();
  const F = window.PatentFavorites;
  assert.equal(F.getSnapshot().length, 0);

  const a = F.add({ patentNumber: 'US1', type: 'dossier', title: 'A' });
  const b = F.add({ patentNumber: 'US2', type: 'dossier', title: 'B' });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);

  // Pin the older one; it must rise to the top regardless of creation order.
  F.update(a.favorite.id, { pinned: true });

  const snap = F.getSnapshot();
  assert.equal(snap.length, 2);
  assert.equal(snap[0].patentNumber, 'US1');
  assert.equal(snap[0].pinned, true);
  assert.equal(snap[1].patentNumber, 'US2');

  // Persisted to localStorage under the dedicated key.
  const raw = JSON.parse(storage.getItem('patentlens-favorites'));
  assert.equal(Array.isArray(raw), true);
  assert.equal(raw.length, 2);
});

test('add rejects duplicates (same patentNumber + type) and returns the existing entry', () => {
  const { window } = loadFavoritesStore();
  const F = window.PatentFavorites;
  F.add({ patentNumber: 'US1', type: 'patent', title: 'First' });
  const dup = F.add({ patentNumber: 'US1', type: 'patent', title: 'Second' });
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'duplicate');
  assert.equal(dup.favorite.title, 'First');

  // Same patent number but a different type is allowed (dossier vs patent).
  const other = F.add({ patentNumber: 'US1', type: 'dossier', title: 'Dossier view' });
  assert.equal(other.ok, true);
  assert.equal(F.getSnapshot().length, 2);
});

test('toggle adds then removes a favorite, keeping snapshot isolated from the store', () => {
  const { window } = loadFavoritesStore();
  const F = window.PatentFavorites;
  assert.equal(F.isFavorited('US1', 'dossier'), false);

  const on = F.toggle('US1', 'dossier', { title: 'Hello', applicantName: 'Acme' });
  assert.equal(on.favorited, true);
  assert.equal(on.favorite.patentNumber, 'US1');
  assert.equal(F.isFavorited('US1', 'dossier'), true);

  // Mutating the returned snapshot must not write back into the store.
  const snap = F.getSnapshot();
  snap[0].title = 'Tampered';
  assert.equal(F.getSnapshot()[0].title, 'Hello');

  const off = F.toggle('US1', 'dossier');
  assert.equal(off.favorited, false);
  assert.equal(F.isFavorited('US1', 'dossier'), false);
  assert.equal(F.getSnapshot().length, 0);
});

test('update mutates note/folder/pinned while preserving id and createdAt', () => {
  const { window } = loadFavoritesStore();
  const F = window.PatentFavorites;
  const added = F.add({ patentNumber: 'US1', type: 'patent', title: 'T' });
  const id = added.favorite.id;
  const created = added.favorite.createdAt;

  const res = F.update(id, { note: '重点对比', folder: '诉讼', pinned: true });
  assert.equal(res.ok, true);
  assert.equal(res.favorite.note, '重点对比');
  assert.equal(res.favorite.folder, '诉讼');
  assert.equal(res.favorite.pinned, true);
  assert.equal(res.favorite.id, id);
  assert.equal(res.favorite.createdAt, created);
  assert.equal(res.favorite.updatedAt >= created, true);

  // Unknown id is a no-op.
  assert.equal(F.update('missing', { note: 'x' }).ok, false);
});

test('remove deletes only the targeted favorite', () => {
  const { window } = loadFavoritesStore();
  const F = window.PatentFavorites;
  F.add({ patentNumber: 'US1', type: 'dossier' });
  const b = F.add({ patentNumber: 'US2', type: 'dossier' });
  assert.equal(F.getSnapshot().length, 2);

  assert.equal(F.remove(b.favorite.id), true);
  assert.equal(F.remove(b.favorite.id), false); // already gone
  const snap = F.getSnapshot();
  assert.equal(snap.length, 1);
  assert.equal(snap[0].patentNumber, 'US1');
});

test('getFolders returns unique folder names and defaults to 默认收藏', () => {
  const { window } = loadFavoritesStore();
  const F = window.PatentFavorites;
  F.add({ patentNumber: 'US1', type: 'dossier' }); // default folder
  F.add({ patentNumber: 'US2', type: 'dossier', folder: '诉讼' });
  F.add({ patentNumber: 'US3', type: 'dossier', folder: '诉讼' });
  const folders = F.getFolders();
  // Compare by length + elements (not deepEqual) because the array is created
  // inside the vm context and lives in a different realm than this test.
  assert.equal(folders.length, 2);
  assert.equal(folders[0], '诉讼');
  assert.equal(folders[1], '默认收藏');
});

test('normalize sanitizes untrusted input and rejects empty patent numbers', () => {
  const { window } = loadFavoritesStore();
  const F = window.PatentFavorites;
  // Empty/whitespace patent number is invalid.
  assert.equal(F.add({ patentNumber: '   ', type: 'dossier' }).ok, false);
  // Non-patent type falls back to dossier; source only set for patent type.
  const fav = F.add({ patentNumber: 'US1', type: 'weird', source: 'jplatpat', note: 'x'.repeat(2000) });
  assert.equal(fav.ok, true);
  assert.equal(fav.favorite.type, 'dossier');
  assert.equal(fav.favorite.source, '');
  assert.ok(fav.favorite.note.length <= 1000, 'note is truncated to the max length');
  // HTML-sensitive characters are preserved literally in storage (escaping is the UI's job).
  assert.equal(fav.favorite.title, '');
});

test('onChange listeners fire on add/update/remove and can unsubscribe', () => {
  const { window } = loadFavoritesStore();
  const F = window.PatentFavorites;
  let calls = 0;
  const off = F.onChange(() => { calls += 1; });
  F.add({ patentNumber: 'US1', type: 'dossier' });
  F.update(F.getSnapshot()[0].id, { note: 'n' });
  F.remove(F.getSnapshot()[0].id);
  assert.ok(calls >= 3, 'listener fired for each mutation');
  off();
  F.add({ patentNumber: 'US2', type: 'dossier' });
  const callsAfterUnsubscribe = calls;
  F.toggle('US2', 'dossier');
  assert.equal(calls, callsAfterUnsubscribe, 'unsubscribed listener no longer fires');
});

test('favorites persist across a fresh store instance (localStorage rehydration)', () => {
  const { window, storage } = loadFavoritesStore();
  window.PatentFavorites.add({ patentNumber: 'US1', type: 'dossier', title: 'Saved' });

  // Reload the store module against the SAME storage to simulate a new session.
  const file = path.resolve(__dirname, '../src/scripts/app/features/favorites-store.js');
  const window2 = { localStorage: storage };
  const context2 = vm.createContext({ window: window2, localStorage: storage, Date, Math, JSON, Object, console });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context2, { filename: file });
  const F2 = window2.PatentFavorites;
  const snap = F2.getSnapshot();
  assert.equal(snap.length, 1);
  assert.equal(snap[0].patentNumber, 'US1');
  assert.equal(snap[0].title, 'Saved');
});
