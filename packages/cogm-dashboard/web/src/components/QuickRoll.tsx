// Quick roll requests (item quick-roll-buttons): the small pickers (what to roll, DC, public or
// private, advantage) and the hook that sends the request. The Party card and the combat strip
// each put their own buttons beside the pickers. A request goes through request-player-rolls like
// any other, so it lands in the play log, with the character resolved to its player and a button
// on the player page. One click asks: a roll request changes nothing in the game and has no undo,
// so there is no confirm window (GM Actions still has to be on).
import { useCallback, useRef, useState, type JSX, type ReactNode } from 'react';

import { callTool, errorText } from '../lib/api';
import { useGuardedTools } from '../lib/guarded';
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
  const [pick, setPickState] = useState<RollPick>(readPick);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const setPick = useCallback((change: Partial<RollPick>): void => {
    setPickState(old => {
      const next = cleanPick({ ...old, ...change });
      writePick(next);
      return next;
    });
  }, []);

  const ask = useCallback(
    async (names: string[]): Promise<void> => {
      if (busyRef.current || names.length === 0) return;
      if (gated('request-player-rolls')) return;
      busyRef.current = true;
      setBusy(true);
      const ok: string[] = [];
      const failed: { name: string; error: string }[] = [];
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
            failed.push({ name, error: errorText(r.reason) });
          }
        });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      usage().trackTool('request-player-rolls', failed.length === 0 ? 'ok' : 'error');
      toast(sentSummary(pick, ok, failed), ok.length > 0 ? 'ok' : 'err');
    },
    [gated, pick, toast]
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
    </div>
  );
}

/** The text of an asking button: "Ask Ilvara", "Ask the party". */
export const askLabel = (roll: QuickRoll, who: string): string =>
  `Ask ${who} for ${pickLabel(roll.pick)}`;
