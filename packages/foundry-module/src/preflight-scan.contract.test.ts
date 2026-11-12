/**
 * The module mirrors the pre-flight query name (the browser cannot resolve
 * `@gnuminator/shared`). This pins the copy to the shared contract.
 */
import { describe, expect, it } from 'vitest';

import { PREFLIGHT_QUERY as MODULE_QUERY } from './preflight-scan.js';
import { PREFLIGHT_QUERY as SHARED_QUERY } from '@gnuminator/shared';

describe('pre-flight wire contract', () => {
  it('module and shared agree on the query name', () => {
    expect(MODULE_QUERY).toBe(SHARED_QUERY);
  });
});
