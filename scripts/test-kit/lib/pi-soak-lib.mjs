/**
 * The numbers side of the Pi soak (scripts/test-kit/pi-soak.mjs): what the read-only ssh sample
 * adds to pi-measure's, how consecutive samples turn into records, and the pass bar of vault
 * `Design/I-098 loaded-session rehearsal plan.md`. No network and no ssh here; the tests feed it text.
 */
import { parseSample } from '../pi-measure.mjs';

/** The units the soak watches for restarts (a unit that does not exist is skipped). */
export const WATCHED_UNITS = [
  'foundry.service',
  'foundry-ai-tool-bridge.service',
  'foundry-ai-tool-dashboard.service',
  'foundry-ai-tool-gm-browser.service',
  'foundry-ai-tool-kit-gm-browser.service',
  'foundry-ai-tool-discord-bot.service',
  'foundry-ai-tool-syncthing.service',
];

/** The unit whose CPU is "Foundry's main thread" (the process of foundry.service). */
export const FOUNDRY_UNIT = 'foundry.service';

/** The pass bar (the user decides; these are the plan's proposal). */
export const PASS_BAR = Object.freeze({
  foundryCpuPct: 70,
  foundryCpuSeconds: 5,
  iowaitPct: 5,
  writeToDashboardMs: 2000,
});

/**
 * Appended to pi-measure's REMOTE_SAMPLE on the Pi: cumulative CPU counters (iowait), core clocks
 * and the state of the watched units. Read-only; writes nothing.
 * @param {string[]} [units]
 */
export function remoteExtras(units = WATCHED_UNITS) {
  return `
echo "CPUSTAT $(head -n1 /proc/stat)"
echo "FREQ $(cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq 2>/dev/null | tr '\\n' ' ')| $(cat /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq 2>/dev/null | tr '\\n' ' ')"
for u in ${units.join(' ')}; do echo "UNIT $u $(systemctl show -p ActiveState -p MainPID -p NRestarts "$u" 2>/dev/null | tr '\\n' ' ')"; done
`;
}

/**
 * Parses the lines remoteExtras() adds.
 * @param {string} text the whole sample output
 */
export function parseExtras(text) {
  const line = (/** @type {string} */ k) =>
    (text.split('\n').find(l => l.startsWith(k + ' ')) ?? '').slice(k.length + 1).trim();
  // cpu user nice system idle iowait irq softirq steal ...
  const cpu = line('CPUSTAT').split(/\s+/).slice(1).map(Number);
  const [curRaw = '', maxRaw = ''] = line('FREQ').split('|');
  const nums = (/** @type {string} */ s) => s.trim().split(/\s+/).filter(Boolean).map(Number);
  /** @type {Record<string, {active: string, pid: number, restarts: number}>} */
  const units = {};
  for (const l of text.split('\n')) {
    const m = /^UNIT (\S+) (.*)$/.exec(l);
    if (!m) continue;
    const kv = Object.fromEntries(
      m[2]
        .trim()
        .split(/\s+/)
        .map(p => p.split('='))
        .filter(p => p.length === 2)
    );
    if (!kv.ActiveState) continue;
    units[m[1]] = {
      active: kv.ActiveState,
      pid: Number(kv.MainPID) || 0,
      restarts: Number(kv.NRestarts) || 0,
    };
  }
  return {
    cpu: cpu.length >= 5 && cpu.every(Number.isFinite) ? cpu : null,
    freqCur: nums(curRaw),
    freqMax: nums(maxRaw),
    units,
  };
}

/**
 * One record from a sample's text, and the previous record's counters for the deltas.
 * @param {string} text
 * @param {{cpu: number[] | null, units: Record<string, {active: string, pid: number, restarts: number}>} | null} prev
 */
