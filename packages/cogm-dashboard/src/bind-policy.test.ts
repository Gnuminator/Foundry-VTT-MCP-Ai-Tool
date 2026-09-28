import { describe, expect, it } from 'vitest';

import { bindRefusal, isLoopbackHost } from './bind-policy.js';

describe('dashboard bind policy', () => {
  it('recognises loopback hosts', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]']) {
      expect(isLoopbackHost(h)).toBe(true);
    }
    for (const h of ['0.0.0.0', '::', '192.168.1.20', 'pi.local', '1127.0.0.1']) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });

  it('allows loopback always, and other interfaces only with a GM token', () => {
    expect(bindRefusal('127.0.0.1', '')).toBeNull();
    expect(bindRefusal('0.0.0.0', 'secret')).toBeNull();
    expect(bindRefusal('0.0.0.0', '')).toMatch(/Refusing to listen on 0.0.0.0/);
    expect(bindRefusal('192.168.1.20', '   ')).toMatch(/GM_DASHBOARD_TOKEN/);
  });
});
