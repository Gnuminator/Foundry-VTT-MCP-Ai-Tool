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
  if (!/\.(ts|tsx|mjs|cjs|js|ps1|sh)$/.test(file)) return false;
  if (/(^|\/)(node_modules|dist|docs|\.claude)\//.test(file)) return false;
  if (/\.(test|spec)\.[a-z]+$/.test(file) || /\.d\.ts$/.test(file)) return false;
  if (/(^|\/)(e2e|__tests__|fixtures)\//.test(file)) return false;
  if (file === 'shared/src/ports.ts') return false;
  return true;
}

function countLiterals(): Record<string, number> {
  const root = join(sharedDir, '..');
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 64e6 })
    .split('\n')
    .filter(f => f && isGuarded(f) && existsSync(join(root, f)));
  const counts: Record<string, number> = {};
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    let n = 0;
    for (const m of text.matchAll(/(?<![\w.-])(\d{4,5})(?![\w.-])/g)) {
      if (KNOWN.has(Number(m[1]))) n += 1;
    }
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

  it('forbids every live, test and reserved port', () => {
    const f = forbiddenPorts();
    for (const port of [
      31414, 31415, 31416, 31514, 31515, 31516, 31524, 31535, 30001, 30003, 3100, 3102,
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
        'Lower it: UPDATE_PORTS=1 npm test --workspace shared'
    ).toEqual([]);
  });
});
