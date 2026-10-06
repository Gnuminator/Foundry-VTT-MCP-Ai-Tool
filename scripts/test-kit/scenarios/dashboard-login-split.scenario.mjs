/**
 * The login split in a real browser (slice 4). The test dashboard is restarted with a GM token and a
 * player token (random, made now, never written anywhere), then a fresh Edge with no cookies checks:
 *   - the GM page with no token gets no data (every API call is refused, nothing of the world shows),
 *   - /player with the player token loads and carries none of the GM controls, and the GM API
 *     refuses the player token,
 *   - the GM page with the GM token loads and shows the GM header.
 * Then the dashboard goes back to its normal mode and answers without a token again. The restart back is
 * registered first, so a failed check never leaves the split on.
 *
 * What the app does today (public/app.js, src/app.ts): the page shell is a static file and loads for
 * anyone; the login is enforced on the API (/api/state, /api/stream, /api/tool, ... answer 401 without a
 * token), so a GM page with no token stays disconnected and empty. A real browser is needed, so this
 * scenario is skipped against the fake.
 */
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restartDashboard, portOfUrl } from '../lib/dashboard-proc.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VIEWPORT = { width: 1440, height: 900 };

/** @type {import('../lib/contract.mjs').Scenario} */
export default {
  id: 'dashboard-login-split',
  title: 'The login split in a real browser: no token gets nothing, the player page has no GM controls, the GM token works',
  sizes: ['full', 'long'],
  tags: ['dashboard', 'player'],
  needs: [],
  tools: [],
  order: 1000,
  timeoutMs: 300000,

  async run(t) {
    if (!t.browser) {
      await t.step('needs a real browser', async () =>
        t.skip('needs a real browser (t.browser is null against the fake)')
      );
      return;
    }
    const browser = t.browser;
    const base = browser.dashboardUrl;
    const port = portOfUrl(base);

    const gmToken = randomBytes(24).toString('hex');
    const playerToken = randomBytes(24).toString('hex');
    /** Text that may carry a token (a Playwright error names the URL) with the tokens taken out. @param {string} text */
    const scrub = text =>
      String(text).split(gmToken).join('<gm-token>').split(playerToken).join('<player-token>');
    /** Runs a step body so that an error never carries a token into the report. @template T @param {() => Promise<T>} fn */
    const guard = async fn => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof Error) e.message = scrub(e.message);
        throw e;
      }
    };

    /** @param {string} p @param {{method?: string, token?: string, body?: unknown}} [o] */
    const call = async (p, { method = 'GET', token, body } = {}) => {
      const res = await fetch(base + p, {
        method,
        headers: {
          ...(token ? { 'X-CoGM-Token': token } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        /* not JSON */
      }
      return { status: res.status, data };
    };

    /** GM Actions are in the dashboard's memory only: a restart switches them off, so put them back. */
    const before = await t.http('/api/tools');
    const gmActionsBefore = before.status === 200 && before.data?.gmActionsEnabled === true;

    let restored = false;
    const restoreNormal = async () => {
      if (restored) return;
      await restartDashboard(null, { repoRoot, port });
      restored = true;
      // The bridge link comes back a moment after the dashboard; wait for it, quietly.
      for (let i = 0; i < 30; i++) {
        const h = await call('/api/health').catch(() => null);
        if (h && h.data && h.data.controlChannel === 'connected') break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (gmActionsBefore) {
        await t.http('/api/control', {
          method: 'POST',
          body: { action: 'set-gm-actions', value: true },
        });
      }
    };
    // First, so it runs last: whatever fails below, the dashboard ends in its normal mode.
    t.cleanup(restoreNormal);

    /** @param {import('playwright-core').Page} page @param {string} name */
    const shot = async (page, name) => {
      try {
        t.attachFile(name, await page.screenshot({ fullPage: false }));
      } catch {
        /* the page is gone; the step has already said why */
      }
    };

    await t.step('restart the test dashboard with a GM token and a player token', () =>
      guard(async () => {
        const health = await call('/api/health');
        t.check(health.status === 200, 'the dashboard answers before the restart');
        await restartDashboard({ gmToken, playerToken }, { repoRoot, port });
        const after = await call('/api/health');
        t.check(after.status === 200, 'the dashboard answers after the restart');
        t.check(after.data && after.data.splitEnabled === true, 'the split is on', after.data);
        return 'split on';
      })
    );

    await t.step('the GM page with no token gets nothing', () =>
      guard(async () => {
        // The API says no, for a plain request and for the page's own request.
        for (const [p, method, body] of /** @type {const} */ ([
          ['/api/state', 'GET', undefined],
          ['/api/tools', 'GET', undefined],
          ['/api/tool', 'POST', { name: 'get-world-info', args: {} }],
          ['/api/control', 'POST', { action: 'kit-split-check' }],
        ])) {
          const r = await call(p, { method, body });
          t.check(r.status === 401 || r.status === 403, `${method} ${p} with no token answers ${r.status}`);
        }
        const page = await browser.open('/', { fresh: true, viewport: VIEWPORT });
        // Give the page time to try its stream and its state calls.
        await page.waitForTimeout(4000);
        const seen = await page.evaluate(async () => {
          const res = await fetch('/api/state');
          return {
            apiStatus: res.status,
            bridge: document.querySelector('#status-bridge')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
            subtitle: document.querySelector('#world-subtitle')?.textContent?.trim() ?? '',
          };
        });
        await shot(page, 'gm-page-no-token.png');
        t.check(seen.apiStatus === 401, `the page's own /api/state call answers ${seen.apiStatus}`);
        t.check(!/Bridge: connected/.test(seen.bridge), `the page shows "${seen.bridge}" without a token`);
        t.check(
          !/Foundry \d/.test(seen.subtitle),
          `the page shows no world without a token ("${seen.subtitle}")`
        );
        return `API 401, page says "${seen.bridge}"`;
      })
    );

    await t.step('/player with the player token has no GM controls and the GM API refuses the token', () =>
      guard(async () => {
        const noToken = await call('/api/player/state');
        t.check(noToken.status === 401, `/api/player/state with no token answers ${noToken.status}`);
        const state = await call('/api/player/state', { token: playerToken });
        t.check(state.status === 200, `/api/player/state with the player token answers ${state.status}`);
        // The GM surface refuses the player token: reads and writes alike.
        for (const [p, method, body] of /** @type {const} */ ([
          ['/api/tools', 'GET', undefined],
          ['/api/tool', 'POST', { name: 'get-world-info', args: {} }],
          ['/api/control', 'POST', { action: 'kit-split-check' }],
          ['/api/player-links', 'GET', undefined],
        ])) {
          const r = await call(p, { method, token: playerToken, body });
          t.check(
            r.status === 401 || r.status === 403,
            `${method} ${p} with the player token answers ${r.status}`
          );
        }
        const page = await browser.open(`/player?token=${playerToken}`, {
          fresh: true,
          viewport: VIEWPORT,
        });
        await page.waitForTimeout(3000);
        const gmControls = await page.locator('[data-track^="dash."]').count();
        const gmButton = await page.locator('#btn-gm').count();
        const text = await page.evaluate(() => document.body.innerText);
        await shot(page, 'player-page-player-token.png');
        t.equal(gmControls, 0, 'GM controls (data-track "dash.*") on the player page');
        t.equal(gmButton, 0, 'the GM Actions button on the player page');
        t.check(!/GM Actions/i.test(text), 'the player page text names GM Actions');
        t.check(
          browser.consoleErrors(page).length === 0,
          'the player page logs no console errors',
          browser.consoleErrors(page).map(e => scrub(e.message).slice(0, 200))
        );
        return 'player page clean, GM API refused';
      })
    );

    await t.step('the GM page with the GM token loads and shows the GM header', () =>
      guard(async () => {
        const gmApi = await call('/api/tools', { token: gmToken });
        t.check(gmApi.status === 200, `/api/tools with the GM token answers ${gmApi.status}`);
        const page = await browser.open(`/?token=${gmToken}`, { fresh: true, viewport: VIEWPORT });
        await page.locator('#btn-gm').waitFor({ state: 'visible', timeout: 15000 });
        await page
          .waitForFunction(
            () => /Bridge: connected/.test(document.querySelector('#status-bridge')?.textContent ?? ''),
            undefined,
            { timeout: 30000 }
          )
          .catch(() => {
            /* checked below, with what the page says */
          });
        const seen = await page.evaluate(() => ({
          bridge: document.querySelector('#status-bridge')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          gm: document.querySelector('#btn-gm')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          controls: document.querySelectorAll('[data-track^="dash."]').length,
        }));
        const url = new URL(page.url());
        await shot(page, 'gm-page-gm-token.png');
        t.check(/GM Actions/.test(seen.gm), `the GM header shows the GM Actions button ("${seen.gm}")`);
        t.check(seen.controls > 10, `the GM page has its controls (${seen.controls} found)`);
        t.check(/Bridge: connected/.test(seen.bridge), `the page says "${seen.bridge}" with the GM token`);
        t.check(!url.searchParams.has('token'), 'the token is taken out of the address bar');
        t.check(
          browser.consoleErrors(page).length === 0,
          'the GM page logs no console errors',
          browser.consoleErrors(page).map(e => scrub(e.message).slice(0, 200))
        );
        return `${seen.controls} controls, ${seen.bridge}`;
      })
    );

    await t.step('restore the normal mode: the dashboard answers with no token again', () =>
      guard(async () => {
        await restoreNormal();
        const health = await call('/api/health');
        t.check(health.status === 200, `/api/health answers ${health.status}`);
        t.check(health.data && health.data.splitEnabled === false, 'the split is off', health.data);
        const state = await call('/api/state');
        t.check(state.status === 200, `/api/state with no token answers ${state.status}`);
        const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(20000) });
        t.check(res.status === 200, `/ answers ${res.status} with no token`);
        return 'normal mode';
      })
    );
  },
};
