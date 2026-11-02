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
 * does not import the shared package); `virtual-targets.test.ts` compares them.
 */
import { MODULE_ID } from '../constants.js';

export const SETUP_FEATURE_ID = 'foundry-setup';
export const SETTING_UUID_PREFIX = 'GameSetting.';
export const PACK_UUID_PREFIX = 'PackConfig.';

export const MODULE_CONFIG_SETTING = 'core.moduleConfiguration';
export const PACK_CONFIG_SETTING = 'core.compendiumConfiguration';

/** Values over this many JSON characters are never planned (or read back whole). */
export const MAX_SETTING_JSON = 4000;

/** Pack configuration fields a plan may set. */
const PACK_FIELDS = ['ownership', 'locked', 'folder'] as const;

/** A setting that must never be read into a plan: login, keys, tokens, licences, webhooks. */
const SECRET_NAME =
  /pass(word|phrase)?|secret|token|api[-_ ]?key|apikey|auth|credential|private[-_ ]?key|webhook|licen[cs]e|patreon|salt/i;

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
  return map instanceof Map ? (map as Map<string, RegisteredSetting>) : new Map();
}

export function isVirtualUuid(uuid: unknown): uuid is string {
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

/** True for a setting whose value must not reach a plan, a diff or the audit log. */
export function isSecretSetting(namespace: string, key: string): boolean {
  const meta = registeredSettings().get(`${namespace}.${key}`);
  if (SECRET_NAME.test(key) || (meta?.name && SECRET_NAME.test(String(meta.name)))) return true;
  // A free-text setting that no settings screen shows is where modules keep keys and tokens.
  return namespace !== 'core' && meta?.config === false && meta.type === String;
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
  }
  if (isSecretSetting(namespace, key)) {
    throw new Error(`${id} looks like a secret; it is never read or written by a plan`);
  }
  const meta = registeredSettings().get(id);
  if (!meta) throw new Error(`Unknown setting: ${id}`);
}

/** The value as plain, JSON-safe data (a DataModel to its source, a Set to an array). */
function plain(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value instanceof Set) return [...value];
  const withObject = value as { toObject?: (source?: boolean) => unknown } | null;
  if (withObject && typeof withObject === 'object' && typeof withObject.toObject === 'function') {
    return JSON.parse(JSON.stringify(withObject.toObject(true)));
  }
  return value === null || typeof value !== 'object' ? value : JSON.parse(JSON.stringify(value));
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
  mode: 'plan' | 'check' = 'plan'
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
  const value = readSettingValue(namespace, key);
  if (mode === 'plan' && JSON.stringify(value ?? null).length > MAX_SETTING_JSON) {
    throw new Error(
      `${namespace}.${key} holds too much data to plan (over ${MAX_SETTING_JSON} characters)`
    );
  }
  const label = meta?.name ? game.i18n.localize(meta.name) : key;
  return {
    exists: true,
    documentName: 'Setting',
    name: `${label} (${namespace}.${key})`,
    source: { value },
  };
}

function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let node = target;
  for (const key of keys.slice(0, -1)) {
    const next = node[key];
    if (next === null || typeof next !== 'object') node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1] as string] = value;
}

function deleteAtPath(target: Record<string, unknown>, path: string): void {
  const keys = path.split('.');
  let node: unknown = target;
  for (const key of keys.slice(0, -1)) {
    if (node === null || typeof node !== 'object') return;
    node = (node as Record<string, unknown>)[key];
  }
  if (node !== null && typeof node === 'object') {
    delete (node as Record<string, unknown>)[keys[keys.length - 1] as string];
  }
}

/** Write the changes and removals into the target. The caller reads before and after itself. */
export async function executeVirtualUpdate(
  uuid: string,
  changes: Record<string, unknown>,
  unset: readonly string[]
): Promise<void> {
  if (uuid.startsWith(PACK_UUID_PREFIX)) {
    const packId = uuid.slice(PACK_UUID_PREFIX.length);
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
  const holder: Record<string, unknown> = { value: readSettingValue(namespace, key) };
  for (const [path, value] of Object.entries(changes)) setAtPath(holder, path, value);
  for (const path of unset) deleteAtPath(holder, path);
  await game.settings.set(namespace, key, holder.value);
}

/** The source of a virtual target after a write (for the result's `after` values). */
export function virtualSource(uuid: string): Record<string, unknown> {
  if (uuid.startsWith(PACK_UUID_PREFIX)) return readPackEntry(uuid.slice(PACK_UUID_PREFIX.length));
  const { namespace, key } = parseSettingUuid(uuid);
  return { value: readSettingValue(namespace, key) };
}
