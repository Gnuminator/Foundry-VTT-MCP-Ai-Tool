// Runs the screenshot tests (web/visual, UI-01) inside the Playwright Docker image, because the
// baselines are Linux-only: fonts and anti-aliasing differ per OS, so a Windows or macOS run would
// differ from the committed PNGs and from CI.
//
//   npm run test:visual -w @gnuminator/cogm-dashboard           check the baselines
//   npm run test:visual:update -w @gnuminator/cogm-dashboard    make new baselines
//   npm run test:visual -w @gnuminator/cogm-dashboard -- -g "party"   extra arguments go to Playwright
//
// The image tag is the installed @playwright/test version (the image carries the browsers that
// version expects), so a Playwright bump needs no edit here. Needs Docker and a built dashboard
// (`npm run build -w @gnuminator/cogm-dashboard`): the container serves dist/ from the repo.
//
// How the container sees the repo: the repo is mounted at /work, but node_modules is not the host's
// (Windows has junctions and platform files there). The root node_modules and the dashboard's own
// are named Docker volumes, filled by `npm ci --ignore-scripts` for the dashboard workspace the
// first time and again whenever package-lock.json changes. Snapshots and results are written
// straight into the repo through the mount.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageDir, '..', '..');

const { version } = createRequire(import.meta.url)('@playwright/test/package.json');
const image = `mcr.microsoft.com/playwright:v${version}-noble`;

const args = process.argv.slice(2);
const update = args.includes('--update');
const extra = args.filter(a => a !== '--update');

if (!existsSync(path.join(packageDir, 'dist', 'web', 'index.html'))) {
  console.error('dist/ is not built. Run: npm run build -w @gnuminator/cogm-dashboard');
  process.exit(2);
}

// Runs in the container, from the repo root.
const inContainer = `
set -e
want=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ "$(cat node_modules/.visual-lock 2>/dev/null)" != "$want" ]; then
  echo "Installing the dashboard's dependencies into the container volumes (once per lockfile)..."
  npm ci --ignore-scripts --no-audit --no-fund -w @gnuminator/cogm-dashboard
  echo "$want" > node_modules/.visual-lock
fi
cd packages/cogm-dashboard
exec npx playwright test -c web/playwright.visual.config.ts "$@"
`;

const dockerArgs = [
  'run',
  '--rm',
  '--init',
  '--ipc=host',
  '-v',
  `${repoRoot}:/work`,
  '-v',
  'foundry-ai-tool-visual-node-modules:/work/node_modules',
  '-v',
  'foundry-ai-tool-visual-dashboard-node-modules:/work/packages/cogm-dashboard/node_modules',
  '-w',
  '/work',
  image,
  'sh',
  '-c',
  inContainer,
  'visual',
  ...(update ? ['--update-snapshots'] : []),
  ...extra,
];

console.log(`Playwright ${version} in ${image}${update ? ' (updating baselines)' : ''}`);
const result = spawnSync('docker', dockerArgs, { stdio: 'inherit' });
if (result.error) {
  console.error(`Could not run docker: ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 1);
