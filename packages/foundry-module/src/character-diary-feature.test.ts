import { describe, expect, it } from 'vitest';
import { CHARACTER_DIARY_FEATURE_ID as SHARED_FEATURE } from '@gnuminator/shared';

import { CHARACTER_DIARY_FEATURE_ID } from './character-diary-feature.js';

describe('character diary feature id', () => {
  it('mirrors the shared constant', () => {
    expect(CHARACTER_DIARY_FEATURE_ID).toBe(SHARED_FEATURE);
  });
});
