import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GM_GUIDE_URL, createHelpMenu } from './help-menu.js';
import { ModuleSettings } from './settings.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';

const g = globalThis as any;
let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
  g.foundry.applications = {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: (B: unknown): unknown => B,
      DialogV2: class {},
    },
  };
});

afterEach(() => {
  restore();
});

describe('settings Help menu', () => {
  it('opens the GM guides on the wiki instead of drawing a window', async () => {
    const open = vi.fn();
    const HelpMenu = createHelpMenu(open);
    const app = new HelpMenu() as { render(force?: boolean): Promise<unknown> };
    await expect(app.render(true)).resolves.toBe(app);
    expect(open).toHaveBeenCalledExactlyOnceWith(GM_GUIDE_URL);
  });

  it('points at the wiki GM section', () => {
    expect(GM_GUIDE_URL).toBe('https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/gm/');
  });

  it('is the first module menu, GM only', () => {
    const registerMenu = vi.fn();
    g.game.settings.register = vi.fn();
    g.game.settings.registerMenu = registerMenu;
    new ModuleSettings().registerSettings();
    const [namespace, key, data] = registerMenu.mock.calls[0] as [string, string, any];
    expect(`${namespace}.${key}`).toBe('foundry-mcp-bridge.helpMenu');
    expect(data.restricted).toBe(true);
    expect(data.type.prototype).toBeInstanceOf(g.foundry.applications.api.ApplicationV2);
  });
});
