/**
 * The "Combat" GM window (I-134): the dashboard's combat strip inside Foundry. The turn order
 * with the round, whose turn it is, hit points (and temporary), conditions and defeated or
 * hidden marks, plus Previous and Next turn buttons that call Foundry's own combat methods as
 * the GM (the same as the combat tracker's arrows; nothing goes through the AI Tool).
 *
 * {@link buildCombatView} and {@link renderCombatHtml} are pure, so the rows and the escaping are
 * tested without Foundry; {@link openCombatWindow} wires them to the window shell.
 */
import { escapeHtml } from './ai-changes-model.js';
import { createPanelWindow } from './gm-windows.js';

/** The parts of a combatant the strip reads (Foundry's `Combatant`, structurally). */
export interface CombatantLike {
  id?: string;
  name?: string;
  initiative?: number | null;
  isDefeated?: boolean;
  hidden?: boolean;
  actor?: {
    system?: { attributes?: { hp?: { value?: number; max?: number; temp?: number } } };
    statuses?: Iterable<string>;
  } | null;
}

/** The parts of a combat the strip reads (Foundry's `Combat`, structurally). */
export interface CombatLike {
  round?: number;
  turn?: number | null;
  started?: boolean;
  turns?: CombatantLike[];
  scene?: { name?: string } | null;
}

export interface CombatRow {
  id: string;
  name: string;
  initiative: string;
  current: boolean;
  defeated: boolean;
  hidden: boolean;
  /** "23/40 (+5)" or empty when the actor has no hit points. */
  hp: string;
  /** 0 to 100, for the bar; null with no hit points. */
  hpPercent: number | null;
  conditions: string[];
}

export interface CombatView {
  /** No combat at all, or one with nobody in it. */
  empty: boolean;
  started: boolean;
  round: number;
  sceneName: string;
  rows: CombatRow[];
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

/** "bloodied" or "half_cover" to "Bloodied" / "Half cover". */
export function conditionLabel(id: string): string {
  const text = id.replace(/[-_]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/** What the strip shows for one combat (null: no active combat). */
export function buildCombatView(combat: CombatLike | null | undefined): CombatView {
  const turns = combat?.turns ?? [];
  const currentIndex = combat?.started === true ? whole(combat.turn) : null;
  const rows = turns.map((c, index): CombatRow => {
    const hp = c.actor?.system?.attributes?.hp;
    const value = whole(hp?.value);
    const max = whole(hp?.max);
    const temp = whole(hp?.temp) ?? 0;
    const hasHp = value !== null && max !== null && max > 0;
    const statuses = c.actor?.statuses ? Array.from(c.actor.statuses) : [];
    return {
      id: c.id ?? '',
      name: c.name || 'Unknown',
      initiative: typeof c.initiative === 'number' ? String(c.initiative) : '-',
      current: index === currentIndex,
      defeated: c.isDefeated === true,
      hidden: c.hidden === true,
      hp: hasHp ? `${value}/${max}${temp > 0 ? ` (+${temp})` : ''}` : '',
      hpPercent: hasHp ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : null,
      conditions: statuses.map(conditionLabel).filter(Boolean),
    };
  });
  return {
    empty: rows.length === 0,
    started: combat?.started === true,
    round: whole(combat?.round) ?? 0,
    sceneName: combat?.scene?.name ?? '',
    rows,
  };
}

/** The strip's HTML; every name and condition is escaped. */
export function renderCombatHtml(view: CombatView): string {
  if (view.empty) {
    return '<p class="fmb-ai-notice fmb-gm-empty">No combat is running. Start one from the combat tracker, and it shows here.</p>';
  }
  const head = view.started ? `Round ${view.round}` : 'Not started yet';
  const scene = view.sceneName
    ? ` <span class="fmb-gm-muted">${escapeHtml(view.sceneName)}</span>`
    : '';
  const buttons = view.started
    ? `<button type="button" class="fmb-ai-btn" data-action="previousTurn">Previous turn</button>
       <button type="button" class="fmb-ai-btn" data-action="nextTurn">Next turn</button>`
    : '';
  const rows = view.rows
    .map(row => {
      const classes = ['fmb-gm-row'];
      if (row.current) classes.push('fmb-gm-current');
      if (row.defeated) classes.push('fmb-gm-defeated');
      const marks = [row.defeated ? 'Defeated' : '', row.hidden ? 'Hidden' : '']
        .filter(Boolean)
        .map(m => `<span class="fmb-ai-tag">${m}</span>`)
        .join(' ');
      const bar =
        row.hpPercent === null
          ? ''
          : `<span class="fmb-gm-bar" role="img" aria-label="${escapeHtml(row.hp)} hit points"><span style="width:${row.hpPercent}%"></span></span>`;
      const conditions = row.conditions
        .map(c => `<span class="fmb-ai-tag">${escapeHtml(c)}</span>`)
        .join(' ');
      return `<li class="${classes.join(' ')}" data-combatant="${escapeHtml(row.id)}"${row.current ? ' aria-current="true"' : ''}>
        <span class="fmb-gm-init">${escapeHtml(row.initiative)}</span>
        <span class="fmb-gm-main"><strong>${escapeHtml(row.name)}</strong> ${marks}
          <span class="fmb-gm-sub">${bar}<span class="fmb-gm-hp">${escapeHtml(row.hp)}</span></span>
          ${conditions ? `<span class="fmb-gm-sub">${conditions}</span>` : ''}</span>
      </li>`;
    })
    .join('');
  return `<div class="fmb-ai-toolbar"><span><strong>${head}</strong>${scene}</span><span>${buttons}</span></div>
    <ol class="fmb-ai-list fmb-gm-list">${rows}</ol>`;
}

interface LiveCombat extends CombatLike {
  nextTurn?(): Promise<unknown>;
  previousTurn?(): Promise<unknown>;
}

function activeCombat(): LiveCombat | null {
  const combats = game.combats as unknown as { active?: LiveCombat | null } | undefined;
  return combats?.active ?? null;
}

const panel = createPanelWindow({
  id: 'fmb-gm-combat',
  title: 'Combat',
  icon: 'fa-solid fa-swords',
  width: 380,
  height: 520,
  hooks: [
    'createCombat',
    'updateCombat',
    'deleteCombat',
    'createCombatant',
    'updateCombatant',
    'deleteCombatant',
    'updateActor',
    'canvasReady',
  ],
  render: () => renderCombatHtml(buildCombatView(activeCombat())),
  actions: {
    nextTurn: async () => {
      await activeCombat()?.nextTurn?.();
    },
    previousTurn: async () => {
      await activeCombat()?.previousTurn?.();
    },
  },
});

/** Open the "Combat" window (one per browser). */
export const openCombatWindow = (): Promise<boolean> => panel.open();

/** Forget the window (tests). */
export const resetCombatWindowForTests = (): void => panel.reset();
