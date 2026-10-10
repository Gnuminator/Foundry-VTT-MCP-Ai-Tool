// The Live Feed on the React dashboard (D-092): the events a stream `events` message brings, newest
// first, the count in the head, the cap of 120, events arriving later and replayed ones, the
// empty, loading and bridge-away faces, the list for keyboard and screen reader, and that the
// fold button still works. The bridge and the stream are faked in the browser; nothing here needs
// a world.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeTools, ok } from './support';

const STARTED = '2026-10-10T18:00:00.000Z';

interface Event {
  event: string;
  data: unknown;
}

const sse = (events: Event[], retry: number): string =>
  `retry: ${retry}\n\n${events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('')}`;

// --- Raw events, as the server sends them -------------------------------------------------------

const T0 = Date.UTC(2026, 9, 10, 20, 0, 0);

interface RawEvent {
  id: string;
  timestamp: string;
  timestampMs: number;
  eventType: string;
  actorName: string | null;
  actorId: string | null;
  description: string;
  details: Record<string, unknown>;
}

/** An event `second` seconds after 20:00:00 UTC. */
const raw = (
  id: string,
  second: number,
  eventType: string,
  description: string,
  details: Record<string, unknown> = {}
): RawEvent => ({
  id,
  timestamp: new Date(T0 + second * 1000).toISOString(),
  timestampMs: T0 + second * 1000,
  eventType,
  actorName: null,
  actorId: null,
  description,
  details,
});

const events = (list: RawEvent[], initial = false): Event => ({
  event: 'events',
  data: { events: list, initial },
});

const THREE = [
  raw('a', 1, 'damage', 'Goblin Archer takes 7 slashing damage'),
  raw('b', 2, 'roll', 'Brannoc attacks', {
    breakdown: 'Brannoc attacks the Ogre: 17 vs AC 14, hit',
  }),
  raw('c', 3, 'condition-applied', 'Ogre Brute gained "Prone"'),
];

const many = (n: number): RawEvent[] =>
  Array.from({ length: n }, (_, i) => raw(`m${i + 1}`, i, 'healing', `Event ${i + 1}`));

// --- The page -----------------------------------------------------------------------------------

type Layout = 'layered' | 'toggle' | 'auto';

interface Options {
  layout?: Layout;
  /** Sent after the prefs and settings. */
  initial?: Event[];
}

interface Fakes {
  /** Sends events on the stream after the page loaded. */
  push: (events: Event[]) => void;
}

/** An open play session with the layout already picked, and a stream that sends `initial`. */
async function setup(
  page: Page,
  { layout = 'layered', initial = [] }: Options = {}
): Promise<Fakes> {
  await fakeCommonRoutes(page);
  await page.route('**/api/space', route => route.fulfill({ json: { available: false } }));
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  await page.route('**/api/player/names', route => route.fulfill({ json: [] }));
  await page.route('**/api/tools', route =>
    route.fulfill({ json: { tools: [], gmActionsEnabled: true } })
  );
  await fakeTools(
    page,
    call => {
      switch (call.name) {
        case 'get-play-session':
          return ok({ success: true, worldId: 'w', open: true, startedAt: STARTED, endedAt: null });
        case 'get-party':
          return ok({ groups: [], paceOptions: [], scene: null, encounter: null, warnings: [] });
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

  const first: Event[] = [
    {
      event: 'prefs',
      data: {
        duringLayout: layout,
        duringFull: false,
        combatButtons: false,
        layoutPicked: true,
        hintDismissed: true,
        hintSessions: [],
      },
    },
    { event: 'settings', data: { gmActionsEnabled: true } },
    ...initial,
  ];
  const queue: Event[][] = [];
  let wake: () => void = () => undefined;
  let requests = 0;
  await page.route('**/api/stream**', async route => {
    requests += 1;
    let batch = first;
    if (requests > 1) {
      while (queue.length === 0) await new Promise<void>(resolve => (wake = resolve));
      batch = queue.shift() ?? [];
    }
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(batch, 100) });
  });
  return {
    push: (batchToSend): void => {
      queue.push(batchToSend);
      wake();
    },
  };
}

const status = (over: Record<string, unknown>): Event => ({
  event: 'status',
  data: {
    controlChannel: 'connected',
    foundry: 'reachable',
    lastError: null,
    lastPollAt: null,
    foundryDownSince: null,
    ...over,
  },
});

const BRIDGE_UP = status({});
const FOUNDRY_AWAY = status({ foundry: 'unreachable', lastError: 'Foundry module not connected' });

const feed = (page: Page): Locator => page.locator('#pane-feed');
const rows = (page: Page): Locator => page.locator('#pane-feed-body .event');
const meta = (page: Page): Locator => page.locator('#feed-meta');
const away = (page: Page): Locator => page.locator('#feed-away');
const during = (page: Page): Locator => page.locator('#moment-during');

async function load(page: Page): Promise<void> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await expect(during(page)).toBeVisible();
}

