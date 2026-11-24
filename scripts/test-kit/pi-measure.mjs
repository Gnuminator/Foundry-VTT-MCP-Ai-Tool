#!/usr/bin/env node
/**
 * I-098 Pi measurements (read-only): times what a GM waits for on the Orange Pi, through the Pi's
 * co-GM dashboard, while a kit session is up (kit-session.sh MODE=up, docs/dev/PI-SETUP.md).
 *
 *   node scripts/test-kit/pi-measure.mjs --not-game-night [--runs 5] [--sample-seconds 30] --label "systemd stack, v0.33.0" [--out <file.json>]
 *
 * What it does (nothing is written on the Pi, no plan is applied, no tool outside the read class
 * runs; every tool call goes through the Pi guard like `kit run --target pi`):
 *  - GET /api/health, /api/state, /api/tools, and the tools get-prep-digest, get-preflight, get-world-info
 *    and the plan tool plan-party-change (a plan only), `--runs` times each: min, median, max in ms.
 *  - The dashboard's first load: the page and every script and stylesheet it names, fetched cold
 *    (bytes and ms), and the same in a headless browser (load event, when playwright can launch one).
 *  - The Pi's processes by systemd unit: CPU (percent of one core) over `--sample-seconds` from
 *    /proc tick deltas, read with one read-only ssh command (the host comes from the targets file;
 *    ssh uses the alias `foundry-pi`, override with PI_SSH_ALIAS), plus load, memory and temperature.
 * Markdown tables go to stdout; --out also writes the raw numbers as JSON.
 */
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createDashboardClient } from './lib/dashboard.mjs';
import { EnvError } from './lib/errors.mjs';
import { createPiGuard } from './lib/pi-guard.mjs';
import { piPreflight, readDashboardToken, resolvePiTarget } from './lib/pi-target.mjs';

const execFileP = promisify(execFile);

/** Read-only: ticks, rss and cgroup per process, twice, then load, memory, temperature. No file is written. */
export const REMOTE_SAMPLE = `
snap() { for d in /proc/[0-9]*; do p=\${d#/proc/}; s=$(cat "$d/stat" 2>/dev/null) || continue; cg=$(sed -n 's#^0::/##p' "$d/cgroup" 2>/dev/null | head -n1); s=\${s##*) }; set -- $s; echo "$p $\{12} $\{13} $\{22} \${cg:-none}"; done; }
A=$(snap); T0=$(date +%s.%N); sleep "$1"; B=$(snap); T1=$(date +%s.%N)
echo "DT $(echo "$T0 $T1" | awk '{print $2-$1}')"
echo "A"; echo "$A"; echo "B"; echo "$B"
echo "LOAD $(cut -d' ' -f1-3 /proc/loadavg)"
echo "MEM $(awk '/MemTotal|MemAvailable/ {printf "%s ", $2}' /proc/meminfo)"
echo "TEMP $(cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | tr '\\n' ' ')"
echo "NCPU $(nproc)"
`;

/** @param {number[]} xs */
export function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { n: s.length, min: s[0], median: med, max: s[s.length - 1] };
}

/**
 * Parses REMOTE_SAMPLE output into CPU percent (of one core) per cgroup unit.
 * @param {string} text
 */
export function parseSample(text) {
  const lines = text.split('\n');
  const dt = Number(/^DT (\S+)/m.exec(text)?.[1] ?? 0);
  const ia = lines.indexOf('A');
  const ib = lines.indexOf('B');
  const rows = (/** @type {number} */ from, /** @type {number} */ to) => {
    /** @type {Map<string, {ticks: number, rss: number, cg: string}>} */
    const m = new Map();
    for (const l of lines.slice(from + 1, to)) {
      const [pid, ut, st, rss, cg] = l.trim().split(/\s+/);
      if (!pid || cg === undefined) continue;
      m.set(pid, { ticks: Number(ut) + Number(st), rss: Number(rss), cg });
    }
    return m;
  };
  const a = rows(ia, ib);
  const b = rows(
    ib,
    lines.findIndex(l => l.startsWith('LOAD'))
  );
  /** @type {Record<string, {cpu: number, rssMb: number, procs: number}>} */
  const units = {};
  for (const [pid, rb] of b) {
    const ra = a.get(pid);
    const delta = ra ? rb.ticks - ra.ticks : rb.ticks; // a new process counts all its ticks
    const unit = rb.cg.split('/').pop() || 'none';
    const u = (units[unit] ??= { cpu: 0, rssMb: 0, procs: 0 });
    u.cpu += dt > 0 ? (delta / 100 / dt) * 100 : 0;
    u.rssMb += (rb.rss * 4096) / 1048576;
    u.procs += 1;
  }
  const field = (/** @type {string} */ k) =>
    (lines.find(l => l.startsWith(k + ' ')) ?? '').slice(k.length + 1).trim();
  const [l1, l5, l15] = field('LOAD').split(' ').map(Number);
  const [memTotalKb, memAvailKb] = field('MEM').split(' ').map(Number);
  const temps = field('TEMP')
    .split(' ')
    .filter(Boolean)
    .map(t => Number(t) / 1000);
  return {
    seconds: dt,
    load: { l1, l5, l15 },
    memUsedMb: Math.round(((memTotalKb || 0) - (memAvailKb || 0)) / 1024),
    memTotalMb: Math.round((memTotalKb || 0) / 1024),
    tempC: temps.length ? Math.max(...temps) : null,
    cores: Number(field('NCPU')) || null,
    units,
  };
}

