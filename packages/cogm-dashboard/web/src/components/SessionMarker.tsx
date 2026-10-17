import { useMutation } from '@tanstack/react-query';
import type { JSX } from 'react';

import { callTool, errorText } from '../lib/api';
import { usePlaySession } from '../lib/session';
import { sessionLabel } from '../lib/sessionLabel';
import { useObsidianFileUrl } from '../lib/stream';
import { Button } from '../ui';

import { useToast } from './Toasts';

/**
 * The play session marker in the header (the old page's #session-control): the status, a button
 * that starts or ends the session, and a link to the campaign Home note in Obsidian when the
 * mirror is on. It writes only to the bridge vault's session log, never to the game, so it needs
 * no GM Actions switch and no confirm (tool-policy.ts LOG_ONLY_TOOLS on the server).
 */
export function SessionMarker(): JSX.Element {
  const toast = useToast();
  const { session, failed, refetch } = usePlaySession();
  const home = useObsidianFileUrl('Home');
  const open = session?.open === true;
  const mark = useMutation({
    mutationFn: (action: 'start' | 'end') => callTool('mark-play-session', { action }),
    onSuccess: (_, action) =>
      toast(action === 'start' ? '✓ Play session started' : '✓ Play session ended', 'ok'),
    onError: err => toast(`✗ mark-play-session: ${errorText(err)}`, 'err'),
    onSettled: async () => {
      const outcome = (await refetch()) as { error?: unknown };
      if (outcome.error) toast(`✗ get-play-session: ${errorText(outcome.error)}`, 'err');
    },
  });
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
        disabled={mark.isPending}
        onClick={() => mark.mutate(open ? 'end' : 'start')}
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
          title="Open the campaign Home note in Obsidian"
          aria-label="Open the campaign Home note in Obsidian"
        >
          📓
        </a>
      ) : null}
    </div>
  );
}
