/**
 * Foundry setup targets for guarded writes (D-135): a world or client setting and a compendium
 * pack's configuration are not documents, so a plan addresses them with a pseudo uuid that
 * `fromUuid` never resolves and only this file understands:
 *
 * - `GameSetting.<namespace>.<key>`: source `{ value }`. The path `value` is the whole value;
 *   `value.<moduleId>` (only for `core.moduleConfiguration`) is one module's on/off flag.
 * - `PackConfig.<packId>` (pack ids contain a dot): source is the pack's entry in
 *   `core.compendiumConfiguration`; paths `ownership` (the whole role map), `locked`, `folder`.
 *
 * Everything else about a guarded write (expected state, conflicts, undo, the change record) works
 * on these like on any update. `guarded-write.ts` branches here before it resolves a document.
 *
 * Wire mirror: the prefixes and the feature id live in `shared/src/foundry-setup.ts` (the module
 * does not import the shared package); `virtual-targets.contract.test.ts` compares them.
 */
import { MODULE_ID } from '../constants.js';
import {
  KNOWN_SECRET_SETTINGS,
  MIN_KEY_NAME_VALUE,
  SECRET_KEY_NAME,
  SECRET_PATTERNS,
  stringLeaves,
} from '../preflight-scan.js';

export const SETUP_FEATURE_ID = 'foundry-setup';
export const SETTING_UUID_PREFIX = 'GameSetting.';
export const PACK_UUID_PREFIX = 'PackConfig.';

export const MODULE_CONFIG_SETTING = 'core.moduleConfiguration';
export const PACK_CONFIG_SETTING = 'core.compendiumConfiguration';

/** Values over this many JSON characters are never planned (or read back whole). */
export const MAX_SETTING_JSON = 4000;
/** The module list holds one entry per installed module, so it gets room for several hundred. */
export const MAX_MODULE_CONFIG_JSON = 30000;

/** Pack configuration fields a plan may set. */
const PACK_FIELDS = ['ownership', 'locked', 'folder'] as const;

/**
 * A setting that must never be read into a plan: login, keys, tokens, licences, webhooks. Narrow
 * on purpose: many ordinary settings say "token" (token vision, rings) or "auth".
 */
const SECRET_NAME =
  /pass(word|phrase)\b|\bpasswd\b|secret|(api|access|auth|bot|refresh|bearer|session)[-_ ]?(key|token)|apikey|credential|private[-_ ]?key|webhook|licen[cs]e[-_ ]?key|patreon|\bsalt\b/i;

/** Features whose writes may change a setting or a pack; undo and rollback put back what they changed. */
const SETUP_FEATURES = new Set([SETUP_FEATURE_ID, 'change-undo', 'rollback']);

/** Throws unless the feature of an apply may write a setting or a pack's configuration. */
export function assertSetupFeature(feature: string): void {
  if (!SETUP_FEATURES.has(feature)) {
    throw new Error(
      `Settings and pack configuration are only written by the "${SETUP_FEATURE_ID}" feature (got "${feature}")`
    );
  }
}

interface RegisteredSetting {
  namespace?: string;
  key?: string;
  name?: string;
  scope?: string;
  type?: unknown;
  config?: boolean;
  default?: unknown;
  requiresReload?: boolean;
  choices?: Record<string, unknown>;
  range?: { min?: number; max?: number; step?: number };
}

/** The registered settings (`game.settings.settings`, a Map keyed `namespace.key`). */
export function registeredSettings(): Map<string, RegisteredSetting> {
  const map = (game.settings as unknown as { settings?: unknown }).settings;
  return map instanceof Map
    ? new Map<string, RegisteredSetting>(map as Map<string, RegisteredSetting>)
    : new Map<string, RegisteredSetting>();
}

export function isVirtualUuid(uuid: unknown): boolean {
  return (
    typeof uuid === 'string' &&
    (uuid.startsWith(SETTING_UUID_PREFIX) || uuid.startsWith(PACK_UUID_PREFIX))
  );
}

