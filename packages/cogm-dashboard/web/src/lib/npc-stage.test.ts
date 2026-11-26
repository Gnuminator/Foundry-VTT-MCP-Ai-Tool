import { describe, expect, it } from 'vitest';

import { combatNpcNames, stageArgs, stageStatus } from './npc-stage';

describe('npc stage', () => {
  it('builds the tool arguments from a picked actor or a combat name', () => {
    expect(stageArgs({ actorId: 'a1' }, false)).toEqual({ actorId: 'a1' });
    expect(stageArgs({ actorName: 'Wolf' }, true)).toEqual({ actorName: 'Wolf', nameKnown: true });
  });

  it('says who is on stage and what the TV shows', () => {
    expect(stageStatus(null)).toBe('Nobody on stage.');
    expect(stageStatus({ onStage: { actorId: 'a', name: 'Hrafne', nameShown: true } })).toContain(
      'shows the name'
    );
    expect(stageStatus({ onStage: { actorId: 'a', name: 'Hrafne', nameShown: false } })).toContain(
      '"?"'
    );
  });

  it('lists the living NPCs of the fight once each', () => {
    expect(
      combatNpcNames([
        { name: 'Jorr', isPC: true, defeated: false },
        { name: 'Wolf', isPC: false, defeated: false },
        { name: 'Wolf', isPC: false, defeated: false },
        { name: 'Bat', isPC: false, defeated: true },
      ])
    ).toEqual(['Wolf']);
  });
});
