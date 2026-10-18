// The one mark in the header for the live stream itself (the EventSource, lib/stream.ts): shown
// when the page has lost its link to the dashboard server, once for every panel, so no panel needs
// its own. The old page turned a status dot red for this. Not the same as the bridge being away
// (lib/combat.ts bridgeAway): that is the server losing Foundry, and each panel says it for itself.
import type { JSX } from 'react';

import { useStreamTrouble } from '../lib/stream';

/** What the header says for each kind of trouble, and what the GM can do about it. */
export const STREAM_TEXT = {
  dropped: {
    label: 'Connection lost, reconnecting…',
    detail:
      'This page lost its live link to the dashboard server. What you see may be out of date. It reconnects by itself.',
  },
  closed: {
    label: 'Connection closed: reload the page',
    detail:
      'The dashboard server keeps refusing the live link. This page still tries now and then; reload the page to get it back at once.',
  },
} as const;

export function StreamState(): JSX.Element {
  const trouble = useStreamTrouble();
  return (
    // The status element is always in the page (and takes no space of its own), so a screen reader
    // hears the text when it appears.
    <span id="stream-state" role="status" className="stream-state">
      {trouble ? (
        <span className="status-pill" data-stream={trouble} title={STREAM_TEXT[trouble].detail}>
          <span className="dot dot-red" aria-hidden="true" />
          {STREAM_TEXT[trouble].label}
          {/* The title is for the mouse; this is for a screen reader and a touch screen. */}
          <span className="visually-hidden"> {STREAM_TEXT[trouble].detail}</span>
        </span>
      ) : null}
    </span>
  );
}
