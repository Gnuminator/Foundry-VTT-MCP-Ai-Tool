/**
 * The GM action `inspectBuild`: what a hero's build left on the actor that the other inspect
 * actions do not show, so two heroes of the same class can be compared. Self-contained like every
 * GM action (Playwright serializes it into the Foundry page).
 *
 * Item ids differ between two actors, so everything is named by what it is: an item's origin is
 * "the advancement <title> of <item type>:<item name>", never a document id.
 *
 * @param {{actorId: string}} args
 * @returns {{
 *   name: string, level: number,
 *   items: Array<{type: string, name: string, identifier: string, sourceUuid: string,
 *     origin: {item: string, advancement: string, title: string} | null, root: string | null,
 *     prepared: string | null, quantity: number | null, level: number | null}>,
 *   advancements: Array<{item: string, id: string, type: string, title: string, level: number | null,
 *     value: Record<string, unknown>}>,
 *   skills: Record<string, number>, saves: Record<string, boolean>,
 *   proficiencies: {languages: string[], weapons: string[], armor: string[], tools: string[],
 *     damageResistances: string[], damageImmunities: string[], conditionImmunities: string[]},
 *   senses: Record<string, number>, movement: Record<string, number>, size: string,
 *   hp: {max: number, bonuses: unknown}, ac: {value: number | null, calc: string}
 * }}
 */
export async function inspectBuild(args) {
  const actor = game.actors.get(args.actorId);
  if (!actor) throw new Error(`inspectBuild: no actor ${args.actorId}`);
  const label = item => `${item.type}:${item.name}`;
  const sorted = list => [...list].map(String).sort((a, b) => a.localeCompare(b, 'en'));
  const setOf = value => sorted(value instanceof Set ? [...value] : Array.from(value ?? []));

  // advancementOrigin is "<item id>.<advancement id>" on the actor: say which item and which step.
  const items = actor.items.map(item => {
    const origin = item.flags?.dnd5e?.advancementOrigin ?? null;
    const root = item.flags?.dnd5e?.advancementRoot ?? null;
    let from = null;
    if (typeof origin === 'string' && origin.includes('.')) {
      const [itemId, advancementId] = origin.split('.');
      const source = actor.items.get(itemId);
      from = {
        item: source ? label(source) : `(missing item ${itemId})`,
        advancement: advancementId,
        title: source?.advancement?.byId?.[advancementId]?.title ?? '',
      };
    }
    const rootItem = typeof root === 'string' ? actor.items.get(root.split('.')[0]) : null;
    return {
      type: item.type,
      name: item.name,
      identifier: item.system?.identifier ?? '',
      sourceUuid: item._stats?.compendiumSource ?? item.flags?.dnd5e?.sourceId ?? '',
      origin: from,
      root: root ? (rootItem ? label(rootItem) : String(root)) : null,
      prepared:
        item.type === 'spell'
          ? `${item.system.method ?? ''}:${item.system.prepared ?? ''}`.replace(/^:$/, '')
          : null,
      quantity: typeof item.system?.quantity === 'number' ? item.system.quantity : null,
      level: item.type === 'spell' ? Number(item.system.level ?? 0) : null,
    };
  });

  // What each advancement of the build's own items holds, with item ids replaced by names.
  const nameOfId = id => {
    const found = actor.items.get(id);
    return found ? label(found) : String(id);
  };
  const advancements = [];
  for (const item of actor.items) {
    if (!['class', 'subclass', 'race', 'background'].includes(item.type)) continue;
    for (const adv of Object.values(item.advancement?.byId ?? {})) {
      const raw = adv.value ?? {};
      const value = {};
      for (const [key, v] of Object.entries(raw)) {
        if (v instanceof Set) value[key] = sorted([...v]);
        else if (key === 'added' && v && typeof v === 'object') {
          // ItemGrant: {itemId: uuid}. ItemChoice: {level: {itemId: uuid}}. Keep the uuids (the same
          // on both actors), sorted, by level where there is one.
          const flat = Object.values(v).every(x => typeof x === 'string');
          value[key] = flat
            ? sorted(Object.values(v))
            : Object.fromEntries(
                Object.entries(v).map(([lvl, map]) => [lvl, sorted(Object.values(map ?? {}))])
              );
        } else if (key === 'replaced' && v && typeof v === 'object') {
          value[key] = Object.fromEntries(
            Object.entries(v).map(([lvl, r]) => [
              lvl,
              {
                level: r?.level,
                original: nameOfId(r?.original),
                replacement: nameOfId(r?.replacement),
              },
            ])
          );
        } else if (key === 'document') {
          value[key] = v?.name ?? null; // a subclass's own item: by name
        } else if (key === 'feat' && v && typeof v === 'object') {
          value[key] = sorted(Object.values(v));
        } else if (v && typeof v === 'object') value[key] = JSON.parse(JSON.stringify(v));
        else value[key] = v;
      }
      advancements.push({
        item: label(item),
        id: adv.id,
        type: adv.constructor?.typeName ?? adv.type,
        title: adv.title ?? '',
        level: Number.isFinite(adv.level) ? adv.level : (adv.levels?.[0] ?? null),
        value,
      });
    }
  }

  const skills = {};
  for (const [id, s] of Object.entries(actor.system.skills ?? {}))
    skills[id] = Number(s.value ?? 0);
  const saves = {};
  for (const [id, a] of Object.entries(actor.system.abilities ?? {})) saves[id] = !!a.proficient;
  const toolIds = Object.entries(actor.system.tools ?? {})
    .filter(([, t]) => Number(t.value ?? 0) > 0)
    .map(([id]) => id);
  const traits = actor.system.traits ?? {};
  const movement = {};
  for (const [k, v] of Object.entries(actor.system.attributes.movement ?? {})) {
    if (typeof v === 'number' && v > 0) movement[k] = v;
  }
  const senses = {};
  for (const [k, v] of Object.entries(actor.system.attributes.senses?.ranges ?? {})) {
    if (typeof v === 'number' && v > 0) senses[k] = v;
  }
  const ac = actor.system.attributes.ac ?? {};
  const hp = actor.system.attributes.hp ?? {};
  return {
    name: actor.name,
    level: actor.system.details.level,
    items,
    advancements,
    skills,
    saves,
    proficiencies: {
      languages: setOf(traits.languages?.value),
      weapons: setOf(traits.weaponProf?.value),
      armor: setOf(traits.armorProf?.value),
      tools: sorted(toolIds),
      damageResistances: setOf(traits.dr?.value),
      damageImmunities: setOf(traits.di?.value),
      conditionImmunities: setOf(traits.ci?.value),
    },
    senses,
    movement,
    size: String(traits.size ?? ''),
    hp: { max: hp.max ?? 0, bonuses: JSON.parse(JSON.stringify(hp.bonuses ?? {})) },
    ac: { value: ac.value ?? null, calc: String(ac.calc ?? '') },
  };
}