test.describe('the list', () => {
  test('shows the events newest first with the old classes, a chip and a time', async ({
    page,
  }) => {
    await setup(page, { initial: [events(THREE, true)] });
    await load(page);

    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).locator('.event-desc')).toHaveText([
      'Ogre Brute gained "Prone"',
      // A roll shows its full breakdown to the GM.
      'Brannoc attacks the Ogre: 17 vs AC 14, hit',
      'Goblin Archer takes 7 slashing damage',
    ]);
    await expect(rows(page).locator('.event-type')).toHaveText([
      'condition-applied',
      'roll',
      'damage',
    ]);
    await expect(rows(page).nth(0)).toHaveClass(/sev-condition-applied/);
    await expect(rows(page).nth(1)).toHaveClass(/sev-roll/);
    await expect(rows(page).nth(2)).toHaveClass(/sev-damage/);
    // The browser runs in the zone of the machine; the time is whatever it prints for the moment.
    const time = rows(page).nth(2).locator('time');
    await expect(time).toHaveAttribute('datetime', '2026-10-10T20:00:01.000Z');
    await expect(time).toHaveText(/\d/);
    // The pane keeps its old ids and the card is the Live Feed region.
    await expect(feed(page).getByRole('heading', { name: 'Live Feed' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Live Feed' })).toBeVisible();
    await expect(meta(page)).toHaveText('3 events');
    await expect(feed(page).locator('.pane-meta')).toContainText('3 events');
  });

  test('the count says "1 event" for one', async ({ page }) => {
    await setup(page, { initial: [events(THREE.slice(0, 1), true)] });
    await load(page);
    await expect(meta(page)).toHaveText('1 event');
  });

  test('text from the bridge is text, not markup', async ({ page }) => {
    await setup(page, {
      initial: [
        events([raw('x', 1, 'x" onclick="boom', '<img src=x onerror=alert(1)> hit')], true),
      ],
    });
    await load(page);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).locator('.event-desc')).toHaveText('<img src=x onerror=alert(1)> hit');
    await expect(rows(page).locator('img')).toHaveCount(0);
    await expect(rows(page).first()).toHaveClass(/sev-xonclickboom/);
    await expect(rows(page).first()).not.toHaveAttribute('onclick', /.*/);
  });

  test('an event the page cannot read is skipped, the rest show', async ({ page }) => {
    await setup(page, {
      initial: [
        {
          event: 'events',
          data: { events: [THREE[0], { id: '', eventType: 'damage' }, 7, THREE[2]], initial: true },
        },
      ],
    });
    await load(page);
    await expect(rows(page)).toHaveCount(2);
    await expect(meta(page)).toHaveText('2 events');
  });
});

