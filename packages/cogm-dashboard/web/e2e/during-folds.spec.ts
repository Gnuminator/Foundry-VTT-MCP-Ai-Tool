// The During folds on the React dashboard (D-092, I-107): the four cards (Live Feed, Recent
// Changes, Handouts, Party) and their fold buttons, the defaults per layout, fight and width, the
// side set on a wide screen, the title click, and that the GM's own choices are kept (across the
// fight starting and ending, the window crossing 600 and 900 px, and leaving During). The bridge
// and the stream are faked in the browser; nothing here needs a world.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeTools, ok } from './support';

const STARTED = '2026-10-10T18:00:00.000Z';

type Layout = 'layered' | 'toggle' | 'auto';

interface Event {
  event: string;
  data: unknown;
}

const sse = (events: Event[], retry: number): string =>
  `retry: ${retry}\n\n${events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('')}`;

interface Fakes {
  /** Sends events on the stream after the page loaded. */
  push: (events: Event[]) => void;
  /** The tool calls the page made. */
  calls: { name: string }[];
}

/**
 * An open play session with the layout already picked (`full`: Simple/Full on Full, which shows
 * Party; Simple hides it), a stream that sends `events` first and
 * then whatever `push` gives it (each request waits for something to send), and empty panels.
 */
async function setup(page: Page, layout: Layout = 'layered', full = false): Promise<Fakes> {
  await fakeCommonRoutes(page);
  await page.route('**/api/space', route => route.fulfill({ json: { available: false } }));
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  await page.route('**/api/session/switches', route =>
    route.fulfill({
      json: {
        switches: { switches: [], ready: null, changed: [], failed: [] },
        gmActionsEnabled: false,
        error: null,
      },
    })
  );
  await page.route('**/api/player/names', route => route.fulfill({ json: [] }));
  const calls = await fakeTools(
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

  const prefs: Event = {
    event: 'prefs',
    data: {
      duringLayout: layout,
      duringFull: full,
      combatButtons: false,
      layoutPicked: true,
      hintDismissed: true,
      hintSessions: [],
    },
  };
  const queue: Event[][] = [];
  let wake: () => void = () => undefined;
  let requests = 0;
  await page.route('**/api/stream**', async route => {
    requests += 1;
    let events: Event[] = [prefs, { event: 'combat', data: { combat: null } }];
    if (requests > 1) {
      while (queue.length === 0) await new Promise<void>(resolve => (wake = resolve));
      events = queue.shift() ?? [];
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse(events, 100),
    });
  });
  return {
    calls,
    push: (events): void => {
      queue.push(events);
      wake();
    },
  };
}

const fightOn: Event = {
  event: 'combat',
  data: { combat: { active: true, round: 1, combatants: [] } },
};
const fightOff: Event = { event: 'combat', data: { combat: null } };

type Card = 'feed' | 'changes' | 'handouts' | 'party';
const IDS: Record<Card, string> = {
  feed: '#pane-feed',
  changes: '#pane-changes',
  handouts: '#handouts-drawer',
  party: '#party-drawer',
};
const CARDS: Card[] = ['feed', 'changes', 'handouts', 'party'];

const card = (page: Page, name: Card): Locator => page.locator(IDS[name]);
const foldButton = (page: Page, name: Card): Locator => page.locator(`[data-fold="${name}"]`);
const during = (page: Page): Locator => page.locator('#moment-during');

/** Which of the four cards are folded, as the page shows them. */
async function folded(page: Page): Promise<Record<Card, boolean>> {
  const state = {} as Record<Card, boolean>;
  for (const name of CARDS) {
    state[name] = await card(page, name).evaluate(el => el.classList.contains('is-folded'));
  }
  return state;
}

/** Waits until the cards are as given (true = folded); retries while the page settles. */
async function expectFolds(page: Page, want: Record<Card, boolean>): Promise<void> {
  await expect.poll(() => folded(page)).toEqual(want);
}

const folds = (
  feed: boolean,
  changes: boolean,
  handouts: boolean,
  party: boolean
): Record<Card, boolean> => ({ feed, changes, handouts, party });

async function load(page: Page): Promise<void> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await expect(during(page)).toBeVisible();
  // All four cards are in the page, the docked ones once the slots are known.
  for (const name of CARDS) await expect(card(page, name)).toBeAttached();
}

const PHONE = { width: 390, height: 800 };
const MEDIUM = { width: 700, height: 900 };
const WIDE = { width: 1440, height: 900 };

