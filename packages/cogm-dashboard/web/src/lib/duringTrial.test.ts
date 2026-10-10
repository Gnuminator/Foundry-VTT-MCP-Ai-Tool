// The During layout rules: the trial's step machine, what the screen looks like for a layout, a
// fight and the trial, and when the hint shows. Pure functions, no DOM.
import { describe, expect, it } from 'vitest';

import {
  FIRST_TRIAL,
  TOUR,
  autoNote,
  duringScreen,
  fullButtonLabel,
  keepChange,
  nextLabel,
  nextTrial,
  stepLine,
} from './duringTrial';
import {
  DEFAULT_PREFS,
  LAYOUT_HINT_SESSIONS,
  applyPrefsChange,
  hintSessionKey,
  readPrefs,
  showLayoutHint,
  type DuringPrefs,
} from './prefsModel';

const prefs = (over: Partial<DuringPrefs> = {}): DuringPrefs => ({ ...DEFAULT_PREFS, ...over });

describe('the trial steps', () => {
  it('has three steps: Cards, Simple/Full and Auto, and only Auto shows a sample fight', () => {
    expect(TOUR.map(s => s.layout)).toEqual(['layered', 'toggle', 'auto']);
    expect(TOUR.map(s => s.sampleCombat === true)).toEqual([false, false, true]);
  });

  it('goes round: Next, Next, then back to the first', () => {
    let trial = FIRST_TRIAL;
    const seen = [trial.step];
    for (let i = 0; i < 3; i++) {
      trial = nextTrial(trial);
      seen.push(trial.step);
    }
    expect(seen).toEqual([0, 1, 2, 0]);
  });

  it('starts each step on Simple', () => {
    expect(nextTrial({ step: 1, full: true }).full).toBe(false);
    expect(nextTrial({ step: 0, full: true })).toEqual({ step: 1, full: false });
  });

  it('labels the last step "Back to the first" and counts the steps', () => {
    expect(nextLabel({ step: 0, full: false })).toBe('Next');
    expect(nextLabel({ step: 1, full: false })).toBe('Next');
    expect(nextLabel({ step: 2, full: false })).toBe('Back to the first');
    expect(stepLine({ step: 1, full: false })).toBe('Layout 2 of 3');
  });

  it('keeps the layout of the step, and only Simple/Full also keeps what it showed', () => {
    expect(keepChange({ step: 0, full: false })).toEqual({
      duringLayout: 'layered',
      layoutPicked: true,
    });
    expect(keepChange({ step: 1, full: false })).toEqual({
      duringLayout: 'toggle',
      layoutPicked: true,
      duringFull: false,
    });
    expect(keepChange({ step: 1, full: true })).toEqual({
      duringLayout: 'toggle',
      layoutPicked: true,
      duringFull: true,
    });
    expect(keepChange({ step: 2, full: true })).toEqual({
      duringLayout: 'auto',
      layoutPicked: true,
    });
  });

  it('points at "Show everything" only in the step that the bar shows that button for', () => {
    // The old page hid the button in the trial while this text pointed at it.
    const text = TOUR[1]?.text ?? '';
    expect(text).toContain(`"${fullButtonLabel('simple')}"`);
  });
});

