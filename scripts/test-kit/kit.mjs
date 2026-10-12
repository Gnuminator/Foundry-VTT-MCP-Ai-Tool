#!/usr/bin/env node
/**
 * The test kit's command line. Plan: vault `Dev/Foundry AI Tool/Design/Test kit plan.md`.
 *
 *   node scripts/test-kit/kit.mjs <init|build|run|all|check> [options]   (see --help)
 *
 * Exit codes: 0 all scenarios passed, 1 a scenario failed (or a scenario file is invalid),
 * 2 the environment is not ready or a target was refused.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_PROFILE,
  EXIT,
  KIT_GM_USER,
  KIT_SIZES,
  KIT_WORLDS,
  KIT_FORMAT_VERSION,
  TOOLS_ONLY_TAG,
} from './lib/contract.mjs';
import { DEFAULT_COVERAGE_CAP } from './lib/coverage.mjs';
import { EnvError, KitToolError } from './lib/errors.mjs';
import { foundryDataDir, kitHome, kitWorldsDir, resolveTarget } from './lib/targets.mjs';
import {
  PI_WORLD,
  assertRemoteHost,
  piPreflight,
  readDashboardToken,
  reportTarget,
} from './lib/pi-target.mjs';
import { createPiGuard } from './lib/pi-guard.mjs';
import { loadProfile } from './lib/profiles.mjs';
import { createDashboardClient } from './lib/dashboard.mjs';
import { loadToolCatalog } from './lib/catalog.mjs';
import { loadScenarios } from './lib/loader.mjs';
import { runScenariosDetailed } from './lib/runner.mjs';
import { consoleSections, makeReport, newRunDir, writeReport } from './lib/report.mjs';
import { consoleSummaryLines } from './lib/console-errors.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..');
const REPO_SCENARIOS = path.join(here, 'scenarios');
const COMMANDS = ['init', 'build', 'run', 'all', 'check'];

export const HELP = `kit: the Foundry AI Tool test kit.

Usage: node scripts/test-kit/kit.mjs <command> [options]

Commands
  init     create the kit world's files and its users (Kit GM, Kit Player)
  build    open the GM session and build the kit (heroes, monsters, a combat scene); writes the manifest
  run      run the scenarios against the built kit and write a report
  all      build, then run
  check    load and validate every scenario against the tool catalog; no target needed (CI)

Options
  --size smoke|full|long   which scenarios to run (default smoke)
  --only a,b               run only these scenario ids
  --scenarios <dir>        extra scenario folder (repeatable); scripts/test-kit/scenarios is always used
  --profile <id>           the content profile: srd (default, in the repo) or a local file
                           <kit home>/licensed/profiles/<id>.json; it picks the kit world
  --classes a,b            build only these classes (identifier or name); a development filter
  --no-coverage            skip the coverage pass (extra heroes for play-changing options no hero picked;
                           it runs at size full and long, never at smoke)
  --coverage-cap <n>       the most coverage heroes one run builds (default ${DEFAULT_COVERAGE_CAP})
  --world <id>             the kit world, only to check it matches the profile: ${KIT_WORLDS.join(', ')}
  --report-dir <dir>       where the report goes (default <kit home>/reports/<time>-<size>)
  --fake                   run against the in-process fake instead of Foundry (CI)
  --headed                 show the GM browser window
  --target local|pi        where to run (default local: this PC's test server). pi is opt-in and
                           tools-only: only "run", only scenarios tagged tools-only, through the
                           Orange Pi's dashboard, in its throwaway world ${PI_WORLD}. It needs the
                           targets file (%LOCALAPPDATA%\\foundry-ai-tool\\kit-targets.json, or env
                           KIT_TARGETS_FILE: host and ports only) and --not-game-night; it never
                           builds, wipes or inits, and refuses --fake, --scenarios, --profile and any other --world
  --not-game-night         with --target pi: confirm today is not a game night (the kit never runs
                           on the Pi on a game-night day)
  --help                   this text

Only one test server's dashboard and Foundry are used: FOUNDRY_TEST_SERVER=A (the default,
127.0.0.1:3100 and 127.0.0.1:30001) or B (3101 and 30002; npm run kit:run uses B); the live
bridge ports 31414 to 31416 are refused. Kit home: env TEST_KIT_HOME or C:\\FoundryTest\\test-kit.
Exit codes: 0 all passed, 1 a scenario failed, 2 environment not ready or target refused.

Example (the Pi's tools-only canvas probe):
  node scripts/test-kit/kit.mjs run --target pi --not-game-night --size smoke --only canvas-tools-headless`;

/**
 * @param {string[]} argv
 * @returns {{command: string | null, size: string, only: string[], scenarios: string[], world: string | null, profile: string, classes: string[], coverage: boolean, coverageCap: number, reportDir: string | null, fake: boolean, headed: boolean, target: 'local' | 'pi', notGameNight: boolean, help: boolean}}
 */
