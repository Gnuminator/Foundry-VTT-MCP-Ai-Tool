import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PI_COMMAND,
  REFRESH_MS,
  buildVersionRows,
  compareVersions,
  fetchNewest,
  getVersions,
  parseFoundryReleases,
  parseManifest,
  readPcVersions,
  readPiVersions,
  splitJsonStream,
  sshOutcome,
} from '../versions.mjs';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'versions-test-'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

const CORE_JSON = { name: 'foundryvtt', release: { generation: 14, build: 368 } };
const DND5E_JSON = {
  id: 'dnd5e',
  title: 'Dungeons & Dragons 5e',
  version: '6.0.5',
  compatibility: { minimum: '14', verified: '14.368' },
  manifest: 'https://example.test/dnd5e/system.json',
};
const MOD_A = {
  id: 'alpha',
  title: 'Alpha',
  version: '1.2.3',
  manifest: 'https://example.test/alpha/module.json',
  compatibility: { minimum: '13' },
  relationships: { systems: [{ id: 'dnd5e', type: 'system' }] },
};

// ---------------------------------------------------------------- parseManifest

test('parseManifest detects core, system and module', () => {
  assert.deepEqual(parseManifest(CORE_JSON), {
    id: 'foundry',
    kind: 'core',
    title: 'Foundry VTT',
    version: '14.368',
    manifest: null,
    minCore: null,
  });
  const sys = parseManifest(DND5E_JSON);
  assert.equal(sys.kind, 'system');
  assert.equal(sys.minCore, '14');
  assert.equal(sys.title, 'Dungeons & Dragons 5e');
  const mod = parseManifest(MOD_A);
  assert.deepEqual(mod, {
    id: 'alpha',
    kind: 'module',
    title: 'Alpha',
    version: '1.2.3',
    manifest: 'https://example.test/alpha/module.json',
    minCore: '13',
  });
});

test('parseManifest hint wins and extra keys are dropped', () => {
  const item = parseManifest({ ...MOD_A, secret: 'x', flags: { a: 1 } }, 'system');
  assert.equal(item.kind, 'system');
  assert.deepEqual(Object.keys(item).sort(), [
    'id',
    'kind',
    'manifest',
    'minCore',
    'title',
    'version',
  ]);
  assert.equal(parseManifest(DND5E_JSON, 'module').kind, 'module');
});

test('parseManifest rejects bad ids, bad versions and non-objects', () => {
  assert.equal(parseManifest(null), null);
  assert.equal(parseManifest('x'), null);
  assert.equal(parseManifest([]), null);
  assert.equal(parseManifest({ id: 'has space', version: '1.0.0' }), null);
  assert.equal(parseManifest({ id: '../evil', version: '1.0.0' }), null);
  assert.equal(parseManifest({ id: '__proto__', version: '1.0.0' }), null);
  assert.equal(parseManifest({ id: 'ok', version: '1.0 beta' }), null);
  assert.equal(parseManifest({ id: 'ok', version: 3 }), null);
  assert.equal(parseManifest({ id: 'ok' }), null);
  assert.equal(parseManifest({ id: 'x'.repeat(81), version: '1' }).id.length, 80);
});

test('parseManifest drops non-http manifest urls and clips text', () => {
  assert.equal(
    parseManifest({ id: 'a', version: '1', manifest: 'file:///etc/passwd' }).manifest,
    null
  );
  assert.equal(
    parseManifest({ id: 'a', version: '1', manifest: 'javascript:alert(1)' }).manifest,
    null
  );
  assert.equal(
    parseManifest({ id: 'a', version: '1', manifest: 'http://x.test/m.json' }).manifest,
    'http://x.test/m.json'
  );
  assert.equal(parseManifest({ id: 'a', version: '1', title: 'T'.repeat(200) }).title.length, 80);
  assert.equal(parseManifest({ id: 'a', version: '1' }).title, 'a');
  assert.equal(
    parseManifest({ id: 'a', version: '1', manifest: `https://x.test/${'a'.repeat(400)}` }).manifest
      .length,
    300
  );
  assert.equal(
    parseManifest({ id: 'a', version: '1', compatibility: { minimum: 'm'.repeat(50) } }).minCore
      .length,
    20
  );
});

