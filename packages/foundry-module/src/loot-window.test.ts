/**
 * Tests for the Loot GM window (I-134): the model (coins, gold total, loot items, party filter),
 * the HTML (escaping, empty state) and the window on a fake ApplicationV2.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODULE_ID } from './constants.js';
import { GM_WINDOWS_SETTING, PANEL_REFRESH_DEBOUNCE_MS } from './gm-windows.js';
import {
  buildLootView,
  goldText,
  openLootWindow,
  renderLootHtml,
  resetLootWindowForTests,
} from './loot-window.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';

const g = globalThis as any;

const pc = (over: Record<string, unknown>): any => ({
  id: 'p',
  name: 'Ilvara',
  type: 'character',
  hasPlayerOwner: true,
  ...over,
});

describe('the Loot model', () => {
  it('adds coins up as gold and lists loot items, for player characters only', () => {
    const view = buildLootView([
      pc({
        id: 'z',
        name: 'Zed',
        system: { currency: { pp: 1, gp: 12, ep: 2, sp: 5, cp: 7 } },
        items: [
          { name: 'Ruby', type: 'loot', system: { quantity: 2, type: { value: 'gem' } } },
          { name: 'Dagger', type: 'weapon', system: { quantity: 1 } },
          { name: 'Amber', type: 'loot', system: { type: { value: 'treasure' } } },
          { name: 'Bedroll', type: 'loot', system: { quantity: 1, type: { value: '' } } },
          { name: 'Tinderbox', type: 'loot', system: {} },
          { name: 'Crowbar', type: 'loot', system: { quantity: 1, type: { value: 'gear' } } },
          { name: 'Rags', type: 'loot', system: { type: { value: 'junk' } } },
          { name: 'Opal', type: 'loot', system: { quantity: 1, type: { value: 'gem' } } },
        ],
      }),
      pc({ id: 'a', name: 'Alva', system: { currency: { gp: 3 } } }),
      {
        id: 'n',
        name: 'Wolf',
        type: 'npc',
        hasPlayerOwner: false,
        system: { currency: { gp: 99 } },
      },
      { id: 'u', name: 'Unowned', type: 'character', hasPlayerOwner: false },
    ]);
    expect(view.rows.map(r => r.name)).toEqual(['Alva', 'Zed']);
    const zed = view.rows[1];
    expect(zed.coins).toBe('1 pp, 12 gp, 2 ep, 5 sp, 7 cp');
    // 1000 + 1200 + 100 + 50 + 7 copper = 2357 cp
    expect(zed.copper).toBe(2357);
    expect(zed.items).toEqual([
      { name: 'Amber', quantity: 1 },
      { name: 'Opal', quantity: 1 },
      { name: 'Ruby', quantity: 2 },
    ]);
    expect(view.totalGold).toBe('26.57 gp');
    expect(view.totalItems).toBe(4);
  });

  it('ignores bad numbers and shows a character with nothing', () => {
    const view = buildLootView([
      pc({ system: { currency: { gp: -4, sp: Number.NaN, cp: 2.9 } } }),
      pc({ id: 'q', name: 'Bare' }),
    ]);
    expect(view.rows.find(r => r.name === 'Ilvara')).toMatchObject({ coins: '2 cp', copper: 2 });
    expect(view.rows.find(r => r.name === 'Bare')).toMatchObject({ coins: '', copper: 0 });
  });

  it('writes gold the way a person reads it', () => {
    expect(goldText(0)).toBe('0 gp');
    expect(goldText(25000)).toBe('250 gp');
    expect(goldText(25050)).toBe('250.5 gp');
    expect(goldText(25005)).toBe('250.05 gp');
  });

  it('renders an empty state and escapes names', () => {
    expect(renderLootHtml(buildLootView([]))).toContain('No player characters');
    const html = renderLootHtml(
      buildLootView([
        pc({
          name: '<script>x</script>',
          system: { currency: { gp: 1 } },
          items: [
            {
              name: '<img onerror=x>',
              type: 'loot',
              system: { quantity: 3, type: { value: 'art' } },
            },
          ],
        }),
      ])
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('x3');
    expect(html).toContain('Party total');
  });
});

describe('the Loot window', () => {
  let world: TestWorld;
  let restore: () => void;
  let rendered: any[];
  let actors: any[];

  beforeEach(() => {
    vi.useFakeTimers();
    world = createTestWorld({ foundryVersion: '14.368', currentUser: { isGM: true } });
    restore = world.install();
    g.game.settings.register = vi.fn();
    world.settings.set(`${MODULE_ID}.${GM_WINDOWS_SETTING}`, true);
    rendered = [];
    class FakeApplicationV2 {
      static DEFAULT_OPTIONS: Record<string, unknown> = {};
      content = { innerHTML: '', scrollTop: 0 };
      constructor() {
        rendered.push(this);
      }
      async render(): Promise<void> {
        const context = await (this as any)._prepareContext();
        (this as any)._replaceHTML(await (this as any)._renderHTML(context), this.content);
        (this as any)._onRender();
      }
      bringToFront = vi.fn();
    }
    g.foundry = { ...g.foundry, applications: { api: { ApplicationV2: FakeApplicationV2 } } };
    actors = [pc({ system: { currency: { gp: 10 } }, items: [] })];
    g.game.actors = actors;
    resetLootWindowForTests();
  });

  afterEach(() => {
    for (const w of rendered) w._onClose?.();
    restore();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens, draws and redraws when an item arrives', async () => {
    expect(await openLootWindow()).toBe(true);
    const w = rendered[0];
    expect(w.content.innerHTML).toContain('10 gp');
    actors[0].items = [
      { name: 'Sapphire', type: 'loot', system: { quantity: 1, type: { value: 'gem' } } },
    ];
    g.Hooks.callAll('createItem');
    await vi.advanceTimersByTimeAsync(PANEL_REFRESH_DEBOUNCE_MS + 10);
    expect(w.content.innerHTML).toContain('Sapphire');
  });

  it('refuses to open with the switch off', async () => {
    world.settings.set(`${MODULE_ID}.${GM_WINDOWS_SETTING}`, false);
    expect(await openLootWindow()).toBe(false);
    expect(rendered).toHaveLength(0);
  });
});
