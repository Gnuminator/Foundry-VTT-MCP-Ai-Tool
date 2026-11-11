import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXTRA_PORTS, PORTS, forbiddenPorts, portsJson } from './ports.js';

const sharedDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsonPath = join(sharedDir, 'ports.json');
const baselinePath = join(sharedDir, 'ports-baseline.json');
const update = process.env.UPDATE_PORTS === '1';

const KNOWN = new Set<number>([
  ...Object.values(PORTS).flatMap(set => Object.values(set)),
  ...Object.values(EXTRA_PORTS),
]);

/** Production source: not tests, e2e specs, type stubs, docs or vendored code. */
function isGuarded(file: string): boolean {
  if (!/\.(ts|tsx|mjs|cjs|js|ps1|sh|py|yml|bat|cmd)$|\.env\.example$/.test(file)) return false;
  if (/(^|\/)(node_modules|dist|docs|\.claude)\//.test(file)) return false;
  if (/\.(test|spec)\.[a-z]+$/.test(file) || /\.d\.ts$/.test(file)) return false;
  if (/(^|\/)(e2e|__tests__|fixtures)\//.test(file)) return false;
  if (file === 'shared/src/ports.ts') return false;
  return true;
}

/**
 * Is the number at `index` the delay argument of a setTimeout/setInterval call that is still open
 * on this line? Only that argument is skipped: a port inside the callback (deeper) or after the
 * call has closed still counts.
 */
function isTimerDelay(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const before = text.slice(lineStart, index);
  const calls = [...before.matchAll(/\bset(?:Timeout|Interval)\(/g)];
  const last = calls.at(-1);
  if (last?.index === undefined) return false;
  let depth = 1;
  let sawComma = false;
  for (const ch of before.slice(last.index + last[0].length)) {
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (ch === ',' && depth === 1) sawComma = true;
    if (depth === 0) return false; // the timer call closed before this number
  }
  return depth === 1 && sawComma;
}

/** A millisecond value named by an option, a parameter or a sleep command is not a port. */
const DURATION_BEFORE = [
  // The key ENDS in a duration word (itemsPort and formsPort do not, so they still count).
  /\b(?:timeout|delay|interval|duration|wait|sleep|ttl|millis|milliseconds|ms)['"]?\s*[:=]\s*$/i,
  /(?:Timeout|Delay|Interval|Duration|Wait|Sleep|Ttl|TTL|Millis|Milliseconds|Ms|_MS|_ms|TIMEOUT|DELAY|INTERVAL|DURATION|WAIT|SLEEP|TTL|MILLIS)['"]?\s*[:=]\s*$/,
  /-(Milliseconds|TimeoutSec|Timeout)\s+$/i,
  /\bStart-Sleep\s+(-\w+\s+)?$/i,
  /\b(sleep|delay|wait)\(\s*$/i,
  /\.(WaitOne|WaitForExit)\(\s*$/,
];

/** How many known port numbers `text` holds, leaving out durations (3000 ms and similar). */
export function countInText(text: string): number {
  let n = 0;
  for (const m of text.matchAll(/(?<![\w.-])(\d{4,5})(?![\w.-])/g)) {
    if (!KNOWN.has(Number(m[1]))) continue;
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const before = text.slice(lineStart, m.index);
    if (isTimerDelay(text, m.index)) continue;
    if (DURATION_BEFORE.some(re => re.test(before))) continue;
    n += 1;
  }
  return n;
}

function countLiterals(): Record<string, number> {
  const root = join(sharedDir, '..');
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 64e6 })
    .split('\n')
    .filter(f => f && isGuarded(f) && existsSync(join(root, f)));
  const counts: Record<string, number> = {};
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    const n = countInText(text);
    if (n > 0) counts[file] = n;
  }
  return counts;
}

describe('ports', () => {
  it('ports.json equals the table in ports.ts', () => {
    if (update) writeFileSync(jsonPath, portsJson());
    // Compared as data: prettier reflows the file on commit.
    expect(JSON.parse(readFileSync(jsonPath, 'utf8'))).toEqual(JSON.parse(portsJson()));
  });

  it('counts ports but not durations', () => {
    expect(countInText("const url = 'http://localhost:31414';")).toBe(1);
    // the timer's delay argument is skipped
    expect(countInText('setTimeout(() => {}, 3000);')).toBe(0);
    expect(countInText('setInterval(tick, 3100)')).toBe(0);
    // a port in the callback, or after the timer call closed, still counts
    expect(countInText("setTimeout(()=>fetch('http://localhost:31414'),10)")).toBe(1);
    expect(countInText('setTimeout(f, 10); const port = 31515;')).toBe(1);
    // named durations
    expect(countInText('{ timeout: 30000 }')).toBe(0);
    expect(countInText('ConnectTimeout=30000')).toBe(0);
    expect(countInText('const delay = 3000;')).toBe(0);
    expect(countInText('Start-Sleep -Milliseconds 3000')).toBe(0);
    expect(countInText('await sleep(3000)')).toBe(0);
    expect(countInText('const CAP_MS = 30000; slowMs: 3000, connectTimeout: 3100')).toBe(0);
    expect(countInText('if (-not $p.WaitForExit(30000)) {')).toBe(0);
    // a key or call that only contains a duration word is not a duration
    expect(countInText('await waitForPort(31514)')).toBe(1);
    expect(countInText('itemsPort: 3100')).toBe(1);
    expect(countInText('const formsPort = 3200')).toBe(1);
    expect(countInText('awaitingPort: 31514')).toBe(1);
    expect(countInText('port = 3000')).toBe(1);
    expect(countInText('PORT=3100')).toBe(1);
  });

  it('scans python, yaml, env example, bat and cmd files', () => {
    for (const f of ['a.py', 'ci.yml', 'x/.env.example', 'run.bat', 'run.cmd', 'a.ts']) {
      expect(isGuarded(f), f).toBe(true);
    }
    expect(isGuarded('notes.md')).toBe(false);
  });

  it('forbids every live, test, rehearsal and reserved port', () => {
    const f = forbiddenPorts();
    for (const port of [
      31414, 31415, 31416, 31514, 31515, 31516, 31524, 31535, 30001, 30003, 3100, 3102, 30100,
      31614, 31615, 3300, 3200,
    ]) {
      expect(f).toContain(port);
    }
  });

  it('adds no new port literal to production code (use shared/src/ports.ts or ports.json)', () => {
    const counts = countLiterals();
    if (update) {
      writeFileSync(baselinePath, `${JSON.stringify(counts, null, 2)}\n`);
    }
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, number>;
    const grew = Object.entries(counts).filter(([file, n]) => n > (baseline[file] ?? 0));
    expect(
      grew,
      `New port literals in: ${grew.map(([f, n]) => `${f} (${n}, was ${baseline[f] ?? 0})`).join(', ')}. ` +
        'Read the port from shared/ports.json or import it from shared/src/ports.ts.'
    ).toEqual([]);
    const shrank = Object.entries(baseline).filter(([file, n]) => (counts[file] ?? 0) < n);
    expect(
      shrank,
      `Fewer literals now than the baseline in: ${shrank.map(([f]) => f).join(', ')}. ` +
        'Lower it: set UPDATE_PORTS=1 (PowerShell: $env:UPDATE_PORTS=1) and run npm test --workspace shared'
    ).toEqual([]);
  });
});
