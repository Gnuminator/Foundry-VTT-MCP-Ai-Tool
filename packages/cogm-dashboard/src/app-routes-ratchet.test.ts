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

/**
 * Counts `app.<method>(` calls (routes and middleware alike, so `app.use(router)` counts too) in
 * the source with comments stripped; whitespace and line breaks around the dot are allowed.
 * Also counts `Router(` so a router defined inside `app.ts` cannot hide new endpoints.
 */
function countInlineRoutes(source: string): number {
  // One pass: a string or template is kept as it is (so a `/*` or `//` inside it hides nothing),
  // a block comment or a line comment is dropped.
  const code = source.replace(
    /('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (_match, str?: string) => str ?? ''
  );
  const calls = code.match(/\bapp\s*\.\s*[A-Za-z]+\s*\(/g) ?? [];
  const routers = code.match(/\bRouter\s*\(/g) ?? [];
  return calls.length + routers.length;
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
    const sample =
      "  app.get('/x', h);\n  // app.post('/y')\n /* app.use(z)\n app.use(q) */\n  app.use(a);\n  app\n    .post('/z', h);\n  const r = Router();";
    expect(countInlineRoutes(sample)).toBe(4);
  });

  it('does not let a comment marker inside a string hide a route', () => {
    const sample =
      "  app.get('/files/*', h);\n  app.get('/a', h); const u = 'http://x';\n  app.use(b);";
    expect(countInlineRoutes(sample)).toBe(3);
  });
});
