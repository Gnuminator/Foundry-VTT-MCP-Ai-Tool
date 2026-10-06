import { describe, expect, it } from 'vitest';

import {
  PREP_KINDS,
  campaignRootOf,
  fillPrepNote,
  isPrepType,
  prepFileName,
  prepKindsFor,
  prepPathCandidates,
  prepUuid,
  type PrepKind,
} from './prep.js';

function kind(id: PrepKind['id']): PrepKind {
  const found = PREP_KINDS.find(k => k.id === id);
  if (!found) throw new Error(id);
  return found;
}

// The export's NPC template (packages/mcp-server/src/obsidian/prep-templates.ts), as written.
const NPC_TEMPLATE = [
  '---',
  'type: npc-prep',
  'fvtt_uuid:',
  'ai_context: true',
  'secret:',
  'voice:',
  'wants:',
  '---',
  '%% NPC prep hint. %%',
  '',
  '## What they do next',
  '',
  '## What they know',
  '',
].join('\n');

describe('prepKindsFor', () => {
  it('offers the likely kind first, by the mirror type, else the Foundry type', () => {
    expect(prepKindsFor('npc', 'Actor').map(k => k.id)).toEqual([
      'npc',
      'location',
      'quest',
      'session',
    ]);
    expect(prepKindsFor('scene', 'Scene')[0]?.id).toBe('location');
    expect(prepKindsFor('journal-page', 'JournalEntryPage')[0]?.id).toBe('quest');
    expect(prepKindsFor(null, 'JournalEntry')[0]?.id).toBe('quest');
    expect(prepKindsFor('something-new', 'Item')[0]?.id).toBe('npc');
    expect(prepKindsFor('scene', 'Scene')).toHaveLength(4);
  });
});

describe('campaignRootOf', () => {
  it('is the world campaign folder the note sits in, else null', () => {
    expect(campaignRootOf('Campaigns/w1/AI Tool/World/NPCs/Ismark.md', 'w1')).toBe('Campaigns/w1');
    expect(campaignRootOf('Campaigns/w2/Ismark.md', 'w1')).toBeNull();
    expect(campaignRootOf('Elsewhere/Ismark.md', 'w1')).toBeNull();
    expect(campaignRootOf('Campaigns/w1/Ismark.md', null)).toBeNull();
    expect(campaignRootOf('Campaigns/a/b/x.md', 'a/b')).toBeNull();
  });
});

describe('prepFileName and prepPathCandidates', () => {
  it('makes a safe file name', () => {
    expect(prepFileName('Ismark the Lesser')).toBe('Ismark the Lesser');
    expect(prepFileName('Who? [Strahd]: #1 / 2')).toBe('Who Strahd 1 2');
    expect(prepFileName('...')).toBe('Untitled');
    expect(prepFileName(null)).toBe('Untitled');
    expect(prepFileName('x'.repeat(300))).toHaveLength(100);
  });

  it('numbers the names after the first', () => {
    expect(prepPathCandidates('P/NPCs', 'Guard', 3)).toEqual([
      'P/NPCs/Guard.md',
      'P/NPCs/Guard 2.md',
      'P/NPCs/Guard 3.md',
    ]);
  });
});

describe('prepUuid', () => {
  it('points quest prep on a journal page at its journal, else keeps the uuid', () => {
    const page = 'JournalEntry.j1.JournalEntryPage.p1';
    expect(prepUuid(kind('quest'), page)).toBe('JournalEntry.j1');
    expect(prepUuid(kind('location'), page)).toBe(page);
    expect(prepUuid(kind('quest'), 'Actor.a1')).toBe('Actor.a1');
  });
});

describe('isPrepType', () => {
  it('knows the prep note types', () => {
    expect(isPrepType('npc-prep')).toBe(true);
    expect(isPrepType('session-plan')).toBe(true);
    expect(isPrepType('npc')).toBe(false);
    expect(isPrepType(undefined)).toBe(false);
  });
});

describe('fillPrepNote', () => {
  const fill = { type: 'npc-prep', uuid: 'Actor.a1', link: '[[Ismark]]' };

  it('fills fvtt_uuid in the template and adds the link back first in the body', () => {
    expect(fillPrepNote(NPC_TEMPLATE, fill)).toBe(
      [
        '---',
        'type: npc-prep',
        "fvtt_uuid: 'Actor.a1'",
        'ai_context: true',
        'secret:',
        'voice:',
        'wants:',
        '---',
        'Prep for [[Ismark]].',
        '',
        '%% NPC prep hint. %%',
        '',
        '## What they do next',
        '',
        '## What they know',
        '',
      ].join('\n')
    );
  });

  it('replaces a list under fvtt_uuid, keeps a custom type, reads CRLF and a BOM', () => {
    const template =
      '\uFEFF---\r\ntype: villain-prep\r\nfvtt_uuid:\r\n- Actor.old\r\n  - Actor.x\r\nmood: grim\r\n---\r\nBody\r\n';
    expect(fillPrepNote(template, fill)).toBe(
      "---\ntype: villain-prep\nfvtt_uuid: 'Actor.a1'\nmood: grim\n---\nPrep for [[Ismark]].\n\nBody\n"
    );
  });

  it('adds type and fvtt_uuid when the template has neither, and makes a bare note without one', () => {
    expect(fillPrepNote('---\nsecret:\n---\n', fill)).toBe(
      "---\ntype: npc-prep\nfvtt_uuid: 'Actor.a1'\nsecret:\n---\nPrep for [[Ismark]].\n"
    );
    expect(fillPrepNote('Just a body', fill)).toBe(
      "---\ntype: npc-prep\nfvtt_uuid: 'Actor.a1'\nai_context: true\nsecret:\n---\nPrep for [[Ismark]].\n\nJust a body\n"
    );
    expect(fillPrepNote(null, fill)).toBe(
      "---\ntype: npc-prep\nfvtt_uuid: 'Actor.a1'\nai_context: true\nsecret:\n---\nPrep for [[Ismark]].\n"
    );
  });
});
