// The After view on the React dashboard: Tonight's stats (get-play-stats, faked here) with Copy for
// Discord and the Obsidian link, and the Session notes card (/api/session-notes) with Read, Put in
// Foundry, Approve without revealing and Undo, the gate when GM Actions are off, and that nothing
// loads while another moment is on screen.
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  GM_TOKEN,
  fakeCommonRoutes,
  fakeStream,
  fakeTools,
  ok,
  toast,
  type ToolCall,
} from './support';

const NOW = new Date(2026, 9, 10, 20, 0).getTime();
const HOUR = 60 * 60 * 1000;

const STATS = {
  pcs: [{ name: 'Brenna' }, { name: 'Mara' }],
  session: {
    label: 'Session 3',
    durationMin: 185,
    endedAt: new Date(NOW - 2 * HOUR).toISOString(),
    rolls: 142,
    crits: 3,
    fumbles: 1,
    highestRoll: { total: 27, name: 'Mara', label: 'Perception' },
    combats: [{ damageDealt: { Brenna: 31, Mara: 22, 'Harbor thug': 40 }, downs: ['Brenna'] }],
    pcDownsByName: { Brenna: 2 },
  },
};

const NOTES = {
  sessionId: 'session-3',
  title: 'Session 3',
  date: '2026-10-08',
  status: 'in-foundry',
  autoPut: true,
  waitingFor: [],
  putAt: '2026-10-08T21:45:00.000Z',
  changeId: 'change-1',
  journalUuid: 'JournalEntry.n1',
  recapRevealed: false,
};

const PAGES = {
  pages: [
    {
      key: 'summary',
      title: 'GM summary',
      html: '<h2 onclick="window.__x=1">Harbor Market</h2><p class="a">The crew <strong>found</strong> the lantern. <a href="javascript:window.__x=2">link</a></p><script>window.__x=3</script><img src=x onerror="window.__x=4"><ul><li>Brenna went down</li></ul>',
    },
  ],
};

interface Setup {
  gmActions?: boolean;
  notes?: unknown[];
  /** The newest session's notes/status.json (GET /api/session-notes/pipeline); none by default. */
  pipeline?: unknown;
  stats?: unknown;
  obsidian?: boolean;
  /** The session ended 13 hours ago: Before is on screen. */
  before?: boolean;
}

/** Writes the notes routes made, in order. */
async function fakeAfter(
  page: Page,
  setup: Setup = {}
): Promise<{ calls: ToolCall[]; posts: string[] }> {
  const posts: string[] = [];
  let items = setup.notes ?? [NOTES];
  await fakeCommonRoutes(page);
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  await page.route('**/api/session/switches', route =>
    route.fulfill({
      json: {
        switches: { switches: [] },
        gmActionsEnabled: setup.gmActions !== false,
        error: null,
      },
    })
  );
  await page.route('**/api/session-notes', route => route.fulfill({ json: { items } }));
  await page.route('**/api/session-notes/pipeline', route =>
    route.fulfill({ json: { pipeline: setup.pipeline ?? null } })
  );
  await page.route('**/api/session-notes/session-3', route => route.fulfill({ json: PAGES }));
  for (const action of ['put', 'approve']) {
    await page.route(`**/api/session-notes/session-3/${action}`, route => {
      posts.push(action);
      if (action === 'approve') {
        items = [{ ...NOTES, status: 'approved', approvedAt: '2026-10-08T22:05:00.000Z' }];
      }
      return route.fulfill({
        json: action === 'put' ? { changeId: 'change-2', summary: 'Put the notes in Foundry' } : {},
      });
    });
  }
  await fakeStream(page, [
    {
      event: 'settings',
      data: {
        gmActionsEnabled: setup.gmActions !== false,
        ...(setup.obsidian ? { obsidian: { vault: 'Vault' } } : {}),
      },
    },
    { event: 'world', data: { id: 'harbor', title: 'Harbor' } },
  ]);
  const calls = await fakeTools(
    page,
    call => {
      switch (call.name) {
        case 'get-play-session':
          return ok({
            success: true,
            worldId: 'harbor',
            open: false,
            endedAt: new Date(NOW - (setup.before ? 13 : 2) * HOUR).toISOString(),
          });
        case 'get-play-stats':
          return ok(setup.stats ?? STATS);
        case 'undo-change':
          return ok({ summary: 'Undid the notes' });
        case 'get-prep-digest':
          return ok({
            action: 'summary',
            computedAt: NOW,
            lastSession: null,
            preflight: { fail: 0, warn: 0, items: [] },
            warnings: [],
          });
        case 'list-revealed-pages':
          return ok({ pages: [], queue: [] });
        case 'list-scenes':
          return ok([]);
        default:
          return ok({});
      }
    },
    { playSession: true }
  );
  return { calls, posts };
}

