// The foundry-user write helpers in scripts/pi/remote/lib.sh (foundry_edit_json, foundry_copy_file,
// foundry_can_write) and the stages that use them.
//   node --test scripts/pi/runuser-helper.test.mjs
// The helpers run their write through `runuser -u foundry --`. Here a stand-in runuser on PATH just runs the
// command, so the temp file + rename logic is exercised on any machine (no root, no Pi). That the write is really
// done by the foundry user (owner stays foundry, a link planted by that user is never followed by root) is proven in
// the Debian ARM64 container scenarios of stages 11, 13 and the kit session (PI_STAGE11_CONTAINER and friends).
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const remote = fileURLToPath(new URL('./remote/', import.meta.url));
const read = f => readFileSync(join(remote, f), 'utf8');
const posix = p => p.replace(/\\/g, '/');
const isWin = process.platform === 'win32';

// Only the helper section of lib.sh (it starts at the "Writes into folders" banner), so the stage's own
// `set -euo pipefail` and umask come from the script below.
const lib = read('lib.sh');
const helpers = lib.slice(lib.indexOf('# ---- Writes into folders the foundry user owns'));
assert.ok(helpers.includes('foundry_edit_json()'), 'lib.sh has no foundry write helpers');

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'runuser-helper-'));
  mkdirSync(join(dir, 'node24', 'bin'), { recursive: true });
  writeFileSync(
    join(dir, 'node24', 'bin', 'node'),
    `#!/bin/sh\nexec "${posix(process.execPath)}" "$@"\n`
  );
  chmodSync(join(dir, 'node24', 'bin', 'node'), 0o755);
});
after(() => rmSync(dir, { recursive: true, force: true }));

