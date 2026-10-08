/**
 * The During view places every slot by grid area (moments.css). A rule that sets
 * grid-template-areas on #moment-during with other names (an old 'side' area, a missing
 * 'changes') makes the browser stack those slots in one cell, so cards overlap: at 390 px
 * the Party drawer covered the Recent Changes header. Every areas rule for #moment-during
 * must name exactly the slots' areas.
 */
import { readFileSync } from 'fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../public/moments.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

/** Every `selector { body }` block, with the selectors of the block. */
function blocks(): Array<{ selectors: string[]; body: string }> {
  const out: Array<{ selectors: string[]; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const head = m[1].replace(/@media[^{]*$/, '').trim();
    out.push({ selectors: head.split(',').map(s => s.trim()), body: m[2] });
  }
  return out;
}

const slotAreas = new Set(
  blocks()
    .filter(b => b.selectors.some(s => /^#moment-during \.[\w-]+$/.test(s)))
    .map(b => /grid-area:\s*([\w-]+)/.exec(b.body)?.[1])
    .filter((a): a is string => Boolean(a))
);

const areaRules = blocks()
  .filter(b => b.selectors.some(s => s.startsWith('#moment-during') && !s.includes(' ')))
  .map(b => /grid-template-areas:([^;]+);/.exec(b.body)?.[1])
  .filter((a): a is string => Boolean(a));

describe('During grid areas', () => {
  it('finds the slots and the layouts', () => {
    expect([...slotAreas].sort()).toEqual(['bar', 'changes', 'feed', 'handouts', 'party', 'strip']);
    expect(areaRules.length).toBeGreaterThanOrEqual(5);
  });

  it.each(areaRules.map(r => [r.replace(/\s+/g, ' ').trim()]))('%s names every slot', rule => {
    const names = new Set(
      (rule.match(/'([^']*)'/g) ?? [])
        .flatMap(row => row.replace(/'/g, '').trim().split(/\s+/))
        .filter(n => n !== '.')
    );
    expect([...names].sort()).toEqual([...slotAreas].sort());
  });
});
