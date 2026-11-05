// The live strip alone on a page (item live-strip-component): the dashboard at /?strip=1. It is
// the base the live screens build on: screen A puts the strip on top of the dashboard, screen B
// loads this page in a Foundry window about 400 px wide. It starts the dashboard stream itself,
// since the Dashboard that normally does is not on this page. In a Foundry window it also listens
// for the tokens the GM controls on the map (lib/mapPick.ts); opened by the GM page as its own
// window, it hears them from the GM page instead.
import { useCallback, useEffect, type JSX, type MouseEvent } from 'react';

import { GateTextContext, GmActionsGateContext } from '../lib/guarded';
import { listenForMapPick } from '../lib/mapPick';
import { useDashboardStream } from '../lib/stream';
import { LiveStrip } from './LiveStrip';
import { HealthLine } from './HealthLine';
import { RoleNotice } from './RoleNotice';

const STRIP_GATE_TEXT = 'GM Actions are off. Press Turn on in the strip.';

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
  // This page has no header or Pre-flight drawer: a refused click sends the focus to the strip's
  // own Turn on button.
  const openGate = useCallback((): void => {
    // A refusal can come before the note that holds the button has drawn: look after the next
    // frame. The first Turn on button can be a hidden one (a disabled control's note): take a shown one.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const buttons = document.querySelectorAll<HTMLElement>('[data-track="dash.live.turn-on"]');
        Array.from(buttons)
          .find(b => b.getClientRects().length > 0)
          ?.focus();
      })
    );
  }, []);
  return (
    <GmActionsGateContext.Provider value={openGate}>
      <GateTextContext.Provider value={STRIP_GATE_TEXT}>
        <main className="live-strip-page">
          <HealthLine />
          <RoleNotice />
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
      </GateTextContext.Provider>
    </GmActionsGateContext.Provider>
  );
}
