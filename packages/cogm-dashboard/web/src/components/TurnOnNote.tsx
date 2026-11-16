import type { JSX } from 'react';

import type { LivePlay } from '../lib/livePlay';
import { offReason } from '../lib/liveSwitches';
import { Button } from '../ui';

/**
 * Next to a control that is disabled because live play is off: the one-line reason and the button
 * that turns it on (the same click as Start session's). Nothing when `off` is empty.
 */
export function TurnOnNote({
  live,
  off,
  id,
  unreadable,
}: {
  live: LivePlay;
  off: string[];
  id?: string;
  /** The words for "the switches cannot be read", when "live play" does not fit the control. */
  unreadable?: string;
}): JSX.Element | null {
  if (off.length === 0) return null;
  return (
    <span className="turn-on-note" {...(id ? { id } : {})}>
      <span>{offReason(off, unreadable)}.</span>{' '}
      <Button
        size="sm"
        data-track="dash.live.turn-on"
        busy={live.pending}
        busyLabel="Turning on..."
        onClick={live.turnOn}
      >
        Turn on
      </Button>
    </span>
  );
}