// ---------------------------------------------------------------- splitJsonStream

test('splitJsonStream splits concatenated objects with nesting', () => {
  const text = `${JSON.stringify(CORE_JSON)}\n${JSON.stringify(DND5E_JSON)}${JSON.stringify(MOD_A)}\n`;
  const out = splitJsonStream(text);
  assert.equal(out.length, 3);
  assert.equal(out[2].relationships.systems[0].id, 'dnd5e');
});

test('splitJsonStream honours braces in strings and escaped quotes', () => {
  const a = { id: 'a', title: 'curly } and { braces', version: '1' };
  const b = { id: 'b', title: 'quote \\" then } here', note: 'a\\\\', version: '2' };
  const out = splitJsonStream(`${JSON.stringify(a)}${JSON.stringify(b)}`);
  assert.deepEqual(out, [a, b]);
});

test('splitJsonStream ignores garbage between objects and skips bad slices', () => {
  const out = splitJsonStream(
    'cat: nope: No such file\n{"a":1}\nnoise "quoted" here\n{not json}\n{"b":{"c":2}}tail'
  );
  assert.deepEqual(out, [{ a: 1 }, { b: { c: 2 } }]);
  assert.deepEqual(splitJsonStream(''), []);
  assert.deepEqual(splitJsonStream(null), []);
  assert.deepEqual(splitJsonStream('{"unclosed": 1'), []);
});

// ---------------------------------------------------------------- compareVersions

test('compareVersions compares numerically per segment', () => {
  assert.equal(compareVersions('14.368', '14.368.0'), 0);
  assert.equal(compareVersions('14.9', '14.10'), -1);
  assert.equal(compareVersions('14.368', '14.9'), 1);
  assert.equal(compareVersions('6.0.5', '6.0.6'), -1);
  assert.equal(compareVersions('2.10.5-aitool.2', '2.10.5'), 0);
  assert.equal(compareVersions('2.10.5-aitool.2', '2.10.6'), -1);
  assert.equal(compareVersions('1.0.0+build7', '1.0.0'), 0);
  assert.equal(compareVersions('2', '1.99.99'), 1);
});

// ---------------------------------------------------------------- readPcVersions

test('readPcVersions reads core, systems and modules in order', () => {
  const root = tmp();
  writeJson(path.join(root, 'app', 'package.json'), CORE_JSON);
  writeJson(path.join(root, 'data', 'Data', 'systems', 'dnd5e', 'system.json'), DND5E_JSON);
  writeJson(path.join(root, 'data', 'Data', 'modules', 'zeta', 'module.json'), {
    id: 'zeta',
    version: '0.1.0',
  });
  writeJson(path.join(root, 'data', 'Data', 'modules', 'alpha', 'module.json'), MOD_A);
  writeJson(path.join(root, 'data', 'Data', 'modules', 'broken', 'module.json'), { id: 'broken' });
  fs.mkdirSync(path.join(root, 'data', 'Data', 'modules', 'empty'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'Data', 'modules', 'stray.txt'), 'x');
  const now = new Date('2026-10-08T10:00:00Z');
  const res = readPcVersions({ root, now });
  assert.equal(res.error, null);
  assert.equal(res.asOf, '2026-10-08T10:00:00.000Z');
  assert.deepEqual(
    res.items.map(i => [i.kind, i.id, i.version]),
    [
      ['core', 'foundry', '14.368'],
      ['system', 'dnd5e', '6.0.5'],
      ['module', 'alpha', '1.2.3'],
      ['module', 'zeta', '0.1.0'],
    ]
  );
});

