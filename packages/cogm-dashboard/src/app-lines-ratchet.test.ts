/**
 * Line ratchet for `app.ts` (Fable review pick R8, item app-live-state-split). `app.ts` is wiring
 * only, so its length may not go up. New state or behaviour goes in `live-state.ts` or
 * `src/routes/`. When lines move out, lower `lines` in `app-lines-baseline.json` in the same PR;
 * the test fails on a lower count too, so the stored number always matches the file. The ceiling
 * for the baseline itself is 300 lines.
 */
import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Number of lines in the file, counted as `wc -l` would (a final newline does not add one). */
function countLines(source: string): number {
  if (source === '') return 0;
  return source.replace(/\n$/, '').split('\n').length;
}

describe('app.ts line ratchet', () => {
  const baseline = JSON.parse(readFileSync(path.join(here, 'app-lines-baseline.json'), 'utf8')) as {
    lines: number;
  };
  const actual = countLines(readFileSync(path.join(here, 'app.ts'), 'utf8'));

  it('does not grow app.ts', () => {
    expect(
      actual,
      `app.ts has ${actual} lines, the baseline allows ${baseline.lines}. Put new state in src/live-state.ts and new endpoints in src/routes/.`
    ).toBeLessThanOrEqual(baseline.lines);
  });

  it('keeps the stored number equal to the file', () => {
    expect(
      baseline.lines,
      `app.ts now has ${actual} lines: set "lines" in app-lines-baseline.json to ${actual}.`
    ).toBe(actual);
  });

  it('stays under 300 lines', () => {
    expect(baseline.lines).toBeLessThan(300);
  });

  it('counts lines like wc -l', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\nb')).toBe(2);
  });
});
