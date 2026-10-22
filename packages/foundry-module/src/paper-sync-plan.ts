/**
 * Paper sync (Paper nights A): the module's read-only `planPaperSync` query turns the numbers on
 * one paper sheet into guarded ops for one character. Nothing is written; the bridge stores the
 * ops as a plan under the `paper-sync` switch and `apply-planned-change` runs them.
 *
 * It reuses the live play planner (`live-plan.ts`) for what that already does: spell slots, pact
 * slots, class resources and item uses go through its `resourcePlan` (so "above the maximum" is
 * refused the same way), conditions and exhaustion through its `planCondition` (status effects
 * with their riders and exclusive groups). New here: hit points as a value, hit dice per class,
 * coins, inspiration, death saves and inventory quantities.
 *
 * Every value is absolute and only fields that differ from the actor become ops. The whole
 * request is refused, with every problem listed, when any field is wrong. XP, level, class and
 * max HP are never written.
 *
 * The wire contract is `shared/src/paper-sync.ts`; only its types are imported (the browser cannot
 * resolve `@gnuminator/shared` at runtime). The query name, feature id and field lists are
 * mirrored here and pinned by `paper-sync-plan.test.ts`.
 */
import type {
  GuardedOp,
  LiveActorRequest,
  PaperSyncChange,
  PaperSyncField,
  PaperSyncPlan,
  PaperSyncRequest,
} from '@gnuminator/shared';

import {
  contentsOf,
  effectsOf,
  effectStatuses,
  getPath,
  hasStatus,
  hpOf,
  num,
  planCondition,
  rec,
  resolveTargets,
  resourcePlan,
  statusEffectData,
  statusInfo,
  str,
  type LiveActor,
  type Rec,
  type Target,
} from './live-plan.js';
import { itemData } from './scene-plan.js';
import { findStatusEffect } from './systems/dnd5e/status-effects.js';

/** Query name (mirror of the shared `PAPER_SYNC_QUERY`). */
export const PAPER_SYNC_QUERY = 'planPaperSync';

/** Feature id (mirror of the shared `PAPER_SYNC_FEATURE_ID`). */
export const PAPER_SYNC_FEATURE_ID = 'paper-sync';

/** Mirror of the shared `PAPER_SYNC_SLOT_KEYS`. */
export const SLOT_KEYS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'pact'];

/** Mirror of the shared `PAPER_SYNC_COINS`. */
export const COINS: readonly string[] = ['pp', 'gp', 'ep', 'sp', 'cp'];

/** Mirror of the shared `PAPER_SYNC_FIELDS`. */
export const FIELDS: readonly string[] = [
  'hp',
  'tempHp',
  'slots',
  'hitDice',
  'resources',
  'coins',
  'exhaustion',
  'conditions',
  'inspiration',
  'resetDeathSaves',
  'inventory',
];

/**
 * The conditions of a paper sheet's "exact set": the 5e conditions. Other status effects
 * (concentration, dead, cover, bloodied) are not on a sheet and stay as they are.
 */
export const SHEET_CONDITIONS: readonly string[] = [
  'blinded',
  'charmed',
  'deafened',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
];

/** Keys with a reason why the sync refuses them, instead of a plain "unknown field". */
const NEVER: Record<string, string> = {
  xp: 'XP is not synced (the campaign uses milestones)',
  level: 'the level is never changed by a paper sync (a level-up happens on the sheet in Foundry)',
  class: 'the class is never changed by a paper sync (a level-up happens on the sheet in Foundry)',
  classes:
    'the class is never changed by a paper sync (a level-up happens on the sheet in Foundry)',
  maxHp: 'max HP is never changed by a paper sync (set it on the sheet in Foundry)',
  hpMax: 'max HP is never changed by a paper sync (set it on the sheet in Foundry)',
};

const MAX_SUMMARY = 300;

type Scalar = string | number | boolean | null;

