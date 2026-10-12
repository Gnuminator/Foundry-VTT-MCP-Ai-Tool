// The During layouts on the React dashboard (D-092, I-107): the layout switch and how it saves
// (set-prefs over POST /api/control), a choice made elsewhere arriving as the `prefs` stream
// event, the fight (the `combat` event) changing the screen in Auto, the layout trial (the Before
// card, the guide, Next, Use, Stop, Escape), the quiet hint, and the Advanced menu's During group.
// The bridge and the stream are faked in the browser; nothing here needs a world.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeTools, fromMenu, ok, toast } from './support';

const STARTED = '2026-10-10T18:00:00.000Z';

interface Prefs {
  duringLayout: 'layered' | 'toggle' | 'auto';
  duringFull: boolean;
  combatButtons: boolean;
  layoutPicked: boolean;
  hintDismissed: boolean;
  hintSessions: string[];
}

const PREFS: Prefs = {
  duringLayout: 'layered',
  duringFull: false,
  combatButtons: false,
  layoutPicked: false,
  hintDismissed: false,
  hintSessions: [],
};

interface Event {
  event: string;
  data: unknown;
}

/** A recorded set-prefs call: the `value` of POST /api/control. */
type Change = Record<string, unknown>;

interface Fakes {
  /** The changes the page sent, in order. */
  changes: Change[];
  /** Sends events on the stream after the page loaded (the stream reconnects and gets these). */
  push: (events: Event[]) => void;
}

const sse = (events: Event[], retry: number): string =>
  `retry: ${retry}\n\n${events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('')}`;

/**
 * The page's world: a play session (open or not), the stream with these first events, and
 * set-prefs, which keeps the prefs it was given and answers with them merged. `answer` can hold
 * the answer back or refuse it. `push` makes the stream reconnect (a short retry) and send more.
 */
async function setup(
  page: Page,
  {
    open = true,
    events = [],
    answer,
    lateAnswer,
  }: {
    open?: boolean;
    events?: Event[];
    answer?: (change: Change) => Promise<{ status: number; error: string } | undefined>;
    /** Holds the answer back after the change was taken (a slow reply). */
    lateAnswer?: (change: Change) => Promise<void> | undefined;
  } = {}
): Promise<Fakes> {
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
  await fakeTools(
    page,
    call => {
      switch (call.name) {
        case 'get-play-session':
          return ok({
            success: true,
            worldId: 'w',
            open,
            startedAt: open ? STARTED : null,
            endedAt: null,
          });
        case 'get-party':
          return ok({ groups: [], paceOptions: [], scene: null, encounter: null, warnings: [] });
        case 'list-revealed-pages':
          return ok({ pages: [], queue: [] });
        case 'list-scenes':
          return ok([]);
        case 'get-prep-digest':
          return ok({
            action: 'summary',
            computedAt: 0,
            lastSession: null,
            preflight: { fail: 0, warn: 0, items: [] },
            warnings: [],
          });
        default:
          return ok({});
      }
    },
    { playSession: true }
  );

  // The first request gets `events` and ends, so the page reconnects after 150 ms; that request
  // waits for `push`, then gets what was pushed (with a retry too long to repeat).
  let release: (events: Event[]) => void = () => undefined;
  const pushed = new Promise<Event[]>(resolve => (release = resolve));
  let requests = 0;
  await page.route('**/api/stream**', async route => {
    requests += 1;
    const body = requests === 1 ? sse(events, 150) : sse(await pushed, 600000);
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });

  const changes: Change[] = [];
  let stored: Prefs = { ...PREFS };
  for (const e of events) if (e.event === 'prefs') stored = e.data as Prefs;
  await page.route('**/api/control', async route => {
    const body = route.request().postDataJSON() as { action: string; value: Change };
    if (body.action !== 'set-prefs') return route.fallback();
    changes.push(body.value);
    const refused = await answer?.(body.value);
    if (refused) return route.fulfill({ status: refused.status, json: { error: refused.error } });
    const { hintSession, ...fields } = body.value as Change & { hintSession?: string };
    stored = {
      ...stored,
      ...fields,
      hintSessions: hintSession ? [...stored.hintSessions, hintSession] : stored.hintSessions,
    };
    const answered = stored;
    await lateAnswer?.(body.value);
    return route.fulfill({ json: answered });
  });
  return { changes, push: release };
}

