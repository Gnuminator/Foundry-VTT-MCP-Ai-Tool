// The live strip alone on a page (item live-strip-component): the dashboard at /?strip=1. It is
// the base the live screens build on: screen A puts the strip on top of the dashboard, screen B
// loads this page in a Foundry window about 400 px wide. It starts the dashboard stream itself,
// since the Dashboard that normally does is not on this page. In a Foundry window it also listens
// for the tokens the GM controls on the map (lib/mapPick.ts).
import { useEffect, type JSX } from 'react';

import { listenForMapPick } from '../lib/mapPick';
import { useDashboardStream } from '../lib/stream';
import { LiveStrip } from './LiveStrip';

export function LiveStripPage(): JSX.Element {
  useDashboardStream();
  useEffect(() => listenForMapPick(), []);
  return (
    <main className="live-strip-page">
      <LiveStrip />
    </main>
  );
}
