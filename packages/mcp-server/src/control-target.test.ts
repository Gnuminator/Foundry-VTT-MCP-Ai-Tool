import { describe, expect, it } from 'vitest';

import {
  bridgeUnreachableMessage,
  isLoopbackHost,
  resolveControlTarget,
} from './control-target.js';

describe('resolveControlTarget (PB-01)', () => {
  it('defaults to 127.0.0.1:31414 and may spawn', () => {
    expect(resolveControlTarget({})).toEqual({
      host: '127.0.0.1',
      port: 31414,
      spawnAllowed: true,
    });
  });

  it('reads host and port', () => {
    expect(
      resolveControlTarget({ MCP_CONTROL_HOST: 'localhost', MCP_CONTROL_PORT: '31514' })
    ).toEqual({ host: 'localhost', port: 31514, spawnAllowed: true });
  });

  it('falls back to 31414 for a bad port', () => {
    expect(resolveControlTarget({ MCP_CONTROL_PORT: 'abc' }).port).toBe(31414);
    expect(resolveControlTarget({ MCP_CONTROL_PORT: '99999' }).port).toBe(31414);
  });

  it('never spawns with MCP_NO_SPAWN=1 or true', () => {
    expect(resolveControlTarget({ MCP_NO_SPAWN: '1' }).spawnAllowed).toBe(false);
    expect(resolveControlTarget({ MCP_NO_SPAWN: 'TRUE' }).spawnAllowed).toBe(false);
    expect(resolveControlTarget({ MCP_NO_SPAWN: '0' }).spawnAllowed).toBe(true);
    expect(resolveControlTarget({ MCP_NO_SPAWN: '' }).spawnAllowed).toBe(true);
  });

  it('never spawns for a non-loopback host', () => {
    const t = resolveControlTarget({ MCP_CONTROL_HOST: '100.64.0.7', MCP_CONTROL_PORT: '31414' });
    expect(t).toEqual({ host: '100.64.0.7', port: 31414, spawnAllowed: false });
    expect(resolveControlTarget({ MCP_CONTROL_HOST: 'orangepi' }).spawnAllowed).toBe(false);
  });

  it('knows the loopback names', () => {
    for (const h of ['127.0.0.1', '::1', '[::1]', 'localhost', 'LOCALHOST']) {
      expect(isLoopbackHost(h)).toBe(true);
    }
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
  });

  it('words the error for a missing bridge', () => {
    expect(bridgeUnreachableMessage('100.64.0.7', 31414)).toBe(
      'The Foundry AI Tool bridge is not reachable at 100.64.0.7:31414. Start it (or check the address) and try again.'
    );
  });
});
