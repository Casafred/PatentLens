const { readdirSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testDir = path.resolve(__dirname, '..', 'tests');
const testFiles = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.cjs'))
  .sort()
  .map((name) => path.join(testDir, name));

if (testFiles.length === 0) {
  console.error(`No test files found in ${testDir}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], { stdio: 'inherit' });
process.exit(result.status ?? 1);
