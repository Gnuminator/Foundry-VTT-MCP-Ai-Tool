// The initiative ribbon (UI-07), in the Combat Tracker panel above the rows. It draws what
// lib/ribbon.ts works out from the fight the strip already has: the creature up now large, the
// next two clear, the rest fading, the round break and the lair action's place. Read-only; the
// rows below stay the place to pick combatants. Each creature is a ring of its side's colour
// around its token portrait (its initials when there is none); a click pans the GM's Foundry view
// to the token, through open-in-foundry with pan: that moves only the view and changes nothing.
import { useState, type JSX } from 'react';

import { callTool, errorText } from '../lib/api';
import { NO_VALUE, hpTone, type CombatState } from '../lib/combat';
import { ribbonItems, ribbonSummary, type RibbonCreature } from '../lib/ribbon';

import styles from './InitiativeRibbon.module.css';
import { useToast } from './Toasts';

function Creature({ c }: { c: RibbonCreature }): JSX.Element {
  const toast = useToast();
  // A portrait that fails to load (Foundry unreachable from here) falls back to the initials.
  const [broken, setBroken] = useState<string | null>(null);
  const pan = (): void => {
    if (!c.tokenUuid) return;
    callTool('open-in-foundry', { uuid: c.tokenUuid, pan: true }).catch((err: unknown) =>
      toast(`✗ Could not pan to ${c.name}: ${errorText(err)}`, 'err')
    );
  };
  const face =
    c.img && broken !== c.img ? (
      <img
        className={styles['portrait']}
        src={c.img}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setBroken(c.img)}
      />
    ) : (
      c.initials
    );
  const tone = hpTone({ value: c.hpPercent, max: 100 });
  const state = [
    c.role === 'current' && 'up now',
    c.role === 'down' && 'defeated',
    c.concentrating && 'concentrating',
  ].filter(Boolean);
  return (
    <li
      className={`${styles['item']} ${styles[c.side]} ${styles[c.role]}`}
      data-ribbon-id={c.id}
      data-role={c.role}
      {...(c.role === 'current' ? { 'aria-current': 'step' as const } : {})}
    >
      {c.tokenUuid ? (
        <button
          type="button"
          className={styles['badge']}
          onClick={pan}
          aria-label={`Pan to ${c.name}`}
        >
          {face}
        </button>
      ) : (
        <span className={styles['badge']} aria-hidden="true">
          {face}
        </span>
      )}
      <span className={styles['name']}>
        {c.name}
        {state.length > 0 && <span className="visually-hidden"> ({state.join(', ')})</span>}
      </span>
      <span className={styles['init']}>{c.initiative ?? NO_VALUE}</span>
      {c.role !== 'down' && (
        <span className={styles['hp']} aria-hidden="true">
          <span
            className={`${styles['hpFill']} ${tone ? styles[tone] : ''}`}
            style={{ width: `${c.hpPercent}%` }}
          />
        </span>
      )}
      {c.role !== 'later' && c.conditions.length > 0 && (
        <span className={styles['chips']}>
          {c.conditions.slice(0, 2).map(cond => (
            <span
              key={cond}
              className={`${styles['chip']}${/concentrat/i.test(cond) ? ` ${styles['conc']}` : ''}`}
              title={cond}
            >
              {cond}
            </span>
          ))}
        </span>
      )}
    </li>
  );
}

export function InitiativeRibbon({ combat }: { combat: CombatState | null }): JSX.Element | null {
  const items = ribbonItems(combat);
  if (!items) return null;
  return (
    <ol
      className={styles['ribbon']}
      id="initiative-ribbon"
      aria-label={`Initiative: ${ribbonSummary(items)}`}
      tabIndex={0}
    >
      {items.map(item => {
        if (item.kind === 'creature') return <Creature key={item.id} c={item} />;
        if (item.kind === 'round') {
          return (
            <li key="round" className={styles['marker']}>
              <span>Round</span>
              <span>{item.round}</span>
            </li>
          );
        }
        return (
          <li key="lair" className={`${styles['marker']} ${styles['lair']}`}>
            <span aria-hidden="true">🏰</span>
            <span>Lair {item.count}</span>
          </li>
        );
      })}
    </ol>
  );
}
