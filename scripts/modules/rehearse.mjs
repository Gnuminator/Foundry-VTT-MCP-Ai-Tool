#!/usr/bin/env node
/**
 * Module update rehearsal (I-117, D-128). Lists modules, dnd5e and Foundry with a newer version than
 * the archive, installs them on a test server, runs the checks and writes a report; versions that
 * pass go into the local archive and the pinned list. The Pi installs only from that archive.
 *
 *   node scripts/modules/rehearse.mjs status  [--server B]       installed vs pinned list (offline)
 *   node scripts/modules/rehearse.mjs check   [--server B]       also asks each manifest for its newest
 *   node scripts/modules/rehearse.mjs stage   --server B [--ids a,b]   download newer zips to staging
 *   node scripts/modules/rehearse.mjs install --server B [--ids a,b]   staged zips into the server (stopped; REHEARSE_LOCK_SESSION=<your session id> when you hold its lock)
 *   node scripts/modules/rehearse.mjs run     --server B [--size smoke|full] [--no-kit] [--no-live] [--with-green]
 *   node scripts/modules/rehearse.mjs archive --server B [--ids a,b] [--from-report <dir>]... (repeatable)
 *   node scripts/modules/rehearse.mjs pi-plan                    the commands for the Pi mirror (printed, never run)
 *
 * The archive is $MODULE_ARCHIVE or C:\FoundryAI\module-archive (see lib.mjs). Licensed and Patreon
 * packages are archived like the rest and never in a repo or the vault. Test servers only: the live ports
 * 31414-31416 and the Pi are never touched. Exit codes: 0 ok, 1 a step failed or findings are new,
 * 2 not ready (server up/down, lock, bad arguments).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { kitHome } from '../test-kit/lib/targets.mjs';
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
  sha256File,
  splitFindings,
} from './lib.mjs';
import {
  archivePackage,
  downloadZip,
  fetchManifest,
  installFromZip,
  lockHolder,
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
  const o = { cmd: '', server: 'B', ids: null, size: 'smoke', kit: true, green: false, fromReports: [], live: true, help: false };
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
    else if (a === '--from-report') o.fromReports.push(value(a));
    else if (a === '--no-live') o.live = false;
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
  requireOurLock(srv);
}
class Notready extends Error {}

/** The server's lock must be held by REHEARSE_LOCK_SESSION. @param {{name: string, Root: string}} srv */
function requireOurLock(srv) {
  const held = lockHolder(srv);
  if (!held) throw new Notready(`take server ${srv.name}'s lock first (scripts/test-env/lock.ps1 take -Server ${srv.name}), then set REHEARSE_LOCK_SESSION to your session id`);
  if (!held.session || held.session !== process.env.REHEARSE_LOCK_SESSION) {
    throw new Notready(`server ${srv.name} is locked by "${held.holder}"; set REHEARSE_LOCK_SESSION to the session id that holds it`);
  }
}

/**
 * The module errors the kit's module-load scenario saw, from the report of the last kit run that
 * wrote one at or after `sinceMs` (<kit home>/last-run.json names its folder). Empty when there is
 * no such run or the scenario did not run.
 * @param {string} home @param {number} [sinceMs]
 */
export function kitModuleFindings(home, sinceMs = 0) {
  try {
    const last = readJson(path.join(home, 'last-run.json')).lastRun;
    if (!last?.reportDir) return [];
    const file = path.join(last.reportDir, 'report.json');
    if (statSync(file).mtimeMs < sinceMs) return [];
    const scenario = readJson(file).scenarios?.find(x => x.id === 'module-load');
    const found = scenario?.attachments?.find(a => a.name === 'module-findings')?.data;
    return Array.isArray(found) ? found : [];
  } catch {
    return [];
  }
}

/**
 * Packages whose installed version in a report's plan differs from the current scan (one that is
 * gone now counts too), as "id tested -> now".
 * @param {Array<{id: string, kind: string, installed: string}>} plan
 * @param {Array<{id: string, kind: string, version: string}>} installed
 */
export function versionMismatches(plan, installed) {
  return plan
    .map(p => {
      const now = installed.find(x => x.id === p.id && x.kind === p.kind);
      return !now || compareVersions(now.version, p.installed) !== 0 ? `${p.id} ${p.installed} -> ${now?.version ?? 'gone'}` : null;
    })
    .filter(Boolean);
}

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
  console.log(`old folders move to ${rollbackDir}`);
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

/**
 * Module errors from the bridge, as { module, text } findings. The module is the one the bridge
 * names, else the one in the stack's `/modules/<id>/` path, else '*'. `sinceMs` drops older entries
 * (the bridge keeps errors from earlier sessions).
 */
