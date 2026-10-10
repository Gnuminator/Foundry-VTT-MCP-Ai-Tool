// The combat strip (D-092, I-070, I-095), ported from the old page: the turn order in the During
// view's strip slot, one row per combatant in the bridge's order, with the Boss prompts switch and
// reaction ticks, and (Combat buttons and GM Actions on) rows to pick and an action bar whose
// Damage / Heal and Condition open the Tool runner on plan-actor-change for the picked names. It
// never writes: the plan, confirm and undo flow is the Tool runner's. The rules are in
// lib/combat.ts; moments.css lays the strip out per During layout and fight.
//
// What is new: the reaction button is only on a living boss, the switch is there whenever Boss
// prompts is on (so it can be turned off), a fight shown while the bridge is away says so and its
// buttons are off, a reaction tick changes only its own button (the focus stays), rows can be
// picked with the keyboard, and the hit point bar has a text equivalent.
import { useState, type JSX, type MouseEvent } from 'react';

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
  planRequest,
  pruneSelection,
  reactionLabel,
  reactionsFor,
  selectedNames,
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
import { usePrefs } from '../lib/prefs';
import { useBridgeAway, useCombat, useDashboardSettings } from '../lib/stream';
import { Panel, Pill } from '../ui';

/** The tool runner's request: a tool and the form's starting values. */
export interface StripToolRequest {
  name: string;
  prefill: Record<string, unknown>;
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
              {c.name}
            </button>
          ) : (
            <span className="combatant-text">{c.name}</span>
          )}
          {(c.defeated || c.isCurrentTurn) && (
            <span className="visually-hidden">
              {[c.isCurrentTurn && 'current turn', c.defeated && 'defeated']
                .filter(Boolean)
                .join(', ')}
            </span>
          )}
          <span className={`side side-${side}`}>{SIDE_LABEL[side]}</span>
          {showReaction(bossFlag, c) && (
            <button
              type="button"
              className={`reaction-btn${reactionUsed ? ' used' : ''}`}
              data-track="dash.combat.reaction"
              data-reaction={c.id}
              aria-label={reactionLabel(c.name, reactionUsed)}
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
                {cond}
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
  onClear,
}: {
  count: number;
  stale: boolean;
  onAct: (action: SelectionAction) => void;
  onClear: () => void;
}): JSX.Element {
  if (count === 0) {
    return (
      <div className="ca-row">
        <span className="ca-hint">Click combatants to deal damage or set a condition on them.</span>
      </div>
    );
  }
  const off = stale ? ('true' as const) : undefined;
  const away = stale ? 'The bridge is away' : undefined;
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
        aria-disabled={off}
        title={away}
        onClick={() => {
          if (!stale) onAct('damage');
        }}
      >
        Damage / Heal
      </button>
      <button
        type="button"
        className="ca-btn"
        data-track="dash.combat.selection-condition"
        data-sel="condition"
        aria-disabled={off}
        title={away}
        onClick={() => {
          if (!stale) onAct('condition');
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
    </div>
  );
}

/**
 * The strip. It is in the page all the time and the During layouts show it (moments.css): while a
 * fight runs, and in Full. `sample` shows the layout trial's made-up fight when no real one runs.
 */
export function CombatStrip({
  sample = false,
  onOpenTool,
}: {
  sample?: boolean;
  onOpenTool: (request: StripToolRequest) => void;
}): JSX.Element {
  const real = useCombat();
  const away = useBridgeAway();
  const prefs = usePrefs();
  const settings = useDashboardSettings();
  const [bossFlag, setBossFlag] = useState(readBossFlag);
  const [reactions, setReactions] = useState<Reactions>(NO_REACTIONS);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const showSample = sample && real === null;
  const combat = showSample ? SAMPLE_COMBAT : real;
  const mode = showSample ? 'live' : stripMode(real, away);
  const stale = mode === 'stale';
  const selectable = canSelect({
    combatButtons: prefs?.combatButtons === true,
    gmActions: settings?.gmActionsEnabled === true,
    fightActive: combat !== null,
    sample: showSample,
  });

  // A pick lasts while the fight and the switches allow it; ids that left the fight drop out.
  const kept = pruneSelection(picked, combat, selectable);
  if (kept !== picked) setPicked(kept);

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
          <div className="combat-actions" id="combat-actions" hidden={!selectable}>
            {selectable && (
              <ActionBar
                count={kept.size}
                stale={stale}
                onAct={action => {
                  const names = selectedNames(combat, kept);
                  if (names.length > 0) onOpenTool(planRequest(action, names));
                }}
                onClear={() => setPicked(new Set())}
              />
            )}
          </div>
        </>
      }
      bodyId="combat-body"
      {...(rows.length > 0
        ? {
            bodyProps: {
              role: 'list',
              'aria-label': 'Turn order',
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
