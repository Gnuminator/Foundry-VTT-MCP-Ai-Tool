// Fixtures for the Recent Changes stories: what list-recent-changes (the AI tab), list-changes (the
// Everyone tab) and plan-undo-changes answer. Made up, like every fixture here: a harbor town and
// a lantern crew, no campaign text. Times are absolute (8 October, UTC).
import { at, iso } from './common';

/** GET /api/tools with the tool the Everyone tab needs; the panel reads only the names. */
export const TOOLS_WITH_EVERYONE = {
  tools: [{ name: 'list-recent-changes' }, { name: 'list-changes' }, { name: 'undo-change' }],
  gmActionsEnabled: true,
};

/** An older bridge: no list-changes, so there is no Everyone tab. */
export const TOOLS_AI_ONLY = {
  tools: [{ name: 'list-recent-changes' }, { name: 'undo-change' }],
  gmActionsEnabled: true,
};

const aiChange = (
  n: number,
  minutes: number,
  extra: Record<string, unknown>
): Record<string, unknown> => ({
  changeId: `chg-${n}`,
  summary: 'Moved the Ogre Brute token',
  feature: 'token-move',
  target: 'Harbor Market',
  appliedAt: iso(at(19, minutes)),
  mode: 'apply',
  risk: 'write',
  canUndo: true,
  diff: ['Ogre Brute: moved from (12, 4) to (14, 5)'],
  ...extra,
});

/** list-recent-changes: newest first, one of each state a row can have. */
export const AI_CHANGES = {
  changes: [
    aiChange(5, 40, {
      summary: 'Revealed "A Harbor Notice" to players',
      feature: 'page-reveal',
      target: 'Handouts',
      risk: 'destructive',
      diff: ['Page "A Harbor Notice": revealed to every player', 'Copied into Handouts'],
      requestedBy: 'Danni',
    }),
    aiChange(4, 31, {
      summary: 'Undo: Brenna takes 6 fire damage',
      feature: 'change-undo',
      mode: 'undo',
      canUndo: false,
      diff: ['Brenna: HP 7 back to 13'],
    }),
    aiChange(3, 30, {
      summary: 'Brenna takes 6 fire damage',
      feature: 'actor-change',
      target: 'Brenna',
      undoneBy: 'chg-4',
      canUndo: false,
      diff: ['Brenna: HP 13 to 7'],
    }),
    aiChange(2, 20, {
      summary: 'Added the Poisoned condition to Aldric',
      feature: 'actor-change',
      target: 'Aldric',
      diff: [],
    }),
    aiChange(1, 5, {}),
  ],
};

export const AI_CHANGES_EMPTY = { changes: [] };

/** A very long summary and many lines, for the layout. */
export const AI_CHANGES_LONG = {
  changes: [
    aiChange(9, 50, {
      summary:
        'Set the lanterns along the whole Old Mill Road below the salt warehouses to dim, with fog for the night scene',
      target: 'The Old Mill Road Below the Salt Warehouses (night, fog)',
      diff: Array.from({ length: 12 }, (_, i) => `Lantern ${i + 1}: bright to dim`),
    }),
  ],
};

const everyoneChange = (
  id: string,
  minutes: number,
  extra: Record<string, unknown>
): Record<string, unknown> => ({
  kind: 'ai',
  id,
  at: iso(at(19, minutes)),
  by: 'AI Tool',
  summary: 'Moved the Ogre Brute token',
  lines: ['Ogre Brute: moved from (12, 4) to (14, 5)'],
  canUndo: true,
  undone: false,
  things: [{ uuid: 'Scene.s1.Token.t1', name: 'Ogre Brute' }],
  ...extra,
});

