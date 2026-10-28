import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  archiveDir,
  compareVersions,
  isSafeId,
  planUpdates,
  readManifest,
  readPinned,
  renderReport,
  runPassed,
  scanInstalled,
  splitFindings,
} from '../../modules/lib.mjs';
import { spawnSync } from 'node:child_process';
import { appDirOf, archivePackage, downloadZip, installFromZip, lockHolder, unpackZip, unsafeEntryName, zipEntryNames, zipFolder } from '../../modules/ops.mjs';
import { errorFindings, kitModuleFindings, parseArgs, versionMismatches } from '../../modules/rehearse.mjs';
import { loadProfile, SHIPPED_PROFILES } from '../lib/profiles.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'rehearsal-test-'));

function fakeModule(dataDir, kind, id, version, extra = {}) {
  const dir = path.join(dataDir, kind === 'system' ? 'systems' : 'modules', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, kind === 'system' ? 'system.json' : 'module.json'),
    JSON.stringify({ id, title: id, version, manifest: `https://example.test/${id}.json`, ...extra })
  );
  return dir;
}

test('compareVersions orders dotted versions, a fork suffix and unparsable ones', () => {
  assert.ok(compareVersions('14.606.4.4', '14.605.1') > 0);
  assert.ok(compareVersions('v1.4.6', '1.4.6') === 0);
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.ok(compareVersions('2.10.5-aitool.4', '2.10.5') > 0);
  assert.ok(compareVersions('2.10.5-aitool.4', '2.10.5-aitool.10') < 0);
  assert.ok(compareVersions('1.0', '1.0.0') === 0);
  assert.ok(compareVersions('latest', '1.0.0') < 0);
});

test('safe ids refuse path tricks', () => {
  assert.ok(isSafeId('NotYourTurn') && isSafeId('JB2A_DnD5e'));
  assert.ok(!isSafeId('../x') && !isSafeId('a/b') && !isSafeId('a\\b') && !isSafeId(''));
  assert.throws(() => archiveDir('/r', 'module', 'ok', '1/../2'));
});

test('scanInstalled reads modules and systems and skips folders without a manifest', () => {
  const d = tmp();
  fakeModule(d, 'module', 'dae', '14.0.19', { compatibility: { verified: '14.368' } });
  fakeModule(d, 'system', 'dnd5e', '6.0.5');
  mkdirSync(path.join(d, 'modules', 'README-only'));
  const got = scanInstalled(d);
  assert.deepEqual(got.map(p => [p.kind, p.id, p.version]), [['module', 'dae', '14.0.19'], ['system', 'dnd5e', '6.0.5']]);
  assert.equal(got[0].verified, '14.368');
  rmSync(d, { recursive: true, force: true });
});

test('readManifest accepts https downloads only', () => {
  assert.equal(readManifest({ id: 'a', version: '1', download: 'http://x/z.zip' }).download, null);
  assert.equal(readManifest({ id: 'a', version: '1', download: 'https://x/z.zip' }).download, 'https://x/z.zip');
  assert.equal(readManifest(null), null);
});

test('planUpdates names each package state', () => {
  const installed = [
    { kind: 'module', id: 'a', version: '1.0.0', title: 'a', manifest: '', verified: '', dir: '' },
    { kind: 'module', id: 'b', version: '2.0.0', title: 'b', manifest: '', verified: '', dir: '' },
    { kind: 'module', id: 'c', version: '3.0.0', title: 'c', manifest: '', verified: '', dir: '' },
    { kind: 'module', id: 'd', version: '1.0.0', title: 'd', manifest: '', verified: '', dir: '' },
    { kind: 'module', id: 'e', version: '1.0.0', title: 'e', manifest: '', verified: '', dir: '' },
  ];
  const pinned = { updated: '', foundry: null, systems: {}, modules: { a: { version: '1.0.0' }, b: { version: '1.5.0' }, c: { version: '3.0.0' }, d: { version: '2.0.0' } } };
  const plan = planUpdates(installed, pinned, { c: { version: '3.1.0', download: 'https://x/c.zip' }, e: { version: null, error: 'HTTP 404' } }, { modules: [{ id: 'a', licensed: true }] });
  assert.deepEqual(plan.map(p => p.state), ['pinned', 'untested-installed', 'newer-upstream', 'behind-archive', 'unreachable']);
  assert.equal(plan[0].inStrahd, true);
  assert.equal(plan[0].licensed, true);
  assert.equal(plan[2].download, 'https://x/c.zip');
});

