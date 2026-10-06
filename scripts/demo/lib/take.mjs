// The context a take script gets: open the demo windows, switch OBS scenes, time
// named steps (steps.json) and save screenshots.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectConsoleErrors, markFocus, measure, openWindow, setFocusSink } from './browser.mjs';
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
    /** @type {{step: string, title: string, start: number, end: number, focus?: {x: number, y: number, w: number, h: number, at: number}}[]} */
    this.steps = [];
    /** @type {string[]} */
    this.shots = [];
    this.t0 = 0;
    /** True from markStart until the recording stops. */
    this.recording = false;
    /** The scene on air (the window OBS records). */
    this.activeScene = null;
    /** @type {{x: number, y: number, w: number, h: number, at: number} | null} the current step's focus box */
    this.focusBox = null;
    this.focusExplicit = false;
    /** @type {{path: string, at: number, width: number, height: number}[]} shots to cut from the video */
    this.pendingShots = [];
    setFocusSink((page, box, explicit) => this.#noteFocus(page, box, explicit));
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
    this.activeScene = sceneName;
    return win;
  }

  /**
   * Remember the element a helper worked on as the step's focus box (fractions of the recorded
   * frame, and when, in seconds from the recording start). The last automatic mark in a step
   * wins; an explicit one (t.focus) wins over all automatic ones. Only the window on air counts.
   */
  #noteFocus(page, box, explicit) {
    if (!this.recording || !this.#inStep) return;
    const sceneName = this.activeScene;
    const win = sceneName ? this.windows[sceneName] : null;
    if (!win || win.page !== page) return;
    if (this.focusExplicit && !explicit) return;
    const { width, height } = win.css;
    const r = v => Math.round(v * 10000) / 10000;
    const x = Math.min(1, Math.max(0, box.x / width));
    const y = Math.min(1, Math.max(0, box.y / height));
    this.focusBox = {
      x: r(x),
      y: r(y),
      w: r(Math.min(1 - x, box.width / width)),
      h: r(Math.min(1 - y, box.height / height)),
      at: this.#now(),
    };
    if (explicit) this.focusExplicit = true;
  }

  /** Mark an element as the zoom focus of the current step (see markFocus in browser.mjs). */
  focus(locator) {
    return markFocus(locator);
  }

  /** Mark the recording start; step times count from here. */
  markStart() {
    this.t0 = performance.now();
    this.recording = true;
  }

  /** The recording has stopped: shots go back to being real screenshots. */
  markStop() {
    this.recording = false;
  }

  #now() {
    return Math.round((performance.now() - this.t0) / 10) / 100;
  }

  /** A named step: its start and end go into steps.json (for captions and narration). */
  #inStep = false;

  async step(step, title, fn) {
    const start = this.#now();
    console.log(`  ${start.toFixed(1).padStart(6)}s  ${step}: ${title}`);
    this.focusBox = null;
    this.focusExplicit = false;
    this.#inStep = true;
    try {
      await fn();
    } finally {
      this.#inStep = false;
    }
    this.steps.push({
      step,
      title,
      start,
      end: this.#now(),
      ...(this.focusBox ? { focus: this.focusBox } : {}),
    });
  }

  pause(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Save a screenshot at 1920x1080 (CSS pixels) into the take's shots folder.
   *
   * Not while the window on air is being recorded: page.screenshot with scale "css" makes
   * Chromium draw the page at 1x for a few frames, and OBS records the page in the top-left
   * quarter of the frame (found in the GM video's raw takes: one glitch per shot). The shot is
   * then cut from the recording afterwards (extractShots).
   */
  async shot(sceneName, name) {
    const win = this.windows[sceneName];
    const dir = join(this.outDir, 'shots');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${name}.png`);
    if (this.obs && this.recording && sceneName === this.activeScene) {
      this.pendingShots.push({
        path,
        at: this.#now(),
        width: win.css.width,
        height: win.css.height,
      });
    } else {
      await win.page.screenshot({ path, scale: 'css' });
    }
    this.shots.push(path);
  }

  /** Cut the shots taken during the recording out of the video (needs ffmpeg on PATH). */
  extractShots(video) {
    for (const s of this.pendingShots) {
      const r = spawnSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-ss',
          String(s.at),
          '-i',
          video,
          '-frames:v',
          '1',
          '-vf',
          `scale=${s.width}:${s.height}:flags=lanczos`,
          s.path,
        ],
        { encoding: 'utf8' }
      );
      if (r.status !== 0 || !existsSync(s.path)) {
        console.warn(
          `Could not cut ${s.path} from the video (ffmpeg on PATH?): ${r.stderr || r.error}`
        );
        this.shots = this.shots.filter(p => p !== s.path);
      }
    }
    this.pendingShots = [];
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
