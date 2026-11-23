/**
 * "Party stash" (I-175): what the party carries, by holder, and the group's gold.
 *
 * Built from the character sheets of the players' own characters only (the bridge's
 * `character_sheet` returns the character actors a user OWNS, so a monster, an NPC or another
 * group's actor never gets in). An item the sheet marks as not identified, or flagged secret, is
 * reduced to the words "Unidentified item": its name, type, description and numbers are dropped
 * here, whatever the module sent.
 */

const UNIDENTIFIED_NAME = 'Unidentified item';

interface StashItem {
  name: string;
  quantity: number;
  type: string;
  unidentified: boolean;
}

interface StashHolder {
  name: string;
  items: StashItem[];
  /** Coins as the sheet shows them (pp, gp, ep, sp, cp). */
  currency: Record<string, number>;
}

interface PartyStash {
  holders: StashHolder[];
  /** The whole group's coins in gold pieces (pp 10, gp 1, ep 0.5, sp 0.1, cp 0.01). */
  totalGold: number;
}

/** Copper pieces per coin, so the sum stays exact. */
const COPPER_VALUE: Record<string, number> = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };
const COINS = Object.keys(COPPER_VALUE);

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function itemOf(raw: unknown): StashItem | null {
  if (!isRec(raw) || typeof raw.name !== 'string') return null;
  const hidden = raw.identified === false || raw.secret === true;
  const q = typeof raw.quantity === 'number' && Number.isFinite(raw.quantity) ? raw.quantity : 1;
  return {
    name: hidden ? UNIDENTIFIED_NAME : raw.name.slice(0, 120),
    quantity: hidden ? 1 : Math.max(0, Math.min(Math.floor(q), 1_000_000)),
    type: hidden ? 'unknown' : typeof raw.type === 'string' ? raw.type.slice(0, 40) : 'loot',
    unidentified: hidden,
  };
}

/** One character sheet to a holder (null when it is not a sheet with a name). */
function holderOf(sheet: unknown): StashHolder | null {
  if (!isRec(sheet) || typeof sheet.name !== 'string') return null;
  const items = (Array.isArray(sheet.inventory) ? sheet.inventory : [])
    .map(itemOf)
    .filter((i): i is StashItem => i !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  const currency: Record<string, number> = {};
  const raw = isRec(sheet.currency) ? sheet.currency : {};
  for (const coin of COINS) {
    const v = raw[coin];
    currency[coin] = typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  }
  return { name: sheet.name.slice(0, 80), items, currency };
}

/** The stash of the party from the `character_sheet` answers of every player. */
export function buildPartyStash(answers: unknown[]): PartyStash {
  const seen = new Set<string>();
  const holders: StashHolder[] = [];
  for (const answer of answers) {
    const sheets = isRec(answer) && Array.isArray(answer.sheets) ? answer.sheets : [];
    for (const sheet of sheets) {
      const id = isRec(sheet) && typeof sheet.id === 'string' ? sheet.id : null;
      if (id !== null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      const holder = holderOf(sheet);
      if (holder) holders.push(holder);
    }
  }
  holders.sort((a, b) => a.name.localeCompare(b.name));
  let copper = 0;
  for (const h of holders)
    for (const coin of COINS) copper += h.currency[coin] * COPPER_VALUE[coin];
  return { holders, totalGold: copper / 100 };
}