const prefs = (over: Partial<Prefs> = {}): Event => ({
  event: 'prefs',
  data: { ...PREFS, ...over },
});
const picked = (over: Partial<Prefs> = {}): Event =>
  prefs({ layoutPicked: true, hintDismissed: true, ...over });

const during = (page: Page): Locator => page.locator('#moment-during');
const layoutButton = (page: Page, name: string): Locator =>
  page.getByRole('group', { name: 'During layout' }).getByRole('button', { name, exact: true });
const guide = (page: Page): Locator => page.locator('#layout-tour');
const hint = (page: Page): Locator => page.locator('#layout-hint');

async function load(page: Page): Promise<void> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
}

test.describe('the layout switch', () => {
  test('is in the During bar with the old names, ids and the pressed layout', async ({ page }) => {
    await setup(page, { events: [picked()] });
    await load(page);
    await expect(during(page)).toBeVisible();

    const group = page.getByRole('group', { name: 'During layout' });
    await expect(group).toContainText('Layout');
    await expect(group.getByRole('button')).toHaveText(['Cards', 'Simple/Full', 'Auto']);
    await expect(layoutButton(page, 'Cards')).toHaveAttribute('aria-pressed', 'true');
    await expect(layoutButton(page, 'Auto')).toHaveAttribute('aria-pressed', 'false');
    await expect(layoutButton(page, 'Simple/Full')).toHaveAttribute('data-layout-pick', 'toggle');
    await expect(layoutButton(page, 'Cards')).toHaveAttribute(
      'data-track',
      'dash.during.layout-layered'
    );
    await expect(layoutButton(page, 'Simple/Full')).toHaveAttribute(
      'title',
      'A short screen, or everything with one switch'
    );
    await expect(during(page)).toHaveAttribute('data-layout', 'layered');
    await expect(during(page)).toHaveAttribute('data-context', 'calm');
    await expect(during(page)).not.toHaveAttribute('data-view', /.*/);
    // The slots the CSS grid names are all there, the strip too (the turn order comes later).
    await expect(during(page).locator('[data-slot]')).toHaveCount(5);
    await expect(page.locator('#btn-during-full')).toBeHidden();
    await expect(page.locator('#during-auto-note')).toBeHidden();
  });

  test('each button saves its layout with layoutPicked and shows it', async ({ page }) => {
    const { changes } = await setup(page, { events: [picked()] });
    await load(page);
    await expect(layoutButton(page, 'Cards')).toBeEnabled();

    await layoutButton(page, 'Simple/Full').click();
    await expect(during(page)).toHaveAttribute('data-layout', 'toggle');
    await expect(layoutButton(page, 'Simple/Full')).toHaveAttribute('aria-pressed', 'true');
    await expect(layoutButton(page, 'Cards')).toHaveAttribute('aria-pressed', 'false');
    await expect(during(page)).toHaveAttribute('data-view', 'simple');

    await layoutButton(page, 'Auto').click();
    await expect(during(page)).toHaveAttribute('data-layout', 'auto');
    await expect(page.locator('#during-auto-note')).toHaveText(
      'No combat: the Live Feed comes first.'
    );
    await expect(during(page)).not.toHaveAttribute('data-view', /.*/);

    await layoutButton(page, 'Cards').click();
    await expect(during(page)).toHaveAttribute('data-layout', 'layered');

    expect(changes).toEqual([
      { duringLayout: 'toggle', layoutPicked: true },
      { duringLayout: 'auto', layoutPicked: true },
      { duringLayout: 'layered', layoutPicked: true },
    ]);
  });

  test('shows the choice at once, before the server answers', async ({ page }) => {
    let answerNow: () => void = () => undefined;
    const held = new Promise<void>(resolve => (answerNow = resolve));
    await setup(page, {
      events: [picked()],
      answer: async () => {
        await held;
        return undefined;
      },
    });
    await load(page);
    await layoutButton(page, 'Auto').click();
    await expect(during(page)).toHaveAttribute('data-layout', 'auto');
    answerNow();
    await expect(during(page)).toHaveAttribute('data-layout', 'auto');
  });

  test('goes back and says so when the choice is not saved', async ({ page }) => {
    await setup(page, {
      events: [picked()],
      answer: () => Promise.resolve({ status: 500, error: 'disk full' }),
    });
    await load(page);
    await layoutButton(page, 'Auto').click();
    await expect(toast(page, '✗ Could not save the screen choice: disk full')).toBeVisible();
    await expect(during(page)).toHaveAttribute('data-layout', 'layered');
    await expect(layoutButton(page, 'Cards')).toHaveAttribute('aria-pressed', 'true');
  });

  test('waits for the world: the buttons are off until the prefs arrive', async ({ page }) => {
    const { changes, push } = await setup(page, { events: [] });
    await load(page);
    await expect(during(page)).toBeVisible();
    for (const name of ['Cards', 'Simple/Full', 'Auto']) {
      await expect(layoutButton(page, name)).toBeDisabled();
    }
    await expect(layoutButton(page, 'Auto')).toHaveAttribute('title', /not told the dashboard/);
    // Off but still focusable (aria-disabled), so the keyboard reaches the reason; a click does nothing.
    await layoutButton(page, 'Auto').focus();
    await expect(layoutButton(page, 'Auto')).toBeFocused();
    await layoutButton(page, 'Auto').click({ force: true });
    // No error toast to click into, and nothing was sent.
    expect(changes).toEqual([]);

    push([prefs({ layoutPicked: true, duringLayout: 'auto' })]);
    await expect(layoutButton(page, 'Auto')).toBeEnabled();
    await expect(layoutButton(page, 'Auto')).toHaveAttribute('aria-pressed', 'true');
    await expect(during(page)).toHaveAttribute('data-layout', 'auto');
  });

  test('follows a choice made elsewhere (the prefs stream event)', async ({ page }) => {
    const { push } = await setup(page, { events: [picked()] });
    await load(page);
    await expect(during(page)).toHaveAttribute('data-layout', 'layered');

    push([picked({ duringLayout: 'toggle', duringFull: true })]);
    await expect(during(page)).toHaveAttribute('data-layout', 'toggle');
    await expect(during(page)).toHaveAttribute('data-view', 'full');
    await expect(layoutButton(page, 'Simple/Full')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#btn-during-full')).toHaveText('Show less');
  });

  test('Simple/Full: the bar button flips the view and saves duringFull', async ({ page }) => {
    const { changes } = await setup(page, {
      events: [picked({ duringLayout: 'toggle' })],
    });
    await load(page);
    const full = page.locator('#btn-during-full');
    await expect(full).toBeVisible();
    await expect(full).toHaveText('Show everything');
    await expect(during(page)).toHaveAttribute('data-view', 'simple');

    await full.click();
    await expect(full).toHaveText('Show less');
    await expect(during(page)).toHaveAttribute('data-view', 'full');
    await full.click();
    await expect(full).toHaveText('Show everything');
    await expect(during(page)).toHaveAttribute('data-view', 'simple');
    expect(changes).toEqual([{ duringFull: true }, { duringFull: false }]);
  });

  test('Auto follows the fight (the combat stream event)', async ({ page }) => {
    const { push } = await setup(page, {
      events: [picked({ duringLayout: 'auto' }), { event: 'combat', data: { combat: null } }],
    });
    await load(page);
    await expect(during(page)).toHaveAttribute('data-context', 'calm');
    await expect(page.locator('#during-auto-note')).toHaveText(
      'No combat: the Live Feed comes first.'
    );

    push([{ event: 'combat', data: { combat: { active: true, round: 1, combatants: [] } } }]);
    await expect(during(page)).toHaveAttribute('data-context', 'combat');
    await expect(page.locator('#during-auto-note')).toHaveText(
      'Combat: the turn order and the party come forward.'
    );
  });

  test('the "?" opens the During layouts part of the guide', async ({ page }) => {
    await setup(page, { events: [picked()] });
    await load(page);
    const help = page.getByRole('button', { name: 'Help for the During layouts' });
    await expect(help).toHaveAttribute('data-track', 'dash.help.during-layouts');
    const request = page.waitForRequest(req => req.url().endsWith('/api/help/dashboard'));
    await help.click();
    await request;
    await expect(page.getByRole('dialog', { name: 'The dashboard' })).toBeVisible();
    await expect(page.locator('#pane-help').locator('[id="during-layouts"]')).toBeInViewport();
  });
});

test.describe('the layout trial', () => {
  test('the Before card offers it until a layout is picked', async ({ page }) => {
    const { changes } = await setup(page, { open: false, events: [prefs()] });
    await load(page);
    const card = page.locator('#layout-trial');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Pick your During layout' })).toBeVisible();
    await expect(card.getByRole('button')).toHaveText(['Try the layouts', 'Keep Cards']);

    await page.locator('#btn-layout-trial-skip').click();
    await expect(card).toBeHidden();
    expect(changes).toEqual([{ duringLayout: 'layered', layoutPicked: true }]);
  });

  test('the Before card stays hidden once picked, and until the prefs are known', async ({
    page,
  }) => {
    await setup(page, { open: false, events: [picked({ duringLayout: 'auto' })] });
    await load(page);
    await expect(page.locator('#tab-before')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#layout-trial')).toBeHidden();
  });

  test('the Before card is not shown before the prefs arrive', async ({ page }) => {
    const { push } = await setup(page, { open: false, events: [] });
    await load(page);
    await expect(page.locator('#tab-before')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#layout-trial')).toBeHidden();
    push([prefs()]);
    await expect(page.locator('#layout-trial')).toBeVisible();
  });

  test('runs through the three layouts: start, Next, Next, back to the first', async ({ page }) => {
    const { changes } = await setup(page, { open: false, events: [prefs()] });
    await load(page);
    await expect(guide(page)).toBeHidden();

    await page.locator('#btn-layout-trial').click();
    // The trial pins the page to During and does not take the focus.
    await expect(page.locator('#tab-during')).toHaveAttribute('aria-selected', 'true');
    await expect(guide(page)).toBeVisible();
    await expect(guide(page)).toHaveAccessibleName('Try the During layouts');
    await expect(page.locator('#layout-tour-step')).toHaveText('Layout 1 of 3');
    await expect(page.locator('#layout-tour-title')).toHaveText('Cards');
    await expect(during(page)).toHaveAttribute('data-layout', 'layered');
    await expect(page.locator('#layout-tour-next')).toHaveText('Next');

    await page.locator('#layout-tour-next').click();
    await expect(page.locator('#layout-tour-step')).toHaveText('Layout 2 of 3');
    await expect(page.locator('#layout-tour-title')).toHaveText('Simple/Full');
    await expect(during(page)).toHaveAttribute('data-layout', 'toggle');
    await expect(layoutButton(page, 'Simple/Full')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#layout-tour-next').click();
    await expect(page.locator('#layout-tour-step')).toHaveText('Layout 3 of 3');
    await expect(during(page)).toHaveAttribute('data-layout', 'auto');
    // The sample fight: Auto shows its combat look without a real fight.
    await expect(during(page)).toHaveAttribute('data-context', 'combat');
    await expect(page.locator('#layout-tour-next')).toHaveText('Back to the first');

    await page.locator('#layout-tour-next').click();
    await expect(page.locator('#layout-tour-step')).toHaveText('Layout 1 of 3');
    await expect(during(page)).toHaveAttribute('data-layout', 'layered');
    await expect(during(page)).toHaveAttribute('data-context', 'calm');
    // Trying saves nothing.
    expect(changes).toEqual([]);
  });

  test('the Simple/Full step shows the "Show everything" button its text points to', async ({
    page,
  }) => {
    const { changes } = await setup(page, { open: false, events: [prefs()] });
    await load(page);
    await page.locator('#btn-layout-trial').click();
    await page.locator('#layout-tour-next').click();

    await expect(page.locator('#layout-tour-text')).toContainText('"Show everything" on the bar');
    const full = page.locator('#btn-during-full');
    await expect(full).toBeVisible();
    await expect(full).toHaveText('Show everything');
    await expect(during(page)).toHaveAttribute('data-view', 'simple');
    await full.click();
    await expect(full).toHaveText('Show less');
    await expect(during(page)).toHaveAttribute('data-view', 'full');
    // Only a preview: nothing is saved until "Use this one".
    expect(changes).toEqual([]);

    await page.locator('#layout-tour-use').click();
    expect(changes).toEqual([{ duringLayout: 'toggle', layoutPicked: true, duringFull: true }]);
  });

  test('Use this one keeps the layout, says so, and ends the trial', async ({ page }) => {
    const { changes } = await setup(page, { open: false, events: [prefs()] });
    await load(page);
    await page.locator('#btn-layout-trial').click();
    await page.locator('#layout-tour-next').click();
    await page.locator('#layout-tour-next').click();

    await page.locator('#layout-tour-use').click();
    await expect(guide(page)).toBeHidden();
    await expect(
      toast(page, '✓ Auto kept. Switch any time with Layout on the During screen.')
    ).toBeVisible();
    expect(changes).toEqual([{ duringLayout: 'auto', layoutPicked: true }]);
    await expect(during(page)).toHaveAttribute('data-layout', 'auto');
    await expect(layoutButton(page, 'Auto')).toHaveAttribute('aria-pressed', 'true');
    // The trial card on Before is gone for good.
    await page.locator('#tab-before').click();
    await expect(page.locator('#layout-trial')).toBeHidden();
  });

  test('Stop ends the trial and keeps the saved layout', async ({ page }) => {
    const { changes } = await setup(page, { open: false, events: [prefs()] });
    await load(page);
    await page.locator('#btn-layout-trial').click();
    await page.locator('#layout-tour-next').click();
    await expect(during(page)).toHaveAttribute('data-layout', 'toggle');

    await page.locator('#layout-tour-stop').click();
    await expect(guide(page)).toBeHidden();
    await expect(during(page)).toHaveAttribute('data-layout', 'layered');
    expect(changes).toEqual([]);
    await page.locator('#tab-before').click();
    await expect(page.locator('#layout-trial')).toBeVisible();
  });

  test('Escape ends the trial', async ({ page }) => {
    const { changes } = await setup(page, { open: false, events: [prefs()] });
    await load(page);
    await page.locator('#btn-layout-trial').click();
    await expect(guide(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(guide(page)).toBeHidden();
    expect(changes).toEqual([]);
  });

  test('Escape from inside the guide moves the focus to the layout switch', async ({ page }) => {
    await setup(page, { open: false, events: [prefs()] });
    await load(page);
    await page.locator('#btn-layout-trial').click();
    await page.locator('#layout-tour-next').focus();
    await page.keyboard.press('Escape');
    await expect(guide(page)).toBeHidden();
    await expect(layoutButton(page, 'Cards')).toBeFocused();
  });

  test('Escape closes an open drawer or menu first, not the trial', async ({ page }) => {
    await setup(page, { open: true, events: [prefs()] });
    await load(page);
    await fromMenu(page, 'btn-layout-tour');
    await expect(guide(page)).toBeVisible();

    // A drawer over the page takes the Escape.
    await fromMenu(page, 'btn-tarokka');
    const tarokka = page.getByRole('dialog', { name: '🃏 Tarokka' });
    await expect(tarokka).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tarokka).toBeHidden();
    await expect(guide(page)).toBeVisible();

    // So does the Advanced menu.
    await page.locator('#btn-advanced').click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(guide(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(guide(page)).toBeHidden();
  });

  test('a layout button during the trial ends it and saves that layout', async ({ page }) => {
    const { changes } = await setup(page, { open: true, events: [picked()] });
    await load(page);
    await fromMenu(page, 'btn-layout-tour');
    await expect(guide(page)).toBeVisible();

    await layoutButton(page, 'Auto').click();
    await expect(guide(page)).toBeHidden();
    await expect(during(page)).toHaveAttribute('data-layout', 'auto');
    expect(changes).toEqual([{ duringLayout: 'auto', layoutPicked: true }]);
  });

  test('can start again from the Advanced menu after a layout was kept', async ({ page }) => {
    await setup(page, { open: true, events: [picked({ duringLayout: 'auto' })] });
    await load(page);
    await expect(guide(page)).toBeHidden();
    await fromMenu(page, 'btn-layout-tour');
    await expect(guide(page)).toBeVisible();
    // The trial shows its own layouts, not the saved one.
    await expect(during(page)).toHaveAttribute('data-layout', 'layered');
    await expect(layoutButton(page, 'Cards')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#layout-tour-stop').click();
    await expect(during(page)).toHaveAttribute('data-layout', 'auto');
  });
});

test.describe('the hint', () => {
  test('shows in a session until a layout is picked, and counts the session once', async ({
    page,
  }) => {
    const { changes } = await setup(page, { events: [prefs()] });
    await load(page);
    await expect(hint(page)).toBeVisible();
    await expect(hint(page)).toContainText(
      'New: the During screen has three layouts. Try Simple/Full or Auto here, or keep Cards.'
    );
    await expect.poll(() => changes).toEqual([{ hintSession: STARTED }]);
    // Counting changes nothing on screen, and it is not sent again.
    await expect(hint(page)).toBeVisible();
    await page.waitForTimeout(400);
    expect(changes).toEqual([{ hintSession: STARTED }]);
  });

  test('Hide this hint saves hintDismissed and hides it', async ({ page }) => {
    const { changes } = await setup(page, {
      events: [prefs({ hintSessions: [STARTED] })],
    });
    await load(page);
    const close = page.getByRole('button', { name: 'Hide this hint' });
    await expect(close).toBeVisible();
    await expect(close).toHaveAttribute('data-track', 'dash.during.hint-dismiss');
    await close.click();
    await expect(hint(page)).toBeHidden();
    expect(changes).toEqual([{ hintDismissed: true }]);
  });

  test('stays away once a layout was picked or the hint was dismissed', async ({ page }) => {
    await setup(page, { events: [prefs({ layoutPicked: true })] });
    await load(page);
    await expect(during(page)).toBeVisible();
    await expect(hint(page)).toBeHidden();
  });

  test('stays away after a dismissal', async ({ page }) => {
    await setup(page, { events: [prefs({ hintDismissed: true })] });
    await load(page);
    await expect(during(page)).toBeVisible();
    await expect(hint(page)).toBeHidden();
  });

  test('shows in the first three sessions only; the one on screen keeps showing', async ({
    page,
  }) => {
    await setup(page, { events: [prefs({ hintSessions: ['a', 'b', 'c'] })] });
    await load(page);
    await expect(during(page)).toBeVisible();
    await expect(hint(page)).toBeHidden();
  });

  test('keeps showing in a session that was already counted', async ({ page }) => {
    const { changes } = await setup(page, {
      events: [prefs({ hintSessions: ['a', 'b', STARTED] })],
    });
    await load(page);
    await expect(hint(page)).toBeVisible();
    expect(changes).toEqual([]);
  });

  test('waits for the prefs, and is hidden while the trial runs', async ({ page }) => {
    const { push } = await setup(page, { open: true, events: [] });
    await load(page);
    await expect(during(page)).toBeVisible();
    await expect(hint(page)).toBeHidden();

    push([prefs({ hintSessions: [STARTED] })]);
    await expect(hint(page)).toBeVisible();

    await fromMenu(page, 'btn-layout-tour');
    await expect(guide(page)).toBeVisible();
    await expect(hint(page)).toBeHidden();
    await page.locator('#layout-tour-stop').click();
    await expect(hint(page)).toBeVisible();
  });

  test('is not shown when no session is open', async ({ page }) => {
    await setup(page, { open: false, events: [prefs()] });
    await load(page);
    await page.locator('#tab-during').click();
    await expect(during(page)).toBeVisible();
    await expect(hint(page)).toBeHidden();
  });
});

test.describe('the Advanced menu', () => {
  test('has a During screen group with Combat buttons and the trial', async ({ page }) => {
    await setup(page, { events: [picked()] });
    await load(page);
    await page.locator('#btn-advanced').click();
    const menu = page.getByRole('menu');
    await expect(menu.locator('.menu-label')).toHaveText(['Panels', 'During screen', 'Tools']);
    const items = menu.getByRole('menuitem');
    await expect(items.nth(5)).toHaveText('⚔ Combat buttons: off');
    await expect(items.nth(6)).toHaveText('▦ Try the During layouts');
    await expect(menu.locator('#btn-combat-buttons')).toHaveAttribute(
      'data-track',
      'dash.header.combat-buttons'
    );
    await expect(menu.locator('#btn-layout-tour')).toHaveAttribute(
      'data-track',
      'dash.header.layout-tour'
    );
  });

  test('Combat buttons saves the choice, says so, and shows on or off', async ({ page }) => {
    const { changes } = await setup(page, { events: [picked()] });
    await load(page);
    await page.locator('#btn-advanced').click();
    await page.locator('#btn-combat-buttons').click();
    await expect(
      toast(page, '✓ Combat buttons on. They show in the turn-order strip once GM Actions are on.')
    ).toBeVisible();
    expect(changes).toEqual([{ combatButtons: true }]);
    // The menu closed and the focus went back to its button.
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(page.locator('#btn-advanced')).toBeFocused();

    await page.locator('#btn-advanced').click();
    await expect(page.locator('#btn-combat-buttons')).toHaveText('⚔ Combat buttons: on');
    await expect(page.locator('#btn-combat-buttons')).toHaveClass(/\bon\b/);
    await page.locator('#btn-combat-buttons').click();
    expect(changes).toEqual([{ combatButtons: true }, { combatButtons: false }]);
  });

  test('Combat buttons are off until the prefs arrive, and the arrow keys skip them', async ({
    page,
  }) => {
    await setup(page, { events: [] });
    await load(page);
    await page.locator('#btn-advanced').press('Enter');
    await expect(page.locator('#btn-combat-buttons')).toBeDisabled();
    await expect(page.locator('#btn-layout-tour')).toBeEnabled();
  });
});

test.describe('overlapping saves', () => {
  test('a failed older save does not undo a newer one that was saved', async ({ page }) => {
    let failFirst: () => void = () => undefined;
    const held = new Promise<void>(resolve => (failFirst = resolve));
    const { changes } = await setup(page, {
      events: [picked()],
      answer: async change => {
        if (change['duringLayout'] !== 'auto') return undefined;
        await held;
        return { status: 500, error: 'disk full' };
      },
    });
    await load(page);
    // The first save (Auto) is on its way and shown at once.
    await layoutButton(page, 'Auto').click();
    await expect(during(page)).toHaveAttribute('data-layout', 'auto');
    // A second one (Combat buttons on) is saved while the first is still out.
    await page.locator('#btn-advanced').click();
    await page.locator('#btn-combat-buttons').click();
    await expect(
      toast(page, '✓ Combat buttons on. They show in the turn-order strip once GM Actions are on.')
    ).toBeVisible();

    // Now the first one fails: its own field goes back, the second one stays.
    failFirst();
    await expect(toast(page, '✗ Could not save the screen choice: disk full')).toBeVisible();
    await expect(during(page)).toHaveAttribute('data-layout', 'layered');
    await expect(layoutButton(page, 'Cards')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#btn-advanced').click();
    await expect(page.locator('#btn-combat-buttons')).toHaveText('⚔ Combat buttons: on');
    expect(changes).toEqual([
      { duringLayout: 'auto', layoutPicked: true },
      { combatButtons: true },
    ]);
  });

  test('an older answer that arrives late does not overwrite a newer change', async ({ page }) => {
    let answerFirst: () => void = () => undefined;
    const held = new Promise<void>(resolve => (answerFirst = resolve));
    await setup(page, {
      events: [picked()],
      lateAnswer: async change => {
        if (change['duringLayout'] === 'auto') await held;
      },
    });
    await load(page);
    await layoutButton(page, 'Auto').click();
    await page.locator('#btn-advanced').click();
    await page.locator('#btn-combat-buttons').click();
    await expect(
      toast(page, '✓ Combat buttons on. They show in the turn-order strip once GM Actions are on.')
    ).toBeVisible();
    await expect(during(page)).toHaveAttribute('data-layout', 'auto');

    // The first answer (Auto, Combat buttons still off) comes in after the second one.
    answerFirst();
    await page.waitForTimeout(300);
    await expect(during(page)).toHaveAttribute('data-layout', 'auto');
    await page.locator('#btn-advanced').click();
    await expect(page.locator('#btn-combat-buttons')).toHaveText('⚔ Combat buttons: on');
  });
});

test.describe('the trial and assistive technology', () => {
  test('the step is announced from a live region that is always in the page', async ({ page }) => {
    await setup(page, { open: false, events: [prefs()] });
    await load(page);
    const live = page.locator('#layout-tour-live');
    await expect(live).toBeAttached();
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(live).toHaveText('');
    // The visible step line is not a second live region.
    await expect(page.locator('#layout-tour-step')).not.toHaveAttribute('aria-live', /.*/);

    await page.locator('#btn-layout-trial').click();
    await expect(live).toHaveText('Layout 1 of 3: Cards');
    await page.locator('#layout-tour-next').click();
    await expect(live).toHaveText('Layout 2 of 3: Simple/Full');
    await page.locator('#layout-tour-stop').click();
    await expect(live).toHaveText('');
  });

  test('Use this one hands the focus to the layout button it kept', async ({ page }) => {
    await setup(page, { events: [picked()] });
    await load(page);
    await fromMenu(page, 'btn-layout-tour');
    await page.locator('#layout-tour-next').click();
    await page.locator('#layout-tour-next').click();
    await page.locator('#layout-tour-use').click();
    await expect(guide(page)).toBeHidden();
    await expect(layoutButton(page, 'Auto')).toBeFocused();
  });

  test('Stop hands the focus to the saved layout button', async ({ page }) => {
    await setup(page, { events: [picked({ duringLayout: 'toggle' })] });
    await load(page);
    await fromMenu(page, 'btn-layout-tour');
    await page.locator('#layout-tour-stop').click();
    await expect(guide(page)).toBeHidden();
    await expect(layoutButton(page, 'Simple/Full')).toBeFocused();
  });

  test('with the During screen away, the focus goes to the Advanced button', async ({ page }) => {
    await setup(page, { open: false, events: [picked()] });
    await load(page);
    await fromMenu(page, 'btn-layout-tour');
    await expect(guide(page)).toBeVisible();
    await page.locator('#tab-before').click();
    await page.locator('#layout-tour-stop').click();
    await expect(guide(page)).toBeHidden();
    await expect(page.locator('#btn-advanced')).toBeFocused();
  });

  test('the reason the buttons are off is their description, not only a title', async ({
    page,
  }) => {
    const { push } = await setup(page, { events: [] });
    await load(page);
    await expect(layoutButton(page, 'Auto')).toBeDisabled();
    await expect(layoutButton(page, 'Auto')).toHaveAccessibleDescription(/not told the dashboard/);
    await expect(page.locator('#during-not-ready')).toHaveText(/not told the dashboard/);

    push([prefs({ layoutPicked: true })]);
    await expect(layoutButton(page, 'Auto')).toBeEnabled();
    await expect(layoutButton(page, 'Auto')).not.toHaveAttribute('aria-describedby', /.*/);
    await expect(page.locator('#during-not-ready')).toHaveCount(0);
  });

  test('the Use button and Combat buttons say why they are off too', async ({ page }) => {
    await setup(page, { events: [] });
    await load(page);
    await fromMenu(page, 'btn-layout-tour');
    await expect(page.locator('#layout-tour-use')).toBeDisabled();
    await expect(page.locator('#layout-tour-use')).toHaveAccessibleDescription(
      /not told the dashboard/
    );
    await page.locator('#btn-advanced').click();
    await expect(page.locator('#btn-combat-buttons')).toHaveAccessibleDescription(
      /not told the dashboard/
    );
  });
});

test.describe('Escape and popups', () => {
  test('an open tooltip takes the Escape; the trial goes on, and the next Escape ends it', async ({
    page,
  }) => {
    await setup(page, { events: [picked()] });
    await load(page);
    await fromMenu(page, 'btn-layout-tour');
    await expect(guide(page)).toBeVisible();

    // The help "?" has a tooltip; it is open while the pointer rests on it.
    await page.getByRole('button', { name: 'Help for the During layouts' }).hover();
    await expect(page.getByRole('tooltip').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(guide(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(guide(page)).toBeHidden();
  });
});
