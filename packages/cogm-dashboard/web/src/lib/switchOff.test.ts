import { describe, expect, it } from 'vitest';
import { featureOffMessage, WRITES_OFF_MESSAGE } from '../../../../../shared/src/switch-off.js';
import { handoutsSwitchOff, isSwitchOffRefusal, refusedSwitchName } from './switchOff';

describe('handoutsSwitchOff', () => {
  const on = { id: 'handouts', name: 'AI Tool: Handouts (writes)', enabled: true };

  it('says nothing when both switches are on or the list is unknown', () => {
    expect(handoutsSwitchOff({ features: [on], writesAllowed: true })).toBeNull();
    expect(handoutsSwitchOff(null)).toBeNull();
    expect(handoutsSwitchOff({ features: null, writesAllowed: null })).toBeNull();
  });

  it('names the Handouts switch and where it is', () => {
    expect(handoutsSwitchOff({ features: [{ ...on, enabled: false }], writesAllowed: true })).toBe(
      'Revealing is refused: "AI Tool: Handouts (writes)" is switched off. In Foundry, open Game Settings, Configure Settings, AI Tool and turn on "AI Tool: Handouts (writes)". You can still queue and reorder pages.'
    );
  });

  it('names Allow Write Operations first when it is off', () => {
    expect(
      handoutsSwitchOff({ features: [{ ...on, enabled: false }], writesAllowed: false })
    ).toMatch(/"Allow Write Operations" is off/);
  });
});

describe('refusedSwitchName', () => {
  it('names the feature switch or the master switch a refusal points at', () => {
    expect(refusedSwitchName(featureOffMessage('AI Tool: Handouts (writes)'))).toBe(
      'AI Tool: Handouts (writes)'
    );
    expect(refusedSwitchName(WRITES_OFF_MESSAGE)).toBe('Allow Write Operations');
    expect(refusedSwitchName('Conflict, nothing was written')).toBeNull();
  });

  it('matches the words of the shared constants (module, bridge and dashboard agree)', () => {
    expect(isSwitchOffRefusal(featureOffMessage('AI Tool: Party (writes)'))).toBe(true);
    expect(isSwitchOffRefusal(WRITES_OFF_MESSAGE)).toBe(true);
  });
});

describe('isSwitchOffRefusal', () => {
  it('knows a feature switch that is off, as the module and the bridge word it', () => {
    expect(
      isSwitchOffRefusal(
        '"AI Tool: Handouts (writes)" is switched off. In Foundry, open Game Settings, Configure Settings, AI Tool and turn on "AI Tool: Handouts (writes)".'
      )
    ).toBe(true);
    expect(
      isSwitchOffRefusal(
        'Error: "AI Tool: Handouts (writes)" is switched off. In Foundry, open Game Settings, Configure Settings, AI Tool and turn on "AI Tool: Handouts (writes)".'
      )
    ).toBe(true);
  });

  it('knows "Allow Write Operations" being off', () => {
    expect(
      isSwitchOffRefusal(
        'Write operations are disabled in the module settings. In Foundry, open Game Settings, Configure Settings, AI Tool and turn on "Allow Write Operations".'
      )
    ).toBe(true);
  });

  it('leaves real failures alone', () => {
    expect(isSwitchOffRefusal('Conflict, nothing was written: Actor changed')).toBe(false);
    expect(isSwitchOffRefusal('The change journal is switched off on this bridge')).toBe(false);
  });
});
