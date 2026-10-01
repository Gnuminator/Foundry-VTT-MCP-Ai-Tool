/**
 * Live play plans (F5, D-082): the module's read-only `planLiveChange` query
 * turns one `plan-actor-change` request into guarded ops, built here because
 * dnd5e runs here. Nothing is written; the bridge stores the ops as a plan and
 * `apply-planned-change` runs them.
 *
 * - damage, healing: a dry run of dnd5e's `Actor5e#applyDamage`. Our
 *   `dnd5e.preApplyDamage` hook (registered last, so other modules' hooks see
 *   the damage first) records the updates dnd5e computed and returns false,
 *   which in dnd5e 6.0.5 stops `applyDamage` before it writes. Resistances,
 *   vulnerabilities, immunities and temporary hit points all count. The plan
 *   is a plain HP update; dnd5e's own update hooks still show the floating
 *   numbers, ask for concentration and set Bloodied or Unconscious, and undo
 *   (HP back up) clears Bloodied and the auto-downed condition again.
 * - temp-hp: like dnd5e's `applyTempHP`: only when more than the current temp HP.
 * - condition on: a create of the status effect (dnd5e's fixed id, kept), with
 *   its riders created first (Unconscious brings Prone) so dnd5e does not add
 *   them outside the plan, and the other effects of an exclusive group (cover)
 *   deleted. Exhaustion is an update of `system.attributes.exhaustion`.
 * - condition off, clear-conditions: deletes of the effects.
 * - resource: an update of a spell slot, pact slot, class resource or item uses.
 *
 * The wire contract is `shared/src/live-play.ts`; only its types are imported
 * (the browser cannot resolve `@gnuminator/shared` at runtime). The query name
 * and feature id are mirrored here and pinned by `live-plan.test.ts`.
 */
import type {
  GuardedOp,
  LiveActorRequest,
  LiveChangePlan,
  LiveTargetPreview,
} from '@gnuminator/shared';

import { findStatusEffect, statusEffectList } from './systems/dnd5e/status-effects.js';

/** Query name (mirror of the shared `LIVE_PLAN_QUERY`). */
export const LIVE_PLAN_QUERY = 'planLiveChange';

/** Guarded feature id (mirror of the shared `LIVE_PLAY_FEATURE_ID`). */
export const LIVE_PLAY_FEATURE_ID = 'live-play';

/** Marks our own dry run in `applyDamage`'s options, so the hook ignores real damage. */
const DRY_RUN_OPTION = 'foundryMcpDryRun';

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === 'object' ? (value as Rec) : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getPath(source: unknown, path: string): unknown {
  let cur: unknown = source;
  for (const key of path.split('.')) {
    const r = rec(cur);
    if (!r) return undefined;
    cur = r[key];
  }
  return cur;
}