test('splitFindings keeps known upstream findings from hiding new ones', () => {
  const expected = [
    { id: 'k1', module: 'dae', match: 'turnStartSource', why: 'deprecated' },
    { id: 'k2', module: '*', match: '403', max: 1, why: 'harmless' },
    { id: 'k3', module: 'dae', match: 'never seen', why: 'x' },
  ];
  const r = splitFindings(
    [
      { module: 'dae', text: 'bad turnStartSource on Cloak' },
      { module: 'ddb-importer', text: 'HTTP 403' },
      { module: 'ddb-importer', text: 'HTTP 403 again' },
      { module: 'dae', text: 'TypeError: new thing' },
    ],
    expected
  );
  assert.deepEqual(r.known.map(f => f.expectedId), ['k1', 'k2']);
  assert.deepEqual(r.fresh.map(f => f.text), ['HTTP 403 again', 'TypeError: new thing']);
  assert.deepEqual(r.unseen, ['k3']);
});

test('a run passes only with passing steps and no new findings in the report', () => {
  assert.equal(runPassed([{ status: 'pass' }, { status: 'skip' }]), true);
  assert.equal(runPassed([{ status: 'skip' }]), false); // nothing tested is no pass
  assert.equal(runPassed([{ status: 'pass' }, { status: 'fail' }]), false);
  assert.equal(runPassed([]), false);
  const base = { server: 'B', stamp: 's', gitSha: 'abc', foundry: '14.369', system: '6.0.6', plan: [], steps: [{ name: 'kit', status: 'pass' }] };
  assert.match(renderReport({ ...base, findings: { known: [], fresh: [], unseen: [] } }), /Verdict: \*\*PASS\*\*/);
  assert.match(renderReport({ ...base, findings: { known: [], fresh: [{ module: 'm', text: 't' }], unseen: [] } }), /Verdict: \*\*FAIL\*\*/);
});

test('errorFindings reads module errors in either shape', () => {
  assert.deepEqual(errorFindings({ result: { errors: [{ moduleId: 'dae', message: 'boom' }] } }), [{ module: 'dae', text: 'boom' }]);
  assert.deepEqual(errorFindings({}), []);
  const stacked = { id: 'diag-1', module: null, message: 'x', stack: 'at f (http://h/modules/dae/dae.js:1:1)', timestampMs: 100 };
  assert.deepEqual(errorFindings({ errors: [stacked, { message: 'y', timestampMs: 100 }] }), [
    { module: 'dae', text: 'x' },
    { module: '*', text: 'y' },
  ]);
  assert.deepEqual(errorFindings({ errors: [stacked] }, 101), []);
  assert.equal(errorFindings({ errors: [{ module: 'module:dae', message: 'z' }] })[0].module, 'dae');
});

test('parseArgs reads the command and its flags and refuses the rest', () => {
  const o = parseArgs(['run', '--server', 'C', '--size', 'full', '--no-kit', '--ids', 'a,b']);
  assert.deepEqual([o.cmd, o.server, o.size, o.kit, o.ids], ['run', 'C', 'full', false, ['a', 'b']]);
  assert.throws(() => parseArgs(['run', '--bogus']));
  assert.throws(() => parseArgs(['run', '--size', 'huge']));
});

/** crc-32 of a buffer (the zip format needs it). @param {Buffer} buf */
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** A real zip (stored entries, local headers and a central directory). @param {string} file @param {Record<string, string>} entries */
function writeRealZip(file, entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text);
    const nm = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt32LE(crc32(data), 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc32(data), 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nm.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nm);
    parts.push(head, nm, data);
    offset += 30 + nm.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(file, Buffer.concat([...parts, dir, end]));
}

