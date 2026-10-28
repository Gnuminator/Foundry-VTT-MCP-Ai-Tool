/**
 * The "Loot" GM window (I-134): what the party is carrying in treasure. One card per player
 * character with the coins (and what they add up to in gold) and the items of type "loot" (gems,
 * art objects, trade goods), plus a party total. Read-only: the numbers come from the actors on
 * this GM client, nothing goes through the AI Tool. Giving loot stays with Claude ("give the party
 * 50 gold") or the dashboard, as a planned change you confirm.
 *
 * {@link buildLootView} and {@link renderLootHtml} are pure, so the rows and the escaping are
 * tested without Foundry; {@link openLootWindow} wires them to the window shell.
 */
import { escapeHtml } from './ai-changes-model.js';
import { createPanelWindow } from './gm-windows.js';
import { isPartyMember, type PartyActorLike } from './party-window.js';

type Coins = Partial<Record<'pp' | 'gp' | 'ep' | 'sp' | 'cp', number>>;

/** The parts of a dnd5e character the window reads (structurally). */
export interface LootActorLike extends PartyActorLike {
  system?: PartyActorLike['system'] & { currency?: Coins };
  items?: Iterable<{
    id?: string;
    name?: string;
    type?: string;
    system?: { quantity?: number; type?: { value?: string } };
  }>;
}

export interface LootItem {
  name: string;
  quantity: number;
}

export interface LootRow {
  id: string;
  name: string;
  /** "12 gp, 5 sp" with the coins the character has; empty with none. */
  coins: string;
  /** The coins as gold pieces, in copper to avoid float drift (100 cp = 1 gp). */
  copper: number;
  items: LootItem[];
}

export interface LootView {
  rows: LootRow[];
  /** "246.5 gp" for the whole party. */
  totalGold: string;
  totalItems: number;
}

/** Copper value of one coin: pp 1000, gp 100, ep 50, sp 10, cp 1. */
const COPPER: Record<keyof Coins, number> = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };
const ORDER: ReadonlyArray<keyof Coins> = ['pp', 'gp', 'ep', 'sp', 'cp'];

/** dnd5e loot types (Item sheet, "Loot Type") that count as treasure: art, gems, treasure and trade goods. */
const TREASURE_TYPES = new Set(['art', 'gem', 'treasure', 'trade']);

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/** Copper as gold pieces for reading: "246.5 gp", "0 gp". */
export function goldText(copper: number): string {
  const gold = Math.floor(copper) / 100;
  return `${Number.isInteger(gold) ? gold : gold.toFixed(2).replace(/0$/, '')} gp`;
}

export function buildLootView(actors: Iterable<LootActorLike>): LootView {
  const rows: LootRow[] = [];
  for (const actor of actors) {
    if (!isPartyMember(actor)) continue;
    const currency = actor.system?.currency ?? {};
    const coins = ORDER.filter(c => count(currency[c]) > 0).map(c => `${count(currency[c])} ${c}`);
    const copper = ORDER.reduce((sum, c) => sum + count(currency[c]) * COPPER[c], 0);
    const items: LootItem[] = [];
    for (const item of actor.items ?? []) {
      // dnd5e files adventuring gear (a crowbar, a bedroll) under "loot" too, with no loot type:
      // the window lists only what is marked as treasure.
      if (item.type !== 'loot' || !TREASURE_TYPES.has(item.system?.type?.value ?? '')) continue;
      items.push({
        name: item.name || 'Unnamed item',
        quantity: Math.max(1, count(item.system?.quantity)),
      });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    rows.push({
      id: actor.id ?? '',
      name: actor.name || 'Unknown',
      coins: coins.join(', '),
      copper,
      items,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return {
    rows,
    totalGold: goldText(rows.reduce((sum, r) => sum + r.copper, 0)),
    totalItems: rows.reduce((sum, r) => sum + r.items.reduce((n, i) => n + i.quantity, 0), 0),
  };
}

export function renderLootHtml(view: LootView): string {
  if (view.rows.length === 0) {
    return '<p class="fmb-ai-notice fmb-gm-empty">No player characters yet. A character a player owns shows here.</p>';
  }
  const items = view.rows
    .map(row => {
      const coins = row.coins
        ? `<span>${escapeHtml(row.coins)}</span> <span class="fmb-gm-muted">(${escapeHtml(goldText(row.copper))})</span>`
        : '<span class="fmb-gm-muted">No coins</span>';
      const loot = row.items.length
        ? `<span class="fmb-gm-sub">${row.items
            .map(
              i =>
                `<span class="fmb-ai-tag">${escapeHtml(i.name)}${i.quantity > 1 ? ` x${i.quantity}` : ''}</span>`
            )
            .join(' ')}</span>`
        : '';
      return `<li class="fmb-gm-row" data-actor="${escapeHtml(row.id)}">
        <span class="fmb-gm-main"><strong>${escapeHtml(row.name)}</strong>
          <span class="fmb-gm-sub">${coins}</span>${loot}</span>
      </li>`;
    })
    .join('');
  return `<div class="fmb-ai-toolbar"><span><strong>Party total</strong> ${escapeHtml(view.totalGold)}${
    view.totalItems > 0 ? `, ${view.totalItems} loot item${view.totalItems === 1 ? '' : 's'}` : ''
  }</span></div><ul class="fmb-ai-list fmb-gm-list">${items}</ul>`;
}

const panel = createPanelWindow({
  id: 'fmb-gm-loot',
  title: 'Loot',
  icon: 'fa-solid fa-coins',
  width: 360,
  height: 320,
  left: 460,
  top: 500,
  hooks: ['updateActor', 'createActor', 'deleteActor', 'createItem', 'updateItem', 'deleteItem'],
  render: () =>
    renderLootHtml(buildLootView(Array.from(game.actors as unknown as Iterable<LootActorLike>))),
});

/** Open the "Loot" window (one per browser). */
export const openLootWindow = (): Promise<boolean> => panel.open();

/** Forget the window (tests). */
export const resetLootWindowForTests = (): void => panel.reset();
