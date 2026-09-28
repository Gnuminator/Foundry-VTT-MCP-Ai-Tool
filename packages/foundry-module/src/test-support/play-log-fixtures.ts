/**
 * Fixture builders for PlayRecorder tests (O3).
 *
 * PlayRecorder only ever reads the duck-typed arguments Foundry hooks pass it
 * (an actor/item/token/combat/message plus a plain "changed" delta object), so
 * these build small plain objects shaped like the real documents rather than
 * going through the full `test-support/foundry-mock` document builders (which
 * model embedded-collection semantics PlayRecorder never needs). This mirrors
 * how `session-events.test.ts` fires `EventTracker`'s hooks.
 *
 * Test-only: this folder is excluded from the shipped `tsc` build.
 */

/**
 * Merge a Foundry-style partial `changed` object into `target` in place and
 * return it. Real Foundry documents already reflect the new values by the
 * time an `update*` hook fires, so tests that fire `updateActor`/`updateItem`
 * should apply the same patch to the fixture first (see {@link fireUpdate}) —
 * otherwise a lazily-seeded shadow would read the document's stale value.
 */
export function mergeFixture(
  target: Record<string, any>,
  patch: Record<string, any>
): Record<string, any> {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = mergeFixture(
        target[key] && typeof target[key] === 'object' ? target[key] : {},
        value as Record<string, any>
      );
    } else {
      target[key] = value;
    }
  }
  return target;
}

/**
 * Apply `changed` onto `doc` (as Foundry would before the hook fires) and then
 * fire the hook with the same `changed` object, mirroring a real `update*`
 * hook's `(doc, changed, options, userId)` shape.
 */
export function fireUpdate(
  hookName: string,
  doc: any,
  changed: Record<string, any>,
  ...rest: unknown[]
): void {
  mergeFixture(doc, changed);
  Hooks.callAll(hookName, doc, changed, ...rest);
}

export interface FixtureActorOptions {
  id?: string;
  uuid?: string;
  name?: string;
  type?: string;
  system?: Record<string, any>;
  items?: any[];
  t?: number;
  isToken?: boolean;
  tokenUuid?: string;
}

/** A plain actor-shaped object: `.uuid`, `.system`, `.items` (a plain array) and `._stats.modifiedTime`. */
export function makeFixtureActor(opts: FixtureActorOptions = {}): any {
  const id = opts.id ?? 'a1';
  const uuid = opts.uuid ?? `Actor.${id}`;
  const items = opts.items ?? [];
  const actor: any = {
    id,
    uuid,
    documentName: 'Actor',
    name: opts.name ?? 'Hero',
    type: opts.type ?? 'character',
    system: opts.system ?? {},
    items,
    _stats: { modifiedTime: opts.t ?? 1000 },
  };
  if (opts.isToken) {
    actor.isToken = true;
    actor.token = { uuid: opts.tokenUuid ?? `Scene.s1.Token.tk1.Actor.${id}` };
  }
  for (const item of items) item.actor = actor;
  return actor;
}

export interface FixtureItemOptions {
  id?: string;
  uuid?: string;
  name?: string;
  type?: string;
  system?: Record<string, any>;
  t?: number;
}

/** A plain item-shaped object: `.uuid`, `.system` and `._stats.modifiedTime`. Set `.actor` yourself to embed it. */
export function makeFixtureItem(opts: FixtureItemOptions = {}): any {
  const id = opts.id ?? 'i1';
  return {
    id,
    uuid: opts.uuid ?? `Item.${id}`,
    name: opts.name ?? 'Item',
    type: opts.type ?? 'weapon',
    system: opts.system ?? {},
    _stats: { modifiedTime: opts.t ?? 1000 },
  };
}

/** A dnd5e-shaped d20 roll: dice terms with kept/discarded results, and `options.target` for DC/AC. */
export function d20Roll(overrides: Record<string, any> = {}): any {
  return {
    formula: '1d20 + 5',
    total: 18,
    dice: [{ faces: 20, number: 1, results: [{ result: 13, active: true }] }],
    terms: [],
    options: {},
    ...overrides,
  };
}

export interface FixtureMessageOptions {
  id?: string;
  type?: string;
  speaker?: Record<string, unknown>;
  rolls?: any[];
  system?: Record<string, any>;
  flags?: Record<string, any>;
  content?: string;
  style?: number;
  whisper?: string[];
  blind?: boolean;
  t?: number;
}

/** A plain ChatMessage-shaped object, defaulting the 6.0 shape (`type` = the dnd5e subtype, `system` carries its data). */
export function makeFixtureMessage(opts: FixtureMessageOptions = {}): any {
  return {
    id: opts.id ?? 'm1',
    type: opts.type ?? 'base',
    speaker: opts.speaker ?? {},
    rolls: opts.rolls ?? [],
    system: opts.system ?? {},
    flags: opts.flags ?? {},
    content: opts.content ?? '',
    style: opts.style ?? 2,
    whisper: opts.whisper ?? [],
    blind: opts.blind ?? false,
    _stats: { modifiedTime: opts.t ?? 1000 },
  };
}

/** A 5.3-style message: the roll kind and its details live in `flags.dnd5e`, `type` stays `'base'`. */
export function makeLegacyFixtureMessage(
  opts: FixtureMessageOptions & { dnd5eFlags?: Record<string, any> } = {}
): any {
  return makeFixtureMessage({
    ...opts,
    type: 'base',
    flags: { dnd5e: opts.dnd5eFlags ?? {}, ...(opts.flags ?? {}) },
  });
}
