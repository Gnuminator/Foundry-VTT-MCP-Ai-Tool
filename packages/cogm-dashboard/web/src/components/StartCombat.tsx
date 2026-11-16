// Start combat (David's GM test): with no fight running, a picker lists every token on the viewed
// scene. Player characters and Hostile tokens are ticked, Neutral and Friendly ones are not; the GM
// changes the ticks and starts. Start plans plan-combat-change (a plain write, so the click applies
// it) and the toast has Undo, which deletes the new combat. GM Actions must be on.
import { useQuery } from '@tanstack/react-query';
import { useContext, useState, type JSX } from 'react';

import { callTool } from '../lib/api';
import { mayHaveApplied, useGuardedTools } from '../lib/guarded';
import { usage } from '../lib/usage';
import {
  canFight,
  defaultTicks,
  initiativeRequestArgs,
  newNpcCombatantIds,
  npcTokenIds,
  pcNames,
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
  // Ask the ticked player characters to roll initiative (a roll request, like Ask roll).
  const [askPcs, setAskPcs] = useState(true);
  const pcCount = pcNames(rows, ticked).length;
  const args = startArgs(rows, ticked, sceneId);
  const none = args.tokenIds.length === 0;
  const start = (): void => {
    if (busy || none) return;
    setBusy(true);
    void (async (): Promise<void> => {
      const outcome = await plan('plan-combat-change', args);
      if (outcome.status !== 'done') return;
      // The players are asked first, so they can roll while the NPCs are rolled for.
      const askNames = askPcs ? pcNames(rows, ticked) : [];
      if (askNames.length > 0 && !gated('request-player-rolls')) {
        // One after another: the module saves each card's button in one shared world setting, and
        // parallel asks overwrite each other's entries (then /me cannot roll for those players).
        const answers: PromiseSettledResult<unknown>[] = [];
        for (const name of askNames) {
          const [answer] = await Promise.allSettled([
            callTool('request-player-rolls', initiativeRequestArgs(name), { confirm: true }),
          ]);
          answers.push(answer);
          // A timeout or a lost channel would repeat for every player: stop asking, the rest count
          // as not asked.
          if (answer.status === 'rejected' && mayHaveApplied(answer.reason)) break;
        }
        // A name past the break has no answer: it was not asked.
        const failed = askNames.filter((_, i) => answers[i]?.status !== 'fulfilled');
        const unsure = askNames.filter((_, i) => {
          const a = answers[i];
          return a?.status === 'rejected' && mayHaveApplied(a.reason);
        });
        const sure = failed.filter(name => !unsure.includes(name));
        const sent = askNames.length - failed.length;
        usage().trackTool('request-player-rolls', failed.length === 0 ? 'ok' : 'error');
        if (failed.length === 0) {
          toast(`✓ Asked ${sent === 1 ? askNames[0] : `${sent} characters`} to roll initiative`);
        } else {
          const parts = [
            sure.length > 0
              ? `Initiative was not asked of ${sure.join(', ')}. They can roll it in Foundry.`
              : '',
            unsure.length > 0
              ? `Not confirmed for ${unsure.join(', ')}: it may have been sent, check chat.`
              : '',
          ];
          toast(parts.filter(Boolean).join(' '), 'warn');
        }
      }
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
            { confirm: true },
            { label: 'Roll initiative', checkIn: 'the tracker' }
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
      {pcCount > 0 && (
        <label className="cs-hint">
          <input
            type="checkbox"
            checked={askPcs}
            disabled={busy}
            onChange={() => setAskPcs(!askPcs)}
          />{' '}
          Ask the player characters to roll initiative
        </label>
      )}
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
        <Button
          id="btn-combat-start"
          size="sm"
          data-track="dash.combat.start"
          onClick={() => setOpen(true)}
        >
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
