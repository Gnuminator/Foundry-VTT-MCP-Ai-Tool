// The Condition picker on the combat strip (item dashboard-inline-condition-endcombat): one chip
// per condition, the same list the live strip offers. A chip plans the condition for the picked
// tokens with plan-actor-change, one plain confirm window asks, and the apply puts it on; the toast
// has Undo and Recent Changes keeps the change. No Tool Runner. It shares the Damage / Heal form's
// look (its CSS module), since the two open in the same place under the action bar.
import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import { useGuardedTools } from '../lib/guarded';
import { CONDITIONS, conditionArgs, conditionQuestion } from '../lib/liveStrip';
import { Button } from '../ui';
import styles from './DamageForm.module.css';

export function ConditionForm({
  targets,
  names,
  stale,
  locked = false,
  once,
  onClose,
}: {
  /** What the plan targets (token ids, or names for a row without a token). */
  targets: string[];
  /** What the question calls them. */
  names: string[];
  stale: boolean;
  /** The strip runs another write; the chips wait (the strip's one lock). */
  locked?: boolean;
  /** The strip's one-write-at-a-time lock. */
  once: (work: () => Promise<void>) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const { plan } = useGuardedTools();
  const [running, setRunning] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const off = stale || locked || running !== null || targets.length === 0;

  const set = (condition: string): void => {
    if (off) return;
    void once(async () => {
      setRunning(condition);
      setNote('');
      let closed = false;
      try {
        const outcome = await plan('plan-actor-change', conditionArgs(targets, condition), {
          confirmLine: {
            title: 'Set condition',
            question: conditionQuestion(condition, names),
            confirmLabel: `Set ${condition}`,
          },
        });
        if (outcome.status === 'done') {
          closed = true;
          onClose();
        } else if (outcome.status === 'failed' && outcome.mayHaveApplied) {
          setNote('It may have landed. Check Recent Changes before you set it again.');
        }
      } finally {
        if (!closed) setRunning(null);
      }
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className={styles['form']}
      id="condition-form"
      role="group"
      aria-label="Set a condition"
      onKeyDown={onKeyDown}
    >
      <div className={styles['chips']} role="group" aria-label="Condition">
        {CONDITIONS.map((cond, i) => (
          <button
            key={cond}
            ref={i === 0 ? firstRef : undefined}
            type="button"
            className={styles['chip']}
            data-track="dash.combat.condition"
            data-condition={cond}
            data-busy={running === cond ? 'true' : undefined}
            aria-disabled={off ? 'true' : undefined}
            title={stale ? 'The bridge is away' : undefined}
            onClick={() => set(cond)}
          >
            {cond}
          </button>
        ))}
      </div>
      <p role="status" className={styles['note']}>
        {running ? `Setting ${running}...` : note}
      </p>
      <div className={styles['row']}>
        <Button type="button" data-track="dash.combat.condition-cancel" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <p className={styles['note']}>
        Asks once, then puts it on the {names.length === 1 ? 'token' : 'tokens'} in Foundry. Undo is
        on the toast and in Recent Changes.
      </p>
    </div>
  );
}
