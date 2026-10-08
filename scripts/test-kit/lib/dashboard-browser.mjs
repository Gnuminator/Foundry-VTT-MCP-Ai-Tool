/**
 * Dashboard pages for a scenario (slice 4), the `t.browser` of the contract (KitBrowser).
 *
 * Pages open as tabs in the GM's Edge context (so Foundry and the dashboard share one browser), or with
 * `fresh: true` in a separate throwaway headless Edge with no cookies (the login split pass), launched
 * at most once per scenario. Every console error and page error of these pages is recorded with the
 * page kind ('dashboard', or 'player' for a path starting with /player) into the scenario's own list and
 * into the run's sink, which ends up in the report, except for a page opened with `expectErrors` (one the
 * scenario expects to fail, such as the GM page with no token): its errors stay in its own list, for the
 * scenario to check and attach. `close()` closes what this module opened and never the GM context or the
 * GM page.
 */
import { launchBrowser } from './gm.mjs';

/**
 * @typedef {import('./contract.mjs').KitBrowser} KitBrowser
 * @typedef {import('./console-errors.mjs').RawConsoleError} RawConsoleError
 */

/**
 * Takes a dashboard token out of a console line: a failed request names its URL, and the login split
 * pass opens pages with `?token=`. The report must never carry a token, even a test one.
 * @param {string} text
 */
export function redact(text) {
  return String(text ?? '').replace(/([?&](?:token|cogm_token)=)[^&#\s"']+/gi, '$1<token>');
}

/** @param {string | undefined} url */
function isApi(url) {
  try {
    return new URL(String(url)).pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/**
 * One line for a failed dashboard API request: status, method, path, the tool it named (never its
 * arguments) and the error the server sent, so the report says which tool failed and why.
 * @param {import('playwright-core').Response} res
 */
export async function describeFailed(res) {
  const req = res.request();
  let tool = '';
  try {
    const name = JSON.parse(req.postData() ?? '{}')?.name;
    if (typeof name === 'string') tool = ` ${name}`;
  } catch {
    // not JSON
  }
  let error = '';
  try {
    const body = await res.text();
    try {
      const parsed = JSON.parse(body);
      error = String(parsed?.error ?? body);
    } catch {
      error = body;
    }
  } catch {
    // the body is gone (the page navigated)
  }
  const path = new URL(res.url()).pathname;
  const said = error ? `: ${error.replace(/\s+/g, ' ').slice(0, 200)}` : '';
  return `HTTP ${res.status()} ${req.method()} ${path}${tool}${said}`;
}

/**
 * @param {{
 *   dashboardUrl: string,
 *   context: import('playwright-core').BrowserContext,
 *   launchFresh?: typeof launchBrowser,
 *   scenarioId: string,
 *   sink: RawConsoleError[]
 * }} p
 * @returns {{browser: KitBrowser, close: () => Promise<void>}}
 */
export function createKitBrowser({
  dashboardUrl,
  context,
  launchFresh = launchBrowser,
  scenarioId,
  sink,
}) {
  const base = String(dashboardUrl).replace(/\/+$/, '');
  /** @type {Array<import('playwright-core').Page>} */
  const opened = [];
  /** @type {Map<import('playwright-core').Page, Array<{at: string, message: string, source: string, page: string}>>} */
  const perPage = new Map();
  /** @type {Promise<{context: import('playwright-core').BrowserContext, close: () => Promise<void>}> | null} */
  let freshBrowser = null;

  /**
   * @param {import('playwright-core').Page} page
   * @param {string} kind
   * @param {boolean} toSink
   */
  function listen(page, kind, toSink) {
    /** @type {Array<{at: string, message: string, source: string, page: string}>} */
    const own = [];
    perPage.set(page, own);
    /** @param {string} message @param {string} source */
    const record = (message, source) => {
      const entry = {
        at: new Date().toISOString(),
        message: redact(message),
        source: redact(source),
        page: kind,
      };
      own.push(entry);
      if (toSink) sink.push({ ...entry, scenario: scenarioId });
    };
    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      const loc = msg.location();
      // A failed /api/ request is recorded by the response listener with its tool and error instead.
      if (/^Failed to load resource/.test(msg.text()) && isApi(loc?.url)) return;
      record(msg.text(), loc?.url ? `${loc.url}:${loc.lineNumber ?? 0}` : 'console');
    });
    page.on('response', async res => {
      if (res.status() < 400 || !isApi(res.url())) return;
      record(await describeFailed(res), 'response');
    });
    page.on('pageerror', err => {
      record(String(/** @type {any} */ (err)?.stack || err), 'pageerror');
    });
  }

  /** @type {KitBrowser} */
  const browser = {
    dashboardUrl: base,
    async open(path = '/', opts = {}) {
      const { fresh = false, viewport, expectErrors = false } = opts;
      let ctx = context;
      if (fresh) {
        freshBrowser ??= launchFresh({ headless: true });
        ctx = (await freshBrowser).context;
      }
      const page = await ctx.newPage();
      opened.push(page);
      if (viewport) await page.setViewportSize(viewport);
      const rel = path.startsWith('/') ? path : `/${path}`;
      listen(page, rel.startsWith('/player') ? 'player' : 'dashboard', !expectErrors);
      await page.goto(`${base}${rel}`, { waitUntil: 'load' });
      return page;
    },
    consoleErrors(page) {
      const lists = page ? [perPage.get(page) ?? []] : [...perPage.values()];
      return lists
        .flat()
        .map(e => ({ ...e }))
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    },
  };

  async function close() {
    for (const page of opened.splice(0)) {
      await page.close().catch(() => {});
    }
    if (freshBrowser) {
      const pending = freshBrowser;
      freshBrowser = null;
      try {
        await (await pending).close();
      } catch {
        // already gone
      }
    }
  }

  return { browser, close };
}
