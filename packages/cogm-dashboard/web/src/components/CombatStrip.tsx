// The combat strip (D-092, I-070, I-095): the turn order in the During
// view's strip slot, one row per combatant in the bridge's order, with the Boss prompts switch and
// reaction ticks, and (GM Actions on) rows to pick and an action bar. Condition opens a row of
// condition chips (ConditionForm): a chip plans it with plan-actor-change, one confirm asks, the
// apply puts it on, with Undo. End combat plans, asks once and applies (lib/endCombat.ts, the same
// flow as the live strip's). Damage / Heal opens the small form (DamageForm), which plans and
// applies in one click with Undo; the roll row (StripRolls) asks players for checks and saves.
// Nothing here opens the Tool Runner. The rules are in lib/combat.ts; moments.css lays the strip
// out per During layout and fight.
//
// What is new: the reaction button is only on a living boss, the switch is there whenever Boss
// prompts is on (so it can be turned off), a fight shown while the bridge is away says so and its
// buttons are off, a reaction tick changes only its own button (the focus stays), rows can be
// picked with the keyboard, and the hit point bar has a text equivalent.
import { useQueryClient } from '@tanstack/react-query';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent,
} from 'react';
import { RibbonBoundary } from './RibbonBoundary';

import {
  AWAY_TEXT,
  NO_REACTIONS,
  NO_VALUE,
  SAMPLE_COMBAT,
  SIDE_LABEL,
  bossLine,
  bossPrompts,
  canSelect,
  deathSavesWords,
  hpPercent,
  hpText,
  hpTone,
  hpWords,
  metaText,
  pruneSelection,
  reactionLabel,
  reactionsFor,
  selectedTargets,
  showBossToggle,
  showDeathSaves,
  showReaction,
  sideOf,
  stripMode,
  toggleReaction,
  toggleSelection,
  livingBosses,
  type Combatant,
  type Pips,
  type Reactions,
  type SelectionAction,
} from '../lib/combat';
import { useEndCombat } from '../lib/endCombat';
import { useLivePlay, type LivePlay } from '../lib/livePlay';
import { chipText, displayNames } from '../lib/liveStrip';
import { offReason } from '../lib/liveSwitches';
import { refreshCombat, useBridgeAway, useCombat, useDashboardSettings } from '../lib/stream';
import { DelayedLoading, Panel, Pill } from '../ui';

import { TurnOnNote } from './TurnOnNote';

// The picker is a lazy chunk (bundle budget): it loads when no fight runs and GM Actions is on.
const StartCombat = lazy(() => import('./StartCombat').then(m => ({ default: m.StartCombat })));
// So are the Damage / Heal form and the roll row (first-load budget).
const DamageForm = lazy(() => import('./DamageForm').then(m => ({ default: m.DamageForm })));
const ConditionForm = lazy(() =>
  import('./ConditionForm').then(m => ({ default: m.ConditionForm }))
);
const AttackForm = lazy(() => import('./AttackForm').then(m => ({ default: m.AttackForm })));
const FoundryTargetsButton = lazy(() =>
  import('./FoundryTargetsButton').then(m => ({ default: m.FoundryTargetsButton }))
);
const StripRolls = lazy(() => import('./StripRolls').then(m => ({ default: m.StripRolls })));
// So is the initiative ribbon: it loads when a fight with somebody in it runs.
const InitiativeRibbon = lazy(() =>
  import('./InitiativeRibbon').then(m => ({ default: m.InitiativeRibbon }))
);

/**
 * End combat went in and the focus is still to move to the combat pane. Module level, not a ref:
 * the strip can be mounted again when the fight leaves the page, and the new one finishes the job.
 */
const focusAfterEnd = { until: 0, timers: [] as number[] };

/** How long after End combat went in the focus move may still happen (ms). */
const FOCUS_AFTER_END_MS = 10_000;

/** Cancels the focus checks still waiting (a fight is back on the page). */
function cancelFocusChecks(): void {
  for (const id of focusAfterEnd.timers) window.clearTimeout(id);
  focusAfterEnd.timers.length = 0;
}

/**
 * Where the focus goes once the fight is gone, only when it fell to the page: the combat pane, or,
 * when the layout hides the pane with no fight, the Start combat button, else the During bar
 * itself (not its first button, which is the layout switch).
 */
