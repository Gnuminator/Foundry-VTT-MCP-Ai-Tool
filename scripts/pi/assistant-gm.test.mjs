// Tests for the Assistant GM driver (scripts/pi/remote/assistant-gm.mjs) and its GM script mode
// (docs/dev/PI-SETUP.md, "GM scripts"):  node --test scripts/pi/assistant-gm.test.mjs
// - the service mode is still `run` (the unit's ExecStart) and still reaches its browser start;
// - script mode takes only an absolute local file, reads only regular files, logs its sha256;
// - a dry run lets only known reads through (an allow list), in the page and again on the wire,
//   and every other event is held back; the runner passes args;
// - gm-script.sh parses (bash -n) and refuses a real run without a passed dry run of the same file.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  dryRunFrame,
  extraGm,
  installDryRunGuard,
  isReadEvent,
  parseScriptArgs,
  readScript,
  runScriptSource,
  summarize,
} from './remote/assistant-gm.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const remote = path.join(repo, 'scripts', 'pi', 'remote');
const driver = path.join(remote, 'assistant-gm.mjs');
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'agm-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const abs = name => path.join(tmp, name);

/** Runs the driver with a clean environment (no TOOL_APP, no profile, no passwords). */
function cli(...args) {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? '' };
  return spawnSync(process.execPath, [driver, ...args], { env, encoding: 'utf8' });
}

describe('service mode', () => {
  test('the unit still starts the driver in run mode', () => {
    const stage5 = readFileSync(path.join(remote, '5-tool.sh'), 'utf8');
    assert.match(stage5, /ExecStart=\$NODE_DIR\/bin\/node \$driver_dir\/assistant-gm\.mjs run\n/);
  });

  test('run mode reaches its browser start (it needs the profile), not the usage text', () => {
    const res = cli('run');
    assert.equal(res.status, 1);
    assert.match(res.stdout, /GM_BROWSER_PROFILE is not set/);
  });

  test('an unknown mode prints the usage and exits 2', () => {
    const res = cli('serve');
    assert.equal(res.status, 2);
    assert.match(res.stderr, /usage: node assistant-gm\.mjs run\|provision\|script/);
  });
});

describe('provision: the extra GM (stage 11 EXTRA_GM_USER, D-118)', () => {
  const taken = ['Gamemaster', 'Assistant GM'];
  test('none when neither variable is set', () => {
    assert.equal(extraGm({}, taken), null);
    assert.equal(
      extraGm({ PROVISION_EXTRA_GM_USER: '', PROVISION_EXTRA_GM_PASSWORD: '' }, taken),
      null
    );
  });
  test('a name and a password make one', () => {
    assert.deepEqual(
      extraGm({ PROVISION_EXTRA_GM_USER: 'Claude', PROVISION_EXTRA_GM_PASSWORD: 'pw' }, taken),
      { name: 'Claude', password: 'pw' }
    );
  });
  test('never a GM without a password, never a name without the other', () => {
    assert.throws(() => extraGm({ PROVISION_EXTRA_GM_USER: 'Claude' }, taken), /go together/);
    assert.throws(() => extraGm({ PROVISION_EXTRA_GM_PASSWORD: 'pw' }, taken), /go together/);
  });
  test('never the Gamemaster or the Assistant GM', () => {
    for (const name of taken) {
      assert.throws(
        () => extraGm({ PROVISION_EXTRA_GM_USER: name, PROVISION_EXTRA_GM_PASSWORD: 'pw' }, taken),
        /must differ/
      );
    }
  });
});

