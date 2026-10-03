// The context a take script gets: open the demo windows, switch OBS scenes, time
// named steps (steps.json) and save screenshots.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectConsoleErrors, measure, openWindow } from './browser.mjs';
import { CSS_SIZE, DEMO_WORLD, RESOLUTIONS } from './env.mjs';
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
  }

  async #open(sceneName, url) {
    const title = SCENES[sceneName];
    if (!title) throw new Error(`No OBS scene "${sceneName}" (see scenes.mjs).`);
    const { scale } = RESOLUTIONS[this.res];
    const win = await openWindow({ title, url, css: CSS_SIZE, scale, fullscreen: true });
    const size = await measure(win.page);
    if (
      size.width !== CSS_SIZE.width ||
      size.height !== CSS_SIZE.height ||
      Math.abs(size.dpr - scale) > 0.01
    ) {
      console.warn(
        `${title}: page is ${size.width}x${size.height} at ${size.dpr}x, wanted ${CSS_SIZE.width}x${CSS_SIZE.height} at ${scale}x.`
      );
    }
    const entry = { ...win, errors: collectConsoleErrors(win.page) };
    this.windows[sceneName] = entry;
    return entry;
  }

  // Once a window shows its page (and so its pinned title), OBS can find and crop it.
  async #crop(sceneName) {
    if (this.obs) await cropToPage(this.obs, sceneName, this.res);
  }

  /** A Foundry window joined as a user ("Foundry" for the GM, "Foundry player" for a player). */
  async foundry(sceneName, { user, password = '' }) {
    const win = await this.#open(sceneName, `${this.env.foundryUrl}/join`);
    await joinFoundry(win.page, {
      foundryUrl: this.env.foundryUrl,
      world: DEMO_WORLD,
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

  /** The players' /player page. */
  async playerPage() {
    const win = await this.#open('Player page', `${this.env.dashboardUrl}/player`);
    await win.page.waitForLoadState('networkidle');
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