const stats = (page: Page): Locator => page.getByRole('region', { name: "Tonight's stats" });
const notes = (page: Page): Locator => page.getByRole('region', { name: 'Session notes' });

async function load(page: Page): Promise<void> {
  await page.clock.install({ time: NOW });
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await expect(page.getByRole('tab', { name: 'After' })).toHaveAttribute('aria-selected', 'true');
}

test('shows the stat cards and the session line', async ({ page }) => {
  await fakeAfter(page);
  await load(page);
  const card = (title: string): Locator => stats(page).locator('.stat-card', { hasText: title });
  await expect(card('Rolls')).toContainText('142');
  await expect(card('Rolls')).toContainText('3 natural 20s, 1 natural 1');
  await expect(card('Most damage')).toContainText('Brenna');
  await expect(card('Most damage')).toContainText('31 hp over 1 fight');
  await expect(card('Highest roll')).toContainText('27');
  await expect(card('Highest roll')).toContainText('Mara, Perception');
  await expect(card('Went down')).toContainText('Brenna, twice');
  await expect(stats(page).locator('#stat-session-title')).toHaveText('Session 3');
  await expect(stats(page).locator('#stat-session-meta')).toContainText('3 h 5 min');
  await expect(stats(page).locator('#stat-session-meta')).toContainText('1 fight');
});

test('says so when there is no session, and when the stats fail', async ({ page }) => {
  await fakeAfter(page, { stats: { pcs: [], session: null }, notes: [] });
  await load(page);
  await expect(stats(page)).toContainText('No play session recorded yet.');
  await expect(
    stats(page).getByRole('button', { name: 'Copy the stats for Discord' })
  ).toBeDisabled();
  await expect(notes(page)).toHaveCount(0);
});

test('Copy puts the stats on the clipboard without the highest roll', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fakeAfter(page);
  await load(page);
  await stats(page).getByRole('button', { name: 'Copy the stats for Discord' }).click();
  await expect(toast(page, '✓ Copied. The highest roll is left out')).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('**Session 3** (3 h 5 min)');
  expect(text).toContain('Most damage: Brenna, 31 hp over 1 fight');
  expect(text).not.toContain('Perception');
});

test('Open the session note is an obsidian link once the vault and world are known', async ({
  page,
}) => {
  await fakeAfter(page, { obsidian: true });
  await load(page);
  await expect(stats(page).getByRole('link', { name: 'Open the session note' })).toHaveAttribute(
    'href',
    'obsidian://open?vault=Vault&file=Campaigns%2Fharbor%2FAI%20Tool%2FSessions%2FSession%203'
  );
});

test('no Obsidian link without the mirror', async ({ page }) => {
  await fakeAfter(page);
  await load(page);
  await expect(stats(page).locator('.stat-card').first()).toBeVisible();
  await expect(stats(page).getByRole('link', { name: 'Open the session note' })).toHaveCount(0);
});

test('Refresh asks again', async ({ page }) => {
  const { calls } = await fakeAfter(page);
  await load(page);
  await expect(stats(page).locator('.stat-card').first()).toBeVisible();
  const before = calls.filter(c => c.name === 'get-play-stats').length;
  await stats(page).getByRole('button', { name: '↻ Refresh' }).click();
  await expect.poll(() => calls.filter(c => c.name === 'get-play-stats').length).toBe(before + 1);
});

test('the notes card says where the notes are and offers Read, Approve and Undo', async ({
  page,
}) => {
  await fakeAfter(page);
  await load(page);
  await expect(notes(page).locator('#notes-title')).toHaveText('Session notes: Session 3');
  await expect(notes(page).locator('.feature-pill')).toHaveText('In Foundry');
  await expect(notes(page).locator('#notes-line')).toContainText('GM-only journal');
  await expect(notes(page).getByRole('button')).toHaveText([
    'Read',
    'Approve without revealing',
    'Undo',
  ]);
});

test('Read shows the notes with only plain text tags', async ({ page }) => {
  await fakeAfter(page);
  await load(page);
  await notes(page).getByRole('button', { name: 'Read' }).click();
  const pane = page.getByRole('dialog', { name: 'Session notes: Session 3' });
  await expect(pane.getByRole('heading', { name: 'GM summary' })).toBeVisible();
  await expect(pane.getByRole('heading', { name: 'Harbor Market' })).toBeVisible();
  await expect(pane.locator('strong')).toHaveText('found');
  await expect(pane.getByText('Brenna went down')).toBeVisible();
  // No attributes, no scripts, no images, no links.
  await expect(pane.locator('[onclick], a, img, script')).toHaveCount(0);
  expect(await pane.locator('.help-body, .pane-body').first().innerHTML()).not.toContain('onerror');
  expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
});

