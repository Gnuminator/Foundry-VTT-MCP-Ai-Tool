// Fixtures for the stories. The repo is public and these are only ever made-up names (a harbor
// town, a lantern crew, SRD-style items): never text, names or maps from a campaign book. Tarokka
// cards are placeholders, not the deck. Times are absolute, so a story looks the same on every day.

export const WORLD = { id: 'harbor-test', title: 'Harbor Town' };

export const PLAY_SESSION_CLOSED = {
  success: true,
  worldId: WORLD.id,
  open: false,
  endedAt: null,
};

export const PLAY_SESSION_OPEN = {
  success: true,
  worldId: WORLD.id,
  open: true,
  endedAt: null,
};

/** 2026-10-08 at this hour (UTC) and minute, in milliseconds. */
export const at = (hour: number, minute = 0): number => Date.UTC(2026, 9, 8, hour, minute);
export const iso = (ms: number): string => new Date(ms).toISOString();

/** The page the "?" next to a panel title opens (GET /api/help/:page). */
export const HELP_PAGE = {
  page: 'README',
  title: 'GM guide (sample)',
  html: [
    '<h1>GM guide (sample)</h1>',
    '<p>This is a made-up guide page, so the help pane has something to show in a story.</p>',
    '<h2 id="before">Before the session</h2>',
    '<p>Run Pre-flight, read the prep digest, and queue the handouts you plan to use.</p>',
    '<h2 id="during">During the session</h2>',
    '<p>Keep the party panel open. Changes you make are planned first and can be undone.</p>',
  ].join(''),
};
