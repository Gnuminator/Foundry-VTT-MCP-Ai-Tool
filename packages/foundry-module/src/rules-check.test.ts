import { describe, expect, it } from 'vitest';
import { RULES_CHECK_FEATURE_ID as SHARED_FEATURE } from '@gnuminator/shared';
import { RULES_CHECK_FEATURE_ID } from './rules-check.js';

describe('rules check feature id', () => {
  it('mirrors the shared id', () => {
    expect(RULES_CHECK_FEATURE_ID).toBe(SHARED_FEATURE);
  });
});
