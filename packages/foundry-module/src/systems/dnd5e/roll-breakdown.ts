/**
 * Full breakdown of a dnd5e roll (O3 item 6): what was rolled, each part's
 * source (dice with results, then each bonus/penalty), the kept natural d20
 * and a human-readable summary line, e.g.
 * "Wolf, Bite attack: 1d20 (16) +2 DEX +2 proficiency = 20 vs AC 10: hit".
 *
 * Built from the evaluated roll's own terms (order preserved) plus label
 * inference against the acting actor's current ability modifier,
 * proficiency bonus and (for weapon attacks) the item's magical bonus —
 * verified against the real dnd5e 6.0.5 source on disk
 * (`Activity#getAttackData`: `actor.system.abilities.<key>.mod`,
 * `actor.system.attributes.prof`, `item.system.magicalBonus` gated by
 * `item.system.magicAvailable`; `ChatMessage5e#shouldDisplayChallenge` /
 * the `dnd5e.challengeVisibility` world setting, values `all`/`player`/
 * `none`). A number this cannot confidently attribute to one of those is
 * labelled `modifier` rather than guessed. Never throws: any failure falls
 * back to a minimal breakdown built from the roll's own total.
 */
import { dnd5eMessageItemRef, dnd5eRollSubject } from './chat-roll-kind.js';

const ABILITY_LABELS: Record<string, string> = {
  str: 'STR',
  dex: 'DEX',
  con: 'CON',
  int: 'INT',
  wis: 'WIS',
  cha: 'CHA',
};

/** Full ability names, for the roll title ("Wisdom save"); part labels use the short code ("WIS"). */
const ABILITY_FULL_NAMES: Record<string, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function shape<T>(v: unknown): T | null {
  return v !== null && typeof v === 'object' ? (v as T) : null;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? (v as unknown[]) : [];
}

/** One term of a roll: dice (with what they rolled) or a signed flat number. Mirrors shared `PlayRollPart`. */
export type RollBreakdownPart =
  | {
      kind: 'dice';
      formula: string;
      results: number[];
      dropped?: number[];
      label?: string;
      sign?: 1 | -1;
    }
  | { kind: 'number'; value: number; label: string };

export interface RollBreakdown {
  /** What was rolled, e.g. `Bite attack`, `Constitution save`, `Perception check`. */
  label: string;
  /** The roll term by term, in order. */
  parts: RollBreakdownPart[];
  /** The kept natural d20 result, for d20 rolls. */
  natural?: number;
  actorName: string;
  total: number;
  /** Target AC (attacks) or DC (saves/checks), when the roll carries one. */
  dc?: number;
  outcome?: 'success' | 'failure';
  /** Full summary line, including the target number and outcome when there is one (GM-only info). */
  text: string;
  /** `text` with the target number and outcome omitted unless dnd5e's `challengeVisibility` world setting is `all`. */
  textPlayerSafe: string;
  /** `text` without its leading "actor, label: " (joins several rolls of one message). */
  detail: string;
  /** `textPlayerSafe` without its leading "actor, label: ". */
  detailPlayerSafe: string;
}

/** Every roll of one chat message, summed up as one feed line. */
export interface MessageRollBreakdown {
  rolls: RollBreakdown[];
  /** Sum of the rolls' totals. */
  total: number;
  text: string;
  textPlayerSafe: string;
}

interface SpeakerLike {
  scene?: unknown;
  token?: unknown;
  actor?: unknown;
  alias?: unknown;
}

interface ActorLike {
  name?: unknown;
  type?: unknown;
  system?: unknown;
}

interface ItemLike {
  name?: unknown;
  system?: unknown;
}

/** The actor behind a message's speaker, and its display name (prefers the speaker's own alias, which dnd5e sets to the actor's name). */
function resolveActor(message: ChatMessage): { name: string; actor: ActorLike | null } {
  const speaker = shape<SpeakerLike>((message as unknown as { speaker?: unknown }).speaker);
  const alias = str(speaker?.alias);
  let actor: ActorLike | null = null;
  try {
    const sceneId = str(speaker?.scene);
    const tokenId = str(speaker?.token);
    if (sceneId && tokenId) {
      const scene = game.scenes.get(sceneId);
      const token = scene
        ? (scene.tokens.get(tokenId) as { actor?: unknown } | undefined)
        : undefined;
      actor = shape<ActorLike>(token?.actor);
    }
    if (!actor) {
      const actorId = str(speaker?.actor);
      if (actorId) actor = shape<ActorLike>(game.actors.get(actorId));
    }
  } catch {
    // best-effort; fall back to the alias/name below
  }
  const name = alias ?? str(actor?.name) ?? 'Unknown';
  return { name, actor };
}

