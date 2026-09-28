import { describe, expect, it } from 'vitest';

import {
  emptyMirrorStatus,
  encodeSegment,
  openUrl,
  propertyWikilink,
  relativeLinkTarget,
  wikilinkLabel,
} from './mirror-common.js';

describe('mirror link helpers', () => {
  it('encodes path segments, including parentheses', () => {
    expect(encodeSegment('Wolf (a1b2c3).md')).toBe('Wolf%20%28a1b2c3%29.md');
    expect(encodeSegment('Ænd ø#1')).toBe('%C3%86nd%20%C3%B8%231');
  });

  it('builds the open URL with the uuid as the only parameter', () => {
    expect(openUrl('http://127.0.0.1:3000', 'Actor.abcdefABCDEF0123')).toBe(
      'http://127.0.0.1:3000/open?uuid=Actor.abcdefABCDEF0123'
    );
  });

  it('computes relative link targets between campaign-relative notes', () => {
    const npc = 'AI Tool/Foundry/NPCs/Wolf.md';
    expect(relativeLinkTarget(npc, 'AI Tool/Foundry/NPCs/Bear Cub.md')).toBe('Bear%20Cub.md');
    expect(relativeLinkTarget(npc, 'AI Tool/Foundry/Journals/Lore.md', 'p-abc')).toBe(
      '../Journals/Lore.md#^p-abc'
    );
    expect(
      relativeLinkTarget(
        'AI Tool/Foundry/Journals/Lore/Page.md',
        'AI Tool/Foundry/Journals/Lore.md'
      )
    ).toBe('../Lore.md');
    expect(relativeLinkTarget(npc, 'Prep/NPCs/Wolf prep.md')).toBe(
      '../../../Prep/NPCs/Wolf%20prep.md'
    );
  });

  it('keeps wikilink labels inert', () => {
    expect(wikilinkLabel('A [[b]] | c #tag ^x\nnext')).toBe('A b c tag x next');
    expect(propertyWikilink('ai-tool-test', 'AI Tool/Foundry/NPCs/Wolf.md', 'Wolf|x')).toBe(
      '[[Campaigns/ai-tool-test/AI Tool/Foundry/NPCs/Wolf|Wolf x]]'
    );
    expect(propertyWikilink('w', 'AI Tool/Foundry/NPCs/Wolf.md', '')).toBe(
      '[[Campaigns/w/AI Tool/Foundry/NPCs/Wolf]]'
    );
  });

  it('starts an empty status with zero counts', () => {
    const s = emptyMirrorStatus({
      enabled: false,
      vaultDirSet: true,
      worldId: null,
      openBase: 'x',
    });
    expect(Object.values(s.counts).every(n => n === 0)).toBe(true);
    expect(s.errors).toEqual([]);
  });
});
