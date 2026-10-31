import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LAYOUT,
  clampStripPx,
  classifyMessage,
  fitsSideBySide,
  maxStripPx,
  parseLayout,
} from './gmLayout';
import { LIVE_PICK_MESSAGE, LIVE_READY_MESSAGE } from './mapPick';

describe('the strip width limits', () => {
  it('keeps Foundry at 760 px or more and the strip between 320 and 720', () => {
    expect(maxStripPx(1088)).toBe(328);
    expect(maxStripPx(1400)).toBe(640);
    expect(maxStripPx(3000)).toBe(720);
    expect(clampStripPx(100, 1920)).toBe(320);
    expect(clampStripPx(900, 1920)).toBe(720);
    expect(clampStripPx(420, 1100)).toBe(340);
    expect(clampStripPx(NaN, 1920)).toBe(420);
  });

  it('fits side by side from 1088 px', () => {
    expect(fitsSideBySide(1088)).toBe(true);
    expect(fitsSideBySide(1087)).toBe(false);
    expect(fitsSideBySide(390)).toBe(false);
  });
});

describe('parseLayout', () => {
  it('reads a saved layout', () => {
    expect(parseLayout('{"v":1,"mode":"left","stripPx":500,"hintSeen":true}')).toEqual({
      mode: 'left',
      stripPx: 500,
      hintSeen: true,
    });
    expect(parseLayout('{"mode":"window"}').mode).toBe('window');
  });

  it('falls back to the defaults for nothing, junk or wrong values', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('not json')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{"mode":"top","stripPx":"wide"}')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{"stripPx":5}').stripPx).toBe(320);
    expect(parseLayout('{"stripPx":99999}').stripPx).toBe(720);
  });
});

describe('classifyMessage', () => {
  const frame = {};
  const tab = {};
  const popup = {};
  const s = {
    foundryFrame: frame,
    foundryTab: tab,
    stripWindow: popup,
    foundryOrigin: 'https://play.example.com',
    ownOrigin: 'https://cogm.example.com',
  };
  const pick = { type: LIVE_PICK_MESSAGE, tokenIds: ['a', 3, '', 'b'] };

  it('takes a pick from the Foundry frame or tab, from Foundry origin only', () => {
    expect(classifyMessage({ data: pick, source: frame, origin: s.foundryOrigin }, s)).toEqual({
      kind: 'pick',
      from: 'foundry',
      ids: ['a', 'b'],
    });
    expect(classifyMessage({ data: pick, source: tab, origin: s.foundryOrigin }, s)?.kind).toBe(
      'pick'
    );
    expect(
      classifyMessage({ data: pick, source: frame, origin: 'https://evil.example' }, s)
    ).toBeNull();
    expect(classifyMessage({ data: pick, source: {}, origin: s.foundryOrigin }, s)).toBeNull();
    expect(classifyMessage({ data: pick, source: popup, origin: s.foundryOrigin }, s)).toBeNull();
  });

  it('never matches a null source against a missing window', () => {
    const none = { ...s, foundryFrame: null, foundryTab: null, stripWindow: null };
    expect(classifyMessage({ data: pick, source: null, origin: s.foundryOrigin }, none)).toBeNull();
    expect(
      classifyMessage(
        { data: { type: LIVE_READY_MESSAGE }, source: null, origin: s.ownOrigin },
        none
      )
    ).toBeNull();
  });

  it('refuses every pick when Foundry has no address', () => {
    const noUrl = { ...s, foundryOrigin: null };
    expect(classifyMessage({ data: pick, source: frame, origin: 'null' }, noUrl)).toBeNull();
  });

  it('takes ready from the strip window and this origin only', () => {
    const ready = { type: LIVE_READY_MESSAGE };
    expect(classifyMessage({ data: ready, source: popup, origin: s.ownOrigin }, s)).toEqual({
      kind: 'ready',
      from: 'strip-window',
    });
    expect(classifyMessage({ data: ready, source: popup, origin: s.foundryOrigin }, s)).toBeNull();
    expect(classifyMessage({ data: ready, source: frame, origin: s.ownOrigin }, s)).toBeNull();
  });

  it('ignores other data and a pick without a list', () => {
    expect(classifyMessage({ data: 'x', source: frame, origin: s.foundryOrigin }, s)).toBeNull();
    expect(
      classifyMessage(
        { data: { type: LIVE_PICK_MESSAGE }, source: frame, origin: s.foundryOrigin },
        s
      )
    ).toBeNull();
  });
});
