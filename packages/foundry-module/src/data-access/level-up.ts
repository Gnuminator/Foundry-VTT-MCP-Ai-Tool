import { ERROR_MESSAGES } from '../constants.js';
import { num, rec, type Rec } from '../character-sheet-fields.js';
import * as shared from './shared.js';

/**
 * The slice of a dnd5e 6 `Advancement` this reader touches. Read-only; the class item's
 * `advancement.byLevel` is the same list the level-up flow walks.
 */
interface AdvancementLike {
  id: string;
  type: string;
  name?: string;
  title?: string;
  hint?: string;
  identifier?: string;
  hitDie?: string;
  average?: number;
  appliesToClass?: boolean;
  configuration?: Rec;
  configuredForLevel?: (level: number) => boolean;
  valueForLevel?: (level: number) => unknown;
}

interface ClassItemLike {
  id: string;
  name: string;
  type: string;
  system?: Rec;
  advancement?: { byLevel?: Record<string, AdvancementLike[]> };
}

interface GrantEntry {
  advancementId: string;
  type: string;
  name: string;
  /** True when the player has to decide something at this level. */
  choice: boolean;
  detail: Record<string, unknown>;
}

interface OpenChoice {
  kind: 'hit-points' | 'asi-or-feat' | 'subclass' | 'item-choice' | 'trait' | 'spells';
  advancementId: string;
  name: string;
  detail: Record<string, unknown>;
}

interface UnfinishedEntry {
  level: number;
  advancementId: string;
  type: string;
  name: string;
}

interface ClassLevelUp {
  className: string;
  identifier: string | null;
  classLevel: number;
  nextLevel: number | null;
  hitDie: string | null;
  subclass: { name: string } | null;
  spellcasting: { progression: string | null; ability: string | null } | null;
  nextLevelGrants: GrantEntry[];
  openChoices: OpenChoice[];
  unfinishedAdvancement: UnfinishedEntry[];
}

interface LevelUpResult {
  success: true;
  actorId: string;
  actorName: string;
  characterLevel: number;
  classes: ClassLevelUp[];
  notes: string[];
}

const MAX_LEVEL = 20;

function advName(a: AdvancementLike): string {
  return a.name || a.title || a.type;
}