/** unpackZip uses the tar that reads zips (Windows bsdtar); GNU tar on Linux cannot, so those tests skip there. */
const zipTar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const canUnzip = /bsdtar/.test(spawnSync(zipTar, ['--version'], { encoding: 'utf8' }).stdout ?? '');

test('zipEntryNames reads a real zip and unsafe entry names are refused before unpacking', () => {
  const d = tmp();
  const zip = path.join(d, 'evil.zip');
  writeRealZip(zip, { 'module.json': '{}', '../evil.txt': 'x', 'ok/a.js': 'y' });
  assert.deepEqual(zipEntryNames(zip), ['module.json', '../evil.txt', 'ok/a.js']);
  assert.ok(['../x', 'a/../../x', '/abs', 'C:\\x', 'a\\..\\b'].every(unsafeEntryName));
  assert.ok(!['module.json', 'dir/..file', 'a/b.js'].some(unsafeEntryName));
  assert.throws(() => unpackZip(zip), /outside its folder/); // refused by our check, with or without bsdtar
  writeFileSync(path.join(d, 'plain.zip'), 'not a zip at all, long enough to pass the length check');
  assert.deepEqual(zipEntryNames(path.join(d, 'plain.zip')), []);
  // a zip that cannot be read exactly is refused, not passed as clean
  const whole = readFileSync(zip);
  writeFileSync(path.join(d, 'cut.zip'), whole.subarray(0, whole.length - 30));
  assert.throws(() => zipEntryNames(path.join(d, 'cut.zip')), /no zip end record/);
  const zip64 = Buffer.from(whole);
  zip64.writeUInt16LE(0xffff, zip64.length - 22 + 10);
  writeFileSync(path.join(d, 'zip64.zip'), zip64);
  assert.throws(() => zipEntryNames(path.join(d, 'zip64.zip')), /ZIP64/);
  const shortDir = Buffer.from(whole);
  shortDir.writeUInt16LE(9, shortDir.length - 22 + 10);
  writeFileSync(path.join(d, 'short.zip'), shortDir);
  assert.throws(() => zipEntryNames(path.join(d, 'short.zip')), /cut short/);
  const lowCount = Buffer.from(whole); // fewer entries stated than the directory holds: names would hide
  lowCount.writeUInt16LE(2, lowCount.length - 22 + 10);
  writeFileSync(path.join(d, 'low.zip'), lowCount);
  assert.throws(() => zipEntryNames(path.join(d, 'low.zip')), /does not match its stated size/);
  rmSync(d, { recursive: true, force: true });
});

test('a real zip unpacks, even with the package inside one folder', { skip: !canUnzip && 'needs bsdtar' }, () => {
  const d = tmp();
  const zip = path.join(d, 'real.zip');
  writeRealZip(zip, { 'demo/module.json': JSON.stringify({ id: 'demo', version: '1.0.0' }), 'demo/x.js': 'export {}' });
  const { tmp: out, root } = unpackZip(zip);
  assert.ok(existsSync(path.join(root, 'x.js')));
  rmSync(out, { recursive: true, force: true });
  rmSync(d, { recursive: true, force: true });
});

test('bsdtar itself keeps a "../" entry inside the target folder (unpackZip still refuses it up front)', { skip: !canUnzip && 'needs bsdtar' }, () => {
  const d = tmp();
  const zip = path.join(d, 'evil.zip');
  const out = path.join(d, 'a', 'out');
  mkdirSync(out, { recursive: true });
  writeRealZip(zip, { 'module.json': '{}', '../evil.txt': 'x' });
  spawnSync(zipTar, ['-xf', zip, '-C', out], { encoding: 'utf8' });
  assert.equal(existsSync(path.join(d, 'a', 'evil.txt')), false);
  rmSync(d, { recursive: true, force: true });
});

test('modeOfFormula reads the roll mode of a d20 formula', async () => {
  const { modeOfFormula } = await import('../scenarios/module-ac5e-roll-mode.scenario.mjs');
  assert.deepEqual(['1d20+2', '2d20kl1 + 3', '2d20kh', '2d20dis + 3', 'nonsense'].map(modeOfFormula), ['normal', 'disadvantage', 'advantage', 'other', 'other']);
});

