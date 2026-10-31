// Start combat (David's GM test): with no fight running, a picker lists every token on the viewed
// scene. Player characters and Hostile tokens are ticked, Neutral and Friendly ones are not; the GM
// changes the ticks and starts. Start plans plan-combat-change (a plain write, so the click applies
// it) and the toast has Undo, which deletes the new combat. GM Actions must be on.
import { useQuery } from '@tanstack/react-query';
import { useContext, useState, type JSX } from 'react';

import { callTool } from '../lib/api';
import { useGuardedTools } from '../lib/guarded';
import {
  canFight,
  defaultTicks,
  newNpcCombatantIds,
  npcTokenIds,
  RollNpcInitiativeContext,
  pickerRows,
  sideWords,
  startArgs,
  type SceneToken,
  type TokenPositionsAnswer,
} from '../lib/startCombat';
import { Button, QueryState } from '../ui';
import { useToast } from './Toasts';

function TokenList({
  rows,
  sceneName,
  sceneId,
  onClose,
}: {
  rows: SceneToken[];
  sceneName: string | undefined;
  sceneId: string | undefined;
  onClose: () => void;
}): JSX.Element {
  const { plan, gated, call } = useGuardedTools();
  const rollNpcs = useContext(RollNpcInitiativeContext);
  const toast = useToast();
  // Set once the GM touches a tick; until then the default stands.
  const [edited, setEdited] = useState<ReadonlySet<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const ticked = edited ?? defaultTicks(rows);
  const toggle = (id: string): void => {
    const next = new Set(ticked);
    if (!next.delete(id)) next.add(id);
    setEdited(next);
  };
  const args = startArgs(rows, ticked, sceneId);
  const none = args.tokenIds.length === 0;
  const start = (): void => {
    if (busy || none) return;
    setBusy(true);
    void (async (): Promise<void> => {
      const outcome = await plan('plan-combat-change', args);
      if (outcome.status !== 'done') return;
      // The fight exists now. The NPCs roll through the same gate and a plain write, as Next turn does.
      const npcTokens = npcTokenIds(rows, ticked);
      if (rollNpcs && npcTokens.size > 0 && !gated('roll-initiative-for-npcs')) {
        // The tool acts on the fight the bridge resolves, which can be an older encounter: roll
        // only for the combatants of the tokens just started, found in that fight.
        let ids: string[] = [];
        try {
          ids = newNpcCombatantIds(await callTool('get-combat-state', {}), npcTokens);
        } catch {
          // Same as finding none: the warning below says to roll in Foundry.
        }
        if (ids.length === 0) {
          toast(
            'Combat started, but its NPCs were not found in the tracker. Roll their initiative in Foundry.',
            'warn'
          );
        } else {
          const rolled = await call(
            'roll-initiative-for-npcs',
            { combatantIds: ids },
            { confirm: true }
          );
          if (rolled.status === 'done') toast('✓ Rolled initiative for the NPCs', 'ok');
        }
      }
      onClose();
    })().finally(() => setBusy(false));
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
          aria-disabled={none ? 'true' : undefined}
          busy={busy}
          busyLabel="Starting combat..."
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

/**
 * The Start combat button and, once opened, the token picker. Shown while no fight runs. With
 * `onDismiss` the picker is opened from outside (the During bar's button) and starts open; closing
 * it calls `onDismiss` and there is no button here.
 */
export function StartCombat({ onDismiss }: { onDismiss?: () => void }): JSX.Element | null {
  const [open, setOpenState] = useState(onDismiss !== undefined);
  const setOpen = (next: boolean): void => {
    setOpenState(next);
    if (!next) onDismiss?.();
  };
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
            sceneId={data.sceneId}
            onClose={() => setOpen(false)}
          />
        )}
      </QueryState>
      {/* The list has its own Cancel; while it loads, failed or is empty there is none. */}
      {!(tokens.isSuccess && (tokens.data.tokens ?? []).length > 0) && (
        <div className="ca-row">
          <Button size="sm" data-track="dash.combat.start-cancel" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      )}
    </div>
  );
}
