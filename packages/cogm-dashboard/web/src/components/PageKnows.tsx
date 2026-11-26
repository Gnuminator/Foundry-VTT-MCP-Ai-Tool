// The "who knows this" chip of a journal page (item secret-ledger-whispers), shown on the GM
// surfaces that display the page's text (the read-aloud drawer). "Only Jorr knows this", "Jorr
// and Mia know this" or "Nobody knows this yet" comes from the secret ledger; a page the ledger
// says nothing about shows a small "Mark who knows" button. The editor sets who knows the page.
// GM only: the ledger is never sent to the player page or the TV.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { api, errorText } from '../lib/api';
import { LEDGER_KEY, loadLedger, type LedgerEntry, type LedgerKnower } from '../lib/ledger';
import { Button } from '../ui';
import { useToast } from './Toasts';

interface PlayerName {
  userId: string;
  name: string;
}

/** The entry that marks this page, if any (the newest one wins; the chip reads them all). */
function pageEntry(entries: LedgerEntry[], pageId: string): LedgerEntry | undefined {
  return entries.find(e => e.pageId === pageId);
}

export function PageKnows({
  pageId,
  pageName,
}: {
  pageId: string;
  pageName: string;
}): JSX.Element | null {
  const toast = useToast();
  const queryClient = useQueryClient();
  const ledger = useQuery({ queryKey: LEDGER_KEY, queryFn: loadLedger, staleTime: 15_000 });
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const names = useQuery({
    queryKey: ['player-names'],
    queryFn: () => api<PlayerName[]>('/api/player/names'),
    enabled: editing,
    staleTime: 60_000,
    retry: false,
  });

  // A bridge too old for the ledger answers an error: show nothing rather than a broken chip.
  if (ledger.isError || !pageId) return null;
  const entries = ledger.data?.entries ?? [];
  const entry = pageEntry(entries, pageId);
  const line = ledger.data?.chips[pageId]?.line ?? null;

  function open(): void {
    setPicked(entry ? entry.knownBy.map(k => k.userId) : []);
    setEditing(true);
  }

  async function save(): Promise<void> {
    const knownBy: LedgerKnower[] = (names.data ?? [])
      .filter(p => picked.includes(p.userId))
      .map(p => ({ userId: p.userId, name: p.name }));
    try {
      if (entry) {
        await api('/api/ledger/known-by', {
          method: 'POST',
          body: JSON.stringify({ id: entry.id, knownBy }),
        });
      } else {
        await api('/api/ledger', {
          method: 'POST',
          body: JSON.stringify({
            kind: 'secret',
            text: `Page: ${pageName}`,
            knownBy,
            pageId,
            pageName,
          }),
        });
      }
      await queryClient.invalidateQueries({ queryKey: LEDGER_KEY });
      setEditing(false);
    } catch (err) {
      toast(`✗ Who knows: ${errorText(err)}`, 'err');
    }
  }

  async function clear(): Promise<void> {
    if (!entry) return;
    try {
      await api('/api/ledger/remove', { method: 'POST', body: JSON.stringify({ id: entry.id }) });
      await queryClient.invalidateQueries({ queryKey: LEDGER_KEY });
      setEditing(false);
    } catch (err) {
      toast(`✗ Who knows: ${errorText(err)}`, 'err');
    }
  }

  return (
    <span className="pf-detail" data-page-knows={pageId}>
      {line && (
        <span className="knows-chip" role="note" data-knows-line={line}>
          🔒 {line}
        </span>
      )}{' '}
      {!editing && (
        <Button
          type="button"
          size="sm"
          data-track="dash.readaloud.knows"
          aria-label={`${line ? 'Change who knows' : 'Mark who knows'} ${pageName}`}
          onClick={open}
        >
          {line ? 'Change' : 'Mark who knows'}
        </Button>
      )}
      {editing && (
        <span>
          {(names.data ?? []).map(p => (
            <label key={p.userId} style={{ marginRight: '0.6rem' }}>
              <input
                type="checkbox"
                checked={picked.includes(p.userId)}
                onChange={e =>
                  setPicked(prev =>
                    e.target.checked ? [...prev, p.userId] : prev.filter(id => id !== p.userId)
                  )
                }
              />{' '}
              {p.name}
            </label>
          ))}
          <Button type="button" size="sm" onClick={() => void save()}>
            Save
          </Button>{' '}
          {entry && (
            <Button type="button" size="sm" onClick={() => void clear()}>
              Remove mark
            </Button>
          )}{' '}
          <Button type="button" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <br />
          <span className="pf-detail">
            Tick everyone who knows what this page says. None ticked means nobody knows it yet.
          </span>
        </span>
      )}
    </span>
  );
}
