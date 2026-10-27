/**
 * Tests for the GM windows (I-134): the Combat and Party models and HTML (escaping, rows), the
 * off-by-default switch, the toolbar buttons and the window shell on a fake ApplicationV2.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { MODULE_ID } from './constants.js';
import { AI_TOOL_CONTROL, addAiToolControls } from './ai-tool-controls.js';
import {
  buildCombatView,
  openCombatWindow,
  renderCombatHtml,
  resetCombatWindowForTests,
} from './combat-window.js';
import {
  GM_WINDOWS_SETTING,
  PANEL_REFRESH_DEBOUNCE_MS,
  gmWindowsEnabled,
  registerGmWindowsSetting,
} from './gm-windows.js';
import {
  buildPartyView,
  openPartyWindow,
  renderPartyHtml,
  resetPartyWindowForTests,
  slotsText,
} from './party-window.js';

const g = globalThis as any;

describe('the Combat model', () => {
  it('reads the order, the current turn, hit points and conditions', () => {
    const view = buildCombatView({
      started: true,
      round: 2,
      turn: 1,
      scene: { name: 'Village' },
      turns: [
        {
          id: 'a',
          name: 'Ilvara',
          initiative: 18,
          actor: { system: { attributes: { hp: { value: 30, max: 40, temp: 5 } } } },
        },
        {
          id: 'b',
          name: 'Wolf',
          initiative: 12,
          hidden: true,
          actor: {
            system: { attributes: { hp: { value: 0, max: 11 } } },
            statuses: new Set(['prone', 'half_cover']),
          },
          isDefeated: true,
        },
      ],
    });
    expect(view).toMatchObject({ empty: false, started: true, round: 2, sceneName: 'Village' });
    expect(view.rows[0]).toMatchObject({
      name: 'Ilvara',
      initiative: '18',
      current: false,
      hp: '30/40 (+5)',
      hpPercent: 75,
    });
    expect(view.rows[1]).toMatchObject({
      current: true,
      defeated: true,
      hidden: true,
      hpPercent: 0,
      conditions: ['Prone', 'Half cover'],
    });
  });

  it('is empty without a combat, and marks no current turn before the start', () => {
    expect(buildCombatView(null).empty).toBe(true);
    const view = buildCombatView({ started: false, turn: 0, turns: [{ id: 'a', name: 'X' }] });
    expect(view.rows[0]).toMatchObject({
      current: false,
      initiative: '-',
      hp: '',
      hpPercent: null,
    });
    expect(renderCombatHtml(view)).toContain('Not started yet');
    expect(renderCombatHtml(view)).not.toContain('data-action="nextTurn"');
  });

  it('escapes names and conditions, and shows the turn buttons once started', () => {
    const html = renderCombatHtml(
      buildCombatView({
        started: true,
        round: 1,
        turn: 0,
        turns: [{ id: 'a', name: '<img src=x onerror=alert(1)>', actor: { statuses: ['<b>'] } }],
      })
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img');
    expect(html).toContain('data-action="nextTurn"');
    expect(html).toContain('aria-current="true"');
  });
});

describe('the Party model', () => {
  const pc = (over: Record<string, unknown>): any => ({
    id: 'p',
    name: 'Ilvara',
    type: 'character',
    hasPlayerOwner: true,
    ...over,
  });

  it('lists only player-owned characters, sorted, with their numbers', () => {
    const rows = buildPartyView([
      pc({
        id: '2',
        name: 'Zed',
        system: {
          attributes: { hp: { value: 5, max: 10, temp: 2 }, ac: { value: 16 } },
          skills: { prc: { passive: 13 } },
          details: { level: 3 },
          spells: { spell1: { value: 1, max: 4 }, spell2: { value: 0, max: 0 } },
        },
        statuses: new Set(['poisoned']),
      }),
      pc({ id: '1', name: 'Alva' }),
      { id: '3', name: 'Sorvan', type: 'npc', hasPlayerOwner: false },
      { id: '4', name: 'Unowned', type: 'character', hasPlayerOwner: false },
    ]);
    expect(rows.map(r => r.name)).toEqual(['Alva', 'Zed']);
    expect(rows[1]).toMatchObject({
      hp: '5/10 (+2)',
      hpPercent: 50,
      ac: '16',
      passivePerception: '13',
      level: 3,
      conditions: ['Poisoned'],
      slots: '1st 1/4',
    });
    expect(rows[0]).toMatchObject({ hp: '', ac: '-', passivePerception: '-', slots: '' });
  });

  it('writes slot levels in order and escapes in the HTML', () => {
    expect(slotsText({ spell3: { value: 1, max: 2 }, spell1: { value: 2, max: 4 } })).toBe(
      '1st 2/4, 3rd 1/2'
    );
    expect(renderPartyHtml([])).toContain('No player characters');
    const html = renderPartyHtml(buildPartyView([pc({ name: '<script>x</script>' })]));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('the switch, the buttons and the windows', () => {
  let world: TestWorld;
  let restore: () => void;
  let rendered: any[];
  let combat: any;
  const registered = vi.fn();

  function install(isGM: boolean, on: boolean): void {
    world = createTestWorld({ foundryVersion: '14.368', currentUser: { isGM } });
    restore = world.install();
    g.game.settings.register = registered;
    registerGmWindowsSetting();
    if (on) world.settings.set(`${MODULE_ID}.${GM_WINDOWS_SETTING}`, true);
    rendered = [];
    class FakeApplicationV2 {
      static DEFAULT_OPTIONS: Record<string, unknown> = {};
      content = { innerHTML: '', scrollTop: 0 };
      constructor(public options: Record<string, unknown> = {}) {
        rendered.push(this);
      }
      async render(): Promise<void> {
        const context = await (this as any)._prepareContext();
        (this as any)._replaceHTML(await (this as any)._renderHTML(context), this.content);
        (this as any)._onRender();
      }
      bringToFront = vi.fn();
      closed = false;
      async close(): Promise<void> {
        this.closed = true;
        (this as any)._onClose();
      }
    }
    g.foundry = { ...g.foundry, applications: { api: { ApplicationV2: FakeApplicationV2 } } };
    combat = {
      started: true,
      round: 1,
      turn: 0,
      turns: [{ id: 'a', name: 'Ilvara' }],
      nextTurn: vi.fn().mockResolvedValue(undefined),
      previousTurn: vi.fn().mockResolvedValue(undefined),
    };
    g.game.combats = { active: combat };
    resetCombatWindowForTests();
    resetPartyWindowForTests();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const w of rendered ?? []) w._onClose?.();
    restore?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers a world switch that defaults to off and redraws the controls when changed', () => {
    install(true, false);
    const [moduleId, key, config] = registered.mock.calls[0];
    expect([moduleId, key]).toEqual([MODULE_ID, GM_WINDOWS_SETTING]);
    expect(config).toMatchObject({ scope: 'world', config: true, default: false });
    const render = vi.fn();
    g.ui = { ...g.ui, controls: { render } };
    config.onChange();
    expect(render).toHaveBeenCalledWith({ reset: true });
  });

  it('is off by default: no Combat or Party buttons, and the windows refuse to open', async () => {
    install(true, false);
    expect(gmWindowsEnabled()).toBe(false);
    const controls: Record<string, any> = {};
    addAiToolControls(controls);
    expect(Object.keys(controls[AI_TOOL_CONTROL].tools)).toEqual([
      'aiChanges',
      'handouts',
      'tarokka',
    ]);
    expect(await openCombatWindow()).toBe(false);
    expect(await openPartyWindow()).toBe(false);
    expect(rendered).toHaveLength(0);
  });

  it('adds the two buttons for a GM when the switch is on, and nothing for a player', () => {
    install(true, true);
    const controls: Record<string, any> = {};
    addAiToolControls(controls);
    expect(Object.keys(controls[AI_TOOL_CONTROL].tools)).toEqual([
      'aiChanges',
      'handouts',
      'tarokka',
      'combat',
      'party',
      'session',
      'scene',
    ]);
    expect(controls[AI_TOOL_CONTROL].tools.party).toMatchObject({ order: 5, button: true });
    restore();
    install(false, true);
    const none: Record<string, any> = {};
    addAiToolControls(none);
    expect(none).toEqual({});
  });

  it('a player cannot open a window even with the switch on', async () => {
    install(false, true);
    expect(await openCombatWindow()).toBe(false);
    expect(rendered).toHaveLength(0);
  });

  it('opens one Combat window, draws it, redraws after a hook and runs the turn buttons', async () => {
    install(true, true);
    expect(await openCombatWindow()).toBe(true);
    expect(await openCombatWindow()).toBe(true);
    expect(rendered).toHaveLength(1);
    const w = rendered[0];
    expect(w.content.innerHTML).toContain('Ilvara');

    combat.turns.push({ id: 'b', name: 'Wolf' });
    g.Hooks.callAll('updateCombatant');
    g.Hooks.callAll('updateActor');
    await vi.advanceTimersByTimeAsync(PANEL_REFRESH_DEBOUNCE_MS + 10);
    expect(w.content.innerHTML).toContain('Wolf');

    const actions = w.constructor.DEFAULT_OPTIONS.actions;
    actions.nextTurn.call(w, new Event('click'), {});
    actions.previousTurn.call(w, new Event('click'), {});
    await vi.advanceTimersByTimeAsync(0);
    expect(combat.nextTurn).toHaveBeenCalledOnce();
    expect(combat.previousTurn).toHaveBeenCalledOnce();
  });

  it('removes its hooks on close, so a later hook draws nothing', async () => {
    install(true, true);
    const off = vi.spyOn(g.Hooks, 'off');
    await openCombatWindow();
    const w = rendered[0];
    w._onClose();
    expect(off).toHaveBeenCalled();
    const before = w.content.innerHTML;
    combat.turns.push({ id: 'c', name: 'Sorvan' });
    g.Hooks.callAll('updateCombatant');
    await vi.advanceTimersByTimeAsync(PANEL_REFRESH_DEBOUNCE_MS + 10);
    expect(w.content.innerHTML).toBe(before);
  });

  it('the turn buttons do nothing once the switch is off', async () => {
    install(true, true);
    await openCombatWindow();
    const w = rendered[0];
    world.settings.set(`${MODULE_ID}.${GM_WINDOWS_SETTING}`, false);
    w.constructor.DEFAULT_OPTIONS.actions.nextTurn.call(w, new Event('click'), {});
    await vi.advanceTimersByTimeAsync(0);
    expect(combat.nextTurn).not.toHaveBeenCalled();
  });

  it('closes every open window when the switch is turned off, instead of blanking it', async () => {
    install(true, true);
    await openCombatWindow();
    await openPartyWindow();
    expect(rendered).toHaveLength(2);
    const [combatWindow, partyWindow] = rendered;
    const config = registered.mock.calls[0][2];
    const off = vi.spyOn(g.Hooks, 'off');
    world.settings.set(`${MODULE_ID}.${GM_WINDOWS_SETTING}`, false);
    config.onChange();
    await vi.advanceTimersByTimeAsync(0);
    expect(combatWindow.closed).toBe(true);
    expect(partyWindow.closed).toBe(true);
    expect(off.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Closing removed the hooks: a later hook does not draw into the closed window.
    const before = combatWindow.content.innerHTML;
    g.Hooks.callAll('updateCombat');
    await vi.advanceTimersByTimeAsync(PANEL_REFRESH_DEBOUNCE_MS + 10);
    expect(combatWindow.content.innerHTML).toBe(before);
  });

  it('closes the window on its next redraw when the switch went off without a change event', async () => {
    install(true, true);
    await openCombatWindow();
    world.settings.set(`${MODULE_ID}.${GM_WINDOWS_SETTING}`, false);
    g.Hooks.callAll('updateCombat');
    await vi.advanceTimersByTimeAsync(PANEL_REFRESH_DEBOUNCE_MS + 10);
    expect(rendered[0].closed).toBe(true);
  });

  it('names all four windows in the switch and says it closes them when turned off', () => {
    install(true, false);
    const [, , config] = registered.mock.calls[0];
    for (const word of ['Combat', 'Party', 'Session', 'Scene']) expect(config.name).toContain(word);
    expect(config.hint).toContain('closes the open windows');
  });
});
