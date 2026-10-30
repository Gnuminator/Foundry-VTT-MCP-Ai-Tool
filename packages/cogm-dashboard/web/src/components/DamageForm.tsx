// The Damage / Heal form on the combat strip (item damage-form-simple): one amount, damage type
// chips, a damage or heal toggle, and one button that says what it does. It plans and applies in
// the same click through plan-actor-change (dnd5e works out resistances), so there is no separate
// roll-then-apply; the toast has Undo and Recent Changes keeps the change. Several targets (an
// area effect) take the same amount each. Condition stays in the Tool runner.
import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import {
  DAMAGE_TYPES,
  EMPTY_DRAFT,
  amountOf,
  applyLabel,
  damageArgs,
  type DamageDraft,
  type DamageMode,
  type DamageType,
} from '../lib/damageForm';
import { useGuardedChange } from '../lib/guarded';
import { Button } from '../ui';
import styles from './DamageForm.module.css';

const TYPE_KEY = 'cogm_damage_type';

function readType(): DamageType {
  try {
    const v = localStorage.getItem(TYPE_KEY);
    return DAMAGE_TYPES.find(t => t === v) ?? 'none';
  } catch {
    return 'none';
  }
}

function writeType(type: DamageType): void {
  try {
    localStorage.setItem(TYPE_KEY, type);
  } catch {
    // Storage is blocked: the chip lasts for this page load.
  }
}

export function DamageForm({
  targets,
  names,
  stale,
  onClose,
}: {
  /** What the plan targets (token ids). */
  targets: string[];
  /** What the button calls them. */
  names: string[];
  stale: boolean;
  onClose: () => void;
}): JSX.Element {
  const run = useGuardedChange();
  const [draft, setDraft] = useState<DamageDraft>(() => ({ ...EMPTY_DRAFT, type: readType() }));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    amountRef.current?.focus();
  }, []);

  const args = damageArgs(draft, targets);
  const label = applyLabel(draft, names);
  const heal = draft.mode === 'healing';

  const setMode = (mode: DamageMode): void => setDraft(d => ({ ...d, mode }));
  const setType = (type: DamageType): void => {
    writeType(type);
    setDraft(d => ({ ...d, type }));
  };

  const submit = (): void => {
    if (busyRef.current || stale || !args) return;
    busyRef.current = true;
    setBusy(true);
    void run('plan-actor-change', args)
      .then(done => {
        if (done) onClose();
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
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
      id="damage-form"
      role="group"
      aria-label="Damage or heal"
      onKeyDown={onKeyDown}
    >
      <div className={styles['row']}>
        <div className={styles['toggle']} role="group" aria-label="Damage or heal">
          <button
            type="button"
            className={styles['mode']}
            data-track="dash.damage.mode-damage"
            aria-pressed={!heal}
            onClick={() => setMode('damage')}
          >
            Damage
          </button>
          <button
            type="button"
            className={styles['mode']}
            data-track="dash.damage.mode-heal"
            aria-pressed={heal}
            onClick={() => setMode('healing')}
          >
            Heal
          </button>
        </div>
        <label className={styles['amount']}>
          <span className="visually-hidden">Amount</span>
          <input
            ref={amountRef}
            id="damage-amount"
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="Amount"
            data-track="dash.damage.amount"
            value={draft.amount}
            onChange={e => setDraft(d => ({ ...d, amount: e.target.value.replace(/\D/g, '') }))}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>
      </div>
      {!heal && (
        <div className={styles['chips']} role="group" aria-label="Damage type">
          {(['none', ...DAMAGE_TYPES] as const).map(t => (
            <button
              key={t}
              type="button"
              className={styles['chip']}
              data-track="dash.damage.type"
              aria-pressed={draft.type === t}
              onClick={() => setType(t)}
            >
              {t === 'none' ? 'No type' : t}
            </button>
          ))}
        </div>
      )}
      <div className={styles['row']}>
        <Button
          type="button"
          variant="primary"
          id="damage-apply"
          data-track="dash.damage.apply"
          aria-disabled={args && !stale ? undefined : 'true'}
          title={stale ? 'The bridge is away' : undefined}
          disabled={busy}
          onClick={submit}
        >
          {amountOf(draft) === null ? 'Type an amount' : label}
        </Button>
        <Button type="button" data-track="dash.damage.cancel" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <p className={styles['note']}>
        Applies to the {names.length === 1 ? 'token' : 'tokens'} in Foundry as soon as you press the
        button. Each takes the full amount; resistances count. Undo is on the toast and in Recent
        Changes.
      </p>
    </div>
  );
}