export function parseArgs(argv) {
  const o = {
    command: null,
    size: 'smoke',
    only: [],
    scenarios: [],
    world: null,
    profile: DEFAULT_PROFILE,
    classes: [],
    coverage: true,
    coverageCap: DEFAULT_COVERAGE_CAP,
    reportDir: null,
    fake: false,
    headed: false,
    target: /** @type {'local' | 'pi'} */ ('local'),
    notGameNight: false,
    help: false,
  };
  const args = [...argv];
  const value = (/** @type {string} */ flag) => {
    const v = args.shift();
    if (v === undefined || v.startsWith('--')) throw new EnvError(`${flag} needs a value`);
    return v;
  };
  while (args.length) {
    const a = /** @type {string} */ (args.shift());
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--fake') o.fake = true;
    else if (a === '--headed') o.headed = true;
    else if (a === '--not-game-night') o.notGameNight = true;
    else if (a === '--target') {
      const v = value(a);
      if (v !== 'local' && v !== 'pi') {
        throw new EnvError(`--target must be local or pi, not "${v}"`);
      }
      o.target = v;
    } else if (a === '--size') o.size = value(a);
    else if (a === '--only')
      o.only.push(
        ...value(a)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      );
    else if (a === '--scenarios') o.scenarios.push(path.resolve(value(a)));
    else if (a === '--world') o.world = value(a);
    else if (a === '--profile') o.profile = value(a);
    else if (a === '--classes')
      o.classes.push(
        ...value(a)
          .split(',')
          .map(s => s.trim().toLowerCase())
          .filter(Boolean)
      );
    else if (a === '--no-coverage') o.coverage = false;
    else if (a === '--coverage-cap') {
      const n = Number(value(a));
      if (!Number.isInteger(n) || n < 0)
        throw new EnvError('--coverage-cap must be a whole number, 0 or more');
      o.coverageCap = n;
    } else if (a === '--report-dir') o.reportDir = path.resolve(value(a));
    else if (a.startsWith('-')) throw new EnvError(`unknown option ${a} (see --help)`);
    else if (o.command === null) o.command = a;
    else throw new EnvError(`unexpected argument "${a}" (see --help)`);
  }
  if (!KIT_SIZES.includes(o.size)) {
    throw new EnvError(`--size must be one of ${KIT_SIZES.join(', ')}`);
  }
  if (o.command !== null && !COMMANDS.includes(o.command)) {
    throw new EnvError(`unknown command "${o.command}" (${COMMANDS.join(', ')})`);
  }
  return o;
}

function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Dynamic import of a sibling module another worker owns; a missing file is an EnvError, so
 * `check` works without them.
 * @param {string} rel
 */
async function importLib(rel) {
  const file = path.join(here, rel);
  if (!existsSync(file)) throw new EnvError(`${rel} is not there yet (scripts/test-kit/${rel})`);
  return import(pathToFileURL(file).href);
}

/**
 * Loads the profile named by --profile, checks --world against it and sets o.world. A profile
 * names its kit world; the world must be one of KIT_WORLDS (profiles.mjs refuses others).
 * @param {any} o
 */
function resolveProfile(o) {
  const profile = loadProfile(o.profile);
  if (o.world && o.world !== profile.world) {
    throw new EnvError(
      `--world ${o.world} does not match profile "${profile.id}" (its world is ${profile.world})`
    );
  }
  o.world = profile.world;
  o.profileData = profile;
}

/** @param {string} line */
function say(line) {
  console.log(line);
}

/**
 * The checks before a run against a real target: dashboard up, control channel connected, and
 * the connected world is the kit world.
 * @param {ReturnType<typeof createDashboardClient>} dashboard
 * @param {string} world
 */
