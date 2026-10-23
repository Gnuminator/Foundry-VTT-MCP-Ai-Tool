/**
 * The module mirrors the Table viewer values of the shared contract (the browser cannot resolve
 * `@gnuminator/shared`). This pins the copies, and tests the User-create allowlist and the flag.
 */
import { describe, expect, it } from 'vitest';
import {
  TABLE_VIEWER_FEATURE_ID as SHARED_FEATURE,
  TABLE_VIEWER_FLAG as SHARED_FLAG,
  TABLE_VIEWER_ROLE as SHARED_ROLE,
} from '../../../shared/src/table-viewer.js';
import {
  assertUserCreateAllowed,
  assertUserUpdateAllowed,
  isTablePlayer,
  isTableViewerUser,
  TABLE_VIEWER_FEATURE_ID,
  TABLE_VIEWER_FLAG,
  TABLE_VIEWER_ROLE,
} from './table-viewer-user.js';

describe('table viewer contract', () => {
  it('module and shared agree on the flag, role and feature id', () => {
    expect(TABLE_VIEWER_FLAG).toBe(SHARED_FLAG);
    expect(TABLE_VIEWER_ROLE).toBe(SHARED_ROLE);
    expect(TABLE_VIEWER_FEATURE_ID).toBe(SHARED_FEATURE);
  });
});

describe('isTableViewerUser', () => {
  it('reads the flag from the data or from getFlag', () => {
    expect(isTableViewerUser({ flags: { 'foundry-mcp-bridge': { tableViewer: true } } })).toBe(
      true
    );
    expect(
      isTableViewerUser({
        getFlag: (s: string, k: string) => s === 'foundry-mcp-bridge' && k === 'tableViewer',
      })
    ).toBe(true);
    expect(isTableViewerUser({ flags: {} })).toBe(false);
    expect(isTableViewerUser({ getFlag: () => undefined })).toBe(false);
    expect(isTableViewerUser(null)).toBe(false);
  });

  it('isTablePlayer is a non-GM user without the flag', () => {
    expect(isTablePlayer({ isGM: false })).toBe(true);
    expect(isTablePlayer({ isGM: true })).toBe(false);
    expect(
      isTablePlayer({ isGM: false, flags: { 'foundry-mcp-bridge': { tableViewer: true } } } as any)
    ).toBe(false);
  });
});

describe('assertUserCreateAllowed', () => {
  const table = { name: 'Table', role: 1 };

  it('accepts the Table user from the table-viewer feature, and its undo and rollback', () => {
    for (const feature of ['table-viewer', 'change-undo', 'rollback']) {
      expect(() => assertUserCreateAllowed(feature, table)).not.toThrow();
    }
  });

  it('accepts the recorded source of a deleted Table user (an empty password is the default)', () => {
    expect(() =>
      assertUserCreateAllowed('change-undo', { ...table, password: '', passwordSalt: null })
    ).not.toThrow();
  });

  it('refuses any other feature', () => {
    expect(() => assertUserCreateAllowed('actors', table)).toThrow(
      /only allowed for the "table-viewer"/
    );
    expect(() => assertUserCreateAllowed('session-notes', table)).toThrow();
  });

  it('refuses a role above Player, a non-number role, and a password', () => {
    for (const role of [2, 3, 4, '1', null, -1]) {
      expect(() => assertUserCreateAllowed('table-viewer', { name: 'x', role })).toThrow(/role/);
    }
    expect(() =>
      assertUserCreateAllowed('table-viewer', { ...table, password: 'hunter2' })
    ).toThrow(/password/);
    expect(() =>
      assertUserCreateAllowed('table-viewer', { ...table, passwordSalt: 'abc' })
    ).toThrow(/passwordSalt/);
  });

  it('accepts empty permissions and false overrides, refuses a true override', () => {
    expect(() =>
      assertUserCreateAllowed('change-undo', { ...table, permissions: {} })
    ).not.toThrow();
    expect(() =>
      assertUserCreateAllowed('change-undo', { ...table, permissions: { SETTINGS_MODIFY: false } })
    ).not.toThrow();
    expect(() =>
      assertUserCreateAllowed('table-viewer', { ...table, permissions: { SETTINGS_MODIFY: true } })
    ).toThrow(/permission override/);
    expect(() => assertUserCreateAllowed('table-viewer', { ...table, permissions: 'x' })).toThrow(
      /permissions/
    );
  });
});

describe('assertUserCreateAllowed: other spellings Foundry reads on create', () => {
  const table = { name: 'Table', role: 1 };

  it('refuses dotted and operator keys, also inside permissions', () => {
    for (const extra of [
      { 'permissions.SETTINGS_MODIFY': true },
      { '==role': 4 },
      { '-=role': null },
      { '==permissions': { SETTINGS_MODIFY: true } },
      { '==password': 'x' },
      { permissions: { '==SETTINGS_MODIFY': false } },
      { permissions: { 'A.B': false } },
      {
        permissions: {
          __$OPERATOR$__: 'ForcedReplacement',
          value: { SETTINGS_MODIFY: true },
        },
      },
      {
        permissions: {
          SETTINGS_MODIFY: { __$OPERATOR$__: 'ForcedReplacement', value: true },
        },
      },
    ]) {
      expect(() => assertUserCreateAllowed('table-viewer', { ...table, ...extra })).toThrow();
    }
  });
});

describe('assertUserUpdateAllowed', () => {
  it('refuses a change of role, permissions, password or passwordSalt, also by path or unset', () => {
    for (const path of [
      'role',
      'permissions',
      'permissions.SETTINGS_MODIFY',
      'permissions.-=SETTINGS_MODIFY',
      '-=permissions',
      '==permissions',
      '==role',
      '==password',
      'password',
      'passwordSalt',
    ]) {
      expect(() => assertUserUpdateAllowed([path])).toThrow(/cannot be changed/);
      expect(() => assertUserUpdateAllowed([], [path])).toThrow(/cannot be changed/);
    }
  });

  it('accepts other fields (name, flags)', () => {
    expect(() =>
      assertUserUpdateAllowed(['name', 'flags.foundry-mcp-bridge.tableViewer', 'roleNote'])
    ).not.toThrow();
  });
});