async function timed(/** @type {() => Promise<unknown>} */ fn) {
  const t0 = performance.now();
  await fn();
  return Math.round(performance.now() - t0);
}

/** First load of the dashboard page without a browser: the page, then every script and stylesheet it names. */
async function coldLoad(/** @type {string} */ base, /** @type {Record<string, string>} */ headers) {
  const t0 = performance.now();
  const res = await fetch(base + '/', { headers });
  const html = await res.text();
  const urls = new Set();
  const origin = new URL(base).origin;
  // Same origin only: the token must never go to another host named in the page.
  for (const m of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css|mjs)[^"]*)"/g)) {
    if (new URL(m[1], base + '/').origin === origin) urls.add(m[1]);
  }
  let bytes = Buffer.byteLength(html);
  const queue = [...urls];
  const errors = [];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let u = queue.shift(); u; u = queue.shift()) {
        try {
          const r = await fetch(new URL(u, base + '/').href, { headers });
          bytes += (await r.arrayBuffer()).byteLength;
          if (!r.ok) errors.push(`${u} ${r.status}`);
        } catch (e) {
          errors.push(`${u} ${String(e)}`);
        }
      }
    })
  );
  return {
    status: res.status,
    files: urls.size + 1,
    bytes,
    ms: Math.round(performance.now() - t0),
    errors,
  };
}