test.describe('the fold buttons', () => {
  test('each card has one first in its head, with the old class, data and usage name', async ({
    page,
  }) => {
    await setup(page);
    await load(page);
    for (const name of CARDS) {
      const button = foldButton(page, name);
      await expect(button).toHaveCount(1);
      await expect(button).toHaveClass('fold-btn');
      await expect(button).toHaveAttribute('data-track', `dash.during.fold-${name}`);
      await expect(button).toBeVisible();
      // First in the head, before the title.
      const first = await card(page, name)
        .locator('.pane-head, .drawer-head')
        .first()
        .evaluate(head => (head.firstElementChild as HTMLElement).dataset.fold);
      expect(first).toBe(name);
    }
  });

  test('has an accessible name, a state, and points at the card body', async ({ page }) => {
    await setup(page);
    await load(page);
    // Cards: the feed is open, Party is folded.
    const feed = foldButton(page, 'feed');
    await expect(feed).toHaveAccessibleName('Fold Live Feed');
    await expect(feed).toHaveAttribute('aria-expanded', 'true');
    await expect(feed).toHaveAttribute('title', 'Fold');
    await expect(feed).toHaveText('▾');
    const party = foldButton(page, 'party');
    await expect(party).toHaveAccessibleName('Open Party');
    await expect(party).toHaveAttribute('aria-expanded', 'false');
    await expect(party).toHaveAttribute('title', 'Open');
    await expect(party).toHaveText('▸');

    for (const name of CARDS) {
      const controls = await foldButton(page, name).getAttribute('aria-controls');
      expect(controls).toBe(`${IDS[name].slice(1)}-body`);
      // The body it controls is inside its own card.
      await expect(card(page, name).locator(`#${controls}`)).toBeAttached();
    }

    await party.click();
    await expect(party).toHaveAccessibleName('Fold Party');
    await expect(party).toHaveAttribute('aria-expanded', 'true');
    await expect(party).toHaveText('▾');
  });

  test('is a real button: the keyboard folds and opens a card', async ({ page }) => {
    await setup(page);
    await load(page);
    const feed = foldButton(page, 'feed');
    await feed.focus();
    await page.keyboard.press('Enter');
    await expect(card(page, 'feed')).toHaveClass(/is-folded/);
    await page.keyboard.press('Space');
    await expect(card(page, 'feed')).not.toHaveClass(/is-folded/);
  });

  test('a folded card shows its head and hides the rest', async ({ page }) => {
    await setup(page);
    await load(page);
    const party = card(page, 'party');
    await expect(party).toHaveClass(/is-folded/);
    await expect(party.locator('.drawer-head')).toBeVisible();
    await expect(party.getByRole('heading', { name: /Party/ })).toBeVisible();
    await expect(party.locator('#party-drawer-body')).toBeHidden();
    await foldButton(page, 'party').click();
    await expect(party.locator('#party-drawer-body')).toBeVisible();
    await foldButton(page, 'feed').click();
    await expect(card(page, 'feed').locator('.not-here-yet-text')).toBeHidden();
    await expect(card(page, 'feed').locator('.pane-head')).toBeVisible();
  });
});

test.describe('the defaults', () => {
  test('Cards: the feed and Recent Changes open, Handouts and Party folded', async ({ page }) => {
    await setup(page, 'layered');
    await load(page);
    await expectFolds(page, folds(false, false, true, true));
  });

  test('Simple/Full: everything open', async ({ page }) => {
    await setup(page, 'toggle');
    await load(page);
    await expectFolds(page, folds(false, false, false, false));
    // Simple keeps Party out of the screen, whatever its fold: the folds change nothing there.
    await expect(card(page, 'party')).toBeHidden();
  });

  test('Auto without a fight is like Cards; in a fight the feed folds and Party opens', async ({
    page,
  }) => {
    const { push } = await setup(page, 'auto');
    await load(page);
    await expect(during(page)).toHaveAttribute('data-context', 'calm');
    await expectFolds(page, folds(false, false, true, true));
    push([fightOn]);
    await expect(during(page)).toHaveAttribute('data-context', 'combat');
    await expectFolds(page, folds(true, false, true, false));
  });

  test('Cards in a fight is the same as Cards without one', async ({ page }) => {
    const { push } = await setup(page, 'layered');
    await load(page);
    push([fightOn]);
    await expect(during(page)).toHaveAttribute('data-context', 'combat');
    await expectFolds(page, folds(false, false, true, true));
  });

  test('on a phone the feed starts folded, Recent Changes comes first', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await setup(page, 'layered');
    await load(page);
    await expectFolds(page, folds(true, false, true, true));
  });

  test('on a medium width the feed is open', async ({ page }) => {
    await page.setViewportSize(MEDIUM);
    await setup(page, 'layered');
    await load(page);
    await expectFolds(page, folds(false, false, true, true));
  });

  test('changing the layout uses that layout’s defaults', async ({ page }) => {
    await setup(page, 'layered');
    await page.route('**/api/control', route => {
      const body = route.request().postDataJSON() as { value: Record<string, unknown> };
      return route.fulfill({
        json: {
          duringLayout: 'toggle',
          duringFull: false,
          combatButtons: false,
          layoutPicked: true,
          hintDismissed: true,
          hintSessions: [],
          ...body.value,
        },
      });
    });
    await load(page);
    await expectFolds(page, folds(false, false, true, true));
    await page
      .getByRole('group', { name: 'During layout' })
      .getByRole('button', { name: 'Simple/Full' })
      .click();
    await expect(during(page)).toHaveAttribute('data-layout', 'toggle');
    await expectFolds(page, folds(false, false, false, false));
  });
});

