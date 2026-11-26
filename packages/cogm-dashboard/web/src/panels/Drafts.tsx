// Draft tray (I-069), in the Prep drawer: texts Claude drafted for players (read-aloud, NPC line,
// letter, recap). Nothing reaches a player until you publish it here, to chat for everyone or as a
// whisper. Edit the text first if you like; a draft that names a secret term (a dealt Tarokka
// card, say) is flagged and asks for a confirm. GM only, from /api/drafts (the bridge's drafts
// control method, which Claude cannot reach).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { useToast } from '../components/Toasts';
import { api, errorText } from '../lib/api';
import { Button, QueryState } from '../ui';

type DraftKind = 'read-aloud' | 'npc-line' | 'letter' | 'recap';
type DraftStatus = 'draft' | 'publishing' | 'published' | 'discarded';

interface Draft {
  id: string;
  kind: DraftKind;
  text: string;
  rev?: number;
  speaker?: string;
  whisperTo?: string;
  status: DraftStatus;
  secretTerms?: string[];
  lastError?: string;
}

const DRAFTS_KEY = ['drafts'] as const;

const KIND_TEXT: Record<DraftKind, string> = {
  'read-aloud': 'Read-aloud',
  'npc-line': 'NPC line',
  letter: 'Letter',
  recap: 'Recap',
};

const STATUS_TEXT: Record<DraftStatus, string> = {
  draft: 'waiting for you',
  publishing: 'posting now, or posted without being recorded: check the chat before reopening',
  published: 'published to chat',
  discarded: 'discarded',
};

interface PlayerName {
  userId: string;
  name: string;
}

async function load(): Promise<{ drafts: Draft[]; names: PlayerName[] }> {
  const [list, names] = await Promise.all([
    api<{ drafts?: Draft[] }>('/api/drafts'),
    api<PlayerName[]>('/api/player/names').catch((): PlayerName[] => []),
  ]);
  return { drafts: list.drafts ?? [], names };
}

export function DraftsSection({ open }: { open: boolean }): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: DRAFTS_KEY,
    queryFn: load,
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [whisper, setWhisper] = useState<Record<string, string>>({});

  async function run(key: string, path: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(key);
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      await queryClient.invalidateQueries({ queryKey: DRAFTS_KEY });
      return true;
    } catch (err) {
      toast(`✗ Drafts: ${errorText(err)}`, 'err');
      // The list may have changed behind the failure (a new flag, an edit): show it now.
      await queryClient.invalidateQueries({ queryKey: DRAFTS_KEY });
      return false;
    } finally {
      setBusy(null);
    }
  }

  function publish(draft: Draft): void {
    if (draft.secretTerms) {
      const ok = window.confirm(
        `This draft names ${draft.secretTerms.join(', ')}, which players may not know yet. Publish it anyway?`
      );
      if (!ok) return;
    }
    // The version and flags shown here are what the server checks, so text that changed since
    // (or a term first found now) is refused and the refreshed list shows it.
    void run(draft.id, '/api/drafts/publish', {
      id: draft.id,
      rev: draft.rev ?? 0,
      confirmedTerms: draft.secretTerms ?? [],
    }).then(ok => {
      if (ok) toast('Published to chat', 'ok');
    });
  }

  function reopen(draft: Draft): void {
    if (draft.status === 'publishing') {
      const ok = window.confirm(
        'This draft may already be in chat. Check the chat log first. Reopen it anyway?'
      );
      if (!ok) return;
    }
    void run(draft.id, '/api/drafts/reopen', {
      id: draft.id,
      confirmUnsure: draft.status === 'publishing',
    });
  }

  async function saveEdit(draft: Draft): Promise<void> {
    const text = editing[draft.id];
    if (text === undefined) return;
    const ok = await run(draft.id, '/api/drafts/edit', {
      id: draft.id,
      text,
      whisperTo: whisper[draft.id] ?? draft.whisperTo ?? '',
    });
    if (ok) endEdit(draft.id);
  }

  /** Close the editor and forget its Send to pick, so the next Edit starts from the draft. */
  function endEdit(id: string): void {
    setEditing(e => {
      const { [id]: _gone, ...rest } = e;
      return rest;
    });
    setWhisper(w => {
      const { [id]: _gone, ...rest } = w;
      return rest;
    });
  }

  return (
    <QueryState
      query={query}
      errorLabel="Couldn't load the draft tray"
      isEmpty={d => d.drafts.length === 0}
      empty="The tray is empty. Ask Claude to draft a read-aloud, NPC line, letter or recap."
    >
      {({ drafts, names }) => (
        <ul className="pf-list" id="drafts-list">
          {drafts.map(draft => {
            const isOpen = draft.status === 'draft';
            const text = editing[draft.id];
            return (
              <li key={draft.id} className="pf-row" data-draft-status={draft.status}>
                <span>
                  <strong>{KIND_TEXT[draft.kind]}</strong>
                  {draft.speaker && <span className="pf-detail"> · {draft.speaker}</span>}{' '}
                  <span className="pf-detail">
                    · {draft.whisperTo ? `whisper to ${draft.whisperTo}` : 'to everyone'} ·{' '}
                    {STATUS_TEXT[draft.status]}
                  </span>
                  <br />
                  {text !== undefined ? (
                    <>
                      <textarea
                        aria-label="Draft text"
                        rows={5}
                        value={text}
                        onChange={e => setEditing(s => ({ ...s, [draft.id]: e.target.value }))}
                      />
                      <br />
                      <label className="pf-detail">
                        Send to{' '}
                        <select
                          aria-label="Send to"
                          value={whisper[draft.id] ?? draft.whisperTo ?? ''}
                          onChange={e => setWhisper(s => ({ ...s, [draft.id]: e.target.value }))}
                        >
                          <option value="">Everyone</option>
                          {draft.whisperTo && !names.some(n => n.name === draft.whisperTo) && (
                            <option value={draft.whisperTo}>
                              {draft.whisperTo} (not a player)
                            </option>
                          )}
                          {names.map(n => (
                            <option key={n.userId} value={n.name}>
                              Whisper to {n.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : (
                    draft.text
                  )}
                  {draft.lastError && (
                    <span className="pf-detail">
                      <br />✗ {draft.lastError}
                    </span>
                  )}
                  {draft.secretTerms && (
                    <span className="pf-detail">
                      <br />⚠ Names {draft.secretTerms.join(', ')}.
                    </span>
                  )}
                </span>
                {isOpen && text === undefined && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      data-track="dash.drafts.publish"
                      disabled={busy !== null}
                      onClick={() => publish(draft)}
                    >
                      Publish
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      data-track="dash.drafts.edit"
                      disabled={busy !== null}
                      onClick={() => setEditing(s => ({ ...s, [draft.id]: draft.text }))}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      data-track="dash.drafts.discard"
                      disabled={busy !== null}
                      onClick={() => void run(draft.id, '/api/drafts/discard', { id: draft.id })}
                    >
                      Discard
                    </Button>
                  </>
                )}
                {isOpen && text !== undefined && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      data-track="dash.drafts.save"
                      disabled={busy !== null || !text.trim()}
                      onClick={() => void saveEdit(draft)}
                    >
                      Save
                    </Button>
                    <Button type="button" size="sm" onClick={() => endEdit(draft.id)}>
                      Cancel
                    </Button>
                  </>
                )}
                {(draft.status === 'discarded' || draft.status === 'publishing') && (
                  <Button
                    type="button"
                    size="sm"
                    data-track="dash.drafts.reopen"
                    disabled={busy !== null}
                    onClick={() => reopen(draft)}
                  >
                    Back to draft
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </QueryState>
  );
}
