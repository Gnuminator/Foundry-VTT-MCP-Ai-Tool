// The After view: get-play-stats for the latest session, and the session notes (GET
// /api/session-notes). Made-up names only.
import { at, iso } from './common';
import type { PlayStats } from '../../lib/afterStats';
import type { SessionNotes } from '../../lib/sessionNotes';

export const PLAY_STATS: PlayStats = {
  pcs: [{ name: 'Brenna' }, { name: 'Tobias' }, { name: 'Mara' }],
  session: {
    label: 'Session 3',
    durationMin: 185,
    endedAt: iso(at(21, 30)),
    rolls: 142,
    crits: 3,
    fumbles: 2,
    highestRoll: { total: 27, name: 'Mara', label: 'Perception' },
    combats: [
      { damageDealt: { Brenna: 31, Tobias: 12, 'Harbor thug': 40 }, downs: ['Brenna'] },
      { damageDealt: { Brenna: 8, Mara: 22 }, downs: [] },
    ],
    pcDownsByName: { Brenna: 2 },
  },
};

export const PLAY_STATS_QUIET: PlayStats = {
  pcs: [{ name: 'Brenna' }],
  session: {
    label: 'Session 4',
    durationMin: 42,
    endedAt: iso(at(21, 30)),
    rolls: 9,
    crits: 0,
    fumbles: 0,
    highestRoll: null,
    combats: [],
  },
};

export const NO_PLAY_STATS: PlayStats = { pcs: [], session: null };

const NOTES_STAGED: SessionNotes = {
  sessionId: '2026-10-08-session-3',
  title: 'Session 3',
  date: '2026-10-08',
  status: 'staged',
  autoPut: true,
  waitingFor: [],
};
const IN_FOUNDRY = {
  putAt: iso(at(21, 45)),
  changeId: 'change-notes-1',
  journalUuid: 'JournalEntry.notes1',
  recapRevealed: false,
};

export const NOTES_STAGED_WAITING: SessionNotes = {
  ...NOTES_STAGED,
  waitingFor: ['foundry', 'feature-off'],
};
export const NOTES_IN_FOUNDRY: SessionNotes = {
  ...NOTES_STAGED,
  ...IN_FOUNDRY,
  status: 'in-foundry',
};
export const NOTES_REVEALED: SessionNotes = { ...NOTES_IN_FOUNDRY, recapRevealed: true };
export const NOTES_APPROVED: SessionNotes = {
  ...NOTES_IN_FOUNDRY,
  status: 'approved',
  approvedAt: iso(at(22, 5)),
};
export const NOTES_UNDONE: SessionNotes = {
  ...NOTES_STAGED,
  autoPut: false,
  lastError: 'Foundry did not answer in time.',
};

/** GET /api/session-notes/:id. */
export const NOTES_PAGES = {
  pages: [
    {
      key: 'summary',
      title: 'GM summary',
      html: '<h2>Harbor Market</h2><p>The crew <strong>found</strong> the missing lantern.</p><ul><li>Brenna went down once</li><li>Mara spotted the smuggler</li></ul>',
    },
    {
      key: 'recap',
      title: 'Recap',
      html: '<p>Last time, the lantern crew crossed the harbor.</p>',
    },
  ],
};