function contentsOf(collection: unknown): unknown[] {
  if (Array.isArray(collection)) return collection;
  const r = rec(collection);
  if (Array.isArray(r?.contents)) return r.contents as unknown[];
  if (r && typeof (r as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function') {
    return Array.from(collection as Iterable<unknown>);
  }
  return [];
}

function localize(key: string): string {
  const i18n = rec(rec(game as unknown)?.i18n);
  const fn = i18n?.localize;
  return typeof fn === 'function' ? String(fn.call(i18n, key)) : key;
}

/** The actor API this file uses (dnd5e's Actor5e on a real client). */
interface LiveActor {
  readonly uuid: string;
  readonly name: string;
  readonly system: unknown;
  readonly statuses?: Set<string>;
  readonly effects: unknown;
  readonly items: unknown;
  applyDamage?(damages: unknown[], options?: Rec): Promise<unknown>;
}

interface Target {
  name: string;
  actor: LiveActor;
}

function asActor(value: unknown): LiveActor | null {
  const r = rec(value);
  return r && typeof r.uuid === 'string' ? (value as LiveActor) : null;
}

/**
 * Resolve the targets: a token on the current scene (by id or name, so an
 * unlinked token uses its own synthetic actor), else a world actor by id,
 * exact name or a unique partial name. Unknown names fail the whole plan.
 */
function resolveTargets(identifiers: string[]): Target[] {
  if (identifiers.length === 0) throw new Error('Name at least one target (a token or an actor)');
  const g = rec(game as unknown);
  const scene = rec(rec(g?.scenes)?.current);
  const tokens = contentsOf(scene?.tokens);
  const actors = contentsOf(g?.actors);
  const targets: Target[] = [];
  const missing: string[] = [];
  for (const raw of identifiers) {
    const id = raw.trim();
    const lower = id.toLowerCase();
    const token = tokens
      .map(rec)
      .find(t => t && (t.id === id || str(t.name)?.toLowerCase() === lower));
    const tokenActor = asActor(token?.actor);
    if (token && tokenActor) {
      targets.push({ name: str(token.name) ?? tokenActor.name, actor: tokenActor });
      continue;
    }
    const exact = actors
      .map(rec)
      .find(a => a && (a.id === id || str(a.name)?.toLowerCase() === lower));
    const partial = exact
      ? undefined
      : actors.map(rec).filter(a => a && str(a.name)?.toLowerCase().includes(lower));
    const found = asActor(exact ?? (partial?.length === 1 ? partial[0] : null));
    if (found) targets.push({ name: found.name, actor: found });
    else missing.push(id);
  }
  if (missing.length > 0) {
    throw new Error(
      `No token on the current scene or actor named ${missing.map(m => `"${m}"`).join(', ')}`
    );
  }
  const seen = new Set<string>();
  return targets.filter(t => (seen.has(t.actor.uuid) ? false : (seen.add(t.actor.uuid), true)));
}

// ---------------------------------------------------------------------------
// Hit points
// ---------------------------------------------------------------------------

interface Hp {
  value: number;
  max: number;
  temp: number;
}

function hpOf(actor: LiveActor): Hp | null {
  const hp = rec(getPath(actor.system, 'attributes.hp'));
  const value = num(hp?.value);
  if (!hp || value === null) return null;
  return { value, max: num(hp.max) ?? value, temp: num(hp.temp) ?? 0 };
}

/**
 * Run dnd5e's `applyDamage` without writing: our `dnd5e.preApplyDamage` hook
 * records `amount` and the update dnd5e would make, then returns false. Null
 * when dnd5e or another module cancelled the damage before our hook ran.
 */
async function dryRunDamage(
  actor: LiveActor,
  damages: unknown[],
  options: Rec
): Promise<{ amount: number; updates: Rec } | null> {
  if (typeof actor.applyDamage !== 'function') {
    throw new Error(`${actor.name} cannot take damage (dnd5e 6 is needed)`);
  }
  const marker = `dry-${Math.random().toString(36).slice(2)}`;
  let captured: { amount: number; updates: Rec } | null = null;
  const hookId = Hooks.on('dnd5e.preApplyDamage', (...args: unknown[]) => {
    const [, amount, updates, opts] = args;
    if (rec(opts)?.[DRY_RUN_OPTION] !== marker) return undefined;
    captured = { amount: num(amount) ?? 0, updates: { ...(rec(updates) ?? {}) } };
    return false;
  });
  try {
    await actor.applyDamage(damages, { ...options, [DRY_RUN_OPTION]: marker });
  } finally {
    Hooks.off('dnd5e.preApplyDamage', hookId);
  }
  return captured;
}

/**
 * The paths of `updates` whose value differs from the actor's current value. dnd5e writes an
 * empty temp HP or max HP bonus (null) as 0; that is no change, so it stays out of the plan.
 */
function changedOnly(actor: LiveActor, updates: Rec): Rec {
  const changes: Rec = {};
  for (const [path, value] of Object.entries(updates)) {
    const current = getPath(actor, path);
    if (current === value) continue;
    if ((current === null || current === undefined) && value === 0) continue;
    changes[path] = value;
  }
  return changes;
}

function hpAfter(actor: LiveActor, changes: Rec): Hp {
  const before = hpOf(actor) ?? { value: 0, max: 0, temp: 0 };
  return {
    value: num(changes['system.attributes.hp.value']) ?? before.value,
    max: before.max,
    temp: num(changes['system.attributes.hp.temp']) ?? before.temp,
  };
}

function hpText(before: Hp, after: Hp): string {
  const parts: string[] = [];
  if (after.value !== before.value) parts.push(`HP ${before.value} to ${after.value}`);
  if (after.temp !== before.temp) parts.push(`temp HP ${before.temp} to ${after.temp}`);
  return parts.join(', ');
}

function damageTypeLabel(type: string | undefined): string {
  if (!type) return '';
  const config = rec(rec(rec(CONFIG as unknown)?.DND5E)?.damageTypes);
  const label = str(rec(config?.[type])?.label);
  return ` ${(label ? localize(label) : type).toLowerCase()}`;
}

async function planHp(
  targets: Target[],
  request: LiveActorRequest
): Promise<{ ops: GuardedOp[]; previews: LiveTargetPreview[] }> {
  const amount = num(request.amount);
  if (amount === null || amount < 0) throw new Error('Give an amount of 0 or more');
  const ops: GuardedOp[] = [];
  const previews: LiveTargetPreview[] = [];
  for (const { name, actor } of targets) {
    const before = hpOf(actor);
    if (!before) {
      previews.push({
        target: name,
        actorUuid: actor.uuid,
        line: `${name}: has no hit points`,
        skipped: true,
      });
      continue;
    }
    let changes: Rec;
    let what: string;
    if (request.action === 'temp-hp') {
      changes = amount > before.temp ? { 'system.attributes.hp.temp': amount } : {};
      what = `${amount} temp HP`;
      if (Object.keys(changes).length === 0) {
        previews.push({
          target: name,
          actorUuid: actor.uuid,
          line: `${name}: already has ${before.temp} temp HP (temp HP do not stack)`,
          skipped: true,
        });
        continue;
      }
    } else {
      const healing = request.action === 'healing';
      const type = healing ? 'healing' : (request.damageType ?? '');
      const options: Rec = {};
      if (!healing && request.multiplier !== undefined) options.multiplier = request.multiplier;
      if (!healing && request.ignoreResistance) options.ignore = true;
      const result = await dryRunDamage(actor, [{ value: amount, type }], options);
      if (!result) {
        previews.push({
          target: name,
          actorUuid: actor.uuid,
          line: `${name}: dnd5e or another module cancelled the ${healing ? 'healing' : 'damage'}`,
          skipped: true,
        });
        continue;
      }
      changes = changedOnly(actor, result.updates);
      if (healing) {
        what = `heals ${amount}`;
      } else {
        const crit = request.multiplier !== undefined && request.multiplier !== 1;
        what = `${amount}${damageTypeLabel(request.damageType)} damage${crit ? ` x${request.multiplier}` : ''}`;
        if (result.amount !== amount || crit) what += `, ${Math.max(result.amount, 0)} taken`;
      }
    }
    if (Object.keys(changes).length === 0) {
      previews.push({
        target: name,
        actorUuid: actor.uuid,
        line: `${name}: ${what}, no change${request.action === 'healing' ? ' (at full HP)' : ''}`,
        skipped: true,
      });
      continue;
    }
    ops.push({ kind: 'update', uuid: actor.uuid, changes });
    previews.push({
      target: name,
      actorUuid: actor.uuid,
      line: `${name}: ${what}, ${hpText(before, hpAfter(actor, changes))}`,
    });
  }
  return { ops, previews };
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

interface StatusInfo {
  id: string;
  name: string;
  levels: number | null;
  riders: string[];
  exclusiveGroup: string | null;
}

function statusInfo(idOrName: string): StatusInfo {
  const status = findStatusEffect(idOrName.trim());
  if (!status) {
    const known = statusEffectList()
      .map(s => s.id)
      .slice(0, 40)
      .join(', ');
    throw new Error(`Unknown condition "${idOrName}". Known: ${known}`);
  }
  const levels = num(status.levels);
  return {
    id: status.id,
    name: localize(status.name),
    levels: levels !== null && levels > 0 ? levels : null,
    riders: Array.isArray(status.riders)
      ? status.riders.filter((r): r is string => typeof r === 'string')
      : [],
    exclusiveGroup: str(status.exclusiveGroup),
  };
}

function effectsOf(actor: LiveActor): Rec[] {
  return contentsOf(actor.effects)
    .map(rec)
    .filter((e): e is Rec => e !== null);
}

function effectStatuses(effect: Rec): string[] {
  const statuses = effect.statuses;
  if (statuses instanceof Set)
    return [...statuses].filter((s): s is string => typeof s === 'string');
  return Array.isArray(statuses) ? statuses.filter((s): s is string => typeof s === 'string') : [];
}

function hasStatus(actor: LiveActor, id: string): boolean {
  if (actor.statuses instanceof Set) return actor.statuses.has(id);
  return effectsOf(actor).some(e => effectStatuses(e).includes(id));
}

function effectUuid(effect: Rec): string | null {
  return str(effect.uuid);
}

/** The data of a status effect, as `ActiveEffect.fromStatusEffect` builds it (id kept). */
async function statusEffectData(id: string): Promise<Rec> {
  const cls = rec(rec(rec(CONFIG as unknown)?.ActiveEffect)?.documentClass);
  const from = cls?.fromStatusEffect;
  if (typeof from === 'function') {
    const effect = rec(await (from as (id: string) => Promise<unknown>).call(cls, id));
    const toObject = effect?.toObject;
    if (typeof toObject === 'function') return (toObject as () => Rec).call(effect);
  }
  const status = findStatusEffect(id);
  if (!status) throw new Error(`Unknown condition "${id}"`);
  const data: Rec = { name: localize(status.name), img: status.img, statuses: [status.id] };
  if (typeof status._id === 'string') data._id = status._id;
  return data;
}

async function planCondition(
  targets: Target[],
  request: LiveActorRequest
): Promise<{ ops: GuardedOp[]; previews: LiveTargetPreview[]; label: string }> {
  if (!request.condition) throw new Error('Name the condition (prone, poisoned, exhaustion...)');
  const status = statusInfo(request.condition);
  const on = request.active !== false;
  const ops: GuardedOp[] = [];
  const previews: LiveTargetPreview[] = [];
  for (const { name, actor } of targets) {
    const skip = (line: string): void => {
      previews.push({
        target: name,
        actorUuid: actor.uuid,
        line: `${name}: ${line}`,
        skipped: true,
      });
    };
    if (status.levels !== null) {
      const current = num(getPath(actor.system, `attributes.${status.id}`));
      if (current === null) {
        skip(`has no ${status.name} level`);
        continue;
      }
      const wanted = request.level ?? (on ? current + 1 : 0);
      const level = Math.min(Math.max(Math.round(wanted), 0), status.levels);
      if (level === current) {
        skip(`${status.name} is already ${current}`);
        continue;
      }
      ops.push({
        kind: 'update',
        uuid: actor.uuid,
        changes: { [`system.attributes.${status.id}`]: level },
      });
      previews.push({
        target: name,
        actorUuid: actor.uuid,
        line: `${name}: ${status.name} ${current} to ${level}`,
      });
      continue;
    }
    if (!on) {
      const effects = effectsOf(actor).filter(e => effectStatuses(e).includes(status.id));
      const uuids = effects.map(effectUuid).filter((u): u is string => u !== null);
      if (uuids.length === 0) {
        skip(`is not ${status.name}`);
        continue;
      }
      for (const uuid of uuids) ops.push({ kind: 'delete', uuid });
      previews.push({
        target: name,
        actorUuid: actor.uuid,
        line: `${name}: remove ${status.name}`,
      });
      continue;
    }
    if (hasStatus(actor, status.id)) {
      skip(`is already ${status.name}`);
      continue;
    }
    const extras: string[] = [];
    // Riders first: dnd5e adds a missing rider itself after the create, outside the plan.
    for (const riderId of status.riders) {
      if (hasStatus(actor, riderId)) continue;
      const rider = findStatusEffect(riderId);
      ops.push({
        kind: 'create',
        documentName: 'ActiveEffect',
        parentUuid: actor.uuid,
        data: await statusEffectData(riderId),
        keepId: true,
      });
      extras.push(`adds ${rider ? localize(rider.name) : riderId}`);
    }
    if (status.exclusiveGroup) {
      const others = statusEffectList()
        .filter(s => s.id !== status.id && s.exclusiveGroup === status.exclusiveGroup)
        .map(s => s.id);
      for (const effect of effectsOf(actor)) {
        const uuid = effectUuid(effect);
        if (uuid && effectStatuses(effect).some(s => others.includes(s))) {
          ops.push({ kind: 'delete', uuid });
          extras.push(`removes ${str(effect.name) ?? 'the other one'}`);
        }
      }
    }
    ops.push({
      kind: 'create',
      documentName: 'ActiveEffect',
      parentUuid: actor.uuid,
      data: await statusEffectData(status.id),
      keepId: true,
    });
    const tail = extras.length > 0 ? ` (${extras.join(', ')})` : '';
    previews.push({ target: name, actorUuid: actor.uuid, line: `${name}: ${status.name}${tail}` });
  }
  return { ops, previews, label: on ? status.name : `remove ${status.name}` };
}

/** Whether an effect's duration has run out (v14 `expired`, else `duration.remaining <= 0`). */
function isExpired(effect: Rec): boolean {
  if (effect.expired === true) return true;
  const remaining = num(rec(effect.duration)?.remaining);
  return remaining !== null && remaining <= 0;
}

function planClearConditions(
  targets: Target[],
  request: LiveActorRequest
): { ops: GuardedOp[]; previews: LiveTargetPreview[] } {
  const wanted = (request.conditions ?? []).map(c => c.trim().toLowerCase()).filter(Boolean);
  const ids = new Set(wanted.map(w => findStatusEffect(w)?.id ?? w).map(id => id.toLowerCase()));
  const ops: GuardedOp[] = [];
  const previews: LiveTargetPreview[] = [];
  for (const { name, actor } of targets) {
    const remove = effectsOf(actor).filter(effect => {
      if (wanted.length === 0) return isExpired(effect);
      const effectName = str(effect.name)?.toLowerCase() ?? '';
      return (
        wanted.includes(effectName) || effectStatuses(effect).some(s => ids.has(s.toLowerCase()))
      );
    });
    const named = remove
      .map(e => ({ uuid: effectUuid(e), label: str(e.name) ?? '?' }))
      .filter((e): e is { uuid: string; label: string } => e.uuid !== null);
    if (named.length === 0) {
      previews.push({
        target: name,
        actorUuid: actor.uuid,
        line: `${name}: nothing to remove${wanted.length === 0 ? ' (no expired effects)' : ''}`,
        skipped: true,
      });
      continue;
    }
    for (const e of named) ops.push({ kind: 'delete', uuid: e.uuid });
    previews.push({
      target: name,
      actorUuid: actor.uuid,
      line: `${name}: remove ${named.map(e => e.label).join(', ')}`,
    });
  }
  return { ops, previews };
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

function spellSlotLevel(name: string): number | null {
  // "spell3", "level 3", "slot3", "lvl 3" (get-character-resources says "level3"), "3rd", "3".
  const m =
    /(?:spell|slot|level|lvl)\s*([1-9])/.exec(name) ?? /^([1-9])(?:st|nd|rd|th)?$/.exec(name);
  return m ? Number(m[1]) : null;
}

interface ResourcePlan {
  uuid: string;
  path: string;
  label: string;
  current: number | null;
  max: number | null;
  value: unknown;
}

function resourcePlan(actor: LiveActor, resource: string, value: number): ResourcePlan {
  const name = resource.toLowerCase().trim();
  const sys = rec(actor.system);
  const spells = rec(sys?.spells);
  const level = spellSlotLevel(name);
  const check = (max: number | null): void => {
    if (max !== null && value > max) {
      throw new Error(
        `${value} is more than the maximum ${max} for "${resource}" on ${actor.name}`
      );
    }
  };
  if (level !== null) {
    const slot = rec(spells?.[`spell${level}`]);
    if (!slot) throw new Error(`${actor.name} has no level ${level} spell slots`);
    const max = num(slot.max);
    check(max);
    return {
      uuid: actor.uuid,
      path: `system.spells.spell${level}.value`,
      label: `level ${level} spell slots`,
      current: num(slot.value),
      max,
      value,
    };
  }
  if (name === 'pact' || name === 'pact magic') {
    const pact = rec(spells?.pact);
    if (!pact) throw new Error(`${actor.name} has no pact magic slots`);
    const max = num(pact.max);
    check(max);
    return {
      uuid: actor.uuid,
      path: 'system.spells.pact.value',
      label: 'pact slots',
      current: num(pact.value),
      max,
      value,
    };
  }
  const resources = rec(sys?.resources);
  for (const key of ['primary', 'secondary', 'tertiary']) {
    const r = rec(resources?.[key]);
    if (!r) continue;
    const label = (str(r.label) ?? '').toLowerCase();
    if (key === name || label === name || (label && label.includes(name))) {
      const max = num(r.max);
      check(max);
      return {
        uuid: actor.uuid,
        path: `system.resources.${key}.value`,
        label: str(r.label) ?? key,
        current: num(r.value),
        max,
        value,
      };
    }
  }
  const items = contentsOf(actor.items).map(rec);
  const item =
    items.find(i => str(i?.name)?.toLowerCase() === name) ??
    items.find(i => str(i?.name)?.toLowerCase().includes(name));
  const uses = rec(getPath(item?.system, 'uses'));
  const itemUuid = str(item?.uuid);
  if (item && uses && itemUuid) {
    const max = num(uses.max);
    check(max);
    const current = num(uses.value);
    // dnd5e 3+ derives `value` from `max - spent`; write `spent` so the change is stored.
    if (uses.spent !== undefined && max !== null) {
      return {
        uuid: itemUuid,
        path: 'system.uses.spent',
        label: `${str(item.name) ?? 'item'} uses`,
        current,
        max,
        value: Math.max(0, max - value),
      };
    }
    return {
      uuid: itemUuid,
      path: 'system.uses.value',
      label: `${str(item.name) ?? 'item'} uses`,
      current,
      max,
      value,
    };
  }
  throw new Error(
    `No resource "${resource}" on ${actor.name}. Try a spell level ("spell3"), "pact", a class resource label or an item name.`
  );
}

function planResource(
  targets: Target[],
  request: LiveActorRequest
): { ops: GuardedOp[]; previews: LiveTargetPreview[]; label: string } {
  if (!request.resource) throw new Error('Name the resource (spell3, pact, Ki Points, an item...)');
  const value = num(request.value);
  if (value === null || value < 0 || !Number.isInteger(value)) {
    throw new Error('Give the new value as a whole number of 0 or more');
  }
  const ops: GuardedOp[] = [];
  const previews: LiveTargetPreview[] = [];
  let label = request.resource;
  for (const { name, actor } of targets) {
    const plan = resourcePlan(actor, request.resource, value);
    label = plan.label;
    const of = plan.max !== null ? ` of ${plan.max}` : '';
    if (plan.current === value) {
      previews.push({
        target: name,
        actorUuid: actor.uuid,
        line: `${name}: ${plan.label} already ${value}${of}`,
        skipped: true,
      });
      continue;
    }
    ops.push({ kind: 'update', uuid: plan.uuid, changes: { [plan.path]: plan.value } });
    previews.push({
      target: name,
      actorUuid: actor.uuid,
      line: `${name}: ${plan.label} ${plan.current ?? '?'} to ${value}${of}`,
    });
  }
  return { ops, previews, label };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function names(targets: Target[]): string {
  return targets.map(t => t.name).join(', ');
}

/** Build the plan for one request. Throws when nothing would change. */
export async function planLiveChange(data: unknown): Promise<LiveChangePlan> {
  const system = rec(rec(game as unknown)?.system);
  if (system && system.id !== 'dnd5e') {
    throw new Error('Live play changes need the dnd5e game system');
  }
  if (rec(data)?.scope !== 'actor') throw new Error('Unknown live change scope');
  const request = data as LiveActorRequest;
  const targets = resolveTargets(Array.isArray(request.targets) ? request.targets : []);
  let built: { ops: GuardedOp[]; previews: LiveTargetPreview[] };
  let summary: string;
  switch (request.action) {
    case 'damage':
    case 'healing':
    case 'temp-hp': {
      built = await planHp(targets, request);
      const amount = request.amount ?? 0;
      summary =
        request.action === 'damage'
          ? `${amount}${damageTypeLabel(request.damageType)} damage to ${names(targets)}`
          : request.action === 'healing'
            ? `Heal ${names(targets)} by ${amount}`
            : `${amount} temp HP for ${names(targets)}`;
      break;
    }
    case 'condition': {
      const c = await planCondition(targets, request);
      built = c;
      summary =
        request.active === false
          ? `Remove ${c.label.replace(/^remove /, '')} from ${names(targets)}`
          : `${c.label} on ${names(targets)}`;
      break;
    }
    case 'clear-conditions':
      built = planClearConditions(targets, request);
      summary = `Clear ${request.conditions?.length ? request.conditions.join(', ') : 'expired effects'} on ${names(targets)}`;
      break;
    case 'resource': {
      const r = planResource(targets, request);
      built = r;
      summary = `Set ${r.label} to ${request.value ?? '?'} for ${names(targets)}`;
      break;
    }
    default:
      throw new Error(`Unknown action "${String((request as { action?: unknown }).action)}"`);
  }
  if (built.ops.length === 0) {
    throw new Error(`Nothing to change: ${built.previews.map(p => p.line).join('; ')}`);
  }
  return { summary, ops: built.ops, targets: built.previews };
}
