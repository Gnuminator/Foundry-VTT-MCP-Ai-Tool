import { describe, expect, it } from 'vitest';

import { wikiUrl } from '../lib/wiki';

const GM = 'https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/gm/';

describe('wikiUrl', () => {
  it('sends the guide index to the GM section', () => {
    expect(wikiUrl('README', '')).toBe(GM);
  });

  it('gives a page its own directory, as the wiki builds it', () => {
    expect(wikiUrl('dashboard', '')).toBe(`${GM}dashboard/`);
  });

  it('sends a Foundry basics page to the foundry section', () => {
    const FOUNDRY = 'https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/foundry/';
    expect(wikiUrl('foundry-combat', 'x')).toBe(`${FOUNDRY}combat/#x`);
    expect(wikiUrl('foundry-README', '')).toBe(FOUNDRY);
  });

  it('keeps the heading anchor, which the wiki slugs the same way', () => {
    expect(wikiUrl('dashboard', 'module-diagnostics')).toBe(`${GM}dashboard/#module-diagnostics`);
  });
});
