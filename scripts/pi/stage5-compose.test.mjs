// Stage 5 (the tool release update) on a Pi whose stack runs as containers (day two, D-149).
//   node --test scripts/pi/stage5-compose.test.mjs
// The whole stage runs in bash, in a sandbox folder, with the real lib.sh and stand-ins for docker, systemctl, git, npm and the
// rest (scripts/pi/container-test/stage5-compose-scenarios.sh): the images are built from the new tree with the .env before the
// swap, a refused or failed build leaves the old checkout and the containers alone, only a changed service is recreated (and
// only on a quiet Pi), and no unit is started, stopped or enabled. No Docker or systemd is needed. The unit side of the stage is
// pinned as text below; the rest of the stage is covered by stage5-load-check.test.mjs and pi-stage-safety.test.mjs.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const stage = readFileSync(join(repo, 'scripts', 'pi', 'remote', '5-tool.sh'), 'utf8');
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;
const posix = p => p.replace(/\\/g, '/');

describe('stage 5 on the container stack', { skip: !hasBash && 'no bash here' }, () => {
  test('the scenarios pass', { timeout: 600000 }, () => {
    const r = spawnSync(
      'bash',
      [posix(join(repo, 'scripts', 'pi', 'container-test', 'stage5-compose-scenarios.sh'))],
      { encoding: 'utf8', env: { ...process.env, REPO: posix(repo) }, timeout: 590000 }
    );
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, out);
    assert.ok(out.includes('ALL SCENARIOS OK'), out);
    assert.doesNotMatch(out, /^FAIL:/m);
  });
});

describe('the stage text', () => {
  test('use_stack replaces the cut-over refusal, right after the snapshot check', () => {
    assert.match(
      stage,
      /^require_root\nrequire_recent_snapshot\nuse_stack "stage 5 \(the tool\)"$/m
    );
    assert.doesNotMatch(stage, /^refuse_when_cut_over/m);
  });

  test('on containers the images are built before the swap and no unit is stopped', () => {
    const prepare = stage.indexOf('containers_prepare_build "$build" "$ref"');
    const swap = stage.indexOf('mv "$app" "$app.prev"');
    assert.ok(prepare > 0 && swap > prepare, 'the build comes after the swap');
    assert.match(
      stage,
      /if \[ "\$STACK" = containers \]; then\n\s+# The images[^\n]*\n\s+containers_prepare_build[^\n]*\n\s+else\n\s+require_quiet "swapping in the new build[^\n]*\n\s+if have_systemd; then\n\s+for unit in [^\n]*\n\s+systemctl stop "\$unit\.service" 2>\/dev\/null \|\| true/
    );
  });

  test('the unit files and enable_unit are skipped on containers, and kept as they were on units', () => {
    assert.match(
      stage,
      /if \[ "\$STACK" != containers \]; then\n\s+write_file \/etc\/systemd\/system\/foundry-ai-tool-bridge\.service 0644 "\$bridge_unit" \|\| true/
    );
    // The unit side: the same commands as before.
    assert.ok(stage.includes('enable_unit foundry-ai-tool-bridge.service "$TOOL_ETC/bridge.env"'));
    assert.ok(stage.includes('systemctl is-active --quiet foundry.service'));
  });

  test('the recreate asks for a quiet Pi, only when something changed, and uses compose up', () => {
    const fn = stage.slice(stage.indexOf('containers_apply() {'));
    assert.ok(
      fn.indexOf('nothing recreated') <
        fn.indexOf('require_quiet "recreating the changed containers"')
    );
    assert.ok(
      fn.indexOf('require_quiet "recreating the changed containers"') <
        fn.indexOf('stack_compose up -d --no-build --wait')
    );
    assert.doesNotMatch(
      fn.slice(0, fn.indexOf('\n}\n')),
      /docker (stop|restart|rm)|compose[^\n]* down/
    );
  });
});