test.describe('opening and folding', () => {
  test('a click folds an open card and opens a folded one', async ({ page }) => {
    await setup(page, 'toggle');
    await load(page);
    await foldButton(page, 'changes').click();
    await expectFolds(page, folds(false, true, false, false));
    await foldButton(page, 'changes').click();
    await expectFolds(page, folds(false, false, false, false));
  });

  test('wide: opening a side card folds the other side cards', async ({ page }) => {
    await setup(page, 'layered');
    await load(page);
    await foldButton(page, 'handouts').click();
    await expectFolds(page, folds(false, true, false, true));
    await foldButton(page, 'party').click();
    await expectFolds(page, folds(false, true, true, false));
    // The feed is the big column, not a side card: it is left alone.
    await foldButton(page, 'feed').click();
    await foldButton(page, 'feed').click();
    await expectFolds(page, folds(false, true, true, false));
  });

  test('Simple/Full has no side set', async ({ page }) => {
    await setup(page, 'toggle', true);
    await load(page);
    await foldButton(page, 'party').click();
    await foldButton(page, 'handouts').click();
    await expectFolds(page, folds(false, false, true, true));
    await foldButton(page, 'handouts').click();
    await expectFolds(page, folds(false, false, false, true));
  });

  test('Auto in a fight: the feed is a side card, Party is the big column', async ({ page }) => {
    const { push } = await setup(page, 'auto');
    await load(page);
    push([fightOn]);
    await expectFolds(page, folds(true, false, true, false));
    await foldButton(page, 'feed').click();
    await expectFolds(page, folds(false, true, true, false));
  });

  for (const [label, size] of [
    ['a medium width', MEDIUM],
    ['a phone', PHONE],
  ] as const) {
    test(`on ${label} opening a card leaves the others alone`, async ({ page }) => {
      await page.setViewportSize(size);
      await setup(page, 'layered');
      await load(page);
      const before = await folded(page);
      await foldButton(page, 'handouts').click();
      await expectFolds(page, { ...before, handouts: false });
      await foldButton(page, 'party').click();
      await expectFolds(page, { ...before, handouts: false, party: false });
    });
  }

  test('a click on a folded card’s title opens it; on an open card it does nothing', async ({
    page,
  }) => {
    await setup(page, 'toggle', true);
    await load(page);
    await foldButton(page, 'party').click();
    await expectFolds(page, folds(false, false, false, true));
    await card(page, 'party').getByRole('heading', { name: /Party/ }).click();
    await expectFolds(page, folds(false, false, false, false));
    // Open now: the title is only a title.
    await card(page, 'party').getByRole('heading', { name: /Party/ }).click();
    await card(page, 'changes').getByRole('heading', { name: 'Recent Changes' }).click();
    await expectFolds(page, folds(false, false, false, false));
  });

  test('the title of a folded placeholder card opens it too', async ({ page }) => {
    await setup(page, 'toggle');
    await load(page);
    await foldButton(page, 'feed').click();
    await expect(card(page, 'feed')).toHaveClass(/is-folded/);
    await card(page, 'feed').getByRole('heading', { name: 'Live Feed' }).click();
    await expect(card(page, 'feed')).not.toHaveClass(/is-folded/);
  });

  test('the help “?” of a folded card does not open it', async ({ page }) => {
    await setup(page, 'layered');
    await load(page);
    await expect(card(page, 'party')).toHaveClass(/is-folded/);
    await card(page, 'party').locator('.help-q').click();
    await expect(page.getByRole('dialog', { name: 'The dashboard' })).toBeVisible();
    await expect(card(page, 'party')).toHaveClass(/is-folded/);
  });

  test('the title is not a tab stop: the button is the keyboard path', async ({ page }) => {
    await setup(page, 'layered');
    await load(page);
    const tabbable = await card(page, 'party')
      .getByRole('heading', { name: /Party/ })
      .evaluate(h => h.tabIndex);
    expect(tabbable).toBe(-1);
  });

  test('the Advanced menu’s Party opens a folded Party card', async ({ page }) => {
    await setup(page, 'layered');
    await load(page);
    await expect(card(page, 'party')).toHaveClass(/is-folded/);
    await page.locator('#btn-advanced').click();
    await page.locator('#advanced-menu #btn-party').click();
    await expect(card(page, 'party')).not.toHaveClass(/is-folded/);
    await expect(card(page, 'party')).toBeFocused();
  });
});

