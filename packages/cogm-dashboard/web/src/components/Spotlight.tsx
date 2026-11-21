// Spotlight balance (I-177): who has had the table's attention. One bar per character for what they
// did (counted from the play log by the server), a second bar for speaking time while the Discord
// recorder runs, and a quiet hint only once the party has taken as many actions as the GM set.
// GM only (the data is on the GM stream alone, never on /player); the GM can hide the card.
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type JSX } from 'react';

import { callTool } from '../lib/api';
import { GAME_STATE_KEY } from '../lib/guarded';
import { REMEMBER, readText, writeChoice } from '../lib/remember';
import {
  DEFAULT_HINT_AFTER,
  buildSpotlight,
  readHintAfter,
  readSpotlight,
  spotlightHint,
  spotlightScope,
  speakingText,
} from '../lib/spotlight';
import { useRecordingHealth, useSpotlight } from '../lib/stream';

import styles from './Spotlight.module.css';

interface PartyNames {
  groups?: { members?: { name?: string }[] | null }[] | null;
}

/** The party's character names, so a character who has done nothing still has a row. Fetched only once the card has something to show, so an idle dashboard makes no extra get-party call. */
function useRoster(active: boolean): string[] {
  const party = useQuery({
    queryKey: [...GAME_STATE_KEY, 'spotlight-roster'],
    queryFn: () => callTool<PartyNames | null>('get-party', {}),
    staleTime: 60_000,
    retry: false,
    enabled: active,
  });
  const members = (party.data?.groups ?? []).flatMap(g => g.members ?? []);
  return [...new Set(members.flatMap(m => (typeof m.name === 'string' ? [m.name] : [])))];
}

export function Spotlight(): JSX.Element {
  const raw = useSpotlight();
  const snapshot = useMemo(() => readSpotlight(raw), [raw]);
  const speaking = useRecordingHealth()?.speaking ?? [];
  const roster = useRoster(snapshot.players.length > 0 || speaking.length > 0);
  const [hidden, setHidden] = useState(() => readText(REMEMBER.spotlightHidden, '') === '1');
  const [hintAfter, setHintAfter] = useState(() =>
    readHintAfter(readText(REMEMBER.spotlightHintAfter, String(DEFAULT_HINT_AFTER)))
  );

  const setHiddenSaved = (next: boolean): void => {
    setHidden(next);
    writeChoice(REMEMBER.spotlightHidden, next ? '1' : '');
  };

  if (hidden) {
    return (
      <div className={styles.hiddenRow}>
        <button type="button" className={styles.link} onClick={() => setHiddenSaved(false)}>
          Show spotlight balance
        </button>
      </div>
    );
  }

  const rows = buildSpotlight(snapshot, roster, speaking);
  const hint = spotlightHint(rows, hintAfter);
  const hasSpeaking = rows.some(r => r.speakingMs !== null);
  return (
    <section className={styles.card} aria-labelledby="spotlight-title" data-gm-only="">
      <header className={styles.head}>
        <h2 id="spotlight-title" className={styles.title}>
          Spotlight balance
        </h2>
        <span className={styles.sub}>{spotlightScope(snapshot.session)}</span>
        <button type="button" className={styles.link} onClick={() => setHiddenSaved(true)}>
          Hide
        </button>
      </header>
      {rows.length === 0 ? (
        <p className={styles.empty}>Nothing counted yet.</p>
      ) : (
        <ul className={styles.rows} aria-label="Spotlight per character">
          {rows.map(r => (
            <li key={r.name} className={styles.row}>
              <span className={styles.name}>{r.name}</span>
              <span className={styles.bars}>
                <span
                  className={styles.bar}
                  role="img"
                  aria-label={`${r.name}: ${r.actions} actions`}
                  style={{ width: `${Math.max(r.actionsBar * 100, r.actions > 0 ? 4 : 0)}%` }}
                />
                {hasSpeaking && (
                  <span
                    className={`${styles.bar} ${styles.speak}`}
                    role="img"
                    aria-label={
                      r.speakingMs === null
                        ? `${r.name}: no speaking time`
                        : `${r.name}: ${speakingText(r.speakingMs)} speaking`
                    }
                    style={{ width: `${Math.max(r.speakingBar * 100, r.speakingMs ? 4 : 0)}%` }}
                  />
                )}
              </span>
              <span className={styles.num}>
                {r.actions}
                {r.speakingMs !== null && ` · ${speakingText(r.speakingMs)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.hint} role="status">
        {hint}
      </p>
      <label className={styles.setting}>
        Hint after
        <input
          type="number"
          min={0}
          max={999}
          value={hintAfter}
          onChange={e => {
            const next = readHintAfter(e.target.value);
            setHintAfter(next);
            writeChoice(REMEMBER.spotlightHintAfter, String(next));
          }}
        />
        actions (0 = never)
      </label>
    </section>
  );
}