describe('script arguments', () => {
  test('a file with options', () => {
    const file = abs('a.js');
    assert.deepEqual(
      parseScriptArgs([file, '--dry-run', '--enable-module', 'racooze-map-library']),
      {
        file,
        dryRun: true,
        enableModules: ['racooze-map-library'],
      }
    );
    assert.deepEqual(parseScriptArgs([file]), { file, dryRun: false, enableModules: [] });
  });

  test('refuses relative paths, URLs, two files, unknown options and odd module ids', () => {
    assert.throws(() => parseScriptArgs([]), /give the script file/);
    assert.throws(() => parseScriptArgs(['a.js']), /absolute path/);
    assert.throws(() => parseScriptArgs(['http://example.org/a.js']), /absolute path/);
    assert.throws(() => parseScriptArgs([abs('a.js'), abs('b.js')]), /one script file/);
    assert.throws(() => parseScriptArgs([abs('a.js'), '--url']), /unknown option --url/);
    assert.throws(() => parseScriptArgs([abs('a.js'), '--enable-module']), /needs a module id/);
    assert.throws(
      () => parseScriptArgs([abs('a.js'), '--enable-module', '../x']),
      /needs a module id/
    );
  });

  test('script mode stops before any browser when the file is not absolute', () => {
    const res = cli('script', 'a.js');
    assert.equal(res.status, 1);
    assert.match(res.stdout, /absolute path/);
  });
});

describe('reading the script', () => {
  test('a regular file: its text and sha256', () => {
    const file = abs('ok.js');
    writeFileSync(file, 'return 1;\n');
    const { source, sha256 } = readScript(file);
    assert.equal(source, 'return 1;\n');
    assert.equal(sha256, createHash('sha256').update('return 1;\n').digest('hex'));
  });

  test('refuses a folder and a link', t => {
    mkdirSync(abs('dir'));
    assert.throws(() => readScript(abs('dir')), /not a regular file/);
    try {
      symlinkSync(abs('ok.js'), abs('link.js'));
    } catch {
      t.skip('no symlinks here (Windows without the right)');
      return;
    }
    assert.throws(() => readScript(abs('link.js')), /not a regular file/);
  });
});

describe('dry-run guard', () => {
  test('holds back writes, lets reads through', async () => {
    const saved = { CONFIG: globalThis.CONFIG, game: globalThis.game, fetch: globalThis.fetch };
    const sent = [];
    const fetched = [];
    globalThis.CONFIG = { DatabaseBackend: {} };
    globalThis.game = { socket: { emit: (...a) => sent.push(a[0]) } };
    globalThis.fetch = async (input, init) => {
      fetched.push([input, init?.method ?? 'GET']);
      return new Response('read');
    };
    try {
      installDryRunGuard(isReadEvent.toString());
      const backend = globalThis.CONFIG.DatabaseBackend;
      assert.deepEqual(
        await backend._createDocuments({ documentName: 'Scene' }, { data: [{}, {}] }),
        []
      );
      await backend._updateDocuments(
        { documentName: 'Note' },
        { updates: [{}], parentUuid: 'Scene.x' }
      );
      await backend._deleteDocuments({ documentName: 'AmbientLight' }, { ids: ['a', 'b', 'c'] });
      await backend.modifyDocumentBatch([{}, {}]);
      let acked;
      globalThis.game.socket.emit(
        'manageFiles',
        { action: 'createDirectory' },
        {},
        r => (acked = r)
      );
      globalThis.game.socket.emit('module.other', { ping: 1 });
      globalThis.game.socket.emit('manageCompendium', { action: 'create' }, () => {});
      globalThis.game.socket.emit(
        'manageFiles',
        { action: 'browseFiles', target: 'icons' },
        {},
        () => {}
      );
      globalThis.game.socket.emit('template', 'templates/x.hbs', () => {});
      globalThis.game.socket.emit('modifyDocument', { action: 'get', type: 'Scene' }, () => {});
      globalThis.game.socket.emit(
        'modifyDocumentBatch',
        [{ action: 'get' }, { action: 'get' }],
        () => {}
      );
      globalThis.game.socket.emit('modifyDocument', { action: 'create', type: 'Scene' }, () => {});
      globalThis.game.socket.emit(
        'modifyDocumentBatch',
        [{ action: 'get' }, { action: 'delete' }],
        () => {}
      );
      const post = await globalThis.fetch('/upload', { method: 'POST' });
      const head = await globalThis.fetch('/x.svg', { method: 'HEAD' });
      const get = await globalThis.fetch('/y.json');

      assert.deepEqual(globalThis.__gmScriptBlocked, [
        'create Scene x2',
        'update Note x1 in Scene.x',
        'delete AmbientLight x3',
        'batch of 2 operations',
        'socket manageFiles createDirectory',
        'socket module.other',
        'socket manageCompendium create',
        'socket modifyDocument create',
        'socket modifyDocumentBatch',
        'POST /upload',
      ]);
      assert.deepEqual(acked, { error: 'dry run' });
      assert.deepEqual(sent, ['manageFiles', 'template', 'modifyDocument', 'modifyDocumentBatch']);
      assert.equal(await post.text(), '{"status":"dry run"}');
      assert.deepEqual(fetched, [
        ['/x.svg', 'HEAD'],
        ['/y.json', 'GET'],
      ]);
      assert.equal(await head.text(), 'read');
      assert.equal(await get.text(), 'read');
    } finally {
      Object.assign(globalThis, saved);
      delete globalThis.__gmScriptBlocked;
    }
  });
});

