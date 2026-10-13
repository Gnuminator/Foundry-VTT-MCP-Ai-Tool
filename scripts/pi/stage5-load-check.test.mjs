// Stage 5's check that the pruned build loads before any service stops (#310 review M1, optional extra).
//   node --test scripts/pi/stage5-load-check.test.mjs
// check_build_loads is cut out of scripts/pi/remote/5-tool.sh and run in bash on small fake build trees (a missing
// runtime package must fail it) and on this repository's own build (the module list must be real and must not start
// anything). A last test pins the order in the stage: the check comes before the first `systemctl stop`.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const stage = readFileSync(join(repo, 'scripts', 'pi', 'remote', '5-tool.sh'), 'utf8');
const start = stage.indexOf('check_build_loads() {');
const end = stage.indexOf('\n}\n', start);
assert.ok(start > 0 && end > start, '5-tool.sh has no check_build_loads function');
const fn = stage.slice(start, end + 3);
const posix = p => p.replace(/\\/g, '/');

const roots = [];
after(() => roots.forEach(d => rmSync(d, { recursive: true, force: true })));

/** Runs the function on `tree` (a folder); returns { status, out }. */
function check(tree) {
  const script = ['set -euo pipefail', fn, `check_build_loads "${posix(tree)}"`].join('\n');
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/** A fake build: every module the check names, each importing the packages in `imports[file]`. */
function fakeBuild(imports = {}) {
  const root = mkdtempSync(join(tmpdir(), 'stage5-load-'));
  roots.push(root);
  const files = [
    ...[
      'config.js',
      'logger.js',
      'foundry-connector.js',
      'handouts/strip-secrets.js',
      'prompts/register.js',
    ].map(f => `packages/mcp-server/dist/${f}`),
    'packages/cogm-dashboard/dist/app.js',
    'shared/dist/index.js',
  ];
  for (const f of files) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    const body = (imports[f] ?? []).map(p => `import ${JSON.stringify(p)};`).join('\n');
    writeFileSync(join(root, f), `${body}\nexport const loaded = true;\n`);
  }
  return root;
}

/** Puts an installed package `name` into the tree's node_modules. */
function install(root, name) {
  const d = join(root, 'node_modules', name);
  mkdirSync(d, { recursive: true });
  writeFileSync(
    join(d, 'package.json'),
    JSON.stringify({ name, type: 'module', main: 'index.js' })
  );
  writeFileSync(join(d, 'index.js'), 'export default 1;\n');
}

describe('check_build_loads on fake builds', () => {
  test('a build whose imports are all installed loads', () => {
    const root = fakeBuild({ 'packages/mcp-server/dist/foundry-connector.js': ['ws'] });
    install(root, 'ws');
    const r = check(root);
    assert.equal(r.status, 0, r.out);
  });

  test('a missing runtime package fails and names the package and the file', () => {
    const root = fakeBuild({
      'packages/mcp-server/dist/foundry-connector.js': ['ws'],
      'packages/cogm-dashboard/dist/app.js': ['express'],
    });
    install(root, 'ws'); // express was pruned away
    const r = check(root);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /dashboard: packages\/cogm-dashboard\/dist\/app\.js: .*express/);
    assert.doesNotMatch(r.out, /bridge:/);
  });

  test('every failing package is listed, not only the first', () => {
    const root = fakeBuild({
      'packages/mcp-server/dist/logger.js': ['winston'],
      'shared/dist/index.js': ['zod'],
    });
    const r = check(root);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /bridge: packages\/mcp-server\/dist\/logger\.js: .*winston/);
    assert.match(r.out, /shared: shared\/dist\/index\.js: .*zod/);
  });

  test('a module an older ref does not have is skipped while the package still has one to load', () => {
    const root = fakeBuild();
    rmSync(join(root, 'packages/mcp-server/dist/handouts'), { recursive: true });
    assert.equal(check(root).status, 0);
  });

  test('a package with nothing to load fails (a build without its dist)', () => {
    const root = fakeBuild();
    rmSync(join(root, 'packages/cogm-dashboard/dist'), { recursive: true });
    const r = check(root);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /dashboard: none of /);
  });

  test('a module that throws on import fails', () => {
    const root = fakeBuild();
    writeFileSync(join(root, 'shared/dist/index.js'), 'throw new Error("boom");\n');
    const r = check(root);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /shared: .*boom/);
  });
});

describe('check_build_loads on this repository', () => {
  const built =
    existsSync(join(repo, 'packages/cogm-dashboard/dist/app.js')) &&
    existsSync(join(repo, 'shared/dist/index.js'));
  test(
    'the real build loads and starts nothing',
    { skip: !built && 'the repository is not built' },
    () => {
      const r = check(repo);
      assert.equal(r.status, 0, r.out);
      assert.equal(r.out.trim(), '', 'importing the modules printed something');
    }
  );
});

describe('the stage', () => {
  test('the check runs after the prune and before any service stops', () => {
    const call = stage.indexOf('check_build_loads "$build"');
    const prune = stage.indexOf('npm prune --omit=dev');
    const stop = stage.indexOf('systemctl stop "$unit.service"');
    assert.ok(prune > 0 && call > prune, 'the check is not after the prune');
    assert.ok(stop > call, 'the check is not before the services stop');
    assert.ok(stage.indexOf('mv "$app" "$app.prev"') > call);
  });

  test('a failed check stops the stage with a message that nothing was stopped', () => {
    assert.match(
      stage,
      /loads_out="\$\(check_build_loads "\$build" 2>&1\)" \|\|\s+die "[^"]*nothing was stopped/
    );
  });
});
