// The whisper desk (item secret-ledger-whispers), on the live strip: pick a player, write a line,
// send. It goes out as a Foundry whisper (only that player and the GMs see it), as a private
// Discord message when the player has a Discord link, and it is written to the secret ledger so
// the GM, the session notes and Claude know afterwards who was told what. GM only, from
// /api/whisper. The words are in lib/whisper.ts.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { api, errorText } from '../lib/api';
import { LEDGER_KEY } from '../lib/ledger';
import { WHISPER_MAX, whisperDone, type WhisperAnswer } from '../lib/whisper';
import { Button } from '../ui';
import { useToast } from './Toasts';
import styles from './WhisperDesk.module.css';

interface PlayerName {
  userId: string;
  name: string;
}

export function WhisperDesk(): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const names = useQuery({
    queryKey: ['player-names'],
    queryFn: () => api<PlayerName[]>('/api/player/names'),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });
  const players = names.data ?? [];
  const chosen = players.find(p => p.userId === userId);
  const ready = chosen !== undefined && text.trim() !== '' && !busy;

  async function send(): Promise<void> {
    if (!chosen) return;
    setBusy(true);
    try {
      const answer = await api<WhisperAnswer>('/api/whisper', {
        method: 'POST',
        body: JSON.stringify({ userId: chosen.userId, name: chosen.name, text }),
      });
      const done = whisperDone(chosen.name, answer);
      toast(done.text, done.ok ? 'ok' : 'err');
      setText('');
      await queryClient.invalidateQueries({ queryKey: LEDGER_KEY });
    } catch (err) {
      toast(`✗ Whisper not sent: ${errorText(err)}`, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles['desk']} id="live-whisper">
      <Button
        type="button"
        size="sm"
        id="live-whisper-toggle"
        data-track="dash.live.whisper-toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        Whisper
      </Button>
      {open && (
        <div className={styles['form']}>
          <label>
            <span className={styles['label']}>To</span>
            <select
              id="live-whisper-player"
              value={userId}
              onChange={e => setUserId(e.target.value)}
            >
              <option value="">Pick a player</option>
              {players.map(p => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={styles['label']}>Whisper</span>
            <textarea
              id="live-whisper-text"
              rows={2}
              maxLength={WHISPER_MAX}
              value={text}
              onChange={e => setText(e.target.value)}
            />
          </label>
          <Button
            type="button"
            size="sm"
            id="live-whisper-send"
            data-track="dash.live.whisper-send"
            aria-disabled={ready ? undefined : 'true'}
            onClick={() => {
              if (ready) void send();
            }}
          >
            {busy ? 'Sending…' : 'Send whisper'}
          </Button>
          <span className={styles['hint']}>
            Foundry whisper, plus a Discord message if they are linked. Saved in Who knows what.
          </span>
        </div>
      )}
    </div>
  );
}
