/**
 * Tests for the Party window's quick roll bar (item quick-roll-buttons-foundry): the request
 * arguments, the pick fields, the per-character round and the escaping, then the window itself
 * (the buttons call the module's own roll path, the results fill in from chat, writes off disable).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { MODULE_ID } from './constants.js';
import { GM_WINDOWS_SETTING } from './gm-windows.js';
import {
  DEFAULT_PICK,
  groupButtonLabel,
  newRound,
  noteRoll,
  pickDc,
  renderRollBarHtml,
  renderRoundHtml,
  rollRequest,
  setPickField,
  type RollPick,
} from './party-rolls.js';
import { openPartyWindow, resetPartyWindowForTests } from './party-window.js';

const pick = (over: Partial<RollPick> = {}): RollPick => ({ ...DEFAULT_PICK, ...over });
const g = globalThis as any;

describe('rollRequest', () => {
  it('asks for a skill by lower-case name, with the DC on the card and no advantage by default', () => {
    expect(rollRequest(pick({ what: 'skill:Sleight of Hand', dc: '14' }), 'Mira')).toEqual({
      rollType: 'skill',
      rollTarget: 'sleight of hand',
      targetPlayer: 'Mira',
      isPublic: false,
      rollModifier: '',
      flavor: 'DC 14',
      dc: 14,
    });
  });

  it('maps a check to the ability roll type and carries advantage and public', () => {
    expect(
      rollRequest(pick({ what: 'check:str', isPublic: true, advantage: 'disadvantage' }), 'Mira')
    ).toMatchObject({
      rollType: 'ability',
      rollTarget: 'str',
      isPublic: true,
      advantage: 'disadvantage',
      flavor: '',
    });
    expect(rollRequest(pick({ what: 'save:dex' }), 'Mira')).toMatchObject({
      rollType: 'save',
      rollTarget: 'dex',
    });
  });

  it('ignores a DC that is empty, zero or not a number', () => {
    for (const dc of ['', '0', 'ab', '100']) expect(pickDc(pick({ dc }))).toBeNull();
    expect(pickDc(pick({ dc: ' 12 ' }))).toBe(12);
  });
});

describe('setPickField', () => {
  it('keeps the old pick on an unknown roll, a bad DC or a wrong type', () => {
    const p = pick();
    expect(setPickField(p, 'what', 'save:xyz')).toBe(p);
    expect(setPickField(p, 'dc', '123')).toBe(p);
    expect(setPickField(p, 'isPublic', 'yes')).toBe(p);
    expect(setPickField(p, 'advantage', 'maybe')).toBe(p);
  });

  it('applies each field', () => {
    let p = setPickField(pick(), 'what', 'save:wis');
    p = setPickField(p, 'dc', '15');
    p = setPickField(p, 'isPublic', true);
    p = setPickField(p, 'advantage', 'advantage');
    expect(p).toEqual({ what: 'save:wis', dc: '15', isPublic: true, advantage: 'advantage' });
    expect(setPickField(p, 'advantage', 'normal').advantage).toBe('normal');
  });
});

describe('the round', () => {
  const targets = [
    { id: 'a', name: 'Alva' },
    { id: 'b', name: 'Bran' },
  ];

  it('fills in each character from their own roll, once, and ignores older or foreign rolls', () => {
    const round = newRound(pick({ what: 'save:dex', dc: '14' }), targets, 1000);
    expect(
      noteRoll(round, { timestamp: 900, speaker: { actor: 'a' }, rolls: [{ total: 20 }] })
    ).toBe(false);
    expect(
      noteRoll(round, { timestamp: 1100, speaker: { actor: 'z' }, rolls: [{ total: 20 }] })
    ).toBe(false);
    expect(noteRoll(round, { timestamp: 1100, speaker: { actor: 'a' }, rolls: [] })).toBe(false);
    expect(
      noteRoll(round, { timestamp: 1100, speaker: { actor: 'a' }, rolls: [{ total: 9 }] })
    ).toBe(true);
    expect(
      noteRoll(round, { timestamp: 1200, speaker: { actor: 'a' }, rolls: [{ total: 18 }] })
    ).toBe(false);
    expect(
      noteRoll(round, { timestamp: 1300, speaker: { actor: 'b' }, rolls: [{ total: 14 }] })
    ).toBe(true);
    expect(round.entries.map(e => [e.status, e.total])).toEqual([
      ['rolled', 9],
      ['rolled', 14],
    ]);
    expect(noteRoll(null, { speaker: { actor: 'a' }, rolls: [{ total: 1 }] })).toBe(false);
  });

  it('keeps waiting for the roll that was asked for, read from the dnd5e message', () => {
    const roll = (
      type: string,
      system: { ability?: string; skill?: string } = {}
    ): RollMessageLike => ({
      timestamp: 2000,
      speaker: { actor: 'a' },
      rolls: [{ total: 12 }],
      type,
      system,
    });
    const save = newRound(pick({ what: 'save:dex' }), targets, 1000);
    expect(noteRoll(save, roll('check', { ability: 'wis', skill: 'prc' }))).toBe(false);
    expect(noteRoll(save, roll('save', { ability: 'wis' }))).toBe(false);
    expect(noteRoll(save, roll('check', { ability: 'dex' }))).toBe(false);
    expect(noteRoll(save, roll('damage'))).toBe(false);
    expect(save.entries[0].status).toBe('waiting');
    expect(noteRoll(save, roll('save', { ability: 'dex' }))).toBe(true);
    const skill = newRound(pick({ what: 'skill:Perception' }), targets, 1000);
    expect(noteRoll(skill, roll('check', { ability: 'wis', skill: 'ste' }))).toBe(false);
    expect(noteRoll(skill, roll('check', { ability: 'wis', skill: 'prc' }))).toBe(true);
    const check = newRound(pick({ what: 'check:str' }), targets, 1000);
    expect(noteRoll(check, roll('save', { ability: 'str' }))).toBe(false);
    expect(noteRoll(check, roll('check', { ability: 'str', skill: 'ath' }))).toBe(false);
    expect(noteRoll(check, roll('check', { ability: 'str' }))).toBe(true);
    // A plain formula is a `base` message: the speaker alone decides.
    const plain = newRound(pick({ what: 'save:dex' }), targets, 1000);
    expect(noteRoll(plain, { ...roll('base'), rolls: [{ total: 5 }] })).toBe(true);
  });

  it('lists each character as waiting, passed, failed or not sent, and escapes names', () => {
    const round = newRound(
      pick({ what: 'save:dex', dc: '14' }),
      [...targets, { id: 'c', name: '<b>Cy</b>' }],
      0
    );
    noteRoll(round, { speaker: { actor: 'a' }, rolls: [{ total: 9 }] });
    noteRoll(round, { speaker: { actor: 'b' }, rolls: [{ total: 14 }] });
    round.entries[2].status = 'failed';
    round.entries[2].error = 'offline';
    const html = renderRoundHtml(round);
    expect(html).toContain('Dexterity save DC 14');
    expect(html).toContain('2 of 3 rolled');
    expect(html).toContain('9 fails');
    expect(html).toContain('14 passes');
    expect(html).toContain('Not sent: offline');
    expect(html).not.toContain('<b>Cy');
    expect(renderRoundHtml(null)).toBe('');
    const waiting = renderRoundHtml(newRound(pick(), targets, 0));
    expect(waiting).toContain('waiting');
    expect(waiting).toContain('0 of 2 rolled');
  });
});

describe('the bar', () => {
  it('names the whole-party button a group save for a saving throw', () => {
    expect(groupButtonLabel(pick({ what: 'save:con' }))).toBe('Group save: Constitution save');
    expect(groupButtonLabel(pick())).toBe('Ask everyone: Perception');
  });

  it('disables the buttons and says why when sending is off', () => {
    const view = { pick: pick(), disabledReason: 'Roll requests are off.', round: null };
    const off = renderRollBarHtml(view, false);
    expect(off).toContain('data-action="askAll" disabled');
    expect(off).toContain('Roll requests are off.');
    expect(renderRollBarHtml({ ...view, disabledReason: '' }, true)).not.toContain('disabled');
  });
});

describe('in the Party window', () => {
  let world: TestWorld;
  let restore: () => void;
  let rendered: any[];
  let send: ReturnType<typeof vi.fn>;
  let chatHandlers: Array<(m: unknown) => void>;

  const pc = (id: string, name: string): any => ({
    id,
    name,
    type: 'character',
    hasPlayerOwner: true,
  });

  function install(writes: boolean): void {
    world = createTestWorld({ foundryVersion: '14.368', currentUser: { isGM: true } });
    restore = world.install();
    world.settings.set(`${MODULE_ID}.${GM_WINDOWS_SETTING}`, true);
    world.settings.set(`${MODULE_ID}.allowWriteOperations`, writes);
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
      async close(): Promise<void> {
        (this as any)._onClose();
      }
    }
    g.foundry = { ...g.foundry, applications: { api: { ApplicationV2: FakeApplicationV2 } } };
    g.game.actors = [pc('a', 'Alva'), pc('b', 'Bran')];
    send = vi.fn().mockResolvedValue({ success: true, message: 'sent' });
    g.window = {
      ...(g.window ?? {}),
      foundryMCPBridge: { dataAccess: { requestPlayerRolls: send } },
    };
    chatHandlers = [];
    g.Hooks = {
      ...g.Hooks,
      on: vi.fn((name: string, fn: (m: unknown) => void) => {
        if (name === 'createChatMessage') chatHandlers.push(fn);
        return chatHandlers.length;
      }),
      off: vi.fn(),
    };
    resetPartyWindowForTests();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    restore?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const action = (name: string, dataset: Record<string, string> = {}): Promise<void> => {
    const w = rendered[0];
    w.constructor.DEFAULT_OPTIONS.actions[name].call(w, new Event('click'), { dataset });
    return vi.advanceTimersByTimeAsync(0);
  };

  it('draws the bar and an Ask button per character, enabled while writes are on', async () => {
    install(true);
    await openPartyWindow();
    const html = rendered[0].content.innerHTML;
    expect(html).toContain('Ask everyone: Perception');
    expect(html.match(/data-action="askOne"/g)).toHaveLength(2);
    expect(html).not.toContain('disabled');
  });

  it('disables the roll buttons with a reason while writes are off, and sends nothing', async () => {
    install(false);
    await openPartyWindow();
    expect(rendered[0].content.innerHTML).toContain('Roll requests are off');
    expect(rendered[0].content.innerHTML).toContain('data-action="askAll" disabled');
    await action('askAll');
    expect(send).not.toHaveBeenCalled();
  });

  it('asks one character by exact name', async () => {
    install(true);
    await openPartyWindow();
    await action('askOne', { actorId: 'b', actorName: 'Bran' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      targetPlayer: 'Bran',
      rollTarget: 'perception',
    });
    expect(rendered[0].content.innerHTML).toContain('Bran');
  });

  it('sends a group save to every character and lists each answer as the rolls come in', async () => {
    install(true);
    await openPartyWindow();
    // The bar's fields reach the pick through the change listener the shell binds.
    const listeners: Array<(e: any) => void> = [];
    rendered[0].content.addEventListener = (_t: string, fn: (e: any) => void): void => {
      listeners.push(fn);
    };
    await rendered[0].render();
    const change = (field: string, value: string): void =>
      listeners.forEach(fn => fn({ target: { dataset: { field }, value, type: 'text' } }));
    change('what', 'save:dex');
    change('dc', '14');
    await vi.advanceTimersByTimeAsync(300);
    expect(rendered[0].content.innerHTML).toContain('Group save: Dexterity save');
    await action('askAll');
    expect(
      send.mock.calls.map(c => [c[0].targetPlayer, c[0].rollType, c[0].rollTarget, c[0].dc])
    ).toEqual([
      ['Alva', 'save', 'dex', 14],
      ['Bran', 'save', 'dex', 14],
    ]);
    expect(rendered[0].content.innerHTML).toContain('0 of 2 rolled');
    chatHandlers[0]({
      timestamp: Date.now() + 5,
      speaker: { actor: 'a' },
      rolls: [{ total: 17 }],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(rendered[0].content.innerHTML).toContain('17 passes');
    expect(rendered[0].content.innerHTML).toContain('1 of 2 rolled');
    await action('clearRound');
    expect(rendered[0].content.innerHTML).not.toContain('Roll results');
  });

  it('shows a refused request and a thrown one as not sent for that character only', async () => {
    install(true);
    send
      .mockResolvedValueOnce({ success: false, message: '', error: 'Player "Al" is offline' })
      .mockRejectedValueOnce(new Error('socket closed'));
    await openPartyWindow();
    await action('askAll');
    const html = rendered[0].content.innerHTML;
    expect(html).toContain('Not sent: Player &quot;Al&quot; is offline');
    expect(html).toContain('Not sent: socket closed');
  });
});
