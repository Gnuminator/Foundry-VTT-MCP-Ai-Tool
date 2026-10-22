// "After a paper night" form (Paper nights B): the numbers on a paper sheet, typed in and sent to
// plan-paper-sync. Pure logic, no DOM. A card starts from the sheet in Foundry (the values printed
// at the start of the night); the request holds only the fields the GM changed, so a field nobody
// touched is never written back over something that moved in Foundry meanwhile. The module
// compares absolute values again and checks the maximums (shared/src/paper-sync.ts has the field
// list and the rules).

/** The part of a character sheet (GET /api/party-sheets, shared CharacterSheet) the form reads. */
export interface SheetLike {
  id: string;
  name: string;
  player?: string;
  classes: { name: string; levels: number; hitDie?: string | null }[];
  hp: { value: number; max: number; temp: number };
  hitDice: { value: number; max: number };
  exhaustion: number;
  inspiration: boolean;
  deathSaves: { success: number; failure: number };
  conditions: string[];
  slots: { level: number; value: number; max: number; pact: boolean }[];
  features: { id: string; name: string; uses: { value: number; max: number } | null }[];
  inventory: {
    id: string;
    name: string;
    quantity: number;
    uses: { value: number; max: number } | null;
  }[];
  currency: Record<string, number>;
}

export const COINS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;

/** The 5e conditions a paper sheet carries (the module's SHEET_CONDITIONS). */
export const CONDITIONS = [
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
] as const;

/** What the card holds while the GM types: every number as text, so a half-typed value stays. */
export interface PaperDraft {
  hp: string;
  tempHp: string;
  /** By slot key: "1" to "9", "pact". */
  slots: Record<string, string>;
  /** One class: key "". Several: by class name, empty until typed (the sheet knows only the total). */
  hitDice: Record<string, string>;
  /** By resource name. */
  resources: Record<string, string>;
  coins: Record<string, string>;
  exhaustion: string;
  /** Lower case, as CONDITIONS. */
  conditions: string[];
  inspiration: boolean;
  resetDeathSaves: boolean;
  /** By sheet item id. */
  inventory: Record<string, string>;
  /** Items to add from the compendium. */
  added: AddedItem[];
}

export interface AddedItem {
  /** Row key, stable while the list changes. */
  key: number;
  uuid: string;
  quantity: string;
}

/** A resource the sheet shows: a feature or an item with charges. */
export interface ResourceRow {
  name: string;
  value: number;
  max: number;
}

export const slotKey = (slot: SheetLike['slots'][number]): string =>
  slot.pact ? 'pact' : String(slot.level);

export const slotLabel = (slot: SheetLike['slots'][number]): string =>
  slot.pact ? `Pact slots (level ${slot.level})` : `Level ${slot.level} slots`;

/** Features and items with charges, in sheet order (a name that repeats shows once). */
export function resourceRows(sheet: SheetLike): ResourceRow[] {
  const seen = new Set<string>();
  const rows: ResourceRow[] = [];
  for (const entry of [...sheet.features, ...sheet.inventory]) {
    if (!entry.uses || entry.uses.max <= 0 || seen.has(entry.name)) continue;
    seen.add(entry.name);
    rows.push({ name: entry.name, value: entry.uses.value, max: entry.uses.max });
  }
  return rows;
}

const text = (n: number): string => String(n);

/** True when the character has one class (or none): the hit dice are one number. */
export function singleHitDiceClass(sheet: SheetLike): boolean {
  return sheet.classes.filter(c => c.levels > 0).length <= 1;
}

/** The sheet as a draft: every field shows what Foundry has now. */
export function initialDraft(sheet: SheetLike): PaperDraft {
  const classes = sheet.classes.filter(c => c.levels > 0);
  return {
    hp: text(sheet.hp.value),
    tempHp: text(sheet.hp.temp),
    slots: Object.fromEntries(sheet.slots.map(s => [slotKey(s), text(s.value)])),
    hitDice:
      classes.length <= 1
        ? { '': text(sheet.hitDice.value) }
        : Object.fromEntries(classes.map(c => [c.name, ''])),
    resources: Object.fromEntries(resourceRows(sheet).map(r => [r.name, text(r.value)])),
    coins: Object.fromEntries(COINS.map(c => [c, text(sheet.currency[c] ?? 0)])),
    exhaustion: text(sheet.exhaustion),
    conditions: sheetConditions(sheet),
    inspiration: sheet.inspiration,
    resetDeathSaves: false,
    inventory: Object.fromEntries(sheet.inventory.map(i => [i.id, text(i.quantity)])),
    added: [],
  };
}

/** The sheet's conditions as lower case ids, only the ones a paper sheet can carry. */
export function sheetConditions(sheet: SheetLike): string[] {
  const known: readonly string[] = CONDITIONS;
  return sheet.conditions.map(c => c.trim().toLowerCase()).filter(c => known.includes(c));
}

/** A whole number from what was typed, else null (empty, a decimal, a minus sign or letters). */
export function wholeNumber(value: string): number | null {
  const t = value.trim();
  return /^\d{1,7}$/.test(t) ? Number(t) : null;
}

/** The plan-paper-sync arguments, as the tool takes them (shared PaperSyncRequest). */
export interface PaperRequest {
  actor: string;
  hp?: number;
  tempHp?: number;
  slots?: Record<string, number>;
  hitDice?: { class?: string; left: number }[];
  resources?: { name: string; value: number }[];
  coins?: Record<string, number>;
  exhaustion?: number;
  conditions?: string[];
  inspiration?: boolean;
  resetDeathSaves?: boolean;
  inventory?: { item?: string; uuid?: string; quantity: number }[];
}

