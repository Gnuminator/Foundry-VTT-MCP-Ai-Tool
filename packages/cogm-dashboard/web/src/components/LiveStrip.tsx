// The live strip (item live-strip-component): the one component live screen A (the dashboard) and
// screen B (a Foundry window) both draw. One combat row of creature cards with the portrait
// leading each, an always-present pick bar (Damage / Heal inline, condition chips), the roll bar,
// Show next handout, and Next turn / End combat / Undo in the header. Every write goes through the
// guarded path in lib/guarded.ts (gate, plan, confirm, Undo toast); nothing here is a Tool runner.
// The words and small rules are in lib/liveStrip.ts.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useRef, useState, type JSX } from 'react';

import { callTool, errorText } from '../lib/api';
import { AWAY_TEXT, NO_VALUE, canSelect, hpPercent, hpText, hpTone, metaText } from '../lib/combat';
import type { Combatant } from '../lib/combat';
import { AI_LIMIT, readAiChanges } from '../lib/changes';
import { GAME_STATE_KEY, mayHaveApplied, useGuardedTools } from '../lib/guarded';
import { useLivePlay } from '../lib/livePlay';
import { HANDOUT_NEEDS, ROLL_NEEDS, offReason } from '../lib/liveSwitches';
import {
  CONDITIONS,
  conditionArgs,
  displayNames,
  downWords,
  endQuestion,
  lastUndoable,
  pickText,
  undoLabel,
} from '../lib/liveStrip';
import { initialsOf } from '../lib/ribbon';
import { sideOf } from '../lib/combat';
import {
  CHANGES_KEY,
  HANDOUTS_KEY,
  useBridgeAway,
  useCombat,
  useDashboardSettings,
} from '../lib/stream';
import { Button } from '../ui';
import { focusedElement, useConfirm } from './ConfirmDialog';
import { QuickRollBar, useQuickRoll } from './QuickRoll';
import { useToast } from './Toasts';
import { TurnOnNote } from './TurnOnNote';
import { loadHandouts, nextQueued } from '../panels/Handouts';
import styles from './LiveStrip.module.css';

// The picker and the Damage / Heal form are lazy chunks, as on the combat strip (bundle budget).
const StartCombat = lazy(() => import('./StartCombat').then(m => ({ default: m.StartCombat })));
const DamageForm = lazy(() => import('./DamageForm').then(m => ({ default: m.DamageForm })));

const AI_KEY = [...CHANGES_KEY, 'ai'] as const;

/** An error text with its full stop, so a hint can follow it. */
const sentence = (text: string): string => {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

function Card({
  c,
  name,
  picked,
  selectable,
  stale,
  onPick,
}: {
  c: Combatant;
  name: string;
  picked: boolean;
  selectable: boolean;
  stale: boolean;
  onPick: () => void;
}): JSX.Element {
  const toast = useToast();
  const [broken, setBroken] = useState<string | null>(null);
  const side = sideOf(c);
  const down = downWords(c);
  const pan = (): void => {
    if (!c.tokenUuid) return;
    callTool('open-in-foundry', { uuid: c.tokenUuid, pan: true }).catch((err: unknown) =>
      toast(`✗ Could not pan to ${name}: ${errorText(err)}`, 'err')
    );
  };
  const face =
    c.img && broken !== c.img ? (
      <img src={c.img} alt="" loading="lazy" draggable={false} onError={() => setBroken(c.img)} />
    ) : (
      initialsOf(name)
    );
  const tone = hpTone(c.hp);
  return (
    <li
      className={styles['card']}
      data-id={c.id}
      data-side={side}
      data-current={c.isCurrentTurn ? 'true' : undefined}
      data-picked={picked ? 'true' : undefined}
      data-down={down ? 'true' : undefined}
      {...(c.isCurrentTurn ? { 'aria-current': 'true' as const } : {})}
    >
      {c.tokenUuid ? (
        <button
          type="button"
          className={styles['portrait']}
          onClick={pan}
          aria-label={`Pan to ${name}`}
          data-track="dash.live.pan"
        >
          {face}
        </button>
      ) : (
        <span className={styles['portrait']} aria-hidden="true">
          {face}
        </span>
      )}
      {selectable ? (
        <button
          type="button"
          className={styles['pick']}
          aria-pressed={picked}
          aria-disabled={stale ? 'true' : undefined}
          data-track="dash.live.pick"
          onClick={() => {
            if (!stale) onPick();
          }}
        >
          {name}
        </button>
      ) : (
        <span className={styles['pick']}>{name}</span>
      )}
      <span className={styles['hpText']}>
        {c.initiative ?? NO_VALUE} · {hpText(c.hp)}
      </span>
      <span
        className={styles['hpBar']}
        role="meter"
        aria-label={`Hit points of ${name}`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, c.hp.max)}
        aria-valuenow={Math.max(0, Math.min(c.hp.value, c.hp.max))}
      >
        <span
          className={`${styles['hpFill']} ${tone ? styles[tone] : ''}`}
          style={{ width: `${hpPercent(c.hp)}%` }}
        />
      </span>
      <span className={styles['chips']}>
        {down && <span className={`${styles['tag']} ${styles['down']}`}>{down}</span>}
        {c.conditions.map(cond => (
          <span key={cond} className={styles['tag']}>
            {cond}
          </span>
        ))}
      </span>
    </li>
  );
}