/** `GameSetting.dnd5e.diagonalMovement` to its namespace and key. */
export function parseSettingUuid(uuid: string): { namespace: string; key: string } {
  const rest = uuid.slice(SETTING_UUID_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot <= 0 || dot === rest.length - 1) throw new Error(`Not a setting address: ${uuid}`);
  return { namespace: rest.slice(0, dot), key: rest.slice(dot + 1) };
}

/**
 * A setting's type as one of `Boolean`, `Number`, `String` or the constructor's name. Foundry 14
 * renames a DataField-typed setting's field to the setting id, so an object's own `name` is not
 * its type: the constructor says which field it is.
 */
export function settingTypeName(type: unknown): string {
  if (typeof type === 'function') return (type as { name?: string }).name ?? 'unknown';
  if (type && typeof type === 'object') {
    const ctor = (type as { constructor?: { name?: string } }).constructor?.name ?? 'object';
    if (ctor === 'StringField') return 'String';
    if (ctor === 'BooleanField') return 'Boolean';
    if (ctor === 'NumberField') return 'Number';
    return ctor;
  }
  return 'unknown';
}

/**
 * True for a setting whose value must not reach a plan, a diff or the audit log: by name (key or
 * localized name), by the preflight scan's list of known secret settings, as a hidden text
 * setting, or when the value holds a secret-looking string (`value` given).
 */
export function isSecretSetting(namespace: string, key: string, value?: unknown): boolean {
  const id = `${namespace}.${key}`;
  const meta = registeredSettings().get(id);
  const name = meta?.name ? game.i18n.localize(meta.name) : '';
  if (SECRET_NAME.test(key) || SECRET_NAME.test(name) || SECRET_NAME.test(String(meta?.name))) {
    return true;
  }
  if (KNOWN_SECRET_SETTINGS.some(known => known.setting === id)) return true;
  // A free-text setting that no settings screen shows is where modules keep keys and tokens.
  if (namespace !== 'core' && meta?.config === false && settingTypeName(meta.type) === 'String') {
    return true;
  }
  if (value === undefined) return false;
  const leaves = stringLeaves(value);
  if (leaves.some(leaf => SECRET_PATTERNS.some(secret => secret.pattern.test(leaf)))) return true;
  const longString = (leaf: string): boolean =>
    leaf.length >= MIN_KEY_NAME_VALUE && !/\s/.test(leaf);
  // Same rule as the preflight scan: a secret-sounding key (or object key) holding a long string.
  if (SECRET_KEY_NAME.test(key) || SECRET_KEY_NAME.test(name)) return leaves.some(longString);
  return hasSecretKeyedString(value, longString, 0);
}

/** True when an object key that sounds secret holds a long string without spaces. */
function hasSecretKeyedString(
  value: unknown,
  longString: (leaf: string) => boolean,
  depth: number
): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([k, v]) => {
    if (SECRET_KEY_NAME.test(k) && stringLeaves(v).some(longString)) return true;
    return hasSecretKeyedString(v, longString, depth + 1);
  });
}

/** Path segments that would walk into `Object.prototype`. */
function assertSafePath(path: string): void {
  if (path.split('.').some(seg => ['__proto__', 'constructor', 'prototype'].includes(seg))) {
    throw new Error(`Unsafe path: ${path}`);
  }
}

/**
 * Throws unless a plan may change this setting through the paths given. The bridge's own settings
 * (write switches, feature switches) can never be changed this way, nor can the permission table.
 * The module and pack lists have their own targets and checks.
 */