/** Everything one request builds up. */
interface Build {
  actor: LiveActor;
  target: Target;
  /** In order; updates of one document are merged into one op. */
  ops: GuardedOp[];
  changes: PaperSyncChange[];
  unchanged: string[];
  warnings: string[];
  problems: string[];
  /** Item uuids already changed by this request (a second line for the same item is refused). */
  touched: Set<string>;
}

/** Run one field; a refusal is kept and the next field is still checked. */
async function guard(build: Build, label: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    build.problems.push(label ? `${label}: ${message}` : message);
  }
}

/** An update op; a second update of the same document joins the first. */
function pushUpdate(build: Build, uuid: string, changes: Rec): void {
  const existing = build.ops.find(op => op.kind === 'update' && op.uuid === uuid);
  if (existing?.kind === 'update') {
    // Two fields writing one path (slot "1" and resource "spell1") would silently overwrite.
    const twice = Object.keys(changes).find(path => path in existing.changes);
    if (twice) throw new Error(`${twice} is set by two fields of the sheet`);
    Object.assign(existing.changes, changes);
  } else build.ops.push({ kind: 'update', uuid, changes });
}

/** True when `ops` already creates the document `op` creates (same parent and kept id). */
function sameCreate(ops: GuardedOp[], op: GuardedOp): boolean {
  if (op.kind !== 'create') return false;
  const id = rec(op.data)?._id;
  return (
    typeof id === 'string' &&
    ops.some(
      o =>
        o.kind === 'create' &&
        o.parentUuid === op.parentUuid &&
        o.documentName === op.documentName &&
        rec(o.data)?._id === id
    )
  );
}

function pushOps(build: Build, ops: GuardedOp[]): void {
  for (const op of ops) {
    if (op.kind === 'update') pushUpdate(build, op.uuid, op.changes);
    // One effect can carry several conditions (Unconscious also carries Incapacitated): delete it once.
    else if (op.kind === 'delete' && build.ops.some(o => o.kind === 'delete' && o.uuid === op.uuid))
      continue;
    // Two added conditions can bring the same rider (Unconscious and Prone both create Prone,
    // with the same kept id): create it once.
    else if (op.kind === 'create' && sameCreate(build.ops, op)) continue;
    else build.ops.push(op);
  }
}

function record(
  build: Build,
  field: PaperSyncField,
  label: string,
  before: Scalar,
  after: Scalar,
  line?: string
): void {
  build.changes.push({
    field,
    label,
    before,
    after,
    line: line ?? `${label} ${before} to ${after}`,
  });
}

