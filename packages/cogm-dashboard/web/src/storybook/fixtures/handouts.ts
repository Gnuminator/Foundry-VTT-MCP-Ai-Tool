// list-revealed-pages, list-scenes and /api/player/names: the handout queue and the seen log.
import { at, iso } from './common';

const page = (n: number): string => `JournalEntry.j1.JournalEntryPage.p${n}`;

export const PLAYERS = [
  { userId: 'u1', name: 'Mara' },
  { userId: 'u2', name: 'Tobias' },
  { userId: 'u3', name: 'Nell' },
];

export const SCENES = [
  { id: 's1', name: 'Harbor Market', active: true },
  { id: 's2', name: 'Old Mill', active: false },
];

export const HANDOUTS = {
  queue: [
    {
      entryId: 'e1',
      uuid: page(1),
      title: 'Letter from the harbormaster',
      exists: true,
      sceneId: 's1',
      addedAt: iso(at(10)),
    },
    {
      entryId: 'e2',
      uuid: page(2),
      title: 'Map of the old mill',
      exists: true,
      sceneId: 's2',
      players: ['u1'],
      addedAt: iso(at(11)),
    },
    {
      entryId: 'e3',
      uuid: page(3),
      title: 'Torn ledger page',
      exists: true,
      sceneId: null,
      addedAt: iso(at(12)),
    },
    {
      entryId: 'e4',
      uuid: page(4),
      title: 'A very long handout title that goes on about the harbormaster and his many ledgers',
      exists: false,
      sceneId: null,
      addedAt: iso(at(12, 30)),
    },
  ],
  pages: [
    {
      pageId: 'p6',
      uuid: page(6),
      title: 'Wanted poster',
      exists: true,
      observable: true,
      feature: 'handouts',
      revealedAt: iso(at(17, 30)),
      seenBy: [
        { userId: 'u1', name: 'Mara', at: iso(at(17, 45)) },
        { userId: 'u2', name: 'Tobias', at: iso(at(18, 5)) },
      ],
    },
    {
      pageId: 'p7',
      uuid: page(7),
      title: 'Smuggler code',
      exists: true,
      observable: true,
      feature: 'handouts',
      revealedAt: iso(at(18, 40)),
      seenBy: [],
    },
  ],
};

export const HANDOUTS_EMPTY = { queue: [], pages: [] };