export function buildRecord(text, prev) {
  const s = parseSample(text);
  const x = parseExtras(text);
  let iowaitPct = null;
  let busyPct = null;
  if (x.cpu && prev?.cpu) {
    const total = x.cpu.reduce((a, b) => a + b, 0) - prev.cpu.reduce((a, b) => a + b, 0);
    if (total > 0) {
      iowaitPct = ((x.cpu[4] - prev.cpu[4]) / total) * 100;
      busyPct = (1 - (x.cpu[3] - prev.cpu[3]) / total) * 100;
    }
  }
  const ratios = x.freqCur
    .map((c, i) => (x.freqMax[i] ? c / x.freqMax[i] : NaN))
    .filter(Number.isFinite);
  const freqRatio = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
  /** @type {string[]} */
  const unitEvents = [];
  if (prev) {
    for (const [name, now] of Object.entries(x.units)) {
      const was = prev.units[name];
      if (!was) continue;
      if (was.active === 'active' && now.active !== 'active')
        unitEvents.push(`${name} left active (${now.active})`);
      else if (now.restarts > was.restarts)
        unitEvents.push(`${name} restarted (NRestarts ${was.restarts} to ${now.restarts})`);
      else if (was.active === 'active' && now.active === 'active' && now.pid !== was.pid) {
        unitEvents.push(`${name} main process changed (${was.pid} to ${now.pid})`);
      }
    }
  }
  return {
    seconds: s.seconds,
    tempC: s.tempC,
    load1: s.load.l1,
    memUsedMb: s.memUsedMb,
    cores: s.cores,
    foundryCpu: s.units[FOUNDRY_UNIT]?.cpu ?? null,
    unitCpu: Object.fromEntries(Object.entries(s.units).map(([k, v]) => [k, v.cpu])),
    iowaitPct,
    busyPct,
    freqRatio,
    unitEvents,
    counters: { cpu: x.cpu, units: x.units },
  };
}

/**
 * Throttling: hot, or busy while the cores run well under their top clock. Idle clocks are low by design.
 * @param {{tempC: number | null, busyPct: number | null, freqRatio: number | null}} r
 */
export function isThrottled(r) {
  if (r.tempC !== null && r.tempC >= 80) return true;
  return r.busyPct !== null && r.busyPct > 70 && r.freqRatio !== null && r.freqRatio < 0.8;
}

/** @param {number[]} xs @param {number} p 0 to 100 */
export function percentile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** @param {number[]} xs */
export function summarize(xs) {
  if (!xs.length) return { n: 0, min: null, median: null, p95: null, max: null };
  return {
    n: xs.length,
    min: Math.min(...xs),
    median: percentile(xs, 50),
    p95: percentile(xs, 95),
    max: Math.max(...xs),
  };
}

/**
 * The pass bar against what the run recorded.
 * @param {{
 *   records: ReturnType<typeof buildRecord>[],
 *   linkDrops: number,
 *   writeToDashboardMs: number[],
 *   samplingGaps?: number,
 * }} run
 * @returns {{pass: boolean, checks: {name: string, pass: boolean | null, detail: string}[]}}
 */
export function evaluate({ records, linkDrops, writeToDashboardMs, samplingGaps = 0 }) {
  const over = records.filter(
    r =>
      r.foundryCpu !== null &&
      r.foundryCpu > PASS_BAR.foundryCpuPct &&
      r.seconds >= PASS_BAR.foundryCpuSeconds
  );
  const foundry = records.map(r => r.foundryCpu).filter(x => x !== null);
  const restarts = records.flatMap(r => r.unitEvents);
  const iow = records.map(r => r.iowaitPct).filter(x => x !== null);
  const iowAvg = iow.length ? iow.reduce((a, b) => a + b, 0) / iow.length : null;
  const throttled = records.filter(isThrottled).length;
  const w = writeToDashboardMs;
  /** @type {{name: string, pass: boolean | null, detail: string}[]} */
  const checks = [
    {
      name: `Foundry CPU under ${PASS_BAR.foundryCpuPct} % of a core for more than ${PASS_BAR.foundryCpuSeconds} s`,
      pass: foundry.length ? over.length === 0 : null,
      detail: foundry.length
        ? `${over.length} of ${foundry.length} windows above (max ${Math.max(...foundry).toFixed(1)} %, p95 ${percentile(foundry, 95)?.toFixed(1)} %)`
        : 'no samples',
    },
    {
      name: 'No unit restarts',
      pass: records.length ? restarts.length === 0 : null,
      detail: restarts.length ? [...new Set(restarts)].slice(0, 8).join('; ') : 'none seen',
    },
    {
      name: 'No bridge link drops',
      pass: linkDrops === 0,
      detail: `${linkDrops} seen`,
    },
    {
      name: `iowait under ${PASS_BAR.iowaitPct} % on average`,
      pass: iowAvg === null ? null : iowAvg < PASS_BAR.iowaitPct,
      detail:
        iowAvg === null
          ? 'no samples'
          : `average ${iowAvg.toFixed(2)} %, max ${Math.max(...iow).toFixed(1)} %`,
    },
    {
      name: 'No throttling',
      pass: records.length ? throttled === 0 : null,
      detail: `${throttled} windows hot (80 C or more) or slow while busy`,
    },
    {
      name: `AI write to dashboard under ${PASS_BAR.writeToDashboardMs / 1000} s`,
      pass: w.length ? Math.max(...w) < PASS_BAR.writeToDashboardMs : null,
      detail: w.length
        ? `${w.length} writes, p95 ${percentile(w, 95)} ms, max ${Math.max(...w)} ms (plan to dashboard log)`
        : 'no writes measured (writes were off, or none ran)',
    },
  ];
  if (samplingGaps > 0) {
    checks.push({
      name: 'No holes in the Pi sampling',
      pass: samplingGaps <= Math.max(3, records.length * 0.02),
      detail: `${samplingGaps} ssh samples failed`,
    });
  }
  return { pass: records.length > 0 && checks.every(c => c.pass !== false), checks };
}

