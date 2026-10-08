// Ready for session inside Pre-flight: the switch chips (/api/session/switches, faked here except
// in the last test), turning them on and off with the toasts the old page shows, GM Actions from
// the stream's settings event, the pre-flight row following, and Start the session log.
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream } from './support';

const OFF = [
  { id: 'writes', name: 'AI Tool: Changes from the tool', on: false },
  { id: 'handouts', name: 'AI Tool: Handouts (writes)', on: false },
];
const ON = OFF.map(s => ({ ...s, on: true }));
const READY_AT = new Date(2026, 9, 10, 19, 5).getTime();

const switches = (list: typeof OFF, extra: Record<string, unknown> = {}): unknown => ({
  switches: list,
  ready: null,
  changed: [],
  failed: [],
  ...extra,
});

const READY_ROW = { id: 'ready', label: 'Ready for session', status: 'warn', detail: 'Off.' };

interface FakeAnswer {
  status?: number;
  json: unknown;
}

interface Fakes {
  posts: unknown[];
  preflightCalls: () => number;
  tools: unknown[];
}

/**
 * Fakes the routes the block calls. `post` answers each POST /api/session/switches; the tool
 * route answers get-play-session with `sessionOpen()` and mark-play-session with ok.
 */
async function fakeReady(
  page: Page,
  read: unknown,
  post: (action: string) => FakeAnswer = (): FakeAnswer => ({ json: {} }),
  sessionOpen: () => boolean = (): boolean => false
): Promise<Fakes> {
  const fakes: Fakes = { posts: [], preflightCalls: () => preflight, tools: [] };
  let preflight = 0;
  await page.route('**/api/preflight', route => {
    preflight += 1;
    return route.fulfill({ json: { ready: false, checks: [READY_ROW], scan: null } });
  });
  await page.route('**/api/session/switches', (route, request: Request) => {
    if (request.method() === 'GET') return route.fulfill({ json: read });
    const body = request.postDataJSON() as { action: string };
    fakes.posts.push(body);
    const answer = post(body.action);
    return route.fulfill({ status: answer.status ?? 200, json: answer.json });
  });
  await page.route('**/api/tool', (route, request: Request) => {
    const body = request.postDataJSON() as { name: string };
    fakes.tools.push(body);
    const result = body.name === 'get-play-session' ? { open: sessionOpen() } : { started: true };
    return route.fulfill({ json: { ok: true, name: body.name, mutates: 'read', result } });
  });
  return fakes;
}

async function openReady(page: Page): Promise<Locator> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await page.locator('#btn-preflight').click();
  const drawer = page.getByRole('dialog', { name: '✈ Pre-flight' });
  await expect(drawer).toBeVisible();
  return drawer.locator('#ready-block');
}

const chips = (block: Locator): Locator =>
  block.getByRole('list', { name: 'Switches for tonight' }).getByRole('listitem');

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
});

test('shows the switches, all off, with Ready and the session log', async ({ page }) => {
  await fakeStream(page, []);
  await fakeReady(page, { switches: switches(OFF), gmActionsEnabled: false, error: null });
  const block = await openReady(page);

  await expect(chips(block)).toHaveText([
    '○ Changes from the tool',
    '○ Handouts (writes)',
    '○ GM Actions',
  ]);
  await expect(chips(block).nth(1)).toHaveAttribute('title', 'AI Tool: Handouts (writes): off');
  await expect(block.locator('#btn-ready')).toHaveText('Ready for session');
  await expect(block.locator('#btn-ready')).toBeEnabled();
  await expect(block.locator('#btn-ready-off')).toHaveCount(0);
  await expect(block.locator('#btn-ready-log')).toBeVisible();
  await expect(block.locator('#ready-note')).toHaveText(/^Turns on, for tonight only: /);
});

test('Ready turns them on, says what changed, and the pre-flight row follows', async ({ page }) => {
  await fakeStream(page, []);
  const fakes = await fakeReady(
    page,
    { switches: switches(OFF), gmActionsEnabled: false, error: null },
    () => ({
      json: {
        ok: true,
        switches: switches(ON, {
          ready: { at: READY_AT, turnedOn: ['writes', 'handouts'] },
          changed: ['writes', 'handouts'],
        }),
        gmActionsEnabled: true,
        gmActionsChanged: true,
      },
    })
  );
  const block = await openReady(page);
  await expect.poll(fakes.preflightCalls).toBe(1);

  await block.locator('#btn-ready').click();
  await expect.poll(() => fakes.posts).toEqual([{ action: 'ready' }]);
  await expect(
    page.getByText(
      '✓ Ready for session. Turned on: Changes from the tool, Handouts (writes), GM Actions'
    )
  ).toBeVisible();
  await expect(block.locator('#btn-ready')).toHaveText('✓ Ready for tonight');
  await expect(block.locator('#btn-ready')).toHaveClass(/is-ready/);
  await expect(block.locator('#btn-ready')).toBeDisabled();
  await expect(chips(block)).toHaveText([
    '✓ Changes from the tool',
    '✓ Handouts (writes)',
    '✓ GM Actions',
  ]);
  await expect(chips(block).first()).toHaveClass('on');
  await expect(block.locator('#ready-note')).toHaveText(
    'On since 19:05, for tonight. End session turns off what Ready turned on. Every change can still be undone.'
  );
  await expect(block.locator('#btn-ready-off')).toBeVisible();
  await expect.poll(fakes.preflightCalls).toBe(2);
});