/**
 * The live item document a roll/usage message names, resolved synchronously
 * from the acting actor's own items (matched by uuid) — the message itself
 * only carries a name/type/uuid descriptor (`dnd5eMessageItemRef`), not the
 * full system data a magic-bonus label needs.
 */
function itemFromActor(actor: ActorLike | null, itemUuid: string | undefined): ItemLike | null {
  if (!actor || !itemUuid) return null;
  try {
    const items = (actor as unknown as { items?: unknown }).items;
    const rec = asRecord(items);
    const list: unknown[] = Array.isArray(items)
      ? items
      : Array.isArray(rec?.contents)
        ? (rec?.contents as unknown[])
        : [];
    for (const raw of list) {
      const candidate = asRecord(raw);
      if (candidate && str(candidate.uuid) === itemUuid) return candidate as ItemLike;
    }
  } catch {
    // ignore; label inference just falls back to "modifier"
  }
  return null;
}

function abilityCodeFrom(message: ChatMessage): string | undefined {
  const system = asRecord((message as unknown as { system?: unknown }).system);
  return str(system?.ability);
}

function rollDcOf(roll: Record<string, unknown> | null): number | undefined {
  return num(asRecord(roll?.options)?.target);
}

function challengeVisibilityAll(): boolean {
  try {
    return game.settings.get('dnd5e', 'challengeVisibility') === 'all';
  } catch {
    return false;
  }
}

/** Label-matching context: the "known quantities" a number part might equal, each usable once. */
interface LabelContext {
  /** The message's own ability (`system.ability`, when it names one), matched first. */
  abilityCode?: string;
  abilityMod?: number;
  abilityUsed: boolean;
  /** Every one of the actor's ability mods, code -> mod, for damage-roll numbers (no `system.ability` there). */
  allAbilities: Record<string, number>;
  usedAbilities: Set<string>;
  proficiency?: number;
  proficiencyUsed: boolean;
  magic?: number;
  magicUsed: boolean;
}

function buildLabelContext(
  actor: ActorLike | null,
  item: ItemLike | null,
  message: ChatMessage,
  rollType: string
): LabelContext {
  const ctx: LabelContext = {
    abilityUsed: false,
    allAbilities: {},
    usedAbilities: new Set(),
    proficiencyUsed: false,
    magicUsed: false,
  };
  // A roll dnd5e did not type (a plain `/r`, an unknown card) gets no guessed sources at all.
  if (rollType === 'other') return ctx;
  try {
    const system = asRecord(actor?.system);
    const abilitiesRec = asRecord(system?.abilities);
    if (abilitiesRec) {
      for (const [code, raw] of Object.entries(abilitiesRec)) {
        const mod = num(asRecord(raw)?.mod);
        if (mod !== undefined) ctx.allAbilities[code] = mod;
      }
    }
    const abilityCode = abilityCodeFrom(message);
    if (abilityCode && ctx.allAbilities[abilityCode] !== undefined) {
      ctx.abilityCode = abilityCode;
      ctx.abilityMod = ctx.allAbilities[abilityCode];
    }
    // 5e never adds proficiency to damage or healing, so a matching number there is something else.
    const prof = num(asRecord(system?.attributes)?.prof);
    if (prof !== undefined && rollType !== 'damage' && rollType !== 'healing') {
      ctx.proficiency = prof;
    }
    const itemSystem = asRecord(item?.system);
    if (itemSystem?.magicAvailable === true) {
      const magic = num(itemSystem.magicalBonus);
      if (magic !== undefined) ctx.magic = magic;
    }
  } catch {
    // leave whatever was resolved; unmatched numbers fall back to "modifier"
  }
  return ctx;
}

