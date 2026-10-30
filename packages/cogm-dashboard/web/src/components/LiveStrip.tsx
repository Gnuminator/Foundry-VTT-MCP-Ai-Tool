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
import { GAME_STATE_KEY, useGuardedTools } from '../lib/guarded';
import { useLivePlay } from '../lib/livePlay';
import { ROLL_NEEDS, offReason } from '../lib/liveSwitches';
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
const SCENE_KEY = ['live-strip', 'scene'] as const;

interface SceneRow {
  id: string;
  name: string;
  active?: boolean;
}

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

  const scene = useQuery({
    queryKey: SCENE_KEY,
    queryFn: async (): Promise<string | null> => {
      const answer = await callTool<SceneRow[] | { scenes?: SceneRow[] } | null>('list-scenes', {});
      const list = Array.isArray(answer) ? answer : (answer?.scenes ?? []);
      return list.find(s => s.active)?.name ?? null;
    },
    enabled: combat !== null,
    staleTime: 15_000,
    retry: false,
  });
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

  const nextTurn = (): Promise<void> =>
    once(async () => {
      if (gated('advance-combat-turn')) return;
      try {
        await callTool('advance-combat-turn', {}, { confirm: true });
        void queryClient.invalidateQueries({ queryKey: GAME_STATE_KEY });
      } catch (err) {
        toast(`✗ Next turn: ${errorText(err)}`, 'err');
      }
    });

  const endCombat = (): Promise<void> =>
    once(async () => {
      const from = focusedElement();
      if (gated('plan-combat-change')) return;
      let planned: { planId?: unknown } | null;
      try {
        planned = await callTool<{ planId?: unknown } | null>('plan-combat-change', {
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
        summary: endQuestion(scene.data ?? null),
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
      if (done.status === 'done') setPicked(new Set());
    });

  const undoable = lastUndoable(changes.data ?? []);
  const undo = (): Promise<void> =>
    once(async () => {
      if (!undoable || gated('undo-change')) return;
      try {
        await callTool(
          'undo-change',
          { changeId: undoable.changeId },
          { confirm: true, confirmDestructive: true }
        );
        toast(`✓ Undone: ${undoable.summary}`, 'ok');
      } catch (err) {
        toast(`✗ Undo: ${errorText(err)}`, 'err');
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
        ? nextHandout.players.map(id => s.players.find(p => p.userId === id)?.name ?? id).join(', ')
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
  const offTitle = stale ? 'The bridge is away' : undefined;
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
            <span className={styles['meta']} id="live-meta">
              {metaText(combat)}
            </span>
            <Button
              type="button"
              variant="primary"
              size="sm"
              id="live-next-turn"
              data-track="dash.live.next-turn"
              aria-disabled={off || !selectable ? 'true' : undefined}
              title={offTitle}
              onClick={() => {
                if (!off && selectable) void nextTurn();
              }}
            >
              Next turn
            </Button>
            <Button
              type="button"
              size="sm"
              id="live-end-combat"
              data-track="dash.live.end-combat"
              aria-disabled={off || !selectable ? 'true' : undefined}
              title={offTitle}
              onClick={() => {
                if (!off && selectable) void endCombat();
              }}
            >
              End combat
            </Button>
          </>
        ) : (
          <span className={styles['meta']}>No fight.</span>
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
          {undoLabel(undoable)}
        </Button>
      </div>
      <p className={styles['away']} id="live-away" role="status">
        {stale ? AWAY_TEXT : ''}
      </p>

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
          <div className={styles['bar']} role="group" aria-label="Picked creatures" id="live-pick">
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
                  onClick={() => setPicked(new Set())}
                >
                  Clear
                </Button>
              )}
            </div>
            {kept.size > 0 && (
              <Suspense fallback={null}>
                <DamageForm
                  key={[...kept].sort().join('|')}
                  targets={targets}
                  names={pickedNames}
                  stale={stale}
                  onClose={() => setPicked(new Set())}
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
                  aria-disabled={kept.size === 0 || off ? 'true' : undefined}
                  title={kept.size === 0 ? 'Pick a creature first' : offTitle}
                  onClick={() => {
                    if (kept.size > 0 && !off) void addCondition(cond);
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
          aria-disabled={nextHandout && !off ? undefined : 'true'}
          onClick={() => {
            if (nextHandout && !off) void showHandout();
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
