/**
 * Join page look (I-086): The Veil goes on as one marked style line plus the background, the
 * GM's description text is never changed, and the stylesheet only touches the join page.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  VEIL_BACKGROUND,
  VEIL_STYLESHEET,
  VEIL_STYLE_LINE,
  applyJoinLook,
  createJoinPageMenu,
  currentWorld,
  hasVeilLook,
  joinPageDialogHtml,
  lostFromReply,
  planJoinPage,
  stripJoinStyle,
  type JoinPageDeps,
  type WorldJoinFields,
} from './join-page.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';

const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const g = globalThis as any;

const DESCRIPTION = '<p>Welcome to <strong>Barovia</strong>.</p>';

describe('planJoinPage', () => {
  it('puts the style line on top of the description and sets The Veil picture', () => {
    const change = planJoinPage({ id: 'strahd', description: DESCRIPTION }, 'veil');
    expect(change).toEqual({
      action: 'editWorld',
      id: 'strahd',
      description: `${VEIL_STYLE_LINE}\n${DESCRIPTION}`,
      background: VEIL_BACKGROUND,
    });
  });

  it('applies twice without adding a second line', () => {
    const once = planJoinPage({ id: 'w', description: DESCRIPTION }, 'veil');
    const twice = planJoinPage({ id: 'w', description: once.description }, 'veil');
    expect(twice.description).toBe(once.description);
  });

  it('keeps the current background when the GM unticks the picture', () => {
    const change = planJoinPage(
      { id: 'w', description: '', background: 'worlds/w/cover.webp' },
      'veil',
      { useBackground: false }
    );
    expect(change).not.toHaveProperty('background');
    expect(change.description).toBe(`${VEIL_STYLE_LINE}\n`);
  });

  it('switches a Minimal join page back to the default theme (Minimal hides the description)', () => {
    expect(planJoinPage({ id: 'w', joinTheme: 'minimal' }, 'veil').joinTheme).toBe('default');
    expect(planJoinPage({ id: 'w' }, 'veil')).not.toHaveProperty('joinTheme');
  });

  it("goes back to Foundry's look: the line removed, the GM's text and picture kept", () => {
    const veiled = planJoinPage({ id: 'w', description: DESCRIPTION }, 'veil');
    const back = planJoinPage(
      { id: 'w', description: veiled.description, background: VEIL_BACKGROUND },
      'default'
    );
    expect(back).toEqual({
      action: 'editWorld',
      id: 'w',
      description: DESCRIPTION,
      background: null,
    });
    const own = planJoinPage(
      { id: 'w', description: veiled.description, background: 'worlds/w/cover.webp' },
      'default'
    );
    expect(own).not.toHaveProperty('background');
  });

  it('removes any marked line, also from another look or an older version', () => {
    const text = `<style data-ai-tool-join="old">@import url("x.css");</style>\n${DESCRIPTION}<style data-ai-tool-join>p{}</style>`;
    expect(stripJoinStyle(text)).toBe(DESCRIPTION);
    expect(stripJoinStyle('<style>p{color:red}</style>')).toBe('<style>p{color:red}</style>');
    expect(stripJoinStyle(null)).toBe('');
  });

  it('points at files inside this module, relative to the server root', () => {
    expect(VEIL_STYLESHEET).toBe('modules/foundry-mcp-bridge/styles/join/veil.css');
    expect(VEIL_BACKGROUND).toBe('modules/foundry-mcp-bridge/styles/join/veil-background.svg');
    expect(VEIL_STYLE_LINE).toContain(`@import url("${VEIL_STYLESHEET}")`);
  });
});

describe('applyJoinLook', () => {
  function fakeDeps(
    world: WorldJoinFields,
    reply: unknown
  ): JoinPageDeps & {
    sent: unknown[];
    saved: unknown[];
    info: string[];
    errors: string[];
  } {
    const deps = {
      sent: [] as unknown[],
      saved: [] as unknown[],
      info: [] as string[],
      errors: [] as string[],
      world: (): WorldJoinFields => world,
      submit: async (change: unknown): Promise<unknown> => {
        deps.sent.push(change);
        if (reply instanceof Error) throw reply;
        return reply;
      },
      updateWorld: (saved: unknown): void => void deps.saved.push(saved),
      notifyInfo: (m: string): void => void deps.info.push(m),
      notifyError: (m: string): void => void deps.errors.push(m),
    };
    return deps;
  }

  it('saves the change through /setup and updates the loaded world', async () => {
    const saved = { id: 'w', description: `${VEIL_STYLE_LINE}\n`, background: VEIL_BACKGROUND };
    const deps = fakeDeps({ id: 'w', description: '' }, saved);
    expect(await applyJoinLook('veil', {}, deps)).toBe(true);
    expect(deps.sent).toEqual([planJoinPage({ id: 'w', description: '' }, 'veil')]);
    expect(deps.saved).toEqual([saved]);
    expect(deps.info[0]).toContain('The Veil is on the join page');
    expect(deps.errors).toEqual([]);
  });

  it("reports Foundry's error and leaves the loaded world alone", async () => {
    const deps = fakeDeps({ id: 'w' }, { error: 'The request could not be processed.' });
    expect(await applyJoinLook('veil', {}, deps)).toBe(false);
    expect(deps.saved).toEqual([]);
    expect(deps.errors[0]).toBe(
      'The join page look was not saved: The request could not be processed.'
    );
  });

  it('reports a failed request', async () => {
    const deps = fakeDeps({ id: 'w' }, new Error('offline'));
    expect(await applyJoinLook('default', {}, deps)).toBe(false);
    expect(deps.errors[0]).toBe('The join page look was not saved: offline');
  });

  it('reports a style line Foundry removed, and still syncs the loaded world', async () => {
    const reply = { id: 'w', description: '', background: VEIL_BACKGROUND };
    const deps = fakeDeps({ id: 'w', description: '' }, reply);
    expect(await applyJoinLook('veil', {}, deps)).toBe(false);
    expect(deps.saved).toEqual([reply]);
    expect(deps.info).toEqual([]);
    expect(deps.errors[0]).toBe(
      'The join page look was not saved: Foundry did not keep the style line in the description (Foundry removed it).'
    );
  });

  it('reports a background Foundry did not keep', async () => {
    const reply = { id: 'w', description: `${VEIL_STYLE_LINE}\n`, background: null };
    const deps = fakeDeps({ id: 'w', description: '' }, reply);
    expect(await applyJoinLook('veil', {}, deps)).toBe(false);
    expect(deps.errors[0]).toContain('did not keep the background picture');
  });
});

describe('lostFromReply', () => {
  it("accepts tidied HTML and the system's picture after a cleared background", () => {
    const veil = planJoinPage({ id: 'w', description: DESCRIPTION }, 'veil');
    const tidied = {
      id: 'w',
      description: `${VEIL_STYLE_LINE}<p>Welcome to <strong>Barovia</strong>.</p>`,
      background: `/${VEIL_BACKGROUND}`,
    };
    expect(lostFromReply(veil, tidied)).toBeNull();
    const back = planJoinPage(
      { id: 'w', description: `${VEIL_STYLE_LINE}\n`, background: VEIL_BACKGROUND },
      'default'
    );
    expect(back.background).toBeNull();
    const reply = { id: 'w', description: '', background: 'systems/dnd5e/ui/official/banner.webp' };
    expect(lostFromReply(back, reply)).toBeNull();
  });

  it('names a style line that is still there after Back', () => {
    const back = planJoinPage({ id: 'w', description: `${VEIL_STYLE_LINE}\n` }, 'default');
    expect(lostFromReply(back, { id: 'w', description: `${VEIL_STYLE_LINE}\n` })).toBe(
      'the description without the style line'
    );
  });
});

describe('joinPageDialogHtml', () => {
  it('says whether the look is on and ticks the picture by default', () => {
    const off = joinPageDialogHtml({ id: 'w', description: DESCRIPTION });
    expect(off).toContain("Foundry's own look now");
    expect(off).toContain('name="useBackground" checked');
    const on = joinPageDialogHtml({ id: 'w', description: `${VEIL_STYLE_LINE}\n` });
    expect(hasVeilLook({ id: 'w', description: `${VEIL_STYLE_LINE}\n` })).toBe(true);
    expect(on).toContain('The Veil is on the join page now');
  });

  it("leaves the GM's own picture unticked and names it, escaped", () => {
    const html = joinPageDialogHtml({ id: 'w', background: 'worlds/w/<cover>.webp' });
    expect(html).toContain('name="useBackground">');
    expect(html).toContain('worlds/w/&lt;cover&gt;.webp');
  });
});

describe('createJoinPageMenu', () => {
  let testWorld: TestWorld;
  let restore: () => void;
  let options: Record<string, any> | undefined;

  beforeEach(() => {
    testWorld = createTestWorld();
    restore = testWorld.install();
    options = undefined;
    g.foundry.applications = {
      api: {
        DialogV2: class {
          constructor(o: Record<string, any>) {
            options = o;
          }
        },
      },
    };
    g.foundry.utils.getRoute = (path: string): string => `/${path}`;
  });

  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  function worldWith(fields: Partial<WorldJoinFields>): Record<string, unknown> {
    const world = { ...g.game.world, ...fields, updateSource: vi.fn() };
    g.game.world = world;
    return world;
  }

  it('offers Apply and Cancel, and Back only when the look is on', () => {
    worldWith({ description: DESCRIPTION, background: null });
    const Menu = createJoinPageMenu();
    new Menu();
    expect(options?.buttons.map((b: { action: string }) => b.action)).toEqual(['veil', 'cancel']);
    expect(options?.window.title).toBe('Join page look');

    worldWith({ description: `${VEIL_STYLE_LINE}\n`, background: VEIL_BACKGROUND });
    new Menu();
    expect(options?.buttons.map((b: { action: string }) => b.action)).toEqual([
      'veil',
      'default',
      'cancel',
    ]);
  });

  it('Apply posts editWorld to /setup with the checkbox choice', async () => {
    const world = worldWith({ id: 'w', description: DESCRIPTION, background: null });
    const saved = { id: 'w', description: `${VEIL_STYLE_LINE}\n${DESCRIPTION}` };
    // Foundry answers 401 when the server has an admin password, and still saves.
    const fetchMock = vi.fn().mockResolvedValue({ status: 401, json: async () => saved });
    vi.stubGlobal('fetch', fetchMock);
    const Menu = createJoinPageMenu();
    new Menu();
    const box = { checked: false };
    const button = { form: { elements: { namedItem: (): { checked: boolean } => box } } };
    await options?.buttons[0].callback(new Event('click'), button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/setup');
    expect(JSON.parse(init.body as string)).toEqual({
      action: 'editWorld',
      id: 'w',
      description: `${VEIL_STYLE_LINE}\n${DESCRIPTION}`,
    });
    expect(world.updateSource).toHaveBeenCalledWith(saved);
    expect(testWorld.notifications.filter(n => n.level === 'error')).toEqual([]);
  });

  it('reports a reply that is not JSON with its status', async () => {
    const world = worldWith({ id: 'w', description: DESCRIPTION, background: null });
    const fetchMock = vi.fn().mockResolvedValue({
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const Menu = createJoinPageMenu();
    new Menu();
    await options?.buttons[0].callback(new Event('click'), { form: null });
    expect(world.updateSource).not.toHaveBeenCalled();
    expect(testWorld.notifications).toContainEqual({
      level: 'error',
      message: 'The join page look was not saved: Foundry answered 500 Internal Server Error',
    });
  });

  it("treats the system's picture as no background of the world's own", () => {
    const banner = 'systems/dnd5e/ui/official/banner.webp';
    g.game.system = { ...g.game.system, background: banner };
    worldWith({ description: DESCRIPTION, background: banner });
    expect(currentWorld().background).toBeNull();
    new (createJoinPageMenu())();
    expect(options?.content).toContain('name="useBackground" checked');
    expect(options?.buttons.map((b: { action: string }) => b.action)).toEqual(['veil', 'cancel']);
    worldWith({ background: 'worlds/w/cover.webp' });
    expect(currentWorld().background).toBe('worlds/w/cover.webp');
  });
});

describe('the join page files', () => {
  const css = readFileSync(join(MODULE_ROOT, 'styles/join/veil.css'), 'utf8');

  it('ships the stylesheet, the picture and every font it names', () => {
    expect(existsSync(join(MODULE_ROOT, 'styles/join/veil-background.svg'))).toBe(true);
    const fonts = [...css.matchAll(/url\('([^']+)'\)/g)].map(m => m[1]);
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts)
      expect(existsSync(join(MODULE_ROOT, 'styles/join', font)), font).toBe(true);
    expect(existsSync(join(MODULE_ROOT, 'styles/join/fonts/OFL-Gloock.txt'))).toBe(true);
    expect(existsSync(join(MODULE_ROOT, 'styles/join/fonts/OFL-Spectral.txt'))).toBe(true);
  });

  it('styles only the join page (the setup screen shows the description too)', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\s*\{[^}]*\}/g, '');
    // After `}` or `{`, so the rules inside @media blocks are checked too.
    const selectors = [...body.matchAll(/(^|[{}])\s*([^{}@]+)\{/g)].map(m => m[2].trim());
    expect(selectors.length).toBeGreaterThan(5);
    const mediaAt = body.indexOf('@media');
    expect(selectors.some(s => body.lastIndexOf(s) > mediaAt)).toBe(true);
    for (const group of selectors) {
      for (const selector of group.split(/,(?![^(]*\))/))
        expect(selector.trim(), selector).toMatch(/^body\.join(?![\w-])/);
    }
  });

  it('is not loaded inside the game (module.json styles)', () => {
    const manifest = JSON.parse(readFileSync(join(MODULE_ROOT, 'module.json'), 'utf8'));
    expect(manifest.styles).not.toContain('styles/join/veil.css');
  });
});