/** @param {string} s */
export function stamp(s) {
  return s.replace(/[:.]/g, '-');
}

/**
 * Markdown for the report and the vault note.
 * @param {{
 *   label: string, startedAt: string, endedAt: string, durationMin: number, players: number, writes: boolean,
 *   verdict: ReturnType<typeof evaluate>, units: Record<string, ReturnType<typeof summarize>>,
 *   timings: Record<string, ReturnType<typeof summarize>>, temp: ReturnType<typeof summarize>,
 *   mem: ReturnType<typeof summarize>, events: string[], notes: string[],
 * }} r
 */
export function renderReport(r) {
  const f = (/** @type {number | null} */ x, d = 0) => (x === null ? '-' : x.toFixed(d));
  const lines = [
    `# Pi soak ${r.startedAt.slice(0, 10)} (${r.label})`,
    '',
    `${r.startedAt} to ${r.endedAt}, ${r.durationMin} min, ${r.players} simulated players, guarded writes ${r.writes ? 'on' : 'off'}.`,
    '',
    `**${r.verdict.pass ? 'PASS' : 'FAIL'}**`,
    '',
    '| Pass bar | Result | Detail |',
    '| --- | --- | --- |',
    ...r.verdict.checks.map(
      c =>
        `| ${c.name} | ${c.pass === null ? 'not measured' : c.pass ? 'pass' : 'FAIL'} | ${c.detail} |`
    ),
    '',
    '## Timings (ms)',
    '',
    '| Call | n | min | median | p95 | max |',
    '| --- | --- | --- | --- | --- | --- |',
    ...Object.entries(r.timings).map(
      ([k, v]) => `| ${k} | ${v.n} | ${f(v.min)} | ${f(v.median)} | ${f(v.p95)} | ${f(v.max)} |`
    ),
    '',
    '## Pi CPU by unit (percent of one core, per sample window)',
    '',
    '| Unit | median | p95 | max |',
    '| --- | --- | --- | --- |',
    ...Object.entries(r.units)
      .sort((a, b) => (b[1].p95 ?? 0) - (a[1].p95 ?? 0))
      .slice(0, 12)
      .map(([k, v]) => `| ${k} | ${f(v.median, 1)} | ${f(v.p95, 1)} | ${f(v.max, 1)} |`),
    '',
    `Temperature C: median ${f(r.temp.median, 1)}, max ${f(r.temp.max, 1)}. Memory used MB: median ${f(r.mem.median)}, max ${f(r.mem.max)}.`,
    '',
    '## Events',
    '',
    ...(r.events.length ? r.events.slice(0, 60).map(e => `- ${e}`) : ['- none']),
    ...(r.notes.length ? ['', '## Notes', '', ...r.notes.map(n => `- ${n}`)] : []),
    '',
  ];
  return lines.join('\n');
}
