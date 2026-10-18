/**
 * The "Party" GM window (I-134): the dashboard's party strip inside Foundry. One row per player
 * character: hit points (and temporary), armor class, passive Perception, level, conditions and
 * the spell slots left. Read-only; the numbers come from the actors on this GM client.
 *
 * {@link buildPartyView} and {@link renderPartyHtml} are pure, so the rows and the escaping are
 * tested without Foundry; {@link openPartyWindow} wires them to the window shell.
 */
import { escapeHtml } from './ai-changes-model.js';
import { conditionLabel } from './combat-window.js';
import { createPanelWindow } from './gm-windows.js';

/** The parts of a dnd5e character the strip reads (structurally). */
export interface PartyActorLike {
  id?: string;
  name?: string;
  type?: string;
  hasPlayerOwner?: boolean;
  statuses?: Iterable<string>;
  system?: {
    attributes?: {
      hp?: { value?: number; max?: number; temp?: number };
      ac?: { value?: number };
    };
    skills?: { prc?: { passive?: number } };
    details?: { level?: number };
    spells?: SpellSlotsLike;
  };
}

type SpellSlotsLike = Record<string, { value?: number; max?: number } | undefined>;

export interface PartyRow {
  id: string;
  name: string;
  level: number | null;
  hp: string;
  hpPercent: number | null;
  ac: string;
  passivePerception: string;
  conditions: string[];
  /** "1st 2/4, 3rd 1/2" for the slot levels the character has. */
  slots: string;
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

/** Whether an actor belongs in the party: a character a player owns. */
export function isPartyMember(actor: PartyActorLike): boolean {
  return actor.type === 'character' && actor.hasPlayerOwner === true;
}

/** The slot levels a character has, as "1st 2/4, 3rd 1/2" (pact and empty levels are left out). */
export function slotsText(spells: SpellSlotsLike | undefined): string {
  if (!spells) return '';
  const parts: string[] = [];
  for (let level = 1; level <= 9; level += 1) {
    const slot = spells[`spell${level}`];
    const max = whole(slot?.max);
    if (max === null || max <= 0) continue;
    parts.push(`${ORDINALS[level - 1]} ${Math.max(0, whole(slot?.value) ?? 0)}/${max}`);
  }
  return parts.join(', ');
}

export function buildPartyView(actors: Iterable<PartyActorLike>): PartyRow[] {
  const rows: PartyRow[] = [];
  for (const actor of actors) {
    if (!isPartyMember(actor)) continue;
    const hp = actor.system?.attributes?.hp;
    const value = whole(hp?.value);
    const max = whole(hp?.max);
    const temp = whole(hp?.temp) ?? 0;
    const hasHp = value !== null && max !== null && max > 0;
    const ac = whole(actor.system?.attributes?.ac?.value);
    const prc = whole(actor.system?.skills?.prc?.passive);
    rows.push({
      id: actor.id ?? '',
      name: actor.name || 'Unknown',
      level: whole(actor.system?.details?.level),
      hp: hasHp ? `${value}/${max}${temp > 0 ? ` (+${temp})` : ''}` : '',
      hpPercent: hasHp ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : null,
      ac: ac === null ? '-' : String(ac),
      passivePerception: prc === null ? '-' : String(prc),
      conditions: (actor.statuses ? Array.from(actor.statuses) : [])
        .map(conditionLabel)
        .filter(Boolean),
      slots: slotsText(actor.system?.spells),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function renderPartyHtml(rows: readonly PartyRow[]): string {
  if (rows.length === 0) {
    return '<p class="fmb-ai-notice fmb-gm-empty">No player characters yet. A character a player owns shows here.</p>';
  }
  const items = rows
    .map(row => {
      const bar =
        row.hpPercent === null
          ? ''
          : `<span class="fmb-gm-bar" role="img" aria-label="${escapeHtml(row.hp)} hit points"><span style="width:${row.hpPercent}%"></span></span>`;
      const conditions = row.conditions
        .map(c => `<span class="fmb-ai-tag">${escapeHtml(c)}</span>`)
        .join(' ');
      const level =
        row.level === null ? '' : ` <span class="fmb-gm-muted">level ${row.level}</span>`;
      return `<li class="fmb-gm-row" data-actor="${escapeHtml(row.id)}">
        <span class="fmb-gm-main"><strong>${escapeHtml(row.name)}</strong>${level}
          <span class="fmb-gm-sub">${bar}<span class="fmb-gm-hp">${escapeHtml(row.hp)}</span>
            <span>AC ${escapeHtml(row.ac)}</span> <span>PP ${escapeHtml(row.passivePerception)}</span></span>
          ${row.slots ? `<span class="fmb-gm-sub fmb-gm-muted">Slots ${escapeHtml(row.slots)}</span>` : ''}
          ${conditions ? `<span class="fmb-gm-sub">${conditions}</span>` : ''}</span>
      </li>`;
    })
    .join('');
  return `<ul class="fmb-ai-list fmb-gm-list">${items}</ul>`;
}

const panel = createPanelWindow({
  id: 'fmb-gm-party',
  title: 'Party',
  icon: 'fa-solid fa-users',
  width: 360,
  height: 460,
  hooks: [
    'updateActor',
    'createActor',
    'deleteActor',
    'createActiveEffect',
    'deleteActiveEffect',
    'updateActiveEffect',
  ],
  render: () =>
    renderPartyHtml(buildPartyView(Array.from(game.actors as unknown as Iterable<PartyActorLike>))),
});

/** Open the "Party" window (one per browser). */
export const openPartyWindow = (): Promise<boolean> => panel.open();

/** Forget the window (tests). */
export const resetPartyWindowForTests = (): void => panel.reset();
