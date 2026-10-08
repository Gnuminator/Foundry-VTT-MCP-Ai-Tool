// Tests for the Assistant GM driver (scripts/pi/remote/assistant-gm.mjs) and its GM script mode
// (docs/dev/PI-SETUP.md, "GM scripts"):  node --test scripts/pi/assistant-gm.test.mjs
// - the service mode is still `run` (the unit's ExecStart) and still reaches its browser start;
// - script mode takes only an absolute local file, reads only regular files, logs its sha256;
// - the dry-run guard holds back every write and lets reads through; the runner passes args;
// - gm-script.sh parses (bash -n).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  installDryRunGuard,
  parseScriptArgs,
  readScript,
  runScriptSource,
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

describe('script arguments', () => {
  test('a file with options', () => {
    const file = abs('a.js');
    assert.deepEqual(parseScriptArgs([file, '--dry-run', '--enable-module', 'racooze-map-library']), {
      file,
      dryRun: true,
      enableModules: ['racooze-map-library'],
    });
    assert.deepEqual(parseScriptArgs([file]), { file, dryRun: false, enableModules: [] });
  });

  test('refuses relative paths, URLs, two files, unknown options and odd module ids', () => {
    assert.throws(() => parseScriptArgs([]), /give the script file/);
    assert.throws(() => parseScriptArgs(['a.js']), /absolute path/);
    assert.throws(() => parseScriptArgs(['http://example.org/a.js']), /absolute path/);
    assert.throws(() => parseScriptArgs([abs('a.js'), abs('b.js')]), /one script file/);
    assert.throws(() => parseScriptArgs([abs('a.js'), '--url']), /unknown option --url/);
    assert.throws(() => parseScriptArgs([abs('a.js'), '--enable-module']), /needs a module id/);
    assert.throws(() => parseScriptArgs([abs('a.js'), '--enable-module', '../x']), /needs a module id/);
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
      installDryRunGuard();
      const backend = globalThis.CONFIG.DatabaseBackend;
      assert.deepEqual(await backend._createDocuments({ documentName: 'Scene' }, { data: [{}, {}] }), []);
      await backend._updateDocuments({ documentName: 'Note' }, { updates: [{}], parentUuid: 'Scene.x' });
      await backend._deleteDocuments({ documentName: 'AmbientLight' }, { ids: ['a', 'b', 'c'] });
      await backend.modifyDocumentBatch([{}, {}]);
      let acked;
      globalThis.game.socket.emit('manageFiles', { action: 'createDirectory' }, {}, r => (acked = r));
      globalThis.game.socket.emit('module.other', { ping: 1 });
      globalThis.game.socket.emit('modifyDocument', { action: 'get', type: 'Scene' }, () => {});
      globalThis.game.socket.emit('modifyDocumentBatch', [{ action: 'get' }, { action: 'get' }], () => {});
      globalThis.game.socket.emit('modifyDocument', { action: 'create', type: 'Scene' }, () => {});
      globalThis.game.socket.emit('modifyDocumentBatch', [{ action: 'get' }, { action: 'delete' }], () => {});
      const post = await globalThis.fetch('/upload', { method: 'POST' });
      const head = await globalThis.fetch('/x.svg', { method: 'HEAD' });
      const get = await globalThis.fetch('/y.json');

      assert.deepEqual(globalThis.__gmScriptBlocked, [
        'create Scene x2',
        'update Note x1 in Scene.x',
        'delete AmbientLight x3',
        'batch of 2 operations',
        'socket manageFiles createDirectory',
        'socket modifyDocument create',
        'socket modifyDocumentBatch',
        'POST /upload',
      ]);
      assert.deepEqual(acked, { error: 'dry run' });
      assert.deepEqual(sent, ['module.other', 'modifyDocument', 'modifyDocumentBatch']);
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

describe('script runner', () => {
  test('passes dryRun and log, returns the value, the log lines and what was held back', async () => {
    globalThis.__gmScriptBlocked = ['create Scene x1'];
    try {
      const res = await runScriptSource({
        source: 'args.log("checking"); await null; return { dry: args.dryRun, n: 2 };',
        dryRun: true,
      });
      assert.deepEqual(res, { value: { dry: true, n: 2 }, lines: ['checking'], blocked: ['create Scene x1'] });
    } finally {
      delete globalThis.__gmScriptBlocked;
    }
    const plain = await runScriptSource({ source: 'args.log(1);', dryRun: false });
    assert.deepEqual(plain, { value: null, lines: ['1'], blocked: [] });
    await assert.rejects(runScriptSource({ source: 'throw new Error("boom")', dryRun: false }), /boom/);
  });
});

describe('gm-script.sh', { skip: !hasBash && 'no bash here' }, () => {
  test('parses (bash -n), with lib.sh in front as on the Pi', () => {
    const joined = abs('joined.sh');
    writeFileSync(
      joined,
      readFileSync(path.join(remote, 'lib.sh'), 'utf8') + readFileSync(path.join(remote, 'gm-script.sh'), 'utf8')
    );
    const res = spawnSync('bash', ['-n', joined], { encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
  });
});