/** Runs `body` in bash with the helpers loaded; returns { status, out }. */
function sh(body) {
  const script = [
    'set -euo pipefail',
    'runuser() { [ "$1 $2 $3" = "-u foundry --" ] || { echo "runuser: unexpected arguments: $*" >&2; return 97; }; shift 3; "$@"; }', // runuser -u foundry -- CMD...: runs CMD as ourselves; any other form fails
    'FOUNDRY_USER=foundry',
    `NODE_DIR=${JSON.stringify(posix(join(dir, 'node24')))}`,
    helpers,
    body,
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

let n = 0;
/** A fresh folder with options.json holding `json`. */
function options(json) {
  const d = join(dir, `case-${n++}`);
  mkdirSync(d);
  const f = join(d, 'options.json');
  writeFileSync(f, json);
  return { d, f, p: posix(f) };
}

describe('foundry_edit_json', () => {
  test('sets a key, keeps the others and ends with a newline; no temp file is left', () => {
    const o = options('{"world":"a","port":30000}');
    const r = sh(`foundry_edit_json "${o.p}" 'o.world = a[0] || null' "b"`);
    assert.equal(r.status, 0, r.out);
    assert.equal(readFileSync(o.f, 'utf8'), '{\n  "world": "b",\n  "port": 30000\n}\n');
    assert.ok(!existsSync(`${o.f}.foundry-tmp`));
  });

  test('an empty argument with `|| null` writes null (the world is cleared)', () => {
    const o = options('{"world":"a"}');
    assert.equal(sh(`foundry_edit_json "${o.p}" 'o.world = a[0] || null' ""`).status, 0);
    assert.deepEqual(JSON.parse(readFileSync(o.f, 'utf8')), { world: null });
  });

  test('several arguments and a nested edit (the kit world.json)', () => {
    const o = options('{"id":"x","title":"X","flags":{"other":{"k":1}}}');
    const r = sh(
      `foundry_edit_json "${o.p}" 'o.id = a[0]; o.title = a[1]; o.flags = o.flags || {}; o.flags["foundry-ai-tool"] = Object.assign({}, o.flags["foundry-ai-tool"], { kitOf: a[2] })' "strahd-kit" "Sorvan (kit)" "curse-of-strahd"`
    );
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(JSON.parse(readFileSync(o.f, 'utf8')), {
      id: 'strahd-kit',
      title: 'Sorvan (kit)',
      flags: { other: { k: 1 }, 'foundry-ai-tool': { kitOf: 'curse-of-strahd' } },
    });
  });

  test('several keys in one edit (the tunnel options)', () => {
    const o = options('{"hostname":null,"proxySSL":false}');
    const r = sh(
      `foundry_edit_json "${o.p}" 'o.hostname = a[0]; o.proxySSL = true; o.proxyPort = 443' "play.example.com"`
    );
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(JSON.parse(readFileSync(o.f, 'utf8')), {
      hostname: 'play.example.com',
      proxySSL: true,
      proxyPort: 443,
    });
  });

  test('a leftover temp file is replaced', () => {
    const o = options('{"world":"a"}');
    writeFileSync(`${o.f}.foundry-tmp`, 'stale');
    assert.equal(sh(`foundry_edit_json "${o.p}" 'o.world = a[0]' "b"`).status, 0);
    assert.equal(JSON.parse(readFileSync(o.f, 'utf8')).world, 'b');
    assert.ok(!existsSync(`${o.f}.foundry-tmp`));
  });

  test('a file that is not JSON fails and stays as it was, with no temp file', () => {
    const o = options('not json');
    const r = sh(`foundry_edit_json "${o.p}" 'o.world = a[0]' "b"`);
    assert.notEqual(r.status, 0);
    assert.equal(readFileSync(o.f, 'utf8'), 'not json');
    assert.ok(!existsSync(`${o.f}.foundry-tmp`));
  });

  test('a body that throws fails and the file stays as it was', () => {
    const o = options('{"world":"a"}');
    const r = sh(`foundry_edit_json "${o.p}" 'throw new Error("no")' "b"`);
    assert.notEqual(r.status, 0);
    assert.equal(readFileSync(o.f, 'utf8'), '{"world":"a"}');
    assert.ok(!existsSync(`${o.f}.foundry-tmp`));
  });

  test('a missing file fails', () => {
    const o = options('{}');
    assert.notEqual(sh(`foundry_edit_json "${o.p}.nope" 'o.world = a[0]' "b"`).status, 0);
  });

  test(
    'the mode of the file is kept',
    { skip: isWin && 'file modes are not kept on Windows' },
    () => {
      const o = options('{"world":"a"}');
      chmodSync(o.f, 0o600);
      assert.equal(sh(`foundry_edit_json "${o.p}" 'o.world = a[0]' "b"`).status, 0);
      assert.equal(lstatSync(o.f).mode & 0o777, 0o600);
    }
  );

  test(
    'a link planted at the temp name is replaced, its target is not written',
    { skip: isWin && 'needs symlinks' },
    () => {
      const o = options('{"world":"a"}');
      const victim = join(o.d, 'victim');
      writeFileSync(victim, 'untouched');
      symlinkSync(victim, `${o.f}.foundry-tmp`);
      assert.equal(sh(`foundry_edit_json "${o.p}" 'o.world = a[0]' "b"`).status, 0);
      assert.equal(readFileSync(victim, 'utf8'), 'untouched');
      assert.equal(JSON.parse(readFileSync(o.f, 'utf8')).world, 'b');
      assert.ok(!existsSync(`${o.f}.foundry-tmp`) && !lstatSync(o.f).isSymbolicLink());
    }
  );
});

describe('foundry_copy_file', () => {
  test('copies, replaces an existing destination and leaves no temp file', () => {
    const o = options('{"hostname":"new"}');
    const dst = `${o.f}.before-tunnel.1`;
    writeFileSync(dst, 'old');
    const r = sh(`foundry_copy_file "${o.p}" "${posix(dst)}"`);
    assert.equal(r.status, 0, r.out);
    assert.equal(readFileSync(dst, 'utf8'), '{"hostname":"new"}');
    assert.ok(!existsSync(`${dst}.foundry-tmp`));
  });

  test('a missing source fails and the destination stays as it was', () => {
    const o = options('x');
    const dst = join(o.d, 'dst');
    writeFileSync(dst, 'keep');
    assert.notEqual(sh(`foundry_copy_file "${o.p}.nope" "${posix(dst)}"`).status, 0);
    assert.equal(readFileSync(dst, 'utf8'), 'keep');
    assert.ok(!existsSync(`${dst}.foundry-tmp`));
  });

  test(
    'a link planted at the temp name is replaced, its target is not written',
    { skip: isWin && 'needs symlinks' },
    () => {
      const o = options('data');
      const dst = join(o.d, 'dst');
      const victim = join(o.d, 'victim');
      writeFileSync(victim, 'untouched');
      symlinkSync(victim, `${dst}.foundry-tmp`);
      assert.equal(sh(`foundry_copy_file "${o.p}" "${posix(dst)}"`).status, 0);
      assert.equal(readFileSync(victim, 'utf8'), 'untouched');
      assert.equal(readFileSync(dst, 'utf8'), 'data');
    }
  );
});

describe('foundry_can_write', () => {
  test('true for a writable folder, false for a missing one', () => {
    const o = options('{}');
    assert.equal(sh(`foundry_can_write "${posix(o.d)}"`).status, 0);
    assert.notEqual(sh(`foundry_can_write "${posix(o.d)}/missing"`).status, 0);
  });
});

describe('the stages use the helpers and no longer write options.json as root', () => {
  const stages = {
    '5-check-world.sh': ['foundry_edit_json "$options"', 'foundry_can_write'],
    '11-world.sh': [
      'foundry_edit_json "$options"',
      'foundry_edit_json "$data/worlds/$KIT_WORLD/world.json"',
      'cp -a --remove-destination',
    ],
    '12-tunnel.sh': [
      'foundry_edit_json "$options"',
      'foundry_copy_file "$options" "$run_backup"',
      'foundry_copy_file "$run_backup" "$options"',
    ],
    '13-player-creation.sh': ['foundry_edit_json "$options"'],
    'kit-session.sh': ['foundry_edit_json "$options"'],
  };
  for (const [file, needles] of Object.entries(stages)) {
    test(file, () => {
      const code = read(file)
        .split('\n')
        .filter(l => !/^\s*#/.test(l))
        .join('\n');
      for (const needle of needles) assert.ok(code.includes(needle), `${file} lacks: ${needle}`);
      // No in-place write of options.json by root, and no chown to repair one.
      assert.ok(
        !/fs\.writeFileSync\(p,\s*JSON\.stringify/.test(code),
        `${file} still writes JSON in place`
      );
      assert.ok(
        !/chown --reference/.test(code),
        `${file} still chowns options.json after a root write`
      );
      assert.ok(
        !/cp -a "\$(options|run_backup)"/.test(code),
        `${file} still copies options.json as root`
      );
    });
  }

  test('every stage that calls a helper is piped with lib.sh (its header says cat lib.sh first)', () => {
    for (const file of Object.keys(stages)) {
      const piped = read(file)
        .split('\n')
        .filter(l => /^#.*\blib\.sh\b/.test(l));
      assert.ok(piped.length > 0, `${file} header does not pipe lib.sh`);
    }
  });
});

describe('stage 12, Foundry proxy options (backup, edit, put back)', () => {
  const tunnel = read('12-tunnel.sh');
  const from = tunnel.indexOf('say "Foundry\'s proxy options"');
  const to = tunnel.indexOf('say "the check"');
  assert.ok(from > 0 && to > from, '12-tunnel.sh sections moved');
  const section = tunnel.slice(from, to);

  /** Runs the section with stand-ins; `override` is bash that runs after the helpers load. */
  function proxy(json, override = '') {
    const o = options(json);
    const calls = join(o.d, 'calls');
    const body = [
      `FOUNDRY_DATA=${JSON.stringify(posix(o.d))}`,
      'mkdir -p "$FOUNDRY_DATA/Config"',
      `cp "${o.p}" "$FOUNDRY_DATA/Config/options.json"`,
      'public_host=play.example.com',
      'say() { :; }; ok() { :; }; warn() { :; }',
      'die() { echo "ERROR: $*" >&2; exit 1; }',
      'have_systemd() { return 0; }',
      'require_quiet() { :; }', // lib.sh's game-night guard has its own tests
      `systemctl() { echo "$*" >>"${posix(calls)}"; }`,
      override,
      section,
    ].join('\n');
    const r = sh(body);
    const cfg = join(o.d, 'Config');
    return {
      ...r,
      options: JSON.parse(readFileSync(join(cfg, 'options.json'), 'utf8')),
      calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [],
      backups: readdirSync(cfg).filter(f => f.includes('before-tunnel')),
      tmp: readdirSync(cfg).filter(f => f.endsWith('.foundry-tmp')),
    };
  }

  test('success: Foundry stops, the options change, Foundry starts, a backup stays', () => {
    const r = proxy('{"hostname":null,"port":30000}');
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.options, {
      hostname: 'play.example.com',
      port: 30000,
      proxySSL: true,
      proxyPort: 443,
    });
    assert.deepEqual(r.calls, ['stop foundry.service', 'start foundry.service']);
    assert.equal(r.backups.length, 1);
    assert.deepEqual(r.tmp, []);
  });

  test('a failed edit puts options.json back and starts Foundry again', () => {
    const r = proxy('{"hostname":null,"port":30000}', 'foundry_edit_json() { return 1; }');
    assert.notEqual(r.status, 0);
    assert.match(r.out, /options\.json put back from .* and Foundry started again/);
    assert.deepEqual(r.options, { hostname: null, port: 30000 });
    assert.deepEqual(r.calls, ['stop foundry.service', 'start foundry.service']);
  });

  test('a Config folder the foundry user cannot write is refused before Foundry stops', () => {
    const r = proxy('{"hostname":null}', 'foundry_can_write() { return 1; }');
    assert.notEqual(r.status, 0);
    assert.match(r.out, /cannot write in .*Foundry was not stopped/);
    assert.deepEqual(r.calls, []);
    assert.deepEqual(r.options, { hostname: null });
  });

  test('options.json that already has the values is left alone', () => {
    const r = proxy('{"hostname":"play.example.com","proxySSL":true,"proxyPort":443}');
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.calls, []);
    assert.deepEqual(r.backups, []);
  });
});

describe('stage 5 check world, the options.json switch (stop, edit by the foundry user, start)', () => {
  const stage = read('5-check-world.sh');
  const from = stage.indexOf('say "Foundry launches $world by itself"');
  const to = stage.indexOf('if have_systemd; then\n  systemctl is-active --quiet foundry.service');
  assert.ok(from > 0 && to > from, '5-check-world.sh sections moved');
  const section = stage.slice(from, to);
  const jsonGet = stage.split('\n').find(l => l.startsWith('json_get()'));
  assert.ok(jsonGet, '5-check-world.sh has no json_get');

  /** Runs the section with stand-ins; `override` is bash that runs after the helpers load. */
  function check(json, override = '', env = '') {
    const o = options(json);
    const calls = join(o.d, 'calls');
    const body = [
      `FOUNDRY_DATA=${JSON.stringify(posix(o.d))}`,
      `options=${JSON.stringify(o.p)}`,
      'world=pi-check',
      env,
      'say() { :; }; ok() { :; }; warn() { :; }',
      'die() { echo "ERROR: $*" >&2; exit 1; }',
      'have_systemd() { return 0; }',
      'require_quiet() { :; }', // lib.sh's game-night guard has its own tests
      `systemctl() { echo "$*" >>"${posix(calls)}"; }`,
      jsonGet,
      'export PATH="$NODE_DIR/bin:$PATH"',
      override,
      section,
    ].join('\n');
    const r = sh(body);
    return {
      ...r,
      options: JSON.parse(readFileSync(o.f, 'utf8')),
      calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [],
      tmp: readdirSync(o.d).filter(f => f.endsWith('.foundry-tmp')),
    };
  }

  test('success: Foundry stops, options.json launches the check world, Foundry starts', () => {
    const r = check('{"world":null,"port":30000}');
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(r.options, { world: 'pi-check', port: 30000 });
    assert.deepEqual(r.calls, ['stop foundry.service', 'start foundry.service']);
    assert.deepEqual(r.tmp, []);
  });

  test('a Config folder the foundry user cannot write is refused before Foundry stops', () => {
    const r = check('{"world":null}', 'foundry_can_write() { return 1; }');
    assert.notEqual(r.status, 0);
    assert.match(r.out, /cannot write in .*Foundry was not stopped/);
    assert.deepEqual(r.calls, []);
    assert.deepEqual(r.options, { world: null });
  });

  test('another world in options.json is refused without FORCE_WORLD=1, nothing stops', () => {
    const r = check('{"world":"curse-of-strahd"}');
    assert.notEqual(r.status, 0);
    assert.match(r.out, /launches 'curse-of-strahd'; this script never replaces another world/);
    assert.deepEqual(r.calls, []);
    assert.deepEqual(r.options, { world: 'curse-of-strahd' });
  });

  test('a failed edit starts Foundry again and stops the stage', () => {
    const r = check('{"world":null}', 'foundry_edit_json() { return 1; }');
    assert.notEqual(r.status, 0);
    assert.match(r.out, /options\.json could not be changed; Foundry was started again/);
    assert.deepEqual(r.calls, ['stop foundry.service', 'start foundry.service']);
    assert.deepEqual(r.options, { world: null });
  });
});