export async function preflight(dashboard, world) {
  const h = await dashboard.health();
  if (!h || h.ok !== true) throw new EnvError('the dashboard /api/health is not ok');
  if (h.controlChannel !== 'connected') {
    throw new EnvError(
      `the dashboard's control channel is "${h.controlChannel}" (start the test bridge, join the world as a GM)`
    );
  }
  let info;
  try {
    info = await dashboard.tool('get-world-info', {});
  } catch (e) {
    if (e instanceof KitToolError && /not connected/i.test(e.message)) {
      throw new EnvError('the bridge has no Foundry link (join the kit world as a GM)');
    }
    throw e;
  }
  if (!info || info.id !== world) {
    throw new EnvError(
      `the connected world is "${info && info.id}", the kit target is "${world}"; refusing to run`
    );
  }
}

/**
 * {@link preflight}, retried while the bridge has no Foundry link yet (the module dials the bridge
 * a few seconds after the GM page is ready).
 * @param {ReturnType<typeof createDashboardClient>} dashboard
 * @param {string} world
 * @param {number} [timeoutMs]
 */
export async function waitForLink(dashboard, world, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await preflight(dashboard, world);
    } catch (e) {
      const waiting = e instanceof EnvError && /no Foundry link|control channel/.test(e.message);
      if (!waiting || Date.now() > until) throw e;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

/** @param {string} world */
function manifestPath(world) {
  return path.join(kitWorldsDir(), world, 'manifest.json');
}

/** @param {string} file */
function readManifest(file) {
  if (!existsSync(file)) {
    throw new EnvError(`no manifest at ${file}: run "kit build" first`);
  }
  const m = JSON.parse(readFileSync(file, 'utf8'));
  if (m.version !== KIT_FORMAT_VERSION) {
    throw new EnvError(
      `manifest version ${m.version}, expected ${KIT_FORMAT_VERSION}: rebuild the kit`
    );
  }
  return m;
}

/**
 * Starts the fake when asked; exits 2 with a clear message when it is missing.
 * @param {{fake: boolean, world: string}} opts
 */
async function maybeStartFake({ fake, world }) {
  if (!fake) return null;
  const file = path.join(here, 'lib', 'fake', 'index.mjs');
  if (!existsSync(file)) {
    throw new EnvError('--fake: scripts/test-kit/lib/fake/index.mjs does not exist yet');
  }
  const mod = await import(pathToFileURL(file).href);
  return mod.startFake({ world });
}

/** The scenario folders: the repo's own, then the ones named with --scenarios. */
function scenarioDirs(/** @type {string[]} */ extra) {
  return [REPO_SCENARIOS, ...extra];
}

/**
 * Writes the report files and prints the summary lines of a run.
 * @param {ReturnType<typeof makeReport>} report
 * @param {string} dir
 */
function writeAndSayReport(report, dir) {
  const files = writeReport(report, dir);
  const s = report.summary;
  say('');
  say(`${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped of ${s.total}`);
  const con = consoleSections(report);
  for (const line of consoleSummaryLines(con.run)) say(line);
  if (con.build.length) {
    for (const line of consoleSummaryLines(con.build)) say(`build ${line}`);
  }
  say(`report: ${files.html}`);
  return s;
}

// --- commands -----------------------------------------------------------------

async function cmdCheck(o) {
  const catalog = await loadToolCatalog(REPO_ROOT).catch(e => {
    throw new EnvError(e.message);
  });
  const { scenarios, problems } = await loadScenarios(scenarioDirs(o.scenarios), { catalog });
  for (const p of problems) say(`PROBLEM ${p}`);
  const bySize = KIT_SIZES.map(
    s => `${s} ${scenarios.filter(x => x.scenario.sizes.includes(s)).length}`
  );
  say(`${scenarios.length} scenarios valid (${bySize.join(', ')}), ${problems.length} problems`);
  return problems.length ? EXIT.FAIL : EXIT.PASS;
}

/** Builds the kit and returns the manifest. @param {any} o @param {{dashboard: any, gm: any}} c */
async function doBuild(o, { dashboard, gm }) {
  const { buildKit } = await importLib('lib/builder.mjs');
  say(`building the kit in ${o.world} ...`);
  return buildKit({
    dashboard,
    gm,
    world: o.world,
    size: o.size,
    profile: o.profileData,
    classes: o.classes,
    coverage: o.coverage,
    coverageCap: o.coverageCap,
    log: say,
  });
}

/** Opens a GM session on the real Foundry. */
async function openGm(o, target) {
  const { openGmSession } = await importLib('lib/gm.mjs');
  return openGmSession({
    foundryUrl: target.foundry,
    world: o.world,
    user: KIT_GM_USER,
    headless: !o.headed,
    log: say,
  });
}

/** Writes a manifest to its place (real) or the report dir (fake, when given). */
function saveManifest(o, manifest) {
  const file = o.fake
    ? o.reportDir && path.join(o.reportDir, 'manifest.json')
    : manifestPath(o.world);
  if (!file) {
    say('fake: manifest not written (pass --report-dir to keep it)');
    return null;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  say(`manifest written: ${file}`);
  return file;
}

async function cmdInit(o) {
  if (o.fake) throw new EnvError('init has no fake mode');
  const target = resolveTarget({ world: o.world });
  const { initWorld, provisionWorld } = await importLib('lib/world.mjs');
  const made = await initWorld({
    dataDir: foundryDataDir(REPO_ROOT),
    profile: o.profileData,
    log: say,
  });
  say(`world files: ${made.created ? 'created' : 'already there'} at ${made.path}`);
  // Foundry must run this world before it can be provisioned: say how, instead of failing in fetch.
  const running = await fetch(`${target.foundry}/api/status`)
    .then(r => r.json())
    .then(s => (typeof s.world === 'string' ? s.world : ''))
    .catch(() => null);
  if (running !== o.world) {
    throw new EnvError(
      `world files are ready; start Foundry on ${o.world} (pwsh scripts/test-env/start.ps1 -World ${o.world}${target.server === 'A' ? '' : ` -Server ${target.server}`}) and run init again to provision it`
    );
  }
  await provisionWorld({
    foundryUrl: target.foundry,
    world: o.world,
    modules: o.profileData.modules,
    log: say,
  });
  say('world provisioned');
  return EXIT.PASS;
}

/**
 * build / run / all share the target setup.
 * @param {'build' | 'run' | 'all'} command
 */
async function cmdTarget(command, o) {
  const fake = await maybeStartFake(o);
  /** @type {any} */
  let gmSession = null;
  /** @type {ReturnType<typeof createDashboardClient> | null} */
  let dashboard = null;
  let gmActionsBefore = null;
  const startedAt = new Date();
  try {
    const target = resolveTarget({ world: o.world, fake: o.fake, fakeBase: fake && fake.base });
    // Load scenarios first, so a bad scenario file fails before anything is opened or built.
    let list = [];
    if (command !== 'build') {
      const catalog = await loadToolCatalog(REPO_ROOT).catch(e => {
        throw new EnvError(e.message);
      });
      const loaded = await loadScenarios(scenarioDirs(o.scenarios), {
        size: o.size,
        only: o.only,
        catalog,
      });
      if (loaded.problems.length) {
        for (const p of loaded.problems) say(`PROBLEM ${p}`);
        say(`${loaded.problems.length} scenario problems; nothing was run`);
        return EXIT.FAIL;
      }
      list = loaded.scenarios;
    }

    dashboard = createDashboardClient({ base: target.dashboard });
    let gm = fake ? fake.gm : null;
    if (!fake) {
      // The Kit GM page holds the bridge's Foundry link (the bridge user), so open it first and
      // give the module a moment to dial the bridge.
      gmSession = await openGm(o, target);
      gm = gmSession;
      await waitForLink(dashboard, o.world);
    }
    // GM Actions on for the run, put back as found (the fake keeps the switch too).
    gmActionsBefore = await dashboard.getGmActions();
    if (!gmActionsBefore) await dashboard.setGmActions(true);

    /** @type {any} */
    let manifest = null;
    if (command === 'build' || command === 'all' || (command === 'run' && fake)) {
      manifest = await doBuild(o, { dashboard, gm });
      if (command !== 'run') saveManifest(o, manifest);
    } else {
      manifest = readManifest(manifestPath(o.world));
    }
    if (command === 'build') return EXIT.PASS;

    if (!list.length) {
      say(`no scenarios for size ${o.size}; nothing to run`);
      return EXIT.PASS;
    }
    say(`running ${list.length} scenarios (${o.size}) in ${o.world}`);
    // The report folder is decided before the scenarios run, so t.attachFile can write into it.
    const dir = o.reportDir || newRunDir(kitHome(), o.size);
    mkdirSync(dir, { recursive: true });
    // Dashboard pages in the GM's Edge for the scenarios (not against the fake, which has no Edge).
    /** @type {any} */
    let browserFactory;
    if (!fake && gmSession?.page) {
      const { createKitBrowser } = await importLib('lib/dashboard-browser.mjs');
      const context = gmSession.page.context();
      browserFactory = (scenarioId, sink) =>
        createKitBrowser({ dashboardUrl: target.dashboard, context, scenarioId, sink });
    }
    /** @type {any[]} */
    let results = [];
    /** @type {any[]} */
    let consoleErrors = [];
    /** @type {EnvError | null} */
    let envProblem = null;
    try {
      ({ results, consoleErrors } = await runScenariosDetailed(list, {
        dashboard,
        gm,
        manifest,
        fake: o.fake,
        size: /** @type {'smoke'|'full'|'long'} */ (o.size),
        log: say,
        ...(browserFactory ? { browserFactory, filesDir: path.join(dir, 'files') } : {}),
      }));
    } catch (e) {
      if (!(e instanceof EnvError)) throw e;
      envProblem = e;
      results = /** @type {any} */ (e).partialResults || [];
      consoleErrors = /** @type {any} */ (e).partialConsoleErrors || [];
    }

    const report = makeReport({
      size: o.size,
      target,
      startedAt,
      gitSha: gitSha(),
      fake: o.fake,
      build: manifest,
      results,
      consoleErrors,
    });
    const s = writeAndSayReport(report, dir);
    if (envProblem) throw envProblem;
    return s.failed ? EXIT.FAIL : EXIT.PASS;
  } finally {
    if (gmSession) await gmSession.close().catch(() => {});
    if (dashboard && gmActionsBefore === false) {
      await dashboard.setGmActions(false).catch(() => {});
    }
    if (fake) await Promise.resolve(fake.close()).catch(() => {});
  }
}

/**
 * The options `--target pi` allows: only `run` (or `check`, which needs no target), no fake, the
 * default profile, no other world than strahd-kit. Everything here exits 2 with a clear message.
 * @param {ReturnType<typeof parseArgs>} o
 */
export function checkPiOptions(o) {
  if (o.target !== 'pi') return;
  if (o.command === 'init' || o.command === 'build' || o.command === 'all') {
    throw new EnvError(
      `REFUSED: --target pi allows only "run": the Pi's ${PI_WORLD} is made by the kit session, and the kit never builds, wipes or inits there.`
    );
  }
  if (o.command === 'check') return;
  if (o.fake) throw new EnvError('REFUSED: --target pi never combines with --fake.');
  if (o.profile !== DEFAULT_PROFILE) {
    throw new EnvError(
      `REFUSED: --target pi takes no --profile (its world is fixed: ${PI_WORLD}).`
    );
  }
  if (o.world && o.world !== PI_WORLD) {
    throw new EnvError(`REFUSED: --target pi runs only in ${PI_WORLD}, not ${o.world}.`);
  }
}

/**
 * The scenarios the pi target may run: tagged `tools-only`, of the size asked for. `--only` must
 * name such scenarios; anything else is refused with the allowed ids.
 * @param {Array<{scenario: any, file: string, dir: string}>} all every loaded scenario
 * @param {{size: string, only: string[]}} o
 */
export function selectToolsOnly(all, { size, only }) {
  const allowed = all.filter(
    ({ scenario }) => scenario.tags.includes(TOOLS_ONLY_TAG) && scenario.sizes.includes(size)
  );
  const allowedIds = allowed.map(({ scenario }) => scenario.id);
  for (const id of only) {
    const found = all.find(({ scenario }) => scenario.id === id);
    if (!found) {
      throw new EnvError(
        `--only: no scenario with id "${id}" (the Pi run allows: ${allowedIds.join(', ') || 'none'})`
      );
    }
    if (!allowedIds.includes(id)) {
      throw new EnvError(
        `REFUSED: scenario "${id}" is not tools-only at size ${size}; the Pi run allows: ${allowedIds.join(', ') || 'none'}`
      );
    }
  }
  return only.length ? allowed.filter(({ scenario }) => only.includes(scenario.id)) : allowed;
}

/**
 * `run --target pi`: the tools-only scenarios through the Pi's dashboard. No GM browser, no GM
 * actions switch, no manifest on disk: the Pi's headless Kit GM holds the bridge link.
 * Every tool call goes through the guard of lib/pi-guard.mjs: only the scenario's declared read
 * or plan tools, never a confirmation, and only while the bridge is still in strahd-kit. Scenario
 * folders from `--scenarios` are refused: only the repo's own scenarios run on the Pi.
 * `deps` lets a test stand in for the Pi (resolve the target to the in-process fake, skip the
 * Foundry status check and the name lookup, use a scenario folder of its own); the real run uses
 * the defaults.
 * @param {ReturnType<typeof parseArgs>} o
 * @param {{resolve?: typeof resolveTarget, preflight?: typeof piPreflight, lookup?: (host: string, opts: {all: true}) => Promise<Array<{address: string}>>, dirs?: string[], worldCheckTtlMs?: number}} [deps]
 */
export async function piRun(
  o,
  { resolve = resolveTarget, preflight = piPreflight, lookup, dirs, worldCheckTtlMs } = {}
) {
  if (o.scenarios.length) {
    throw new EnvError(
      'REFUSED: --target pi runs only the scenarios of the repo, not --scenarios folders.'
    );
  }
  const startedAt = new Date();
  const target = resolve({ name: 'pi', world: o.world, notGameNight: o.notGameNight });
  const catalog = await loadToolCatalog(REPO_ROOT).catch(e => {
    throw new EnvError(e.message);
  });
  const loaded = await loadScenarios(dirs ?? scenarioDirs([]), { catalog });
  if (loaded.problems.length) {
    for (const p of loaded.problems) say(`PROBLEM ${p}`);
    say(`${loaded.problems.length} scenario problems; nothing was run`);
    return EXIT.FAIL;
  }
  const list = selectToolsOnly(loaded.scenarios, o);
  if (!list.length) {
    say(`no tools-only scenarios for size ${o.size}; nothing to run`);
    return EXIT.PASS;
  }
  say(`target pi: ${target.host}, dashboard ${target.dashboard}, Foundry ${target.foundry}`);
  await assertRemoteHost(target.host, lookup ? { lookup } : {});
  await preflight(target);
  // The token comes from its file when the targets file names one, else COGM_TOKEN as locally.
  const token = readDashboardToken(target);
  const dashboard = createDashboardClient({
    base: target.dashboard,
    ...(token ? { token } : {}),
  });
  await waitForLink(dashboard, target.world);
  const guard = createPiGuard(dashboard, {
    world: target.world,
    ...(worldCheckTtlMs !== undefined ? { ttlMs: worldCheckTtlMs } : {}),
  });
  // The scenarios only read t.kit.world; the real manifest belongs to this PC's kit worlds.
  const manifest = /** @type {any} */ ({
    version: KIT_FORMAT_VERSION,
    world: target.world,
    builtAt: startedAt.toISOString(),
    systemVersion: '',
    folders: {},
    profile: 'pi-tools-only',
    heroes: [],
    monsters: [],
  });
  const dir = o.reportDir || newRunDir(kitHome(), o.size);
  mkdirSync(dir, { recursive: true });
  say(`running ${list.length} tools-only scenarios (${o.size}) in ${target.world} on the Pi`);
  /** @type {any[]} */
  let results = [];
  /** @type {EnvError | null} */
  let envProblem = null;
  try {
    ({ results } = await runScenariosDetailed(list, {
      // a scenario gets its own guarded client; the default one has no tools, so it refuses all
      dashboard: guard.forScenario({ id: 'pi-run', tools: [] }),
      dashboardFor: scenario => guard.forScenario(scenario),
      manifest,
      fake: false,
      size: /** @type {'smoke'|'full'|'long'} */ (o.size),
      log: say,
    }));
  } catch (e) {
    if (!(e instanceof EnvError)) throw e;
    envProblem = e;
    results = /** @type {any} */ (e).partialResults || [];
  }
  const report = makeReport({
    size: o.size,
    target: reportTarget(target),
    startedAt,
    gitSha: gitSha(),
    fake: false,
    build: null,
    results,
  });
  const s = writeAndSayReport(report, dir);
  if (envProblem) throw envProblem;
  return s.failed ? EXIT.FAIL : EXIT.PASS;
}

/** @param {string[]} argv */
export async function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
    if (o.help) {
      say(HELP);
      return EXIT.PASS;
    }
    if (!o.command) {
      say(HELP);
      return EXIT.ENV;
    }
    checkPiOptions(o);
    if (o.command === 'check') return await cmdCheck(o);
    if (o.target === 'pi') return await piRun(o);
    resolveProfile(o);
    if (o.command === 'init') return await cmdInit(o);
    return await cmdTarget(/** @type {'build' | 'run' | 'all'} */ (o.command), o);
  } catch (e) {
    if (e instanceof EnvError) {
      console.error(`ENV ${e.message}`);
      return EXIT.ENV;
    }
    console.error(`ERROR ${e instanceof Error ? e.stack || e.message : String(e)}`);
    return EXIT.FAIL;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  });
}
