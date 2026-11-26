// Omens by post (I-181), in the Prep drawer: the short private texts Claude drafted, one per
// player. Approve each (or reject it); the Discord bot then sends only approved ones, to that
// player's own Discord account. A player with no Discord id yet is linked here. GM only, from
// /api/omens (the bridge's omens control method, which Claude cannot reach).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { useToast } from '../components/Toasts';
import { api, errorText } from '../lib/api';
import { Button, QueryState } from '../ui';

type OmenStatus = 'draft' | 'approved' | 'rejected' | 'sending' | 'sent' | 'failed';

interface Omen {
  id: string;
  userId: string;
  kind?: 'omen' | 'whisper';
  text: string;
  status: OmenStatus;
  secretTerms?: string[];
  lastError?: string;
}

interface OmensData {
  omens: Omen[];
  /** Foundry user id to Discord id. */
  players: Record<string, string>;
  names: PlayerName[];
}

interface PlayerName {
  userId: string;
  name: string;
}

const OMENS_KEY = ['omens'] as const;

const STATUS_TEXT: Record<OmenStatus, string> = {
  draft: 'waiting for you',
  approved: 'approved, goes out within a few minutes',
  rejected: 'rejected',
  sending: 'sending now, or sent without being recorded: check their Discord before reopening',
  sent: 'sent',
  failed: 'could not be sent',
};

async function load(): Promise<OmensData> {
  const [list, names] = await Promise.all([
    api<{ omens?: Omen[]; players?: Record<string, string> }>('/api/omens'),
    api<PlayerName[]>('/api/player/names').catch((): PlayerName[] => []),
  ]);
  return { omens: list.omens ?? [], players: list.players ?? {}, names };
}

export function OmensSection({ open }: { open: boolean }): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: OMENS_KEY,
    queryFn: load,
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [discordDraft, setDiscordDraft] = useState<Record<string, string>>({});

  async function run(key: string, path: string, body: Record<string, unknown>): Promise<void> {
    setBusy(key);
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      await queryClient.invalidateQueries({ queryKey: OMENS_KEY });
    } catch (err) {
      toast(`✗ Omens: ${errorText(err)}`, 'err');
    } finally {
      setBusy(null);
    }
  }

  function decide(omen: Omen, decision: 'approve' | 'reject' | 'reopen'): void {
    if (decision === 'approve' && omen.secretTerms) {
      const ok = window.confirm(
        `This omen names ${omen.secretTerms.join(', ')}, which players may not know yet. Approve it anyway?`
      );
      if (!ok) return;
    }
    if (decision === 'reopen' && omen.status === 'sending') {
      const ok = window.confirm(
        'This omen may already have reached the player. Check their Discord first. Reopen it anyway?'
      );
      if (!ok) return;
    }
    void run(omen.id, '/api/omens/decide', {
      id: omen.id,
      decision,
      confirmFlagged: omen.secretTerms !== undefined,
      confirmUnsure: omen.status === 'sending',
    });
  }

  return (
    <QueryState
      query={query}
      errorLabel="Couldn't load the omens"
      isEmpty={d => d.omens.length === 0 && d.names.length === 0}
      empty="No omens yet. Ask Claude to draft one per player."
    >
      {data => (
        <>
          {data.omens.length === 0 && (
            <p className="pf-detail">No omens yet. Ask Claude to draft one per player.</p>
          )}
          <ul className="pf-list" id="omens-list">
            {data.omens.map(omen => (
              <li key={omen.id} className="pf-row" data-omen-status={omen.status}>
                <span>
                  <strong>
                    {data.names.find(p => p.userId === omen.userId)?.name ?? 'Unknown player'}
                  </strong>
                  {omen.kind === 'whisper' && ' (whisper desk)'}{' '}
                  <span className="pf-detail">
                    · {STATUS_TEXT[omen.status]}
                    {data.players[omen.userId] === undefined &&
                      ' · no Discord id yet, it cannot be sent'}
                  </span>
                  <br />
                  {omen.text}
                  {omen.lastError && (
                    <span className="pf-detail">
                      <br />✗ {omen.lastError}
                    </span>
                  )}
                  {omen.secretTerms && (
                    <span className="pf-detail">
                      <br />⚠ Names {omen.secretTerms.join(', ')}.
                    </span>
                  )}
                </span>
                {(omen.status === 'draft' ||
                  omen.status === 'rejected' ||
                  omen.status === 'failed') && (
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    data-track="dash.omens.approve"
                    disabled={busy !== null}
                    onClick={() => decide(omen, 'approve')}
                  >
                    Approve
                  </Button>
                )}
                {omen.status === 'draft' && (
                  <Button
                    type="button"
                    size="sm"
                    data-track="dash.omens.reject"
                    disabled={busy !== null}
                    onClick={() => decide(omen, 'reject')}
                  >
                    Reject
                  </Button>
                )}
                {(omen.status === 'approved' ||
                  omen.status === 'sending' ||
                  omen.status === 'failed' ||
                  omen.status === 'rejected') && (
                  <Button
                    type="button"
                    size="sm"
                    data-track="dash.omens.reopen"
                    disabled={busy !== null}
                    onClick={() => decide(omen, 'reopen')}
                  >
                    Back to draft
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <details className="pf-detail">
            <summary>Discord ids for omens</summary>
            {data.names.map(p => (
              <div key={p.userId}>
                {p.name}{' '}
                {data.players[p.userId] ? (
                  <>
                    <span>linked to Discord id {data.players[p.userId]}</span>{' '}
                    <Button
                      type="button"
                      size="sm"
                      data-track="dash.omens.unlink"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(p.userId, '/api/omens/player', {
                          userId: p.userId,
                          discordId: null,
                        })
                      }
                    >
                      Unlink
                    </Button>
                  </>
                ) : (
                  <>
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label={`Discord user id for ${p.name}`}
                      placeholder="Discord user id (digits)"
                      value={discordDraft[p.userId] ?? ''}
                      onChange={e => setDiscordDraft(d => ({ ...d, [p.userId]: e.target.value }))}
                    />{' '}
                    <Button
                      type="button"
                      size="sm"
                      data-track="dash.omens.link"
                      disabled={busy !== null || !(discordDraft[p.userId] ?? '').trim()}
                      onClick={() =>
                        void run(p.userId, '/api/omens/player', {
                          userId: p.userId,
                          discordId: (discordDraft[p.userId] ?? '').trim(),
                        })
                      }
                    >
                      Link
                    </Button>
                  </>
                )}
              </div>
            ))}
          </details>
        </>
      )}
    </QueryState>
  );
}
