/**
 * Quick roll requests in the Party window (item quick-roll-buttons-foundry): the one-click
 * "ask for a check, save or skill" bar for one character or the whole party, the group save, and
 * the per-character results as the rolls come in. The dashboard has the same bar (its
 * `quickRoll.ts`); this one runs inside Foundry, so the GM stays on one screen.
 *
 * A request is the module's own `requestPlayerRolls` (the handler behind the `request-player-rolls`
 * tool), so every roll lands in the play log, recap, stats and Live Feed exactly as one asked for by
 * Claude or the dashboard. Everything here is pure (the window and the chat hook wire it up), so
 * the model and the escaping are tested without Foundry.
 */
import { escapeHtml } from './ai-changes-model.js';

export type Advantage = 'normal' | 'advantage' | 'disadvantage';

/** What the bar has picked. `what` is "<kind>:<id>", the one select's value. */
export interface RollPick {
  what: string;
  dc: string;
  isPublic: boolean;
  advantage: Advantage;
}

const ABILITIES = [
  { id: 'str', label: 'Strength' },
  { id: 'dex', label: 'Dexterity' },
  { id: 'con', label: 'Constitution' },
  { id: 'int', label: 'Intelligence' },
  { id: 'wis', label: 'Wisdom' },
  { id: 'cha', label: 'Charisma' },
] as const;

const SKILLS = [
  'Acrobatics',
  'Animal Handling',
  'Arcana',
  'Athletics',
  'Deception',
  'History',
  'Insight',
  'Intimidation',
  'Investigation',
  'Medicine',
  'Nature',
  'Perception',
  'Performance',
  'Persuasion',
  'Religion',
  'Sleight of Hand',
  'Stealth',
  'Survival',
] as const;

export const DEFAULT_PICK: RollPick = {
  what: 'skill:Perception',
  dc: '',
  isPublic: false,
  advantage: 'normal',
};

interface OptionGroup {
  group: string;
  options: { value: string; label: string }[];
}

/** The select's options, grouped: checks, saves, skills. */
export function rollOptions(): OptionGroup[] {
  return [
    {
      group: 'Ability check',
      options: ABILITIES.map(a => ({ value: `check:${a.id}`, label: `${a.label} check` })),
    },
    {
      group: 'Saving throw',
      options: ABILITIES.map(a => ({ value: `save:${a.id}`, label: `${a.label} save` })),
    },
    { group: 'Skill check', options: SKILLS.map(s => ({ value: `skill:${s}`, label: s })) },
  ];
}

const KNOWN = new Set(rollOptions().flatMap(g => g.options.map(o => o.value)));

/** The label of a pick for the button and the results: "Dexterity save", "Perception". */
export function pickLabel(pick: RollPick): string {
  for (const g of rollOptions()) {
    const o = g.options.find(x => x.value === pick.what);
    if (o) return o.label;
  }
  return pick.what;
}

/** The DC the pick holds, or null when the field is empty or not a whole number from 1 to 99. */
export function pickDc(pick: RollPick): number | null {
  const text = pick.dc.trim();
  if (!/^\d{1,2}$/.test(text)) return null;
  const dc = Number(text);
  return dc > 0 ? dc : null;
}

/** Whether a pick is a saving throw (the "Group save" wording). */
export function isSave(pick: RollPick): boolean {
  return pick.what.startsWith('save:');
}

/** The `requestPlayerRolls` data. */
export interface RollRequestData {
  rollType: string;
  rollTarget: string;
  targetPlayer: string;
  isPublic: boolean;
  rollModifier: string;
  flavor: string;
  dc?: number;
  advantage?: 'advantage' | 'disadvantage';
}

