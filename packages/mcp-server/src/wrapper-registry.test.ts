import { describe, expect, it } from 'vitest';

import { WrapperRegistry, isOlderVersion } from './wrapper-registry.js';

describe('isOlderVersion', () => {
  it('compares numeric parts', () => {
    expect(isOlderVersion('0.23.9', '0.24.0')).toBe(true);
    expect(isOlderVersion('0.24.0', '0.24.0')).toBe(false);
    expect(isOlderVersion('0.9.0', '0.10.0')).toBe(true);
    expect(isOlderVersion('1.0.0', '0.24.0')).toBe(false);
  });
});

describe('WrapperRegistry', () => {
  it('is not behind with no wrappers or a current one', () => {
    const reg = new WrapperRegistry('0.25.0');
    expect(reg.status().behind).toBe(false);
    reg.hello(1, { version: '0.25.0', sets: 'core' });
    expect(reg.status()).toMatchObject({ behind: false, current: '0.25.0' });
  });

  it('is behind for an older wrapper', () => {
    const reg = new WrapperRegistry('0.25.0');
    reg.hello(1, { version: '0.24.0', sets: 'all' });
    expect(reg.status().behind).toBe(true);
  });

  it('treats a tool call without hello as an old wrapper, but not one that said hello', () => {
    const reg = new WrapperRegistry('0.25.0');
    reg.hello(1, { version: '0.25.0', sets: 'all' });
    reg.toolCallWithoutRequester(1);
    expect(reg.status().behind).toBe(false);
    reg.toolCallWithoutRequester(2);
    expect(reg.status().wrappers).toHaveLength(2);
    expect(reg.status().behind).toBe(true);
  });

  it('never counts the dashboard, which says hello as itself', () => {
    const reg = new WrapperRegistry('0.25.0');
    reg.hello(3, { client: 'dashboard', version: '0.25.0' });
    reg.toolCallWithoutRequester(3);
    expect(reg.status()).toMatchObject({ wrappers: [], behind: false });
  });

  it('keeps a newer wrapper out of "behind"', () => {
    const reg = new WrapperRegistry('0.25.0');
    reg.hello(1, { version: '0.26.0', sets: 'all' });
    expect(reg.status().behind).toBe(false);
  });

  it('forgets a closed connection', () => {
    const reg = new WrapperRegistry('0.25.0');
    reg.toolCallWithoutRequester(2);
    reg.close(2);
    expect(reg.status()).toMatchObject({ wrappers: [], behind: false });
  });
});