test.describe('events arriving', () => {
  test('a new event goes on top and the count follows', async ({ page }) => {
    const { push } = await setup(page, { initial: [events(THREE.slice(0, 2), true)] });
    await load(page);
    await expect(rows(page)).toHaveCount(2);

    push([events([raw('d', 4, 'healing', 'Mira heals 6 hit points')])]);
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).first().locator('.event-desc')).toHaveText('Mira heals 6 hit points');
    await expect(rows(page).first()).toHaveClass(/sev-healing/);
    await expect(meta(page)).toHaveText('3 events');
  });

  test('a replay after a reconnect adds nothing twice', async ({ page }) => {
    const { push } = await setup(page, { initial: [events(THREE, true)] });
    await load(page);
    await expect(rows(page)).toHaveCount(3);

    // The server replays what it has on every connect, with one new event at the end.
    push([events([...THREE, raw('d', 4, 'death', 'Goblin Archer drops')], true)]);
    await expect(rows(page)).toHaveCount(4);
    await expect(meta(page)).toHaveText('4 events');
    await expect(rows(page).locator('.event-desc')).toHaveText([
      'Goblin Archer drops',
      'Ogre Brute gained "Prone"',
      'Brannoc attacks the Ogre: 17 vs AC 14, hit',
      'Goblin Archer takes 7 slashing damage',
    ]);
  });

  test('an old event that arrives late sorts below, by its time', async ({ page }) => {
    const { push } = await setup(page, { initial: [events(THREE, true)] });
    await load(page);
    push([events([raw('old', 0, 'scene-change', 'The scene is now Harbor Market')])]);
    await expect(rows(page)).toHaveCount(4);
    await expect(rows(page).last().locator('.event-desc')).toHaveText(
      'The scene is now Harbor Market'
    );
  });
});

test.describe('the cap', () => {
  test('keeps the newest 120 and counts all of them', async ({ page }) => {
    const { push } = await setup(page, { initial: [events(many(130), true)] });
    await load(page);

    await expect(rows(page)).toHaveCount(120);
    await expect(meta(page)).toHaveText('130 events');
    await expect(rows(page).first().locator('.event-desc')).toHaveText('Event 130');
    await expect(rows(page).last().locator('.event-desc')).toHaveText('Event 11');

    push([events([raw('latest', 500, 'damage', 'The newest event')])]);
    await expect(rows(page).first().locator('.event-desc')).toHaveText('The newest event');
    await expect(rows(page)).toHaveCount(120);
    await expect(rows(page).last().locator('.event-desc')).toHaveText('Event 12');
    await expect(meta(page)).toHaveText('131 events');
  });
});

test.describe('the faces', () => {
  test('loading until the stream has said anything', async ({ page }) => {
    await setup(page);
    await load(page);
    await expect(feed(page)).toHaveAttribute('data-panel-state', 'loading');
    await expect(feed(page).getByText('Loading events…')).toBeVisible();
    await expect(meta(page)).toHaveText('0 events');
  });

  test('empty when the stream says there are no events, then fills', async ({ page }) => {
    const { push } = await setup(page, { initial: [events([], true)] });
    await load(page);
    await expect(feed(page)).toHaveAttribute('data-panel-state', 'empty');
    await expect(feed(page).getByText('Waiting for events…')).toBeVisible();
    await expect(rows(page)).toHaveCount(0);

    push([events(THREE.slice(0, 1))]);
    await expect(rows(page)).toHaveCount(1);
    await expect(feed(page)).toHaveAttribute('data-panel-state', 'ready');
    await expect(feed(page).getByText('Waiting for events…')).toHaveCount(0);
  });
});

test.describe('the bridge is away', () => {
  test('the events stay and a line says they may be old', async ({ page }) => {
    const { push } = await setup(page, { initial: [BRIDGE_UP, events(THREE, true)] });
    await load(page);
    await expect(rows(page)).toHaveCount(3);
    await expect(away(page)).toHaveText('');

    push([FOUNDRY_AWAY]);
    await expect(away(page)).toHaveText(
      'The bridge is away: new events will show here when it is back.'
    );
    await expect(away(page)).toHaveAttribute('role', 'status');
    await expect(rows(page)).toHaveCount(3);

    push([BRIDGE_UP]);
    await expect(away(page)).toHaveText('');
  });

  test('with no events it says the bridge is away instead of waiting', async ({ page }) => {
    const { push } = await setup(page, { initial: [FOUNDRY_AWAY, events([], true)] });
    await load(page);
    await expect(feed(page)).toHaveAttribute('data-panel-state', 'bridge-down');
    await expect(
      feed(page)
        .getByRole('status')
        .filter({ hasText: /bridge is away/ })
    ).toBeVisible();
    await expect(feed(page).getByText('Waiting for events…')).toHaveCount(0);

    push([BRIDGE_UP]);
    await expect(feed(page)).toHaveAttribute('data-panel-state', 'empty');
  });

  test('away before the stream answered with events is the bridge face, not loading', async ({
    page,
  }) => {
    await setup(page, { initial: [FOUNDRY_AWAY] });
    await load(page);
    await expect(feed(page)).toHaveAttribute('data-panel-state', 'bridge-down');
  });
});

