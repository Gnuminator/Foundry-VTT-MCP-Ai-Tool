/**
 * Renown scan (dnd5e 6.1, D-146): a read-only look at the faction actors and the renown items
 * of every actor. Runs on the GM client. The wire contract is `shared/src/renown.ts`; only its
 * types are imported (the browser cannot resolve `@gnuminator/shared` at runtime) and the query
 * name is mirrored here, pinned by `renown-scan.test.ts`.
 *
 * - Factions: actors of type `faction` (dnd5e 6.1): ranks, members and category.
 * - Holders: any actor with `renown` items; an actor's renown with a faction is the sum of its
 *   items' modifiers for the faction identifier (the same sum dnd5e's renown registry keeps).
 */
import type {
  RenownFaction,
  RenownFactionMember,
  RenownHolder,
  RenownItem,
  RenownModifier,
  RenownRank,
  RenownScore,
  RenownState,
} from '@gnuminator/shared';

/** Query name (mirror of the shared `RENOWN_STATE_QUERY`). */
export const RENOWN_STATE_QUERY = 'getRenownState';

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === 'object' ? (value as Rec) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function contentsOf(collection: unknown): unknown[] {
  if (Array.isArray(collection)) return collection;
  const contents = rec(collection)?.contents;
  return Array.isArray(contents) ? contents : [];
}

function localize(key: string): string {
  const i18n = rec(rec(game)?.i18n);
  const fn = i18n?.localize;
  return typeof fn === 'function' ? String(fn.call(i18n, key)) : key;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function renownEnabled(): boolean {
  try {
    const settings = rec(rec(game)?.settings);
    const get = settings?.get;
    return typeof get === 'function' ? Boolean(get.call(settings, 'dnd5e', 'renownScore')) : false;
  } catch {
    return false;
  }
}

function identifierOf(actor: Rec): string {
  return str(actor.identifier) ?? str(rec(actor.system)?.identifier) ?? slug(str(actor.name) ?? '');
}

function ranksOf(system: Rec | null): RenownRank[] {
  const ranks = rec(system?.ranks);
  if (!ranks) return [];
  return Object.entries(ranks)
    .map(([id, value]) => ({
      id,
      name: str(rec(value)?.name) ?? id,
      renown: num(rec(value)?.renown),
    }))
    .sort((a, b) => (a.renown ?? 0) - (b.renown ?? 0));
}

function categoryOf(system: Rec | null, config: Rec | null): string | null {
  const value = str(rec(system?.type)?.value);
  if (!value) return null;
  const label = str(rec(rec(config?.factionCategories)?.[value])?.label);
  return label ? localize(label) : value;
}

function factionOf(actor: Rec, config: Rec | null, actors: unknown): RenownFaction | null {
  const actorId = str(actor.id);
  if (!actorId) return null;
  const system = rec(actor.system);
  const members: RenownFactionMember[] = [];
  for (const entry of contentsOf(system?.members)) {
    const m = rec(entry);
    const uuid = str(m?.uuid);
    if (!uuid) continue;
    const id = uuid.startsWith('Actor.') ? uuid.slice(6) : null;
    const getter = rec(actors)?.get;
    const found = id && typeof getter === 'function' ? rec(getter.call(actors, id)) : null;
    members.push({
      uuid,
      name: str(found?.name),
      rank: str(m?.rank) ?? '',
      role: str(m?.role) ?? '',
    });
  }
  return {
    actorId,
    uuid: str(actor.uuid) ?? `Actor.${actorId}`,
    name: str(actor.name) ?? '',
    identifier: identifierOf(actor),
    category: categoryOf(system, config),
    ranks: ranksOf(system),
    members,
  };
}

function rankFor(faction: RenownFaction | undefined, value: number): string | null {
  if (!faction) return null;
  let rank: string | null = null;
  for (const r of faction.ranks) {
    if (r.renown !== null && value >= r.renown) rank = r.id;
  }
  return rank;
}

function modifiersOf(item: Rec): RenownModifier[] {
  const out: RenownModifier[] = [];
  for (const entry of contentsOf(rec(item.system)?.modifiers)) {
    const m = rec(entry);
    const faction = str(m?.faction);
    const value = num(m?.value);
    if (faction && value !== null && value !== 0) out.push({ faction, value });
  }
  return out;
}

function holderOf(actor: Rec, factions: Map<string, RenownFaction>): RenownHolder | null {
  const actorId = str(actor.id);
  if (!actorId) return null;
  const items: RenownItem[] = [];
  const totals = new Map<string, number>();
  for (const entry of contentsOf(actor.items)) {
    const item = rec(entry);
    if (item?.type !== 'renown') continue;
    const modifiers = modifiersOf(item);
    items.push({
      itemId: str(item.id) ?? '',
      uuid: str(item.uuid) ?? '',
      name: str(item.name) ?? '',
      modifiers,
    });
    for (const { faction, value } of modifiers) {
      totals.set(faction, (totals.get(faction) ?? 0) + value);
    }
  }
  if (items.length === 0) return null;
  const scores: RenownScore[] = [...totals.entries()].map(([faction, value]) => ({
    faction,
    factionName: factions.get(faction)?.name ?? faction,
    value,
    rank: rankFor(factions.get(faction), value),
  }));
  return {
    actorId,
    uuid: str(actor.uuid) ?? `Actor.${actorId}`,
    name: str(actor.name) ?? '',
    type: str(actor.type) ?? '',
    scores,
    items,
  };
}

export function getRenownState(): RenownState {
  const warnings: string[] = [];
  const config = rec(rec(CONFIG)?.DND5E);
  if (!config) warnings.push('The dnd5e system is not loaded, so there are no factions.');
  const actors = rec(game)?.actors;
  const factions: RenownFaction[] = [];
  for (const actor of contentsOf(actors)) {
    const a = rec(actor);
    if (a?.type !== 'faction') continue;
    try {
      const faction = factionOf(a, config, actors);
      if (faction) factions.push(faction);
    } catch (error) {
      warnings.push(
        `Could not read the faction "${str(a.name) ?? '?'}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  factions.sort((a, b) => a.name.localeCompare(b.name));
  const byIdentifier = new Map(factions.map(f => [f.identifier, f]));
  const holders: RenownHolder[] = [];
  for (const actor of contentsOf(actors)) {
    const a = rec(actor);
    if (!a || a.type === 'faction') continue;
    try {
      const holder = holderOf(a, byIdentifier);
      if (holder) holders.push(holder);
    } catch (error) {
      warnings.push(
        `Could not read the renown of "${str(a.name) ?? '?'}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  holders.sort((a, b) => a.name.localeCompare(b.name));
  const creatures = contentsOf(actors).flatMap(actor => {
    const a = rec(actor);
    const actorId = str(a?.id);
    // dnd5e's own faction check is `system.isCreature`; the actor type is the fallback.
    const flag = rec(a?.system)?.isCreature;
    const isCreature =
      typeof flag === 'boolean' ? flag : a?.type === 'character' || a?.type === 'npc';
    return actorId && isCreature ? [{ actorId, name: str(a?.name) ?? '' }] : [];
  });
  return { enabled: renownEnabled(), factions, holders, creatures, warnings };
}