describe('the read allow list', () => {
  test('known reads pass', () => {
    assert.equal(isReadEvent('modifyDocument', { action: 'get', type: 'Scene' }), true);
    assert.equal(isReadEvent('modifyDocumentBatch', [{ action: 'get' }, { action: 'get' }]), true);
    assert.equal(isReadEvent('manageFiles', { action: 'browseFiles' }), true);
    assert.equal(isReadEvent('template', 'templates/x.hbs'), true);
    for (const event of [
      'time',
      'world',
      'getWorldStatus',
      'getUserActivity',
      'sizeInfo',
      'requestTokenImages',
    ]) {
      assert.equal(isReadEvent(event, undefined), true, event);
    }
  });

  test('writes and events the list does not know are refused', () => {
    for (const [event, request] of [
      ['modifyDocument', { action: 'create' }],
      ['modifyDocument', { action: 'update' }],
      ['modifyDocument', {}],
      ['modifyDocumentBatch', []],
      ['modifyDocumentBatch', [{ action: 'get' }, { action: 'delete' }]],
      ['manageFiles', { action: 'createDirectory' }],
      ['manageFiles', { action: 'upload' }],
      ['template', { path: 'x' }],
      ['manageCompendium', { action: 'create' }],
      ['userActivity', 'abc'],
      ['module.foundry-mcp-bridge', { type: 'x' }],
      ['shutdown', undefined],
      ['pause', true],
      ['preloadScene', 'abc'],
      ['showEntry', 'JournalEntry.x'],
      ['userQuery', {}],
      ['someFutureWrite', { action: 'get' }],
    ]) {
      assert.equal(isReadEvent(event, request), false, `${event} ${JSON.stringify(request)}`);
    }
  });
});

