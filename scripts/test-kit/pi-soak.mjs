#!/usr/bin/env node
/**
 * The Pi soak (backlog `pi-soak`, gate G1, decision D-110): N simulated players on the Pi's throwaway
 * world `strahd-kit` for a set time (default 3 hours), while the Pi is watched over read-only ssh.
 *
 *   node scripts/test-kit/pi-soak.mjs --not-game-night [--writes] [--players 5] [--duration-min 180]
 *        [--window-seconds 10] --label "systemd stack, v0.33.0" [--out-dir <folder>] [--vault-note <file.md>]
 *
 * Needs the kit session up WITH the soak players (kit-session.sh MODE=up SOAK_PLAYERS=5: users
 * "Kit Player" and "Kit Player 2".."Kit Player 5", no password; docs/dev/PI-SETUP.md). That is a Pi
 * change and happens only through the stage script with the user's OK; this runner changes nothing on
 * the Pi by itself:
 *  - Pi side: one read-only ssh command per window (CPU per systemd unit, iowait, memory, temperature,
 *    core clocks, unit states; nothing is written on the Pi). The ssh alias is `foundry-pi`
 *    (PI_SSH_ALIAS overrides it).
 *  - Players: one headless browser each on this PC, joined to the Pi's Foundry as the passwordless
 *    kit users; they roll in chat, open and close sheets and switch sidebar tabs at random.
 *  - The dashboard: health, world info, prep digest, party and a party plan on a rhythm (reads and
 *    plan-* tools only, through the Pi guard).
 *  - With --writes, and only then: a small plan, apply and undo of 1 to 5 HP on one actor of strahd-kit and a
 *    whispered NPC roll, through the soak guard (lib/pi-soak-guard.mjs): world checked before every
 *    write, the net change is zero, no other tool and no other world.
 * The report (JSON and Markdown) goes to --out-dir (default %LOCALAPPDATA%\foundry-ai-tool\soak, outside the
 * repo); --vault-note also writes the Markdown where you say. Exit 0 pass, 1 fail, 2 refused or not set up.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createDashboardClient } from './lib/dashboard.mjs';
import { EnvError } from './lib/errors.mjs';
import { joinAs } from './lib/gm.mjs';
import { piPreflight, readDashboardToken, resolvePiTarget } from './lib/pi-target.mjs';
import { createPiSoakGuard } from './lib/pi-soak-guard.mjs';
import { REMOTE_SAMPLE } from './pi-measure.mjs';
import {
  FOUNDRY_UNIT,
  buildRecord,
  evaluate,
  isThrottled,
  remoteExtras,
  renderReport,
  stamp,
  summarize,
} from './lib/pi-soak-lib.mjs';

const execFileP = promisify(execFile);

/** @param {string[]} argv @param {string} k @param {string} d */
const opt = (argv, k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};

/** Parses and checks the command line. @param {string[]} argv */
export function parseArgs(argv) {
  const num = (
    /** @type {string} */ k,
    /** @type {string} */ d,
    /** @type {number} */ lo,
    /** @type {number} */ hi
  ) => {
    const raw = opt(argv, k, d);
    const n = Number(raw);
    if (!Number.isFinite(n) || n < lo || n > hi) {
      throw new EnvError(`${k} must be a number from ${lo} to ${hi} (got "${raw}")`);
    }
    return n;
  };
  const label = opt(argv, '--label', '');
  if (!label)
    throw new EnvError('--label is required, for example --label "systemd stack, v0.33.0"');
  return {
    notGameNight: argv.includes('--not-game-night'),
    writes: argv.includes('--writes'),
    players: num('--players', '5', 1, 5),
    durationMin: num('--duration-min', '180', 0.5, 600),
    windowSeconds: num('--window-seconds', '10', 5, 60),
    label,
    outDir: opt(
      argv,
      '--out-dir',
      path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'foundry-ai-tool',
        'soak'
      )
    ),
    vaultNote: opt(argv, '--vault-note', ''),
  };
}

/** The user names the stage makes: Kit Player, then Kit Player 2 to n. @param {number} n */
export function playerNames(n) {
  return Array.from({ length: n }, (_, i) => (i === 0 ? 'Kit Player' : `Kit Player ${i + 1}`));
}

