#!/usr/bin/env node
/**
 * Module update rehearsal (I-117, D-128). Lists modules, dnd5e and Foundry with a newer version than
 * the archive, installs them on a test server, runs the checks and writes a report; versions that
 * pass go into the local archive and the pinned list. The Pi installs only from that archive.
 *
 *   node scripts/modules/rehearse.mjs status  [--server B]       installed vs pinned list (offline)
 *   node scripts/modules/rehearse.mjs check   [--server B]       also asks each manifest for its newest
 *   node scripts/modules/rehearse.mjs stage   --server B [--ids a,b]   download newer zips to staging
 *   node scripts/modules/rehearse.mjs install --server B [--ids a,b]   staged zips into the server (stopped, lock held)
 *   node scripts/modules/rehearse.mjs run     --server B [--size smoke|full] [--no-kit] [--with-green]
 *   node scripts/modules/rehearse.mjs archive --server B [--ids a,b] [--from-report <dir>]
 *   node scripts/modules/rehearse.mjs pi-plan                    the commands for the Pi mirror (printed, never run)
 *
 * The archive is $MODULE_ARCHIVE or C:\FoundryAI\module-archive (see lib.mjs). Licensed and Patreon
 * packages are archived like the rest and never leave this PC. Test servers only: the live ports
 * 31414-31416 and the Pi are never touched. Exit codes: 0 ok, 1 a step failed or findings are new,
 * 2 not ready (server up/down, lock, bad arguments).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  archiveRoot,
  compareVersions,
  isSafeId,
  isSafeVersion,
  PI_MIRROR_PATH,
  planUpdates,
  readPinned,
  renderReport,
  runPassed,
  scanInstalled,
  splitFindings,
} from './lib.mjs';
import {
  archivePackage,
  downloadZip,
  fetchManifest,
  installFromZip,
  portOpen,
  REPO_ROOT,
  serverInfo,
  writePinned,
} from './ops.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const strahd = () => readJson(path.join(here, 'strahd-modules.json'));
const expectedList = () => readJson(path.join(here, 'expected.json')).expected ?? [];

export function parseArgs(argv) {
  const o = { cmd: '', server: 'B', ids: null, size: 'smoke', kit: true, green: false, fromReport: null, help: false };
  const args = [...argv];
  o.cmd = args[0] && !args[0].startsWith('--') ? args.shift() : '';
  const value = flag => {
    const v = args.shift();
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  while (args.length) {
    const a = args.shift();
    if (a === '--server') o.server = value(a);
    else if (a === '--ids') o.ids = value(a).split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--size') o.size = value(a);
    else if (a === '--from-report') o.fromReport = value(a);
    else if (a === '--no-kit') o.kit = false;
    else if (a === '--with-green') o.green = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!['smoke', 'full', 'long'].includes(o.size)) throw new Error('--size is smoke, full or long');
  return o;
}

const gitSha = () => spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
const stampNow = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);

function table(rows) {
  const w = [14, 22, 18, 18, 18, 4].map((n, i) => Math.max(n, ...rows.map(r => String(r[i] ?? '').length)));
  return rows.map(r => r.map((c, i) => String(c ?? '').padEnd(w[i])).join('  ').trimEnd()).join('\n');
}

async function lookUpstream(installed) {
  /** @type {Record<string, any>} */
  const upstream = {};
  await Promise.all(
    installed.map(async p => {
      if (p.manifest) upstream[p.id] = await fetchManifest(p.manifest);
    })
  );
  return upstream;
}

/** A test server must be stopped, and its lock free or ours, before files change under it. */
async function requireStopped(srv) {
  if (await portOpen(srv.FoundryPort)) throw new Notready(`server ${srv.name} is running on ${srv.FoundryPort}; stop it first`);
}
class Notready extends Error {}

async function cmdStatus(o, withUpstream) {
  const srv = serverInfo(o.server);
  const installed = scanInstalled(srv.dataDir);
  const pinned = readPinned(archiveRoot());
  const plan = planUpdates(installed, pinned, withUpstream ? await lookUpstream(installed) : {}, strahd());
  const rows = [['kind', 'id', 'installed', 'pinned', 'upstream', 'state']];
  for (const p of plan.filter(x => x.state !== 'pinned')) {
    rows.push([p.kind, p.id + (p.licensed ? '*' : ''), p.installed, p.pinned ?? '-', p.upstream ?? '-', p.state]);
  }
  console.log(`server ${srv.name}: ${installed.length} packages, ${plan.filter(p => p.state === 'pinned').length} match the pinned list`);
  console.log(table(rows));
  const missing = strahd().modules.filter(m => !installed.some(p => p.id === m.id)).map(m => m.id);
  if (missing.length) console.log(`Strahd list entries not installed on ${srv.name}: ${missing.join(', ')}`);
  console.log('* = licensed or Patreon: archived on this PC, never in a repo');
  return plan;
}

