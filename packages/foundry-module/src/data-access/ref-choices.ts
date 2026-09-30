/**
 * Candidates for the dashboard's tool-parameter pickers (`list-ref-choices`).
 *
 * The dashboard's tool runner offers, next to every parameter that names a
 * document, a searchable list of what exists right now (the tokens on the
 * current scene, the world's actors, a pack's entries, ...), so the GM picks
 * instead of typing ids. This file lists them; it changes nothing. Like every
 * bridge query it runs only for a GM (the socket bridge gates it), so hidden
 * tokens and GM-only journals are listed, marked `hidden` where players cannot
 * see them.
 *
 * Wire shapes mirror `shared/src/tool-refs.ts` (the module does not import the
 * shared package).
 */

import { statusEffectList } from '../systems/dnd5e/status-effects.js';
import { isToolTemplateRegion, toolTemplateFlag } from '../systems/regions.js';
import { supportsMeasuredTemplates } from '../systems/core.js';

/** Optional fields may be undefined here; JSON drops them on the wire. */
export interface RefChoice {
  id: string;
  uuid?: string | undefined;
  name: string;
  detail?: string | undefined;
  group?: string | undefined;
  hidden?: boolean | undefined;
}

export interface RefChoicesResult {
  kind: string;
  choices: RefChoice[];
  truncated: boolean;
  note?: string;
}

interface RefFilter {
  types?: string[];
  playerOwned?: boolean;
  onSceneFirst?: boolean;
  role?: 'gm' | 'player';
  documentName?: string;
  includeSystem?: boolean;
}

interface ListRequest {
  filter: RefFilter;
  /** The parent parameter's value (scene, pack, actor, journal), or ''. */
  parent: string;
  /** Lower-cased search text, or ''. */
  query: string;
  limit: number;
}

interface Listed {
  choices: RefChoice[];
  note?: string;
}

/** The token fields read here (scene tokens are untyped in the v14 declarations). */
interface TokenLike {
  id: string;
  uuid: string;
  name: string;
  hidden: boolean;
  disposition: number;
  x: number;
  y: number;
  actorId?: string | null;
  actor: Actor | null;
}

interface NoteLike {
  id: string;
  uuid: string;
  text?: string;
  entry?: { name?: string } | null;
}

interface TemplateLike {
  id: string;
  uuid: string;
  t?: string;
  distance?: number;
}

/** A Region document as read here: enough to check the tool's template flag. */
interface RegionLike {
  id: string;
  uuid: string;
  flags?: Record<string, unknown>;
}

interface PlaylistLike {
  id: string;
  uuid: string;
  name: string;
  playing?: boolean;
}

interface Dnd5eConfig {
  DND5E?: {
    skills?: Record<string, { label?: string; ability?: string }>;
    abilities?: Record<string, { label?: string; abbreviation?: string }>;
  };
}

export const DEFAULT_REF_LIMIT = 200;
export const MAX_REF_LIMIT = 500;

const DISPOSITIONS: Record<number, string> = {
  [-2]: 'Secret',
  [-1]: 'Hostile',
  0: 'Neutral',
  1: 'Friendly',
};