/**
 * Attribute a number part's value to an ability mod, proficiency or magic
 * bonus, in that priority order, each usable at most once. When the message
 * itself does not name an ability (damage rolls: `DamageMessageData` has no
 * `ability` field), fall back to the actor's *other* ability mods and use one
 * only when exactly one of them matches the value (an unambiguous match);
 * anything else stays `modifier`.
 */
function labelFor(value: number, ctx: LabelContext): string {
  // A zero (e.g. dnd5e's "+ 0" for a missing proficiency) matches too much to name a source.
  if (value === 0) return 'modifier';
  if (!ctx.abilityUsed && ctx.abilityMod !== undefined && value === ctx.abilityMod) {
    ctx.abilityUsed = true;
    if (ctx.abilityCode) ctx.usedAbilities.add(ctx.abilityCode);
    return abilityShortLabel(ctx.abilityCode);
  }
  if (!ctx.proficiencyUsed && ctx.proficiency !== undefined && value === ctx.proficiency) {
    ctx.proficiencyUsed = true;
    return 'proficiency';
  }
  if (!ctx.magicUsed && ctx.magic !== undefined && value === ctx.magic) {
    ctx.magicUsed = true;
    return 'magic';
  }
  const candidates = Object.entries(ctx.allAbilities).filter(
    ([code, mod]) => mod === value && !ctx.usedAbilities.has(code)
  );
  if (candidates.length === 1) {
    const [code] = candidates[0];
    ctx.usedAbilities.add(code);
    return abilityShortLabel(code);
  }
  return 'modifier';
}

function abilityShortLabel(code: string | undefined): string {
  if (!code) return 'modifier';
  return ABILITY_LABELS[code] ?? code.toUpperCase();
}

/**
 * The roll's terms as ordered parts. A serialized Foundry `RollTerm` carries
 * a dice term as `{faces, number, results[], modifiers[], options}`, an
 * operator as `{operator: '+'|'-'}` and a flat bonus as `{number}`; anything
 * else (a parenthetical or pool sub-roll) falls back to one `modifier` number
 * part from its own `total`.
 */
function buildParts(
  roll: Record<string, unknown> | null,
  ctx: LabelContext
): { parts: RollBreakdownPart[]; natural: number | undefined } {
  const parts: RollBreakdownPart[] = [];
  let natural: number | undefined;
  let sign: 1 | -1 = 1;

  for (const rawTerm of arr(roll?.terms)) {
    const term = asRecord(rawTerm);
    if (!term) continue;

    const operator = str(term.operator);
    if (operator === '-') {
      sign = -1;
      continue;
    }
    if (operator === '+') {
      sign = 1;
      continue;
    }

    const faces = num(term.faces);
    const rawResults = term.results;
    if (faces !== undefined && Array.isArray(rawResults)) {
      const kept: number[] = [];
      const dropped: number[] = [];
      for (const rawResult of rawResults as unknown[]) {
        const result = asRecord(rawResult);
        const value = num(result?.result);
        if (value === undefined) continue;
        if (result?.active === false) dropped.push(value);
        else kept.push(value);
      }
      const count = num(term.number) ?? kept.length + dropped.length;
      const mods = arr(term.modifiers)
        .filter((m): m is string => typeof m === 'string')
        .join('');
      const part: RollBreakdownPart = {
        kind: 'dice',
        formula: `${count}d${faces}${mods}`,
        results: kept,
      };
      if (dropped.length > 0) part.dropped = dropped;
      const flavor = str(asRecord(term.options)?.flavor);
      if (flavor) part.label = flavor;
      if (sign === -1) part.sign = -1;
      parts.push(part);
      if (faces === 20 && kept.length > 0 && natural === undefined) natural = kept[0];
      sign = 1;
      continue;
    }

    // A function term (`max(1, 1d10 + 2)`, dnd5e's hit die) shows its expression and inner dice.
    const fn = str(term.fn);
    if (fn && Array.isArray(term.terms)) {
      const kept: number[] = [];
      for (const inner of arr(term.rolls)) {
        for (const innerTerm of arr(asRecord(inner)?.terms)) {
          const dice = asRecord(innerTerm);
          if (num(dice?.faces) === undefined) continue;
          for (const rawResult of arr(dice?.results)) {
            const result = asRecord(rawResult);
            const value = num(result?.result);
            if (value !== undefined && result?.active !== false) kept.push(value);
          }
        }
      }
      const expression = `${fn}(${arr(term.terms).map(String).join(', ')})`;
      const value = (num(term.total) ?? num(term.result) ?? 0) * sign;
      parts.push(
        kept.length > 0
          ? { kind: 'dice', formula: expression, results: kept, ...(sign === -1 ? { sign } : {}) }
          : { kind: 'number', value, label: expression }
      );
      sign = 1;
      continue;
    }

    const flatNumber = num(term.number);
    if (flatNumber !== undefined) {
      const value = flatNumber * sign;
      parts.push({ kind: 'number', value, label: labelFor(value, ctx) });
      sign = 1;
      continue;
    }

    const total = num(term.total);
    if (total !== undefined) {
      parts.push({ kind: 'number', value: total * sign, label: 'modifier' });
    }
    sign = 1;
  }

  return { parts, natural };
}

