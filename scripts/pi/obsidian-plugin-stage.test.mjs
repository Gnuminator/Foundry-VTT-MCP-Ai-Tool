// Pi stage 33, the Obsidian plugin through the GM vault (scripts/pi/remote/33-obsidian-plugin.sh, backlog
// obsidian-plugin-via-vault):
//   node --test scripts/pi/obsidian-plugin-stage.test.mjs
// The text checks always run; PI_STAGE33_CONTAINER=1 (needs Docker) runs two real Syncthings in a Debian 13 ARM64 container.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runStageContainer } from './container-test/run-stage-container.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(path.join(repo, p), 'utf8');
const stage = read('scripts/pi/remote/33-obsidian-plugin.sh');
const INCLUDES = ['main.js', 'manifest.json', 'styles.css'].map(
  (f) => `!.obsidian/plugins/foundry-ai-tool/${f}`
);

describe('33-obsidian-plugin.sh as text', () => {
  test('CHECK=1 needs no snapshot, every writing run does, and the snapshot comes before the first write', () => {
    assert.match(stage, /if \[ "\$check" != 1 \]; then\n {2}require_recent_snapshot/);
    const snap = stage.indexOf('require_recent_snapshot');
    assert.ok(snap > 0 && snap < stage.indexOf('mkdir -m 0750'));
    assert.ok(snap < stage.indexOf('cp "$1" "$t"'));
    // CHECK exits before any write
    assert.ok(stage.indexOf('exit 1\nfi') < stage.indexOf('# ---- changes start here'));
  });

  test('writes only the three release files, never data.json, and deletes nothing', () => {
    assert.match(stage, /^files="main\.js manifest\.json styles\.css"$/m);
    // the only rm removes the stage's own leftover temp name, as the foundry user
    assert.deepEqual(stage.match(/\brm -\w+ \S+/g), ['rm -f "$t"', 'rm -f "$t"']);
    assert.doesNotMatch(stage, /\brm (?!-f "\$t")/);
    assert.doesNotMatch(stage, /-delete|rmdir|>\s*"?\$plugin_dir\/data\.json/);
    // data.json is only ever tested for existence, never copied, moved or written
    for (const m of stage.matchAll(/^.*data\.json.*$/gm)) {
      assert.match(m[0], /#|warn|\[ -e|exists|has no \.obsidian/, m[0]);
    }
    assert.doesNotMatch(stage, /cp -r|cp -a/);
  });

  test('files are staged under a name the ignore list does not let through, then moved in one step', () => {
    assert.match(stage, /t="\$2\.foundry-tmp"; rm -f "\$t" && cp "\$1" "\$t" && chmod 0640 "\$t" && mv -f "\$t" "\$2"/);
    // the ignore list's temp file sits in .obsidian/plugins, which the ignore list covers
    assert.match(stage, /\$gm_dir\/\.obsidian\/plugins\/\.stignore\.foundry-tmp/);
  });

  test('every write into the vault runs as the foundry user, links are refused, a .stignore without the plugins line is refused', () => {
    const changes = stage.slice(stage.indexOf('# ---- changes start here'));
    assert.doesNotMatch(changes, /^\s*(cp|mv|chmod|chown|install|mkdir|tee)\b/m);
    assert.match(changes, /^refuse_links$/m);
    assert.match(stage, /\[ ! -L "\$p" \] \|\| die/);
    assert.match(stage, /has no \.obsidian\/plugins line: refused/);
  });

  test('refuses a build that is not the Foundry AI Tool plugin before writing anything', () => {
    assert.ok(stage.indexOf('is not the Foundry AI Tool plugin') < stage.indexOf('cp "$1" "$t"'));
    assert.match(stage, /the build has no/);
  });

  test('the ignore list gets exactly the three include lines above .obsidian/plugins', () => {
    for (const l of INCLUDES) assert.ok(stage.includes(l), l);
    assert.equal((stage.match(/!\.obsidian\/plugins\//g) ?? []).length, 3);
  });
});

describe('the Syncthing ignore lists on the Pi and the PC', () => {
  const pi = read('scripts/pi/remote/7-vault.sh');
  const pc = read('scripts/pi/setup-syncthing-pc.ps1');

  test('stage 7 writes the three include lines above .obsidian/plugins', () => {
    const at = (l) => pi.indexOf(`\n${l}\n`);
    for (const l of INCLUDES) assert.ok(at(l) > 0 && at(l) < at('.obsidian/plugins'), l);
  });

  test('setup-syncthing-pc.ps1 puts the include lines above .obsidian/plugins, data.json stays ignored', () => {
    for (const l of INCLUDES) assert.ok(pc.includes(`'${l}'`), l);
    assert.ok(pc.includes("'.obsidian/plugins'"));
    assert.doesNotMatch(pc, /!\.obsidian\/plugins\/foundry-ai-tool\/data\.json|!\.obsidian\/plugins\/foundry-ai-tool\/\*/);
    assert.doesNotMatch(stage, /^!\.obsidian\/plugins\/foundry-ai-tool\/(data\.json|\*)/m);
  });
});

describe(
  'stage 33 in the ARM64 container',
  { skip: process.env.PI_STAGE33_CONTAINER !== '1' },
  () => {
    test('scenarios', () => {
      const r = runStageContainer('stage33-scenarios.sh', { timeout: 900000 });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
    });
  }
);