function focusAfterEndTarget(): void {
  const active = document.activeElement;
  if (active && active !== document.body) return;
  const pane = document.getElementById('pane-combat');
  const target =
    pane && pane.getBoundingClientRect().width > 0
      ? pane
      : (document.querySelector<HTMLElement>('#btn-during-start-combat, #btn-combat-start') ??
        document.getElementById('during-bar'));
  target?.focus();
}

/** Boss prompts is remembered per browser; off by default (D-081). */
const BOSS_PROMPTS_KEY = 'cogm_boss_prompts';

function readBossFlag(): boolean {
  try {
    return localStorage.getItem(BOSS_PROMPTS_KEY) === 'on';
  } catch {
    return false;
  }
}

function writeBossFlag(on: boolean): void {
  try {
    localStorage.setItem(BOSS_PROMPTS_KEY, on ? 'on' : 'off');
  } catch {
    // Storage is blocked: the switch works for this page load only.
  }
}

function PipsText({
  label,
  pips,
  className,
}: {
  label: string;
  pips: Pips;
  className: string;
}): JSX.Element {
  return (
    <>
      {label}{' '}
      <span className={`boss-pips ${className}`} aria-hidden="true">
        {pips.filled}
        {pips.empty}
      </span>{' '}
      {pips.remaining}/{pips.max}
    </>
  );
}

function BossLineView({ combatant }: { combatant: Combatant }): JSX.Element | null {
  const line = bossLine(true, combatant);
  if (!line) return null;
  const parts: JSX.Element[] = [];
  if (line.legendary) {
    parts.push(
      <PipsText key="l" label="Legendary" pips={line.legendary} className="pips-legendary" />
    );
  }
  if (line.resistances) {
    parts.push(<PipsText key="r" label="Resist" pips={line.resistances} className="pips-resist" />);
  }
  if (line.lair) {
    parts.push(
      <span key="a">
        <span aria-hidden="true">🏰</span> {line.lair}
      </span>
    );
  }
  return (
    <div className="boss-line">
      {parts.map((part, i) => (
        <span key={part.key}>
          {i > 0 && ' · '}
          {part}
        </span>
      ))}
    </div>
  );
}

interface RowProps {
  combatant: Combatant;
  /** The name as the row shows it ("Wolf 2" when two share one); data-name keeps the raw name. */
  shownName: string;
  selectable: boolean;
  selected: boolean;
  /** Boss prompts is on: the boss line and the reaction button. */
  bossFlag: boolean;
  reactionUsed: boolean;
  stale: boolean;
  onPick: () => void;
  onReaction: () => void;
  'data-track'?: string;
}

