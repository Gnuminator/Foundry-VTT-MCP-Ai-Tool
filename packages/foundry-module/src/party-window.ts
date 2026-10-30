/**
 * The "Party" GM window (I-134): the dashboard's party strip inside Foundry. One row per player
 * character: hit points (and temporary), armor class, passive Perception, level, conditions and
 * the spell slots left. The numbers come from the actors on this GM client. Above the rows is the
 * quick roll bar (item quick-roll-buttons-foundry, see party-rolls.ts): one click asks a character
 * or the whole party (a group save) for a check, save or skill, and the answers list per character.
 *
 * {@link buildPartyView} and {@link renderPartyHtml} are pure, so the rows and the escaping are
 * tested without Foundry; {@link openPartyWindow} wires them to the window shell.
 */
import { escapeHtml } from './ai-changes-model.js';
import { conditionLabel } from './combat-window.js';
import { canOpenGmWindow, createPanelWindow } from './gm-windows.js';
import { writeOperationsAllowed } from './guarded-features.js';
import {
  DEFAULT_PICK,
  newRound,
  noteRoll,
  renderAskButtonHtml,
  renderRollBarHtml,
  renderRoundHtml,
  rollRequest,
  setPickField,
  type RollBarView,
  type RollMessageLike,
  type RollPick,
  type Round,
} from './party-rolls.js';
import { bindFields } from './window-fields.js';

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

/** The roll bar and the results, when the window draws them (tests draw the plain rows). */
export interface PartyRollView {
  bar: RollBarView;
  canSend: boolean;
}

export function renderPartyHtml(rows: readonly PartyRow[], rolls?: PartyRollView): string {
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
      const ask = rolls ? renderAskButtonHtml(row.id, row.name, rolls.bar.pick, rolls.canSend) : '';
      return `<li class="fmb-gm-row" data-actor="${escapeHtml(row.id)}">
        <span class="fmb-gm-main"><strong>${escapeHtml(row.name)}</strong>${level}
          <span class="fmb-gm-sub">${bar}<span class="fmb-gm-hp">${escapeHtml(row.hp)}</span>
            <span>AC ${escapeHtml(row.ac)}</span> <span>PP ${escapeHtml(row.passivePerception)}</span></span>
          ${row.slots ? `<span class="fmb-gm-sub fmb-gm-muted">Slots ${escapeHtml(row.slots)}</span>` : ''}
          ${conditions ? `<span class="fmb-gm-sub">${conditions}</span>` : ''}</span>
        ${ask}
      </li>`;
    })
    .join('');
  const list = `<ul class="fmb-ai-list fmb-gm-list">${items}</ul>`;
  return rolls
    ? `${renderRollBarHtml(rolls.bar, rolls.canSend)}${renderRoundHtml(rolls.bar.round)}${list}`
    : list;
}

// ---- Roll requests: the bar's state lives here, so a redraw keeps the choice ----

let pick: RollPick = { ...DEFAULT_PICK };
let round: Round | null = null;

/** What `window.foundryMCPBridge.dataAccess` offers the bar (the module's own roll path). */
interface RollSender {
  requestPlayerRolls(data: ReturnType<typeof rollRequest>): Promise<{
    success: boolean;
    message: string;
    error?: string;
  }>;
}

const WRITES_OFF_REASON =
  'Roll requests are off. Start the session (or turn on "Allow Write Operations" in the module settings) to send them.';

/** True while a send runs: a second click (or an Ask during a group ask) does nothing. */
let sending = false;

function rollView(): PartyRollView {
  const canSend = canOpenGmWindow() && writeOperationsAllowed() && !sending;
  return {
    bar: { pick, round, disabledReason: writeOperationsAllowed() ? '' : WRITES_OFF_REASON },
    canSend,
  };
}

/**
 * Send one request per character and fill the round as each answer comes back. One after another,
 * not in parallel: each request saves its card's message id into one world setting, and saves that
 * overlap lose each other's entries.
 */
async function ask(targets: { id: string; name: string }[]): Promise<void> {
  if (sending) return;
  if (targets.length === 0 || !canOpenGmWindow() || !writeOperationsAllowed()) {
    panel.redraw();
    return;
  }
  const sender = window.foundryMCPBridge?.dataAccess as RollSender | undefined;
  const sentPick = pick;
  const mine = newRound(sentPick, targets, Date.now());
  round = mine;
  sending = true;
  panel.redraw();
  try {
    for (const entry of mine.entries) {
      if (!sender?.requestPlayerRolls) {
        entry.status = 'failed';
        entry.error = 'the AI Tool module is not ready yet';
        continue;
      }
      try {
        const result = await sender.requestPlayerRolls(rollRequest(sentPick, entry.name));
        if (!result.success) {
          entry.status = 'failed';
          entry.error = result.error ?? 'the request failed';
        }
      } catch (error) {
        entry.status = 'failed';
        entry.error = error instanceof Error ? error.message : String(error);
      }
      panel.redraw();
    }
  } finally {
    sending = false;
    panel.redraw();
  }
}

function partyTargets(): { id: string; name: string }[] {
  return buildPartyView(Array.from(game.actors as unknown as Iterable<PartyActorLike>)).map(
    row => ({ id: row.id, name: row.name })
  );
}

/** A chat message arrived: a roll from a character with an open ask fills in its answer. */
function onChatMessage(message: unknown): void {
  if (noteRoll(round, message as RollMessageLike)) panel.redraw();
}

let chatHook: number | null = null;

const panel = createPanelWindow({
  id: 'fmb-gm-party',
  title: 'Party',
  icon: 'fa-solid fa-users',
  width: 360,
  height: 460,
  left: 460,
  top: 20,
  hooks: [
    'updateActor',
    'createActor',
    'deleteActor',
    'createActiveEffect',
    'deleteActiveEffect',
    'updateActiveEffect',
    'updateSetting',
  ],
  render: () =>
    renderPartyHtml(
      buildPartyView(Array.from(game.actors as unknown as Iterable<PartyActorLike>)),
      rollView()
    ),
  bindContent: content =>
    bindFields(content, (field, _position, value) => {
      pick = setPickField(pick, field, value);
      // The Ask buttons carry the new choice in their title and the whole-party label.
      if (field !== 'dc') panel.redraw();
    }),
  actions: {
    askOne: target =>
      ask([{ id: target.dataset.actorId ?? '', name: target.dataset.actorName ?? '' }]),
    askAll: () => ask(partyTargets()),
    clearRound: () => {
      round = null;
      panel.redraw();
    },
  },
  onOpen: () => {
    chatHook ??= Hooks.on('createChatMessage', onChatMessage);
  },
  onClose: () => {
    if (chatHook !== null) Hooks.off('createChatMessage', chatHook);
    chatHook = null;
  },
});

/** Open the "Party" window (one per browser). */
export const openPartyWindow = (): Promise<boolean> => panel.open();

/** Forget the window (tests). */
export const resetPartyWindowForTests = (): void => {
  panel.reset();
  pick = { ...DEFAULT_PICK };
  round = null;
  sending = false;
  chatHook = null;
};
