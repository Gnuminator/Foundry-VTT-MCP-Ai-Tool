import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { archivePackage, installFromZip, zipFolder } from '../../modules/ops.mjs';
import { errorFindings, parseArgs } from '../../modules/rehearse.mjs';
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

test('the archive round trip: zip an installed module, archive it, install it elsewhere', async () => {
  const d = tmp();
  const root = path.join(d, 'archive');
  const dataA = path.join(d, 'a', 'Data');
  const dataB = path.join(d, 'b', 'Data');
  const dir = fakeModule(dataA, 'module', 'demo', '1.2.3');
  writeFileSync(path.join(dir, 'x.js'), 'export {}');
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

test('the all-modules profile is valid and lists exactly the Strahd modules', () => {
  assert.ok(SHIPPED_PROFILES.includes('modules-all'));
  const profile = loadProfile('modules-all');
  const strahd = JSON.parse(readFileSync(path.join(here, '..', '..', 'modules', 'strahd-modules.json'), 'utf8'));
  const want = strahd.modules.map(m => m.id).filter(id => id !== 'foundry-mcp-bridge').sort();
  assert.deepEqual([...profile.modules].sort(), want);
  assert.deepEqual(profile.knownAlso, ['srd']);
});