const ROLE_NAMES: Record<number, string> = {
  0: 'None',
  1: 'Player',
  2: 'Trusted Player',
  3: 'Assistant GM',
  4: 'Gamemaster',
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function localize(key: string | undefined): string {
  if (!key) return '';
  const i18n = (game as Partial<Game>).i18n;
  return i18n?.has(key) ? i18n.localize(key) : key;
}

function detail(...parts: Array<string | false | null | undefined>): string | undefined {
  const joined = parts.filter((p): p is string => typeof p === 'string' && p !== '').join(', ');
  return joined === '' ? undefined : joined;
}

function readFilter(raw: unknown): RefFilter {
  if (!raw || typeof raw !== 'object') return {};
  const f = raw as Record<string, unknown>;
  const out: RefFilter = {};
  if (Array.isArray(f.types)) {
    out.types = f.types.filter((t): t is string => typeof t === 'string');
  }
  if (typeof f.playerOwned === 'boolean') out.playerOwned = f.playerOwned;
  if (typeof f.onSceneFirst === 'boolean') out.onSceneFirst = f.onSceneFirst;
  if (f.role === 'gm' || f.role === 'player') out.role = f.role;
  if (typeof f.documentName === 'string') out.documentName = f.documentName;
  if (typeof f.includeSystem === 'boolean') out.includeSystem = f.includeSystem;
  return out;
}

function byGroupThenName(a: RefChoice, b: RefChoice): number {
  return (a.group ?? '').localeCompare(b.group ?? '') || a.name.localeCompare(b.name);
}

/** A world document by id, uuid or exact name. */
function findIn<T extends { id: string; uuid: string; name: string }>(
  collection: FoundryCollection<T>,
  key: string
): T | undefined {
  return collection.get(key) ?? collection.find(d => d.uuid === key) ?? collection.getName(key);
}

/** The scene named by `parent` (id, uuid or name), else the current scene. */
function sceneFor(parent: string): Scene | null {
  if (parent) return findIn(game.scenes, parent) ?? null;
  return game.scenes.current ?? null;
}

function typeAllowed(type: string | undefined, filter: RefFilter): boolean {
  return !filter.types?.length || (type !== undefined && filter.types.includes(type));
}

// ---------------------------------------------------------------------------
// Listers, one per kind
// ---------------------------------------------------------------------------

/** Group name for actors with a token on the current scene (`onSceneFirst`). */
export const ON_SCENE_GROUP = 'On this scene';

/**
 * World actors. With `onSceneFirst`, actors that have a token on the current scene come
 * first under {@link ON_SCENE_GROUP}, so a picker in a big world (700+ actors, I-017)
 * starts with the ones at the table.
 */
function listActors({ filter }: ListRequest): Listed {
  const onScene = new Set<string>();
  if (filter.onSceneFirst) {
    const tokens = (game.scenes.current?.tokens.contents ?? []) as TokenLike[];
    for (const t of tokens) {
      const id = t.actorId ?? t.actor?.id;
      if (id) onScene.add(id);
    }
  }
  const choices = game.actors.contents
    .filter(a => typeAllowed(a.type, filter) && (!filter.playerOwned || a.hasPlayerOwner))
    .map(a => ({
      id: a.id,
      uuid: a.uuid,
      name: a.name,
      detail: detail(a.type, a.hasPlayerOwner && 'player-owned'),
      group: onScene.has(a.id) ? ON_SCENE_GROUP : (a.folder?.name ?? a.type),
    }));
  const first = (c: RefChoice): number => (c.group === ON_SCENE_GROUP ? 0 : 1);
  return { choices: choices.sort((a, b) => first(a) - first(b) || byGroupThenName(a, b)) };
}

function listTokens({ parent }: ListRequest): Listed {
  const scene = sceneFor(parent);
  if (!scene) {
    return { choices: [], note: parent ? `No scene "${parent}"` : 'No current scene' };
  }
  const tokens = scene.tokens.contents as TokenLike[];
  const choices = tokens.map(t => ({
    id: t.id,
    uuid: t.uuid,
    name: t.name,
    // The position tells same-named tokens apart (three "Wolf" tokens).
    detail: detail(
      t.actor?.type,
      t.hidden && 'hidden',
      `at ${Math.round(t.x)}, ${Math.round(t.y)}`
    ),
    group: DISPOSITIONS[t.disposition] ?? 'Other',
    hidden: t.hidden,
  }));
  return {
    choices: choices.sort(byGroupThenName),
    note: `Tokens on "${scene.name}"`,
  };
}

function listScenes(): Listed {
  const current = game.scenes.current?.id;
  const choices = game.scenes.contents.map(s => ({
    id: s.id,
    uuid: s.uuid,
    name: s.name,
    detail: detail(s.active && 'active', s.id === current && 'current'),
    ...(s.folder ? { group: s.folder.name } : {}),
  }));
  return { choices: choices.sort(byGroupThenName) };
}

function isHiddenFromPlayers(ownership: Record<string, number> | undefined): boolean {
  if (!ownership) return false;
  const levels = Object.values(ownership);
  return (ownership.default ?? 0) < 1 && !levels.some(level => level >= 1 && level < 3);
}

function listJournals(): Listed {
  const choices = game.journal.contents.map(j => ({
    id: j.id,
    uuid: j.uuid,
    name: j.name,
    detail: detail(`${j.pages.size} page(s)`),
    ...(j.folder ? { group: j.folder.name } : {}),
    hidden: isHiddenFromPlayers(j.ownership),
  }));
  return { choices: choices.sort(byGroupThenName) };
}

function listJournalPages({ parent }: ListRequest): Listed {
  const journals = parent ? [findIn(game.journal, parent)].filter(Boolean) : game.journal.contents;
  if (parent && journals.length === 0) return { choices: [], note: `No journal "${parent}"` };
  const choices: RefChoice[] = [];
  for (const journal of journals as JournalEntry[]) {
    for (const page of journal.pages.contents) {
      choices.push({
        id: page.id,
        uuid: page.uuid,
        name: page.name,
        detail: page.type,
        group: journal.name,
      });
    }
  }
  return { choices };
}

function listItems({ filter }: ListRequest): Listed {
  const choices = game.items.contents
    .filter(i => typeAllowed(i.type, filter))
    .map(i => ({
      id: i.id,
      uuid: i.uuid,
      name: i.name,
      detail: i.type,
      group: i.folder?.name ?? i.type,
    }));
  return { choices: choices.sort(byGroupThenName) };
}

function listActorItems({ parent, filter }: ListRequest): Listed {
  if (!parent) return { choices: [], note: 'Choose the actor first' };
  const actor = findIn(game.actors, parent);
  if (!actor) return { choices: [], note: `No actor "${parent}"` };
  const choices = actor.items.contents
    .filter(i => typeAllowed(i.type, filter))
    .map(i => ({ id: i.id, uuid: i.uuid, name: i.name, detail: i.type, group: i.type }));
  return { choices: choices.sort(byGroupThenName), note: `Items of ${actor.name}` };
}

function listCombatants(): Listed {
  const combat = game.combat;
  if (!combat) return { choices: [], note: 'No active combat' };
  const choices = combat.combatants.contents.map(c => ({
    id: c.id,
    uuid: c.uuid,
    name: c.name,
    detail: detail(
      c.initiative === null ? 'no initiative' : `initiative ${c.initiative}`,
      c.defeated && 'defeated',
      c.hidden && 'hidden'
    ),
    hidden: c.hidden,
  }));
  return { choices };
}

function listUsers({ filter }: ListRequest): Listed {
  const choices = game.users.contents
    .filter(u => !filter.role || (filter.role === 'gm' ? u.isGM : !u.isGM))
    .map(u => ({
      id: u.id,
      uuid: u.uuid,
      name: u.name,
      detail: detail(
        ROLE_NAMES[u.role] ?? (u.isGM ? 'GM' : 'Player'),
        u.active ? 'online' : 'offline'
      ),
      group: u.isGM ? 'Gamemasters' : 'Players',
    }));
  return { choices: choices.sort(byGroupThenName) };
}

function listFolders({ filter }: ListRequest): Listed {
  const choices = game.folders.contents
    .filter(f => !filter.documentName || f.type === filter.documentName)
    .map(f => ({ id: f.id, uuid: f.uuid, name: f.name, group: f.type }));
  return { choices: choices.sort(byGroupThenName) };
}

function packsFor(filter: RefFilter): CompendiumCollection[] {
  return game.packs.contents.filter(
    p => !filter.documentName || p.documentName === filter.documentName
  );
}

function listPacks({ filter }: ListRequest): Listed {
  const choices = packsFor(filter).map(p => ({
    id: p.metadata.id,
    name: p.metadata.label,
    detail: detail(p.documentName, p.metadata.packageName),
    group: p.documentName,
  }));
  return { choices: choices.sort(byGroupThenName) };
}

async function packIndex(pack: CompendiumCollection): Promise<CompendiumIndexEntry[]> {
  const index = pack.indexed ? pack.index : await pack.getIndex();
  return index.contents;
}

async function listPackEntries({ parent, filter, query, limit }: ListRequest): Promise<Listed> {
  let packs: CompendiumCollection[];
  if (parent) {
    const pack = game.packs.get(parent);
    if (!pack) return { choices: [], note: `No compendium pack "${parent}"` };
    packs = [pack];
  } else {
    if (query.length < 2) {
      return { choices: [], note: 'Type at least 2 letters to search the compendiums' };
    }
    packs = packsFor(filter);
  }
  const choices: RefChoice[] = [];
  for (const pack of packs) {
    for (const entry of await packIndex(pack)) {
      if (!typeAllowed(entry.type, filter)) continue;
      if (query && !entry.name.toLowerCase().includes(query)) continue;
      choices.push({
        id: entry._id,
        uuid: entry.uuid ?? `Compendium.${pack.metadata.id}.${pack.documentName}.${entry._id}`,
        name: entry.name,
        detail: detail(entry.type),
        group: pack.metadata.label,
      });
      if (choices.length > limit) return { choices };
    }
  }
  return { choices };
}

function listPlaylists(): Listed {
  const playlists = game.playlists.contents as PlaylistLike[];
  const choices = playlists.map(p => ({
    id: p.id,
    uuid: p.uuid,
    name: p.name,
    detail: detail(p.playing === true && 'playing'),
  }));
  return { choices: choices.sort(byGroupThenName) };
}

function listNotes({ parent }: ListRequest): Listed {
  const scene = sceneFor(parent);
  if (!scene) return { choices: [], note: 'No current scene' };
  const notes = scene.notes.contents as NoteLike[];
  const choices = notes.map(n => ({
    id: n.id,
    uuid: n.uuid,
    name: text(n.text) || text(n.entry?.name) || 'Map note',
    detail: detail(text(n.entry?.name) && `journal ${text(n.entry?.name)}`),
  }));
  return { choices, note: `Map notes on "${scene.name}"` };
}

/**
 * MeasuredTemplate documents on v13; on v14 (MeasuredTemplate removed 14.352,
 * #13089) templates are Regions (`data-access/scene-fx.ts`,
 * `systems/regions.ts`) — list only the ones this tool created
 * (`isToolTemplateRegion`), never a hand-made GM region. The same gate as
 * scene-fx: 14.368 still has an (empty) `scene.templates`, so its presence is
 * no signal (found live in M3).
 */
function listTemplates({ parent }: ListRequest): Listed {
  const scene = sceneFor(parent);
  if (!scene) return { choices: [], note: 'No current scene' };
  if (supportsMeasuredTemplates() && scene.templates) {
    const templates = scene.templates.contents as TemplateLike[];
    const choices = templates.map(t => ({
      id: t.id,
      uuid: t.uuid,
      name: `${t.t ?? 'template'} ${t.distance ?? ''}`.trim(),
    }));
    return { choices, note: `Templates on "${scene.name}"` };
  }
  const regions = (scene.regions?.contents ?? []) as RegionLike[];
  const choices = regions.filter(isToolTemplateRegion).map(r => {
    const flag = toolTemplateFlag(r);
    return {
      id: r.id,
      uuid: r.uuid,
      name: `${flag?.shape ?? 'template'} ${flag?.distance ?? ''}`.trim(),
    };
  });
  return { choices, note: `Template Regions on "${scene.name}"` };
}

function listConditions(): Listed {
  const choices = statusEffectList().map(e => ({ id: e.id, name: localize(e.name) || e.id }));
  return { choices: choices.sort(byGroupThenName) };
}

/** Modules; with filter.includeSystem also the game system (tools that accept its id). */
function listModules({ filter }: ListRequest): Listed {
  const modules = Array.from(game.modules.values()).map(m => ({
    id: m.id,
    name: m.title,
    detail: detail(m.active ? 'active' : 'inactive', m.version),
    group: 'Modules',
  }));
  const choices: RefChoice[] = modules.sort(byGroupThenName);
  if (filter.includeSystem) {
    choices.unshift({
      id: game.system.id,
      name: game.system.title,
      detail: game.system.version,
      group: 'System',
    });
  }
  return { choices };
}

function dnd5eConfig(): NonNullable<Dnd5eConfig['DND5E']> | undefined {
  return (CONFIG as Dnd5eConfig).DND5E;
}

function listSkills(): Listed {
  const skills = dnd5eConfig()?.skills;
  if (!skills) return { choices: [], note: 'Skills come from the dnd5e system' };
  const choices = Object.entries(skills).map(([key, s]) => ({
    id: key,
    name: localize(s.label) || key,
    detail: s.ability,
  }));
  return { choices: choices.sort(byGroupThenName) };
}

function listAbilities(): Listed {
  const abilities = dnd5eConfig()?.abilities;
  if (!abilities) return { choices: [], note: 'Abilities come from the dnd5e system' };
  const choices = Object.entries(abilities).map(([key, a]) => ({
    id: key,
    name: localize(a.label) || key,
    detail: localize(a.abbreviation) || key,
  }));
  return { choices };
}

/** Any world document by name: journals, pages, scenes, actors, items. */
function searchDocuments({ filter, query, limit }: ListRequest): Listed {
  if (query.length < 2) return { choices: [], note: 'Type at least 2 letters to search' };
  const wanted = (name: string): boolean => !filter.documentName || filter.documentName === name;
  const matches = (name: string): boolean => name.toLowerCase().includes(query);
  const choices: RefChoice[] = [];
  const add = (c: RefChoice): boolean => choices.push(c) > limit;
  const groups: Array<[string, FoundryCollection<{ id: string; uuid: string; name: string }>]> = [
    ['JournalEntry', game.journal],
    ['Scene', game.scenes],
    ['Actor', game.actors],
    ['Item', game.items],
  ];
  for (const [documentName, collection] of groups) {
    if (!wanted(documentName)) continue;
    for (const doc of collection.contents) {
      if (
        matches(doc.name) &&
        add({ id: doc.id, uuid: doc.uuid, name: doc.name, group: documentName })
      ) {
        return { choices };
      }
    }
  }
  if (wanted('JournalEntryPage')) {
    for (const journal of game.journal.contents) {
      for (const page of journal.pages.contents) {
        if (
          matches(page.name) &&
          add({
            id: page.id,
            uuid: page.uuid,
            name: page.name,
            detail: journal.name,
            group: 'JournalEntryPage',
          })
        ) {
          return { choices };
        }
      }
    }
  }
  return { choices };
}

const LISTERS: Record<string, (request: ListRequest) => Listed | Promise<Listed>> = {
  actor: listActors,
  token: listTokens,
  scene: listScenes,
  journal: listJournals,
  'journal-page': listJournalPages,
  item: listItems,
  'actor-item': listActorItems,
  combatant: listCombatants,
  user: listUsers,
  folder: listFolders,
  'compendium-pack': listPacks,
  'compendium-entry': listPackEntries,
  playlist: listPlaylists,
  note: listNotes,
  template: listTemplates,
  condition: listConditions,
  module: listModules,
  skill: listSkills,
  ability: listAbilities,
  document: searchDocuments,
};

/** Kinds this module lists (the rest are listed by the backend). */
export const MODULE_REF_KINDS: readonly string[] = Object.keys(LISTERS);

/**
 * The candidates for one picker. `query` narrows by name, detail or group;
 * `limit` caps the rows (`truncated` says more exist).
 */
export async function listRefChoices(data: unknown): Promise<RefChoicesResult> {
  const request = (data ?? {}) as Record<string, unknown>;
  const kind = text(request.kind);
  const lister = LISTERS[kind];
  if (!lister) throw new Error(`Unknown kind "${kind}"`);
  const rawLimit = Number(request.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_REF_LIMIT)
    : DEFAULT_REF_LIMIT;
  const query = text(request.query).toLowerCase();
  const listed = await lister({
    filter: readFilter(request.filter),
    parent: text(request.parent),
    query,
    limit,
  });
  const matched = query
    ? listed.choices.filter(c =>
        `${c.name} ${c.detail ?? ''} ${c.group ?? ''}`.toLowerCase().includes(query)
      )
    : listed.choices;
  return {
    kind,
    choices: matched.slice(0, limit),
    truncated: matched.length > limit,
    ...(listed.note ? { note: listed.note } : {}),
  };
}