test('versionMismatches names packages whose version changed or went missing since the report', () => {
  const plan = [
    { id: 'a', kind: 'module', installed: '1.0.0' },
    { id: 'b', kind: 'module', installed: '2.0.0' },
    { id: 'dnd5e', kind: 'system', installed: '6.0.6' },
  ];
  assert.deepEqual(versionMismatches(plan, [{ id: 'a', kind: 'module', version: '1.0.0' }, { id: 'b', kind: 'module', version: '2.1.0' }, { id: 'dnd5e', kind: 'system', version: '6.0.6' }]), ['b 2.0.0 -> 2.1.0']);
  assert.deepEqual(versionMismatches(plan, [{ id: 'a', kind: 'module', version: 'v1.0.0' }]), ['b 2.0.0 -> gone', 'dnd5e 6.0.6 -> gone']);
});

test('kitModuleFindings reads what module-load attached to the last kit report', () => {
  const home = tmp();
  const dir = path.join(home, 'run-1');
  mkdirSync(dir);
  assert.equal(kitModuleFindings(home), null); // no last-run.json
  const last = { reportDir: dir, server: 'A', profile: 'modules-all', finishedAt: new Date().toISOString() };
  writeFileSync(path.join(home, 'last-run.json'), JSON.stringify({ lastRun: last }));
  assert.equal(kitModuleFindings(home), null); // no report yet
  const found = [{ module: 'dae', text: 'boom' }];
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ scenarios: [{ id: 'other', attachments: [] }, { id: 'module-load', attachments: [{ name: 'module-findings', data: found }] }] }));
  assert.deepEqual(kitModuleFindings(home, 0, 'A'), found);
  assert.equal(kitModuleFindings(home, Date.now() + 60000, 'A'), null); // an older run than this rehearsal
  assert.equal(kitModuleFindings(home, 0, 'B'), null); // another server's run
  writeFileSync(path.join(home, 'last-run.json'), JSON.stringify({ lastRun: { ...last, profile: 'srd' } }));
  assert.equal(kitModuleFindings(home, 0, 'A'), null); // another profile
  rmSync(home, { recursive: true, force: true });
});

test('the archive round trip: zip an installed module, archive it, install it elsewhere', { skip: !canUnzip && 'needs bsdtar' }, async () => {
  const d = tmp();
  const root = path.join(d, 'archive');
  const dataA = path.join(d, 'a', 'Data');
  const dataB = path.join(d, 'b', 'Data');
  const dir = fakeModule(dataA, 'module', 'demo', '1.2.3');
  writeFileSync(path.join(dir, 'x.js'), 'export {}');
  // a real zip (as a download is), plus the zip made from the installed folder
  const real = path.join(d, 'demo-real.zip');
  writeRealZip(real, { 'module.json': JSON.stringify({ id: 'demo', title: 'demo', version: '1.2.3' }), 'x.js': 'export {}' });
  await archivePackage({ root, kind: 'module', id: 'demo', version: '1.2.3', zip: real });
  assert.equal(readPinned(root).modules.demo.version, '1.2.3');
  const zip = await archivePackage({ root, kind: 'module', id: 'demo', version: '1.2.3', installedDir: dir, licensed: true, testedOn: 'server B' });
  const pin = readPinned(root).modules.demo;
  assert.equal(pin.version, '1.2.3');
  assert.equal(pin.licensed, true);
  assert.match(pin.sha256, /^[0-9a-f]{64}$/);
  assert.ok(zip.endsWith(path.join('modules', 'demo', '1.2.3', 'demo-1.2.3.zip')));
  fakeModule(dataB, 'module', 'demo', '1.0.0');
  installFromZip({ dataDir: dataB, kind: 'module', id: 'demo', zip, rollbackDir: path.join(d, 'rollback') });
  assert.equal(scanInstalled(dataB)[0].version, '1.2.3');
  assert.equal(JSON.parse(readFileSync(path.join(d, 'rollback', 'module-demo', 'module.json'), 'utf8')).version, '1.0.0');
  zipFolder(dir, path.join(d, 'again.zip'));
  rmSync(d, { recursive: true, force: true });
});

