// The GM health line (item gm-health-line): Dashboard, Bridge, Foundry and Last update, each a dot
// and a few words, on every GM page, so a dropped link never looks like a quiet table. The words
// come from lib/health.ts; this draws them and ticks once a second so "12 s ago" and the 45 s
// watchdog keep moving. The player page has its own small badge and does not use this.
import { useEffect, useState, type JSX } from 'react';

import { healthParts, healthTrouble, type HealthTone } from '../lib/health';
import { useBridgeStatus, useStreamHeardAt, useStreamLink } from '../lib/stream';

const DOT: Record<HealthTone, string> = {
  ok: 'dot-green',
  warn: 'dot-amber',
  bad: 'dot-red',
  unknown: 'dot-grey',
};

export function HealthLine(): JSX.Element {
  const link = useStreamLink();
  const heardAt = useStreamHeardAt();
  const status = useBridgeStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return (): void => clearInterval(timer);
  }, []);
  const parts = healthParts({ link, heardAt, status, now });
  const trouble = healthTrouble(parts);
  return (
    <ul
      className="health-line"
      id="health-line"
      aria-label="Connection health"
      data-trouble={trouble ? '' : undefined}
    >
      {parts.map(p => (
        <li key={p.key} className="health-part" data-tone={p.tone} data-part={p.key}>
          <span className={`dot ${DOT[p.tone]}`} aria-hidden="true" />
          <span className="health-label">{p.label}</span>{' '}
          <span className="health-text">{p.text}</span>
        </li>
      ))}
    </ul>
  );
}