function CombatantRow({
  combatant: c,
  shownName,
  selectable,
  selected,
  bossFlag,
  reactionUsed,
  stale,
  onPick,
  onReaction,
  ...rest
}: RowProps): JSX.Element {
  const side = sideOf(c);
  const classes = ['combatant'];
  if (c.isCurrentTurn) classes.push('current');
  if (c.defeated) classes.push('defeated');
  if (selectable) classes.push('selectable');
  if (selected) classes.push('selected');
  const onRowClick = (e: MouseEvent<HTMLDivElement>): void => {
    // The R button has its own job; everything else on a row picks it.
    if ((e.target as Element).closest('.reaction-btn')) return;
    onPick();
  };
  return (
    <div
      role="listitem"
      className={classes.join(' ')}
      data-id={c.id}
      data-name={c.name}
      {...(c.isCurrentTurn ? { 'aria-current': 'true' as const } : {})}
      {...(selectable ? { onClick: onRowClick } : {})}
      {...rest}
    >
      <div className="init-badge">{c.initiative ?? NO_VALUE}</div>
      <div className="combatant-main">
        <div className="combatant-name">
          {selectable ? (
            <button type="button" className="combatant-pick" aria-pressed={selected}>
              {shownName}
            </button>
          ) : (
            <span className="combatant-text">{shownName}</span>
          )}
          {c.isCurrentTurn && (
            <span className="turn-pill" data-turn-pill>
              <span aria-hidden="true">▶ </span>Up now
            </span>
          )}
          {c.defeated && <span className="visually-hidden">defeated</span>}
          <span className={`side side-${side}`}>{SIDE_LABEL[side]}</span>
          {showReaction(bossFlag, c) && (
            <button
              type="button"
              className={`reaction-btn${reactionUsed ? ' used' : ''}`}
              data-track="dash.combat.reaction"
              data-reaction={c.id}
              aria-label={reactionLabel(shownName, reactionUsed)}
              aria-pressed={reactionUsed}
              aria-disabled={stale ? 'true' : undefined}
              title={
                reactionUsed
                  ? 'Reaction used this round (click to undo)'
                  : 'Mark reaction used this round'
              }
              onClick={() => {
                if (!stale) onReaction();
              }}
            >
              R
            </button>
          )}
        </div>
        {bossFlag && <BossLineView combatant={c} />}
        {c.conditions.length > 0 && (
          <div className="conditions">
            {c.conditions.map(cond => (
              <Pill key={cond} variant="condition">
                {chipText(cond, c.timed?.[cond])}
              </Pill>
            ))}
          </div>
        )}
        {showDeathSaves(c) && c.deathSaves && (
          <div className="death-saves">
            <span aria-hidden="true">
              Death saves ✓{c.deathSaves.successes} ✗{c.deathSaves.failures}
            </span>
            <span className="visually-hidden">Death saves: {deathSavesWords(c.deathSaves)}</span>
          </div>
        )}
      </div>
      <div className="hp">
        <div className="hp-text">{hpText(c.hp)}</div>
        <div
          className="hp-bar"
          role="meter"
          aria-label={`Hit points of ${c.name}`}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, c.hp.max)}
          aria-valuenow={Math.max(0, Math.min(c.hp.value, c.hp.max))}
          aria-valuetext={hpWords(c.hp)}
        >
          <div className={`hp-fill ${hpTone(c.hp)}`} style={{ width: `${hpPercent(c.hp)}%` }} />
        </div>
      </div>
    </div>
  );
}

/**
 * The action bar: a hint, or the count with Damage / Heal, Condition and Clear. While the bridge
 * is away the buttons stay in place (and keep the focus) but do nothing.
 */
function ActionBar({
  count,
  stale,
  onAct,
  onAttack,
  onClear,
  onEnd,
  ending,
  busy,
  combatants,
  onPick,
}: {
  count: number;
  stale: boolean;
  /** Another write from the strip runs: the buttons that start one wait. */
  busy: boolean;
  /** End combat's write runs (after the GM said yes): the button says so. */
  ending: boolean;
  onAct: (action: SelectionAction) => void;
  onAttack: () => void;
  onClear: () => void;
  onEnd: () => void;
  combatants: ReadonlyArray<Combatant>;
  /** Replace the pick with the combatants whose tokens are targeted (else selected) in Foundry. */
  onPick: (ids: string[]) => void;
}): JSX.Element {
  const off = stale ? ('true' as const) : undefined;
  const away = stale ? 'The bridge is away' : undefined;
  // A write that starts a change waits for the one that runs (the strip lock drops a second click).
  const writeOff = stale || busy ? ('true' as const) : undefined;
  const writeTitle = stale ? away : busy ? 'Another change is running' : undefined;
  // Held here, not in the button: the button remounts when the pick goes from none to some.
  const [targetsNote, setTargetsNote] = useState('');
  const foundryButton = (
    <Suspense fallback={null}>
      <FoundryTargetsButton
        combatants={combatants}
        stale={stale}
        onPick={onPick}
        note={targetsNote}
        onNote={setTargetsNote}
      />
    </Suspense>
  );
  const attackButton = (
    <button
      type="button"
      className="ca-btn"
      data-track="dash.combat.attack"
      data-sel="attack"
      aria-disabled={off}
      title={away}
      onClick={() => {
        if (!stale) onAttack();
      }}
    >
      Attack
    </button>
  );
  const endButton = (
    <button
      type="button"
      className="ca-btn ghost"
      data-track="dash.combat.end"
      data-sel="end"
      aria-disabled={writeOff}
      aria-busy={ending ? 'true' : undefined}
      title={
        (ending ? away : writeTitle) ??
        'Plan ending this fight; you confirm it, and Undo brings it back'
      }
      onClick={() => {
        if (!stale && !busy) onEnd();
      }}
    >
      {ending ? 'Ending...' : 'End combat'}
    </button>
  );
  if (count === 0) {
    return (
      <div className="ca-row">
        <span className="ca-hint">Click combatants to deal damage or set a condition on them.</span>
        {attackButton}
        {foundryButton}
        {endButton}
      </div>
    );
  }
  return (
    <div className="ca-row">
      <span className="ca-count">
        <strong>{count}</strong> selected
      </span>
      <button
        type="button"
        className="ca-btn"
        data-track="dash.combat.selection-damage"
        data-sel="damage"
        aria-disabled={writeOff}
        title={writeTitle}
        onClick={() => {
          if (!stale && !busy) onAct('damage');
        }}
      >
        Damage / Heal
      </button>
      {attackButton}
      <button
        type="button"
        className="ca-btn"
        data-track="dash.combat.selection-condition"
        data-sel="condition"
        aria-disabled={writeOff}
        title={writeTitle}
        onClick={() => {
          if (!stale && !busy) onAct('condition');
        }}
      >
        Condition
      </button>
      <button
        type="button"
        className="ca-btn ghost"
        data-track="dash.combat.selection-clear"
        data-sel="clear"
        aria-disabled={off}
        title={away}
        onClick={() => {
          if (!stale) onClear();
        }}
      >
        Clear
      </button>
      {foundryButton}
      {endButton}
    </div>
  );
}