/** `isFirst`: the leading part of a roll never carries a redundant "+" prefix. */
function partText(part: RollBreakdownPart, isFirst: boolean): string {
  if (part.kind === 'dice') {
    const sign = part.sign === -1 ? '-' : isFirst ? '' : '+';
    const results = part.results.length > 0 ? part.results.join(', ') : '0';
    const label = part.label ? ` ${part.label}` : '';
    return `${sign}${part.formula} (${results})${label}`;
  }
  const sign = part.value >= 0 && !isFirst ? '+' : '';
  return `${sign}${part.value} ${part.label}`;
}

/** dnd5e's own name for a skill key ("prc" -> "Perception"), else the key in capitals. */
function skillName(key: string): string {
  try {
    const skills = asRecord(asRecord(asRecord(globalThis as unknown)?.CONFIG)?.DND5E)?.skills;
    const label = str(asRecord(asRecord(skills)?.[key])?.label);
    if (label) return label;
  } catch {
    // fall through
  }
  return key.toUpperCase();
}

const ROLL_LABELS: Record<string, string> = {
  initiative: 'Initiative',
  death: 'Death save',
  hitDie: 'Hit die',
};

function titleFor(
  rollType: string,
  itemName: string | undefined,
  abilityCode: string | undefined,
  subject: string | undefined,
  flavor: string | undefined
): string {
  const abilityName = abilityCode
    ? (ABILITY_FULL_NAMES[abilityCode] ?? abilityCode.toUpperCase())
    : undefined;
  switch (rollType) {
    case 'attack':
      return itemName ? `${itemName} attack` : 'Attack';
    case 'damage':
      return itemName ? `${itemName} damage` : 'Damage';
    case 'healing':
      return itemName ? `${itemName} healing` : 'Healing';
    case 'save':
      return abilityName ? `${abilityName} save` : 'Save';
    case 'skill':
      return subject ? `${skillName(subject)} check` : 'Skill check';
    case 'tool':
      return subject ? `${subject.toUpperCase()} check` : 'Tool check';
    case 'check':
      return abilityName ? `${abilityName} check` : 'Check';
    case 'initiative':
    case 'death':
    case 'hitDie':
      return ROLL_LABELS[rollType] ?? 'Roll';
    default:
      return flavor ?? 'Roll';
  }
}

