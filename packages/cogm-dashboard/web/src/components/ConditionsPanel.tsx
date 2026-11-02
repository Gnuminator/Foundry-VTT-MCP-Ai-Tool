// The Conditions action of the During view: pick tokens on the viewed scene, pick a condition, then
// Add or Remove. It works in a fight and out of one (a condition on a token is not a combat
// thing), and goes through plan-actor-change like the strip's Damage / Heal, so GM Actions gate
// it and the toast has Undo. Each condition shows on hover or focus a link to dnd5e's own rules
// page, opened in the GM's Foundry; no rules text is kept here.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type JSX } from 'react';

import { callTool, errorText } from '../lib/api';
import {
  conditionButtonLabel,
  conditionChoices,
  conditionPlanArgs,
  type ConditionChoice,
} from '../lib/conditionsPanel';
import { useGuardedTools } from '../lib/guarded';
import { canFight, pickerRows, sideWords, type TokenPositionsAnswer } from '../lib/startCombat';
import { Button, QueryState } from '../ui';

import styles from './ConditionsPanel.module.css';
import { useToast } from './Toasts';

function ConditionChip({
  choice,
  chosen,
  onPick,
}: {
  choice: ConditionChoice;
  chosen: boolean;
  onPick: () => void;
}): JSX.Element {
  const toast = useToast();
  const openRules = (): void => {
    if (!choice.reference) return;
    callTool('open-in-foundry', { uuid: choice.reference }).catch((err: unknown) =>
      toast(`✗ Could not open the rules for ${choice.name}: ${errorText(err)}`, 'err')
    );
  };
  return (
    <li className={styles['chip']} data-condition={choice.id}>
      <button
        type="button"
        className={styles['pick']}
        aria-pressed={chosen}
        data-track="dash.conditions.pick"
        onClick={onPick}
      >
        {choice.name}
      </button>
      {choice.reference && (
        <button
          type="button"
          className={styles['rules']}
          data-track="dash.conditions.rules"
          aria-label={`Open the rules for ${choice.name} in Foundry`}
          title={`Open the rules for ${choice.name} in Foundry (dnd5e's own page)`}
          onClick={openRules}
        >
          rules ↗
        </button>
      )}
    </li>
  );
}

function Picker({ onClose }: { onClose: () => void }): JSX.Element {
  const { plan } = useGuardedTools();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [condition, setCondition] = useState<string | null>(null);
  const [pending, setPending] = useState<'add' | 'remove' | null>(null);
  const busy = pending !== null;
  const lock = useRef(false);

  const tokens = useQuery({
    queryKey: ['conditions-tokens'],
    queryFn: async () => {
      const answer = await callTool<TokenPositionsAnswer | null>('get-token-positions', {});
      if (!answer || typeof answer !== 'object') throw new Error('The bridge sent no tokens.');
      return answer;
    },
    staleTime: 0,
    retry: false,
  });
  const conditions = useQuery({
    queryKey: ['conditions-list'],
    queryFn: async () => conditionChoices(await callTool('get-available-conditions', {})),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const rows = pickerRows(tokens.data?.tokens).filter(canFight);
  const choices = conditions.data ?? [];
  const chosen = choices.find(c => c.id === condition);
  const targets = rows.filter(t => ticked.has(t.tokenId)).map(t => t.tokenId);
  const ready = targets.length > 0 && chosen !== undefined && !busy;

  const toggle = (id: string): void => {
    const next = new Set(ticked);
    if (!next.delete(id)) next.add(id);
    setTicked(next);
  };

  const apply = (active: boolean): void => {
    if (!ready || lock.current || !chosen) return;
    lock.current = true;
    setPending(active ? 'add' : 'remove');
    void plan('plan-actor-change', conditionPlanArgs(targets, chosen.id, active)).finally(() => {
      lock.current = false;
      setPending(null);
    });
  };

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('input:not(:disabled)')?.focus();
  }, [tokens.isSuccess]);

  return (
    <div
      className={styles['panel']}
      id="conditions-panel"
      role="group"
      aria-label="Conditions"
      ref={rootRef}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="cs-hint">
        Tick the tokens, pick a condition, then Add or Remove. It works in a fight and out of one.
      </p>
      <QueryState
        query={tokens}
        errorLabel="Couldn't load the tokens"
        onRetry={() => void tokens.refetch()}
        isEmpty={() => rows.length === 0}
        empty="No tokens on this scene."
      >
        {() => (
          <ul className="cs-list" aria-label="Tokens to change">
            {rows.map(t => (
              <li key={t.tokenId} className="cs-row" data-token={t.tokenId}>
                <label>
                  <input
                    type="checkbox"
                    checked={ticked.has(t.tokenId)}
                    disabled={busy}
                    onChange={() => toggle(t.tokenId)}
                  />{' '}
                  <span className="cs-name">{t.name}</span>
                  {t.hidden && <span className="cs-note"> hidden</span>}{' '}
                  <span className={`side side-${t.category}`}>{sideWords(t)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      <QueryState
        query={conditions}
        errorLabel="Couldn't load the conditions"
        onRetry={() => void conditions.refetch()}
        isEmpty={d => d.length === 0}
        empty="This game has no conditions."
      >
        {() => (
          <ul className={styles['chips']} aria-label="Conditions">
            {choices.map(c => (
              <ConditionChip
                key={c.id}
                choice={c}
                chosen={c.id === condition}
                onPick={() => setCondition(c.id === condition ? null : c.id)}
              />
            ))}
          </ul>
        )}
      </QueryState>
      <div className="ca-row">
        <Button
          variant="primary"
          size="sm"
          data-track="dash.conditions.add"
          aria-disabled={ready ? undefined : 'true'}
          busy={pending === 'add'}
          busyLabel="Working..."
          onClick={() => apply(true)}
        >
          {conditionButtonLabel(chosen, targets.length, true)}
        </Button>
        <Button
          size="sm"
          data-track="dash.conditions.remove"
          aria-disabled={ready ? undefined : 'true'}
          busy={pending === 'remove'}
          busyLabel="Working..."
          onClick={() => apply(false)}
        >
          {conditionButtonLabel(chosen, targets.length, false)}
        </Button>
        <Button size="sm" data-track="dash.conditions.close" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

/** The panel; mounted only while open (the During bar owns the button). */
export function ConditionsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  return <Picker onClose={onClose} />;
}
