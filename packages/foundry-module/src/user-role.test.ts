/**
 * Role changes through a guarded write (D-135 part 3): allowed only for the setup feature, only
 * between None and Assistant GM, never on a Gamemaster or the bridge's own user.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SETTABLE_USER_ROLES as SHARED_ROLES } from '../../../shared/src/foundry-setup.js';
import { assertUserRoleChange, assertUserUpdate, SETTABLE_USER_ROLES } from './user-role.js';

const g = globalThis as any;
let saved: unknown;

beforeEach(() => {
  saved = g.game;
  g.game = { user: { id: 'bridge' } };
});
afterEach(() => {
  g.game = saved;
});

const player = { id: 'u1', name: 'Ask', role: 1, isGM: false };

describe('assertUserUpdate', () => {
  it('lets the setup feature, its undo and its rollback change a role', () => {
    for (const feature of ['foundry-setup', 'change-undo', 'rollback']) {
      expect(() => assertUserUpdate(player, ['role'], [], { role: 2 }, feature)).not.toThrow();
    }
  });

  it('refuses any other feature', () => {
    expect(() => assertUserUpdate(player, ['role'], [], { role: 2 }, 'ownership')).toThrow(
      /only changed by the "foundry-setup" feature/
    );
  });

  it('never sets a Gamemaster, a bad number or a non-number', () => {
    for (const role of [4, 5, -1, 1.5, '2', null]) {
      expect(() => assertUserUpdate(player, ['role'], [], { role }, 'foundry-setup')).toThrow(
        /None, Player, Trusted Player or Assistant GM/
      );
    }
  });

  it('never touches a Gamemaster or the bridge user', () => {
    const gm = { id: 'gm', name: 'Danni', role: 4, isGM: true };
    expect(() => assertUserUpdate(gm, ['role'], [], { role: 1 }, 'foundry-setup')).toThrow(
      /Gamemaster/
    );
    const self = { id: 'bridge', name: 'Claude', role: 3, isGM: false };
    expect(() => assertUserUpdate(self, ['role'], [], { role: 1 }, 'foundry-setup')).toThrow(
      /bridge runs as/
    );
  });

  it('keeps refusing permissions and passwords, alone or with a role', () => {
    for (const path of ['permissions', 'permissions.SETTINGS_MODIFY', 'password', '==role']) {
      expect(() => assertUserUpdate(player, [path], [], { [path]: 1 }, 'foundry-setup')).toThrow(
        /cannot be changed/
      );
    }
    expect(() =>
      assertUserUpdate(
        player,
        ['role', 'password'],
        [],
        { role: 2, password: 'x' },
        'foundry-setup'
      )
    ).toThrow(/cannot be changed/);
    expect(() => assertUserUpdate(player, [], ['role'], {}, 'foundry-setup')).toThrow(
      /cannot be unset/
    );
  });

  it('checks the value at plan time without a feature', () => {
    expect(() => assertUserRoleChange(player, { role: 2 })).not.toThrow();
    expect(() => assertUserRoleChange(player, { role: 4 })).toThrow();
    expect(() => assertUserRoleChange(player, { name: 'x' })).not.toThrow();
  });
});

describe('contract', () => {
  it('the module mirrors the shared role table', () => {
    expect(SETTABLE_USER_ROLES).toEqual({ ...SHARED_ROLES });
  });
});