/** Best-effort, never-throwing breakdown of a single roll from `message.rolls`. */
export function describeRoll(
  message: ChatMessage,
  rawRoll: unknown,
  rollType: string
): RollBreakdown {
  try {
    const roll = asRecord(rawRoll);
    const { name: actorName, actor } = resolveActor(message);
    const itemRef = dnd5eMessageItemRef(message);
    const itemName = itemRef?.name;
    const item = itemFromActor(actor, itemRef?.uuid);
    const abilityCode = abilityCodeFrom(message);
    const subject = dnd5eRollSubject(message);
    const ctx = buildLabelContext(actor, item, message, rollType);
    const { parts, natural } = buildParts(roll, ctx);

    const total = num(roll?.total) ?? 0;
    const dc = rollDcOf(roll);
    const outcome: 'success' | 'failure' | undefined =
      dc === undefined ? undefined : total >= dc ? 'success' : 'failure';
    const flavor = str((message as unknown as { flavor?: unknown }).flavor);

    const label = titleFor(rollType, itemName, abilityCode, subject, flavor);
    const partsText = parts.map((part, index) => partText(part, index === 0)).join(' ');
    const damageTypesText =
      rollType === 'damage' || rollType === 'healing' ? damageTypesOf(roll) : [];

    let base = `${partsText} = ${total}`;
    if (damageTypesText.length > 0) base += ` ${damageTypesText.join('/')}`;

    const naturalNote = natural === 20 ? ' natural 20' : natural === 1 ? ' natural 1' : '';
    const advantageMode = asRecord(roll?.options)?.advantageMode;
    const advantageNote =
      advantageMode === 1 ? ' (advantage)' : advantageMode === -1 ? ' (disadvantage)' : '';

    const challengeKind = rollType === 'attack' ? 'AC' : 'DC';
    const outcomeWord =
      rollType === 'attack' ? (outcome === 'success' ? 'hit' : 'miss') : (outcome ?? 'failure');
    const challengeClause = dc !== undefined ? ` vs ${challengeKind} ${dc}: ${outcomeWord}` : '';

    const head = `${actorName}, ${label}: `;
    const detail = `${base}${naturalNote}${advantageNote}${challengeClause}`;
    const detailPlayerSafe = `${base}${naturalNote}${advantageNote}${challengeVisibilityAll() ? challengeClause : ''}`;
    const text = head + detail;
    const textPlayerSafe = head + detailPlayerSafe;

    const breakdown: RollBreakdown = {
      label,
      parts,
      actorName,
      total,
      text,
      textPlayerSafe,
      detail,
      detailPlayerSafe,
    };
    if (natural !== undefined) breakdown.natural = natural;
    if (dc !== undefined) breakdown.dc = dc;
    if (outcome !== undefined) breakdown.outcome = outcome;
    return breakdown;
  } catch {
    // Never throw: a minimal, honest breakdown from whatever the roll itself carries.
    const roll = asRecord(rawRoll);
    const total = num(roll?.total) ?? 0;
    const formula = str(roll?.formula) ?? '';
    const detail = `${formula} = ${total}`;
    const text = `Roll: ${detail}`;
    return {
      label: 'Roll',
      parts: [],
      actorName: 'Unknown',
      total,
      text,
      textPlayerSafe: text,
      detail,
      detailPlayerSafe: detail,
    };
  }
}

/**
 * All of a message's rolls as one line. One roll reads as `describeRoll`; a
 * message with several (a weapon's slashing + fire damage) keeps one
 * "actor, label: " head and lists each roll, with the sum for damage/healing:
 * "Hero, Flame Tongue damage: 1d8 (5) +3 STR = 8 slashing; 2d6 (3, 4) = 7 fire; total 15".
 */
export function describeMessageRolls(
  message: ChatMessage,
  rawRolls: unknown[],
  rollType: string
): MessageRollBreakdown {
  const rolls = rawRolls.map(raw => describeRoll(message, raw, rollType));
  const total = rolls.reduce((sum, roll) => sum + roll.total, 0);
  const [first] = rolls;
  if (!first) return { rolls, total, text: '', textPlayerSafe: '' };
  if (rolls.length === 1) {
    return { rolls, total, text: first.text, textPlayerSafe: first.textPlayerSafe };
  }
  const head = `${first.actorName}, ${first.label}: `;
  const sum = rollType === 'damage' || rollType === 'healing' ? `; total ${total}` : '';
  return {
    rolls,
    total,
    text: head + rolls.map(roll => roll.detail).join('; ') + sum,
    textPlayerSafe: head + rolls.map(roll => roll.detailPlayerSafe).join('; ') + sum,
  };
}

/** Damage types a damage/healing roll's terms carry (`term.options.flavor` / `roll.options.type`). */
function damageTypesOf(roll: Record<string, unknown> | null): string[] {
  const types = new Set<string>();
  for (const rawTerm of arr(roll?.terms)) {
    const term = asRecord(rawTerm);
    const flavor = str(asRecord(term?.options)?.flavor);
    if (flavor) types.add(flavor.toLowerCase());
  }
  const optionType = str(asRecord(roll?.options)?.type);
  if (optionType) types.add(optionType.toLowerCase());
  return Array.from(types);
}
