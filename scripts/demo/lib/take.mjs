// The context a take script gets: open the demo windows, switch OBS scenes, time
// named steps (steps.json) and save screenshots.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectConsoleErrors, measure, openWindow } from './browser.mjs';
import { CSS_SIZE, DEMO_USERS, RESOLUTIONS, demoWorld } from './env.mjs';
import { joinFoundry, waitForCanvasReady } from './foundry.mjs';
import { waitForDashboard } from './dashboard.mjs';
import { cropToPage } from './obs-setup.mjs';
import { SCENES } from './scenes.mjs';

export class Take {
  /**
   * @param {{name: string, outDir: string, res: number, env: ReturnType<import('./env.mjs').testEnv>, obs?: import('./obs.mjs').ObsClient}} o
   */
  constructor({ name, outDir, res, env, obs }) {
    this.name = name;
    this.outDir = outDir;
    this.res = res;
    this.env = env;
    this.obs = obs;
    /** @type {Record<string, {title: string, page: import('playwright-core').Page, close: () => Promise<void>, errors: any[]}>} scene name -> window */
    this.windows = {};
    /** @type {{step: string, title: string, start: number, end: number}[]} */
    this.steps = [];
    /** @type {string[]} */
    this.shots = [];
    this.t0 = 0;
    /** @type {typeof import('./index.mjs') | null} the kit's helpers, for takes kept outside the repo */
    this.lib = null;
  }

  /**
   * Open a scene's window. By default the page is 1920x1080 CSS pixels at the take's
   * scale; `css` and `scale` override that (a phone-sized page, for example).
   */
  async #open(sceneName, url, { css = CSS_SIZE, scale = RESOLUTIONS[this.res].scale } = {}) {
    const title = SCENES[sceneName];
    if (!title) throw new Error(`No OBS scene "${sceneName}" (see scenes.mjs).`);
    const win = await openWindow({ title, url, css, scale, fullscreen: true });
    const size = await measure(win.page);
    if (
      size.width !== css.width ||
      size.height !== css.height ||
      Math.abs(size.dpr - scale) > 0.01
    ) {
      console.warn(
        `${title}: page is ${size.width}x${size.height} at ${size.dpr}x, wanted ${css.width}x${css.height} at ${scale}x.`
      );
    }
    const entry = { ...win, errors: collectConsoleErrors(win.page), css, scale };
    this.windows[sceneName] = entry;
    return entry;
  }

  // Once a window shows its page (and so its pinned title), OBS can find and crop it.
  async #crop(sceneName) {
    if (!this.obs) return;
    const { css, scale } = this.windows[sceneName];
    const size = { width: Math.round(css.width * scale), height: Math.round(css.height * scale) };
    await cropToPage(this.obs, sceneName, this.res, 10000, size);
  }

  /** A Foundry window joined as a user ("Foundry" for the GM, "Foundry player" for a player). */
  async foundry(sceneName, { user, password = '' }) {
    const win = await this.#open(sceneName, `${this.env.foundryUrl}/join`);
    await joinFoundry(win.page, {
      foundryUrl: this.env.foundryUrl,
      world: demoWorld(),
      user,
      password,
    });
    await this.#crop(sceneName);
    return win;
  }

  /** The co-GM dashboard (local mode: every caller is GM). */
  async dashboard(path = '/') {
    const win = await this.#open('Dashboard', `${this.env.dashboardUrl}${path}`);
    await waitForDashboard(win.page);
    await this.#crop('Dashboard');
    return win;
  }

  /**
   * The players' /player page. On a first visit it asks "who are you"; `who` answers it
   * (a player's name, or null to skip).
   */
  async playerPage({ who = DEMO_USERS.player, css, scale } = {}) {
    const win = await this.#open('Player page', `${this.env.dashboardUrl}/player`, {
      ...(css ? { css } : {}),
      ...(scale ? { scale } : {}),
    });
    await win.page.locator('#handouts').waitFor();
    const picker = win.page.locator('#who-picker');
    // The question appears once the page knows the player names.
    await picker.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (await picker.isVisible()) {
      await win.page.locator('#who-list button.who-pick', { hasText: who ?? 'Skip' }).click();
      await picker.waitFor({ state: 'hidden' });
    }
    // Park the demo cursor off the page until the take moves it.
    await win.page.mouse.move(-40, -40);
    await this.#crop('Player page');
    return win;
  }

  /** Show a window on the recording: switch the OBS scene and bring the window forward. */
  async scene(sceneName) {
    const win = this.windows[sceneName];
    if (!win) throw new Error(`Window for scene "${sceneName}" is not open.`);
    await win.page.bringToFront();
    if (sceneName.startsWith('Foundry')) await waitForCanvasReady(win.page, 15000);
    if (this.obs) await this.obs.setScene(sceneName);
    return win;
  }

  /** Mark the recording start; step times count from here. */
  markStart() {
    this.t0 = performance.now();
  }

  #now() {
    return Math.round((performance.now() - this.t0) / 10) / 100;
  }

  /** A named step: its start and end go into steps.json (for captions and narration). */
  async step(step, title, fn) {
    const start = this.#now();
    console.log(`  ${start.toFixed(1).padStart(6)}s  ${step}: ${title}`);
    await fn();
    this.steps.push({ step, title, start, end: this.#now() });
  }

  pause(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /** Save a screenshot at 1920x1080 (CSS pixels) into the take's shots folder. */
  async shot(sceneName, name) {
    const win = this.windows[sceneName];
    const dir = join(this.outDir, 'shots');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${name}.png`);
    await win.page.screenshot({ path, scale: 'css' });
    this.shots.push(path);
  }

  /** Console errors per window, for take.json. */
  errors() {
    return Object.fromEntries(Object.entries(this.windows).map(([k, w]) => [k, w.errors]));
  }

  async closeAll() {
    for (const win of Object.values(this.windows)) await win.close().catch(() => {});
    this.windows = {};
  }
}