test('readPcVersions falls back to the resources/app package.json', () => {
  const root = tmp();
  writeJson(path.join(root, 'app', 'resources', 'app', 'package.json'), CORE_JSON);
  fs.mkdirSync(path.join(root, 'data', 'Data'), { recursive: true });
  const res = readPcVersions({ root });
  assert.equal(res.error, null);
  assert.deepEqual(
    res.items.map(i => i.id),
    ['foundry']
  );
});

test('readPcVersions reports a missing folder', () => {
  const res = readPcVersions({ root: path.join(tmp(), 'nope') });
  assert.equal(res.error, 'test server folder not found');
  assert.deepEqual(res.items, []);
});

// ---------------------------------------------------------------- readPiVersions

const PI_STDOUT = `${JSON.stringify(CORE_JSON)}\n${JSON.stringify(DND5E_JSON)}\n${JSON.stringify(MOD_A)}`;
const NOW = new Date('2026-10-08T10:00:00Z');

test('readPiVersions runs the fixed ssh command and parses the stream', async () => {
  const calls = [];
  const res = await readPiVersions({
    run: async (file, args) => {
      calls.push([file, args]);
      return PI_STDOUT;
    },
    now: NOW,
  });
  assert.deepEqual(calls, [
    ['ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'foundry-pi', PI_COMMAND]],
  ]);
  assert.equal(
    PI_COMMAND,
    'cat /opt/foundry/package.json /var/lib/foundry/Data/systems/dnd5e/system.json /var/lib/foundry/Data/modules/*/module.json'
  );
  assert.equal(res.error, null);
  assert.equal(res.asOf, '2026-10-08T10:00:00.000Z');
  assert.deepEqual(
    res.items.map(i => `${i.kind}:${i.id}`),
    ['core:foundry', 'system:dnd5e', 'module:alpha']
  );
});

test('readPiVersions keeps partial output when cat fails on one file', async () => {
  // The default run resolves with stdout in that case, so the parser only sees the text.
  const res = await readPiVersions({
    run: async () =>
      `cat: /var/lib/foundry/Data/modules/x/module.json: No such file\n${JSON.stringify(MOD_A)}`,
    now: NOW,
  });
  assert.equal(res.error, null);
  assert.deepEqual(
    res.items.map(i => i.id),
    ['alpha']
  );
});

test('a killed ssh fails even with partial output; a cat error with output does not', () => {
  const partial = JSON.stringify(MOD_A);
  const killed = sshOutcome(Object.assign(new Error('x'), { killed: true }), partial, '');
  assert.ok(killed.error?.killed);
  const missing = sshOutcome(Object.assign(new Error('x'), { code: 1 }), partial, 'cat: no file');
  assert.equal(missing.stdout, partial);
  const empty = sshOutcome(Object.assign(new Error('x'), { code: 255 }), '', 'denied');
  assert.equal(empty.error.stderr, 'denied');
  assert.deepEqual(sshOutcome(null, partial, ''), { stdout: partial });
});

test('readPiVersions turns failures into short errors', async () => {
  const killed = await readPiVersions({
    run: async () => {
      throw Object.assign(new Error('x'), { killed: true });
    },
  });
  assert.deepEqual(killed, {
    asOf: null,
    error: 'ssh to foundry-pi timed out after 15 s',
    items: [],
  });

  const missing = await readPiVersions({
    run: async () => {
      throw Object.assign(new Error('spawn ssh ENOENT'), { code: 'ENOENT' });
    },
  });
  assert.equal(missing.error, 'ssh not found on PATH');

  const denied = await readPiVersions({
    run: async () => {
      throw Object.assign(new Error('failed'), {
        stderr: `\nssh: Permission denied ${'z'.repeat(300)}\nmore`,
      });
    },
  });
  assert.ok(denied.error.startsWith('ssh: Permission denied'));
  assert.equal(denied.error.length, 150);
  assert.equal(denied.asOf, null);
});

test('readPiVersions reports empty output as an error', async () => {
  const res = await readPiVersions({ run: async () => '' });
  assert.equal(res.asOf, null);
  assert.ok(res.error);
  assert.deepEqual(res.items, []);
});

// ---------------------------------------------------------------- parseFoundryReleases

function release(version, channels) {
  const tags = channels.map(c => `<span class="release-tag ${c}">${c}</span>`).join('\n');
  return `<li class="article release flexrow">
    <h3 class="article-title">
        <a href="/releases/${version}" title="Release ${version} Update Notes">Release ${version}</a>
    </h3>
    <span class="release-time">September 16, 2026</span>
    <div class="release-tags">
        <span class="release-tag">Update</span>
        ${tags}
    </div>
</li>`;
}

test('parseFoundryReleases separates stable from newest of any channel', () => {
  const html = `<ul>${release('14.368', ['stable'])}${release('14.9', ['stable'])}${release('15.12', ['testing'])}${release('13.351', ['stable'])}</ul>`;
  assert.deepEqual(parseFoundryReleases(html), {
    newestStable: '14.368',
    newestAny: '15.12',
    newestAnyChannel: 'testing',
  });
});

test('parseFoundryReleases handles a single stable release and junk', () => {
  assert.deepEqual(parseFoundryReleases(release('14.368', ['stable'])), {
    newestStable: '14.368',
    newestAny: '14.368',
    newestAnyChannel: 'stable',
  });
  const none = { newestStable: null, newestAny: null, newestAnyChannel: null };
  assert.deepEqual(parseFoundryReleases(''), none);
  assert.deepEqual(parseFoundryReleases('<html>nothing here</html>'), none);
  assert.deepEqual(parseFoundryReleases(undefined), none);
});

// ---------------------------------------------------------------- fetchNewest

function fakeResponse(body, over = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => text,
    ...over,
  };
}