export function assertSettingWritable(
  namespace: string,
  key: string,
  paths: readonly string[]
): void {
  const id = `${namespace}.${key}`;
  paths.forEach(assertSafePath);
  if (namespace === MODULE_ID) {
    throw new Error(`The AI Tool's own settings cannot be changed by a plan (${id})`);
  }
  if (id === 'core.permissions') {
    throw new Error('The role permission table (core.permissions) cannot be changed by a plan');
  }
  if (id === PACK_CONFIG_SETTING) {
    throw new Error('Pack configuration has its own target (PackConfig.<packId>)');
  }
  if (id === MODULE_CONFIG_SETTING) {
    const ok = paths.every(p => /^value\.[^.]+$/.test(p));
    if (!ok) throw new Error('core.moduleConfiguration may only be changed one module at a time');
    if (paths.includes(`value.${MODULE_ID}`)) {
      throw new Error('The AI Tool module cannot be turned off by a plan');
    }
  }
  if (id !== MODULE_CONFIG_SETTING && !(paths.length === 1 && paths[0] === 'value')) {
    throw new Error(`A setting is changed through the path "value" only (got ${paths.join(', ')})`);
  }
}

/** The value as plain, JSON-safe data (a DataModel to its source, a Set to an array). */
function plain(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value instanceof Set) return [...value];
  if (hasToObject(value)) return JSON.parse(JSON.stringify(value.toObject(true))) as unknown;
  return value === null || typeof value !== 'object'
    ? value
    : (JSON.parse(JSON.stringify(value)) as unknown);
}

function hasToObject(value: unknown): value is { toObject: (source?: boolean) => unknown } {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { toObject?: unknown }).toObject === 'function'
  );
}

export function readSettingValue(namespace: string, key: string): unknown {
  return plain(game.settings.get(namespace, key));
}

function packEntries(): Record<string, Record<string, unknown>> {
  const all = plain(game.settings.get('core', 'compendiumConfiguration'));
  return all && typeof all === 'object' ? (all as Record<string, Record<string, unknown>>) : {};
}

/** The pack's configured entry (empty when the pack runs on its manifest defaults). */
export function readPackEntry(packId: string): Record<string, unknown> {
  return { ...(packEntries()[packId] ?? {}) };
}

function packOf(packId: string): { metadata?: { label?: string } } | undefined {
  return (game.packs as unknown as { get(id: string): unknown }).get(packId) as
    | { metadata?: { label?: string } }
    | undefined;
}

/**
 * Foundry's own pack configuration refuses unless the Assistant GM role keeps OWNER, and the
 * bridge's Assistant client reads every pack through that level. The plan tool refuses a lowering;
 * an undo or rollback of a pack that sat below OWNER before the bridge fixed it would restore that
 * level, so the module keeps OWNER here instead of failing the undo.
 */
function keepAssistantOwner(ownership: unknown): unknown {
  if (ownership === null || typeof ownership !== 'object') return ownership;
  const level = (ownership as Record<string, unknown>).ASSISTANT;
  if (level === undefined || level === 'OWNER') return ownership;
  return { ...(ownership as Record<string, unknown>), ASSISTANT: 'OWNER' };
}

/** Foundry 14 validates a setting through its DataField on `set`; refuse before the GM confirms. */
function assertValidForField(type: unknown, value: unknown, id: string): void {
  const field = type as
    | { clean?: (v: unknown) => unknown; validate?: (v: unknown, o: object) => unknown }
    | null
    | undefined;
  if (typeof field?.validate !== 'function') return;
  // Same order as `ClientSettings#set`: clean the value, then validate it without throwing.
  const cleaned = typeof field.clean === 'function' ? field.clean(value) : value;
  const failure = field.validate(cleaned, { fallback: false }) as
    | { message?: unknown }
    | undefined
    | null
    | void;
  if (failure) {
    const why = typeof failure.message === 'string' ? failure.message : 'not allowed';
    throw new Error(`${id} does not accept that value (${why})`);
  }
}

export interface VirtualSnapshot {
  exists: boolean;
  documentName: string;
  name: string | null;
  source: Record<string, unknown>;
}