function uuidName(uuid: unknown): string | null {
  if (typeof uuid !== 'string' || !uuid || typeof fromUuidSync !== 'function') return null;
  try {
    return (fromUuidSync(uuid) as { name?: string } | null)?.name ?? null;
  } catch {
    return null;
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function levelAdvancements(item: ClassItemLike, level: number): AdvancementLike[] {
  const list = item.advancement?.byLevel?.[level] ?? [];
  return list.filter(a => a.appliesToClass !== false);
}

function displayOf(value: unknown): unknown {
  if (value && typeof value === 'object' && 'display' in value) {
    return value.display;
  }
  return value ?? null;
}

/**
 * Read-only level-up advice (D&D helper step 4). Describes what the next level of a class
 * grants and which advancement choices stay open, from the class item's own advancement data
 * (dnd5e 6 `Item#advancement`), and lists advancement the character never finished. Never
 * writes: the player completes the level-up in Foundry's advancement dialog.
 */
export class LevelUpDataAccess {
  async getLevelUpOptions(data: {
    identifier: string;
    className?: string;
  }): Promise<LevelUpResult> {
    shared.validateFoundryState();

    const actor = shared.findActorByIdentifier(data.identifier);
    if (!actor) {
      throw new Error(`${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: ${data.identifier}`);
    }

    const items = Array.from((actor.items as unknown as Iterable<ClassItemLike>) ?? []);
    let classItems = items.filter(i => i.type === 'class');
    const wanted = data.className?.trim().toLowerCase();
    if (wanted) {
      classItems = classItems.filter(
        c =>
          c.name.toLowerCase() === wanted ||
          (typeof c.system?.identifier === 'string' && c.system.identifier.toLowerCase() === wanted)
      );
      if (!classItems.length) {
        const have = items.filter(i => i.type === 'class').map(i => i.name);
        throw new Error(
          `${actor.name} has no class "${data.className}". Classes on the sheet: ${have.join(', ') || 'none'}.`
        );
      }
    }

    const notes: string[] = [];
    if (!classItems.length) {
      notes.push(
        'This actor has no class item, so there is no advancement to read (an NPC or an unfinished character).'
      );
    }

    return {
      success: true,
      actorId: actor.id,
      actorName: actor.name,
      characterLevel: num(rec(rec(actor.system).details).level),
      classes: classItems.map(c => this.describeClass(c, items)),
      notes: [
        ...notes,
        'Advice only: nothing was changed. Spell slots follow the class table and are not listed; open the level-up dialog in Foundry to apply the choices.',
      ],
    };
  }

  private describeClass(item: ClassItemLike, items: ClassItemLike[]): ClassLevelUp {
    const sys = item.system ?? {};
    const classLevel = num(sys.levels);
    const identifier = typeof sys.identifier === 'string' ? sys.identifier : null;
    const nextLevel = classLevel >= MAX_LEVEL ? null : classLevel + 1;

    const subclassItem = items.find(
      i => i.type === 'subclass' && identifier && i.system?.classIdentifier === identifier
    );

    const grants: GrantEntry[] = [];
    const open: OpenChoice[] = [];
    if (nextLevel !== null) {
      const scaleBefore = (a: AdvancementLike): unknown =>
        displayOf(safe(() => a.valueForLevel?.(classLevel), null));
      for (const adv of levelAdvancements(item, nextLevel)) {
        const entry = this.describeAdvancement(adv, nextLevel, subclassItem, scaleBefore);
        if (!entry) continue;
        grants.push(entry.grant);
        if (entry.open) open.push(entry.open);
      }
    }

    const unfinished: UnfinishedEntry[] = [];
    for (let level = 1; level <= classLevel; level++) {
      for (const adv of levelAdvancements(item, level)) {
        const done = safe(() => adv.configuredForLevel?.(level) ?? true, true);
        if (!done) {
          unfinished.push({ level, advancementId: adv.id, type: adv.type, name: advName(adv) });
        }
      }
    }

    const sc = sys.spellcasting as { progression?: string; ability?: string } | undefined;
    const spellcasting =
      sc?.progression && sc.progression !== 'none'
        ? { progression: sc.progression, ability: sc.ability || null }
        : null;

    return {
      className: item.name,
      identifier,
      classLevel,
      nextLevel,
      hitDie:
        typeof rec(sys.hd).denomination === 'string' ? (rec(sys.hd).denomination as string) : null,
      subclass: subclassItem ? { name: subclassItem.name } : null,
      spellcasting,
      nextLevelGrants: grants,
      openChoices: open,
      unfinishedAdvancement: unfinished,
    };
  }

  private describeAdvancement(
    adv: AdvancementLike,
    level: number,
    subclassItem: ClassItemLike | undefined,
    scaleBefore: (a: AdvancementLike) => unknown
  ): { grant: GrantEntry; open?: OpenChoice | undefined } | null {
    const cfg = adv.configuration ?? {};
    const base = { advancementId: adv.id, type: adv.type, name: advName(adv) };

    switch (adv.type) {
      case 'HitPoints': {
        const detail = {
          hitDie: adv.hitDie ?? null,
          average: adv.average ?? null,
          firstLevel: level === 1,
        };
        return {
          grant: { ...base, choice: level !== 1, detail },
          open: level === 1 ? undefined : { kind: 'hit-points', ...base, detail },
        };
      }
      case 'AbilityScoreImprovement': {
        const detail = {
          points: cfg.points ?? 2,
          cap: cfg.cap ?? 2,
          fixed: cfg.fixed ?? {},
          locked: Array.from((cfg.locked as Iterable<string>) ?? []),
          optionsHint: 'Ability score increase, or a feat if the table allows feats.',
        };
        return {
          grant: { ...base, choice: true, detail },
          open: { kind: 'asi-or-feat', ...base, detail },
        };
      }
      case 'Subclass': {
        const detail = { currentSubclass: subclassItem?.name ?? null };
        const needed = !subclassItem;
        return {
          grant: { ...base, choice: needed, detail },
          open: needed ? { kind: 'subclass', ...base, detail } : undefined,
        };
      }
      case 'ItemGrant': {
        const items = ((cfg.items as Array<{ uuid?: string; optional?: boolean }>) ?? []).map(
          i => ({
            name: uuidName(i.uuid) ?? i.uuid ?? 'unknown',
            optional: !!(i.optional || cfg.optional),
          })
        );
        const spellGrant = !!cfg.spell;
        return { grant: { ...base, choice: false, detail: { items, spellGrant } } };
      }
      case 'ItemChoice': {
        const choice = (cfg.choices as Record<string, { count?: number; replacement?: boolean }>)?.[
          level
        ];
        const count = choice?.count ?? 0;
        if (!count && !choice?.replacement) return null;
        const restriction = (cfg.restriction as Record<string, unknown>) ?? {};
        const isSpell = cfg.type === 'spell' || !!cfg.spell;
        const detail = {
          count,
          replacement: !!choice?.replacement,
          itemType: cfg.type ?? null,
          restriction: {
            level: restriction.level || null,
            list: Array.from((restriction.list as Iterable<string>) ?? []),
            school: Array.from((restriction.school as Iterable<string>) ?? []),
            subtype: restriction.subtype || null,
          },
          pool: ((cfg.pool as Array<{ uuid?: string }>) ?? []).map(
            p => uuidName(p.uuid) ?? p.uuid ?? 'unknown'
          ),
        };
        // A level with only a replacement (count 0) lets the player swap an earlier pick;
        // it is a grant to mention, not a choice they owe.
        if (!count) return { grant: { ...base, choice: false, detail } };
        return {
          grant: { ...base, choice: true, detail },
          open: { kind: isSpell ? 'spells' : 'item-choice', ...base, detail },
        };
      }
      case 'Trait': {
        const choices = (cfg.choices as Array<{ count?: number; pool?: Iterable<string> }>) ?? [];
        const detail = {
          grants: Array.from((cfg.grants as Iterable<string>) ?? []),
          choices: choices.map(c => ({ count: c.count ?? 1, pool: Array.from(c.pool ?? []) })),
        };
        return {
          grant: { ...base, choice: choices.length > 0, detail },
          open: choices.length ? { kind: 'trait', ...base, detail } : undefined,
        };
      }
      case 'ScaleValue': {
        const to = displayOf(safe(() => adv.valueForLevel?.(level), null));
        const from = scaleBefore(adv);
        if (to === from) return null;
        const isSpellCount = /cantrip|spell/i.test(adv.identifier ?? '');
        return {
          grant: {
            ...base,
            choice: false,
            detail: { identifier: adv.identifier ?? null, from, to, spellCount: isSpellCount },
          },
        };
      }
      default:
        return { grant: { ...base, choice: false, detail: { hint: adv.hint ?? null } } };
    }
  }
}
