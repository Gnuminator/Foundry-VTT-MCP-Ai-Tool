/**
 * `getSetupInfo` (D-135): what the Foundry setup tool shows before it plans a change. A read
 * only; secret settings are listed by name with their value left out.
 *
 * - `area: "setting"`: registered settings (world, client and user scope), matched by
 *   `namespace.key` or a part of the key, name or namespace. Hidden settings (`config: false`)
 *   show only when `target` is their exact `namespace.key`.
 * - `area: "pack"`: compendium packs with their effective and configured ownership, locked flag
 *   and folder, plus the Compendium folders a pack can sit in.
 * - `area: "module"`: installed modules, on or off, with what each requires and what needs it.
 * - `area: "user"`: users with role and the actors each owns.
 * - `area: "ownership"`: world journals or scenes with their default and per-user level.
 */
import {
  MAX_SETTING_JSON,
  forcedOnBy,
  isSecretSetting,
  isSystemRequirement,
  moduleIsOn,
  moduleListTooLarge,
  readPackEntry,
  readSettingValue,
  registeredSettings,
  settingTypeName,
} from './virtual-targets.js';

const LIST_CAP = 50;

interface PackLike {
  collection?: string;
  metadata?: {
    label?: string;
    type?: string;
    packageName?: string;
    packageType?: string;
    ownership?: Record<string, string>;
  };
  title?: string;
  documentName?: string;
  locked?: boolean;
  ownership?: Record<string, string>;
  folder?: { id?: string; name?: string } | null;
  config?: { ownership?: Record<string, string>; locked?: boolean; folder?: string | null };
}

interface FolderLike {
  id: string;
  name: string;
  type?: string;
}

type SettingMeta = ReturnType<typeof registeredSettings> extends Map<string, infer V> ? V : never;

/**
 * Allowed values and limits. Foundry 14 and dnd5e 6 keep them on the DataField (`type.choices`,
 * `type.min/max/step`); older registrations put `choices` and `range` on the setting itself.
 */
function settingLimits(meta: SettingMeta): {
  choices?: Record<string, unknown>;
  range?: { min?: number; max?: number; step?: number };
} {
  const field = (meta.type && typeof meta.type === 'object' ? meta.type : {}) as {
    choices?: unknown;
    min?: unknown;
    max?: unknown;
    step?: unknown;
  };
  let raw: unknown = field.choices ?? meta.choices;
  if (typeof raw === 'function') {
    try {
      raw = (raw as () => unknown)();
    } catch {
      raw = undefined;
    }
  }
  const out: ReturnType<typeof settingLimits> = {};
  if (Array.isArray(raw)) raw = Object.fromEntries(raw.map(v => [String(v), v]));
  if (raw && typeof raw === 'object') {
    out.choices = Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([k, v]) => {
        const label = typeof v === 'object' && v !== null ? (v as { label?: unknown }).label : v;
        return [k, typeof label === 'string' ? game.i18n.localize(label) : label];
      })
    );
  }
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  const range = {
    min: num(field.min) ?? meta.range?.min,
    max: num(field.max) ?? meta.range?.max,
    step: num(field.step) ?? meta.range?.step,
  };
  if (range.min !== undefined || range.max !== undefined || range.step !== undefined) {
    out.range = {};
    if (range.min !== undefined) out.range.min = range.min;
    if (range.max !== undefined) out.range.max = range.max;
    if (range.step !== undefined) out.range.step = range.step;
  }
  return out;
}

function settingsInfo(target: string | undefined): unknown {
  const wanted = (target ?? '').trim();
  const lower = wanted.toLowerCase();
  const all = registeredSettings();
  const exact = wanted.includes('.') && all.has(wanted);
  const rows: Array<
    [string, ReturnType<typeof registeredSettings> extends Map<string, infer V> ? V : never]
  > = [];
  for (const [id, meta] of all) {
    if (exact) {
      if (id === wanted) rows.push([id, meta]);
      continue;
    }
    if (meta.config === false) continue;
    const name = meta.name ? game.i18n.localize(meta.name) : '';
    if (!lower || `${id} ${name}`.toLowerCase().includes(lower)) rows.push([id, meta]);
  }
  rows.sort(([a], [b]) => a.localeCompare(b));
  const settings = rows.slice(0, LIST_CAP).map(([id, meta]) => {
    const namespace = id.slice(0, id.indexOf('.'));
    const key = id.slice(id.indexOf('.') + 1);
    const row: Record<string, unknown> = {
      id,
      name: meta.name ? game.i18n.localize(meta.name) : key,
      scope: meta.scope ?? 'client',
      type: settingTypeName(meta.type),
      config: meta.config !== false,
      requiresReload: meta.requiresReload === true,
      default: meta.default,
    };
    const limits = settingLimits(meta);
    if (limits.choices) row.choices = limits.choices;
    if (limits.range) row.range = limits.range;
    let value: unknown;
    try {
      value = readSettingValue(namespace, key);
    } catch (error) {
      row.valueError = error instanceof Error ? error.message : String(error);
    }
    if (isSecretSetting(namespace, key, value)) {
      row.redacted = true;
      delete row.default;
    } else if (!row.valueError) {
      const json = JSON.stringify(value ?? null);
      if (json.length > MAX_SETTING_JSON) {
        row.tooLong = true;
        row.value = `(${json.length} characters, too long to show)`;
      } else {
        row.value = value;
      }
    }
    return row;
  });
  return { area: 'setting', total: rows.length, shown: settings.length, settings };
}

