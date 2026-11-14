/**
 * Player-character creation plans (Backlog pc-creation-tool): the module's read-only
 * `planPcCreation` query turns one request (name, owner, compendium item uuids) into a single
 * guarded `create` op for a character-type Actor with its items inlined. Nothing is written here;
 * the backend stores the op as a plan, `apply-planned-change` runs it and `undo-change` deletes
 * the actor again.
 *
 * Items are copied with dnd5e's own `Item5e.createWithContents`, so a container brings its
 * contents and each content item's `system.container` points at the container's new id. One op
 * (items inside the actor's data) rather than one create per item, because an embedded create
 * needs the actor to exist when the plan is made. Advancement does not run (a class item is
 * copied as it is); the plan says so in its warnings.
 *
 * The wire contract is `shared/src/pc-creation.ts`; only its types are imported (the browser
 * cannot resolve `@gnuminator/shared` at runtime). The names are mirrored here and pinned by
 * `pc-creation.test.ts`.
 */
import type { GuardedOp, PcCreationPlan, PcCreationRequest } from '@gnuminator/shared';

/** Query name (mirror of the shared `PC_CREATION_QUERY`). */
export const PC_CREATION_QUERY = 'planPcCreation';

/** Feature id (mirror of the shared `PC_CREATION_FEATURE_ID`). */
export const PC_CREATION_FEATURE_ID = 'pc-creation';

const MAX_ITEMS = 200;
const OWNER_LEVEL = 3;
/** Item types whose advancement would normally grant features and hit points. */
const ADVANCEMENT_TYPES = ['class', 'subclass', 'race', 'background'];

type Rec = Record<string, unknown>;

interface UserLike {
  id: string;
  name?: string;
  isGM?: boolean;
}

interface Globals {
  foundry?: { utils?: { randomID?: (length: number) => string } };
  fromUuid?: (uuid: string) => Promise<Rec | null>;
  CONFIG?: {
    Item?: {
      documentClass?: {
        createWithContents?: (items: unknown[], options: Rec) => Promise<Rec[] | undefined>;
      };
    };
  };
  game: {
    user?: { isGM?: boolean };
    users?: { contents?: UserLike[] };
    actors?: { contents?: Array<{ name?: string; type?: string }> };
    items?: { fromCompendium?: (item: unknown, options: Rec) => Rec };
  };
}