/** A whole number of 0 or more. */
function whole(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a whole number of 0 or more (got ${JSON.stringify(value)})`);
  }
  return value;
}

function itemsOf(actor: LiveActor): Rec[] {
  return contentsOf(actor.items)
    .map(rec)
    .filter((i): i is Rec => i !== null);
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

function planHp(build: Build, request: PaperSyncRequest): void {
  const { actor } = build;
  if (request.hp === undefined && request.tempHp === undefined) return;
  const before = hpOf(actor);
  if (!before) throw new Error(`${actor.name} has no hit points`);
  if (request.hp !== undefined) {
    const value = whole(request.hp, 'HP');
    // dnd5e clamps HP to effectiveMax (max plus the temporary max HP bonus, negative after a bite
    // that lowers it), so that is the limit, not the larger of the two.
    const max = num(getPath(actor.system, 'attributes.hp.effectiveMax')) ?? before.max;
    if (value > max) throw new Error(`HP ${value} is more than the maximum ${max}`);
    if (value === before.value) build.unchanged.push(`HP already ${value} of ${max}`);
    else {
      pushUpdate(build, actor.uuid, { 'system.attributes.hp.value': value });
      record(build, 'hp', 'HP', before.value, value, `HP ${before.value} to ${value} of ${max}`);
    }
  }
  if (request.tempHp !== undefined) {
    const value = whole(request.tempHp, 'Temp HP');
    if (value === before.temp) build.unchanged.push(`Temp HP already ${value}`);
    else {
      pushUpdate(build, actor.uuid, { 'system.attributes.hp.temp': value });
      record(build, 'tempHp', 'Temp HP', before.temp, value);
    }
  }
}

function planSlots(build: Build, request: PaperSyncRequest): void {
  for (const [key, raw] of Object.entries(request.slots ?? {})) {
    if (raw === undefined) continue;
    if (!SLOT_KEYS.includes(key)) {
      build.problems.push(`slots: "${key}" is not a spell level (1 to 9) or pact`);
      continue;
    }
    const resource = key === 'pact' ? 'pact' : `spell${key}`;
    guardSync(build, `Slots ${key}`, () => {
      const plan = resourcePlan(build.actor, resource, whole(raw, `Slots ${key}`));
      const of = plan.max !== null ? ` of ${plan.max}` : '';
      if (plan.current === raw) {
        build.unchanged.push(`${plan.label} already ${raw}${of}`);
        return;
      }
      pushUpdate(build, plan.uuid, { [plan.path]: plan.value });
      record(
        build,
        'slots',
        plan.label,
        plan.current,
        raw,
        `${plan.label} ${plan.current ?? '?'} to ${raw}${of}`
      );
    });
  }
}

/**
 * `resourcePlan` takes the first partial match; for an absolute-value sync that could write the
 * wrong item, so a partial item name that fits several items (and no exact name) is refused.
 */
function assertOneResource(actor: LiveActor, name: string): void {
  const needle = name.toLowerCase().trim();
  const sys = rec(actor.system);
  const resources = rec(sys?.resources);
  const labelled = ['primary', 'secondary', 'tertiary'].some(key => {
    const label = (str(rec(resources?.[key])?.label) ?? '').toLowerCase();
    return key === needle || label.includes(needle);
  });
  if (labelled || /^(spell|slot|level|lvl)?\s*[1-9]/.test(needle) || needle.startsWith('pact'))
    return;
  const items = itemsOf(actor).filter(i => str(i.name)?.toLowerCase().includes(needle));
  const exact = items.filter(i => str(i.name)?.toLowerCase() === needle);
  if (exact.length === 0 && items.length > 1) {
    throw new Error(
      `"${name}" fits ${items.map(i => str(i.name) ?? '?').join(', ')}: give the full name`
    );
  }
}

function planResources(build: Build, request: PaperSyncRequest): void {
  for (const entry of request.resources ?? []) {
    guardSync(build, entry.name, () => {
      const value = whole(entry.value, entry.name);
      assertOneResource(build.actor, entry.name);
      const plan = resourcePlan(build.actor, entry.name, value);
      // An item without uses has no stored value to write (dnd5e leaves uses.max empty).
      if (plan.max === null) throw new Error(`${plan.label} has no maximum to set`);
      const of = ` of ${plan.max}`;
      if (plan.current === entry.value) {
        build.unchanged.push(`${plan.label} already ${entry.value}${of}`);
        return;
      }
      pushUpdate(build, plan.uuid, { [plan.path]: plan.value });
      record(
        build,
        'resources',
        plan.label,
        plan.current,
        entry.value,
        `${plan.label} ${plan.current ?? '?'} to ${entry.value}${of}`
      );
    });
  }
}

/** The synchronous twin of `guard` for fields that do not await. */
function guardSync(build: Build, label: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    build.problems.push(label ? `${label}: ${message}` : message);
  }
}

function planHitDice(build: Build, request: PaperSyncRequest): void {
  const classes = itemsOf(build.actor).filter(i => i.type === 'class');
  for (const entry of request.hitDice ?? []) {
    guardSync(build, `Hit dice ${entry.class ?? ''}`.trim(), () => {
      const wanted = entry.class?.trim().toLowerCase();
      const found = wanted
        ? classes.find(
            c =>
              str(c.name)?.toLowerCase() === wanted ||
              str(getPath(c.system, 'identifier'))?.toLowerCase() === wanted
          )
        : classes.length === 1
          ? classes[0]
          : undefined;
      if (!found) {
        throw new Error(
          wanted
            ? `${build.actor.name} has no class "${entry.class}" (classes: ${classes.map(c => str(c.name) ?? '?').join(', ') || 'none'})`
            : `name the class (classes: ${classes.map(c => str(c.name) ?? '?').join(', ') || 'none'})`
        );
      }
      const name = str(found.name) ?? 'class';
      const uuid = str(found.uuid);
      if (!uuid) throw new Error(`the ${name} class has no uuid`);
      const left = whole(entry.left, 'hit dice left');
      // dnd5e: hd.max is the class levels plus extra hit dice; hd.value is max minus spent.
      const levels =
        num(getPath(found.system, 'hd.max')) ?? num(getPath(found.system, 'levels')) ?? 0;
      if (left > levels) throw new Error(`${left} is more than the ${levels} hit dice of ${name}`);
      const spent = num(getPath(found.system, 'hd.spent')) ?? 0;
      const now = Math.max(levels - spent, 0);
      const die = str(getPath(found.system, 'hd.denomination'));
      const label = `${name} hit dice${die ? ` (${die})` : ''}`;
      if (now === left) {
        build.unchanged.push(`${label} already ${left} of ${levels}`);
        return;
      }
      pushUpdate(build, uuid, { 'system.hd.spent': levels - left });
      record(build, 'hitDice', label, now, left, `${label} ${now} to ${left} of ${levels}`);
    });
  }
}

function planCoins(build: Build, request: PaperSyncRequest): void {
  for (const [coin, raw] of Object.entries(request.coins ?? {})) {
    if (raw === undefined) continue;
    guardSync(build, coin, () => {
      if (!COINS.includes(coin)) throw new Error(`not a coin (pp, gp, ep, sp, cp)`);
      const value = whole(raw, coin);
      const current = num(getPath(build.actor.system, `currency.${coin}`)) ?? 0;
      if (current === value) {
        build.unchanged.push(`${coin} already ${value}`);
        return;
      }
      pushUpdate(build, build.actor.uuid, { [`system.currency.${coin}`]: value });
      record(build, 'coins', coin, current, value);
    });
  }
}

async function planExhaustion(build: Build, request: PaperSyncRequest): Promise<void> {
  if (request.exhaustion === undefined) return;
  const level = whole(request.exhaustion, 'Exhaustion');
  const info = statusInfo('exhaustion');
  const top = info.levels ?? 6;
  if (level > top) throw new Error(`level ${level} is more than the maximum ${top}`);
  const current = num(getPath(build.actor.system, 'attributes.exhaustion'));
  if (current === null) throw new Error(`${build.actor.name} has no exhaustion level`);
  if (current === level) {
    build.unchanged.push(`Exhaustion already ${level}`);
    return;
  }
  const built = await planCondition([build.target], {
    scope: 'actor',
    action: 'condition',
    targets: [build.actor.uuid],
    condition: 'exhaustion',
    active: true,
    level,
  });
  pushOps(build, built.ops);
  record(build, 'exhaustion', 'Exhaustion', current, level);
}

/** The other statuses a status effect carries with it (`statuses` on the effect config). */
function impliedStatuses(id: string): string[] {
  const implied = rec(findStatusEffect(id))?.statuses;
  return Array.isArray(implied)
    ? implied.filter((s): s is string => typeof s === 'string' && s !== id)
    : [];
}

async function planConditions(build: Build, request: PaperSyncRequest): Promise<void> {
  if (request.conditions === undefined) return;
  const wanted = new Map<string, ReturnType<typeof statusInfo>>();
  for (const name of request.conditions) {
    const info = statusInfo(name);
    if (!SHEET_CONDITIONS.includes(info.id)) {
      throw new Error(
        info.id === 'exhaustion'
          ? 'exhaustion has its own field (exhaustion)'
          : `"${name}" is not a condition on a character sheet (${SHEET_CONDITIONS.join(', ')})`
      );
    }
    wanted.set(info.id, info);
  }
  // What stays with a wanted condition: its riders (Unconscious brings Prone) and the statuses
  // dnd5e builds into it (Paralyzed, Petrified, Stunned and Unconscious all carry Incapacitated).
  const keep = new Set<string>(wanted.keys());
  for (const info of wanted.values()) {
    for (const id of [...info.riders, ...impliedStatuses(info.id)]) keep.add(id);
  }
  const present = SHEET_CONDITIONS.filter(id => hasStatus(build.actor, id));
  const remove = present.filter(id => !keep.has(id));
  const add = [...wanted.keys()].filter(id => !present.includes(id));
  const labelOf = (id: string): string => statusInfo(id).name;
  const listOf = (ids: string[]): string => (ids.length ? ids.map(labelOf).join(', ') : 'none');
  if (remove.length === 0 && add.length === 0) {
    build.unchanged.push(`Conditions already ${listOf(present)}`);
    return;
  }
  const conditionRequest = (condition: string, active: boolean): LiveActorRequest => ({
    scope: 'actor',
    action: 'condition',
    targets: [build.actor.uuid],
    condition,
    active,
  });
  const opsBefore = build.ops.length;
  // A status no effect of the actor carries (it comes from an item) cannot be removed here.
  const stuck: string[] = [];
  for (const id of remove) {
    const built = await planCondition([build.target], conditionRequest(id, false));
    if (built.ops.length === 0) stuck.push(id);
    pushOps(build, built.ops);
  }
  // A wanted condition that only shows because an effect we delete carries it (the sheet says
  // Incapacitated, the character is Paralyzed) goes with that effect: create it again.
  const effects = effectsOf(build.actor);
  const deleted = new Set(build.ops.flatMap(op => (op.kind === 'delete' ? [op.uuid] : [])));
  for (const id of add) {
    pushOps(build, (await planCondition([build.target], conditionRequest(id, true))).ops);
  }
  for (const id of wanted.keys()) {
    if (add.includes(id) || !present.includes(id)) continue;
    const carriers = effects.filter(effect => effectStatuses(effect).includes(id));
    if (carriers.length > 0 && carriers.every(effect => deleted.has(str(effect.uuid) ?? ''))) {
      pushOps(build, [
        {
          kind: 'create',
          documentName: 'ActiveEffect',
          parentUuid: build.actor.uuid,
          data: await statusEffectData(id),
          keepId: true,
        },
      ]);
    }
  }
  if (stuck.length > 0) {
    build.warnings.push(
      `${listOf(stuck)} comes from an item or another effect and stays; remove it on the sheet`
    );
  }
  if (build.ops.length === opsBefore) {
    build.unchanged.push(`Conditions already ${listOf(present)}`);
    return;
  }
  const after = [
    ...new Set([...present.filter(id => !remove.includes(id) || stuck.includes(id)), ...add]),
  ];
  record(
    build,
    'conditions',
    'Conditions',
    listOf(present),
    listOf(after),
    `Conditions ${listOf(present)} to ${listOf(after)}`
  );
}

function planInspiration(build: Build, request: PaperSyncRequest): void {
  if (request.inspiration === undefined) return;
  if (typeof request.inspiration !== 'boolean')
    throw new Error('inspiration must be true or false');
  const current = getPath(build.actor.system, 'attributes.inspiration') === true;
  if (current === request.inspiration) {
    build.unchanged.push(`Inspiration already ${current ? 'on' : 'off'}`);
    return;
  }
  pushUpdate(build, build.actor.uuid, { 'system.attributes.inspiration': request.inspiration });
  record(
    build,
    'inspiration',
    'Inspiration',
    current,
    request.inspiration,
    request.inspiration ? 'Inspiration gained' : 'Inspiration used'
  );
}

function planDeathSaves(build: Build, request: PaperSyncRequest): void {
  if (request.resetDeathSaves !== true) return;
  const success = num(getPath(build.actor.system, 'attributes.death.success')) ?? 0;
  const failure = num(getPath(build.actor.system, 'attributes.death.failure')) ?? 0;
  if (success === 0 && failure === 0) {
    build.unchanged.push('Death saves already clear');
    return;
  }
  pushUpdate(build, build.actor.uuid, {
    'system.attributes.death.success': 0,
    'system.attributes.death.failure': 0,
  });
  record(
    build,
    'resetDeathSaves',
    'Death saves',
    `${success} successes, ${failure} failures`,
    'reset',
    `Death saves reset (were ${success} successes, ${failure} failures)`
  );
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

/** An item with a quantity: a physical item (gear, weapon, loot, container...). */
function quantityOf(item: Rec): number | null {
  return num(getPath(item.system, 'quantity'));
}

/** The actor's item for a name, id or uuid; throws when there is none or it is not unique. */
function findItem(actor: LiveActor, wanted: string): Rec {
  const needle = wanted.trim().toLowerCase();
  const items = itemsOf(actor);
  const byId = items.filter(i => i.id === wanted.trim() || i.uuid === wanted.trim());
  if (byId.length === 1 && byId[0]) return byId[0];
  const exact = items.filter(i => str(i.name)?.toLowerCase() === needle);
  const partial =
    exact.length > 0 ? exact : items.filter(i => str(i.name)?.toLowerCase().includes(needle));
  if (partial.length === 1 && partial[0]) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `"${wanted}" matches ${partial.map(i => `${str(i.name) ?? '?'} (id ${str(i.id) ?? '?'})`).join(', ')}: give the id`
    );
  }
  throw new Error(
    `${actor.name} has no item "${wanted}" (to add one, give its compendium uuid in "uuid")`
  );
}

/** The actor's item with this name that has a quantity, or null (to add a compendium item). */
function sameNamed(actor: LiveActor, name: string): Rec | null {
  const found = itemsOf(actor).filter(
    i => str(i.name)?.toLowerCase() === name.toLowerCase() && quantityOf(i) !== null
  );
  if (found.length > 1) {
    throw new Error(
      `${actor.name} has more than one "${name}": name the one with its id in "item"`
    );
  }
  return found[0] ?? null;
}

async function planInventory(build: Build, request: PaperSyncRequest): Promise<void> {
  const { actor } = build;
  const fromUuidFn = (globalThis as { fromUuid?: (uuid: string) => Promise<unknown> }).fromUuid;
  for (const [index, line] of (request.inventory ?? []).entries()) {
    await guard(build, `Inventory line ${index + 1}`, async () => {
      if ((line.item === undefined) === (line.uuid === undefined)) {
        throw new Error('give either "item" (on the sheet) or "uuid" (a compendium item to add)');
      }
      const quantity = whole(line.quantity, 'quantity');
      let existing: Rec | null = null;
      let added: Rec | null = null;
      if (line.item !== undefined) {
        existing = findItem(actor, line.item);
      } else if (line.uuid !== undefined) {
        // An item the character already has (its own uuid), else a compendium or world item to add.
        existing = itemsOf(actor).find(i => i.uuid === line.uuid) ?? null;
        if (!existing) {
          const doc = rec(fromUuidFn ? await fromUuidFn(line.uuid).catch(() => null) : null);
          if (doc?.documentName !== 'Item' || typeof doc.toObject !== 'function') {
            throw new Error(`${line.uuid} is not an item`);
          }
          added = itemData(doc as unknown as { toObject(): Rec });
          if (num(getPath(added.system, 'quantity')) === null) {
            throw new Error(
              `${str(added.name) ?? line.uuid} has no quantity (it is not an inventory item)`
            );
          }
          existing = sameNamed(actor, str(added.name) ?? '');
        }
      }
      if (existing) {
        const name = str(existing.name) ?? 'item';
        const uuid = str(existing.uuid);
        const before = quantityOf(existing);
        if (!uuid) throw new Error(`${name} has no uuid`);
        if (before === null)
          throw new Error(`${name} has no quantity (it is not an inventory item)`);
        if (build.touched.has(uuid)) throw new Error(`${name} is on the list twice`);
        build.touched.add(uuid);
        if (before === quantity) {
          build.unchanged.push(`${name} already ${quantity}`);
        } else if (quantity === 0) {
          // Updating and then deleting one item cannot be undone (the undo's update has no target).
          if (build.ops.some(op => op.kind === 'update' && op.uuid === uuid)) {
            throw new Error(`${name} is both changed (uses) and removed: give one of the two`);
          }
          build.ops.push({ kind: 'delete', uuid });
          record(build, 'inventory', name, before, 0, `${name} removed (was ${before})`);
          if (existing.type === 'container') {
            build.warnings.push(`${name} is a container: what is inside it stays on the character`);
          }
        } else {
          pushUpdate(build, uuid, { 'system.quantity': quantity });
          record(build, 'inventory', name, before, quantity);
        }
        return;
      }
      if (!added) throw new Error('nothing to change');
      const name = str(added.name) ?? 'item';
      if (quantity === 0) {
        build.unchanged.push(`${name} not on the character, quantity 0`);
        return;
      }
      added.system = { ...(rec(added.system) ?? {}), quantity };
      build.ops.push({ kind: 'create', documentName: 'Item', parentUuid: actor.uuid, data: added });
      record(build, 'inventory', name, null, quantity, `${name} added (${quantity})`);
    });
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function checkKeys(data: Rec): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(data)) {
    if (key === 'actor' || FIELDS.includes(key)) continue;
    problems.push(`${key}: ${NEVER[key] ?? 'not a paper sync field'}`);
  }
  return problems;
}

function summaryOf(name: string, changes: PaperSyncChange[]): string {
  const text = `Paper sync ${name}: ${changes.map(c => c.line).join(', ')}`;
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 3).trimEnd()}...` : text;
}