/** The request for one character, named exactly so a player name cannot win. */
export function rollRequest(pick: RollPick, characterName: string): RollRequestData {
  const sep = pick.what.indexOf(':');
  const kind = pick.what.slice(0, sep);
  const id = pick.what.slice(sep + 1);
  const dc = pickDc(pick);
  return {
    rollType: kind === 'check' ? 'ability' : kind,
    rollTarget: kind === 'skill' ? id.toLowerCase() : id,
    targetPlayer: characterName,
    isPublic: pick.isPublic,
    rollModifier: '',
    flavor: dc === null ? '' : `DC ${dc}`,
    ...(dc === null ? {} : { dc }),
    ...(pick.advantage === 'normal' ? {} : { advantage: pick.advantage }),
  };
}

/** Apply one bar field (`data-field`) to a pick; an unknown value keeps the old one. */
export function setPickField(pick: RollPick, field: string, value: string | boolean): RollPick {
  if (field === 'what' && typeof value === 'string' && KNOWN.has(value)) {
    return { ...pick, what: value };
  }
  if (field === 'dc' && typeof value === 'string' && /^\d{0,2}$/.test(value.trim())) {
    return { ...pick, dc: value.trim() };
  }
  if (field === 'isPublic' && typeof value === 'boolean') return { ...pick, isPublic: value };
  if (field === 'advantage' && (value === 'advantage' || value === 'disadvantage')) {
    return { ...pick, advantage: value };
  }
  if (field === 'advantage' && value === 'normal') return { ...pick, advantage: 'normal' };
  return pick;
}

export type EntryStatus = 'waiting' | 'rolled' | 'failed';

export interface RoundEntry {
  actorId: string;
  name: string;
  status: EntryStatus;
  total?: number;
  /** Why the request did not go out (player offline, writes off, ...). */
  error?: string;
}

/** One ask (one character or the whole party) and how each answer is coming in. */
export interface Round {
  label: string;
  dc: number | null;
  /** ms since epoch when the requests went out; older chat rolls never count. */
  sentAt: number;
  entries: RoundEntry[];
}

export function newRound(
  pick: RollPick,
  targets: { id: string; name: string }[],
  now: number
): Round {
  return {
    label: pickLabel(pick),
    dc: pickDc(pick),
    sentAt: now,
    entries: targets.map(t => ({ actorId: t.id, name: t.name, status: 'waiting' })),
  };
}

/** The parts of a chat message the matcher reads. */
export interface RollMessageLike {
  timestamp?: number;
  speaker?: { actor?: string | null };
  rolls?: ReadonlyArray<{ total?: number }>;
}

/**
 * Note a chat roll in the round: the first waiting entry of the speaking character, when the
 * message is newer than the ask and holds a roll. Returns whether the round changed.
 */
export function noteRoll(round: Round | null, message: RollMessageLike): boolean {
  if (!round) return false;
  const actorId = message.speaker?.actor;
  const total = message.rolls?.[0]?.total;
  if (!actorId || typeof total !== 'number' || !Number.isFinite(total)) return false;
  if ((message.timestamp ?? Date.now()) < round.sentAt) return false;
  const entry = round.entries.find(e => e.actorId === actorId && e.status === 'waiting');
  if (!entry) return false;
  entry.status = 'rolled';
  entry.total = total;
  return true;
}

/** What the bar needs to draw. */
export interface RollBarView {
  pick: RollPick;
  /** A sentence when sending is off (writes are off); the buttons are disabled and say why. */
  disabledReason: string;
  round: Round | null;
}

function optionHtml(value: string, label: string, selected: string): string {
  const sel = value === selected ? ' selected' : '';
  return `<option value="${escapeHtml(value)}"${sel}>${escapeHtml(label)}</option>`;
}

/** The label of the whole-party button: "Group save: Dexterity save" or "Ask everyone: Perception". */
export function groupButtonLabel(pick: RollPick): string {
  return `${isSave(pick) ? 'Group save' : 'Ask everyone'}: ${pickLabel(pick)}`;
}

