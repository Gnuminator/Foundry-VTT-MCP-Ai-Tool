import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveObsidianVaultName } from './config.js';

describe('resolveObsidianVaultName', () => {
  it('prefers an explicit vault name', () => {
    expect(resolveObsidianVaultName('My Vault', 'C:\\Users\\gm\\Documents\\Obsidian\\vault')).toBe(
      'My Vault'
    );
  });

  it('falls back to the basename of the Obsidian dir when no vault name is set', () => {
    expect(resolveObsidianVaultName('', 'C:\\Users\\gm\\Documents\\Obsidian\\vault')).toBe('vault');
  });

  it('trims a trailing separator off the Obsidian dir', () => {
    expect(resolveObsidianVaultName('', 'C:\\Users\\gm\\Documents\\Obsidian\\vault\\')).toBe(
      'vault'
    );
  });

  it('is off (empty) when neither is set', () => {
    expect(resolveObsidianVaultName('', '')).toBe('');
    expect(resolveObsidianVaultName('   ', '   ')).toBe('');
  });

  it('trims whitespace off an explicit vault name', () => {
    expect(resolveObsidianVaultName('  My Vault  ', '')).toBe('My Vault');
  });
});

describe('DASHBOARD_ALLOWED_HOSTS', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** A fresh `config` read with this value in the environment. */
  async function allowedHostsFor(value: string): Promise<unknown> {
    vi.stubEnv('DASHBOARD_ALLOWED_HOSTS', value);
    vi.resetModules();
    const fresh = await import('./config.js');
    return fresh.config.allowedHosts;
  }

  it('adds nothing when unset or blank', async () => {
    expect(await allowedHostsFor('')).toEqual({ entries: [], ignored: [] });
    expect(await allowedHostsFor(' , ')).toEqual({ entries: [], ignored: [] });
  });

  it('reads comma-separated names and name:port, and counts the invalid ones', async () => {
    expect(await allowedHostsFor(' Cogm.Example.com , pi.local:3000, *.bad.example ')).toEqual({
      entries: [
        { hostname: 'cogm.example.com', port: null },
        { hostname: 'pi.local', port: 3000 },
      ],
      ignored: [3],
    });
  });
});
