/**
 * The module mirrors the Foundry setup values of the shared contract (the browser cannot resolve
 * `@gnuminator/shared`). This pins the copies.
 */
import { describe, expect, it } from 'vitest';
import {
  FOUNDRY_SETUP_FEATURE_ID as SHARED_FEATURE,
  MODULE_CONFIG_SETTING as SHARED_MODULE_CONFIG,
  PACK_UUID_PREFIX as SHARED_PACK_PREFIX,
  SETTING_UUID_PREFIX as SHARED_SETTING_PREFIX,
} from '../../../../shared/src/foundry-setup.js';
import {
  MODULE_CONFIG_SETTING,
  PACK_UUID_PREFIX,
  SETTING_UUID_PREFIX,
  SETUP_FEATURE_ID,
} from './virtual-targets.js';

describe('foundry setup contract', () => {
  it('module and shared agree on the feature id, the uuid prefixes and the module list setting', () => {
    expect(SETUP_FEATURE_ID).toBe(SHARED_FEATURE);
    expect(SETTING_UUID_PREFIX).toBe(SHARED_SETTING_PREFIX);
    expect(PACK_UUID_PREFIX).toBe(SHARED_PACK_PREFIX);
    expect(MODULE_CONFIG_SETTING).toBe(SHARED_MODULE_CONFIG);
  });
});
