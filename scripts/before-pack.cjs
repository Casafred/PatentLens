const { execFileSync } = require('node:child_process');
const path = require('node:path');
module.exports = async function beforePack() {
  const root = path.resolve(__dirname, '..');
  const npmCli = process.env.npm_execpath;
  if (npmCli && /npm-cli\.js$/.test(npmCli)) {
    execFileSync(process.execPath, [npmCli, 'run', 'build:patent2pic'], { cwd: root, stdio: 'inherit' });
  } else {
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:patent2pic'], {
      cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
    });
  }
};