const sleep = (/** @type {number} */ ms) => new Promise(r => setTimeout(r, ms));
const rand = (/** @type {number} */ lo, /** @type {number} */ hi) => lo + Math.random() * (hi - lo);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = resolvePiTarget({ notGameNight: args.notGameNight });
  await piPreflight(target);
  const token = readDashboardToken(target) ?? '';
  const dash = createDashboardClient({ base: target.dashboard, token });
  await dash.health();
  const guard = createPiSoakGuard(dash, { world: target.world, allowWrites: args.writes });
  const reads = guard.forSoak([
    'get-world-info',
    'get-prep-digest',
    'get-party',
    'plan-party-change',
    'list-characters',
  ]);
  await reads.tool('get-world-info', {});
  const alias = process.env.PI_SSH_ALIAS || 'foundry-pi';
  const startedAt = new Date();
  const deadline = startedAt.getTime() + args.durationMin * 60_000;
  const state = { stop: false, reason: '' };
  const stop = (/** @type {string} */ why) => {
    if (!state.stop) {
      state.stop = true;
      state.reason = why;
      console.log(`stopping: ${why}`);
    }
  };
  process.on('SIGINT', () => stop('interrupted'));
  /** @type {string[]} */
  const events = [];
  /** @type {string[]} */
  const notes = [];
  const note = (/** @type {string} */ m) => {
    events.push(`${new Date().toISOString().slice(11, 19)} ${m}`);
  };
  /** @type {Record<string, number[]>} */
  const series = {};
  const add = (/** @type {string} */ k, /** @type {number} */ ms) =>
    (series[k] ??= []).push(Math.round(ms));
  /** @type {ReturnType<typeof buildRecord>[]} */
  const records = [];
  let samplingGaps = 0;
  let linkDrops = 0;
  /** @type {number[]} */
  const writeToDashboardMs = [];

  // ---- the Pi sampler: back-to-back windows, read-only ----
  const sampler = (async () => {
    let prev = null;
    while (!state.stop) {
      try {
        const p = execFileP(
          'ssh',
          [
            '-o',
            'BatchMode=yes',
            '-o',
            'ConnectTimeout=10',
            '-o',
            'ServerAliveInterval=10',
            alias,
            'bash',
            '-s',
            '--',
            String(args.windowSeconds),
          ],
          { maxBuffer: 8 << 20, timeout: (args.windowSeconds + 45) * 1000 }
        );
        p.child.stdin?.on('error', () => {});
        p.child.stdin?.end(REMOTE_SAMPLE + remoteExtras());
        const rec = buildRecord((await p).stdout, prev);
        records.push(rec);
        prev = rec.counters;
        for (const e of rec.unitEvents) note(`UNIT ${e}`);
        if (isThrottled(rec))
          note(`THROTTLE temp ${rec.tempC} C, busy ${rec.busyPct?.toFixed(0)} %`);
        if (rec.foundryCpu !== null && rec.foundryCpu > 70)
          note(
            `CPU foundry ${rec.foundryCpu.toFixed(0)} % in a ${rec.seconds.toFixed(0)} s window`
          );
      } catch (e) {
        samplingGaps += 1;
        note(`SAMPLE failed: ${String(e).split('\n')[0].slice(0, 120)}`);
        await sleep(3000);
      }
    }
  })();

  // ---- the dashboard rhythm ----
  let lastChannel = 'connected';
  const dashLoop = (async () => {
    let n = 0;
    while (!state.stop) {
      n += 1;
      try {
        const t0 = performance.now();
        const h = await dash.health();
        add('GET /api/health', performance.now() - t0);
        if (h.controlChannel !== 'connected' && lastChannel === 'connected') {
          linkDrops += 1;
          note(`LINK bridge link says ${JSON.stringify(h.controlChannel)}`);
        }
        lastChannel = h.controlChannel;
        const time = async (/** @type {string} */ k, /** @type {() => Promise<unknown>} */ fn) => {
          const t = performance.now();
          await fn();
          add(k, performance.now() - t);
        };
        await time('get-world-info', () => reads.tool('get-world-info', {}));
        if (n % 2 === 0) await time('get-prep-digest', () => reads.tool('get-prep-digest', {}));
        if (n % 2 === 1) await time('get-party', () => reads.tool('get-party', {}));
      } catch (e) {
        if (e instanceof EnvError && /REFUSED/.test(e.message)) {
          stop(e.message);
          return;
        }
        if (/nothing is listening|timed out/.test(String(e))) {
          linkDrops += 1;
          note(`LINK dashboard call failed: ${String(e).slice(0, 100)}`);
        } else {
          note(`dashboard call failed: ${String(e).slice(0, 120)}`);
        }
      }
      await sleep(30_000);
    }
  })();

  // ---- guarded writes (only with --writes) ----
  const writeLoop = (async () => {
    if (!args.writes) return;
    /** @type {string | null} */
    let hp = null;
    /** @type {string | null} */
    let npc = null;
    try {
      const list = await reads.tool('list-characters', {});
      const items = Array.isArray(list) ? list : (list?.characters ?? list?.actors ?? []);
      hp = items.find((/** @type {any} */ a) => typeof a?.name === 'string')?.name ?? null;
      npc =
        items.find((/** @type {any} */ a) => a?.type === 'npc' && typeof a?.name === 'string')
          ?.name ?? null;
    } catch (e) {
      notes.push(`list-characters failed, no write target: ${String(e).slice(0, 100)}`);
    }
    if (!hp) notes.push('no actor found for the plan/apply/undo timing; writes skipped');
    let i = 0;
    while (!state.stop && hp) {
      i += 1;
      try {
        const r = await guard.damageRoundTrip({ target: hp, action: 'damage', amount: 1 });
        add('plan-actor-change (plan)', r.planMs);
        add('apply-planned-change', r.applyMs);
        add('undo-change', r.undoMs);
        writeToDashboardMs.push(Math.round(r.planMs + r.applyMs));
        if (npc && i % 2 === 0) {
          add('roll-npc-check', (await guard.roll({ actor: npc, ability: 'str' })).rollMs);
        }
      } catch (e) {
        if (e instanceof EnvError) {
          stop(e.message);
          return;
        }
        note(`guarded write failed: ${String(e).slice(0, 140)}`);
        if (/write|switch|not enabled|disabled/i.test(String(e))) {
          notes.push(`guarded writes seem switched off in the world: ${String(e).slice(0, 140)}`);
          return;
        }
      }
      await sleep(60_000);
    }
  })();

  // ---- the players ----
  const names = playerNames(args.players);
  /** @type {Awaited<ReturnType<typeof joinAs>>[]} */
  const sessions = [];
  const closeAll = async () => {
    for (const s of sessions) await s.close().catch(() => {});
  };
  /** @type {Promise<void>[]} */
  const playerLoops = [];
  try {
    for (const name of names) {
      const t0 = performance.now();
      try {
        sessions.push(
          await joinAs({ foundryUrl: target.foundry, world: target.world, user: name })
        );
      } catch (e) {
        throw new EnvError(
          `${name} could not join the Pi's Foundry (${String(e).split('\n')[0].slice(0, 160)}). Is the kit session up with SOAK_PLAYERS=${args.players}?`
        );
      }
      add('player join (to game ready)', performance.now() - t0);
      note(`joined ${name}`);
    }
    for (const [i, session] of sessions.entries()) {
      playerLoops.push(
        (async () => {
          await sleep(rand(0, 20_000));
          while (!state.stop) {
            try {
              const pick = Math.floor(rand(0, 3));
              if (pick === 0) {
                const ms = await session.page.evaluate(async () => {
                  const t0 = performance.now();
                  const done = new Promise(res => {
                    const id = Hooks.on('createChatMessage', (/** @type {any} */ m) => {
                      if (m.author?.id === game.user.id) {
                        Hooks.off('createChatMessage', id);
                        res(performance.now() - t0);
                      }
                    });
                    setTimeout(() => res(null), 15000);
                  });
                  await ui.chat.processMessage('/r 1d20');
                  return done;
                });
                if (typeof ms === 'number') add('player chat roll (echo)', ms);
                else note(`${names[i]}: chat roll not echoed in 15 s`);
              } else if (pick === 1) {
                const ms = await session.page.evaluate(async () => {
                  const a = game.actors.find((/** @type {any} */ x) =>
                    x.testUserPermission(game.user, 'OBSERVER')
                  );
                  if (!a) return null;
                  const t0 = performance.now();
                  await a.sheet.render({ force: true });
                  const took = performance.now() - t0;
                  await new Promise(r => setTimeout(r, 2500));
                  await a.sheet.close();
                  return took;
                });
                if (typeof ms === 'number') add('player sheet open', ms);
              } else {
                await session.page.evaluate(() => {
                  const tabs = Object.keys(ui.sidebar?.constructor?.TABS ?? {});
                  const t = tabs[Math.floor(Math.random() * tabs.length)];
                  if (t) ui.sidebar.changeTab?.(t, 'primary');
                });
              }
            } catch (e) {
              const msg = String(e).split('\n')[0].slice(0, 140);
              note(`${names[i]}: ${msg}`);
              if (/closed|crash|disconnected|Target/i.test(msg)) {
                note(`${names[i]} lost its browser; the player stops`);
                return;
              }
            }
            await sleep(rand(15_000, 45_000));
          }
        })()
      );
    }
    note(
      `all ${names.length} players are in; the soak runs until ${new Date(deadline).toISOString()}`
    );
    console.log(
      `${names.length} players joined. Soaking for ${args.durationMin} min (Ctrl+C ends early and still writes the report).`
    );
    while (!state.stop && Date.now() < deadline) await sleep(1000);
    if (!state.stop) stop('the time is up');
  } finally {
    state.stop = true;
    await Promise.allSettled([...playerLoops, dashLoop, writeLoop]);
    await closeAll();
    await sampler.catch(() => {});
  }

  // ---- journal warnings per unit, counted only (read-only) ----
  try {
    const since = Math.floor(startedAt.getTime() / 1000);
    const { stdout } = await execFileP(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        alias,
        `journalctl -p warning --since @${since} --no-pager -o short -q 2>/dev/null | awk '{print $5}' | sed 's/\\[[0-9]*\\]:\\?//' | sort | uniq -c | sort -rn | head -15`,
      ],
      { timeout: 60_000 }
    );
    if (stdout.trim())
      notes.push(
        `journal warnings during the run (count, source): ${stdout.trim().replace(/\n/g, '; ')}`
      );
  } catch (e) {
    notes.push(`journal warning count failed: ${String(e).split('\n')[0].slice(0, 100)}`);
  }
  if (guard.stranded.length)
    notes.push(`CHANGES LEFT APPLIED (undo them by hand): ${guard.stranded.join(', ')}`);
  if (state.reason && state.reason !== 'the time is up') notes.push(`ended early: ${state.reason}`);
  notes.push(
    'Foundry CPU is the whole foundry.service cgroup over one window; a spike inside a window shows only as its share of it.'
  );
  notes.push(
    '"AI write to dashboard" is plan plus apply as the dashboard timed them (the change is logged when the apply returns).'
  );

  const endedAt = new Date();
  const verdict = evaluate({ records, linkDrops, writeToDashboardMs, samplingGaps });
  if (state.reason.startsWith('REFUSED')) verdict.pass = false;
  const unitSeries = /** @type {Record<string, number[]>} */ ({});
  for (const r of records)
    for (const [u, c] of Object.entries(r.unitCpu)) (unitSeries[u] ??= []).push(c);
  const report = {
    label: args.label,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMin: Math.round((endedAt.getTime() - startedAt.getTime()) / 60000),
    players: args.players,
    writes: args.writes,
    verdict,
    units: Object.fromEntries(Object.entries(unitSeries).map(([k, v]) => [k, summarize(v)])),
    timings: Object.fromEntries(Object.entries(series).map(([k, v]) => [k, summarize(v)])),
    temp: summarize(records.map(r => r.tempC).filter((/** @type {any} */ x) => x !== null)),
    mem: summarize(records.map(r => r.memUsedMb)),
    events,
    notes,
  };
  mkdirSync(args.outDir, { recursive: true });
  const base = path.join(args.outDir, `pi-soak-${stamp(startedAt.toISOString())}`);
  const md = renderReport(report);
  writeFileSync(
    `${base}.json`,
    JSON.stringify({ ...report, records: records.map(({ counters, ...r }) => r) }, null, 2)
  );
  writeFileSync(`${base}.md`, md);
  if (args.vaultNote) writeFileSync(args.vaultNote, md);
  console.log(md);
  console.log(`report: ${base}.md and .json (foundry unit ${FOUNDRY_UNIT})`);
  process.exitCode = verdict.pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    console.error(e instanceof EnvError ? e.message : e);
    process.exit(e instanceof EnvError ? 2 : 1);
  });
}