const globals = (): Globals => globalThis as unknown as Globals;

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === 'object' ? (value as Rec) : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function newId(): string {
  const randomID = globals().foundry?.utils?.randomID;
  if (typeof randomID === 'function') return randomID(16);
  // Foundry always has randomID; this fallback is for the test harness and uses the platform CSPRNG.
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

/** The owning player by user id or name (never a GM). */
function resolveOwner(ref: string): UserLike {
  const users = globals().game.users?.contents ?? [];
  const wanted = ref.toLowerCase();
  const byId = users.find(u => u.id === ref);
  const named = users.filter(u => String(u.name ?? '').toLowerCase() === wanted);
  if (!byId && named.length > 1) {
    throw new Error(`${named.length} users are named "${ref}": give the user id instead`);
  }
  const user = byId ?? named[0];
  if (!user) throw new Error(`No Foundry user "${ref}"`);
  if (user.isGM) throw new Error(`"${user.name}" is a GM: a GM owns every actor already`);
  return user;
}

/**
 * dnd5e links a character sheet to its species, background and first class in `_onCreate` of the
 * embedded item, which does not run for items inlined in an Actor create. Without these the sheet
 * shows no species or background, no original class and no spellcasting ability. The links point
 * at the new item ids (the actor is created with `keepId`, so they hold).
 */
function sheetLinks(itemData: Rec[]): Rec | null {
  // Only top-level items count: a class that sits inside a container is cargo, not the character's class.
  const first = (type: string): Rec | undefined =>
    itemData.find(i => i.type === type && !rec(i.system)?.container);
  const race = first('race');
  const background = first('background');
  const cls = first('class');
  const details: Rec = {};
  if (race) details.race = text(race._id);
  if (background) details.background = text(background._id);
  if (cls) details.originalClass = text(cls._id);
  const ability = text(rec(rec(cls?.system)?.spellcasting)?.ability);
  const system: Rec = {};
  if (Object.keys(details).length > 0) system.details = details;
  if (ability) system.attributes = { spellcasting: ability };
  return Object.keys(system).length > 0 ? system : null;
}

export async function planPcCreation(data: unknown): Promise<PcCreationPlan> {
  const g = globals();
  if (g.game.user?.isGM !== true) throw new Error('Only a GM can plan a character');
  const request = data as PcCreationRequest | null | undefined;
  const name = typeof request?.name === 'string' ? request.name.trim() : '';
  if (!name) throw new Error('A character needs a name');
  const wanted = Array.isArray(request?.items) ? request.items : [];
  if (wanted.length > MAX_ITEMS) throw new Error(`At most ${MAX_ITEMS} items per character`);

  const owner = request?.owner ? resolveOwner(request.owner) : null;
  const warnings: string[] = [];
  if ((g.game.actors?.contents ?? []).some(a => a.name === name && a.type === 'character')) {
    warnings.push(`A character named "${name}" already exists; this makes a second one`);
  }

  const sources: unknown[] = [];
  const overrides = new Map<
    unknown,
    {
      equipped?: boolean | undefined;
      prepared?: boolean | undefined;
      quantity?: number | undefined;
    }
  >();
  for (const entry of wanted) {
    const uuid = typeof entry?.uuid === 'string' ? entry.uuid : '';
    const doc = uuid && g.fromUuid ? await g.fromUuid(uuid) : null;
    if (doc?.documentName !== 'Item') {
      throw new Error(`Not an item: ${uuid || '(no uuid)'} (use Compendium.<pack>.Item.<id>)`);
    }
    sources.push(doc);
    overrides.set(doc, {
      equipped: entry.equipped,
      prepared: entry.prepared,
      quantity: entry.quantity,
    });
  }

  const createWithContents = g.CONFIG?.Item?.documentClass?.createWithContents;
  const fromCompendium = g.game.items?.fromCompendium;
  if (sources.length > 0 && (typeof createWithContents !== 'function' || !fromCompendium)) {
    throw new Error('dnd5e container support is missing: cannot copy items');
  }
  const itemData: Rec[] =
    sources.length === 0
      ? []
      : ((await createWithContents!.call(g.CONFIG!.Item!.documentClass, sources, {
          keepId: false,
          transformAll: (item: unknown, options: { depth?: number }): Rec => {
            const copy = fromCompendium!.call(g.game.items, item, {
              clearSort: false,
              keepId: true,
              clearOwnership: false,
            });
            const wish = options.depth === 0 ? overrides.get(item) : undefined;
            const system = (copy.system ??= {}) as Rec;
            const label = text(copy.name);
            if (wish?.equipped !== undefined) {
              if ('equipped' in system) system.equipped = wish.equipped;
              else warnings.push(`"${label}" cannot be equipped`);
            }
            if (wish?.prepared !== undefined) {
              if (copy.type === 'spell') system.prepared = wish.prepared ? 1 : 0;
              else warnings.push(`"${label}" is not a spell, so it cannot be prepared`);
            }
            if (wish?.quantity !== undefined) {
              if ('quantity' in system) system.quantity = wish.quantity;
              else warnings.push(`"${label}" has no stack size`);
            }
            return copy;
          },
        })) ?? []);
  if (itemData.length > MAX_ITEMS) {
    throw new Error(
      `The items and container contents come to ${itemData.length}; at most ${MAX_ITEMS}`
    );
  }

  const byId = new Map(itemData.map(i => [String(i._id), i]));
  const items: PcCreationPlan['items'] = itemData.map(i => {
    const system = rec(i.system) ?? {};
    const inside = typeof system.container === 'string' ? byId.get(system.container) : undefined;
    return {
      name: text(i.name),
      type: text(i.type),
      ...(typeof system.equipped === 'boolean' && system.equipped ? { equipped: true } : {}),
      ...(i.type === 'spell' && Number(system.prepared) >= 1 ? { prepared: true } : {}),
      ...(inside ? { inside: text(inside.name) } : {}),
    };
  });
  const advancing = items.filter(i => ADVANCEMENT_TYPES.includes(i.type)).map(i => i.name);
  if (advancing.length > 0) {
    warnings.push(
      `${advancing.join(', ')}: copied as items only; advancement does not run, so add the granted features and set hit points by hand`
    );
  }

  const actorData: Rec = {
    _id: newId(),
    name,
    type: 'character',
    ownership: { default: 0, ...(owner ? { [owner.id]: OWNER_LEVEL } : {}) },
    items: itemData,
  };
  const links = sheetLinks(itemData);
  if (links) actorData.system = links;
  const ops: GuardedOp[] = [
    { kind: 'create', documentName: 'Actor', data: actorData, keepId: true },
  ];
  const ownerText = owner ? `, owned by ${owner.name}` : '';
  return {
    summary: `Create the character "${name}"${ownerText} with ${items.length} item${items.length === 1 ? '' : 's'}`,
    ops,
    actor: { name, owner: owner ? String(owner.name ?? owner.id) : null },
    items,
    warnings,
  };
}
