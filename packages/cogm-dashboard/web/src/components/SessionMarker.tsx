import { useState, type JSX } from 'react';

import { usePlaySessionMark } from '../lib/playSessionMark';
import { usePlaySession } from '../lib/session';
import { sessionLabel } from '../lib/sessionLabel';
import { useObsidianFileUrl } from '../lib/stream';
import { Button } from '../ui';

/**
 * The play session marker in the header (the old page's #session-control): the status, a button
 * that starts or ends the session, and a link to the campaign Home note in Obsidian when the
 * mirror is on. It writes only to the bridge vault's session log, never to the game, so it needs
 * no GM Actions switch and no confirm (tool-policy.ts LOG_ONLY_TOOLS on the server).
 */
export function SessionMarker(): JSX.Element {
  const { session, failed } = usePlaySession();
  const { mark, pending } = usePlaySessionMark();
  const home = useObsidianFileUrl('Home');
  const open = session?.open === true;
  // What the click asked for: the session flips to open before the call is done, so `open` would
  // name the opposite while the button is busy.
  const [asked, setAsked] = useState<'start' | 'end'>('start');
  return (
    <div
      className="session-control"
      id="session-control"
      title="Play session marker: writes only to the bridge vault's session log, never game state"
    >
      <span className="session-status" id="session-status">
        {sessionLabel(session, failed)}
      </span>
      <Button
        id="btn-session"
        data-track="dash.session.toggle"
        busy={pending}
        busyLabel={asked === 'end' ? 'Ending session...' : 'Starting session...'}
        onClick={() => {
          const next = open ? 'end' : 'start';
          setAsked(next);
          mark(next);
        }}
      >
        {open ? 'End session' : 'Start session'}
      </Button>
      {home ? (
        <a
          id="session-obsidian"
          className="link-btn"
          data-track="dash.session.open-obsidian"
          href={home}
          target="_blank"
          rel="noopener"
          aria-label="Open the campaign Home note in Obsidian"
        >
          📓
        </a>
      ) : null}
    </div>
  );
}