export type BuiltRequest =
  | { ok: true; request: PaperRequest; changed: number }
  | { ok: false; problems: string[] };

/**
 * The request for one card: only what differs from the sheet. A number that is not a whole number,
 * or above what the sheet allows (HP above max, slots above the total, a resource above its
 * maximum, exhaustion above 6), is a problem the card shows before anything is planned; the module
 * checks the same limits again.
 */
export function buildRequest(sheet: SheetLike, draft: PaperDraft): BuiltRequest {
  const problems: string[] = [];
  const request: PaperRequest = { actor: sheet.id };
  let changed = 0;

  const field = (label: string, raw: string, now: number, max?: number): number | null => {
    const n = wholeNumber(raw);
    if (n === null) {
      problems.push(`${label}: type a whole number, 0 or more`);
      return null;
    }
    if (max !== undefined && n > max) {
      problems.push(`${label}: ${n} is more than the maximum ${max}`);
      return null;
    }
    return n === now ? null : n;
  };

  const hp = field('HP', draft.hp, sheet.hp.value, sheet.hp.max);
  if (hp !== null) {
    request.hp = hp;
    changed++;
  }
  const tempHp = field('Temp HP', draft.tempHp, sheet.hp.temp);
  if (tempHp !== null) {
    request.tempHp = tempHp;
    changed++;
  }

  for (const slot of sheet.slots) {
    const key = slotKey(slot);
    const n = field(slotLabel(slot), draft.slots[key] ?? text(slot.value), slot.value, slot.max);
    if (n !== null) {
      request.slots = { ...request.slots, [key]: n };
      changed++;
    }
  }

  if (singleHitDiceClass(sheet)) {
    const raw = draft.hitDice[''] ?? text(sheet.hitDice.value);
    const n = field('Hit dice', raw, sheet.hitDice.value, sheet.hitDice.max);
    if (n !== null) {
      request.hitDice = [{ left: n }];
      changed++;
    }
  } else {
    // Several classes: the sheet knows the total, not the split, so only a class typed in is sent.
    for (const c of sheet.classes.filter(x => x.levels > 0)) {
      const raw = draft.hitDice[c.name] ?? '';
      if (raw.trim() === '') continue;
      const n = field(`${c.name} hit dice`, raw, -1);
      if (n !== null) {
        request.hitDice = [...(request.hitDice ?? []), { class: c.name, left: n }];
        changed++;
      }
    }
  }

  for (const r of resourceRows(sheet)) {
    const n = field(r.name, draft.resources[r.name] ?? text(r.value), r.value, r.max);
    if (n !== null) {
      request.resources = [...(request.resources ?? []), { name: r.name, value: n }];
      changed++;
    }
  }

  for (const coin of COINS) {
    const n = field(coin.toUpperCase(), draft.coins[coin] ?? '0', sheet.currency[coin] ?? 0);
    if (n !== null) {
      request.coins = { ...request.coins, [coin]: n };
      changed++;
    }
  }

  const exhaustion = field('Exhaustion', draft.exhaustion, sheet.exhaustion, 6);
  if (exhaustion !== null) {
    request.exhaustion = exhaustion;
    changed++;
  }

  const before = [...sheetConditions(sheet)].sort();
  const after = [...draft.conditions].sort();
  if (before.join() !== after.join()) {
    request.conditions = after;
    changed++;
  }
  if (draft.inspiration !== sheet.inspiration) {
    request.inspiration = draft.inspiration;
    changed++;
  }
  if (draft.resetDeathSaves) {
    request.resetDeathSaves = true;
    changed++;
  }

  for (const item of sheet.inventory) {
    const n = field(item.name, draft.inventory[item.id] ?? text(item.quantity), item.quantity);
    if (n !== null) {
      request.inventory = [...(request.inventory ?? []), { item: item.id, quantity: n }];
      changed++;
    }
  }
  for (const add of draft.added) {
    if (add.uuid.trim() === '') continue;
    const n = wholeNumber(add.quantity);
    if (n === null || n === 0) {
      problems.push(`New item ${add.uuid.trim()}: type how many, 1 or more`);
      continue;
    }
    request.inventory = [...(request.inventory ?? []), { uuid: add.uuid.trim(), quantity: n }];
    changed++;
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, request, changed };
}

/** True when a card has any edit at all (it has a Plan button to press). */
export function isEdited(sheet: SheetLike, draft: PaperDraft): boolean {
  const built = buildRequest(sheet, draft);
  return !built.ok || built.changed > 0;
}

/** A date as YYYY-MM-DD in local time (the day the table sat down, not UTC). */
export function localDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** What plan-paper-sync answers; the fields the card shows. */
export interface PaperPlan {
  planId?: string;
  risk?: string;
  summary?: string;
  changes?: { line?: string; label?: string }[];
  unchanged?: string[];
  warnings?: string[];
}

/** The confirm window's lines for a plan: what changes, then what to check. */
export function planLines(plan: PaperPlan): string[] {
  const lines = (plan.changes ?? []).map(c => String(c.line ?? c.label ?? ''));
  const warnings = (plan.warnings ?? []).map(w => `Check: ${w}`);
  return [...lines, ...warnings];
}