/** The target's current source, for the plan-time diff and the apply-time conflict check. */
export function snapshotVirtual(
  uuid: string,
  paths: readonly string[],
  changes?: Record<string, unknown>
): VirtualSnapshot {
  if (uuid.startsWith(PACK_UUID_PREFIX)) {
    const packId = uuid.slice(PACK_UUID_PREFIX.length);
    const bad = paths.find(p => !(PACK_FIELDS as readonly string[]).includes(p));
    if (bad)
      throw new Error(`A pack configuration has no "${bad}" (use ownership, locked, folder)`);
    const pack = packOf(packId);
    return {
      exists: pack !== undefined,
      documentName: 'CompendiumPack',
      name: pack?.metadata?.label ?? packId,
      source: readPackEntry(packId),
    };
  }
  const { namespace, key } = parseSettingUuid(uuid);
  assertSettingWritable(namespace, key, paths);
  const meta = registeredSettings().get(`${namespace}.${key}`);
  // A setting that is gone (its module is off or renamed it) or now looks secret is "not found",
  // not an error, so an undo or rewind of other changes goes on without it.
  if (!meta) return { exists: false, documentName: 'Setting', name: null, source: {} };
  const value = readSettingValue(namespace, key);
  if (isSecretSetting(namespace, key, value)) {
    return { exists: false, documentName: 'Setting', name: null, source: {} };
  }
  if (meta.config === false && `${namespace}.${key}` !== MODULE_CONFIG_SETTING) {
    throw new Error(
      `${namespace}.${key} is a hidden setting (module bookkeeping); plans do not change those`
    );
  }
  // A value that read mode cannot show must not be replaced blind, and a new value that looks
  // secret would land in the plan, the diff and the audit (and block its own undo).
  // This is "not found", not an error: the undo planner reads through here too, and a setting
  // that grew past the cap since must not block a whole rewind. The setup tool refuses a new plan
  // for it by name (read mode marks it `tooLong`). The module list has a larger cap: it names
  // every installed module.
  const cap =
    `${namespace}.${key}` === MODULE_CONFIG_SETTING ? MAX_MODULE_CONFIG_JSON : MAX_SETTING_JSON;
  if (JSON.stringify(value ?? null).length > cap) {
    return { exists: false, documentName: 'Setting', name: null, source: {} };
  }
  if (changes && Object.values(changes).some(v => isSecretSetting(namespace, key, v))) {
    throw new Error(`The new value for ${namespace}.${key} looks like a secret and is not planned`);
  }
  if (changes && 'value' in changes)
    assertValidForField(meta.type, changes.value, `${namespace}.${key}`);
  const label = meta?.name ? game.i18n.localize(meta.name) : key;
  return {
    exists: true,
    documentName: 'Setting',
    name: `${label} (${namespace}.${key})`,
    source: { value },
  };
}

function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  assertSafePath(path);
  const keys = path.split('.');
  let node = target;
  for (const key of keys.slice(0, -1)) {
    const next = node[key];
    if (next === null || typeof next !== 'object') node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
}

function deleteAtPath(target: Record<string, unknown>, path: string): void {
  assertSafePath(path);
  const keys = path.split('.');
  let node: unknown = target;
  for (const key of keys.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return;
    node = (node as Record<string, unknown>)[key];
  }
  if (node !== null && typeof node === 'object') {
    delete (node as Record<string, unknown>)[keys[keys.length - 1]];
  }
}

