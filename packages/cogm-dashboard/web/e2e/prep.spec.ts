// The Prep drawer on the React dashboard: the get-prep-digest read (POST /api/tool, faked here),
// every section, "All beats" (the last-session action), the Open buttons (open-in-foundry), the
// empty and failed states, and the jump to Pre-flight.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, fakeTools, ok, fromMenu } from './support';

const DIGEST = {
  schema: 1,
  action: 'summary',
  worldId: 'w',
  computedAt: Date.UTC(2026, 9, 8, 18, 30),
  lastSession: {
    number: 3,
    label: '',
    date: '2026-10-01',
    startedAt: '',
    endedAt: '',
    durationMin: 185,
    scenes: ['Village of Barovia', 'Church'],
    combats: 1,
    combatRounds: 4,
    pcDowns: 2,
    npcKills: 0,
    spellsCast: 0,
    wentDown: { pcs: ['Ireena'], others: [] },
    beats: [{ at: '2026-10-01T19:05:00Z', kind: 'scene-change', text: 'Church', actorName: null }],
    beatsTruncated: true,
    handoutsRevealed: [
      { title: 'Letter', uuid: 'x', seenBy: ['Anna', 'Bo'] },
      { title: 'Map', uuid: 'y', seenBy: [] },
    ],
  },
  openQuests: [{ journalId: 'q1', name: 'Bury the burgomaster', status: '', open: true }],
  openCampaignParts: [
    {
      journalId: 'c1',
      name: 'Curse of Strahd',
      parts: [{ partId: 'p', title: 'Death House', status: 'in_progress' }],
    },
  ],
  nextSession: {
    journalId: 'n1',
    name: 'Next session',
    playerVisible: true,
    pages: [{ pageId: 'pg', name: 'Plan', text: 'Meet Ismark', truncated: true }],
  },
  handoutQueue: [
    { title: 'Diary', uuid: 'd', sceneId: null, sceneName: null, players: ['Anna'] },
    { title: 'Note', uuid: 'e', sceneId: 's', sceneName: 'Church', players: [] },
  ],
  bosses: [
    {
      sceneId: 's',
      sceneName: 'Castle',
      tokenId: 't',
      tokenName: 'Strahd',
      actorName: 'Strahd',
      hidden: true,
      legendary: { max: 3, spent: 1, remaining: 2 },
      resistances: null,
      lair: { inside: true, initiative: 20 },
    },
  ],
  preflight: { fail: 1, warn: 0, items: [{ severity: 'fail', title: 'No scene is active' }] },
  recentChanges: { count: 1, latest: [{ title: 'Moved a token', appliedAt: '' }] },
  tarokka: { hasReading: true },
  warnings: ['Foundry is slow today.'],
};

const ALL_BEATS = { ...DIGEST, action: 'last-session' };

async function openPrep(page: Page): Promise<Locator> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await fromMenu(page, 'btn-prep');
  const drawer = page.getByRole('dialog', { name: '📋 Prep' });
  await expect(drawer).toBeVisible();
  return drawer;
}

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
  await fakeStream(page, []);
});

test('loads the digest on open and shows every section', async ({ page }) => {
  const calls = await fakeTools(page, () => ok(DIGEST));
  const drawer = await openPrep(page);

  await expect(drawer.locator('.drawer-sub')).toHaveText(/^GM only\. Loaded \d\d.\d\d\.$/);
  expect(calls).toEqual([{ name: 'get-prep-digest', args: { action: 'summary' } }]);
  await expect(drawer.locator('.preflight-summary.pf-warn').first()).toHaveText(
    'Foundry is slow today.'
  );

  const last = drawer.getByRole('list', { name: 'Last session' });
  await expect(last.locator('.pf-label')).toHaveText([
    'Session 3',
    'Scenes',
    'Fights',
    'Downs',
    'PCs who went down',
    'NPCs who went down',
  ]);
  await expect(last.locator('.pf-detail')).toHaveText([
    '2026-10-01 · 3 h 5 min',
    'Village of Barovia, then Church',
    '1 fight, 4 rounds',
    '2 player character downs',
    'Ireena',
    'None',
  ]);
  await expect(
    drawer.getByRole('list', { name: 'Handouts revealed' }).locator('.pf-detail')
  ).toHaveText(['Seen by Anna, Bo', 'Not opened by anyone yet']);
  await drawer.getByText('Beats (1)').click();
  await expect(drawer.locator('.prep-beats li')).toHaveText(/^\d\d.\d\d scene change: Church$/);
  await expect(drawer.locator('.prep-beats > .pf-detail')).toHaveText(
    'Only the latest beats are shown.'
  );

  await expect(drawer.getByRole('list', { name: 'Quests' }).locator('.pf-detail')).toHaveText(
    'Open'
  );
  await expect(
    drawer.getByRole('list', { name: 'Curse of Strahd' }).locator('.pf-detail')
  ).toHaveText('in progress');

  await expect(drawer.getByText('Players can see this journal')).toBeVisible();
  await expect(drawer.locator('.prep-note-text')).toHaveText('Meet Ismark …');

  await expect(drawer.locator('.prep-sub-h', { hasText: 'Any scene' })).toBeVisible();
  await expect(
    drawer.getByRole('list', { name: 'Queued: Any scene' }).locator('.pf-detail')
  ).toHaveText('For 1 player');
  await expect(
    drawer.getByRole('list', { name: 'Queued: Church' }).locator('.pf-detail')
  ).toHaveCount(0);
  await expect(drawer.getByRole('list', { name: 'Bosses' }).locator('.preflight-item')).toHaveText(
    'Strahd (hidden)Castle · Legendary 2/3 · Lair: inside'
  );
  await expect(drawer.getByRole('list', { name: 'Pre-flight items' }).locator('li')).toHaveClass(
    /pf-fail/
  );
  await expect(drawer.getByText('1 to fix, 0 to look at')).toBeVisible();
  await expect(drawer.getByText('1 change made through the tool.')).toBeVisible();
  await expect(drawer.getByText('A Tarokka reading exists.')).toBeVisible();
});