test('Approve without revealing posts the approval and reloads the card', async ({ page }) => {
  const { posts } = await fakeAfter(page);
  await load(page);
  await notes(page).getByRole('button', { name: 'Approve without revealing' }).click();
  await expect(toast(page, '✓ Approved. The audio is kept.')).toBeVisible();
  expect(posts).toEqual(['approve']);
  await expect(notes(page).locator('.feature-pill')).toHaveText('Approved');
  await expect(notes(page).getByRole('button', { name: 'Approve without revealing' })).toHaveCount(
    0
  );
});

test('with GM Actions off Approve is refused before anything is sent', async ({ page }) => {
  const { posts } = await fakeAfter(page, { gmActions: false });
  await load(page);
  await notes(page).getByRole('button', { name: 'Approve without revealing' }).click();
  await expect(toast(page, 'GM Actions are off.')).toBeVisible();
  expect(posts).toEqual([]);
});

test('Undo asks first, then undoes the change', async ({ page }) => {
  const { calls } = await fakeAfter(page);
  await load(page);
  await notes(page).getByRole('button', { name: 'Undo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Destructive action' });
  await expect(dialog.getByText('Take the session notes out of Foundry again?')).toBeVisible();
  expect(calls.filter(c => c.name === 'undo-change')).toHaveLength(0);
  // An undo is a destructive write: it asks for the tick as well.
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Run destructive action' }).click();
  await expect.poll(() => calls.filter(c => c.name === 'undo-change')).toHaveLength(1);
  expect(calls.find(c => c.name === 'undo-change')).toMatchObject({
    args: { changeId: 'change-1' },
    confirm: true,
    confirmDestructive: true,
  });
});

test('notes that wait show what they wait for and the switch link', async ({ page }) => {
  await fakeAfter(page, {
    notes: [
      { ...NOTES, status: 'staged', waitingFor: ['foundry', 'feature-off'], changeId: undefined },
    ],
  });
  await load(page);
  await expect(notes(page).locator('.feature-pill')).toHaveText('Waiting');
  await expect(notes(page).locator('#notes-line')).toContainText('a GM in Foundry');
  await expect(notes(page).getByRole('button', { name: 'About the switch' })).toBeVisible();
});

const PASS_PILLS: Record<string, string> = {
  done: 'Done',
  paused: 'Paused',
  incomplete: 'Incomplete',
  failed: 'Failed',
  waiting: 'Waiting',
  published: 'Published',
};
for (const [state, pill] of Object.entries(PASS_PILLS)) {
  test(`without staged notes the pill says ${pill} when the last pass is ${state}`, async ({
    page,
  }) => {
    await fakeAfter(page, {
      notes: [],
      pipeline: { session: '2026-10-08_2000-harbor', state, message: 'why' },
    });
    await load(page);
    await expect(notes(page).locator('.feature-pill')).toHaveText(pill);
    await expect(notes(page).locator('#notes-pipeline')).toHaveAttribute('data-state', state);
  });
}

test('Put in Foundry after an Undo, with an Undo on the toast', async ({ page }) => {
  const { posts } = await fakeAfter(page, {
    notes: [{ ...NOTES, status: 'staged', autoPut: false, changeId: undefined }],
  });
  await load(page);
  await expect(notes(page).locator('#notes-line')).toContainText('taken out with Undo');
  await notes(page).getByRole('button', { name: 'Put in Foundry' }).click();
  await expect(toast(page, '✓ Put the notes in Foundry')).toBeVisible();
  expect(posts).toEqual(['put']);
});

test('nothing loads while Before is on screen, and it loads when After is picked', async ({
  page,
}) => {
  const { calls } = await fakeAfter(page, { before: true });
  let notesAsked = 0;
  await page.route('**/api/session-notes', route => {
    notesAsked += 1;
    return route.fulfill({ json: { items: [NOTES] } });
  });
  await page.clock.install({ time: NOW });
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await expect(page.getByRole('tab', { name: 'Before' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#moment-before')).toBeVisible();
  await page.waitForTimeout(300);
  expect(calls.filter(c => c.name === 'get-play-stats')).toHaveLength(0);
  expect(notesAsked).toBe(0);

  await page.getByRole('tab', { name: 'After' }).click();
  await expect(stats(page).locator('.stat-card').first()).toBeVisible();
  await expect(notes(page)).toBeVisible();
  expect(notesAsked).toBe(1);
});
