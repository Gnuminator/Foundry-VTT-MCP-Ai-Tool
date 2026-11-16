// The shared pieces of the Pi container tests (scripts/pi/container-test/): one library for pass/fail/the guard and
// one prebuilt image, so no scenario script carries its own copy and none installs packages at the start of a run.
//   node --test scripts/pi/container-lib.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DOCKERFILE, REGISTRY_IMAGE, imageTag } from './container-test/run-stage-container.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'container-test');
// The exact, fail-closed source line: a script run without its folder (copied alone, fed on stdin) must refuse.
const SOURCE_LINE =
  '. "$(dirname "${BASH_SOURCE[0]:-/nonexistent}")/lib.sh" || { echo "REFUSED: container-test/lib.sh not found"; exit 98; }';

const scenarios = readdirSync(dir).filter(n => n.endsWith('-scenarios.sh'));
const code = name =>
  readFileSync(path.join(dir, name), 'utf8')
    .split('\n')
    .filter(l => !/^\s*#/.test(l))
    .join('\n');

describe('scenario scripts use container-test/lib.sh', () => {
  test('there are scenario scripts to check', () => {
    assert.ok(scenarios.length >= 20, `found only ${scenarios.length}`);
  });

  for (const name of scenarios) {
    test(`${name} sources lib.sh and defines no pass() or fail() of its own`, () => {
      const text = readFileSync(path.join(dir, name), 'utf8');
      const lines = text.split('\n');
      const at = lines.indexOf('set -uo pipefail');
      assert.ok(at >= 0, `${name} has no "set -uo pipefail" line`);
      assert.equal(
        lines[at + 1],
        SOURCE_LINE,
        `${name} must source lib.sh (the fail-closed line) right after set -uo pipefail`
      );
      if (/^require_test_container$/m.test(text)) {
        assert.equal(
          lines[at + 2],
          'require_test_container',
          `${name}: the guard comes right after the source`
        );
      }
      assert.doesNotMatch(
        code(name),
        /^\s*(pass|fail)\s*\(\)/m,
        `${name} defines its own pass/fail`
      );
      assert.doesNotMatch(code(name), /^\s*apt_setup\s*\(\)/m, `${name} installs packages itself`);
      assert.doesNotMatch(
        code(name),
        /^\s*(\{\s*)?(\w+=\S+\s+)*apt(-get)? (update|install)/m,
        `${name} runs apt at the start: put the package in container-test/Dockerfile`
      );
    });
  }

  test('lib.sh holds pass, fail, the counter and the container guard', () => {
    const lib = readFileSync(path.join(dir, 'lib.sh'), 'utf8');
    assert.match(lib, /^pass\(\) \{/m);
    assert.match(lib, /^fail\(\) \{.*fails=\$\(\(fails \+ 1\)\)/m);
    assert.match(lib, /^fails=0$/m);
    assert.match(lib, /^require_test_container\(\) \{/m);
    assert.match(lib, /REFUSED: run this only in the test container/);
  });

  test('a scenario script that wipes things calls require_test_container', () => {
    for (const name of scenarios) {
      const text = readFileSync(path.join(dir, name), 'utf8');
      const wipes = /\buseradd\b|rm -rf "\$\{(FOUNDRY_DATA|TOOL_DIR)/.test(code(name));
      if (wipes)
        assert.match(text, /^require_test_container$/m, `${name} wipes folders or adds users`);
    }
  });
});

describe('the container tests share one image', () => {
  test('no test file carries its own docker run or Debian image', () => {
    for (const name of readdirSync(here).filter(
      n => n.endsWith('.test.mjs') && n !== 'container-lib.test.mjs'
    )) {
      const text = readFileSync(path.join(here, name), 'utf8');
      assert.doesNotMatch(text, /debian:13/, `${name} names a Debian image: use runStageContainer`);
      assert.doesNotMatch(
        text,
        /'--platform'/,
        `${name} builds its own docker run: use runStageContainer`
      );
    }
  });

  test('the Dockerfile pins the base image by digest and has the packages the scenarios need', () => {
    const file = readFileSync(DOCKERFILE, 'utf8');
    assert.match(file, /^FROM debian:13@sha256:[0-9a-f]{64}$/m);
    for (const pkg of [
      'nodejs',
      'curl',
      'ca-certificates',
      'tar',
      'zip',
      'unzip',
      'syncthing',
      'tzdata',
      'procps',
      'openssh-server',
    ]) {
      assert.match(file, new RegExp(`\\b${pkg}\\b`), `${pkg} missing from the image`);
    }
  });

  test('the image tag follows the Dockerfile content', () => {
    assert.match(imageTag(), /^[0-9a-f]{12}$/);
  });

  test('the publish job names the same image and computes the same tag as the helper', () => {
    const wf = readFileSync(
      path.join(here, '..', '..', '.github', 'workflows', 'pi-images.yml'),
      'utf8'
    );
    assert.ok(
      wf.includes(`${REGISTRY_IMAGE}:$tag`),
      'pi-images.yml names another image than REGISTRY_IMAGE'
    );
    assert.match(wf, /sha256sum scripts\/pi\/container-test\/Dockerfile \| cut -c1-12/);
    assert.match(wf, /github\.ref == 'refs\/heads\/main'/, 'only main may publish the image');
  });
});

describe('a scenario script without its folder refuses', () => {
  test('fed on stdin it exits 98 and writes nothing', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'scenario-stdin-'));
    try {
      const full = readFileSync(path.join(dir, 'stage32-scenarios.sh'), 'utf8');
      // Only the lines up to the guard, then a marker: the destructive body never reaches host bash.
      const script = `${full.split(/^require_test_container$/m)[0]}require_test_container\necho REACHED\n`;
      const r = spawnSync('bash', ['-s'], { input: script, cwd, encoding: 'utf8' });
      assert.equal(r.status, 98, r.stdout + r.stderr);
      assert.match(r.stdout, /REFUSED: container-test\/lib\.sh not found/);
      assert.doesNotMatch(r.stdout, /REACHED/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
