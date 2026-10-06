import { describe, expect, it } from 'vitest';

import {
  PREP_KINDS,
  campaignRootOf,
  fillPrepNote,
  findPrepNote,
  isPrepType,
  localDate,
  prepFileName,
  prepKindsFor,
  prepPathCandidates,
  prepUuid,
  type PrepKind,
  type PrepLookupNote,
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
    expect(prepFileName(`${'x'.repeat(98)}. y`)).toBe('x'.repeat(98));
    expect(prepFileName('Tab\there\u0007bell')).toBe('Tab here bell');
    expect(prepFileName('CON')).toBe('CON_');
    expect(prepFileName('com1')).toBe('com1_');
    expect(prepFileName('AUX.')).toBe('AUX_');
    expect(prepFileName('aux.notes')).toBe('aux_.notes');
    expect(prepFileName('Auxiliary')).toBe('Auxiliary');
    expect(prepFileName('Console')).toBe('Console');
  });

  it('numbers the names after the first', () => {
    expect(prepPathCandidates('P/NPCs', 'Guard', 3)).toEqual([
      'P/NPCs/Guard.md',
      'P/NPCs/Guard 2.md',
      'P/NPCs/Guard 3.md',
    ]);
  });
});

describe('findPrepNote', () => {
  const root = 'Campaigns/strahd';
  const note = (path: string, type: string, uuid: string): PrepLookupNote => ({
    path,
    frontmatter: { type, fvtt_uuid: uuid },
  });
  it('finds a moved or renamed note by uuid and type under Prep, never a template', () => {
    const notes = [
      note('Campaigns/strahd/Prep/Templates/NPC.md', 'npc-prep', 'Actor.a1'),
      note('Campaigns/other/Prep/NPCs/Ismark.md', 'npc-prep', 'Actor.a1'),
      note('Campaigns/strahd/Prep/Quests/Ismark.md', 'quest-prep', 'Actor.a1'),
      note('Campaigns/strahd/prep/Old/Ismark the Lesser.md', 'npc-prep', 'Actor.a1'),
    ];
    expect(findPrepNote(notes, root, 'Actor.a1', 'npc-prep')).toBe(
      'Campaigns/strahd/prep/Old/Ismark the Lesser.md'
    );
    expect(findPrepNote(notes.slice(0, 3), root, 'Actor.a1', 'npc-prep')).toBeNull();
    expect(
      findPrepNote(
        [{ path: 'Campaigns/strahd/Prep/x.md', frontmatter: undefined }],
        root,
        'Actor.a1',
        'npc-prep'
      )
    ).toBeNull();
  });
});

describe('localDate', () => {
  it('is YYYY-MM-DD in local time', () => {
    expect(localDate(new Date(2026, 9, 6, 23, 59))).toBe('2026-10-06');
    expect(localDate(new Date(2027, 0, 2))).toBe('2027-01-02');
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

  it('reads an empty frontmatter block and fills a session plan date (R2 review)', () => {
    expect(fillPrepNote('---\n---\nBody', fill)).toBe(
      "---\ntype: npc-prep\nfvtt_uuid: 'Actor.a1'\n---\nPrep for [[Ismark]].\n\nBody\n"
    );
    expect(fillPrepNote('---\n---\nAbove\n\n---\n\nBelow', fill)).toBe(
      "---\ntype: npc-prep\nfvtt_uuid: 'Actor.a1'\n---\nPrep for [[Ismark]].\n\nAbove\n\n---\n\nBelow\n"
    );
    const plan = '---\ntype: session-plan\nfvtt_uuid:\ndate:\n---\n## Opening scene\n';
    expect(
      fillPrepNote(plan, {
        type: 'session-plan',
        uuid: 'Scene.s1',
        link: '[[Barovia]]',
        date: '2026-10-06',
      })
    ).toBe(
      "---\ntype: session-plan\nfvtt_uuid: 'Scene.s1'\ndate: 2026-10-06\n---\nPrep for [[Barovia]].\n\n## Opening scene\n"
    );
  });
});