/** Write the changes and removals into the target. The caller reads before and after itself. */
export async function executeVirtualUpdate(
  uuid: string,
  changes: Record<string, unknown>,
  unset: readonly string[],
  changeId = ''
): Promise<void> {
  if (uuid.startsWith(PACK_UUID_PREFIX)) {
    const packId = uuid.slice(PACK_UUID_PREFIX.length);
    if (changes.ownership !== undefined)
      changes = { ...changes, ownership: keepAssistantOwner(changes.ownership) };
    const all = packEntries();
    const entry = { ...(all[packId] ?? {}) };
    for (const [path, value] of Object.entries(changes)) setAtPath(entry, path, value);
    for (const path of unset) deleteAtPath(entry, path);
    if (Object.keys(entry).length === 0) delete all[packId];
    else all[packId] = entry;
    await game.settings.set('core', 'compendiumConfiguration', all);
    return;
  }
  const { namespace, key } = parseSettingUuid(uuid);
  assertSettingWritable(namespace, key, [...Object.keys(changes), ...unset]);
  if (unset.includes('value')) throw new Error('A setting cannot be unset, only given a value');
  const current = readSettingValue(namespace, key);
  const holder: Record<string, unknown> = { value: current };
  for (const [path, value] of Object.entries(changes)) setAtPath(holder, path, value);
  for (const path of unset) deleteAtPath(holder, path);
  await game.settings.set(namespace, key, holder.value);
  if (`${namespace}.${key}` === MODULE_CONFIG_SETTING) reloadMark(changeId).needed = true;
}

interface ModuleLike {
  id: string;
  title?: string;
  active?: boolean;
  incompatible?: boolean;
  relationships?: { requires?: Iterable<{ id?: string; type?: string }> };
}

/** The ids of the modules (not systems) a module requires. */
export function moduleRequiredIds(m: ModuleLike): string[] {
  return [...(m.relationships?.requires ?? [])]
    .filter(r => typeof r?.id === 'string' && (r.type === undefined || r.type === 'module'))
    .map(r => r.id as string);
}

/** `world` or `system` when Foundry itself forces this module on (the world or system requires it). */
export function forcedOnBy(moduleId: string): 'world' | 'system' | null {
  const g = game as unknown as {
    world?: { relationships?: { requires?: Iterable<{ id?: string; type?: string }> } };
    system?: { relationships?: { requires?: Iterable<{ id?: string; type?: string }> } };
  };
  const needs = (list: Iterable<{ id?: string; type?: string }> | undefined): boolean =>
    [...(list ?? [])].some(
      r => r?.id === moduleId && (r.type === undefined || r.type === 'module')
    );
  if (needs(g.world?.relationships?.requires)) return 'world';
  if (needs(g.system?.relationships?.requires)) return 'system';
  return null;
}

/**
 * The module list is changed one flag per module, and the plan tool adds the modules a flag
 * drags along. The world may have changed between the plan and the apply (a module installed or
 * switched meanwhile), so the closure is worked out again here from the live module list: why this
 * change is no longer complete or allowed, or null. Plans for other targets give null.
 */
export function moduleClosureProblem(
  uuid: string,
  changes: Record<string, unknown>
): string | null {
  if (uuid !== `${SETTING_UUID_PREFIX}${MODULE_CONFIG_SETTING}`) return null;
  const flips = new Map<string, boolean>();
  for (const [path, value] of Object.entries(changes)) {
    const id = path.replace(/^value\./, '');
    if (typeof value === 'boolean') flips.set(id, value);
  }
  const mods = (game.modules ?? new Map()) as unknown as Map<string, ModuleLike>;
  const config = (readSettingValue('core', 'moduleConfiguration') ?? {}) as Record<string, unknown>;
  const enabled = (id: string): boolean => {
    const flip = flips.get(id);
    if (flip !== undefined) return flip;
    const configured = config[id];
    return typeof configured === 'boolean' ? configured : mods.get(id)?.active === true;
  };
  const problems: string[] = [];
  const name = (id: string): string => mods.get(id)?.title ?? id;
  for (const [id, on] of flips) {
    const m = mods.get(id);
    if (on) {
      if (m?.incompatible === true) problems.push(`${name(id)} is not compatible with this world`);
      for (const dep of m ? moduleRequiredIds(m) : []) {
        if (mods.has(dep) && !enabled(dep)) {
          problems.push(`${name(id)} now needs ${name(dep)}, which is off`);
        }
      }
    } else {
      const forced = forcedOnBy(id);
      if (forced)
        problems.push(`${name(id)} is required by the ${forced} and cannot be turned off`);
      for (const other of mods.values()) {
        if (other.id !== id && enabled(other.id) && moduleRequiredIds(other).includes(id)) {
          problems.push(`${name(other.id)} is on and needs ${name(id)}`);
        }
      }
    }
  }
  return problems.length > 0 ? problems.join('; ') : null;
}

