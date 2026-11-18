import { describe, expect, it } from 'vitest';
import { assertMacroCreateData, scanMacroSource, summarizeMacroEffects } from './macro-source.js';

const good = `
const actor = canvas.tokens.controlled[0]?.actor;
if (!actor) return ui.notifications.warn('Select a token');
const roll = await new Roll('1d20 + @abilities.str.mod', actor.getRollData()).evaluate();
await ChatMessage.create({ content: \`\${actor.name} rolls \${roll.total}\`, speaker: ChatMessage.getSpeaker({ actor }) });
const scores = [10, 12, 14];
const first = scores[0];
const key = 'str';
const mod = actor.system.abilities[key].mod + actor.system.abilities["dex"].mod;
const owner = item.parent;
`;

describe('scanMacroSource', () => {
  it('passes an ordinary Foundry macro', () => {
    expect(scanMacroSource(good)).toEqual([]);
  });

  it.each([
    ['fetch', "await fetch('x')"],
    ['XMLHttpRequest', 'new XMLHttpRequest()'],
    ['WebSocket', 'new WebSocket(u)'],
    ['sendBeacon', 'navigator.sendBeacon(u, d)'],
    ['window', 'window.open(u)'],
    ['globalThis', 'globalThis.x = 1'],
    ['document', 'document.cookie'],
    ['top', 'top.location'],
    ['localStorage', 'localStorage.getItem("a")'],
    ['eval', 'eval("1")'],
    ['Function', 'new Function("return 1")()'],
    ['constructor', '[].constructor.constructor("return 1")()'],
    ['this', 'return this'],
    ['function', '(function(){ return 1 })()'],
    ['import', 'await import("x")'],
    ['FilePicker', 'FilePicker.browse("data", "worlds")'],
    ['socket', 'game.socket.emit("a", 1)'],
    ['defaultView', 'canvas.app.view.ownerDocument.defaultView'],
    ['Image', 'new Image().src = "a"'],
    ['markup', 'ChatMessage.create({ content: "<img src=a>" })'],
    ['url', 'const u = "https://example.com/x"'],
    ['worlds path', 'const p = "worlds/other/data"'],
    ['dotdot', 'const p = "../x"'],
    ['concat key', 'game["fe" + "tch"]'],
    ['call key', 'obj[getKey()]'],
    ['empty', '   '],
  ])('refuses %s', (_label, source) => {
    expect(scanMacroSource(source).length).toBeGreaterThan(0);
  });

  it('refuses a source over the size limit', () => {
    expect(scanMacroSource('x'.repeat(20001)).some(p => p.rule === 'size')).toBe(true);
  });

  it('does not trip on words that only contain a banned one', () => {
    expect(
      scanMacroSource('const selfish = topple + parentage + importance; item.parent.name;')
    ).toEqual([]);
  });
});

describe('summarizeMacroEffects', () => {
  it('names what the source does', () => {
    const lines = summarizeMacroEffects(good);
    expect(lines).toContain('rolls dice or posts a chat message');
    expect(lines).toContain('shows a notification');
  });
  it('says so when nothing is written', () => {
    expect(summarizeMacroEffects('const a = 1;')[0]).toMatch(/no writes/);
  });
});

describe('assertMacroCreateData', () => {
  const data = {
    name: 'M',
    type: 'script',
    command: 'ui.notifications.info("hi")',
    ownership: { default: 0 },
  };
  it('accepts the forge data', () => {
    expect(() => assertMacroCreateData('macro-forge', data)).not.toThrow();
  });
  it('refuses another feature', () => {
    expect(() => assertMacroCreateData('scene-mood', data)).toThrow(/only allowed/);
  });
  it('refuses a chat macro, open ownership and extra owners', () => {
    expect(() => assertMacroCreateData('macro-forge', { ...data, type: 'chat' })).toThrow(/script/);
    expect(() =>
      assertMacroCreateData('macro-forge', { ...data, ownership: { default: 2 } })
    ).toThrow(/GM only/);
    expect(() =>
      assertMacroCreateData('macro-forge', { ...data, ownership: { default: 0, u1: 3 } })
    ).toThrow(/GM only/);
    const { ownership: _o, ...none } = data;
    expect(() => assertMacroCreateData('macro-forge', none)).toThrow(/GM only/);
  });
  it('lets an undo restore the recorded owner but still scans the source', () => {
    expect(() =>
      assertMacroCreateData('change-undo', { ...data, ownership: { default: 0, u1: 3 } })
    ).not.toThrow();
    expect(() => assertMacroCreateData('change-undo', { ...data, command: 'fetch(u)' })).toThrow(
      /not allowed/
    );
  });
  it('refuses dotted and operator keys', () => {
    expect(() => assertMacroCreateData('macro-forge', { ...data, 'flags.x': 1 })).toThrow(
      /plain fields/
    );
  });
});