test('fetchNewest collects foundry, dnd5e and module versions', async () => {
  const urls = [];
  const fetchImpl = async (url, opts) => {
    urls.push(url);
    assert.equal(opts.redirect, 'follow');
    assert.ok(opts.signal);
    if (url === 'https://foundryvtt.com/releases/') {
      return fakeResponse(release('14.368', ['stable']) + release('15.1', ['testing']));
    }
    if (url === 'https://api.github.com/repos/foundryvtt/dnd5e/releases/latest') {
      assert.equal(opts.headers.accept, 'application/vnd.github+json');
      assert.equal(opts.headers['user-agent'], 'foundry-ai-tool-project-dashboard');
      return fakeResponse({ tag_name: 'release-6.0.6' });
    }
    if (url === 'https://example.test/alpha/module.json') {
      return fakeResponse({ id: 'alpha', version: '1.3.0', compatibility: { minimum: '14' } });
    }
    if (url === 'https://example.test/bad/module.json')
      return fakeResponse('', { ok: false, status: 404 });
    throw new Error(`unexpected ${url}`);
  };
  const items = [
    parseManifest(DND5E_JSON),
    parseManifest(MOD_A),
    parseManifest(MOD_A),
    { id: 'bad', kind: 'module', version: '1', manifest: 'https://example.test/bad/module.json' },
    { id: 'local', kind: 'module', version: '1', manifest: 'file:///etc/passwd' },
    { id: 'noman', kind: 'module', version: '1', manifest: null },
  ];
  const res = await fetchNewest({ items, fetchImpl, now: NOW });
  assert.equal(res.asOf, '2026-10-08T10:00:00.000Z');
  assert.equal(res.errors, 1);
  assert.deepEqual(res.foundry, {
    newestStable: '14.368',
    newestAny: '15.1',
    newestAnyChannel: 'testing',
  });
  assert.deepEqual(res.byId, {
    dnd5e: { version: '6.0.6', minCore: null },
    alpha: { version: '1.3.0', minCore: '14' },
  });
  assert.equal(urls.length, 4);
  assert.equal(urls.filter(u => u.includes('alpha')).length, 1);
  assert.ok(!urls.some(u => u.startsWith('file:')));
});

