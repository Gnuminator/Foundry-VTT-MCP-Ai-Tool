// The Scene mood panel (item dashboard-mood-presets): the During bar's Scene mood button opens one
// button per preset of list-scene-moods; one click plans with plan-scene-mood, asks once with the
// plan's summary, applies with apply-planned-change, and the toast's Undo sends undo-change. With
// the module's "Scene mood and music" switch or GM Actions off, the buttons stay, disabled, with
// the reason, and nothing is planned. The bridge and the stream are faked; nothing needs a world.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeTools, ok, toast, type ToolCall } from './support';

const MOODS = {
  sceneId: 's1',
  sceneName: 'Village square',
  presets: [
    { name: 'Storm', darkness: 0.8, weather: 'rain' },
    { name: 'Calm', darkness: 0.1, globalLight: true },
  ],
  current: { darkness: 0.2, globalLight: false, weather: '' },
  playlists: [],
};

const SUMMARY = 'Apply mood "Storm" on "Village square": darkness 0.8, weather rain';

const NL = String.fromCharCode(10);
const sse = (events: { event: string; data: unknown }[]): string =>
  `retry: 600000${NL}${NL}${events
    .map(e => `event: ${e.event}${NL}data: ${JSON.stringify(e.data)}${NL}${NL}`)
    .join('')}`;

async function setup(
  page: Page,
  opts: {
    gmActions?: boolean;
    featureOn?: boolean;
    answer?: (call: ToolCall) => { status?: number; json: unknown } | undefined;
  } = {}
): Promise<ToolCall[]> {
  await fakeCommonRoutes(page);
  await page.route('**/api/space', route => route.fulfill({ json: { available: false } }));
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  await page.route('**/api/player/names', route => route.fulfill({ json: [] }));
  await page.route('**/api/features', route =>
    route.fulfill({
      json: {
        features: [
          {
            id: 'scene-mood',
            name: 'AI Tool: Scene mood and music (writes)',
            enabled: opts.featureOn ?? true,
          },
        ],
        writesAllowed: true,
        error: null,
      },
    })
  );
  const calls = await fakeTools(
    page,
    call => {
      const custom = opts.answer?.(call);
      if (custom) return custom;
      switch (call.name) {
        case 'get-play-session':
          return ok({
            success: true,
            worldId: 'w',
            open: true,
            startedAt: '2026-10-10T18:00:00.000Z',
            endedAt: null,
          });
        case 'list-scene-moods':
          return ok(MOODS);
        case 'plan-scene-mood':
          return ok({ planId: 'plan-mood', summary: SUMMARY, risk: 'write', autoApply: false });
        case 'apply-planned-change':
          return ok({ changeId: 'chg-mood', summary: SUMMARY, mode: 'apply', risk: 'write' });
        case 'undo-change':
          return ok({ changeId: 'chg-undo', summary: 'Undone: mood "Storm"' });
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
  await page.route('**/api/stream**', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse([
        { event: 'settings', data: { gmActionsEnabled: opts.gmActions ?? true } },
        {
          event: 'prefs',
          data: {
            duringLayout: 'layered',
            duringFull: false,
            layoutPicked: true,
            hintDismissed: true,
            hintSessions: [],
          },
        },
        { event: 'combat', data: { combat: null } },
      ]),
    })
  );
  return calls;
}

const named = (calls: ToolCall[], name: string): ToolCall[] => calls.filter(c => c.name === name);

async function openPanel(page: Page): Promise<Locator> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
  const button = page.locator('#btn-during-scene-mood');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const panel = page.locator('#scene-mood-panel');
  await expect(panel).toBeVisible();
  return panel;
}

test('lists the presets of list-scene-moods, one button each', async ({ page }) => {
  await setup(page);
  const panel = await openPanel(page);
  const list = panel.getByRole('list', { name: 'Mood presets' });
  await expect(list.getByRole('button')).toHaveText(['Calm', 'Storm']);
  await expect(panel.getByRole('button', { name: 'Storm' })).toHaveAttribute(
    'title',
    'darkness 0.8, weather rain'
  );
  await expect(panel).toContainText('The moods saved on Village square.');
  await expect(panel).toContainText('Now: darkness 0.2, global light off, weather clear.');
});

test('one click plans, asks once, applies, and the toast Undo reverts it', async ({ page }) => {
  const calls = await setup(page);
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'Storm' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`${SUMMARY}? Undo stays in Recent Changes.`);
  expect(named(calls, 'plan-scene-mood').map(c => c.args)).toEqual([
    { action: 'apply', preset: 'Storm' },
  ]);
  expect(named(calls, 'apply-planned-change')).toHaveLength(0);

  await dialog.getByRole('button', { name: 'Apply mood' }).click();
  await expect(toast(page, `✓ Applied: ${SUMMARY}`)).toBeVisible();
  const applied = named(calls, 'apply-planned-change');
  expect(applied).toHaveLength(1);
  expect(applied[0]?.args).toMatchObject({ planId: 'plan-mood' });
  expect(applied[0]?.confirm).toBe(true);
  expect(applied[0]?.confirmDestructive).toBeFalsy();

  await page.locator('.toast-stack').getByRole('button', { name: 'Undo' }).click();
  await expect(toast(page, '✓ Undone: mood "Storm"')).toBeVisible();
  expect(named(calls, 'undo-change').map(c => c.args)).toEqual([{ changeId: 'chg-mood' }]);
});

