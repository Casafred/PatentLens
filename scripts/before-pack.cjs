const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function beforePack(context) {
  const root = path.resolve(__dirname, '..');
  const npmCli = process.env.npm_execpath;
  if (npmCli && /npm-cli\.js$/.test(npmCli)) {
    execFileSync(process.execPath, [npmCli, 'run', 'build:patent2pic'], { cwd: root, stdio: 'inherit' });
  } else {
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:patent2pic'], {
      cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
    });
  }

  // 本地 OCR 的原生运行时是按平台拆分的 optionalDependency。若安装时被
  // --omit=optional 跳过，打包出的应用会在运行时缺少平台包；这里在打包前
  // 补装一次，避免发布一个“功能可见但一点就报错”的安装包。
  if (context && context.electronPlatformName === 'win32') {
    const nativePkg = path.join(root, 'node_modules', '@arcships', 'light-ocr-win32-x64', 'package.json');
    if (!fs.existsSync(nativePkg)) {
      console.log('[Local OCR] Windows native package missing; installing @arcships/light-ocr-win32-x64@0.4.0');
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      execFileSync(npm, [
        'install', '--no-save', '--package-lock=false', '--ignore-scripts', '--force',
        '@arcships/light-ocr-win32-x64@0.4.0',
      ], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    }
    if (!fs.existsSync(nativePkg)) {
      throw new Error('缺少 @arcships/light-ocr-win32-x64，无法打包可用的本地 OCR');
    }
  }
};