test('"All beats" loads the last-session action, and Refresh keeps it', async ({ page }) => {
  const calls = await fakeTools(page, call =>
    ok(call.args.action === 'last-session' ? ALL_BEATS : DIGEST)
  );
  const drawer = await openPrep(page);

  await drawer.getByRole('button', { name: 'All beats' }).click();
  await expect(drawer.getByRole('button', { name: 'All beats' })).toHaveCount(0);
  await expect(drawer.locator('.prep-beats > .pf-detail')).toHaveText(
    'Only the latest 200 beats are shown.'
  );

  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect
    .poll(() => calls.map(c => c.args.action))
    .toEqual(['summary', 'last-session', 'last-session']);
});

test('Open shows the journal in Foundry and says when it fails', async ({ page }) => {
  let openFails = false;
  const calls = await fakeTools(page, call => {
    if (call.name !== 'open-in-foundry') return ok(DIGEST);
    return openFails
      ? { status: 422, json: { ok: false, error: 'No such journal' } }
      : ok({ opened: true });
  });
  const drawer = await openPrep(page);

  await drawer.getByRole('list', { name: 'Quests' }).getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.toast-stack .toast.ok')).toHaveText('Opened in Foundry');
  expect(calls.at(-1)).toEqual({ name: 'open-in-foundry', args: { uuid: 'JournalEntry.q1' } });

  openFails = true;
  await drawer.locator('.pf-detail', { hasText: 'Next session' }).getByRole('button').click();
  await expect(page.locator('.toast-stack .toast.err')).toHaveText(
    '✗ open-in-foundry: No such journal'
  );
  expect(calls.at(-1)?.args).toEqual({ uuid: 'JournalEntry.n1' });
});

test('shows the empty states without Foundry', async ({ page }) => {
  await fakeTools(page, () =>
    ok({
      ...DIGEST,
      lastSession: null,
      openQuests: null,
      openCampaignParts: [],
      nextSession: null,
      handoutQueue: [],
      bosses: null,
      preflight: null,
      recentChanges: { count: 0, latest: [] },
      tarokka: { hasReading: false },
      warnings: [],
    })
  );
  const drawer = await openPrep(page);

  for (const text of [
    'No play session recorded yet.',
    'Needs Foundry: quests are not loaded.',
    'No open campaign parts.',
    "Create a GM-only journal named 'Next session' in Foundry for your prep notes.",
    'No handouts queued.',
    'Needs Foundry: bosses are not loaded.',
    'The pre-flight check could not run.',
    'No changes made through the tool yet.',
  ]) {
    await expect(drawer.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(drawer.getByText('A Tarokka reading exists.')).toHaveCount(0);
});

test('campaign parts without Foundry, and no Next session field at all', async ({ page }) => {
  // nextSession missing (undefined) means the bridge never asked Foundry: nothing shows.
  await fakeTools(page, () => ok({ ...DIGEST, openCampaignParts: null, nextSession: undefined }));
  const drawer = await openPrep(page);

  await expect(
    drawer.getByText('Needs Foundry: campaign parts are not loaded.', { exact: true })
  ).toBeVisible();
  await expect(drawer.locator('.preflight-h', { hasText: 'Next session notes' })).toBeVisible();
  await expect(drawer.getByText(/Create a GM-only journal/)).toHaveCount(0);
  await expect(drawer.getByText('Players can see this journal')).toHaveCount(0);
  await expect(drawer.locator('.prep-note')).toHaveCount(0);
});

test('a failed load says why and a refresh recovers', async ({ page }) => {
  let fail = true;
  await fakeTools(page, () =>
    fail ? { status: 502, json: { ok: false, error: 'Bridge not connected' } } : ok(DIGEST)
  );
  const drawer = await openPrep(page);

  await expect(drawer.locator('.drawer-sub')).toHaveText('GM only. The digest did not load.');
  await expect(drawer.locator('.empty')).toHaveText(
    "Couldn't load the prep digest: Bridge not connected"
  );
  await expect(drawer.getByRole('list', { name: 'Quests' })).toHaveCount(0);

  fail = false;
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(drawer.getByRole('list', { name: 'Quests' })).toBeVisible();
});

test('"Open Pre-flight" swaps to the Pre-flight drawer; Escape closes Prep', async ({ page }) => {
  await fakeTools(page, () => ok(DIGEST));
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  await page.route('**/api/session/switches', route =>
    route.fulfill({ json: { switches: { switches: [] }, gmActionsEnabled: false } })
  );
  const drawer = await openPrep(page);

  await drawer.getByRole('button', { name: 'Open Pre-flight' }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('dialog', { name: '✈ Pre-flight' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '✈ Pre-flight' })).toBeHidden();
  await fromMenu(page, 'btn-prep');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
});
