// Monster action buttons on the live strip (item monster-action-buttons): up to four buttons for
// the one NPC picked, read from the actor. A click rolls the item against the creature targeted in
// Foundry (use-npc-activity: the roll and its damage appear in Foundry's chat as normal), shows
// the result line, and puts the damage on the target only after the confirm window, unless the
// module's "apply without confirming" switch for live play is on. Every applied change has its
// Undo toast.
import { useEffect, useRef, useState, type JSX } from 'react';

import { callTool, errorText } from '../lib/api';
import { fetchFoundryTargets } from '../lib/foundry-targets';
import { useGuardedTools } from '../lib/guarded';
import {
  MANY_TARGETS_NOTE,
  NO_ACTIONS_NOTE,
  NO_TARGET_NOTE,
  actionsOf,
  activityArgs,
  appliedLine,
  applyParts,
  damageParts,
  landed,
  readActivity,
  resultLine,
} from '../lib/monster-actions';
import type { Weapon } from '../lib/attack-form';
import { Button } from '../ui';
import styles from './MonsterActions.module.css';

export function MonsterActions({
  token,
  name,
  stale,
  locked,
  damageOff,
  offTitle,
  once,
}: {
  /** The picked NPC's token id. */
  token: string;
  name: string;
  stale: boolean;
  /** The strip runs another write; the buttons wait. */
  locked: boolean;
  /** The live-play switches the damage step needs that are off: the roll still runs. */
  damageOff: string;
  /** Why the buttons cannot be pressed now, or undefined. */
  offTitle: string | undefined;
  once: (work: () => Promise<void>) => Promise<void>;
}): JSX.Element {
  const { call, plan } = useGuardedTools();
  const [actions, setActions] = useState<Weapon[] | null>(null);
  const [error, setError] = useState('');
  const [line, setLine] = useState('');
  const ownLock = useRef(false);
  /** The id of the button whose roll is running (it says so; the others wait). */
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    let live = true;
    setActions(null);
    setError('');
    // The result line stays: it names its own creature, and a press may still be running.
    callTool('search-character-items', { characterIdentifier: token, type: 'weapon', limit: 50 })
      .then(r => {
        if (live) setActions(actionsOf(r));
      })
      .catch((e: unknown) => {
        if (!live) return;
        setActions([]);
        setError(`Could not read the actions: ${errorText(e)}`);
      });
    return (): void => {
      live = false;
    };
  }, [token]);

  const press = (action: Weapon): void => {
    if (stale || locked || ownLock.current || offTitle) return;
    void once(async (): Promise<void> => {
      ownLock.current = true;
      setBusyId(action.id);
      setLine('');
      try {
        const found = await fetchFoundryTargets();
        const targets = found.source === 'targeted' ? found.tokens : [];
        if (targets.length === 0) {
          setLine(NO_TARGET_NOTE);
          return;
        }
        if (targets.length > 1) {
          setLine(MANY_TARGETS_NOTE);
          return;
        }
        const target = targets[0];
        if (!target) return;
        const outcome = await call('use-npc-activity', activityArgs(token, action.id), {
          confirm: true,
        });
        if (outcome.status !== 'done') {
          if (outcome.status === 'failed') setLine(`✗ ${outcome.error}`);
          return;
        }
        const result = readActivity(outcome.result);
        setLine(resultLine(name, action.name, result));
        const parts = damageParts(result);
        if (parts.length === 0) return;
        if (damageOff) {
          setLine(l => `${l}. Damage not applied: ${damageOff}.`);
          return;
        }
        const { applied, last } = await applyParts(plan, target, parts, landed(result));
        if (last && last.status !== 'done') {
          const may = last.status === 'failed' && last.mayHaveApplied === true;
          setLine(l => `${l}. ${appliedLine(parts, applied, may)}`);
        }
      } catch (e) {
        setLine(`✗ ${errorText(e)}`);
      } finally {
        ownLock.current = false;
        setBusyId('');
      }
    });
  };

  return (
    <div
      className={styles['wrap']}
      role="group"
      aria-label={`Actions of ${name}`}
      id="live-actions"
    >
      <div className={styles['row']}>
        {actions === null && <span className={styles['hint']}>Loading actions...</span>}
        {actions?.map(a => (
          <Button
            key={a.id}
            type="button"
            size="sm"
            data-track="dash.live.monster-action"
            data-action={a.name}
            aria-disabled={stale || locked || offTitle || busyId ? 'true' : undefined}
            aria-busy={busyId === a.id ? 'true' : undefined}
            title={offTitle ?? `Roll ${a.name} against the creature targeted in Foundry`}
            onClick={() => press(a)}
          >
            {a.name}
          </Button>
        ))}
        {actions !== null && actions.length === 0 && (
          <span className={styles['hint']}>{error || NO_ACTIONS_NOTE}</span>
        )}
      </div>
      <p className={styles['line']} role="status" id="live-action-result">
        {line}
      </p>
    </div>
  );
}