export function LiveStrip(): JSX.Element {
  const combat = useCombat();
  const away = useBridgeAway();
  const live = useLivePlay();
  const liveOff = live.off();
  const settings = useDashboardSettings();
  const toast = useToast();
  const queryClient = useQueryClient();
  const askConfirm = useConfirm();
  const { plan, gated, applyApproved } = useGuardedTools();
  const roll = useQuickRoll();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [lastAsked, setLastAsked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);

  const stale = away && combat !== null;
  const rows = combat?.combatants ?? [];
  const selectable = canSelect({
    gmActions: settings?.gmActionsEnabled === true,
    fightActive: combat !== null,
    sample: false,
  });
  const names = displayNames(rows);
  // Ids that left the fight, or a switch going off, drop out of the pick.
  const kept = selectable ? new Set([...picked].filter(id => names.has(id))) : new Set<string>();
  if (kept.size !== picked.size) setPicked(kept);
  const pickedRows = rows.filter(c => kept.has(c.id));
  const pickedNames = pickedRows.map(c => names.get(c.id) ?? c.name);
  const targets = pickedRows.map(c => c.tokenId ?? c.name);
  const party = rows.filter(c => c.isPC && !c.defeated);
  const pickedPcs = pickedRows.filter(c => c.isPC);

  const changes = useQuery({
    queryKey: AI_KEY,
    queryFn: async () => readAiChanges(await callTool('list-recent-changes', { limit: AI_LIMIT })),
    retry: false,
  });
  const handouts = useQuery({
    queryKey: HANDOUTS_KEY,
    queryFn: loadHandouts,
    staleTime: 15_000,
    retry: false,
  });

  /** One write at a time: a second click while one runs does nothing. */
  const once = useCallback(async (work: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  /** Clears the pick and hands keyboard focus to the pick bar, whose Clear / form just went. */
  const clearPick = useCallback((): void => {
    setPicked(new Set());
    requestAnimationFrame(() => barRef.current?.focus());
  }, []);

  const nextTurn = (): Promise<void> =>
    once(async () => {
      if (gated('advance-combat-turn')) return;
      try {
        await callTool('advance-combat-turn', {}, { confirm: true });
        void queryClient.invalidateQueries({ queryKey: GAME_STATE_KEY });
      } catch (err) {
        toast(
          `✗ Next turn: ${mayHaveApplied(err) ? `${sentence(errorText(err))} It may have applied; check the tracker.` : errorText(err)}`,
          'err'
        );
      }
    });

  const endCombat = (): Promise<void> =>
    once(async () => {
      const from = focusedElement();
      if (gated('plan-combat-change')) return;
      let planned: { planId?: unknown; summary?: unknown; warning?: unknown } | null;
      try {
        planned = await callTool<typeof planned>('plan-combat-change', {
          action: 'end',
        });
      } catch (err) {
        toast(`✗ End combat: ${errorText(err)}`, 'err');
        return;
      }
      const planId = typeof planned?.planId === 'string' ? planned.planId : '';
      if (!planId) {
        toast('✗ End combat: the bridge made no plan', 'err');
        return;
      }
      const ok = await askConfirm({
        title: 'End combat',
        summary: endQuestion(
          typeof planned?.summary === 'string' ? planned.summary : null,
          typeof planned?.warning === 'string' ? planned.warning : null
        ),
        diff: [],
        compact: true,
        confirmLabel: 'End combat',
        destructive: false,
        returnTo: from,
      });
      if (!ok) return;
      await applyApproved(planId, true);
    });

  const addCondition = (condition: string): Promise<void> =>
    once(async () => {
      if (targets.length === 0) return;
      const done = await plan('plan-actor-change', conditionArgs(targets, condition));
      if (done.status === 'done') clearPick();
    });

  const undoable = lastUndoable(changes.data ?? []);
  const undo = (): Promise<void> =>
    once(async () => {
      if (!undoable || gated('undo-change')) return;
      const from = focusedElement();
      const destructive = undoable.risk === 'destructive';
      const ok = await askConfirm({
        title: 'Undo',
        summary: `Undo ${undoable.summary}?`,
        diff: [],
        compact: true,
        confirmLabel: 'Undo',
        destructive,
        returnTo: from,
      });
      if (!ok) return;
      try {
        await callTool(
          'undo-change',
          { changeId: undoable.changeId },
          { confirm: true, confirmDestructive: true }
        );
        toast(`✓ Undone: ${undoable.summary}`, 'ok');
      } catch (err) {
        toast(
          `✗ Undo: ${mayHaveApplied(err) ? `${sentence(errorText(err))} It may have applied; check Recent Changes.` : errorText(err)}`,
          'err'
        );
      } finally {
        void queryClient.invalidateQueries({ queryKey: GAME_STATE_KEY });
      }
    });

  const nextHandout = handouts.data ? nextQueued(handouts.data) : null;
  const showHandout = (): Promise<void> =>
    once(async () => {
      const s = handouts.data;
      if (!s || !nextHandout) return;
      const who = nextHandout.players?.length
        ? nextHandout.players
            .map(id => s.players.find(p => p.userId === id)?.name ?? 'a player')
            .join(', ')
        : 'every player';
      const confirmLine = {
        title: 'Show page to players',
        question: `Show "${nextHandout.title || 'Untitled'}" to ${who}?`,
        confirmLabel: 'Show page to players',
        pageUuid: nextHandout.uuid,
      };
      await plan(
        'plan-page-reveal',
        { action: 'reveal-next', ...(s.activeSceneId ? { sceneId: s.activeSceneId } : {}) },
        { confirmLine }
      );
      await handouts.refetch({ cancelRefetch: false });
    });

  const off = stale || busy;
  // Writes also wait for the switches (GM Actions, writes, live play), so a click never plans and
  // asks only to be refused at apply.
  // Next turn, the conditions and the Damage form are plain gated writes (GM Actions and writes);
  // only Start / End combat is a live-play write.
  const plainOff = live.off(ROLL_NEEDS);
  const writeOff = off || plainOff.length > 0 || !selectable;
  const endOff = off || liveOff.length > 0 || !selectable;
  const handoutOff = off || live.off(HANDOUT_NEEDS).length > 0;
  const titleFor = (names: string[]): string | undefined =>
    stale ? 'The bridge is away' : names.length > 0 ? offReason(names) : undefined;
  const offTitle = titleFor(plainOff);
  const rollOff = off || roll.busy || live.off(ROLL_NEEDS).length > 0;
  const ask = (who: Combatant[]): void => {
    if (rollOff) return;
    const list = who.map(c => c.name);
    setLastAsked(list);
    void roll.ask(list);
  };

  return (
    <section className={styles['strip']} id="live-strip" aria-label="Live strip">
      <div className={styles['header']}>
        <h2 className={styles['title']}>Live</h2>
        {combat !== null ? (
          <>
            <span className={styles['meta']} id="live-meta" role="status">
              {metaText(combat)}
            </span>
            <Button
              type="button"
              variant="primary"
              size="sm"
              id="live-next-turn"
              data-track="dash.live.next-turn"
              aria-disabled={writeOff ? 'true' : undefined}
              title={offTitle}
              onClick={() => {
                if (!writeOff) void nextTurn();
              }}
            >
              Next turn
            </Button>
            <Button
              type="button"
              size="sm"
              id="live-end-combat"
              data-track="dash.live.end-combat"
              aria-disabled={endOff ? 'true' : undefined}
              title={titleFor(liveOff)}
              onClick={() => {
                if (!endOff) void endCombat();
              }}
            >
              End combat
            </Button>
          </>
        ) : (
          <span className={styles['meta']} role="status">
            No fight.
          </span>
        )}
        <Button
          type="button"
          size="sm"
          id="live-undo"
          data-track="dash.live.undo"
          aria-disabled={undoable && !off ? undefined : 'true'}
          title={undoable?.summary}
          onClick={() => {
            if (undoable && !off) void undo();
          }}
        >
          {changes.isPending ? 'Loading changes' : undoLabel(undoable)}
        </Button>
      </div>
      <p className={styles['away']} id="live-away" role="status">
        {stale ? AWAY_TEXT : ''}
      </p>

      {combat !== null && liveOff.length > 0 && (
        <div className={styles['handout']} id="live-gated" role="status">
          <TurnOnNote live={live} off={liveOff} />
        </div>
      )}

      {combat === null ? (
        liveOff.length === 0 ? (
          <Suspense fallback={null}>
            <StartCombat />
          </Suspense>
        ) : (
          <div className={styles['handout']} data-gated="Start combat">
            <Button type="button" aria-disabled="true" title={offReason(liveOff)}>
              Start combat
            </Button>
            <TurnOnNote live={live} off={liveOff} />
          </div>
        )
      ) : (
        <ol className={styles['cards']} aria-label="Turn order">
          {rows.map(c => (
            <Card
              key={c.id}
              c={c}
              name={names.get(c.id) ?? c.name}
              picked={kept.has(c.id)}
              selectable={selectable}
              stale={stale}
              onPick={() =>
                setPicked(old => {
                  const next = new Set(old);
                  if (!next.delete(c.id)) next.add(c.id);
                  return next;
                })
              }
            />
          ))}
        </ol>
      )}

      {combat !== null && (
        <>
          <div
            className={styles['bar']}
            role="group"
            aria-label="Picked creatures"
            id="live-pick"
            ref={barRef}
            tabIndex={-1}
          >
            <div className={styles['barRow']}>
              <span className={styles['who']} data-empty={kept.size === 0 ? 'true' : undefined}>
                {pickText(pickedNames)}
              </span>
              {kept.size > 0 && (
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  data-track="dash.live.clear"
                  onClick={clearPick}
                >
                  Clear
                </Button>
              )}
            </div>
            {kept.size > 0 && plainOff.length === 0 && (
              <Suspense fallback={null}>
                <DamageForm
                  targets={targets}
                  names={pickedNames}
                  stale={stale}
                  locked={busy}
                  once={once}
                  onClose={clearPick}
                />
              </Suspense>
            )}
            <div className={styles['barRow']} role="group" aria-label="Condition">
              {CONDITIONS.map(cond => (
                <button
                  key={cond}
                  type="button"
                  className={styles['cond']}
                  data-track="dash.live.condition"
                  data-condition={cond}
                  aria-disabled={kept.size === 0 || writeOff ? 'true' : undefined}
                  title={kept.size === 0 ? 'Pick a creature first' : offTitle}
                  onClick={() => {
                    if (kept.size > 0 && !writeOff) void addCondition(cond);
                  }}
                >
                  {cond}
                </button>
              ))}
            </div>
          </div>

          {party.length > 0 && (
            <QuickRollBar roll={roll} idPrefix="live-roll">
              {pickedPcs.length > 0 && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  id="live-roll-picked"
                  data-track="dash.quickroll.picked"
                  aria-disabled={rollOff ? 'true' : undefined}
                  onClick={() => ask(pickedPcs)}
                >
                  {pickedPcs.length === 1
                    ? `Ask ${pickedPcs[0]?.name}`
                    : `Ask ${pickedPcs.length} picked`}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                id="live-roll-party"
                data-track="dash.quickroll.party"
                aria-disabled={rollOff ? 'true' : undefined}
                onClick={() => ask(party)}
              >
                Ask the party
              </Button>
              <Button
                type="button"
                size="sm"
                id="live-roll-again"
                data-track="dash.quickroll.again"
                aria-disabled={rollOff || lastAsked.length === 0 ? 'true' : undefined}
                title={
                  lastAsked.length === 0 ? 'Nothing asked yet' : `Ask ${lastAsked.join(', ')} again`
                }
                onClick={() => {
                  if (!rollOff && lastAsked.length > 0) void roll.ask(lastAsked);
                }}
              >
                Again
              </Button>
            </QuickRollBar>
          )}
        </>
      )}

      <div className={styles['handout']} id="live-handout">
        <Button
          type="button"
          size="sm"
          id="live-show-handout"
          data-track="dash.live.show-handout"
          aria-disabled={nextHandout && !handoutOff ? undefined : 'true'}
          title={
            live.off(HANDOUT_NEEDS).length > 0 ? offReason(live.off(HANDOUT_NEEDS)) : undefined
          }
          onClick={() => {
            if (nextHandout && !handoutOff) void showHandout();
          }}
        >
          Show next handout
        </Button>
        <span className={styles['hint']}>
          {nextHandout ? (nextHandout.title ?? 'Untitled') : 'Nothing queued.'}
        </span>
      </div>
    </section>
  );
}
