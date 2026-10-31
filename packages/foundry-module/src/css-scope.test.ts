/**
 * Our stylesheets must not restyle Foundry's own or other modules' elements: every selector has
 * to name one of our own classes (an ancestor window or the element itself). A bare core class
 * such as `.form-footer` or `[data-service-type]` once restyled every form footer in Foundry.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES = join(__dirname, '..', 'styles');
/** Class prefixes that belong to this module. */
const OWN = /\.(?:eci|fmb|mcp)-[\w-]+/;

/** Every selector of a stylesheet (comments removed, one entry per comma-separated part). */
function selectorsOf(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: string[] = [];
  // Keyframe steps carry no selector; the animation name itself must be ours (global namespace).
  const names = [...text.matchAll(/@keyframes\s+([\w-]+)/g)].map(k => `.${k[1]}`);
  out.push(...names);
  const re = /([^{}@;]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    for (const part of m[1].split(',')) {
      const sel = part.trim();
      if (sel && !/^(?:from|to|\d+%|keyframes\s.*)$/.test(sel)) out.push(sel);
    }
  }
  return out;
}

describe('module stylesheets stay inside our own windows', () => {
  const files = readdirSync(STYLES).filter(f => f.endsWith('.css'));

  it('finds the stylesheets', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file}: every selector names one of our classes`, () => {
      const css = readFileSync(join(STYLES, file), 'utf8');
      const unscoped = selectorsOf(css).filter(s => !OWN.test(s));
      expect(unscoped).toEqual([]);
    });
  }

  it('the checker flags the old leaking selectors', () => {
    const bad = selectorsOf('.form-footer { a: b } [data-service-type].hidden { a: b }');
    expect(bad.filter(s => !OWN.test(s))).toEqual(['.form-footer', '[data-service-type].hidden']);
  });
});
