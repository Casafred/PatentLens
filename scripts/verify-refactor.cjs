const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(full);
    return [full];
  });
}

function checkJavaScriptSyntax() {
  const files = walk(root).filter((file) => file.endsWith('.js') || file.endsWith('.cjs'));
  for (const file of files) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
  return files.length;
}

function localScriptSources(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1].split('?')[0])
    .filter((src) => !/^(?:https?:)?\/\//i.test(src));
}

function checkHtmlShell(file) {
  const html = read(file);
  const scripts = localScriptSources(html);
  assert.equal(new Set(scripts).size, scripts.length, `${file} contains duplicate local script tags`);
  for (const src of scripts) {
    assert.ok(fs.existsSync(path.join(root, 'src', src)), `${file} references missing script: ${src}`);
  }
  const constantsIndex = scripts.indexOf('scripts/app/shared/constants.js');
  const iconsIndex = scripts.indexOf('scripts/app/shared/icons.js');
  const datesIndex = scripts.indexOf('scripts/app/shared/dates.js');
  const appIndex = scripts.indexOf('scripts/web-app.js');
  const extensionIndex = scripts.indexOf('scripts/app/features/browser-extension.js');
  assert.ok(constantsIndex >= 0, `${file} must load the shared constants module`);
  assert.ok(iconsIndex >= 0, `${file} must load the shared icons module`);
  assert.ok(datesIndex >= 0, `${file} must load the shared dates module`);
  assert.ok(appIndex >= 0, `${file} must load web-app.js`);
  assert.ok(extensionIndex >= 0, `${file} must load the browser-extension feature module`);
  assert.ok(constantsIndex < appIndex, `${file} must load constants.js before web-app.js`);
  assert.ok(iconsIndex < appIndex, `${file} must load icons.js before web-app.js`);
  assert.ok(datesIndex < appIndex, `${file} must load dates.js before web-app.js`);
  assert.ok(appIndex < extensionIndex, `${file} must load browser-extension.js after web-app.js`);
  return scripts.length;
}

function checkElectronContract() {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.main, 'electron-main.js');
  assert.match(pkg.scripts.start, /\belectron\b/);
  assert.match(pkg.scripts.dev, /\belectron\b/);
  assert.match(pkg.scripts['build:electron'], /electron-builder/);

  const sourceFilter = pkg.build.files.find((entry) => typeof entry === 'object' && entry.from === 'src');
  assert.ok(sourceFilter, 'electron-builder src file filter is missing');
  assert.ok(sourceFilter.filter.includes('scripts/app/**'), 'electron-builder must package extracted app modules');

  const main = read('electron-main.js');
  const server = read('server.js');
  assert.match(main, /req\.url === "\/" \? "\/web\.html"/);
  assert.match(server, /req\.url === "\/" \? "\/web\.html"/);
  assert.match(read('preload.js'), /exposeInMainWorld\("electronAPI"/);
}

function checkTauriFreeze() {
  for (const args of [['diff', '--quiet', '--', 'src-tauri'], ['diff', '--cached', '--quiet', '--', 'src-tauri']]) {
    try {
      execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    } catch {
      throw new Error('src-tauri is frozen but contains local changes');
    }
  }
  assert.doesNotMatch(read('src/scripts/app/shared/icons.js'), /tauri|__TAURI__/i);
  assert.doesNotMatch(read('src/scripts/app/shared/constants.js'), /tauri|__TAURI__/i);
  assert.doesNotMatch(read('src/scripts/app/shared/dates.js'), /tauri|__TAURI__/i);
  assert.doesNotMatch(read('src/scripts/app/features/browser-extension.js'), /tauri|__TAURI__/i);
}

const jsCount = checkJavaScriptSyntax();
const webScripts = checkHtmlShell('src/web.html');
const indexScripts = checkHtmlShell('src/index.html');
checkElectronContract();
checkTauriFreeze();

console.log(`Refactor verification passed: ${jsCount} JS files, ${webScripts} web scripts, ${indexScripts} index scripts.`);