async function cmdStage(o) {
  const srv = serverInfo(o.server);
  const installed = scanInstalled(srv.dataDir);
  const plan = planUpdates(installed, readPinned(archiveRoot()), await lookUpstream(installed), strahd());
  const wanted = plan.filter(p => p.state === 'newer-upstream' && (!o.ids || o.ids.includes(p.id)));
  const root = archiveRoot();
  for (const p of wanted) {
    if (!p.download || !isSafeId(p.id) || !isSafeVersion(p.upstream)) {
      console.log(`skip ${p.id}: no usable download (licensed or private packages are staged by hand)`);
      continue;
    }
    const dest = path.join(root, 'staging', p.id, p.upstream, `${p.id}-${p.upstream}.zip`);
    const sha = await downloadZip(p.download, dest);
    console.log(`staged ${p.id} ${p.installed} -> ${p.upstream} (${sha.slice(0, 12)})`);
  }
  return wanted.length;
}

function stagedZip(id) {
  const base = path.join(archiveRoot(), 'staging', id);
  if (!existsSync(base)) return null;
  const versions = readdirSync(base).sort(compareVersions).reverse();
  return versions.length ? { version: versions[0], zip: path.join(base, versions[0], `${id}-${versions[0]}.zip`) } : null;
}

async function cmdInstall(o) {
  const srv = serverInfo(o.server);
  await requireStopped(srv);
  const stamp = stampNow();
  const rollbackDir = path.join(srv.Root, `module-rollback-${stamp}`);
  const staging = path.join(archiveRoot(), 'staging');
  const ids = o.ids ?? (existsSync(staging) ? readdirSync(staging) : []);
  for (const id of ids) {
    const s = stagedZip(id);
    if (!s || !existsSync(s.zip)) {
      console.log(`skip ${id}: nothing staged`);
      continue;
    }
    const kind = id === 'dnd5e' ? 'system' : 'module';
    installFromZip({ dataDir: srv.dataDir, kind, id, zip: s.zip, rollbackDir });
    console.log(`installed ${id} ${s.version} (old folder in ${rollbackDir})`);
  }
}

