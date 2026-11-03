import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { useState, type JSX } from 'react';

import {
  PARTY_QUERY_KEY,
  memberFacts,
  type LoadParty,
  type PartyMember,
  type PlanPace,
} from '../shared/party';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  load: LoadParty;
  planPace: PlanPace;
}

const hpClass = (r: number): string => (r <= 1 / 3 ? 'low' : r <= 2 / 3 ? 'mid' : '');

function MemberRow({ m }: { m: PartyMember }): JSX.Element {
  const chips = [...(m.exhaustion > 0 ? [`Exhaustion ${m.exhaustion}`] : []), ...m.conditions];
  const hp = m.hp && m.hp.max > 0 ? m.hp : null;
  const ratio = hp ? hp.value / hp.max : 0;
  return (
    <li className="spk-member">
      <div>
        <span className="spk-name">{m.name}</span>
        {m.inspiration && (
          <>
            {' '}
            <span className="spk-star" aria-hidden="true">
              ★
            </span>
            <span className="sr-only">Inspiration</span>
          </>
        )}
        <p className="spk-facts">{memberFacts(m)}</p>
        {chips.length > 0 && (
          <div className="spk-chips">
            {chips.map((c, i) => (
              <span key={i} className="spk-chip">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
      {hp && (
        <div className="spk-hp">
          {`${hp.value}/${hp.max}${hp.temp > 0 ? ` +${hp.temp}` : ''}`}
          <div className="spk-hp-bar">
            <div
              className={`spk-hp-fill ${hpClass(ratio)}`}
              style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
            />
          </div>
        </div>
      )}
    </li>
  );
}

export default function Party({ open, onOpenChange, load, planPace }: Props): JSX.Element {
  const client = useQueryClient();
  const party = useQuery({
    queryKey: PARTY_QUERY_KEY,
    queryFn: load,
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const pace = useMutation({
    mutationFn: (v: { groupId: string; pace: string }) => planPace(v.groupId, v.pace),
    onSuccess: () => client.invalidateQueries({ queryKey: PARTY_QUERY_KEY }),
  });
  const [groupId, setGroupId] = useState<string | null>(null);
  const groups = party.data?.groups ?? [];
  const group = groups.find(g => g.actorId === groupId) ?? groups[0];
  const sub = party.isPending
    ? 'Loading...'
    : group
      ? `${group.name}, level ${group.level}, ${group.members.length} members`
      : '';

  let body: JSX.Element;
  if (party.isPending) body = <p role="status">Loading the party...</p>;
  else if (party.isError)
    body = (
      <>
        <p role="alert" className="spk-error">
          Couldn&apos;t load the party: {party.error.message}
        </p>
        <button type="button" onClick={() => void party.refetch()}>
          Retry
        </button>
      </>
    );
  else if (!group)
    body = <p>No party yet. Create a Group actor in Foundry and set it as the primary party.</p>;
  else {
    const now = group.pace;
    body = (
      <>
        <ul className="spk-members" aria-label="Members">
          {group.members.map(m => (
            <MemberRow key={m.actorId} m={m} />
          ))}
        </ul>
        <h3>Travel pace</h3>
        {now ? (
          <>
            <p className="spk-facts">
              Now: <strong>{now.label}</strong>
            </p>
            <div className="spk-bar">
              {party.data.paceOptions.map(o => (
                <button
                  key={o.value}
                  type="button"
                  disabled={pace.isPending || o.value === now.value}
                  onClick={() => pace.mutate({ groupId: group.actorId, pace: o.value })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="spk-facts">This group has no travel pace.</p>
        )}
      </>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="spk-overlay" />
        <Dialog.Content className="spk-dialog">
          <div className="spk-head">
            <div>
              <Dialog.Title>Party</Dialog.Title>
              <Dialog.Description className="spk-sub">{sub}</Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close party">✕</Dialog.Close>
          </div>
          <div className="spk-bar">
            <button type="button" disabled={party.isFetching} onClick={() => void party.refetch()}>
              Refresh
            </button>
            {groups.length > 1 && group && (
              <select
                aria-label="Party group"
                value={group.actorId}
                onChange={e => setGroupId(e.target.value)}
              >
                {groups.map(g => (
                  <option key={g.actorId} value={g.actorId}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {body}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