describe('what the During screen shows', () => {
  it('uses the saved layout, calm, outside the trial', () => {
    expect(duringScreen({ prefs: prefs(), trial: null, combatActive: false })).toEqual({
      layout: 'layered',
      context: 'calm',
      view: undefined,
    });
    expect(
      duringScreen({ prefs: prefs({ duringLayout: 'auto' }), trial: null, combatActive: true })
    ).toEqual({ layout: 'auto', context: 'combat', view: undefined });
  });

  it('shows Layered before the prefs are known', () => {
    expect(duringScreen({ prefs: undefined, trial: null, combatActive: false }).layout).toBe(
      'layered'
    );
  });

  it('has a view only in Simple/Full, from the saved Full switch', () => {
    const toggle = prefs({ duringLayout: 'toggle' });
    expect(duringScreen({ prefs: toggle, trial: null, combatActive: false }).view).toBe('simple');
    expect(
      duringScreen({ prefs: { ...toggle, duringFull: true }, trial: null, combatActive: false })
        .view
    ).toBe('full');
    expect(
      duringScreen({ prefs: prefs({ duringFull: true }), trial: null, combatActive: false }).view
    ).toBeUndefined();
  });

  it('follows the trial step, whatever is saved', () => {
    const saved = prefs({ duringLayout: 'auto', duringFull: true });
    expect(
      duringScreen({ prefs: saved, trial: { step: 0, full: false }, combatActive: false })
    ).toMatchObject({
      layout: 'layered',
    });
    // The trial's own Simple/Full preview, not the saved Full.
    expect(
      duringScreen({ prefs: saved, trial: { step: 1, full: false }, combatActive: false }).view
    ).toBe('simple');
    expect(
      duringScreen({ prefs: saved, trial: { step: 1, full: true }, combatActive: false }).view
    ).toBe('full');
  });

  it('shows Auto in combat in the trial (the sample fight), and a real fight in any step', () => {
    expect(
      duringScreen({ prefs: prefs(), trial: { step: 2, full: false }, combatActive: false })
    ).toMatchObject({ layout: 'auto', context: 'combat' });
    expect(
      duringScreen({ prefs: prefs(), trial: { step: 1, full: false }, combatActive: false }).context
    ).toBe('calm');
    expect(
      duringScreen({ prefs: prefs(), trial: { step: 0, full: false }, combatActive: true }).context
    ).toBe('combat');
  });

  it('words the Auto note and the Full button', () => {
    expect(autoNote('calm')).toBe('No combat: the Live Feed comes first.');
    expect(autoNote('combat')).toBe('Combat: the turn order and the party come forward.');
    expect(fullButtonLabel('simple')).toBe('Show everything');
    expect(fullButtonLabel('full')).toBe('Show less');
  });
});

describe('the layout hint', () => {
  const base = {
    duringOnScreen: true,
    trialRunning: false,
    sessionKey: '2026-10-10T18:00:00.000Z',
    prefs: prefs(),
  };

  it('shows for an open session on During until a layout is kept', () => {
    expect(showLayoutHint(base)).toBe(true);
  });

  it('stays away until the prefs are known', () => {
    expect(showLayoutHint({ ...base, prefs: undefined })).toBe(false);
  });

  it('stays away off During, in the trial, and without a session start', () => {
    expect(showLayoutHint({ ...base, duringOnScreen: false })).toBe(false);
    expect(showLayoutHint({ ...base, trialRunning: true })).toBe(false);
    expect(showLayoutHint({ ...base, sessionKey: null })).toBe(false);
  });

  it('stays away once a layout was picked or the hint was dismissed', () => {
    expect(showLayoutHint({ ...base, prefs: prefs({ layoutPicked: true }) })).toBe(false);
    expect(showLayoutHint({ ...base, prefs: prefs({ hintDismissed: true }) })).toBe(false);
  });

  it('shows in the first three sessions only; the one on screen keeps showing', () => {
    const seen = ['a', 'b', 'c'].slice(0, LAYOUT_HINT_SESSIONS);
    expect(showLayoutHint({ ...base, prefs: prefs({ hintSessions: seen.slice(0, 2) }) })).toBe(
      true
    );
    expect(showLayoutHint({ ...base, prefs: prefs({ hintSessions: seen }) })).toBe(false);
    expect(showLayoutHint({ ...base, sessionKey: 'b', prefs: prefs({ hintSessions: seen }) })).toBe(
      true
    );
  });

  it('keys a session by its start time, only while it is open', () => {
    expect(hintSessionKey({ open: true, startedAt: '2026-10-10T18:00:00.000Z' })).toBe(
      '2026-10-10T18:00:00.000Z'
    );
    expect(hintSessionKey({ open: true, startedAt: null })).toBeNull();
    expect(hintSessionKey({ open: false, startedAt: '2026-10-10T18:00:00.000Z' })).toBeNull();
  });
});

describe('the prefs', () => {
  it('reads an answer field by field and fills the rest from the defaults', () => {
    expect(
      readPrefs({ duringLayout: 'auto', combatButtons: true, hintSessions: ['x', 5] })
    ).toEqual({ ...DEFAULT_PREFS, duringLayout: 'auto', combatButtons: true, hintSessions: ['x'] });
    expect(readPrefs({ duringLayout: 'sideways', duringFull: 'yes' })).toEqual(DEFAULT_PREFS);
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
  });

  it('applies a change at once, and leaves the hint count to the server', () => {
    expect(applyPrefsChange(prefs(), { duringLayout: 'toggle', layoutPicked: true })).toEqual(
      prefs({ duringLayout: 'toggle', layoutPicked: true })
    );
    expect(applyPrefsChange(prefs(), { hintSession: 'x' })).toEqual(prefs());
  });
});