/** Build the plan for one character. Throws when a field is wrong or nothing would change. */
export async function planPaperSync(data: unknown): Promise<PaperSyncPlan> {
  const system = rec(rec(game)?.system);
  if (system && system.id !== 'dnd5e') throw new Error('Paper sync needs the dnd5e game system');
  const input = rec(data);
  const name = str(input?.actor);
  if (!input || !name) throw new Error('Name the character (actor)');
  const keyProblems = checkKeys(input);
  if (keyProblems.length > 0) throw new Error(`Not planned: ${keyProblems.join('; ')}`);
  const request = input as unknown as PaperSyncRequest;

  const [target] = resolveTargets([name]);
  if (!target) throw new Error(`No actor named "${name}"`);
  const { actor } = target;
  if (actor.type !== undefined && actor.type !== 'character') {
    throw new Error(`${target.name} is not a player character (paper sync is for characters)`);
  }
  if (!actor.uuid.startsWith('Actor.')) {
    throw new Error(
      `${target.name} resolved to an unlinked token on this scene; give the character's actor id (Copy Document ID in the sidebar), not the name`
    );
  }
  const build: Build = {
    actor,
    target,
    ops: [],
    changes: [],
    unchanged: [],
    warnings: [],
    problems: [],
    touched: new Set(),
  };

  guardSync(build, '', () => planHp(build, request));
  planSlots(build, request);
  planHitDice(build, request);
  planResources(build, request);
  planCoins(build, request);
  await guard(build, 'Exhaustion', () => planExhaustion(build, request));
  await guard(build, 'Conditions', () => planConditions(build, request));
  guardSync(build, '', () => planInspiration(build, request));
  guardSync(build, '', () => planDeathSaves(build, request));
  await planInventory(build, request);

  if (build.problems.length > 0) {
    throw new Error(`Not planned for ${target.name}: ${build.problems.join('; ')}`);
  }
  if (build.ops.length === 0) {
    const same = build.unchanged.length > 0 ? build.unchanged.join('; ') : 'no fields were given';
    throw new Error(`Nothing to change for ${target.name}: ${same}`);
  }
  return {
    summary: summaryOf(target.name, build.changes),
    ops: build.ops,
    actor: { name: target.name, uuid: actor.uuid },
    changes: build.changes,
    unchanged: build.unchanged,
    warnings: build.warnings,
  };
}