test('Turn them off again says what it turned off', async ({ page }) => {
  await fakeStream(page, []);
  const read = {
    switches: switches(ON, { ready: { at: READY_AT, turnedOn: ['handouts'] } }),
    gmActionsEnabled: true,
    error: null,
  };
  const fakes = await fakeReady(page, read, () => ({
    json: {
      ok: true,
      switches: switches([ON[0], OFF[1]], { changed: ['handouts'] }),
      gmActionsEnabled: false,
      gmActionsChanged: true,
    },
  }));
  const block = await openReady(page);

  await block.locator('#btn-ready-off').click();
  await expect.poll(() => fakes.posts).toEqual([{ action: 'end' }]);
  await expect(page.getByText('✓ Turned off again: Handouts (writes), GM Actions')).toBeVisible();
  await expect(chips(block)).toHaveText([
    '✓ Changes from the tool',
    '○ Handouts (writes)',
    '○ GM Actions',
  ]);
  await expect(block.locator('#btn-ready-off')).toHaveCount(0);
  await expect(block.locator('#btn-ready')).toHaveText('Ready for session');
});

test('a switch Foundry dropped and a failed call both raise error toasts', async ({ page }) => {
  await fakeStream(page, []);
  let calls = 0;
  await fakeReady(page, { switches: switches(OFF), gmActionsEnabled: false, error: null }, () => {
    calls += 1;
    return calls === 1
      ? {
          json: {
            ok: true,
            switches: switches([ON[0], OFF[1]], { changed: ['writes'], failed: ['handouts'] }),
            gmActionsEnabled: false,
            gmActionsChanged: false,
          },
        }
      : { status: 502, json: { ok: false, error: 'The bridge is not connected.' } };
  });
  const block = await openReady(page);

  await block.locator('#btn-ready').click();
  await expect(
    page.getByText('✓ Ready for session. Turned on: Changes from the tool')
  ).toBeVisible();
  await expect(
    page.getByText('✗ Foundry did not change: Handouts (writes). Check the module settings.')
  ).toBeVisible();
  await expect(block.locator('#btn-ready')).toBeEnabled();

  await block.locator('#btn-ready').click();
  await expect(page.getByText('✗ Ready for session: The bridge is not connected.')).toBeVisible();
});

test('GM Actions follow the stream, and a failed read shows in the note', async ({ page }) => {
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: true } }]);
  await fakeReady(page, {
    switches: null,
    gmActionsEnabled: false,
    error: 'Foundry is not connected.',
  });
  const block = await openReady(page);

  await expect(chips(block)).toHaveText(['✓ GM Actions']);
  await expect(block.locator('#ready-note')).toHaveText(
    'Could not read the switches: Foundry is not connected.'
  );
  // GM Actions on is enough to offer turning off.
  await expect(block.locator('#btn-ready-off')).toBeVisible();
});

test('Start the session log starts it and then hides', async ({ page }) => {
  await fakeStream(page, []);
  let open = false;
  const fakes = await fakeReady(
    page,
    { switches: switches(OFF), gmActionsEnabled: false, error: null },
    undefined,
    () => open
  );
  const block = await openReady(page);

  open = true;
  await block.locator('#btn-ready-log').click();
  await expect(page.getByText('✓ Play session started')).toBeVisible();
  await expect
    .poll(() => fakes.tools)
    .toContainEqual({ name: 'mark-play-session', args: { action: 'start' } });
  await expect(block.locator('#btn-ready-log')).toHaveCount(0);
});

test('the real route answers with the bridge down', async ({ page }) => {
  // Nothing faked but the stream and the pre-flight run: the dashboard's own switches route.
  await fakeStream(page, []);
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: false, checks: [], scan: null } })
  );
  const block = await openReady(page);
  await expect(chips(block)).toHaveText(['○ GM Actions']);
  await expect(block.locator('#btn-ready')).toBeEnabled();
});

test('while a change is out both buttons wait, and a double click sends once', async ({ page }) => {
  await fakeStream(page, []);
  const fakes = await fakeReady(page, {
    switches: switches(OFF),
    gmActionsEnabled: true,
    error: null,
  });
  // Hold the POST open until the test lets it go (registered last, so it answers first).
  let release: () => void = () => undefined;
  const held = new Promise<void>(resolve => (release = resolve));
  await page.route('**/api/session/switches', async (route, request: Request) => {
    if (request.method() !== 'POST') return route.fallback();
    fakes.posts.push(request.postDataJSON());
    await held;
    return route.fulfill({
      json: {
        ok: true,
        switches: switches(ON, { changed: ['writes', 'handouts'] }),
        gmActionsEnabled: true,
        gmActionsChanged: false,
      },
    });
  });
  const block = await openReady(page);

  // Two clicks in one task, before React re-renders the button as disabled.
  await block.locator('#btn-ready').evaluate((b: HTMLButtonElement) => {
    b.click();
    b.click();
  });
  await expect(block.locator('#btn-ready')).toBeDisabled();
  await expect(block.locator('#btn-ready-off')).toBeDisabled();
  await expect.poll(() => fakes.posts.length).toBe(1);

  release();
  await expect(
    page.getByText('✓ Ready for session. Turned on: Changes from the tool, Handouts (writes)')
  ).toBeVisible();
  await expect(block.locator('#btn-ready-off')).toBeEnabled();
  expect(fakes.posts).toEqual([{ action: 'ready' }]);
});
