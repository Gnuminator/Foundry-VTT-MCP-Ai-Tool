// The live strip alone on a page (item live-strip-component): the dashboard at /?strip=1. It is
// the base the live screens build on: screen A puts the strip on top of the dashboard, screen B
// loads this page in a Foundry window about 400 px wide. It starts the dashboard stream itself,
// since the Dashboard that normally does is not on this page. In a Foundry window it also listens
// for the tokens the GM controls on the map (lib/mapPick.ts); opened by the GM page as its own
// window, it hears them from the GM page instead.
import { useEffect, type JSX, type MouseEvent } from 'react';

import { listenForMapPick } from '../lib/mapPick';
import { useDashboardStream } from '../lib/stream';
import { LiveStrip } from './LiveStrip';

/** Whether the GM page opened this window (no frame parent, an opener on this origin). */
function openedByGmPage(): boolean {
  try {
    return window.parent === window && window.opener !== null && window.name === 'fmb-gm-strip';
  } catch {
    return false;
  }
}

/** Focus the GM page that opened this window; only when it is gone does the link open /gm. */
function backToGmPage(event: MouseEvent<HTMLAnchorElement>): void {
  try {
    const opener = window.opener as Window | null;
    if (opener !== null && !opener.closed) {
      event.preventDefault();
      opener.focus();
    }
  } catch {
    // Fall through to the link.
  }
}

export function LiveStripPage(): JSX.Element {
  useDashboardStream();
  useEffect(() => listenForMapPick(), []);
  return (
    <main className="live-strip-page">
      {openedByGmPage() ? (
        <p className="live-strip-page-note">
          Map picks come from the GM page.{' '}
          <a href="/gm" target="_blank" rel="opener" onClick={backToGmPage}>
            Back to the GM page
          </a>
        </p>
      ) : null}
      <LiveStrip />
    </main>
  );
}