test('installFromZip refuses a zip whose manifest id is another package', () => {
  const d = tmp();
  const dir = fakeModule(path.join(d, 'a', 'Data'), 'module', 'other', '1.0.0');
  const zip = path.join(d, 'other.zip');
  zipFolder(dir, zip);
  const data = path.join(d, 'b', 'Data');
  fakeModule(data, 'module', 'demo', '1.0.0');
  assert.throws(
    () => installFromZip({ dataDir: data, kind: 'module', id: 'demo', zip, rollbackDir: path.join(d, 'rollback') }),
    /not "demo"/
  );
  assert.equal(scanInstalled(data)[0].version, '1.0.0');
  rmSync(d, { recursive: true, force: true });
});

test('downloadZip stays on https, writes a .part file and keeps only real zips', async () => {
  const d = tmp();
  const fake = (body, url) => async () => {
    const r = new Response(body, { status: 200 });
    Object.defineProperty(r, 'url', { value: url });
    return r;
  };
  const dest = path.join(d, 'a.zip');
  await assert.rejects(downloadZip('https://x.test/a.zip', dest, fake('PK\x03\x04data', 'http://x.test/a.zip')), /redirected away from https/);
  await assert.rejects(downloadZip('https://x.test/a.zip', dest, fake('<html>', 'https://x.test/a.zip')), /not a zip/);
  assert.equal(existsSync(dest), false);
  assert.equal(existsSync(`${dest}.part`), false);
  await downloadZip('https://x.test/a.zip', dest, fake('PK\x03\x04data', 'https://x.test/a.zip'));
  assert.equal(existsSync(dest), true);
  assert.equal(existsSync(`${dest}.part`), false);
  rmSync(d, { recursive: true, force: true });
});

test('appDirOf follows the machine-wide appdir.txt next to the lock for every server', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'appdir-'));
  try {
    const all = { A: { Root: root }, B: { Root: path.join(root, 'b') } };
    writeFileSync(path.join(root, 'appdir.txt'), `${path.join(root, 'app-14.369')}\r\n`);
    assert.equal(appDirOf('A', all), path.join(root, 'app-14.369'));
    assert.equal(appDirOf('B', all), path.join(root, 'app-14.369'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lockHolder reads a test server lock and treats an unreadable one as held', () => {
  const d = tmp();
  assert.equal(lockHolder({ Root: d }), null);
  writeFileSync(path.join(d, 'lock.json'), JSON.stringify({ holder: null, queue: [] }));
  assert.equal(lockHolder({ Root: d }), null);
  writeFileSync(path.join(d, 'lock.json'), JSON.stringify({ holder: 'Lane X', session: 'local_1' }));
  assert.deepEqual(lockHolder({ Root: d }), { holder: 'Lane X', session: 'local_1' });
  writeFileSync(path.join(d, 'lock.json'), '{ nope');
  assert.equal(lockHolder({ Root: d })?.holder, 'unreadable lock.json');
  rmSync(d, { recursive: true, force: true });
});

test('every expected finding names its id, module, match text and reason', () => {
  const file = path.join(here, '..', '..', 'modules', 'expected.json');
  const { expected } = JSON.parse(readFileSync(file, 'utf8'));
  for (const e of expected) {
    for (const key of ['id', 'module', 'match', 'why']) assert.equal(typeof e[key], 'string', `${e.id}: ${key}`);
  }
  assert.equal(new Set(expected.map(e => e.id)).size, expected.length);
});

test('the all-modules profile is valid and lists exactly the Strahd modules', () => {
  assert.ok(SHIPPED_PROFILES.includes('modules-all'));
  const profile = loadProfile('modules-all');
  const strahd = JSON.parse(readFileSync(path.join(here, '..', '..', 'modules', 'strahd-modules.json'), 'utf8'));
  const want = strahd.modules.map(m => m.id).filter(id => id !== 'foundry-mcp-bridge').sort();
  assert.deepEqual([...profile.modules].sort(), want);
  assert.deepEqual(profile.knownAlso, ['srd']);
});