test('Cancel in the confirm window applies nothing', async ({ page }) => {
  const calls = await setup(page);
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'Calm' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(named(calls, 'plan-scene-mood')).toHaveLength(1);
  expect(named(calls, 'apply-planned-change')).toHaveLength(0);
});

test('a failed plan says so in a toast and applies nothing', async ({ page }) => {
  const calls = await setup(page, {
    answer: call =>
      call.name === 'plan-scene-mood'
        ? { status: 500, json: { error: 'No viewed scene', kind: 'tool' } }
        : undefined,
  });
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'Storm' }).click();
  await expect(toast(page, /✗ Mood "Storm": .*No viewed scene/)).toBeVisible();
  expect(named(calls, 'apply-planned-change')).toHaveLength(0);
});

test('with the module switch off the buttons say so and plan nothing', async ({ page }) => {
  const calls = await setup(page, { featureOn: false });
  const panel = await openPanel(page);
  const storm = panel.getByRole('button', { name: 'Storm' });
  await expect(storm).toHaveAttribute('aria-disabled', 'true');
  await expect(storm).toHaveAttribute('title', 'Scene mood and music is off');
  await expect(panel.locator('#scene-mood-off')).toContainText(
    '"AI Tool: Scene mood and music (writes)" is switched off.'
  );
  // aria-disabled keeps the button in the tab order; a click on it must do nothing.
  await storm.click({ force: true });
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(named(calls, 'plan-scene-mood')).toHaveLength(0);
});

test('with GM Actions off the buttons say so and plan nothing', async ({ page }) => {
  const calls = await setup(page, { gmActions: false });
  const panel = await openPanel(page);
  const storm = panel.getByRole('button', { name: 'Storm' });
  await expect(storm).toHaveAttribute('aria-disabled', 'true');
  await expect(storm).toHaveAttribute('title', 'GM Actions is off');
  await expect(panel.locator('#scene-mood-turn-on')).toContainText('GM Actions is off.');
  await storm.click({ force: true });
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(named(calls, 'plan-scene-mood')).toHaveLength(0);
});

test('Escape closes the panel and the focus goes back to its button', async ({ page }) => {
  await setup(page);
  const panel = await openPanel(page);
  await expect(panel.getByRole('button', { name: 'Calm' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.locator('#btn-during-scene-mood')).toBeFocused();
});

test('a failed apply says so, adds no Undo and leaves the buttons usable', async ({ page }) => {
  const calls = await setup(page, {
    answer: call =>
      call.name === 'apply-planned-change'
        ? {
            status: 422,
            json: { ok: false, error: 'The scene changed since the plan', kind: 'tool' },
          }
        : undefined,
  });
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'Storm' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Apply mood' }).click();
  await expect(toast(page, /The scene changed since the plan/)).toBeVisible();
  expect(named(calls, 'apply-planned-change')).toHaveLength(1);
  await expect(page.locator('.toast-stack').getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Storm' })).not.toHaveAttribute(
    'aria-disabled',
    'true'
  );
});

test('a switch-off refusal from the plan is a hint, and the switches are read again', async ({
  page,
}) => {
  let featureReads = 0;
  const calls = await setup(page, {
    answer: call =>
      call.name === 'plan-scene-mood'
        ? {
            status: 422,
            json: {
              ok: false,
              error:
                '"AI Tool: Scene mood and music (writes)" is switched off. In Foundry, open the Settings tab, Game Settings, Foundry AI Tool and turn on "AI Tool: Scene mood and music (writes)".',
              kind: 'tool',
            },
          }
        : undefined,
  });
  // Registered after setup, so it runs first and passes on to setup's answer.
  await page.route('**/api/features', async route => {
    featureReads += 1;
    await route.fallback();
  });
  const panel = await openPanel(page);
  await expect.poll(() => featureReads).toBeGreaterThan(0);
  const before = featureReads;
  await panel.getByRole('button', { name: 'Storm' }).click();
  await expect(toast(page, /is switched off\. In Foundry, open/)).toBeVisible();
  await expect.poll(() => featureReads).toBeGreaterThan(before);
  expect(named(calls, 'apply-planned-change')).toHaveLength(0);
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('when the viewed scene changed, the click reloads the moods instead of planning', async ({
  page,
}) => {
  let scene = 'old';
  const calls = await setup(page, {
    answer: call =>
      call.name === 'list-scene-moods' && scene === 'new'
        ? ok({ ...MOODS, sceneId: 's2', sceneName: 'Crypt', presets: [{ name: 'Dread' }] })
        : undefined,
  });
  const panel = await openPanel(page);
  await expect(panel).toContainText('Village square');
  scene = 'new';
  await panel.getByRole('button', { name: 'Storm' }).click();
  await expect(toast(page, /The scene changed to Crypt/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Dread' })).toBeVisible();
  expect(named(calls, 'plan-scene-mood')).toHaveLength(0);
});

test('unreadable switches are described without "live play"', async ({ page }) => {
  await setup(page);
  await page.route('**/api/session/switches', route =>
    route.fulfill({
      json: { switches: null, gmActionsEnabled: true, error: 'The bridge is away' },
    })
  );
  const panel = await openPanel(page);
  await expect(panel.getByRole('button', { name: 'Storm' })).toHaveAttribute(
    'title',
    "Can't read the switches"
  );
  await expect(panel.locator('#scene-mood-turn-on')).not.toContainText('live play');
});
