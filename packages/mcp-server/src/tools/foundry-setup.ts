import { z } from 'zod';
import {
  FOUNDRY_SETUP_AREAS,
  FOUNDRY_SETUP_FEATURE_ID,
  FOUNDRY_SETUP_MODES,
  MODULE_CONFIG_SETTING,
  MODULE_ID,
  PACK_OWNERSHIP_LEVELS,
  PACK_OWNERSHIP_ROLES,
  PACK_UUID_PREFIX,
  SETTABLE_USER_ROLES,
  SETTING_UUID_PREFIX,
  SETUP_OWNERSHIP_TYPES,
  USER_UUID_PREFIX,
  type SettableUserRole,
  freeText,
  unwrapBridgeReply,
  type GuardedOp,
} from '@gnuminator/shared';
import { FoundryClient } from '../foundry-client.js';
import type { GuardedWriteService, PlanView } from '../guarded-write/service.js';
import { Logger } from '../logger.js';

export interface FoundrySetupToolsOptions {
  foundryClient: FoundryClient;
  guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  logger: Logger;
}

const params = z.object({
  mode: z.enum(FOUNDRY_SETUP_MODES),
  area: z.enum(FOUNDRY_SETUP_AREAS),
  target: z.string().optional(),
  value: z.unknown().optional(),
});

const packValue = z
  .object({
    ownership: z
      .object(
        Object.fromEntries(
          PACK_OWNERSHIP_ROLES.map(role => [role, z.enum(PACK_OWNERSHIP_LEVELS).optional()])
        ) as Record<
          (typeof PACK_OWNERSHIP_ROLES)[number],
          z.ZodOptional<z.ZodEnum<['NONE', 'LIMITED', 'OBSERVER', 'OWNER']>>
        >
      )
      .strict()
      .optional(),
    locked: z.boolean().optional(),
    folder: z.string().nullable().optional(),
  })
  .strict();

interface SettingRow {
  id: string;
  name: string;
  scope: string;
  type: string;
  config: boolean;
  requiresReload: boolean;
  default?: unknown;
  choices?: Record<string, unknown>;
  range?: { min?: number; max?: number; step?: number };
  redacted?: true;
  tooLong?: true;
  valueError?: string;
  value?: unknown;
}

interface PackRow {
  id: string;
  label: string;
  ownership: Record<string, string> | null;
  configured: Record<string, unknown>;
  locked: boolean;
  folder: { id: string | null; name: string | null } | null;
}

interface ModuleRow {
  id: string;
  title: string;
  active: boolean;
  requires: Array<{ id: string; installed: boolean; active: boolean }>;
  /** Active modules that require this one. */
  requiredBy: string[];
  /** Foundry keeps this module on: the world or the system requires it. */
  forcedOn?: 'world' | 'system';
  /** Foundry marks it unavailable (core version, dependencies): it cannot be used here. */
  unavailable?: boolean;
}

interface UserRow {
  id: string;
  name: string;
  role: string;
  isGM: boolean;
}

interface OwnershipDocRow {
  id: string;
  name: string;
  default: string;
  /** Per user id (two users may share a name). */
  users: Record<string, { name: string; level: string }>;
}

interface SetupInfo {
  area: string;
  /** 2 on the module and ownership reads of this version; an older module leaves it out. */
  shape?: number;
  settings?: SettingRow[];
  packs?: PackRow[];
  modules?: ModuleRow[];
  /** The module list holds more data than a plan can read back. */
  listTooLarge?: boolean;
  users?: UserRow[];
  documents?: OwnershipDocRow[];
  folders?: Array<{ id: string; name: string }>;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Foundry setup (D-135, "god-mode for setup"): one read and plan tool for a world or client
 * setting and for a compendium pack's configuration. Each change is a guarded update of a pseudo
 * uuid the bridge understands (`GameSetting.<ns>.<key>`, `PackConfig.<packId>`), applied with
 * apply-planned-change and reverted with undo-change. Secret settings are never read or written.
 */
export class FoundrySetupTools {
  private foundryClient: FoundryClient;
  private guardedWrites: Pick<GuardedWriteService, 'createPlan'>;
  private logger: Logger;

  constructor({ foundryClient, guardedWrites, logger }: FoundrySetupToolsOptions) {
    this.foundryClient = foundryClient;
    this.guardedWrites = guardedWrites;
    this.logger = logger.child({ component: 'FoundrySetupTools' });
  }

