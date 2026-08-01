const { execFileSync } = require('node:child_process');

const target = 'src/scripts/web-app.js';

function runGitDiff(args) {
  return execFileSync('git', ['diff', '--unified=0', ...args, '--', target], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function getMode() {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf('--base');
  if (baseIndex >= 0) {
    const base = args[baseIndex + 1];
    if (!base || base.startsWith('-')) throw new Error('--base requires a commit SHA');
    return { label: `base ${base}`, diffArgs: [base] };
  }
  if (args.includes('--working-tree')) return { label: 'working tree vs HEAD', diffArgs: ['HEAD'] };

  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventName === 'pull_request' && process.env.GITHUB_EVENT_BASE_SHA) {
    return { label: `pull request base ${process.env.GITHUB_EVENT_BASE_SHA}`, diffArgs: [process.env.GITHUB_EVENT_BASE_SHA] };
  }
  if (eventName === 'push' && process.env.GITHUB_EVENT_BEFORE && !/^0+$/.test(process.env.GITHUB_EVENT_BEFORE)) {
    return { label: `push base ${process.env.GITHUB_EVENT_BEFORE}`, diffArgs: [process.env.GITHUB_EVENT_BEFORE] };
  }
  return { label: 'working tree vs HEAD', diffArgs: ['HEAD'] };
}

function main() {
  const mode = getMode();
  let diff;
  try {
    diff = runGitDiff(mode.diffArgs);
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr) : '';
    throw new Error(`Cannot inspect ${target} against ${mode.label}. Ensure the comparison commit is available.\n${stderr}`.trim());
  }

  const additions = diff
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'));

  if (additions.length > 0) {
    const preview = additions.slice(0, 12).map((line) => `  ${line}`).join('\n');
    throw new Error([
      `${target} is frozen against new code additions (${mode.label}).`,
      'New features and fixes must be added under src/scripts/app/** and loaded through the HTML shell.',
      'Only deletions are allowed in web-app.js while the legacy file is being dismantled.',
      'If an existing feature needs a fix: first extract its complete implementation to src/scripts/app/**, add a characterization test, delete the legacy implementation, then apply the fix in the new module.',
      'Do not retry by adding glue code back to web-app.js; place that glue in a feature or platform facade and load it from the HTML shell.',
      `Detected ${additions.length} added line(s):`,
      preview,
      additions.length > 12 ? '  ...' : '',
    ].filter(Boolean).join('\n'));
  }

  console.log(`web-app.js freeze check passed (${mode.label}); no added lines detected.`);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