async function dashboardTool(port, name, args = {}) {
  const r = await fetch(`http://127.0.0.1:${port}/api/tool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, args }),
    signal: AbortSignal.timeout(30000),
  });
  return r.json();
}

/** Module errors from the bridge, as { module, text } findings. */
export function errorFindings(result) {
  const list = result?.result?.errors ?? result?.errors ?? [];
  return list.map(e => ({
    module: String(e.moduleId ?? e.module ?? e.id ?? '*'),
    text: String(e.message ?? e.error ?? JSON.stringify(e)).slice(0, 300),
  }));
}

function runStep(name, cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, ...env }, shell: process.platform === 'win32' && cmd === 'npm' });
  const tail = (r.stdout + r.stderr).trim().split('\n').slice(-3).join(' | ').slice(0, 300);
  return { name, status: r.status === 0 ? 'pass' : 'fail', detail: r.status === 0 ? undefined : `exit ${r.status}: ${tail}` };
}

async function cmdRun(o) {
  const srv = serverInfo(o.server);
  if (!(await portOpen(srv.DashboardPort))) throw new Notready(`no dashboard on ${srv.DashboardPort}: start server ${srv.name} (scripts/test-env/start.ps1 -Server ${srv.name}) with the lock held`);
  const root = archiveRoot();
  const installed = scanInstalled(srv.dataDir);
  const plan = planUpdates(installed, readPinned(root), {}, strahd());
  const steps = [];

  // 1. load check: every Strahd module installed is active at its installed version, no module errors.
  const mods = await dashboardTool(srv.DashboardPort, 'get-modules', {});
  const active = new Map(((mods.result?.modules ?? [])).map(m => [m.id ?? m.name, m]));
  const inactive = strahd().modules.filter(m => installed.some(p => p.id === m.id) && !active.get(m.id)?.active).map(m => m.id);
  steps.push({ name: 'load: Strahd modules active', status: inactive.length ? 'fail' : 'pass', detail: inactive.length ? `not active: ${inactive.join(', ')}` : undefined });
  const errs = errorFindings(await dashboardTool(srv.DashboardPort, 'get-module-errors', {}));
  const findings = splitFindings(errs, expectedList());
  steps.push({ name: 'load: module errors', status: findings.fresh.length ? 'fail' : 'pass', detail: `${errs.length} seen, ${findings.fresh.length} new` });

  // 2. the kit with the all-modules profile.
  if (o.kit) steps.push(runStep(`kit (${o.size}, modules-all)`, 'node', ['scripts/test-kit/kit-run.mjs', '--server', srv.name, '--profile', 'modules-all', '--size', o.size, '--keep-up', '--session', process.env.KIT_RUN_SESSION ?? 'rehearsal']));
  else steps.push({ name: 'kit', status: 'skip', detail: '--no-kit' });

  // 3. live:roundtrip and live:sweep talk to the dashboard on 3100, which is server A's.
  if (srv.name === 'A') {
    steps.push(runStep('live:roundtrip', 'node', ['scripts/live-roundtrip.mjs']));
    steps.push(runStep('live:sweep', 'node', ['scripts/live-read-sweep.mjs']));
  } else steps.push({ name: 'live:roundtrip and live:sweep', status: 'skip', detail: 'they use server A (dashboard 3100); run the rehearsal on A or run them there' });

  // 4. CI.
  steps.push(o.green ? runStep('npm run green', 'npm', ['run', 'green'], { CI: 'true' }) : { name: 'npm run green', status: 'skip', detail: 'pass --with-green' });

  const foundry = readFileSync(path.join(srv.Root, 'app', 'package.json'), 'utf8').match(/"version":\s*"([^"]+)"/)?.[1] ?? '?';
  const system = installed.find(p => p.id === 'dnd5e')?.version ?? '?';
  const stamp = stampNow();
  const dir = path.join(root, 'rehearsals', `${stamp}-${srv.name}`);
  mkdirSync(dir, { recursive: true });
  const report = { server: srv.name, stamp, gitSha: gitSha(), foundry, system, plan, steps, findings };
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(path.join(dir, 'report.md'), renderReport(report));
  console.log(`report: ${path.join(dir, 'report.md')}`);
  const ok = runPassed(steps) && !findings.fresh.length;
  console.log(ok ? 'PASS' : 'FAIL');
  return ok;
}

async function cmdArchive(o) {
  const srv = serverInfo(o.server);
  const root = archiveRoot();
  let rehearsal = null;
  if (o.fromReport) {
    const rep = readJson(path.join(o.fromReport, 'report.json'));
    if (!runPassed(rep.steps) || rep.findings.fresh.length) throw new Notready('that rehearsal did not pass; nothing is archived');
    rehearsal = path.basename(o.fromReport);
  } else if (!o.ids) throw new Notready('give --from-report <dir> (a passing rehearsal) or --ids with a rehearsal in mind');
  const installed = scanInstalled(srv.dataDir);
  const inList = new Map(strahd().modules.map(m => [m.id, m]));
  const ids = o.ids ?? installed.filter(p => p.kind === 'module').map(p => p.id);
  for (const id of ids) {
    const p = installed.find(x => x.id === id);
    if (!p) continue;
    const pin = readPinned(root)[p.kind === 'system' ? 'systems' : 'modules'][id];
    if (pin && compareVersions(pin.version, p.version) === 0) continue;
    const staged = stagedZip(id);
    await archivePackage({
      root, kind: p.kind, id, version: p.version,
      ...(staged && compareVersions(staged.version, p.version) === 0 ? { zip: staged.zip } : { installedDir: p.dir }),
      licensed: !!inList.get(id)?.licensed,
      testedOn: `server ${srv.name}`, rehearsal: rehearsal ?? undefined,
    });
    console.log(`archived ${id} ${p.version}${inList.get(id)?.licensed ? ' (licensed, PC only)' : ''}`);
  }
  const pinned = readPinned(root);
  writePinned(root, pinned);
}

function cmdPiPlan() {
  const root = archiveRoot();
  console.log(`# Pi mirror of the archive (printed, not run; Pi steps need the user's OK, a dietpi-backup snapshot and pi-work)`);
  console.log(`# from this PC: copy ${root} (not staging/ or rehearsals/) to ${PI_MIRROR_PATH} on the Pi`);
  console.log(`scp -r "${root}\\modules" "${root}\\systems" "${root}\\foundry" "${root}\\pinned.json" dietpi@<pi>:${PI_MIRROR_PATH}/`);
  console.log(`# on the Pi, the stage script installs every package in pinned.json from ${PI_MIRROR_PATH}, checks sha256, and never downloads.`);
}

const HELP = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^[/*# ]+/gm, '').trim();

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  if (o.help || !o.cmd) return console.log(HELP), o.help ? 0 : 2;
  try {
    if (o.cmd === 'status') await cmdStatus(o, false);
    else if (o.cmd === 'check') await cmdStatus(o, true);
    else if (o.cmd === 'stage') await cmdStage(o);
    else if (o.cmd === 'install') await cmdInstall(o);
    else if (o.cmd === 'run') return (await cmdRun(o)) ? 0 : 1;
    else if (o.cmd === 'archive') await cmdArchive(o);
    else if (o.cmd === 'pi-plan') cmdPiPlan();
    else return console.error(`unknown command ${o.cmd}`), 2;
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return e instanceof Notready ? 2 : 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main());
