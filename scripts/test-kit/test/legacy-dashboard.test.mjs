/**
 * Nothing may use or show the old dashboard page (the user, 2026-10-31): no test, kit run, demo
 * script or guide points at `/legacy/` or at the old page's files (`public/app.js`,
 * `public/index.html`). The page itself stays until after G1 (D-126), so the places that must name
 * it are listed in ALLOWED with the reason. A listed place that stops naming it fails too, so the
 * list shrinks as the old page's last tests go. Runs with `npm run kit:test`, which CI and
 * `npm run green` run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** What names the old page: its address (not part of a longer path) or its files. */
export const OLD_PAGE =
  /(^|[^A-Za-z0-9_.\-/])\/legacy(?![A-Za-z0-9_-]|\.[A-Za-z0-9])|['"`(]legacy\/|public\/app\.js|public\/index\.html/i;

/** Where the rule applies: tests, kit, demo scripts, skills, tools and the docs people read. */
const IN_SCOPE = [
  /^scripts\//,
  /^packages\/cogm-dashboard\/src\/.*\.test\.ts$/,
  /^packages\/cogm-dashboard\/web\/(e2e|visual)\//,
  /^\.claude\/(skills|agents)\//,
  /^tools\//,
  /^docs\/(gm|player|reference|dev|wiki|foundry)\//,
  /^(README|CLAUDE)\.md$/,
  /^packages\/[^/]+\/README\.md$/,
];

/** Never scanned: history, changelogs, binaries and this test's own pattern. */
const SKIPPED = [
  /^docs\/history\//,
  /^CHANGELOG\.md$/,
  /^changelog\.d\//,
  /\.(png|jpe?g|gif|webp|mp4|woff2?|zip|ico|json)$/i,
  /^scripts\/test-kit\/test\/legacy-dashboard\.test\.mjs$/,
];

/**
 * The places that may name the old page, and why. Each is a test of the old page or of the server
 * routes that serve it, or a developer fact; none shows it to a GM or drives it for a check of
 * the current dashboard.
 * @type {Record<string, string>}
 */
export const ALLOWED = {
  'packages/cogm-dashboard/src/default-page.test.ts':
    'server routes: / is React, /legacy/ still answers',
  'packages/cogm-dashboard/src/token-url.test.ts': 'tests the old page script itself',
  'packages/cogm-dashboard/web/e2e/old-page-trial.spec.ts':
    'tests the old page itself; goes with it',
  'packages/cogm-dashboard/web/e2e/default-page.spec.ts':
    'routing: the link and /legacy/ still answer',
  'packages/cogm-dashboard/web/e2e/player-redirect.spec.ts':
    'the player redirect also holds on /legacy/',
  'packages/cogm-dashboard/web/e2e/views.spec.ts':
    'the header link to the old page, until it is removed',
  'packages/cogm-dashboard/README.md':
    'developer facts: the old page still exists and where its files are',
  'docs/dev/ARCHITECTURE.md': 'developer fact: the old page stays at /legacy/ until after G1',
  'scripts/green.test.mjs': 'a path used as a quick-check fixture',
  'scripts/test-kit/lib/dashboard-controls.mjs':
    'pending: the kit sweep still drives the old page (kit port)',
  'scripts/test-kit/lib/dashboard-page.mjs':
    'pending: the kit sweep still drives the old page (kit port)',
  'scripts/test-kit/scenarios/dashboard-controls.scenario.mjs': 'pending: kit port',
  'scripts/test-kit/scenarios/dashboard-login-split.scenario.mjs': 'pending: kit port',
  'scripts/test-kit/scenarios/dashboard-write-flows.scenario.mjs': 'pending: kit port',
};

/** Tracked files in scope, as repo-relative paths with forward slashes. */
export function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return out
    .toString('utf8')
    .split('\0')
    .filter(f => f && IN_SCOPE.some(re => re.test(f)) && !SKIPPED.some(re => re.test(f)));
}

/** Files in scope that name the old page. @param {string[]} files */
export function offenders(files) {
  return files.filter(f => {
    try {
      return OLD_PAGE.test(readFileSync(path.join(root, f), 'utf8'));
    } catch {
      return false;
    }
  });
}

test('the pattern finds the old page and nothing longer', () => {
  assert.ok(OLD_PAGE.test('page.goto("/legacy/?token=x")'));
  assert.ok(OLD_PAGE.test('the old page at /legacy'));
  assert.ok(OLD_PAGE.test('reads packages/cogm-dashboard/public/app.js'));
  assert.ok(!OLD_PAGE.test('the legacy (2014) rules'));
  assert.ok(!OLD_PAGE.test('legacyHeaders: false'));
  assert.ok(!OLD_PAGE.test('docs/legacy/x.md'));
  assert.ok(!OLD_PAGE.test('GET /legacy-import and /legacy.html'));
  assert.ok(OLD_PAGE.test("page.goto('legacy/')"));
  assert.ok(OLD_PAGE.test('open /Legacy/ in the browser'));
});

test('no test, kit run, demo or guide names the old dashboard page', () => {
  const found = offenders(trackedFiles()).filter(f => !(f in ALLOWED));
  assert.deepEqual(
    found,
    [],
    'These files name /legacy/ or the old page files. Move them to the dashboard at / ' +
      '(see Reviews/Legacy dashboard audit 2026-10-31 in the vault), or add them to ALLOWED with a reason ' +
      'if they test the old page or its routes on purpose.'
  );
});

test('every allowed place still names the old page (the list only shrinks)', () => {
  const found = new Set(offenders(trackedFiles()));
  const stale = Object.keys(ALLOWED).filter(f => !found.has(f));
  assert.deepEqual(stale, [], 'These no longer name the old page: remove them from ALLOWED.');
});
