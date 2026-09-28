import { describe, expect, it } from 'vitest';

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