/**
 * A strip control that live play being off disables: the button stays, greyed out, with the reason
 * and a Turn on next to it (one click, the same as Start session's).
 */
function GatedRow({
  live,
  off,
  label,
  hint,
}: {
  live: LivePlay;
  off: string[];
  label: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="ca-row" data-gated={label}>
      {hint ? <span className="ca-hint">{hint}</span> : null}
      <button type="button" className="ca-btn ghost" aria-disabled="true" title={offReason(off)}>
        {label}
      </button>
      <TurnOnNote live={live} off={off} />
    </div>
  );
}

/**
 * The strip. It is in the page all the time and the During layouts show it (moments.css): while a
 * fight runs, and in Full. `sample` shows the layout trial's made-up fight when no real one runs.
 */
export function CombatStrip({ sample = false }: { sample?: boolean }): JSX.Element {
  const real = useCombat();
  const away = useBridgeAway();
  const live = useLivePlay();
  const liveOff = live.off();
  const settings = useDashboardSettings();
  const [bossFlag, setBossFlag] = useState(readBossFlag);
  const [reactions, setReactions] = useState<Reactions>(NO_REACTIONS);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [damageOpen, setDamageOpen] = useState(false);
  const [conditionOpen, setConditionOpen] = useState(false);
  const queryClient = useQueryClient();
  const planEnd = useEndCombat();
  // One write at a time from the strip (End combat, a condition, Damage / Heal), as on the live
  // strip: a second click while one runs does nothing.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const awayRef = useRef(false);
  awayRef.current = away;
  const once = useCallback(
    async (work: () => Promise<void>): Promise<void> => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await work();
      } finally {
        // Read the fight at once: the rows show the change now, not at the next poll.
        if (!awayRef.current) await refreshCombat(queryClient);
        busyRef.current = false;
        setBusy(false);
        setEnding(false);
      }
    },
    [queryClient]
  );
  const [attackOpen, setAttackOpen] = useState(false);

  // End combat went in: once the fight has left the page its bar is gone, and the focus goes to the
  // pane (after the confirm window gave it back to the button that is about to unmount).
  const fightGone = real === null;
  useEffect(() => {
    // The wish expires: an End combat that did not end the fight must not move the focus at the
    // end of a later one. A fight on the page cancels the checks still waiting.
    if (!fightGone) {
      cancelFocusChecks();
      return;
    }
    if (focusAfterEnd.until > Date.now()) {
      focusAfterEnd.until = 0;
      // The confirm window gives focus back to the unmounting button a moment later: take it
      // again if it fell to the page.
      focusAfterEndTarget();
      focusAfterEnd.timers.push(
        window.setTimeout(focusAfterEndTarget, 150),
        window.setTimeout(focusAfterEndTarget, 500)
      );
    }
  }, [fightGone, ending, busy]);

  const showSample = sample && real === null;
  const combat = showSample ? SAMPLE_COMBAT : real;
  const mode = showSample ? 'live' : stripMode(real, away);
  const stale = mode === 'stale';
  const selectable = canSelect({
    gmActions: settings?.gmActionsEnabled === true,
    fightActive: combat !== null,
    sample: showSample,
  });

  // A pick lasts while the fight and the switches allow it; ids that left the fight drop out.
  const kept = pruneSelection(picked, combat, selectable);
  if (kept !== picked) setPicked(kept);

  // The Damage / Heal form closes with the pick it was opened for.
  const showDamage = damageOpen && kept.size > 0 && selectable;
  // Clear, an emptied pick or GM Actions going off close it for good: it must not reopen with the
  // next pick.
  if (damageOpen && !showDamage) setDamageOpen(false);
  // The Condition picker the same way.
  const showCondition = conditionOpen && kept.size > 0 && selectable;
  if (conditionOpen && !showCondition) setConditionOpen(false);
  // The Attack form needs no pick; GM Actions going off or the fight ending closes it.
  const showAttack = attackOpen && selectable;
  if (attackOpen && !showAttack) setAttackOpen(false);
  const pickedRows = (combat?.combatants ?? []).filter(c => kept.has(c.id));
  // Two Wolves read "Wolf 1" and "Wolf 2" in the questions, numbered across the whole fight.
  const shownNames = displayNames(combat?.combatants ?? []);
  const pickedNames = pickedRows.map(c => shownNames.get(c.id) ?? c.name);
  const partyRows = (combat?.combatants ?? []).filter(c => c.isPC && !c.defeated);
  const used = combat ? reactionsFor(reactions, combat.round) : NO_REACTIONS.used;
  const prompts = bossPrompts(combat);
  const toggleShown = showBossToggle(bossFlag, combat);
  const rows = combat?.combatants ?? [];
  const hasControls = selectable || rows.some(c => showReaction(bossFlag, c));

  const setFlag = (on: boolean): void => {
    // Turning it off with no boss in the fight hides the switch itself: the focus goes to the pane.
    if (!on && livingBosses(combat).length === 0) document.getElementById('pane-combat')?.focus();
    setBossFlag(on);
    writeBossFlag(on);
  };

  const rowProps = (c: Combatant): RowProps => ({
    combatant: c,
    shownName: shownNames.get(c.id) ?? c.name,
    selectable,
    selected: kept.has(c.id),
    bossFlag,
    reactionUsed: used.has(c.id),
    stale,
    onPick: () => setPicked(toggleSelection(kept, c.id)),
    onReaction: () => combat && setReactions(r => toggleReaction(r, combat.round, c.id)),
  });

  return (
    <Panel
      id="pane-combat"
      tabIndex={-1}
      className={stale ? 'is-stale' : undefined}
      title="Combat Tracker"
      titleId="combat-title"
      aria-labelledby="combat-title"
      status={<span id="combat-meta">{metaText(combat)}</span>}
      actions={
        <button
          type="button"
          className={`link-btn${bossFlag ? ' on' : ''}`}
          id="boss-toggle"
          data-track="dash.combat.boss-prompts"
          title="Legendary actions, lair reminder and reaction ticks (dashboard only, no writes)"
          hidden={!toggleShown}
          onClick={() => setFlag(!bossFlag)}
        >
          {bossFlag ? '👑 Boss prompts: on' : '👑 Boss prompts: off'}
        </button>
      }
      lead={
        <>
          {/* Always in the page, so a screen reader hears it when the text arrives. */}
          <p className="strip-away" id="combat-away" role="status">
            {stale ? AWAY_TEXT : ''}
          </p>
          {combat !== null && combat.combatants.length > 0 && (
            <RibbonBoundary>
              <Suspense fallback={null}>
                <InitiativeRibbon combat={combat} />
              </Suspense>
            </RibbonBoundary>
          )}
          <div
            className="boss-prompts"
            id="boss-prompts"
            hidden={prompts.length === 0 || !bossFlag}
          >
            {bossFlag &&
              prompts.map(p => (
                <div key={p.key} className={`boss-prompt prompt-${p.kind}`}>
                  <span aria-hidden="true">{p.icon}</span> {p.text}
                </div>
              ))}
          </div>
          {real === null &&
            !showSample &&
            (liveOff.length === 0 ? (
              <Suspense fallback={<DelayedLoading as="div" />}>
                <StartCombat />
              </Suspense>
            ) : (
              <GatedRow live={live} off={liveOff} label="Start combat" />
            ))}
          {combat !== null && !showSample && !selectable && (
            <GatedRow
              live={live}
              off={liveOff}
              label="End combat"
              hint="Damage, conditions and rolls on the combatants need GM Actions."
            />
          )}
          <div className="combat-actions" id="combat-actions" hidden={!selectable}>
            {selectable && (
              <ActionBar
                count={kept.size}
                stale={stale}
                busy={busy}
                onAct={action => {
                  const targets = selectedTargets(combat, kept);
                  if (busy || targets.length === 0) return;
                  // One form at a time under the bar.
                  setDamageOpen(action === 'damage');
                  setConditionOpen(action === 'condition');
                }}
                onAttack={() => setAttackOpen(true)}
                onClear={() => setPicked(new Set())}
                onEnd={() => {
                  let applied = false;
                  void once(async () => {
                    // The fight is over and the bar unmounts with it: focus would drop to the page.
                    // The effect above moves it if the fight is only gone from the page later.
                    applied = await planEnd(() => setEnding(true));
                    if (applied) focusAfterEnd.until = Date.now() + FOCUS_AFTER_END_MS;
                  }).then(() => {
                    // The fight was read again before the lock dropped: the bar is gone now.
                    if (applied) {
                      requestAnimationFrame(focusAfterEndTarget);
                    }
                  });
                }}
                ending={ending}
                combatants={combat?.combatants ?? []}
                onPick={ids => setPicked(new Set(ids))}
              />
            )}
          </div>
          {showCondition && (
            <Suspense fallback={<DelayedLoading as="div" />}>
              <ConditionForm
                targets={selectedTargets(combat, kept)}
                names={pickedNames}
                stale={stale}
                locked={busy}
                once={once}
                onClose={() => {
                  setConditionOpen(false);
                  // The picker's buttons unmount with it: put focus back on the one that opened it.
                  requestAnimationFrame(() =>
                    document.querySelector<HTMLElement>('[data-sel="condition"]')?.focus()
                  );
                }}
              />
            </Suspense>
          )}
          {showDamage && (
            <Suspense fallback={<DelayedLoading as="div" />}>
              <DamageForm
                targets={selectedTargets(combat, kept)}
                names={pickedNames}
                stale={stale}
                locked={busy}
                once={once}
                onClose={() => {
                  setDamageOpen(false);
                  // The form's own button unmounts with it: put focus back on the one that opened it.
                  requestAnimationFrame(() =>
                    document.querySelector<HTMLElement>('[data-sel="damage"]')?.focus()
                  );
                }}
              />
            </Suspense>
          )}
          {showAttack && (
            <Suspense fallback={<DelayedLoading as="div" />}>
              <AttackForm
                combatants={combat?.combatants ?? []}
                picked={pickedRows.map(c => c.id)}
                stale={stale}
                locked={busy}
                once={once}
                onClose={() => {
                  setAttackOpen(false);
                  // The form's own button unmounts with it: put focus back on the one that opened it.
                  requestAnimationFrame(() =>
                    document.querySelector<HTMLElement>('[data-sel="attack"]')?.focus()
                  );
                }}
              />
            </Suspense>
          )}
          {combat !== null && !showSample && (
            <Suspense fallback={<DelayedLoading as="div" />}>
              <StripRolls party={partyRows} picked={pickedRows.filter(c => c.isPC)} stale={stale} />
            </Suspense>
          )}
        </>
      }
      bodyId="combat-body"
      {...(rows.length > 0
        ? {
            bodyProps: {
              role: 'list',
              'aria-label': 'Combat order',
              // The row scrolls sideways on a narrow screen; with nothing in it to Tab to, the
              // keyboard needs the list itself to scroll it.
              ...(hasControls ? {} : { tabIndex: 0 }),
            },
          }
        : {
            state: 'empty' as const,
            stateMessage: combat ? 'No combatants in this fight.' : 'No active combat.',
          })}
    >
      {rows.map(c =>
        selectable ? (
          <CombatantRow key={c.id} {...rowProps(c)} data-track="dash.combat.select-combatant" />
        ) : (
          <CombatantRow key={c.id} {...rowProps(c)} />
        )
      )}
    </Panel>
  );
}
