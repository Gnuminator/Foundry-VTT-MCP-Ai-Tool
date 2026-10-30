import { describe, expect, it } from 'vitest';

import { COMBAT_NEEDS, HANDOUT_NEEDS, offReason, offSwitches } from './liveSwitches';

const list = [
  { id: 'writes', name: 'Allow Write Operations', on: true },
  { id: 'handouts', name: 'AI Tool: Handouts (writes)', on: false },
  { id: 'live-play', name: 'AI Tool: Live play (writes)', on: true },
];

describe('which switches a control still needs', () => {
  it('names nothing when everything the control needs is on', () => {
    expect(offSwitches(COMBAT_NEEDS, true, list)).toEqual([]);
  });

  it('names GM Actions first when it is off', () => {
    expect(offSwitches(HANDOUT_NEEDS, false, list)).toEqual(['GM Actions', 'Handouts (writes)']);
  });

  it('ignores a switch the control does not need', () => {
    expect(offSwitches(COMBAT_NEEDS, true, list)).not.toContain('Handouts (writes)');
  });

  it('ignores module switches until they are read', () => {
    expect(offSwitches(COMBAT_NEEDS, false, null)).toEqual(['GM Actions']);
  });
});

describe('the one-line reason', () => {
  it('reads as a sentence for one, two and three switches', () => {
    expect(offReason([])).toBe('');
    expect(offReason(['GM Actions'])).toBe('GM Actions is off');
    expect(offReason(['GM Actions', 'Handouts'])).toBe('GM Actions and Handouts are off');
    expect(offReason(['A', 'B', 'C'])).toBe('A, B and C are off');
  });
});
