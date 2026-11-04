// The Attack form on the combat strip (item dashboard-attack): pick who attacks, with which weapon
// and against whom, and one button runs use-item with rollAttack. The click is the confirmation (no
// confirm window); the roll shows in the feed and the card in Foundry's chat. Targets are another
// combatant from the list or the tokens targeted in Foundry, read when you press the button.
import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import { callTool, errorText } from '../lib/api';
import {
  FOUNDRY_TARGETS,
  LANDED_NOTE,
  NO_TARGET_NOTE,
  attackArgs,
  attackLabel,
  attackers,
  defaultAttacker,
  defaultTarget,
  weaponsOf,
  type Weapon,
} from '../lib/attackForm';
import type { Combatant } from '../lib/combat';
import { fetchFoundryTargets } from '../lib/foundryTargets';
import { useGuardedTools } from '../lib/guarded';
import { Button } from '../ui';
import styles from './AttackForm.module.css';

export function AttackForm({
  combatants,
  picked,
  stale,
  locked = false,
  onClose,
}: {
  combatants: ReadonlyArray<Combatant>;
  /** The combat ids picked on the strip: one other than the attacker becomes the target. */
  picked: ReadonlyArray<string>;
  stale: boolean;
  /** The strip runs another write; Attack waits. */
  locked?: boolean;
  onClose: () => void;
}): JSX.Element {
  const { call } = useGuardedTools();
  const list = attackers(combatants);
  const [attackerId, setAttackerId] = useState(() => defaultAttacker(combatants));
  const [weapons, setWeapons] = useState<Weapon[] | null>(null);
  const [weaponId, setWeaponId] = useState('');
  const [target, setTarget] = useState(() => defaultTarget(picked, defaultAttacker(combatants)));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const ownLock = useRef(false);
  const attackerRef = useRef<HTMLSelectElement>(null);

  const attacker = list.find(c => c.id === attackerId);
  const attackerToken = attacker?.tokenId ?? null;
  const others = list.filter(c => c.id !== attackerId);
  const targetRow = others.find(c => c.id === target);
  // A target that stopped being valid (defeated, or now the attacker) falls back to Foundry's.
  const targetChoice = target === FOUNDRY_TARGETS || targetRow ? target : FOUNDRY_TARGETS;
  const weapon = weapons?.find(w => w.id === weaponId);

  useEffect(() => {
    attackerRef.current?.focus();
  }, []);

  // The attacker's weapons; a token id works for an unlinked NPC too.
  useEffect(() => {
    setWeapons(null);
    setWeaponId('');
    if (!attackerToken) return;
    let live = true;
    void callTool('search-character-items', {
      characterIdentifier: attackerToken,
      type: 'weapon',
      limit: 50,
    })
      .then(r => {
        if (!live) return;
        const found = weaponsOf(r);
        setWeapons(found);
        setWeaponId(found[0]?.id ?? '');
      })
      .catch(() => {
        if (live) setWeapons([]);
      });
    return (): void => {
      live = false;
    };
  }, [attackerToken]);

  const ready = !stale && !locked && !!attackerToken && !!weapon;

  const submit = (): void => {
    if (!ready || ownLock.current || !attackerToken) return;
    ownLock.current = true;
    setBusy(true);
    setNote('');
    void (async (): Promise<void> => {
      let closed = false;
      try {
        let tokens: string[];
        if (targetRow?.tokenId) tokens = [targetRow.tokenId];
        else {
          // Only what is targeted: a token that is merely selected (often the attacker's own)
          // must never become the target.
          const found = await fetchFoundryTargets();
          tokens = found.source === 'targeted' ? found.tokens.map(t => t.tokenId) : [];
        }
        const args = attackArgs(attackerToken, weaponId, tokens);
        if (!args) {
          setNote(NO_TARGET_NOTE);
          return;
        }
        // use-item is a destructive write; the click is the confirmation.
        const outcome = await call(
          'use-item',
          args,
          { confirm: true, confirmDestructive: true },
          { label: 'Attack' }
        );
        if (outcome.status === 'done') {
          closed = true;
          onClose();
        } else if (outcome.status === 'failed' && outcome.mayHaveApplied) {
          setNote(LANDED_NOTE);
        }
      } catch (e) {
        setNote(e instanceof Error ? errorText(e) : 'Could not read the targets from Foundry.');
      } finally {
        ownLock.current = false;
        setBusy(false);
        if (!closed) attackerRef.current?.focus();
      }
    })();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  const targetName = targetRow ? targetRow.name : 'the Foundry targets';
  let buttonText = 'Pick a weapon';
  if (weapons === null) buttonText = 'Loading weapons...';
  else if (weapon && attacker) buttonText = attackLabel(attacker.name, weapon.name, targetName);

  return (
    <div
      className={styles['form']}
      id="attack-form"
      role="group"
      aria-label="Attack"
      onKeyDown={onKeyDown}
    >
      <div className={styles['row']}>
        <label className={styles['field']}>
          <span>Attacker</span>
          <select
            ref={attackerRef}
            id="attack-attacker"
            data-track="dash.attack.attacker"
            value={attackerId}
            onChange={e => {
              setNote('');
              setAttackerId(e.target.value);
            }}
          >
            {list.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isCurrentTurn ? ' (turn)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className={styles['field']}>
          <span>Weapon</span>
          <select
            id="attack-weapon"
            data-track="dash.attack.weapon"
            value={weaponId}
            disabled={!weapons || weapons.length === 0}
            onChange={e => {
              setNote('');
              setWeaponId(e.target.value);
            }}
          >
            {(weapons ?? []).map(w => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles['field']}>
          <span>Target</span>
          <select
            id="attack-target"
            data-track="dash.attack.target"
            value={targetChoice}
            onChange={e => {
              setNote('');
              setTarget(e.target.value);
            }}
          >
            <option value={FOUNDRY_TARGETS}>Foundry targets (read when you press Attack)</option>
            {others.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p role="status" className={styles['note']} id="attack-note">
        {weapons !== null && weapons.length === 0
          ? 'This one has no weapons to attack with.'
          : note}
      </p>
      <div className={styles['row']}>
        <Button
          type="button"
          variant="primary"
          id="attack-go"
          data-track="dash.attack.go"
          aria-disabled={ready ? undefined : 'true'}
          title={stale ? 'The bridge is away' : undefined}
          busy={busy}
          busyLabel="Attacking..."
          onClick={submit}
        >
          {buttonText}
        </Button>
        <Button type="button" data-track="dash.attack.cancel" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <p className={styles['note']}>
        Rolls the attack against the target in Foundry as soon as you press the button. The roll
        shows in the feed.
      </p>
    </div>
  );
}