export function errorFindings(result, sinceMs = 0) {
  const list = result?.result?.errors ?? result?.errors ?? [];
  return list
    .filter(e => !e.timestampMs || e.timestampMs >= sinceMs)
    .map(e => ({
      module: String(
        e.moduleId ?? e.module ?? /\/modules\/([^/]+)\//.exec(`${e.stack ?? ''} ${e.source ?? ''}`)?.[1] ?? '*'
      ).replace(/^module:/, ''),
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
  // live:roundtrip and live:sweep write to server A's world: the lock has to be ours before they run.
  if (srv.name === 'A' && o.live) requireOurLock(srv);
  const startedMs = Date.now();
  const root = archiveRoot();
  const installed = scanInstalled(srv.dataDir);
  const plan = planUpdates(installed, readPinned(root), {}, strahd());
  let foundry;
  try {
    foundry = readFileSync(path.join(srv.AppDir, 'package.json'), 'utf8').match(/"version":\s*"([^"]+)"/)?.[1] ?? '?';
  } catch {
    throw new Notready(`no Foundry app folder at ${srv.AppDir} (appdir.txt next to the lock, or AppDir in scripts/test-env/local.json); nothing was run`);
  }
  const steps = [];

  // 1. live:roundtrip and live:sweep talk to the dashboard on 3100, which is server A's, in ai-tool-test.
  if (srv.name === 'A' && o.live) {
    steps.push(runStep('live:roundtrip', 'node', ['scripts/live-roundtrip.mjs']));
    steps.push(runStep('live:sweep', 'node', ['scripts/live-read-sweep.mjs']));
  } else steps.push({ name: 'live:roundtrip and live:sweep', status: 'skip', detail: srv.name === 'A' ? '--no-live' : 'they use server A (dashboard 3100); run the rehearsal on A or run them there' });


  // 2. the kit on the modules-all profile; it restarts the server in the kit world.
  if (o.kit) steps.push(runStep(`kit (${o.size}, modules-all)`, 'node', ['scripts/test-kit/kit-run.mjs', '--server', srv.name, '--profile', 'modules-all', '--size', o.size, '--keep-up', '--session', process.env.KIT_RUN_SESSION ?? process.env.REHEARSE_LOCK_SESSION ?? 'rehearsal']));
  else steps.push({ name: 'kit', status: 'skip', detail: '--no-kit' });


  // The load check (modules active, no new module errors) is the kit scenario module-load, so it
  // runs inside the kit in the kit world; its pass or fail is the kit step, and the errors it saw
  // come from the kit report, so this report lists them as known or new.
  const findings = splitFindings(o.kit ? kitModuleFindings(kitHome(), startedMs) : [], expectedList());

  // 3. CI.
  steps.push(o.green ? runStep('npm run green', 'npm', ['run', 'green'], { CI: 'true' }) : { name: 'npm run green', status: 'skip', detail: 'pass --with-green' });

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
  // One or more passing reports (a live pass and a kit pass may be separate runs): all must pass.
  for (const dir of o.fromReports) {
    const rep = readJson(path.join(dir, 'report.json'));
    if (!runPassed(rep.steps) || rep.findings.fresh.length) throw new Notready(`${dir} did not pass; nothing is archived`);
    if (rep.server !== srv.name) throw new Notready(`${dir} is a run on server ${rep.server}, not ${srv.name}`);
  }
  // npm run green alone tests no module: a kit step has to have passed in one of the reports.
  const kitPassed = o.fromReports.some(d => readJson(path.join(d, 'report.json')).steps.some(s => s.name.startsWith('kit') && s.status === 'pass'));
  if (o.fromReports.length && !kitPassed) throw new Notready('no report has a passing kit step; nothing is archived');
  if (!o.fromReports.length) throw new Notready('give --from-report <dir> (a passing rehearsal, repeatable); --ids only narrows it');
  const rehearsal = o.fromReports.map(d => path.basename(d)).join('+') || null;
  const installed = scanInstalled(srv.dataDir);
  // The reports describe the versions that were tested: archive nothing that has changed since.
  for (const dir of o.fromReports) {
    const changed = versionMismatches(readJson(path.join(dir, 'report.json')).plan ?? [], installed);
    if (changed.length) throw new Notready(`${dir} tested other versions than the server has now (${changed.join(', ')}); run the rehearsal again`);
  }
  await archiveFoundry(root, srv, rehearsal);
  const inList = new Map(strahd().modules.map(m => [m.id, m]));
  // Only the Strahd list goes in the pinned list (the test copy of our bridge and modules not on the
  // list stay out), plus the dnd5e system; --ids narrows that.
  const ids = (o.ids ?? installed.map(p => p.id)).filter(id => {
    const entry = inList.get(id);
    return id === 'dnd5e' ? installed.some(x => x.id === id && x.kind === 'system') : entry && entry.role !== 'ours';
  });
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

/** Pin the Foundry zip in the archive's foundry/ folder that matches the server's app version. */
async function archiveFoundry(root, srv, rehearsal) {
  const version = readJson(path.join(srv.AppDir, 'package.json')).version;
  const zip = path.join(root, 'foundry', `FoundryVTT-Node-${version.replace(/[.]0$/, '')}.zip`);
  if (!existsSync(zip)) return console.log(`foundry ${version}: no zip at ${zip}, not pinned`);
  const pinned = readPinned(root);
  if (pinned.foundry?.version === version) return;
  pinned.foundry = { version, file: path.relative(root, zip).replaceAll('\\', '/'), sha256: await sha256File(zip), testedOn: `server ${srv.name}`, ...(rehearsal ? { rehearsal } : {}) };
  pinned.updated = new Date().toISOString();
  writePinned(root, pinned);
  console.log(`archived Foundry ${version}`);
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
