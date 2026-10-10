/**
 * Join page look (I-086): The Veil goes on as one marked block plus the background, the GM's
 * description text is never changed, and the block survives the server's HTML cleaning.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFragment, serialize } from 'parse5';
import sanitizeHtml from 'sanitize-html';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_TAGLINE,
  VEIL_BACKGROUND,
  applyJoinLook,
  createJoinPageMenu,
  currentWorld,
  hasVeilLook,
  joinPageDialogHtml,
  lostFromReply,
  planJoinPage,
  stripJoinStyle,
  veilBlock,
  veilTagline,
  type JoinPageDeps,
  type WorldJoinFields,
} from './join-page.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';

const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const g = globalThis as any;

const DESCRIPTION = '<p>Welcome to <strong>Barovia</strong>.</p>';
const BLOCK = veilBlock(DEFAULT_TAGLINE);

/**
 * Foundry 14.368's `cleanHTML` (dist/database/validators.mjs), which `World.update` runs on the
 * description: parse5 round trip, then sanitize-html with the allowlist from
 * common/constants.mjs (copied here: the tags, the attributes for every tag, and the few tags
 * a description uses). The iframe and tooltip transforms are left out (not used here).
 */
const FOUNDRY_ALLOWED_TAGS = [
  'header', 'main', 'section', 'article', 'aside', 'nav', 'footer', 'div', 'address',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'br',
  'p', 'blockquote', 'summary', 'details', 'span', 'code', 'pre', 'a', 'label', 'abbr', 'cite',
  'mark', 'q', 'ruby', 'rp', 'rt', 'small', 'time', 'var', 'kbd', 'samp',
  'dfn', 'sub', 'sup', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins',
  'ol', 'ul', 'li', 'dl', 'dd', 'dt', 'menu',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'col', 'colgroup',
  'figure', 'figcaption', 'caption', 'img', 'picture', 'source',
]; // prettier-ignore
const FOUNDRY_ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  '*': [
    'class', 'data-*', 'id', 'title', 'style', 'draggable', 'aria-*', 'tabindex', 'dir', 'hidden',
    'inert', 'role', 'is', 'lang', 'popover', 'autocapitalize', 'autocorrect', 'autofocus',
    'contenteditable', 'spellcheck', 'translate',
  ],
  a: ['href', 'name', 'target', 'rel'],
  img: ['height', 'src', 'width', 'usemap', 'sizes', 'srcset', 'alt'],
}; // prettier-ignore

function foundryCleanHtml(html: string): string {
  return sanitizeHtml(serialize(parseFragment(html)), {
    allowedTags: FOUNDRY_ALLOWED_TAGS,
    allowedAttributes: FOUNDRY_ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'data', 'mailto', 'obsidian', 'syrinscape-online'],
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
  }).replace(/ \/>/g, '>');
}

