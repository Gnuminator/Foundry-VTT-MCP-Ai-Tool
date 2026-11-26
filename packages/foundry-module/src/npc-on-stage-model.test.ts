import { describe, expect, it } from 'vitest';

import { parseOnStage, safeImagePath, stageCaption, stageLabel } from './npc-on-stage-model.js';

describe('npc on stage model', () => {
  it('shows the name only when the players know it', () => {
    expect(stageLabel('Hrafne', null, false)).toBeNull();
    expect(stageLabel('Hrafne', 'Hrafne', false)).toBe('Hrafne');
    expect(stageLabel('Hrafne', null, true)).toBe('Hrafne');
    expect(stageLabel('  ', null, true)).toBeNull();
  });

  it('shows a question mark while the name is not known', () => {
    expect(stageCaption({ actorId: 'a', label: null, img: null, at: 1 })).toBe('?');
    expect(stageCaption({ actorId: 'a', label: 'Hrafne', img: null, at: 1 })).toBe('Hrafne');
  });

  it('refuses picture paths that are not files or web addresses', () => {
    expect(safeImagePath('worlds/x/hrafne.webp')).toBe('worlds/x/hrafne.webp');
    expect(safeImagePath('javascript:alert(1)')).toBeNull();
    expect(safeImagePath('data:image/png;base64,AAAA')).toBeNull();
    expect(safeImagePath('a" onerror="x')).toBeNull();
    expect(safeImagePath(42)).toBeNull();
  });

  it('reads the stored setting and treats anything else as nobody on stage', () => {
    expect(parseOnStage({})).toBeNull();
    expect(parseOnStage(null)).toBeNull();
    expect(parseOnStage({ actorId: 'a1', label: 'Hrafne', img: 'x.webp', at: 5 })).toEqual({
      actorId: 'a1',
      label: 'Hrafne',
      img: 'x.webp',
      at: 5,
    });
    expect(parseOnStage({ actorId: 'a1', label: '' })?.label).toBeNull();
  });
});
