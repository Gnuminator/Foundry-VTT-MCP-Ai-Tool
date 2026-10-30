// Quick roll requests (item quick-roll-buttons): the small pickers (what to roll, DC, public or
// private, advantage) and the hook that sends the request. The Party card and the combat strip
// each put their own buttons beside the pickers. A request goes through request-player-rolls like
// any other, so it lands in the play log, with the character resolved to its player and a button
// on the player page. One click asks: a roll request only posts a roll card in chat (no world data
// changes) and has no undo, so there is no confirm window (GM Actions still has to be on).
import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { ApiError, callTool, errorText } from '../lib/api';
import { mayHaveApplied, useGuardedTools } from '../lib/guarded';
import { SETTINGS_KEY, type DashboardSettings } from '../lib/stream';
import {
  DEFAULT_PICK,
  cleanPick,
  pickLabel,
  rollArgs,
  rollOptions,
  sentSummary,
  type Advantage,
  type RollPick,
} from '../lib/quickRoll';
import { latestRound, roundHeadline, rowLine, useRollRows } from '../lib/rollStatus';
import { usage } from '../lib/usage';
import { useToast } from './Toasts';
import styles from './QuickRoll.module.css';

const STORE_KEY = 'cogm_quick_roll';

function readPick(): RollPick {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return cleanPick(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_PICK;
  }
}

function writePick(pick: RollPick): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(pick));
  } catch {
    // Storage is blocked: the pick lasts for this page load.
  }
}

// One saved choice for every bar on the page (the strip's and the Party card's): each used to keep
// its own copy, so the one that was out of date wrote its old choice over the other's.
let current: RollPick | null = null;
const listeners = new Set<() => void>();

function getPick(): RollPick {
  current ??= readPick();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function changePick(change: Partial<RollPick>): void {
  current = cleanPick({ ...getPick(), ...change });
  writePick(current);
  listeners.forEach(l => l());
}

export interface QuickRoll {
  pick: RollPick;
  setPick: (change: Partial<RollPick>) => void;
  busy: boolean;
  /** Asks each character for the roll; one toast says how it went. */
  ask: (names: string[]) => Promise<void>;
}

/** The pick (remembered per browser) and the sending, shared by whatever buttons use them. */
export function useQuickRoll(): QuickRoll {
  const toast = useToast();
  const { gated } = useGuardedTools();
  const queryClient = useQueryClient();
  const pick = useSyncExternalStore(subscribe, getPick);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const setPick = changePick;

  const ask = useCallback(
    async (names: string[]): Promise<void> => {
      if (busyRef.current || names.length === 0) return;
      if (gated('request-player-rolls')) return;
      busyRef.current = true;
      setBusy(true);
      const ok: string[] = [];
      const failed: { name: string; error: string; maybeSent?: boolean }[] = [];
      try {
        // One request per character, so each one resolves to its own player and a player who is
        // not logged in fails alone.
        const results = await Promise.allSettled(
          names.map(name =>
            callTool('request-player-rolls', rollArgs(pick, name), { confirm: true })
          )
        );
        results.forEach((r, i) => {
          const name = names[i];
          if (r.status === 'fulfilled') {
            ok.push(name);
          } else {
            failed.push({
              name,
              error: errorText(r.reason),
              ...(mayHaveApplied(r.reason) ? { maybeSent: true } : {}),
            });
            // The server says GM Actions are off whatever the page last heard: show it as off.
            if (r.reason instanceof ApiError && r.reason.code === 'gm-actions-disabled') {
              queryClient.setQueryData<DashboardSettings | null>(SETTINGS_KEY, old =>
                old ? { ...old, gmActionsEnabled: false } : { gmActionsEnabled: false }
              );
            }
          }
        });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      usage().trackTool('request-player-rolls', failed.length === 0 ? 'ok' : 'error');
      toast(sentSummary(pick, ok, failed), ok.length > 0 ? 'ok' : 'err');
    },
    [gated, pick, toast, queryClient]
  );

  return { pick, setPick, busy, ask };
}

/**
 * The pickers. `children` are the buttons that ask (they read `roll.pick` through `ask`).
 * `idPrefix` keeps the labels unique when two bars are on the page.
 */
export function QuickRollBar({
  roll,
  idPrefix,
  children,
}: {
  roll: QuickRoll;
  idPrefix: string;
  children: ReactNode;
}): JSX.Element {
  const { pick, setPick } = roll;
  const round = latestRound(useRollRows(), Date.now());
  return (
    <div className={styles['bar']} role="group" aria-label="Ask for a roll">
      <select
        id={`${idPrefix}-what`}
        className={styles['field']}
        aria-label="What to roll"
        data-track="dash.quickroll.what"
        value={pick.what}
        onChange={e => setPick({ what: e.target.value })}
      >
        {rollOptions().map(g => (
          <optgroup key={g.group} label={g.group}>
            {g.options.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <input
        id={`${idPrefix}-dc`}
        className={`${styles['field']} ${styles['dc']}`}
        type="text"
        inputMode="numeric"
        maxLength={2}
        placeholder="DC"
        aria-label="DC (leave empty for none)"
        data-track="dash.quickroll.dc"
        value={pick.dc}
        onChange={e => setPick({ dc: e.target.value.replace(/\D/g, '') })}
      />
      <select
        id={`${idPrefix}-visibility`}
        className={styles['field']}
        aria-label="Who sees the result"
        data-track="dash.quickroll.visibility"
        value={pick.isPublic ? 'public' : 'private'}
        onChange={e => setPick({ isPublic: e.target.value === 'public' })}
      >
        <option value="private">Private</option>
        <option value="public">Public</option>
      </select>
      <select
        id={`${idPrefix}-advantage`}
        className={styles['field']}
        aria-label="Advantage"
        data-track="dash.quickroll.advantage"
        value={pick.advantage}
        onChange={e => setPick({ advantage: e.target.value as Advantage })}
      >
        <option value="normal">Normal</option>
        <option value="advantage">Advantage</option>
        <option value="disadvantage">Disadvantage</option>
      </select>
      {children}
      {round && (
        <p
          className={`${styles['status']} ${round.waiting.length === 0 ? styles['statusDone'] : ''}`}
          role="status"
          data-testid="roll-status"
        >
          <strong>{roundHeadline(round)}</strong>
          {'. '}
          {round.rows.map(rowLine).join(', ')}
        </p>
      )}
    </div>
  );
}

/** The label of a member's "Ask roll" button: the visible words first, then who and what. */
export const askLabel = (roll: QuickRoll, who: string): string =>
  `Ask roll: ${who}, ${pickLabel(roll.pick)}`;
