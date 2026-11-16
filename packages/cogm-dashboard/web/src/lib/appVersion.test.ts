import { describe, expect, it } from 'vitest';

import { appVersionLabel } from './appVersion';

describe('appVersionLabel', () => {
  it('prefixes a plain version with v', () => {
    expect(appVersionLabel('0.24.0')).toBe('v0.24.0');
    expect(appVersionLabel('1.0.0-rc.1')).toBe('v1.0.0-rc.1');
  });

  it('shows nothing when the build set no version or something odd', () => {
    expect(appVersionLabel('')).toBeNull();
    expect(appVersionLabel('latest')).toBeNull();
    expect(appVersionLabel()).toBeNull();
  });
});