/** list-changes: players, the GM and the AI, newest first. */
export const EVERYONE_CHANGES = {
  changes: [
    everyoneChange('ev-6', 45, {
      kind: 'ai',
      by: 'AI Tool',
      summary: 'Undo: Undo: Brenna takes 6 fire damage',
      mode: 'undo',
      feature: 'change-undo',
      requestedBy: 'Danni',
      canUndo: true,
      lines: ['Brenna: HP 13 to 7'],
      covers: 1,
    }),
    everyoneChange('ev-5', 40, {
      kind: 'human',
      by: 'Brenna',
      summary: 'Brenna changed her Hit Points',
      lines: ['HP 13 to 7'],
      canUndo: true,
      things: [{ uuid: 'Actor.a2', name: 'Brenna' }],
    }),
    everyoneChange('ev-4', 35, {
      kind: 'ai',
      summary: 'Revealed "A Harbor Notice" to players',
      feature: 'page-reveal',
      ownData: true,
      lines: ['Page "A Harbor Notice": revealed to every player'],
      things: [{ uuid: 'JournalEntry.j1.JournalEntryPage.p1', name: 'A Harbor Notice' }],
    }),
    everyoneChange('ev-3', 30, {
      kind: 'ai',
      summary: 'Undo: Brenna takes 6 fire damage',
      mode: 'undo',
      feature: 'change-undo',
      requestedBy: 'Danni',
      canUndo: true,
      lines: ['Brenna: HP 7 back to 13'],
      covers: 1,
    }),
    everyoneChange('ev-2', 25, {
      kind: 'ai',
      summary: 'Brenna takes 6 fire damage',
      undone: true,
      undoneBy: 'ev-3',
      canUndo: false,
      lines: ['Brenna: HP 13 to 7'],
      things: [{ uuid: 'Actor.a2', name: 'Brenna' }],
    }),
    everyoneChange('ev-1', 10, {
      kind: 'human',
      by: 'Aldric (Tomas)',
      summary: 'Aldric used a hit die',
      canUndo: false,
      lines: ['Hit dice 3 to 2'],
    }),
  ],
  note: '',
};

export const EVERYONE_CHANGES_EMPTY = { changes: [], note: '' };

/** The list is empty and the tool says why. */
export const EVERYONE_CHANGES_NOTE = {
  changes: [],
  note: 'Changes made before this world was opened today are not kept.',
};

/** plan-undo-changes for a change that is the latest on its thing: straight to the confirm. */
export const PLAN_JUST_THIS = {
  planId: 'plan-undo-1',
  summary: 'Undo: Moved the Ogre Brute token',
  scope: 'just-this',
  risk: 'write',
  requires: { confirm: true, confirmDestructive: false },
  diff: [
    { kind: 'change', text: 'Ogre Brute: move back to (12, 4)' },
    { kind: 'note', text: 'Nothing else is touched.' },
  ],
  later: [],
};

/** A change with later ones on the same thing: the window asks first. */
export const PLAN_WITH_LATER = {
  ...PLAN_JUST_THIS,
  planId: 'plan-undo-2',
  later: [
    { id: 'ev-5', at: iso(at(19, 40)), by: 'Brenna', summary: 'Brenna changed her Hit Points' },
    { id: 'ev-6', at: iso(at(19, 45)), by: 'AI Tool', summary: 'Brenna takes 3 radiant damage' },
  ],
};

export const PLAN_EVERYTHING_SINCE = {
  ...PLAN_JUST_THIS,
  planId: 'plan-undo-3',
  summary: 'Undo everything since: 3 changes',
  scope: 'everything-since',
  diff: [
    { kind: 'change', text: 'Ogre Brute: move back to (12, 4)' },
    { kind: 'change', text: 'Brenna: HP 7 back to 13' },
    { kind: 'change', text: 'Brenna: HP 4 back to 7' },
  ],
  later: [],
};

export const PLAN_REWIND = {
  ...PLAN_JUST_THIS,
  planId: 'plan-undo-4',
  summary: 'Rewind the table: 12 changes',
  scope: 'world-since',
  risk: 'destructive',
  requires: { confirm: true, confirmDestructive: true },
  count: 12,
  diff: Array.from({ length: 12 }, (_, i) => ({
    kind: 'change',
    text: `Change ${i + 1}: put back`,
  })),
  later: [],
};