  getToolDefinitions(): Array<{ name: string; description: string; inputSchema: unknown }> {
    return [
      {
        name: 'plan-foundry-setup',
        description:
          'Read or plan Foundry setup; apply with apply-planned-change, revert with undo-change. mode read lists, plan plans. area user: target a user name, value {role: NONE|PLAYER|TRUSTED|ASSISTANT} (read lists users, roles, actors; a Gamemaster is never changed; a role change signs them out; same name twice: use the id). area ownership: target journal:name or scene:name, value {default, users:{name or id: level}} (not actors). area module: target a module id or title (read lists all: on/off, requires, required by), value true or false; needed modules go on or dependents off with it, and windows reload on apply and undo. area setting: target namespace.key (read: partial name). area pack: target a pack id, value {ownership:{PLAYER,TRUSTED: NONE|LIMITED|OBSERVER|OWNER, ASSISTANT: OWNER only; a role gets the highest level of itself and lower roles}, locked, folder (name/null)}. Secrets are hidden. Needs the Foundry setup switch.',
        inputSchema: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: [...FOUNDRY_SETUP_MODES] },
            area: { type: 'string', enum: [...FOUNDRY_SETUP_AREAS] },
            target: {
              type: 'string',
              description:
                'Setting key, pack id, module id or title, user name or id, journal:name or scene:name.',
              ...freeText('a key or id the read mode lists'),
            },
            value: { description: 'plan only: the new value, or the pack changes.' },
          },
          required: ['mode', 'area'],
        },
      },
    ];
  }

  async handleToolCall(
    name: string,
    args: unknown
  ): Promise<PlanView & { notes: string[]; autoApply: false }> {
    if (name !== 'plan-foundry-setup') throw new Error(`Unknown foundry setup tool: ${name}`);
    return this.planFoundrySetup(args) as Promise<PlanView & { notes: string[]; autoApply: false }>;
  }

  private async info(area: string, target: string | undefined): Promise<SetupInfo> {
    const reply = unwrapBridgeReply(
      (await this.foundryClient.query('foundry-mcp-bridge.getSetupInfo', {
        area,
        target,
      })) as SetupInfo,
      'Setup read refused'
    );
    // An older module reads these two areas in another shape (a plan on it would be wrong).
    if ((area === 'module' || area === 'ownership') && reply.shape !== 2) {
      throw new Error(
        'The Foundry module is older than this server and reads modules and ownership differently; update the module in Foundry first'
      );
    }
    return reply;
  }

  private async planFoundrySetup(args: unknown): Promise<unknown> {
    const p = params.parse(args ?? {});
    if (p.mode === 'read') {
      if (p.value !== undefined) throw new Error('value is for mode plan; read takes no value');
      return this.info(p.area, p.target);
    }
    if (!p.target) throw new Error('Plan mode needs a target');
    if (p.value === undefined) throw new Error('Plan mode needs a value');
    if (p.area === 'setting') return this.planSetting(p.target, p.value);
    if (p.area === 'module') return this.planModule(p.target, p.value);
    if (p.area === 'user') return this.planUser(p.target, p.value);
    if (p.area === 'ownership') return this.planOwnership(p.target, p.value);
    return this.planPack(p.target, p.value);
  }

  /** A user's role: one update of `User.<id>` path `role`. Never a Gamemaster, never the bridge user. */
  private async planUser(target: string, raw: unknown): Promise<unknown> {
    const value = z
      .object({ role: z.enum(Object.keys(SETTABLE_USER_ROLES) as [string, ...string[]]) })
      .strict()
      .parse(raw);
    const users = (await this.info('user', target.trim())).users ?? [];
    const wanted = target.trim().toLowerCase();
    const matches = users.filter(u => u.id === target.trim() || u.name.toLowerCase() === wanted);
    if (matches.length > 1) {
      throw new Error(
        `More than one user is called "${target}" (ids ${matches.map(u => u.id).join(', ')}): give the id as the target`
      );
    }
    const user = matches[0];
    if (!user) {
      const near = users.map(u => u.name).join(', ');
      throw new Error(`No user "${target}"${near ? ` (did you mean ${near}?)` : ''}`);
    }
    // Foundry's isGM is true for an Assistant GM too, which may be changed: only the role counts.
    if (user.role === 'GAMEMASTER') {
      throw new Error(`${user.name} is a Gamemaster; the AI Tool never changes a Gamemaster`);
    }
    if (user.role === value.role) {
      throw new Error(`Nothing to change: ${user.name} already has the role ${user.role}`);
    }
    const role = SETTABLE_USER_ROLES[value.role as SettableUserRole];
    const notes = [
      'Only None, Player, Trusted Player and Assistant GM can be set; a Gamemaster is never made or changed here. Passwords are never read or set.',
    ];
    if (value.role === 'ASSISTANT') {
      notes.push(
        'An Assistant GM sees and changes most of the world: give it to a person you trust.'
      );
    }
    notes.push(
      `Foundry signs ${user.name} out when the role changes, so they log in again. ${value.role === 'NONE' ? 'None means they cannot log in at all.' : ''}`.trim()
    );
    const plan = await this.guardedWrites.createPlan({
      feature: FOUNDRY_SETUP_FEATURE_ID,
      summary: `Change ${user.name}'s role: ${user.role} to ${value.role}`,
      ops: [{ kind: 'update', uuid: `${USER_UUID_PREFIX}${user.id}`, changes: { role } }],
      pathLabels: { role: `role of ${user.name}` },
      notes,
    });
    this.logger.info(`Planned role change for ${user.name}`);
    return { ...plan, notes, autoApply: false };
  }

  /**
   * Who may see or edit a world journal or scene: the default level and per-user levels, one
   * update of `ownership.default` and `ownership.<userId>`. Actors have plan-ownership-change.
   */
  private async planOwnership(target: string, raw: unknown): Promise<unknown> {
    const levels = z.enum(PACK_OWNERSHIP_LEVELS);
    const value = z
      .object({ default: levels.optional(), users: z.record(levels).optional() })
      .strict()
      .parse(raw);
    if (value.default === undefined && !value.users) {
      throw new Error('Give a default level, users with levels, or both');
    }
    const [kind, ...rest] = target.split(':');
    const name = rest.join(':').trim();
    if (!(SETUP_OWNERSHIP_TYPES as readonly string[]).includes(kind?.trim() ?? '') || !name) {
      throw new Error('An ownership target is journal:<name or id> or scene:<name or id>');
    }
    const info = await this.info('ownership', `${kind?.trim()}:${name}`);
    const docs = info.documents ?? [];
    const exact = docs.filter(d => d.id === name || d.name.toLowerCase() === name.toLowerCase());
    const found = exact.length === 1 ? exact : docs;
    if (found.length === 0) throw new Error(`No ${kind} matches "${name}"`);
    if (found.length > 1) {
      throw new Error(
        `"${name}" matches ${found
          .slice(0, 8)
          .map(d => `${d.name} (${d.id})`)
          .join(', ')}: name one of them`
      );
    }
    const doc = found[0];
    const changes: Record<string, unknown> = {};
    const pathLabels: Record<string, string> = {};
    const lines: string[] = [];
    if (value.default !== undefined && value.default !== doc.default) {
      changes['ownership.default'] = PACK_OWNERSHIP_LEVELS.indexOf(value.default);
      pathLabels['ownership.default'] = 'default for everyone';
      lines.push(`everyone else: ${doc.default} to ${value.default}`);
    }
    for (const [userName, level] of Object.entries(value.users ?? {})) {
      const candidates = (await this.info('user', userName.trim())).users ?? [];
      const matches = candidates.filter(
        u => u.id === userName.trim() || u.name.toLowerCase() === userName.trim().toLowerCase()
      );
      if (matches.length > 1) {
        throw new Error(
          `More than one user is called "${userName}" (ids ${matches.map(u => u.id).join(', ')}): use the id as the key`
        );
      }
      const user = matches[0];
      if (!user) {
        const near = candidates.map(u => u.name).join(', ');
        throw new Error(`No user "${userName}"${near ? ` (did you mean ${near}?)` : ''}`);
      }
      if (user.isGM)
        throw new Error(`${user.name} is a Gamemaster or Assistant GM and sees everything already`);
      const was = doc.users[user.id]?.level ?? 'inherits';
      if (was === level) continue;
      changes[`ownership.${user.id}`] = PACK_OWNERSHIP_LEVELS.indexOf(level);
      pathLabels[`ownership.${user.id}`] = `${user.name}`;
      lines.push(`${user.name}: ${was} to ${level}`);
    }
    if (Object.keys(changes).length === 0) {
      throw new Error(`Nothing to change: ${doc.name} already looks like that`);
    }
    const uuid = `${kind?.trim() === 'journal' ? 'JournalEntry' : 'Scene'}.${doc.id}`;
    const notes = [
      'This changes what players can open or see; journals and scenes can hold spoilers.',
    ];
    const plan = await this.guardedWrites.createPlan({
      feature: FOUNDRY_SETUP_FEATURE_ID,
      summary: `Ownership of ${doc.name}: ${lines.join(', ')}`,
      ops: [{ kind: 'update', uuid, changes }],
      pathLabels,
      notes,
    });
    return { ...plan, notes: [...lines, ...notes], autoApply: false };
  }

  /**
   * A module on or off for the world: one update of `core.moduleConfiguration`, one flag per
   * module. Turning one on also turns on the installed modules it requires; turning one off also
   * turns off the active modules that require it. Both lists are in the plan.
   */
  private async planModule(target: string, value: unknown): Promise<unknown> {
    if (typeof value !== 'boolean') throw new Error('A module value is true (on) or false (off)');
    // The target goes along: an exact id or title brings back the whole closure of that module
    // even in a world with more modules than the list shows.
    const moduleInfo = await this.info('module', target.trim());
    if (moduleInfo.listTooLarge) {
      throw new Error(
        'The list of modules in this world holds too much data for a plan to change it; turn the module on or off in Foundry itself'
      );
    }
    const modules = moduleInfo.modules ?? [];
    const wanted = target.trim().toLowerCase();
    const row =
      modules.find(m => m.id.toLowerCase() === wanted) ??
      modules.find(m => m.title.toLowerCase() === wanted);
    if (!row) {
      const near = modules
        .filter(m => `${m.id} ${m.title}`.toLowerCase().includes(wanted))
        .slice(0, 8)
        .map(m => m.id);
      throw new Error(
        `No installed module "${target}"${near.length ? ` (did you mean ${near.join(', ')}?)` : ''}`
      );
    }
    if (row.id === MODULE_ID) throw new Error('The AI Tool module cannot be turned off by a plan');
    if (row.active === value) {
      throw new Error(
        `Nothing to change: ${row.title} (${row.id}) is already ${value ? 'on' : 'off'}`
      );
    }
    const byId = new Map(modules.map(m => [m.id, m]));
    const flips = new Map<string, ModuleRow>();
    const missing: string[] = [];
    const visit = (m: ModuleRow): void => {
      if (flips.has(m.id)) return;
      flips.set(m.id, m);
      if (value) {
        for (const dep of m.requires) {
          if (!dep.installed) missing.push(`${dep.id} (needed by ${m.id})`);
          else if (!dep.active) {
            const depRow = byId.get(dep.id);
            if (!depRow) {
              throw new Error(
                `The read did not include ${dep.id}, which ${m.id} needs; too many modules are linked to ${row.id} for a plan to read, so change it in Foundry itself`
              );
            }
            visit(depRow);
          }
        }
      } else {
        for (const id of m.requiredBy) {
          const user = byId.get(id);
          if (!user) {
            throw new Error(
              `The read did not include ${id}, which needs ${m.id}; too many modules are linked to ${row.id} for a plan to read, so change it in Foundry itself`
            );
          }
          if (user.active) visit(user);
        }
      }
    };
    visit(row);
    if (missing.length > 0) {
      throw new Error(`${row.title} cannot be turned on: not installed: ${missing.join(', ')}`);
    }
    // Foundry itself keeps these on (the world or system needs them) or off (unavailable).
    for (const m of flips.values()) {
      if (value && m.unavailable) {
        throw new Error(
          `${m.title} (${m.id}) is not usable in this world (Foundry marks it unavailable)`
        );
      }
      if (!value && m.forcedOn) {
        throw new Error(
          `${m.title} (${m.id}) is required by the ${m.forcedOn} and Foundry keeps it on${m.id === row.id ? '' : `; turning ${row.title} off would need it off too`}`
        );
      }
    }
    if (flips.has(MODULE_ID)) {
      throw new Error(`The AI Tool module needs ${row.id}, so it cannot be turned off by a plan`);
    }
    const changes: Record<string, unknown> = {};
    const pathLabels: Record<string, string> = {};
    for (const m of flips.values()) {
      changes[`value.${m.id}`] = value;
      pathLabels[`value.${m.id}`] = `${m.title} (${m.id})`;
    }
    const others = [...flips.values()].filter(m => m.id !== row.id);
    const state = value ? 'on' : 'off';
    const notes = [
      'Foundry loads modules only at startup. After the apply, or the undo, every connected window reloads by itself a few seconds later (the bridge reconnects); players see the page reload.',
    ];
    if (others.length > 0) {
      notes.push(
        value
          ? `Also turned on, because ${row.title} requires them: ${others.map(m => m.title).join(', ')}.`
          : `Also turned off, because they require ${row.title}: ${others.map(m => m.title).join(', ')}.`
      );
    }
    const plan = await this.guardedWrites.createPlan({
      feature: FOUNDRY_SETUP_FEATURE_ID,
      summary: `Turn ${row.title} (${row.id}) ${state}${others.length ? ` with ${others.length} more` : ''}`,
      ops: [{ kind: 'update', uuid: `${SETTING_UUID_PREFIX}${MODULE_CONFIG_SETTING}`, changes }],
      pathLabels,
      notes,
    });
    this.logger.info(`Planned module ${row.id} ${state}`);
    return { ...plan, notes, autoApply: false };
  }

  private async planSetting(target: string, value: unknown): Promise<unknown> {
    if (!/^[^.\s]+\.[^\s]+$/.test(target)) {
      throw new Error('A setting target is namespace.key, for example core.gridDiagonals');
    }
    const row = (await this.info('setting', target)).settings?.find(s => s.id === target);
    if (!row) throw new Error(`No setting "${target}" is registered (read the namespace first)`);
    if (row.redacted) throw new Error(`${target} is a secret; plans never read or write it`);
    if (!row.config) {
      throw new Error(
        `${target} is a hidden setting (module bookkeeping, not on a settings screen); plans do not change those`
      );
    }
    if (row.valueError) {
      throw new Error(`${target} could not be read (${row.valueError}); it is not planned`);
    }
    if (row.tooLong) {
      throw new Error(`${target} holds too much data to change through a plan`);
    }
    if (row.value === undefined) {
      throw new Error(`${target} has no value yet; set it once in Foundry first`);
    }
    this.checkSettingValue(row, value);
    if (same(row.value, value))
      throw new Error(`Nothing to change: ${target} is already that value`);

    const notes: string[] = [];
    if (row.requiresReload) notes.push('Foundry needs a reload before this takes effect.');
    if (row.scope === 'client') {
      notes.push(
        'This is a client setting: it changes only the GM Foundry window the bridge runs in; players keep theirs.'
      );
    } else if (row.scope === 'user') {
      notes.push('This is a user setting: it changes only the bridge GM user.');
    }
    const ops: GuardedOp[] = [
      { kind: 'update', uuid: `${SETTING_UUID_PREFIX}${target}`, changes: { value } },
    ];
    const plan = await this.guardedWrites.createPlan({
      feature: FOUNDRY_SETUP_FEATURE_ID,
      summary: `Set ${row.name} (${target})`,
      ops,
      pathLabels: { value: 'value' },
      notes,
    });
    return { ...plan, notes, autoApply: false };
  }

  /** Throws when the value does not fit the setting's type, choices or range. */
  private checkSettingValue(row: SettingRow, value: unknown): void {
    if (row.choices && !Object.hasOwn(row.choices, String(value))) {
      throw new Error(
        `${row.id} accepts ${Object.keys(row.choices).join(', ')} (got ${JSON.stringify(value)})`
      );
    }
    const kind = row.type;
    if (kind === 'Boolean' && typeof value !== 'boolean')
      throw new Error(`${row.id} is true or false`);
    if (kind === 'Number') {
      if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error(`${row.id} is a number`);
      const { min, max } = row.range ?? {};
      if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
        throw new Error(`${row.id} must be between ${min ?? '-'} and ${max ?? '-'}`);
      }
    }
    if (kind === 'String' && typeof value !== 'string') throw new Error(`${row.id} is text`);
    if (JSON.stringify(value ?? null).length > 4000)
      throw new Error('That value is too large to plan');
  }

  private async planPack(target: string, raw: unknown): Promise<unknown> {
    const value = packValue.parse(raw);
    if (!value.ownership && value.locked === undefined && value.folder === undefined) {
      throw new Error('Give at least one of ownership, locked, folder');
    }
    const info = await this.info('pack', target);
    const pack = info.packs?.find(p => p.id === target);
    if (!pack) throw new Error(`No compendium pack "${target}"`);

    const changes: Record<string, unknown> = {};
    const lines: string[] = [];
    if (value.ownership) {
      if (value.ownership.ASSISTANT !== undefined && value.ownership.ASSISTANT !== 'OWNER') {
        throw new Error(
          'ASSISTANT must stay OWNER: the bridge reads every pack as the Assistant GM, and Foundry itself refuses to configure a pack below it'
        );
      }
      const current = pack.ownership ?? {};
      const merged: Record<string, string> = { ...current };
      for (const role of PACK_OWNERSHIP_ROLES) {
        const level = value.ownership[role];
        if (!level || current[role] === level) continue;
        merged[role] = level;
        lines.push(`${role}: ${current[role] ?? 'inherits'} to ${level}`);
      }
      // A pack that already has the Assistant GM below OWNER is put right in the same change:
      // the module keeps OWNER for it on every write (an undo included).
      if (current.ASSISTANT !== undefined && current.ASSISTANT !== 'OWNER') {
        merged.ASSISTANT = 'OWNER';
        lines.push(`ASSISTANT: ${current.ASSISTANT} to OWNER (the bridge needs it)`);
      }
      // A role gets the highest level of its own and every lower role, so a lower level set on
      // a higher role does nothing while a lower role keeps a higher one.
      for (const role of PACK_OWNERSHIP_ROLES) {
        const asked = value.ownership[role];
        if (!asked) continue;
        const lower = PACK_OWNERSHIP_ROLES.slice(0, PACK_OWNERSHIP_ROLES.indexOf(role) + 1);
        const best = Math.max(...lower.map(r => PACK_OWNERSHIP_LEVELS.indexOf(merged[r] as never)));
        if (PACK_OWNERSHIP_LEVELS[best] !== asked) {
          throw new Error(
            `${role} would still have ${PACK_OWNERSHIP_LEVELS[best]}, not ${asked}: a role gets the highest level of its own and every lower role (PLAYER, TRUSTED, ASSISTANT). Lower the lower role too.`
          );
        }
      }
      // The whole role map is written, so roles the request leaves out keep their level.
      if (!same(merged, current)) changes.ownership = merged;
    }
    if (value.locked !== undefined && value.locked !== pack.locked) {
      changes.locked = value.locked;
      lines.push(`locked: ${String(pack.locked)} to ${String(value.locked)}`);
    }
    if (value.folder !== undefined) {
      let folderId: string | null = null;
      if (value.folder !== null) {
        const wanted = value.folder.toLowerCase();
        const folder = info.folders?.find(
          f => f.id === value.folder || f.name.toLowerCase() === wanted
        );
        if (!folder) {
          const names = (info.folders ?? []).map(f => f.name).join(', ') || 'none exist';
          throw new Error(`No compendium folder "${value.folder}" (${names})`);
        }
        folderId = folder.id;
      }
      if (folderId !== (pack.folder?.id ?? null)) {
        changes.folder = folderId;
        lines.push(`folder: ${pack.folder?.name ?? 'none'} to ${value.folder ?? 'none'}`);
      }
    }
    if (Object.keys(changes).length === 0) {
      throw new Error(`Nothing to change: ${pack.label} already looks like that`);
    }
    const ops: GuardedOp[] = [{ kind: 'update', uuid: `${PACK_UUID_PREFIX}${target}`, changes }];
    const notes = ['Players see a changed pack the next time they open the Compendiums tab.'];
    const plan = await this.guardedWrites.createPlan({
      feature: FOUNDRY_SETUP_FEATURE_ID,
      summary: `Change pack ${pack.label} (${target}): ${lines.join(', ')}`,
      ops,
      pathLabels: { ownership: 'ownership', locked: 'locked', folder: 'folder' },
      notes,
    });
    this.logger.info(`Planned pack change for ${target}`);
    return { ...plan, notes: [...lines, ...notes], autoApply: false };
  }
}
