import { describe, expect, it } from 'vitest';

import { BUILD_ID, toolSetsBuildId } from './build-id.js';
import { TOOL_SETS } from './tool-sets.js';

describe('build id', () => {
  it('is 12 hex characters and stable for the same tool sets', () => {
    expect(BUILD_ID).toMatch(/^[0-9a-f]{12}$/);
    expect(toolSetsBuildId()).toBe(BUILD_ID);
  });

  it('changes when a set lists another tool', () => {
    const changed = { ...TOOL_SETS, core: { tools: [...TOOL_SETS.core.tools, 'new-tool'] } };
    expect(toolSetsBuildId(changed)).not.toBe(BUILD_ID);
  });
});
