import { describe, expect, it } from 'vitest';
import { assertMacroCreateData, scanMacroSource, summarizeMacroEffects } from './macro-source.js';

const good = `
const target = canvas.tokens.controlled[0]?.actor;
if (!target) return ui.notifications.warn('Select a token');
const roll = await new Roll('1d20 + @abilities.str.mod', target.getRollData()).evaluate();
await ChatMessage.create({ content: \`<p>\${target.name} rolls <strong>\${roll.total}</strong></p>\`, speaker: ChatMessage.getSpeaker({ actor: target }) });
const scores = [10, 12, 14];
const first = scores[0];
let total = 0;
for (let i = 0; i < scores.length; i++) total += scores[i];
const last = scores[scores.length - 1];
const mod = target.system.abilities['str'].mod + target.system.abilities["dex"].mod;
const owner = item.parent;
const named = Object.entries(target.system.abilities).map(([k, v]) => k + v.value);
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
    ['syntax error', 'const = ;'],
    ['breaking out of the wrapper', '}); fetch(u); (() => {'],
    ['class', 'class A {}'],
    ['with', 'with (game) { }'],
    ['tagged template', 'String.raw`a`'],
  ])('refuses %s', (_label, source) => {
    expect(scanMacroSource(source).length).toBeGreaterThan(0);
  });

  it.each([
    // The review of the first version (PR 1165): each of these got through the word scan.
    ['Foundry fetch helper', 'await foundry.utils.fetchWithTimeout(u)'],
    ['Foundry fetch helper through a local alias', 'const f = game.foo.fetchJsonWithTimeout; f(u)'],
    ['texture loader', 'await game.foo.loadTexture(u)'],
    ['audio helper', 'game.foo.AudioHelper.play({ src: u })'],
    ['split URL', "const u = 'ht' + 'tps://evil.example/?d=' + JSON.stringify(game.actors)"],
    ['split URL, three parts', "const u = 'ht' + 'tp:' + '//evil.example'"],
    ['split markup', "const h = '<im' + 'g src=x>'"],
    ['markup with an attribute', "ChatMessage.create({ content: '<p onclick=x>hi</p>' })"],
    [
      'runtime member name',
      "const k = 'constr' + 'uctor'; const F = (() => 0)[k]; F('return 1')()",
    ],
    ['runtime member name on game', "const k = 'soc' + 'ket'; game[k].emit('a', 1)"],
    ['nested index', 'x[ks[0]]'],
    ['unicode escape in a name', '\\u0066etch(u)'],
    ['unicode escape in a member', 'a.\\u0063onstructor'],
    ['unicode escape in a string', "const u = 'ht\\u0074ps://evil.example'"],
    ['hex escape for a slash', "const u = 'ht' + 'tp:' + '\\x2f\\x2fevil.example'"],
    ['destructured constructor', 'const { constructor: C } = () => 0; C("return 1")'],
    ['text from char codes', 'const c = String.fromCharCode(60)'],
    ['text rewritten at run time', "const h = '<~img src=x>'.replace('~', '')"],
    ['picture field set to an address', "const u = 'x'; await actor.update({ img: u })"],
    [
      'dotted picture field',
      "const u = 'x'; await actor.update({ 'prototypeToken.texture.src': u })",
    ],
    // Round 3 of the review.
    [
      'Math.floor replaced',
      "Math.floor = () => 'constr' + 'uctor'; (() => 0)[Math.floor(1)]('r')()",
    ],
    [
      'Math changed with Object.assign',
      "Object.assign(Math, { floor: () => 'constr' + 'uctor' }); (() => 0)[Math.floor(1)]('r')()",
    ],
    [
      'a catch pattern with a default that sends data out',
      "try { throw {} } catch ({ x = fetch('x') }) {}",
    ],
    [
      'a computed key in a parameter pattern',
      "const k = 'constr' + 'uctor'; (({ [k]: F }) => F('return 1')())(() => 0)",
    ],
    [
      'a regular expression that is only an address',
      'const s = /https:\\/\\/evil\\.example/.source',
    ],
    ['creating another macro', 'await Macro.create({ name: "x", type: "script", command: "1" })'],
    ['running another macro', 'game.foo.macros.getName("x").execute()'],
    ['a name that is not in the API', 'Hooks.on("updateActor", () => {})'],
    ['a shadowed global used outside its scope', '(open => 1)(); open("x")'],
    ['an inner declaration used outside', 'function f() { var open = 1 } open("x")'],
    ['arguments', 'return arguments.callee'],
    // Round 2 of the review: a computed key built from `.length` or a re-declared counter.
    [
      'length of an object literal as a key',
      "const k = { length: 'constr' + 'uctor' }; const F = (() => 0)[k.length]; F('return 1')()",
    ],
    ['two lengths added as a key', 'a[b.length + c.length]'],
    [
      'a var counter declared again',
      "for (var i = 0; i < 0; i++); var i = 'constr' + 'uctor'; (() => 0)[i]('return 1')()",
    ],
    [
      'a counter reassigned by for-of',
      "for (let i = 0; i < 1; i++) for (i of ['constr' + 'uctor']) (() => 0)[i]('return 1')()",
    ],
    [
      'a regular expression holding an address',
      'const s = /<img src="https:\\/\\/e.example\\/x">/.source',
    ],
    ['keys built from entries', "await actor.update(Object.fromEntries([['im' + 'g', 'x']]))"],
    ['text parsed at run time', "const o = JSON.parse('{}')"],
    [
      'an event that hands back the window',
      'ui.chat.element.addEventListener("click", e => e.view)',
    ],
    [
      'rewriting another macro',
      'const m = await fromUuid("Macro.x"); await m.update({ command: "1" })',
    ],
    ['running a chat command', 'ui.chat.processMessage("/macro X")'],
    [
      'a counter that is reassigned',
      "for (let i = 0; i < 2; i++) { i = 'constr' + 'uctor'; a[i] }",
    ],
  ])('refuses the bypass: %s', (_label, source) => {
    expect(scanMacroSource(source).length).toBeGreaterThan(0);
  });

  it('still allows number keys: literals, let counters, sums with a minus or a Math call', () => {
    expect(
      scanMacroSource(
        'const xs = [1, 2, 3]; let n = 0; for (let i = 0; i < xs.length; i++) n += xs[i]; ' +
          'return xs[xs.length - 1] + xs[+Math.floor(n / 2)] + xs[-1 + 2] + xs[1 + 1];'
      )
    ).toEqual([]);
  });

  it('refuses a source over the size limit', () => {
    expect(scanMacroSource('x'.repeat(20001)).some(p => p.rule === 'size')).toBe(true);
  });

  it('does not trip on words that only contain a banned one', () => {
    expect(
      scanMacroSource(
        'const selfish = 1; const topple = 2; const importance = selfish + topple; item.parent.name;'
      )
    ).toEqual([]);
  });

  it('accepts local functions and names that are declared in the macro', () => {
    expect(
      scanMacroSource(
        'const fetchName = (a) => a.name; function open2(x) { return x }; const open = 3; open + fetchName({ name: 1 })'
      )
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
  it('lets a redo of a forge macro through: undo mode keeps the creating GM as owner', () => {
    const redo = { ...data, ownership: { default: 0, gm1: 3 } };
    expect(() => assertMacroCreateData('macro-forge', redo, 'undo')).not.toThrow();
    expect(() => assertMacroCreateData('macro-forge', redo, 'apply')).toThrow(/GM only/);
    expect(() =>
      assertMacroCreateData('macro-forge', { ...redo, ownership: { default: 2 } }, 'undo')
    ).toThrow(/GM only/);
    expect(() =>
      assertMacroCreateData('macro-forge', { ...redo, command: 'fetch(u)' }, 'undo')
    ).toThrow(/not allowed/);
  });
  it('refuses dotted and operator keys', () => {
    expect(() => assertMacroCreateData('macro-forge', { ...data, 'flags.x': 1 })).toThrow(
      /plain fields/
    );
  });
});