describe('the socket filter on the wire (dry run)', () => {
  const pass = { pass: true, label: '', reply: null };

  test('engine.io control packets, connect, disconnect and acks pass', () => {
    for (const frame of [
      '2',
      '3',
      '2probe',
      '3probe',
      '5',
      '6',
      '1',
      '40',
      '40{"token":"x"}',
      '41',
      '43["answer"]',
      '4312[{}]',
    ]) {
      assert.deepEqual(dryRunFrame(frame), pass, frame);
    }
  });

  test('read events pass, with or without an ack id or a namespace', () => {
    assert.deepEqual(dryRunFrame('42["modifyDocument",{"action":"get","type":"Scene"}]'), pass);
    assert.deepEqual(dryRunFrame('4217["modifyDocumentBatch",[{"action":"get"}]]'), pass);
    assert.deepEqual(dryRunFrame('42/game,3["template","templates/x.hbs"]'), pass);
  });

  test('an unknown write event is held back, and its ack answers with an error', () => {
    assert.deepEqual(dryRunFrame('427["someModule.write",{"action":"create"}]'), {
      pass: false,
      label: 'socket someModule.write create',
      reply: '437[{"error":"dry run"}]',
    });
    assert.deepEqual(dryRunFrame('42/game,8["modifyDocument",{"action":"update"}]'), {
      pass: false,
      label: 'socket modifyDocument update',
      reply: '43/game,8[{"error":"dry run"}]',
    });
    assert.deepEqual(dryRunFrame('42["userActivity","id",{"cursor":null}]'), {
      pass: false,
      label: 'socket userActivity',
      reply: null,
    });
  });

  test('binary frames, odd packet types and frames that do not parse are held back', () => {
    for (const frame of [
      null,
      '',
      '0{}',
      '4',
      '44{}',
      '45-["upload",{"_placeholder":true,"num":0}]',
      '46-[]',
      '42',
      '42{"a":1}',
      '42[1,2]',
      '42/game',
      '42[not json',
    ]) {
      const verdict = dryRunFrame(frame);
      assert.equal(verdict.pass, false, String(frame));
      assert.equal(verdict.reply, null, String(frame));
    }
  });

  test('the held-back list reads well in the log', () => {
    assert.equal(summarize([]), '');
    assert.equal(
      summarize([
        'socket userActivity',
        'create Scene x1',
        'socket userActivity',
        'socket userActivity',
      ]),
      'socket userActivity (3 times); create Scene x1'
    );
  });
});

describe('script runner', () => {
  test('passes dryRun and log, returns the value, the log lines and what was held back', async () => {
    globalThis.__gmScriptBlocked = ['create Scene x1'];
    try {
      const res = await runScriptSource({
        source: 'args.log("checking"); await null; return { dry: args.dryRun, n: 2 };',
        dryRun: true,
      });
      assert.deepEqual(res, {
        value: { dry: true, n: 2 },
        lines: ['checking'],
        blocked: ['create Scene x1'],
      });
    } finally {
      delete globalThis.__gmScriptBlocked;
    }
    const plain = await runScriptSource({ source: 'args.log(1);', dryRun: false });
    assert.deepEqual(plain, { value: null, lines: ['1'], blocked: [] });
    await assert.rejects(
      runScriptSource({ source: 'throw new Error("boom")', dryRun: false }),
      /boom/
    );
  });
});

