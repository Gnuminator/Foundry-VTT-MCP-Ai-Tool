// Who knows what (item secret-ledger-whispers), in the Prep drawer: the GM-only ledger of who has
// heard which secret. Whispers from the whisper desk land here by themselves; the GM adds a
// secret or a private backstory by hand and ticks who knows it. GM only, from /api/ledger; the
// text never reaches the player page or the TV, and Claude reads it with get-secret-ledger.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { useToast } from '../components/Toasts';
import { api, errorText } from '../lib/api';
import { LEDGER_KEY, loadLedger, type LedgerEntry } from '../lib/ledger';
import { Button, QueryState } from '../ui';

interface PlayerName {
  userId: string;
  name: string;
}

const KIND_TEXT: Record<LedgerEntry['kind'], string> = {
  secret: 'Secret',
  backstory: 'Private backstory',
  whisper: 'Whisper',
};

/** "Only Jorr knows this" and the like, from the entry's own list. */
function whoLine(entry: LedgerEntry): string {
  const names = entry.knownBy.map(k => k.name);
  if (names.length === 0) return 'Nobody knows this yet';
  if (names.length === 1) return `Only ${names[0]} knows this`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} know this`;
}

const SHOWN = 30;

export function LedgerSection({ open }: { open: boolean }): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: LEDGER_KEY,
    queryFn: loadLedger,
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const names = useQuery({
    queryKey: ['player-names'],
    queryFn: () => api<PlayerName[]>('/api/player/names'),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });
  const [kind, setKind] = useState<'secret' | 'backstory'>('secret');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function post(path: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      await queryClient.invalidateQueries({ queryKey: LEDGER_KEY });
      return true;
    } catch (err) {
      toast(`✗ Who knows what: ${errorText(err)}`, 'err');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(): Promise<void> {
    const knownBy = (names.data ?? []).filter(p => picked.includes(p.userId));
    const ok = await post('/api/ledger', { kind, text, knownBy });
    if (ok) {
      setText('');
      setPicked([]);
    }
  }

  return (
    <QueryState
      query={query}
      errorLabel="Couldn't load who knows what"
      isEmpty={() => false}
      empty=""
    >
      {data => (
        <>
          <p className="pf-detail">
            GM only. Whispers you send from the strip are saved here. Claude can read this list; it
            never reaches the player page or the TV.
          </p>
          {data.entries.length === 0 && <p className="pf-detail">Nothing recorded yet.</p>}
          <ul className="pf-list" id="ledger-list">
            {data.entries.slice(0, SHOWN).map(entry => (
              <li key={entry.id} className="pf-row" data-ledger-kind={entry.kind}>
                <span>
                  <strong>{KIND_TEXT[entry.kind]}</strong>{' '}
                  <span className="pf-detail">
                    · 🔒 {whoLine(entry)}
                    {entry.pageName && ` · page ${entry.pageName}`}
                  </span>
                  <br />
                  {entry.text}
                </span>
                <Button
                  type="button"
                  size="sm"
                  data-track="dash.ledger.remove"
                  disabled={busy}
                  onClick={() => void post('/api/ledger/remove', { id: entry.id })}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {data.entries.length > SHOWN && (
            <p className="pf-detail">
              Showing the newest {SHOWN} of {data.entries.length}.
            </p>
          )}
          <details className="pf-detail">
            <summary>Add a secret</summary>
            <label>
              Kind{' '}
              <select
                value={kind}
                onChange={e => setKind(e.target.value === 'backstory' ? 'backstory' : 'secret')}
              >
                <option value="secret">Secret</option>
                <option value="backstory">Private backstory</option>
              </select>
            </label>
            <br />
            <textarea
              aria-label="What the secret is, in a line"
              rows={2}
              maxLength={600}
              placeholder="What it is, in a line. Not book text."
              value={text}
              onChange={e => setText(e.target.value)}
            />
            <br />
            <span>Who knows it: </span>
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
            <br />
            <Button
              type="button"
              size="sm"
              data-track="dash.ledger.add"
              disabled={busy || text.trim() === ''}
              onClick={() => void add()}
            >
              Save
            </Button>
          </details>
        </>
      )}
    </QueryState>
  );
}