test('fetchNewest falls back to the system manifest and never throws', async () => {
  const fetchImpl = async url => {
    if (url === 'https://example.test/dnd5e/system.json') {
      return fakeResponse({ id: 'dnd5e', version: '6.0.7', compatibility: { minimum: '14' } });
    }
    throw new Error('network down');
  };
  const res = await fetchNewest({ items: [parseManifest(DND5E_JSON)], fetchImpl });
  assert.deepEqual(res.byId, { dnd5e: { version: '6.0.7', minCore: '14' } });
  assert.equal(res.errors, 2); // releases page and github
  assert.deepEqual(res.foundry, { newestStable: null, newestAny: null, newestAnyChannel: null });
});

test('fetchNewest rejects oversized bodies and bad json', async () => {
  const fetchImpl = async url => {
    if (url.includes('foundryvtt.com')) {
      return fakeResponse('', { headers: { get: () => String(2 * 1024 * 1024) } });
    }
    if (url.includes('github')) return fakeResponse('x'.repeat(1024 * 1024 + 1));
    return fakeResponse('not json');
  };
  const res = await fetchNewest({
    items: [parseManifest(MOD_A)],
    fetchImpl,
  });
  assert.equal(res.errors, 3);
  assert.deepEqual(res.byId, {});
});

test('fetchNewest keeps at most 6 requests in flight', async () => {
  let active = 0;
  let peak = 0;
  const fetchImpl = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active -= 1;
    return fakeResponse('{}');
  };
  const items = Array.from({ length: 25 }, (_, i) =>
    parseManifest({ id: `m${i}`, version: '1', manifest: `https://example.test/m${i}.json` })
  );
  await fetchNewest({ items, fetchImpl });
  assert.ok(peak <= 6, `peak was ${peak}`);
  assert.ok(peak > 1);
});

// ---------------------------------------------------------------- buildVersionRows

test('buildVersionRows computes statuses and sorts core, system, modules', () => {
  const item = (id, kind, version, title) => ({
    id,
    kind,
    version,
    title: title || id,
    manifest: null,
    minCore: null,
  });
  const pc = {
    items: [
      item('zeta', 'module', '1.0.0'),
      item('foundry', 'core', '14.368', 'Foundry VTT'),
      item('dnd5e', 'system', '6.0.5', 'D&D'),
      item('same', 'module', '2.0.0', 'Same'),
      item('diff', 'module', '1.0.0'),
      item('nonew', 'module', '1.0.0'),
      item('pconly', 'module', '1.0.0'),
    ],
  };
  const pi = {
    items: [
      item('foundry', 'core', '14.368'),
      item('dnd5e', 'system', '6.0.6'),
      item('same', 'module', '2.0.0'),
      item('diff', 'module', '1.5.0'),
      item('nonew', 'module', '1.0.0'),
      item('pionly', 'module', '3.0.0', 'Pi Only'),
    ],
  };
  const newest = {
    foundry: { newestStable: '14.368', newestAny: '15.1', newestAnyChannel: 'testing' },
    byId: {
      dnd5e: { version: '6.0.6', minCore: null },
      same: { version: '2.0.0', minCore: '14' },
      diff: { version: '1.5.0', minCore: null },
      zeta: { version: '1.0.1', minCore: '13' },
    },
  };
  const rows = buildVersionRows({ pc, pi, newest });
  assert.deepEqual(
    rows.map(r => r.id),
    ['foundry', 'dnd5e', 'diff', 'nonew', 'pconly', 'pionly', 'same', 'zeta']
  );
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(by.foundry.status, 'ok');
  assert.equal(by.foundry.newest, '14.368');
  assert.equal(by.dnd5e.status, 'behind'); // pc 6.0.5 < 6.0.6
  assert.equal(by.dnd5e.pc, '6.0.5');
  assert.equal(by.dnd5e.pi, '6.0.6');
  assert.equal(by.dnd5e.title, 'D&D');
  assert.equal(by.diff.status, 'behind'); // pc is behind the newest
  assert.equal(by.nonew.status, 'unknown');
  assert.equal(by.nonew.newest, null);
  assert.equal(by.pionly.title, 'Pi Only');
  assert.equal(by.pionly.pc, null);
  assert.equal(by.pionly.status, 'unknown');
  assert.equal(by.same.status, 'ok');
  assert.equal(by.same.minCore, '14');
  assert.equal(by.zeta.status, 'behind');
  assert.equal(by.zeta.minCore, '13');
});

