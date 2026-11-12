/**
 * Ratchet: test files that carry their own logger stub or their own `makeTools` instead of
 * `make-tool-harness.ts`. The counts in `harness-ratchet.baseline.json` may only fall.
 * Migrating a file lowers the count; run `UPDATE_HARNESS_RATCHET=1 npx vitest run
 * src/test-support/harness-ratchet.test.ts` to write the lower numbers (it never raises them).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '..');
const baselinePath = path.join(here, 'harness-ratchet.baseline.json');

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full !== here && entry.name !== 'node_modules') out.push(...testFiles(full));
    } else if (entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const LEVELS = ['error', 'warn', 'info', 'debug'] as const;

/** A file has its own logger stub when two or more log levels are set to `vi.fn()`. */
function hasOwnLoggerStub(source: string): boolean {
  const seen = LEVELS.filter(level => new RegExp(`\\b${level}:\\s*vi\\.fn\\(\\)`).test(source));
  return seen.length >= 2;
}

function hasOwnMakeTools(source: string): boolean {
  return /\bfunction makeTools\b|\b(?:const|let) makeTools\b/.test(source);
}

function countHarnessCopies(): { loggerStubs: number; makeTools: number } {
  let loggerStubs = 0;
  let makeToolsCount = 0;
  for (const file of testFiles(srcDir)) {
    const source = readFileSync(file, 'utf8');
    if (hasOwnLoggerStub(source)) loggerStubs++;
    if (hasOwnMakeTools(source)) makeToolsCount++;
  }
  return { loggerStubs, makeTools: makeToolsCount };
}

describe('own logger stub and makeTools ratchet', () => {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
    loggerStubs: number;
    makeTools: number;
  };
  const current = countHarnessCopies();

  it('detects the patterns', () => {
    expect(hasOwnLoggerStub('const l = { error: vi.fn(), warn: vi.fn() };')).toBe(true);
    expect(hasOwnLoggerStub('const l = { debug: vi.fn() };')).toBe(false);
    expect(hasOwnMakeTools('function makeTools(x) {}')).toBe(true);
    expect(hasOwnMakeTools("import { makeTools } from './make-tool-harness.js';")).toBe(false);
  });

  it('does not rise above the baseline (use make-tool-harness.ts)', () => {
    expect(current.loggerStubs).toBeLessThanOrEqual(baseline.loggerStubs);
    expect(current.makeTools).toBeLessThanOrEqual(baseline.makeTools);
  });

  it('writes lower numbers on request', () => {
    if (process.env.UPDATE_HARNESS_RATCHET !== '1') return;
    const next = {
      loggerStubs: Math.min(baseline.loggerStubs, current.loggerStubs),
      makeTools: Math.min(baseline.makeTools, current.makeTools),
    };
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  });
});