/** The roll bar: the pick and the whole-party button. */
export function renderRollBarHtml(view: RollBarView, canSend: boolean): string {
  const { pick } = view;
  const groups = rollOptions()
    .map(
      g =>
        `<optgroup label="${escapeHtml(g.group)}">${g.options
          .map(o => optionHtml(o.value, o.label, pick.what))
          .join('')}</optgroup>`
    )
    .join('');
  const advantage = (['normal', 'advantage', 'disadvantage'] as const)
    .map(a =>
      optionHtml(
        a,
        a === 'normal' ? 'Normal' : a === 'advantage' ? 'Advantage' : 'Disadvantage',
        pick.advantage
      )
    )
    .join('');
  const off = canSend ? '' : ' disabled';
  const reason = view.disabledReason
    ? `<p class="fmb-ai-notice fmb-gm-roll-off">${escapeHtml(view.disabledReason)}</p>`
    : '';
  return `<section class="fmb-gm-rollbar" aria-label="Ask for a roll">
    <div class="fmb-gm-roll-fields">
      <select data-field="what" aria-label="Roll">${groups}</select>
      <input type="text" inputmode="numeric" maxlength="2" size="3" data-field="dc" value="${escapeHtml(pick.dc)}" placeholder="DC" aria-label="DC (optional)" />
      <select data-field="advantage" aria-label="Advantage">${advantage}</select>
      <label class="fmb-gm-roll-public"><input type="checkbox" data-field="isPublic"${pick.isPublic ? ' checked' : ''} /> Public</label>
    </div>
    <button type="button" class="fmb-ai-btn fmb-gm-ask-all" data-action="askAll"${off}>${escapeHtml(groupButtonLabel(pick))}</button>
    ${reason}
  </section>`;
}

/** The per-character button on a Party row. */
export function renderAskButtonHtml(
  id: string,
  name: string,
  pick: RollPick,
  canSend: boolean
): string {
  return `<button type="button" class="fmb-ai-btn fmb-gm-ask" data-action="askOne" data-actor-id="${escapeHtml(id)}" data-actor-name="${escapeHtml(name)}"${canSend ? '' : ' disabled'} title="Ask ${escapeHtml(name)} for ${escapeHtml(pickLabel(pick))}">Ask</button>`;
}

function entryText(entry: RoundEntry, dc: number | null): string {
  if (entry.status === 'failed') return `Not sent: ${entry.error ?? 'unknown error'}`;
  if (entry.status === 'waiting') return 'waiting';
  const total = entry.total ?? 0;
  if (dc === null) return String(total);
  return `${total} ${total >= dc ? 'passes' : 'fails'}`;
}

/** The results of the last ask, one line per character, filling in as the rolls come. */
export function renderRoundHtml(round: Round | null): string {
  if (!round) return '';
  const done = round.entries.filter(e => e.status === 'rolled').length;
  const head = `${escapeHtml(round.label)}${round.dc === null ? '' : ` DC ${round.dc}`}`;
  const rows = round.entries
    .map(e => {
      const cls = e.status === 'failed' ? ' fmb-ai-error' : '';
      const result =
        e.status === 'rolled' && round.dc !== null
          ? ` fmb-gm-${(e.total ?? 0) >= round.dc ? 'pass' : 'fail'}`
          : '';
      return `<li class="fmb-gm-result${result}${cls}" data-status="${e.status}"><strong>${escapeHtml(e.name)}</strong> <span>${escapeHtml(entryText(e, round.dc))}</span></li>`;
    })
    .join('');
  return `<section class="fmb-gm-round" aria-live="polite" aria-label="Roll results">
    <div class="fmb-gm-round-head"><strong>${head}</strong>
      <span class="fmb-gm-muted">${done} of ${round.entries.length} rolled</span>
      <button type="button" class="fmb-ai-btn" data-action="clearRound">Clear</button></div>
    <ul class="fmb-ai-list fmb-gm-list">${rows}</ul>
  </section>`;
}
