// The GM health line (item gm-health-line): Dashboard, Bridge, Foundry and Last update, each a dot
// and a few words, on every GM page, so a dropped link never looks like a quiet table. The words
// come from lib/health.ts; this draws them and ticks once a second so "12 s ago" and the 45 s
// watchdog keep moving. The player page has its own small badge and does not use this.
import { useEffect, useState, type JSX } from 'react';

import { healthParts, healthTrouble, type HealthPart, type HealthTone } from '../lib/health';
import {
  useBridgeStatus,
  useRecordingHealth,
  useStreamHeardAt,
  useStreamLink,
} from '../lib/stream';

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
  const recording = useRecordingHealth();
  const parts = healthParts({ link, heardAt, status, now, recording });
  const trouble = healthTrouble(parts);
  // A dot's longer words open on a tap or Enter, not only as a hover title (a phone has no hover).
  const [open, setOpen] = useState<string | null>(null);
  const announcement = troubleAnnouncement(parts);
  return (
    <>
      <ul
        className="health-line"
        id="health-line"
        aria-label="Connection health"
        data-trouble={trouble ? '' : undefined}
      >
        {parts.map(p => (
          <li
            key={p.key}
            className="health-part"
            data-tone={p.tone}
            data-part={p.key}
            title={p.detail}
          >
            <span className={`dot ${DOT[p.tone]}`} aria-hidden="true" />
            <span className="health-label">{p.label}</span>{' '}
            <span className="health-text">{p.text}</span>
            {p.detail ? (
              <button
                type="button"
                className="health-more"
                aria-expanded={open === p.key}
                aria-label={`Details about ${p.label}`}
                onClick={() => setOpen(open === p.key ? null : p.key)}
              >
                ?
              </button>
            ) : null}
            {p.detail && open === p.key ? (
              <span className="health-detail" data-detail-for={p.key}>
                {p.detail}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {/* Read out when a part turns red or clears, not on every tick: the text changes only then. */}
      <span className="visually-hidden" role="status" aria-live="polite" data-health-status="">
        {announcement}
      </span>
    </>
  );
}

/** What a screen reader hears: the red parts by name, or nothing. Same string while the tones hold. */
export function troubleAnnouncement(parts: readonly HealthPart[]): string {
  const bad = parts.filter(p => p.tone === 'bad').map(p => p.label);
  return bad.length > 0 ? `Needs attention: ${bad.join(', ')}.` : '';
}
