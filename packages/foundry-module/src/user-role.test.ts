/**
 * Role changes through a guarded write (D-135 part 3): allowed only for the setup feature, only
 * between None and Assistant GM, never on a Gamemaster or the bridge's own user.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SETTABLE_USER_ROLES as SHARED_ROLES } from '../../../shared/src/foundry-setup.js';
import { registerGuardedFeature, resetGuardedFeaturesForTests } from './guarded-features.js';
import { assertUserRoleChange, assertUserUpdate, SETTABLE_USER_ROLES } from './user-role.js';

const g = globalThis as any;
let saved: unknown;

let setupSwitch = true;

beforeEach(() => {
  saved = g.game;
  setupSwitch = true;
  g.game = {
    user: { id: 'bridge' },
    settings: { register: (): undefined => undefined, get: (): boolean => setupSwitch },
  };
  resetGuardedFeaturesForTests();
  registerGuardedFeature({ id: 'foundry-setup', name: 'Foundry setup', hint: 'Test.' });
});
afterEach(() => {
  g.game = saved;
  resetGuardedFeaturesForTests();
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

  it('keeps the shared table viewer login at Player or below', () => {
    const table = {
      id: 'u9',
      name: 'Table',
      role: 1,
      flags: { 'foundry-mcp-bridge': { tableViewer: true } },
    };
    expect(() => assertUserUpdate(table, ['role'], [], { role: 3 }, 'foundry-setup')).toThrow(
      /table viewer login/
    );
    expect(() => assertUserUpdate(table, ['role'], [], { role: 0 }, 'foundry-setup')).not.toThrow();
    expect(() => assertUserUpdate(table, ['role'], [], { role: 1 }, 'foundry-setup')).not.toThrow();
  });

  it('refuses to change the table viewer flag, so the Player cap cannot be got around in two steps', () => {
    const table = {
      id: 'u9',
      name: 'Table',
      role: 1,
      flags: { 'foundry-mcp-bridge': { tableViewer: true } },
    };
    for (const path of [
      'flags.foundry-mcp-bridge.tableViewer',
      'flags.foundry-mcp-bridge',
      'flags',
      '==flags',
      'flags.==foundry-mcp-bridge',
      'flags.foundry-mcp-bridge.==tableViewer',
      'flags.foundry-mcp-bridge.-=tableViewer',
    ]) {
      expect(() => assertUserUpdate(table, [path], [], { [path]: false }, 'foundry-setup')).toThrow(
        /table viewer flag/
      );
    }
    expect(() =>
      assertUserUpdate(table, [], ['flags.foundry-mcp-bridge.tableViewer'], {}, 'foundry-setup')
    ).toThrow(/table viewer flag/);
    // another user's flags are not this rule's business
    expect(() =>
      assertUserUpdate(player, ['flags.other.x'], [], { 'flags.other.x': 1 }, 'foundry-setup')
    ).not.toThrow();
  });

  it('lets an undo raise a role whether or not the setup switch is on (one rule on both routes)', () => {
    setupSwitch = false;
    for (const feature of ['change-undo', 'rollback']) {
      expect(() => assertUserUpdate(player, ['role'], [], { role: 2 }, feature)).not.toThrow();
      expect(() => assertUserUpdate(player, ['role'], [], { role: 0 }, feature)).not.toThrow();
    }
    setupSwitch = true;
    expect(() => assertUserUpdate(player, ['role'], [], { role: 2 }, 'change-undo')).not.toThrow();
  });

  it('lets an Assistant GM be changed although Foundry calls it a GM', () => {
    const assistant = { id: 'a1', name: 'Assistant GM', role: 3, isGM: true };
    expect(() =>
      assertUserUpdate(assistant, ['role'], [], { role: 1 }, 'foundry-setup')
    ).not.toThrow();
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
