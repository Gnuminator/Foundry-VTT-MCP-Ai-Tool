// NPC on stage: one tap says "the GM is speaking as Hrafne now". The Table TV shows the portrait
// (and the name once the players know it) and the session log marks the time, so the notes can
// attribute the GM's lines. A direct write to the TV and the log, no plan: a wrong tap is fixed
// with another tap or Off stage. GM only.
import { useQuery } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { callTool, errorText } from '../lib/api';
import {
  STAGE_CLEAR_ARGS,
  combatNpcNames,
  stageArgs,
  stageStatus,
  type StagePick,
  type StageReply,
} from '../lib/npc-stage';
import { useCombat } from '../lib/stream';
import type { RefChoice } from '../lib/tool-form';
import { Button } from '../ui';

import { useToast } from './Toasts';
import styles from './NpcStage.module.css';

const MIN_SEARCH = 2;

/** NPCs whose name starts or contains the typed text (list-ref-choices, GM only). */
function useNpcSearch(query: string): RefChoice[] {
  const text = query.trim();
  const found = useQuery({
    queryKey: ['npc-stage-search', text],
    queryFn: () =>
      callTool<{ choices?: RefChoice[] } | null>('list-ref-choices', {
        kind: 'actor',
        query: text,
        filter: { playerOwned: false },
        limit: 8,
      }),
    enabled: text.length >= MIN_SEARCH,
    staleTime: 30_000,
    retry: false,
  });
  return text.length >= MIN_SEARCH ? (found.data?.choices ?? []) : [];
}

export function NpcStage(): JSX.Element {
  const toast = useToast();
  const combat = useCombat();
  const [query, setQuery] = useState('');
  const [nameKnown, setNameKnown] = useState(false);
  const [reply, setReply] = useState<StageReply | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = useNpcSearch(query);
  const fightNpcs = combat?.active ? combatNpcNames(combat.combatants) : [];

  const send = async (args: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    try {
      const r = await callTool<StageReply | null>('set-npc-on-stage', args);
      setReply(r);
      setQuery('');
    } catch (err) {
      toast(`✗ NPC on stage: ${errorText(err)}`, 'err');
    } finally {
      setBusy(false);
    }
  };
  const put = (pick: StagePick): void => void send(stageArgs(pick, nameKnown));

  return (
    <section className={styles['card']} id="npc-stage" aria-label="NPC on stage">
      <div className={styles['head']}>
        <h2 className={styles['title']}>🎭 NPC on stage</h2>
        <span className={styles['status']} aria-live="polite">
          {stageStatus(reply)}
        </span>
        {reply?.onStage ? (
          <Button
            type="button"
            data-track="dash.npc-stage.clear"
            disabled={busy}
            onClick={() => void send({ ...STAGE_CLEAR_ARGS })}
          >
            Off stage
          </Button>
        ) : null}
      </div>
      <div className={styles['row']}>
        <input
          className={styles['search']}
          type="search"
          placeholder="Find an NPC by name"
          aria-label="Find an NPC by name"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <label className={styles['known']}>
          <input
            type="checkbox"
            checked={nameKnown}
            onChange={e => setNameKnown(e.target.checked)}
          />{' '}
          The players know the name
        </label>
      </div>
      {choices.length > 0 || fightNpcs.length > 0 ? (
        <div className={styles['row']}>
          {choices.map(c => (
            <Button
              key={c.id}
              type="button"
              data-track="dash.npc-stage.pick"
              disabled={busy}
              title={c.detail}
              onClick={() => put({ actorId: c.id })}
            >
              {c.name}
            </Button>
          ))}
          {fightNpcs.map(name => (
            <Button
              key={`fight-${name}`}
              type="button"
              data-track="dash.npc-stage.fight"
              disabled={busy}
              title="In the fight"
              onClick={() => put({ actorName: name })}
            >
              {name}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
