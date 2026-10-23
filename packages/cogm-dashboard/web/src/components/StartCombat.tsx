// Start combat (David's GM test): with no fight running, a picker lists every token on the viewed
// scene. Player characters and Hostile tokens are ticked, Neutral and Friendly ones are not; the GM
// changes the ticks and starts. Start plans plan-combat-change (a plain write, so the click applies
// it) and the toast has Undo, which deletes the new combat. GM Actions must be on.
import { useQuery } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { callTool } from '../lib/api';
import { useGuardedChange } from '../lib/guarded';
import {
  canFight,
  defaultTicks,
  pickerRows,
  sideWords,
  startArgs,
  type SceneToken,
  type TokenPositionsAnswer,
} from '../lib/startCombat';
import { Button, QueryState } from '../ui';

function TokenList({
  rows,
  sceneName,
  onClose,
}: {
  rows: SceneToken[];
  sceneName: string | undefined;
  onClose: () => void;
}): JSX.Element {
  const run = useGuardedChange();
  // Set once the GM touches a tick; until then the default stands.
  const [edited, setEdited] = useState<ReadonlySet<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const ticked = edited ?? defaultTicks(rows);
  const toggle = (id: string): void => {
    const next = new Set(ticked);
    if (!next.delete(id)) next.add(id);
    setEdited(next);
  };
  const args = startArgs(rows, ticked);
  const none = args.tokenIds.length === 0;
  const start = (): void => {
    if (busy || none) return;
    setBusy(true);
    void run('plan-combat-change', args)
      .then(done => {
        if (done) onClose();
      })
      .finally(() => setBusy(false));
  };
  return (
    <>
      <p className="cs-hint">
        {sceneName ? `${sceneName}: ` : ''}Player characters and Hostile tokens are ticked.
      </p>
      <ul className="cs-list" aria-label="Tokens to put in the fight">
        {rows.map(t => (
          <li key={t.tokenId} className="cs-row" data-token={t.tokenId}>
            <label>
              <input
                type="checkbox"
                checked={ticked.has(t.tokenId) && canFight(t)}
                disabled={!canFight(t) || busy}
                onChange={() => toggle(t.tokenId)}
              />{' '}
              <span className="cs-name">{t.name}</span>{' '}
              <span className={`side side-${t.category}`}>{sideWords(t)}</span>
              {t.hidden && <span className="cs-note"> hidden</span>}
              {!canFight(t) && <span className="cs-note"> no actor</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="ca-row">
        <Button
          variant="primary"
          size="sm"
          data-track="dash.combat.start-go"
          aria-disabled={none || busy ? 'true' : undefined}
          onClick={start}
        >
          {none ? 'Start combat' : `Start combat with ${args.tokenIds.length}`}
        </Button>
        <Button size="sm" data-track="dash.combat.start-cancel" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  );
}

/** The Start combat button and, once opened, the token picker. Shown while no fight runs. */
export function StartCombat(): JSX.Element {
  const [open, setOpen] = useState(false);
  const tokens = useQuery({
    queryKey: ['combat-start-tokens'],
    queryFn: async () => {
      const answer = await callTool<TokenPositionsAnswer | null>('get-token-positions', {});
      if (!answer || typeof answer !== 'object') throw new Error('The bridge sent no tokens.');
      return answer;
    },
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  if (!open) {
    return (
      <div className="ca-row combat-start">
        <span className="ca-hint">No fight is running.</span>
        <Button size="sm" data-track="dash.combat.start" onClick={() => setOpen(true)}>
          Start combat
        </Button>
      </div>
    );
  }
  return (
    <div className="combat-start">
      <QueryState
        query={tokens}
        errorLabel="Couldn't load the tokens"
        onRetry={() => void tokens.refetch()}
        isEmpty={d => (d.tokens ?? []).length === 0}
        empty="No tokens on this scene."
      >
        {data => (
          <TokenList
            rows={pickerRows(data.tokens)}
            sceneName={data.sceneName}
            onClose={() => setOpen(false)}
          />
        )}
      </QueryState>
    </div>
  );
}