describe('gm-script.sh', { skip: !hasBash && 'no bash here' }, () => {
  test('parses (bash -n), with lib.sh in front as on the Pi', () => {
    const joined = abs('joined.sh');
    writeFileSync(
      joined,
      readFileSync(path.join(remote, 'lib.sh'), 'utf8') +
        readFileSync(path.join(remote, 'gm-script.sh'), 'utf8')
    );
    const res = spawnSync('bash', ['-n', joined], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
  });

  // gm-script.sh with the real lib.sh in front, but in folders of its own: stand-ins for root, ARM64
  // and systemd, and fake systemctl, systemd-run, journalctl and logger (logger writes the journal
  // file that journalctl -t reads back).
  const root = abs('pi').replace(/\\/g, '/');
  const sh = (name, text) => {
    writeFileSync(path.join(root, 'bin', name), `#!/usr/bin/env bash\n${text}\n`, { mode: 0o755 });
  };
  function setUp() {
    rmSync(root, { recursive: true, force: true });
    for (const dir of ['bin', 'tool/gm-browser', 'etc', 'data', 'foundry'])
      mkdirSync(path.join(root, dir), { recursive: true });
    writeFileSync(path.join(root, 'tool/gm-browser/assistant-gm.mjs'), '');
    writeFileSync(path.join(root, 'etc/assistant-gm.env'), '');
    writeFileSync(path.join(root, 'script.js'), 'return 1;\n');
    sh('systemctl', `echo "$*" >> "${root}/systemctl"; exit 1`);
    sh('systemd-run', `echo "$*" >> "${root}/runs"; exit "\${FAKE_EXIT:-0}"`);
    sh('journalctl', `case " $* " in *" -t "*) cat "${root}/journal" 2>/dev/null ;; esac; exit 0`);
    sh('logger', `echo "\${@: -1}" >> "${root}/journal"`);
  }
  const fakes = [
    'require_root() { :; }',
    'require_arm64() { :; }',
    'have_systemd() { :; }',
    `TOOL_DIR=${root}/tool TOOL_ETC=${root}/etc TOOL_DATA=${root}/data FOUNDRY_DATA=${root}/foundry NODE_DIR=${root}/node`,
    '',
  ].join('\n');
  function gmScript(env) {
    const text =
      readFileSync(path.join(remote, 'lib.sh'), 'utf8') +
      fakes +
      readFileSync(path.join(remote, 'gm-script.sh'), 'utf8');
    writeFileSync(path.join(root, 'joined.sh'), text);
    return spawnSync('bash', [`${root}/joined.sh`], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${root}/bin:${process.env.PATH}`,
        GM_SCRIPT: `${root}/script.js`,
        ...env,
      },
    });
  }
  const runs = () =>
    existsSync(path.join(root, 'runs')) ? readFileSync(path.join(root, 'runs'), 'utf8') : '';
  const kept = () => readdirSync(path.join(root, 'data/gm-scripts')).sort();
  const sha12 = createHash('sha256').update('return 1;\n').digest('hex').slice(0, 12);

  test('a real run without a dry run is refused before anything starts', () => {
    setUp();
    const res = gmScript({});
    assert.equal(res.status, 1);
    assert.match(
      res.stderr,
      /no passed dry run of this script .*DRY_RUN=1 first.*NO_DRY_RUN_REASON/
    );
    assert.equal(runs(), '');
    assert.deepEqual(readdirSync(path.join(root, 'data/gm-scripts')), []);
  });

  test('a passed dry run leaves a marker, then the real run of the same file goes ahead', () => {
    setUp();
    const dry = gmScript({ DRY_RUN: '1' });
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(runs(), new RegExp(`script \\S+-${sha12}-dry-run\\.js --dry-run\\n$`));
    assert.deepEqual(
      kept().map(n => n.replace(/^\d{8}-\d{6}-/, '')),
      [`${sha12}-dry-run.js`, `${sha12}-dry-run.ok`]
    );
    const real = gmScript({});
    assert.equal(real.status, 0, real.stderr);
    // The trap stops the script's unit before it would start the service again (an SSH drop).
    assert.match(
      readFileSync(path.join(root, 'systemctl'), 'utf8'),
      /^stop foundry-ai-tool-gm-script-\d{8}-\d{6}$/m
    );
    assert.match(real.stdout, /a dry run of this script .* passed before/);
    assert.match(runs().split('\n')[1], new RegExp(`script \\S+-${sha12}\\.js$`));
  });

  test('the dry run end line in the journal also counts; a failed dry run or another file does not', () => {
    setUp();
    assert.equal(gmScript({ DRY_RUN: '1' }).status, 0);
    for (const name of kept().filter(n => n.endsWith('.ok')))
      rmSync(path.join(root, 'data/gm-scripts', name));
    assert.equal(gmScript({}).status, 0);

    setUp();
    assert.equal(gmScript({ DRY_RUN: '1', FAKE_EXIT: '3' }).status, 1);
    assert.equal(
      kept().some(n => n.endsWith('.ok')),
      false
    );
    assert.equal(gmScript({}).status, 1);

    setUp();
    assert.equal(gmScript({ DRY_RUN: '1' }).status, 0);
    writeFileSync(path.join(root, 'script.js'), 'return 2;\n');
    assert.match(gmScript({}).stderr, /no passed dry run/);
  });

  test('NO_DRY_RUN_REASON skips the check and puts the reason in the journal', () => {
    setUp();
    const res = gmScript({ NO_DRY_RUN_REASON: 'the castle import broke the session' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(
      readFileSync(path.join(root, 'journal'), 'utf8'),
      /WITHOUT a dry run: the castle import broke the session/
    );
    assert.equal(runs().split('\n').length, 2);
  });
});
