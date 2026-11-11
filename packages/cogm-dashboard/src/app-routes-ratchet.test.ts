/**
 * Route ratchet for `app.ts` (Fable review pick R8). `app.ts` is meant to end as wiring only, so
 * the number of `app.<method>(` calls in it may not go up. A new endpoint goes in `src/routes/`.
 * When routes move out, lower `count` in `app-routes-baseline.json` in the same PR; the test
 * fails on a lower count too, so the stored number always matches the file.
 */
import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Counts `app.<method>(` calls on code lines (comment-only lines are skipped). */
function countInlineRoutes(source: string): number {
  let count = 0;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (/\bapp\.[a-z]+\(/.test(trimmed)) count += 1;
  }
  return count;
}

describe('app.ts inline route ratchet', () => {
  const baseline = JSON.parse(
    readFileSync(path.join(here, 'app-routes-baseline.json'), 'utf8')
  ) as { count: number };
  const actual = countInlineRoutes(readFileSync(path.join(here, 'app.ts'), 'utf8'));

  it('does not add inline routes to app.ts', () => {
    expect(
      actual,
      `app.ts has ${actual} inline app.<method>( calls, the baseline allows ${baseline.count}. Put the new endpoint in src/routes/ and register it from app.ts.`
    ).toBeLessThanOrEqual(baseline.count);
  });

  it('keeps the stored number equal to the file', () => {
    expect(
      baseline.count,
      `app.ts now has ${actual} inline calls: lower "count" in app-routes-baseline.json to ${actual}.`
    ).toBe(actual);
  });

  it('counts calls and skips comments', () => {
    const sample = "  app.get('/x', h);\n  // app.post('/y')\n * app.use(z)\n  app.use(a);";
    expect(countInlineRoutes(sample)).toBe(2);
  });
});