function packsInfo(target: string | undefined): unknown {
  const lower = (target ?? '').trim().toLowerCase();
  const packs = [...(game.packs as unknown as Iterable<PackLike>)];
  const rows = packs
    .filter(pack => {
      const id = pack.collection ?? '';
      return (
        !lower || `${id} ${pack.metadata?.label ?? pack.title ?? ''}`.toLowerCase().includes(lower)
      );
    })
    .map(pack => {
      const id = pack.collection ?? '';
      const configured = readPackEntry(id);
      return {
        id,
        label: pack.metadata?.label ?? pack.title ?? id,
        type: pack.documentName ?? pack.metadata?.type ?? null,
        package: pack.metadata?.packageName ?? null,
        ownership: pack.ownership ?? pack.config?.ownership ?? null,
        manifestOwnership: pack.metadata?.ownership ?? null,
        configured,
        locked: pack.locked ?? pack.config?.locked ?? false,
        folder: pack.folder ? { id: pack.folder.id ?? null, name: pack.folder.name ?? null } : null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const folders = [...(game.folders as unknown as Iterable<FolderLike>)]
    .filter(folder => folder.type === 'Compendium')
    .map(folder => ({ id: folder.id, name: folder.name }));
  return {
    area: 'pack',
    total: rows.length,
    shown: Math.min(rows.length, LIST_CAP),
    packs: rows.slice(0, LIST_CAP),
    folders,
  };
}

interface ModuleLike {
  id: string;
  title?: string;
  version?: string;
  active?: boolean;
  unavailable?: boolean;
  relationships?: { requires?: Iterable<{ id?: string; type?: string }> };
}

/** Modules cap: a big world has well over the 50 settings rows. */
const MODULE_LIST_CAP = 400;

/**
 * Installed modules with whether each is on, what each requires (installed and on?) and which
 * active modules require it. The plan tool derives the dependency list from this.
 */
function modulesInfo(target: string | undefined): unknown {
  const lower = (target ?? '').trim().toLowerCase();
  const mods = [...(game.modules as unknown as Map<string, ModuleLike>).values()];
  const byId = new Map(mods.map(m => [m.id, m]));
  const requiresOf = (m: ModuleLike): Array<{ id: string; installed: boolean; active: boolean }> =>
    [...(m.relationships?.requires ?? [])]
      .filter((r): r is { id: string; type?: string } => typeof r?.id === 'string')
      .filter(r => r.type === undefined || r.type === 'module' || r.type === 'system')
      .map(r => {
        if (isSystemRequirement(r)) {
          return { id: r.id, installed: true, active: true };
        }
        const dep = byId.get(r.id);
        return {
          id: r.id,
          installed: dep !== undefined,
          active: dep !== undefined && moduleIsOn(dep),
        };
      });
  const requiredBy = new Map<string, string[]>();
  for (const m of mods) {
    if (!moduleIsOn(m)) continue;
    for (const dep of requiresOf(m)) {
      requiredBy.set(dep.id, [...(requiredBy.get(dep.id) ?? []), m.id]);
    }
  }
  // An exact id or title: the module, everything it needs (all the way down) and everything that
  // needs it (all the way up), each direction walked on its own so a shared library does not pull
  // in its other users. The target row always comes first.
  const exact = lower
    ? (mods.find(m => m.id.toLowerCase() === lower) ??
      mods.find(m => (m.title ?? '').toLowerCase() === lower))
    : undefined;
  let keep: Set<string> | null = null;
  if (exact) {
    keep = new Set<string>();
    keep.add(exact.id);
    const walk = (id: string, next: (id: string) => string[]): void => {
      for (const n of next(id)) {
        if (keep?.has(n) || !byId.has(n)) continue;
        keep?.add(n);
        walk(n, next);
      }
    };
    walk(exact.id, id => requiresOf(byId.get(id) as ModuleLike).map(d => d.id));
    walk(exact.id, id => requiredBy.get(id) ?? []);
  }
  const rows = mods
    .filter(m =>
      keep ? keep.has(m.id) : !lower || `${m.id} ${m.title ?? ''}`.toLowerCase().includes(lower)
    )
    .map(m => {
      const forced = forcedOnBy(m.id);
      return {
        id: m.id,
        title: m.title ?? m.id,
        version: m.version ?? null,
        active: moduleIsOn(m),
        requires: requiresOf(m),
        requiredBy: requiredBy.get(m.id) ?? [],
        // Foundry keeps these on (the world or system needs them) or off (not compatible).
        ...(forced ? { forcedOn: forced } : {}),
        ...(m.unavailable === true ? { unavailable: true } : {}),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  // Past the cap the exact target's row (and the closure behind it) is never the one dropped.
  const shownRows =
    exact && rows.length > MODULE_LIST_CAP
      ? [
          ...rows.filter(r => r.id === exact.id),
          ...rows.filter(r => r.id !== exact.id).slice(0, MODULE_LIST_CAP - 1),
        ]
      : rows.slice(0, MODULE_LIST_CAP);
  return {
    area: 'module',
    shape: 2,
    total: rows.length,
    shown: shownRows.length,
    modules: shownRows,
    ...(moduleListTooLarge() ? { listTooLarge: true } : {}),
  };
}

interface UserLike {
  id: string;
  name?: string;
  role?: number;
  isGM?: boolean;
  active?: boolean;
}

const ROLE_NAMES: Record<number, string> = {
  0: 'NONE',
  1: 'PLAYER',
  2: 'TRUSTED',
  3: 'ASSISTANT',
  4: 'GAMEMASTER',
};
const LEVEL_NAMES: Record<number, string> = {
  [-1]: 'INHERIT',
  0: 'NONE',
  1: 'LIMITED',
  2: 'OBSERVER',
  3: 'OWNER',
};

/**
 * Users with their role (never a password or its hash) and the
 * actors each owns, for the setup tool and for a login check.
 */
function usersInfo(target: string | undefined): unknown {
  const lower = (target ?? '').trim().toLowerCase();
  const users = [...(game.users as unknown as Iterable<UserLike>)];
  const actors = [
    ...((game.actors ?? []) as unknown as Iterable<{
      name?: string;
      ownership?: Record<string, number>;
    }>),
  ];
  const rows = users
    .filter(u => !lower || `${u.id} ${u.name ?? ''}`.toLowerCase().includes(lower))
    .map(u => {
      const owns = actors
        .filter(a => a.ownership?.[u.id] === 3)
        .map(a => a.name ?? '?')
        .slice(0, 20);
      return {
        id: u.id,
        name: u.name ?? u.id,
        role: ROLE_NAMES[u.role ?? 0] ?? String(u.role),
        isGM: u.isGM === true,
        active: u.active === true,
        owns,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    area: 'user',
    total: rows.length,
    shown: Math.min(rows.length, LIST_CAP),
    users: rows.slice(0, LIST_CAP),
  };
}

/**
 * Ownership of world journals and scenes: `target` is `journal` or `scene`, optionally followed by
 * `:` and a part of the name or an id. Each row has the default level and the level per user.
 */
function ownershipInfo(target: string | undefined): unknown {
  const [kindRaw, ...rest] = (target ?? '').split(':');
  const kind = (kindRaw ?? '').trim().toLowerCase();
  if (kind !== 'journal' && kind !== 'scene') {
    throw new Error('Ownership target is "journal" or "scene", optionally ":" and a name');
  }
  const wanted = rest.join(':').trim().toLowerCase();
  const collection = (kind === 'journal' ? game.journal : game.scenes) as unknown as
    | Iterable<{ id: string; name?: string; ownership?: Record<string, number> }>
    | undefined;
  const users = [...(game.users as unknown as Iterable<UserLike>)];
  const nameOf = new Map(users.map(u => [u.id, u.name ?? u.id]));
  const docs = [...(collection ?? [])]
    .filter(
      d =>
        !wanted || d.id === rest.join(':').trim() || (d.name ?? '').toLowerCase().includes(wanted)
    )
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  const rows = docs.slice(0, LIST_CAP).map(d => {
    const own = d.ownership ?? {};
    // Keyed by user id: two users may share a name.
    const perUser: Record<string, { name: string; level: string }> = {};
    for (const [id, level] of Object.entries(own)) {
      if (id === 'default') continue;
      perUser[id] = { name: nameOf.get(id) ?? id, level: LEVEL_NAMES[level] ?? String(level) };
    }
    return {
      id: d.id,
      name: d.name ?? d.id,
      default: LEVEL_NAMES[own.default ?? 0] ?? String(own.default),
      users: perUser,
    };
  });
  return {
    area: 'ownership',
    shape: 2,
    kind,
    total: docs.length,
    shown: rows.length,
    documents: rows,
  };
}

export function getSetupInfo(data: unknown): unknown {
  const { area, target } = (data ?? {}) as { area?: unknown; target?: unknown };
  const text = typeof target === 'string' ? target : undefined;
  if (area === 'setting') return settingsInfo(text);
  if (area === 'pack') return packsInfo(text);
  if (area === 'module') return modulesInfo(text);
  if (area === 'user') return usersInfo(text);
  if (area === 'ownership') return ownershipInfo(text);
  throw new Error('getSetupInfo needs area "setting", "pack", "module", "user" or "ownership"');
}
