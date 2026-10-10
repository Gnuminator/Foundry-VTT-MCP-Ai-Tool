/**
 * Tests for the Enhanced Creature Index settings menu (D-109): the ApplicationV2 form that
 * replaced the v1 FormApplication, built at `init` by {@link createEnhancedIndexMenu}.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { MODULE_ID } from './constants.js';

const trackUsage = vi.fn();
vi.mock(
  './usage-recorder.js',
  (): Record<string, unknown> => ({ trackUsage: (...a: unknown[]) => trackUsage(...a) })
);

const { ModuleSettings, createEnhancedIndexMenu } = await import('./settings.js');

const g = globalThis as any;
let world: TestWorld;
let restore: () => void;

/** A stand-in ApplicationV2 that records the first-render call the menu forwards to. */
class FakeApplicationV2 {
  firstRenders = 0;
  async _onFirstRender(): Promise<void> {
    this.firstRenders += 1;
  }
}

type MenuClass = (new () => FakeApplicationV2 & {
  _prepareContext(): Promise<Record<string, unknown>>;
  _onFirstRender(context: unknown, options: unknown): Promise<void>;
}) & {
  DEFAULT_OPTIONS: Record<string, any>;
  PARTS: Record<string, { template: string }>;
};

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
  trackUsage.mockClear();
  g.foundry.applications = {
    api: {
      ApplicationV2: FakeApplicationV2,
      HandlebarsApplicationMixin: (base: unknown): unknown => base,
      DialogV2: class {},
    },
  };
});

afterEach(() => {
  restore();
  delete g.foundryMCPBridge;
});

describe('Enhanced Creature Index menu (AppV2)', () => {
  it('is registered as a GM-only ApplicationV2 menu, not a FormApplication', () => {
    const registerMenu = vi.fn();
    g.game.settings.register = vi.fn();
    g.game.settings.registerMenu = registerMenu;
    new ModuleSettings().registerSettings();
    const call = registerMenu.mock.calls.find(c => c[1] === 'enhancedIndexMenu');
    expect(call?.[0]).toBe(MODULE_ID);
    expect(call?.[2].restricted).toBe(true);
    expect(call?.[2].type.prototype).toBeInstanceOf(FakeApplicationV2);
  });

  it('renders the template as a form that stays open on save', () => {
    const Menu = createEnhancedIndexMenu() as unknown as MenuClass;
    expect(Menu.DEFAULT_OPTIONS).toMatchObject({
      tag: 'form',
      window: { title: 'Enhanced Creature Index Settings' },
      form: { closeOnSubmit: false },
    });
    expect(typeof Menu.DEFAULT_OPTIONS.form.handler).toBe('function');
    expect(typeof Menu.DEFAULT_OPTIONS.actions.rebuild).toBe('function');
    expect(Menu.PARTS.form.template).toBe(
      `modules/${MODULE_ID}/templates/enhanced-index-menu.html`
    );
  });

  it('shows both switches as they are saved', async () => {
    world.setSetting(MODULE_ID, 'enableEnhancedCreatureIndex', true);
    world.setSetting(MODULE_ID, 'autoRebuildIndex', false);
    const Menu = createEnhancedIndexMenu() as unknown as MenuClass;
    await expect(new Menu()._prepareContext()).resolves.toEqual({
      enableEnhancedCreatureIndex: true,
      autoRebuildIndex: false,
    });
  });

  it('counts an open once per window and keeps the base first render', async () => {
    const Menu = createEnhancedIndexMenu() as unknown as MenuClass;
    const app = new Menu();
    await app._onFirstRender({}, {});
    expect(app.firstRenders).toBe(1);
    expect(trackUsage).toHaveBeenCalledExactlyOnceWith(
      'view',
      'module.settings.enhanced-index-open'
    );
  });

  it('saves both switches from the submitted form, unticked as false', async () => {
    world.setSetting(MODULE_ID, 'enableEnhancedCreatureIndex', true);
    world.setSetting(MODULE_ID, 'autoRebuildIndex', true);
    const Menu = createEnhancedIndexMenu() as unknown as MenuClass;
    const handler = Menu.DEFAULT_OPTIONS.form.handler;
    await handler(new Event('submit'), {}, { object: { enableEnhancedCreatureIndex: false } });
    expect(world.settings.get(`${MODULE_ID}.enableEnhancedCreatureIndex`)).toBe(false);
    expect(world.settings.get(`${MODULE_ID}.autoRebuildIndex`)).toBe(false);
    await handler(new Event('submit'), {}, { object: { autoRebuildIndex: true } });
    expect(world.settings.get(`${MODULE_ID}.autoRebuildIndex`)).toBe(true);
    expect(trackUsage).toHaveBeenCalledWith('action', 'module.settings.enhanced-index-save');
    expect(world.notifications.at(-1)).toEqual({
      level: 'info',
      message: 'Enhanced Creature Index settings saved',
    });
  });

  it('starts a rebuild through the bridge from the Rebuild button', () => {
    const rebuild = vi.fn(() => Promise.resolve());
    g.foundryMCPBridge = { dataAccess: { rebuildEnhancedCreatureIndex: rebuild } };
    const Menu = createEnhancedIndexMenu() as unknown as MenuClass;
    Menu.DEFAULT_OPTIONS.actions.rebuild();
    expect(rebuild).toHaveBeenCalledOnce();
    expect(trackUsage).toHaveBeenCalledWith('action', 'module.settings.enhanced-index-rebuild');
    expect(world.notifications.at(-1)?.message).toBe('Rebuilding enhanced creature index...');
  });

  it('does nothing but count the click while the bridge is not loaded', () => {
    const Menu = createEnhancedIndexMenu() as unknown as MenuClass;
    expect(() => Menu.DEFAULT_OPTIONS.actions.rebuild()).not.toThrow();
    expect(world.notifications).toEqual([]);
  });
});