async function browserLoad(
  /** @type {string} */ base,
  /** @type {Record<string, string>} */ headers
) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    return { skipped: 'playwright-core is not installed' };
  }
  let browser;
  for (const opts of [{ channel: 'msedge' }, { channel: 'chrome' }, {}]) {
    try {
      browser = await chromium.launch({ headless: true, ...opts });
      break;
    } catch {
      /* try the next */
    }
  }
  if (!browser) return { skipped: 'no browser could be launched' };
  try {
    const ctx = await browser.newContext();
    const origin = new URL(base).origin;
    // The token header goes to the Pi's origin only, never to a third-party host.
    await ctx.route('**/*', route => {
      const req = route.request();
      return new URL(req.url()).origin === origin
        ? route.continue({ headers: { ...req.headers(), ...headers } })
        : route.continue();
    });
    const page = await ctx.newPage();
    let requests = 0;
    page.on('request', () => requests++);
    const t0 = performance.now();
    await page.goto(base + '/', { waitUntil: 'load', timeout: 60000 });
    const loadMs = Math.round(performance.now() - t0);
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    const idleMs = Math.round(performance.now() - t0);
    return { loadMs, networkIdleMs: idleMs, requests };
  } finally {
    await browser.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (/** @type {string} */ k, /** @type {string} */ d) => {
    const i = argv.indexOf(k);
    return i >= 0 ? (argv[i + 1] ?? d) : d;
  };
  const runs = Number(opt('--runs', '5'));
  const sampleSeconds = Number(opt('--sample-seconds', '30'));
  if (!Number.isInteger(runs) || runs < 1)
    throw new EnvError('--runs must be a whole number from 1');
  if (!Number.isInteger(sampleSeconds) || sampleSeconds < 5 || sampleSeconds > 600) {
    throw new EnvError('--sample-seconds must be a whole number from 5 to 600');
  }
  const label = opt('--label', '');
  if (!label)
    throw new EnvError('--label is required, for example --label "systemd stack, v0.33.0"');
  const out = opt('--out', '');
  const target = resolvePiTarget({ notGameNight: argv.includes('--not-game-night') });
  await piPreflight(target);
  const token = readDashboardToken(target) ?? '';
  const headers = token ? { 'X-CoGM-Token': token } : {};
  const dash = createDashboardClient({ base: target.dashboard, token });
  await dash.health();
  const guarded = createPiGuard(dash, { world: target.world }).forScenario({
    id: 'pi-measure',
    tools: ['get-world-info', 'get-prep-digest', 'get-preflight', 'get-party', 'plan-party-change'],
  });

  /** @type {Record<string, any>} */
  const result = {
    label,
    at: new Date().toISOString(),
    host: target.host,
    world: target.world,
    runs,
  };

  // Idle process sample first, so the load below does not hide the idle number.
  // The ssh alias must name the same Pi as pi.host in the targets file (it is printed below).
  const alias = process.env.PI_SSH_ALIAS || 'foundry-pi';
  console.log(`ssh alias ${alias}; dashboard host ${target.host}`);
  const sample = async () => {
    const p = execFileP(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        alias,
        'bash',
        '-s',
        '--',
        String(sampleSeconds),
      ],
      { maxBuffer: 4 << 20 }
    );
    p.child.stdin?.on('error', () => {});
    p.child.stdin?.end(REMOTE_SAMPLE);
    return parseSample((await p).stdout);
  };
  const idle = await sample();
  result.idleSample = idle;
  await guarded.tool('get-world-info', {}); // still the kit world?

  const series = /** @type {Record<string, number[]>} */ ({});
  const add = (/** @type {string} */ k, /** @type {number} */ ms) => (series[k] ??= []).push(ms);
  const party = await guarded.tool('get-party', {});
  const group =
    (party?.groups ?? []).find((/** @type {any} */ g) => g.primary) ?? party?.groups?.[0];
  for (let i = 0; i < runs; i++) {
    add('GET /api/health', await timed(() => guarded.http('/api/health')));
    add('GET /api/state', await timed(() => guarded.http('/api/state', { text: true })));
    add('GET /api/preflight', await timed(() => guarded.http('/api/preflight')));
    add('GET /api/tools', await timed(() => guarded.http('/api/tools')));
    add('get-world-info', await timed(() => guarded.tool('get-world-info', {})));
    add('get-prep-digest', await timed(() => guarded.tool('get-prep-digest', {})));
    add('get-preflight', await timed(() => guarded.tool('get-preflight', {})));
    if (group) {
      try {
        add(
          'plan-party-change (plan only)',
          await timed(() =>
            guarded.tool('plan-party-change', { action: 'place', groupId: group.actorId })
          )
        );
      } catch (e) {
        if (e instanceof EnvError) throw e; // a guard refusal ends the run
        result.planFailures = (result.planFailures ?? 0) + 1; // e.g. nobody to place; not timed
      }
    }
  }
  result.calls = Object.fromEntries(Object.entries(series).map(([k, v]) => [k, stats(v)]));
  await guarded.tool('get-world-info', {}); // the page loads below must still be the kit world
  result.coldLoad = await coldLoad(target.dashboard, headers);
  result.browserLoad = await browserLoad(target.dashboard, headers);

  // Second process sample, now that the dashboard has been used and a browser has loaded it.
  await guarded.tool('get-world-info', {});
  result.afterSample = await sample();

  const fmt = (/** @type {any} */ s) => `${s.min} / ${s.median} / ${s.max}`;
  console.log(`# Pi measurements (${label}) ${result.at}\n`);
  console.log('| Call | min / median / max ms |\n| --- | --- |');
  for (const [k, v] of Object.entries(result.calls)) console.log(`| ${k} | ${fmt(v)} |`);
  console.log(`\nDashboard cold load (HTTP only): ${JSON.stringify(result.coldLoad)}`);
  console.log(`Dashboard in a browser: ${JSON.stringify(result.browserLoad)}\n`);
  for (const [name, s] of [
    ['idle', idle],
    ['after use', result.afterSample],
  ]) {
    console.log(
      `Processes (${name}, ${s.seconds.toFixed(1)} s): load ${s.load.l1}/${s.load.l5}/${s.load.l15}, ${s.cores} cores, mem used ${s.memUsedMb}/${s.memTotalMb} MB, temp ${s.tempC} C`
    );
    console.log(
      '| Unit (cgroup) | CPU % of one core | RSS MB | procs |\n| --- | --- | --- | --- |'
    );
    for (const [u, v] of Object.entries(s.units)
      .sort((x, y) => y[1].cpu - x[1].cpu)
      .slice(0, 12)) {
      console.log(`| ${u} | ${v.cpu.toFixed(1)} | ${v.rssMb.toFixed(0)} | ${v.procs} |`);
    }
    console.log('');
  }
  if (out) writeFileSync(out, JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    console.error(e instanceof EnvError ? e.message : e);
    process.exit(e instanceof EnvError ? 2 : 1);
  });
}