test.describe('the folds are kept', () => {
  test('leaving During and coming back finds the cards as they were', async ({ page }) => {
    await setup(page, 'layered');
    await load(page);
    await foldButton(page, 'handouts').click();
    await foldButton(page, 'feed').click();
    await expectFolds(page, folds(true, true, false, true));
    await page.locator('#tab-after').click();
    await expect(during(page)).toBeHidden();
    await page.locator('#tab-before').click();
    await page.locator('#tab-during').click();
    await expect(during(page)).toBeVisible();
    await expectFolds(page, folds(true, true, false, true));
  });

  test('a folded card keeps what it loaded', async ({ page }) => {
    const { calls } = await setup(page, 'layered');
    await load(page);
    // Handouts is folded but loaded: its body is in the page, hidden, and stays the same element.
    const body = card(page, 'handouts').locator('#handouts-drawer-body');
    await expect(body).toBeAttached();
    await expect(body).toBeHidden();
    await expect.poll(() => calls.filter(c => c.name === 'list-revealed-pages').length).toBe(1);
    const handle = await body.elementHandle();
    await foldButton(page, 'handouts').click();
    await expect(body).toBeVisible();
    await foldButton(page, 'handouts').click();
    await foldButton(page, 'handouts').click();
    expect(await handle?.evaluate(el => el.isConnected)).toBe(true);
    expect(await body.elementHandle().then(h => h?.evaluate((el, old) => el === old, handle))).toBe(
      true
    );
    // Folding and opening loaded nothing again.
    expect(calls.filter(c => c.name === 'list-revealed-pages')).toHaveLength(1);
  });

  test('Auto: the fight starting and ending does not undo the GM’s choice', async ({ page }) => {
    const { push } = await setup(page, 'auto');
    await load(page);
    // Calm: the GM opens Handouts (Recent Changes and Party fold with it).
    await foldButton(page, 'handouts').click();
    await expectFolds(page, folds(false, true, false, true));

    // The fight starts: Auto shows its combat defaults the first time.
    push([fightOn]);
    await expect(during(page)).toHaveAttribute('data-context', 'combat');
    await expectFolds(page, folds(true, false, true, false));
    // The GM folds Party for the fight.
    await foldButton(page, 'party').click();
    await expectFolds(page, folds(true, false, true, true));

    // The fight ends: calm is as the GM left it.
    push([fightOff]);
    await expect(during(page)).toHaveAttribute('data-context', 'calm');
    await expectFolds(page, folds(false, true, false, true));

    // The next fight finds the fight choice too.
    push([fightOn]);
    await expect(during(page)).toHaveAttribute('data-context', 'combat');
    await expectFolds(page, folds(true, false, true, true));
  });

  test('the window crossing 900 and 600 px does not undo the GM’s choice', async ({ page }) => {
    await setup(page, 'layered');
    await load(page);
    await foldButton(page, 'handouts').click();
    await foldButton(page, 'feed').click();
    await expectFolds(page, folds(true, true, false, true));

    // Medium: its own defaults the first time.
    await page.setViewportSize(MEDIUM);
    await expectFolds(page, folds(false, false, true, true));
    await foldButton(page, 'party').click();
    await expectFolds(page, folds(false, false, true, false));

    // Phone: its own defaults too (the feed folded).
    await page.setViewportSize(PHONE);
    await expectFolds(page, folds(true, false, true, true));

    // And back: every width class has what the GM left there.
    await page.setViewportSize(MEDIUM);
    await expectFolds(page, folds(false, false, true, false));
    await page.setViewportSize(WIDE);
    await expectFolds(page, folds(true, true, false, true));
  });

  test('each layout keeps its own choices', async ({ page }) => {
    await setup(page, 'layered');
    let layout: Layout = 'layered';
    await page.route('**/api/control', route => {
      const body = route.request().postDataJSON() as { value: { duringLayout?: Layout } };
      layout = body.value.duringLayout ?? layout;
      return route.fulfill({
        json: {
          duringLayout: layout,
          duringFull: false,
          combatButtons: false,
          layoutPicked: true,
          hintDismissed: true,
          hintSessions: [],
        },
      });
    });
    await load(page);
    const pick = (name: string): Locator =>
      page.getByRole('group', { name: 'During layout' }).getByRole('button', { name, exact: true });
    await foldButton(page, 'party').click();
    await expectFolds(page, folds(false, true, true, false));
    await pick('Simple/Full').click();
    await expectFolds(page, folds(false, false, false, false));
    await foldButton(page, 'feed').click();
    await pick('Cards').click();
    await expectFolds(page, folds(false, true, true, false));
    await pick('Simple/Full').click();
    await expectFolds(page, folds(true, false, false, false));
  });
});
