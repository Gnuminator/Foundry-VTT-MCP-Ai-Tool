import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTROL_PORT } from '@gnuminator/shared';
import { lockFileFor } from './backend-lock.js';

describe('lockFileFor', () => {
  it('keeps the original lock name for the default control port', () => {
    expect(lockFileFor(DEFAULT_CONTROL_PORT)).toBe(
      path.join(os.tmpdir(), 'foundry-mcp-backend.lock')
    );
  });

  it('scopes the lock name by port for any other port', () => {
    expect(lockFileFor(31514)).toBe(path.join(os.tmpdir(), 'foundry-mcp-backend-31514.lock'));
  });
});