test('buildVersionRows differs and unknown', () => {
  const item = (id, version) => ({
    id,
    kind: 'module',
    version,
    title: id,
    manifest: null,
    minCore: null,
  });
  const rows = buildVersionRows({
    pc: { items: [item('a', '1.0.0'), item('b', '1.0.0')] },
    pi: { items: [item('a', '1.1.0'), item('b', '1.0.0')] },
    newest: { foundry: {}, byId: {} },
  });
  assert.equal(rows.find(r => r.id === 'a').status, 'differs');
  assert.equal(rows.find(r => r.id === 'b').status, 'unknown');
  assert.deepEqual(buildVersionRows({}), []);
});

// ---------------------------------------------------------------- getVersions

function fixtureRoot() {
  const root = tmp();
  writeJson(path.join(root, 'app', 'package.json'), CORE_JSON);
  writeJson(path.join(root, 'data', 'Data', 'systems', 'dnd5e', 'system.json'), DND5E_JSON);
  writeJson(path.join(root, 'data', 'Data', 'modules', 'alpha', 'module.json'), MOD_A);
  return root;
}

function makeDeps() {
  const counts = { pi: 0, newest: 0, pc: 0 };
  const state = { piError: null };
  const deps = {
    readPc: opts => {
      counts.pc += 1;
      return readPcVersions(opts);
    },
    readPi: async ({ now }) => {
      counts.pi += 1;
      if (state.piError) return { asOf: null, error: state.piError, items: [] };
      return {
        asOf: now.toISOString(),
        error: null,
        items: [
          {
            id: 'foundry',
            kind: 'core',
            title: 'Foundry VTT',
            version: '14.368',
            manifest: null,
            minCore: null,
          },
          {
            id: 'alpha',
            kind: 'module',
            title: 'Alpha',
            version: '1.0.0',
            manifest: null,
            minCore: null,
          },
        ],
      };
    },
    fetchNewest: async ({ now }) => {
      counts.newest += 1;
      return {
        asOf: now.toISOString(),
        errors: 0,
        foundry: { newestStable: '14.368', newestAny: '15.1', newestAnyChannel: 'testing' },
        byId: {
          alpha: { version: '1.2.3', minCore: '13' },
          dnd5e: { version: '6.0.5', minCore: null },
        },
      };
    },
  };
  return { deps, counts, state };
}

test('getVersions builds the snapshot and caches the Pi and online results', async () => {
  const root = fixtureRoot();
  const dataDir = path.join(tmp(), 'data');
  const paths = { testEnvRoot: root, dataDir };
  const { deps, counts } = makeDeps();
  const t0 = new Date('2026-10-08T10:00:00Z');

  const snap = await getVersions({ paths, now: t0, deps });
  assert.equal(counts.pi, 1);
  assert.equal(counts.newest, 1);
  assert.equal(snap.pc.error, null);
  assert.equal(snap.pi.error, null);
  assert.equal(snap.pi.asOf, t0.toISOString());
  assert.deepEqual(snap.newest, { asOf: t0.toISOString(), errors: 0 });
  assert.deepEqual(snap.foundry, {
    newestStable: '14.368',
    newestAny: '15.1',
    newestAnyChannel: 'testing',
  });
  const alpha = snap.rows.find(r => r.id === 'alpha');
  assert.equal(alpha.pc, '1.2.3');
  assert.equal(alpha.pi, '1.0.0');
  assert.equal(alpha.status, 'behind');
  assert.ok(fs.existsSync(path.join(dataDir, 'versions-cache.json')));

  const t1 = new Date(t0.getTime() + REFRESH_MS - 1000);
  const again = await getVersions({ paths, now: t1, deps });
  assert.equal(counts.pi, 1);
  assert.equal(counts.newest, 1);
  assert.equal(counts.pc, 2);
  assert.deepEqual(again.rows, snap.rows);
  assert.equal(again.pi.asOf, t0.toISOString());

  await getVersions({ paths, now: t1, deps, force: true });
  assert.equal(counts.pi, 2);
  assert.equal(counts.newest, 2);

  const t2 = new Date(t1.getTime() + REFRESH_MS + 1000);
  await getVersions({ paths, now: t2, deps });
  assert.equal(counts.pi, 3);
  assert.equal(counts.newest, 3);
});

