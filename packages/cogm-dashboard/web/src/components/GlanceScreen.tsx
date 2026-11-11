// Table at a glance (item dashboard-glance-view): /?glance=1, one read-only page with three panels:
// the party's hit points and conditions, the fight in turn order with the current turn, and the
// current scene. Each panel says how fresh it is. The party and the scene are read again every
// 15 seconds through the dashboard's own tool route (no Claude connector); the fight comes over
// the live stream. GM only: a player never gets this page (lib/role.ts sends them to /player, and
// the tool route refuses them), so exact HP, enemy HP and hidden tokens stay on the GM's side.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type JSX } from 'react';

import { callTool } from '../lib/api';
import {
  GLANCE_REFRESH_MS,
  ageText,
  combatRows,
  isOld,
  partyRows,
  sceneName,
  turnLine,
} from '../lib/glance';
import { STANDARD_HREF } from '../lib/liveScreen';
import { useCombat, useDashboardStream, useStreamHeardAt } from '../lib/stream';
import { useWorldTheme } from '../lib/worldTheme';
import { HealthLine } from './HealthLine';
import { RoleNotice } from './RoleNotice';
import { StreamState } from './StreamState';
import styles from './GlanceScreen.module.css';

/** The clock the "x s ago" texts run on, once a second. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return (): void => window.clearInterval(timer);
  }, []);
  return now;
}

function Fresh({ at, now }: { at: number | null; now: number }): JSX.Element {
  const old = isOld(at, now);
  return (
    <span className={old ? styles['fresh-old'] : styles['fresh']} data-old={old ? 'true' : 'false'}>
      {old && at !== null ? 'Old: ' : ''}updated {ageText(at, now)}
    </span>
  );
}

function HpBar({ percent, tone }: { percent: number; tone: string }): JSX.Element {
  return (
    <span className={styles['bar']} aria-hidden="true">
      <span
        className={`${styles['fill']} ${tone ? styles[tone] : ''}`}
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

function PartyPanel({ now }: { now: number }): JSX.Element {
  const party = useQuery({
    queryKey: ['glance', 'party'],
    queryFn: () => callTool<unknown>('get-party', {}),
    refetchInterval: GLANCE_REFRESH_MS,
    // A phone that wakes up reads again at once instead of showing the old answer for a moment.
    refetchOnWindowFocus: 'always',
    retry: false,
  });
  const rows = partyRows(party.data);
  return (
    <section className={styles['panel']} id="glance-party" aria-labelledby="glance-party-h">
      <header className={styles['panel-head']}>
        <h2 id="glance-party-h">Party</h2>
        <Fresh at={party.dataUpdatedAt || null} now={now} />
      </header>
      {party.isError ? (
        <p className={styles['problem']} role="alert">
          Could not read the party{party.data ? ', showing the last answer' : ''}.
        </p>
      ) : null}
      {rows.length === 0 && !party.isPending ? (
        <p className={styles['empty']}>No party found.</p>
      ) : null}
      <ul className={styles['list']}>
        {rows.map(r => (
          <li
            key={r.id}
            className={`${styles['row']} ${styles['party-row']}`}
            data-down={r.down ? 'true' : 'false'}
          >
            <span className={styles['name']}>{r.name}</span>
            <span className={styles['hp']}>{r.down ? `Down ${r.hp}` : r.hp}</span>
            <HpBar percent={r.percent} tone={r.tone} />
            {r.conditions.length > 0 ? (
              <span className={styles['conditions']}>{r.conditions.join(', ')}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CombatPanel({ now }: { now: number }): JSX.Element {
  const combat = useCombat();
  // The fight is as fresh as the stream: it sends changes only, so a quiet fight is not an old one.
  // Before the stream has spoken, null means "not heard yet", not "no fight".
  const heardAt = useStreamHeardAt();
  const rows = combatRows(combat);
  return (
    <section className={styles['panel']} id="glance-combat" aria-labelledby="glance-combat-h">
      <header className={styles['panel-head']}>
        <h2 id="glance-combat-h">Fight</h2>
        <Fresh at={heardAt} now={now} />
      </header>
      {heardAt === null ? (
        <p className={styles['empty']}>Waiting for the live stream.</p>
      ) : rows === null ? (
        <p className={styles['empty']}>No fight right now.</p>
      ) : (
        <>
          <p className={styles['turn']} id="glance-turn">
            {turnLine(combat)}
          </p>
          <ol className={styles['list']}>
            {rows.map(r => (
              <li
                key={r.id}
                className={styles['row']}
                data-current={r.current ? 'true' : 'false'}
                data-side={r.side}
                data-defeated={r.defeated ? 'true' : 'false'}
              >
                <span className={styles['init']}>{r.initiative ?? '–'}</span>
                <span className={styles['name']}>
                  {r.current ? '▶ ' : ''}
                  {r.name}
                  {r.defeated ? ' (down)' : ''}
                </span>
                <span className={styles['hp']}>{r.hp}</span>
                <HpBar percent={r.percent} tone={r.tone} />
                {r.conditions.length > 0 ? (
                  <span className={styles['conditions']}>{r.conditions.join(', ')}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function ScenePanel({ now }: { now: number }): JSX.Element {
  const scene = useQuery({
    queryKey: ['glance', 'scene'],
    queryFn: () => callTool<unknown>('get-current-scene', { includeTokens: false }),
    refetchInterval: GLANCE_REFRESH_MS,
    refetchOnWindowFocus: 'always',
    retry: false,
  });
  const name = sceneName(scene.data);
  return (
    <section className={styles['panel']} id="glance-scene" aria-labelledby="glance-scene-h">
      <header className={styles['panel-head']}>
        <h2 id="glance-scene-h">Scene</h2>
        <Fresh at={scene.dataUpdatedAt || null} now={now} />
      </header>
      {scene.isError ? (
        <p className={styles['problem']} role="alert">
          Could not read the scene{scene.data ? ', showing the last answer' : ''}.
        </p>
      ) : null}
      <p className={styles['scene']} id="glance-scene-name">
        {name ?? (scene.isPending ? 'Loading' : 'No scene found')}
      </p>
    </section>
  );
}

export function GlanceScreen(): JSX.Element {
  useWorldTheme();
  useDashboardStream();
  const now = useNow();
  return (
    <>
      <header className="topbar" id="glance-header">
        <h1>Table at a glance</h1>
        <div className="controls">
          <StreamState />
          <HealthLine />
          <a className="btn" id="glance-back" href={STANDARD_HREF}>
            Back to the dashboard
          </a>
        </div>
      </header>
      <RoleNotice />
      <main className={styles['page']} id="glance-screen">
        <PartyPanel now={now} />
        <CombatPanel now={now} />
        <ScenePanel now={now} />
      </main>
    </>
  );
}