test.describe('keyboard and screen reader', () => {
  test('the events are a named list that the keyboard can scroll', async ({ page }) => {
    await setup(page, { initial: [events(many(60), true)] });
    await load(page);

    const list = page.getByRole('list', { name: 'Live feed events, newest first' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(60);
    await expect(list).toHaveAttribute('tabindex', '0');
    // It really scrolls here, and Tab reaches it, since no row has anything to focus.
    const scrolls = await list.evaluate(el => el.scrollHeight > el.clientHeight);
    expect(scrolls).toBe(true);
    await list.focus();
    await expect(list).toBeFocused();
    await page.keyboard.press('End');
    await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  });

  test('a new event is announced once, a burst as one message, the first load not at all', async ({
    page,
  }) => {
    const { push } = await setup(page, { initial: [events(many(30), true)] });
    await load(page);
    const said = page.locator('#feed-announce');
    await expect(rows(page)).toHaveCount(30);
    await expect(said).toHaveAttribute('role', 'status');
    await expect(said).toHaveText('');

    push([events([raw('n1', 100, 'damage', 'Ogre Brute takes 9 damage')])]);
    await expect(said).toHaveText('Ogre Brute takes 9 damage');

    push([
      events([
        raw('n2', 101, 'damage', 'Hit one'),
        raw('n3', 102, 'damage', 'Hit two'),
        raw('n4', 103, 'damage', 'Hit three'),
      ]),
    ]);
    await expect(said).toHaveText('3 new events. Latest: Hit three');
    // The list itself is not a live region: it would be read out whole.
    await expect(page.locator('#pane-feed-body')).not.toHaveAttribute('aria-live', /.*/);
  });

  test('the Live Feed has its help button', async ({ page }) => {
    await setup(page, { initial: [events(THREE, true)] });
    await load(page);
    await expect(feed(page).getByRole('button', { name: 'Help for this panel' })).toBeVisible();
  });
});

test.describe('the fold', () => {
  test('the fold button hides the events and brings them back', async ({ page }) => {
    await setup(page, { initial: [events(THREE, true)] });
    await load(page);

    const button = feed(page).locator('[data-fold="feed"]');
    await expect(button).toHaveAccessibleName('Fold Live Feed');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    // The button controls the body that holds the events.
    await expect(button).toHaveAttribute('aria-controls', 'pane-feed-body');
    await expect(page.locator('#pane-feed-body .event')).toHaveCount(3);

    await button.click();
    await expect(feed(page)).toHaveClass(/is-folded/);
    await expect(button).toHaveAccessibleName('Open Live Feed');
    await expect(page.locator('#pane-feed-body')).toBeHidden();
    await expect(feed(page).locator('.pane-head')).toBeVisible();

    // Events that arrive while it is folded are there when it opens.
    await button.click();
    await expect(feed(page)).not.toHaveClass(/is-folded/);
    await expect(rows(page).first()).toBeVisible();
    await expect(rows(page)).toHaveCount(3);
  });

  test('a click on a folded title opens it', async ({ page }) => {
    await setup(page, { initial: [events(THREE, true)] });
    await load(page);
    await feed(page).locator('[data-fold="feed"]').click();
    await expect(feed(page)).toHaveClass(/is-folded/);
    await feed(page).getByRole('heading', { name: 'Live Feed' }).click();
    await expect(feed(page)).not.toHaveClass(/is-folded/);
  });

  test('a folded card is hidden from screen readers, so it says nothing', async ({ page }) => {
    const { push } = await setup(page, { initial: [events(THREE, true)] });
    await load(page);
    await feed(page).locator('[data-fold="feed"]').click();
    push([events([raw('z', 9, 'damage', 'Quiet hit')])]);
    await expect(meta(page)).toHaveText('4 events');
    await expect(page.locator('#feed-announce')).toBeHidden();
  });
});