describe('planJoinPage', () => {
  it('puts the block on top of the description and sets The Veil picture', () => {
    const change = planJoinPage({ id: 'strahd', description: DESCRIPTION }, 'veil');
    expect(change).toEqual({
      action: 'editWorld',
      id: 'strahd',
      description: `${BLOCK}\n${DESCRIPTION}`,
      background: VEIL_BACKGROUND,
    });
  });

  it('applies twice without a second block, and keeps the tagline the GM wrote', () => {
    const once = planJoinPage({ id: 'w', description: DESCRIPTION }, 'veil', {
      tagline: 'Night falls on the valley.',
    });
    const twice = planJoinPage({ id: 'w', description: once.description }, 'veil');
    expect(twice.description).toBe(once.description);
    expect(veilTagline(twice.description)).toBe('Night falls on the valley.');
  });

  it('escapes the tagline and falls back to the default when it is blank', () => {
    const change = planJoinPage({ id: 'w' }, 'veil', { tagline: '<b>Mist</b> & "fog"' });
    expect(change.description).toContain('&lt;b&gt;Mist&lt;/b&gt; &amp; "fog"');
    expect(veilTagline(change.description)).toBe('<b>Mist</b> & "fog"');
    const blank = planJoinPage({ id: 'w' }, 'veil', { tagline: '   ' });
    expect(veilTagline(blank.description)).toBe(DEFAULT_TAGLINE);
  });

  it('keeps the current background when the GM unticks the picture', () => {
    const change = planJoinPage(
      { id: 'w', description: '', background: 'worlds/w/cover.webp' },
      'veil',
      { useBackground: false }
    );
    expect(change).not.toHaveProperty('background');
    expect(change.description).toBe(`${BLOCK}\n`);
  });

  it('switches a Minimal join page back to the default theme (Minimal hides the description)', () => {
    expect(planJoinPage({ id: 'w', joinTheme: 'minimal' }, 'veil').joinTheme).toBe('default');
    expect(planJoinPage({ id: 'w' }, 'veil')).not.toHaveProperty('joinTheme');
  });

  it("goes back to Foundry's look: the block removed, the GM's text and picture kept", () => {
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

  it('removes any marked block, also another look or the old style line', () => {
    const text = `<style data-ai-tool-join="veil">@import url("x.css");</style>\n<div class="x" data-ai-tool-join="old"><p>a</p></div>${DESCRIPTION}<div data-ai-tool-join>b</div>`;
    expect(stripJoinStyle(text)).toBe(DESCRIPTION);
    expect(stripJoinStyle('<div class="note"><p>mine</p></div>')).toBe(
      '<div class="note"><p>mine</p></div>'
    );
    expect(stripJoinStyle(null)).toBe('');
  });

  it('points at the picture inside this module, relative to the server root', () => {
    expect(VEIL_BACKGROUND).toBe('modules/foundry-mcp-bridge/styles/join/veil-background.svg');
  });
});

describe('the Veil block', () => {
  it('uses inline styles and only fonts Foundry loads on the join page', () => {
    expect(BLOCK).toMatch(/^<div data-ai-tool-join="veil" style="[^"]+">/);
    expect(BLOCK).not.toMatch(/<style|<link|class=/);
    const fonts = [...BLOCK.matchAll(/font-family:([^;"]+)/g)].flatMap(m =>
      (m[1] ?? '').split(',').map(f => f.trim())
    );
    expect(fonts.length).toBeGreaterThan(0);
    // Amiri is in Foundry's setup CSS (public/css/foundry2.css); the rest are fallbacks.
    for (const font of fonts) expect(['Amiri', 'Georgia', 'serif']).toContain(font);
    // No nested div: the strip pattern ends the block at the first </div>.
    expect(BLOCK.match(/<div\b/g)).toHaveLength(1);
  });

  it("survives Foundry's HTML cleaning (cleanHTML) as it is", () => {
    const planned = planJoinPage({ id: 'w', description: DESCRIPTION }, 'veil', {
      tagline: 'Fog & "lanterns"',
    }).description;
    const saved = foundryCleanHtml(planned);
    expect(saved).toBe(planned);
    expect(
      lostFromReply(
        { action: 'editWorld', id: 'w', description: planned },
        {
          id: 'w',
          description: saved,
        }
      )
    ).toBeNull();
    expect(veilTagline(saved)).toBe('Fog & "lanterns"');
    expect(stripJoinStyle(saved)).toBe(foundryCleanHtml(DESCRIPTION));
  });

  it('is needed: the cleaning drops a <style> element (the old style line)', () => {
    const old = `<style data-ai-tool-join="veil">@import url("x.css");</style>\n${DESCRIPTION}`;
    expect(foundryCleanHtml(old)).not.toContain('<style');
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
    const saved = { id: 'w', description: `${BLOCK}\n`, background: VEIL_BACKGROUND };
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

  it('reports a block Foundry removed, and still syncs the loaded world', async () => {
    const reply = { id: 'w', description: '', background: VEIL_BACKGROUND };
    const deps = fakeDeps({ id: 'w', description: '' }, reply);
    expect(await applyJoinLook('veil', {}, deps)).toBe(false);
    expect(deps.saved).toEqual([reply]);
    expect(deps.info).toEqual([]);
    expect(deps.errors[0]).toBe(
      'The join page look was not saved: Foundry did not keep the look block in the description (Foundry removed it).'
    );
  });

  it('reports a block that lost its styles', async () => {
    const bare = `<div data-ai-tool-join="veil"><p>${DEFAULT_TAGLINE}</p></div>\n`;
    const deps = fakeDeps({ id: 'w', description: '' }, { id: 'w', description: bare });
    expect(await applyJoinLook('veil', { useBackground: false }, deps)).toBe(false);
    expect(deps.errors[0]).toContain('did not keep the colours of the look block');
  });

  it('reports a background Foundry did not keep', async () => {
    const reply = { id: 'w', description: `${BLOCK}\n`, background: null };
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
      description: `${BLOCK}<p>Welcome to <strong>Barovia</strong>.</p>`,
      background: `/${VEIL_BACKGROUND}`,
    };
    expect(lostFromReply(veil, tidied)).toBeNull();
    const back = planJoinPage(
      { id: 'w', description: `${BLOCK}\n`, background: VEIL_BACKGROUND },
      'default'
    );
    expect(back.background).toBeNull();
    const reply = { id: 'w', description: '', background: 'systems/dnd5e/ui/official/banner.webp' };
    expect(lostFromReply(back, reply)).toBeNull();
  });

  it('names a block that is still there after Back', () => {
    const back = planJoinPage({ id: 'w', description: `${BLOCK}\n` }, 'default');
    expect(lostFromReply(back, { id: 'w', description: `${BLOCK}\n` })).toBe(
      'the description without the look block'
    );
  });
});

describe('joinPageDialogHtml', () => {
  it('says whether the look is on and ticks the picture by default', () => {
    const off = joinPageDialogHtml({ id: 'w', description: DESCRIPTION });
    expect(off).toContain("Foundry's own look now");
    expect(off).toContain('name="useBackground" checked');
    expect(off).toContain(`name="tagline" maxlength="120" value="${DEFAULT_TAGLINE}"`);
    const on = joinPageDialogHtml({ id: 'w', description: `${BLOCK}\n` });
    expect(hasVeilLook({ id: 'w', description: `${BLOCK}\n` })).toBe(true);
    expect(on).toContain('The Veil is on the join page now');
  });

  it('fills in the current tagline, escaped', () => {
    const description = planJoinPage({ id: 'w' }, 'veil', { tagline: 'Mist "rises"' }).description;
    expect(joinPageDialogHtml({ id: 'w', description })).toContain(
      'value="Mist &quot;rises&quot;"'
    );
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

    worldWith({ description: `${BLOCK}\n`, background: VEIL_BACKGROUND });
    new Menu();
    expect(options?.buttons.map((b: { action: string }) => b.action)).toEqual([
      'veil',
      'default',
      'cancel',
    ]);
  });

  it('Apply posts editWorld to /setup with the checkbox and the tagline', async () => {
    const world = worldWith({ id: 'w', description: DESCRIPTION, background: null });
    const planned = `${veilBlock('Ravens circle.')}\n${DESCRIPTION}`;
    const saved = { id: 'w', description: planned };
    // Foundry answers 401 when the server has an admin password, and still saves.
    const fetchMock = vi.fn().mockResolvedValue({ status: 401, json: async () => saved });
    vi.stubGlobal('fetch', fetchMock);
    const Menu = createJoinPageMenu();
    new Menu();
    const fields: Record<string, unknown> = {
      useBackground: { checked: false },
      tagline: { value: 'Ravens circle.' },
    };
    const button = { form: { elements: { namedItem: (name: string): unknown => fields[name] } } };
    await options?.buttons[0].callback(new Event('click'), button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/setup');
    expect(JSON.parse(init.body as string)).toEqual({
      action: 'editWorld',
      id: 'w',
      description: planned,
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
  it('ships the picture, and no stylesheet (option B, I-150, adds one at the edge)', () => {
    expect(existsSync(join(MODULE_ROOT, 'styles/join/veil-background.svg'))).toBe(true);
    expect(existsSync(join(MODULE_ROOT, 'styles/join/veil.css'))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(MODULE_ROOT, 'module.json'), 'utf8'));
    expect(JSON.stringify(manifest.styles ?? [])).not.toContain('styles/join');
  });
});
