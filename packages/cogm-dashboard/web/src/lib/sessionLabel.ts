// The header's play session status line (components/SessionMarker.tsx), apart from the component
// so a test can reach it without the dashboard's token and fetch code.
import type { PlaySession } from './session';

/** What the status line says: the old header's words, "Session: unknown" when a read failed. */
export function sessionLabel(
  session: PlaySession | undefined,
  failed: boolean,
  locale?: string
): string {
  if (!session) return failed ? 'Session: unknown' : 'Session: …';
  if (!session.open) return 'No session';
  if (!session.startedAt) return 'Session active';
  const started = new Date(session.startedAt);
  if (Number.isNaN(started.getTime())) return 'Session active';
  const time = started.toLocaleTimeString(locale ? [locale] : [], {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Session since ${time}`;
}