/** True when the module list holds more data than a plan can read back (read mode says so). */
export function moduleListTooLarge(): boolean {
  try {
    return (
      JSON.stringify(readSettingValue('core', 'moduleConfiguration') ?? null).length >
      MAX_MODULE_CONFIG_JSON
    );
  } catch {
    return false;
  }
}

export const MODULE_LIST_TOO_LARGE_MESSAGE =
  'The list of modules in this world holds too much data for a plan to change it; turn the module on or off in Foundry itself';

/** True when a write of this plan changes the module list. */
export function isModuleListOp(uuid: string): boolean {
  return uuid === `${SETTING_UUID_PREFIX}${MODULE_CONFIG_SETTING}`;
}

/**
 * Delay before the windows reload, so the apply result reaches the server and the change journal
 * pump (5 s poll) has picked up the entry first.
 */
export const MODULE_RELOAD_DELAY_MS = 7000;

/**
 * One mark per apply (by change id), so two applies at once cannot clear or take each other's
 * reload. A rollback carries the same change id as the apply it undoes.
 */
interface ReloadMark {
  needed: boolean;
  rollbackFailed: boolean;
}
const reloadMarks = new Map<string, ReloadMark>();

function reloadMark(changeId: string): ReloadMark {
  let mark = reloadMarks.get(changeId);
  if (!mark) {
    mark = { needed: false, rollbackFailed: false };
    reloadMarks.set(changeId, mark);
  }
  return mark;
}

/**
 * The rollback of a failed apply did not complete: if the apply had written the module list, the
 * list may differ from what the windows loaded, so the reload still happens. True in that case.
 */
export function noteIncompleteRollback(changeId: string): boolean {
  const mark = reloadMarks.get(changeId);
  if (!mark?.needed) return false;
  mark.rollbackFailed = true;
  return true;
}

/** The apply failed: forget its reload, unless its rollback was incomplete (then reload anyway). */
export function clearModuleReload(changeId = ''): void {
  const mark = reloadMarks.get(changeId);
  if (mark?.rollbackFailed) flushModuleReload(changeId);
  else reloadMarks.delete(changeId);
}

/**
 * Foundry loads modules only at startup. Called once, after a whole apply succeeded: when a write
 * changed the module list, every connected window reloads (the same socket message Foundry's own
 * Module Management sends, needs the Modify Configuration Settings permission) and so does this
 * GM window, where the bridge reconnects by itself. A no-op outside a browser (tests).
 */
export function flushModuleReload(changeId = ''): void {
  const mark = reloadMarks.get(changeId);
  reloadMarks.delete(changeId);
  if (!mark?.needed) return;
  const reload = (): void => {
    try {
      const live = game as unknown as {
        user?: { can?: (p: string) => boolean };
        socket?: { emit?: (e: string) => void };
      };
      if (live.user?.can?.('SETTINGS_MODIFY')) live.socket?.emit?.('reload');
    } catch {
      // the local reload below still happens
    }
    const utils = (globalThis as { foundry?: { utils?: { debouncedReload?: () => void } } }).foundry
      ?.utils;
    if (typeof utils?.debouncedReload === 'function') utils.debouncedReload();
    else (globalThis as { location?: { reload?: () => void } }).location?.reload?.();
  };
  setTimeout(reload, MODULE_RELOAD_DELAY_MS);
}

/** The source of a virtual target after a write (for the result's `after` values). */
export function virtualSource(uuid: string): Record<string, unknown> {
  if (uuid.startsWith(PACK_UUID_PREFIX)) return readPackEntry(uuid.slice(PACK_UUID_PREFIX.length));
  const { namespace, key } = parseSettingUuid(uuid);
  return { value: readSettingValue(namespace, key) };
}
