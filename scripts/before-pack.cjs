const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOCAL_OCR_NATIVE_VERSION = '0.4.0';
const LOCAL_OCR_NATIVE_NAME = '@arcships/light-ocr-win32-x64';

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function extractNativePackage(root, destination) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-ocr-native-'));
  try {
    // npm pack 会走当前 registry / proxy 配置，且不会像 npm install 那样
    // 因为 optional dependency 或平台检查而静默跳过。
    execFileSync(npmCommand(), [
      'pack', LOCAL_OCR_NATIVE_NAME + '@' + LOCAL_OCR_NATIVE_VERSION,
      '--pack-destination', tempDir, '--ignore-scripts',
    ], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

    const tarball = fs.readdirSync(tempDir).find((name) => name.endsWith('.tgz'));
    if (!tarball) throw new Error('npm pack 未生成 ' + LOCAL_OCR_NATIVE_NAME + ' 压缩包');

    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(destination, { recursive: true });
    const tar = require('tar');
    await tar.x({ file: path.join(tempDir, tarball), cwd: destination, strip: 1 });
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function ensureWindowsNativePackage(root) {
  const nativeDir = path.join(root, 'node_modules', '@arcships', 'light-ocr-win32-x64');
  const manifest = path.join(nativeDir, 'package.json');
  if (fs.existsSync(manifest)) return;

  // 直接 npm pack 平台包再解压。相比 npm install，它不受 optional
  // dependency 策略影响，也不会在 postinstall 中嵌套执行 npm install。
  console.log('[Local OCR] installing native package via npm pack');
  await extractNativePackage(root, nativeDir);

  if (!fs.existsSync(manifest)) {
    throw new Error('缺少 ' + LOCAL_OCR_NATIVE_NAME + '，无法打包可用的本地 OCR');
  }
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (pkg.name !== LOCAL_OCR_NATIVE_NAME || pkg.version !== LOCAL_OCR_NATIVE_VERSION) {
    throw new Error('本地 OCR 原生包版本不匹配：' + pkg.name + '@' + pkg.version);
  }
}

module.exports = async function beforePack(context) {
  const root = path.resolve(__dirname, '..');
  const npmCli = process.env.npm_execpath;
  if (npmCli && /npm-cli\.js$/.test(npmCli)) {
    execFileSync(process.execPath, [npmCli, 'run', 'build:patent2pic'], { cwd: root, stdio: 'inherit' });
  } else {
    execFileSync(npmCommand(), ['run', 'build:patent2pic'], {
      cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
    });
  }

  // 本地 OCR 的语言数据从 devDependencies 复制到 assets，供回退引擎离线使用。
  require('./prepare-local-ocr-assets.cjs').main();

  // 本地 OCR 的原生运行时按平台拆分。打包 Windows 版时必须确保平台包存在，
  // 否则安装包会出现“按钮可见、一点就报无法定位原生包”。
  if (context && context.electronPlatformName === 'win32') {
    await ensureWindowsNativePackage(root);
  }
};

module.exports.ensureWindowsNativePackage = ensureWindowsNativePackage;
module.exports.extractNativePackage = extractNativePackage;