test('getVersions keeps the previous Pi items when a refresh fails', async () => {
  const paths = { testEnvRoot: fixtureRoot(), dataDir: path.join(tmp(), 'data') };
  const { deps, counts, state } = makeDeps();
  const t0 = new Date('2026-10-08T10:00:00Z');
  await getVersions({ paths, now: t0, deps });

  state.piError = 'ssh to foundry-pi timed out after 15 s';
  const t1 = new Date(t0.getTime() + REFRESH_MS + 1000);
  const snap = await getVersions({ paths, now: t1, deps });
  assert.equal(counts.pi, 2);
  assert.equal(snap.pi.error, 'ssh to foundry-pi timed out after 15 s');
  assert.equal(snap.pi.asOf, t0.toISOString());
  assert.equal(snap.rows.find(r => r.id === 'alpha').pi, '1.0.0');
});

test('getVersions keeps the previous online result when the check fails', async () => {
  const paths = { testEnvRoot: fixtureRoot(), dataDir: path.join(tmp(), 'data') };
  const { deps } = makeDeps();
  const t0 = new Date('2026-10-08T10:00:00Z');
  await getVersions({ paths, now: t0, deps });

  const failing = {
    ...deps,
    fetchNewest: async () => ({
      asOf: 'x',
      errors: 4,
      foundry: { newestStable: null, newestAny: null, newestAnyChannel: null },
      byId: {},
    }),
  };
  const snap = await getVersions({
    paths,
    now: new Date(t0.getTime() + REFRESH_MS + 1),
    deps: failing,
  });
  assert.equal(snap.newest.errors, 4);
  assert.equal(snap.newest.asOf, t0.toISOString());
  assert.equal(snap.foundry.newestStable, '14.368');
  assert.equal(snap.rows.find(r => r.id === 'alpha').newest, '1.2.3');
});

test('getVersions shares one refresh between overlapping calls and clips strings', async () => {
  const paths = { testEnvRoot: path.join(tmp(), 'missing'), dataDir: path.join(tmp(), 'data') };
  let piCalls = 0;
  const long = 'L'.repeat(500);
  const deps = {
    readPi: async () => {
      piCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 20));
      return {
        asOf: NOW.toISOString(),
        error: long,
        items: [
          { id: 'a', kind: 'module', title: long, version: long, manifest: null, minCore: null },
        ],
      };
    },
    fetchNewest: async () => ({ asOf: NOW.toISOString(), errors: 0, foundry: {}, byId: {} }),
  };
  const [one, two] = await Promise.all([
    getVersions({ paths, now: NOW, deps }),
    getVersions({ paths, now: NOW, deps }),
  ]);
  assert.equal(piCalls, 1);
  assert.equal(one, two);
  assert.equal(one.pc.error, 'test server folder not found');
  const check = value => {
    if (typeof value === 'string') assert.ok(value.length <= 200, value.slice(0, 20));
    else if (value && typeof value === 'object') Object.values(value).forEach(check);
  };
  check(one);
});
