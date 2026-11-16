// The opt-in screens behind one lazy import (item gm-page-wrapper): the entry only decides which
// one the address asks for (lib/liveScreen.ts), so the first load does not grow with each screen.
//  - gm: the GM page at /gm, Foundry and the live strip side by side.
//  - strip: /?strip=1, the live strip alone; the base the live screens build on.
//  - live: /?live=1, live screen A, the Live view next to During.
//  - glance: /?glance=1, Table at a glance: party, fight and scene on one read-only page (GM only).
import type { JSX } from 'react';

import type { OptInScreenName } from '../lib/liveScreen';
import { GlanceScreen } from './GlanceScreen';
import { GmPage } from './GmPage';
import { LiveScreen } from './LiveScreen';
import { LiveStripPage } from './LiveStripPage';

export function OptInScreen({ name }: { name: OptInScreenName }): JSX.Element {
  if (name === 'gm') return <GmPage />;
  if (name === 'strip') return <LiveStripPage />;
  if (name === 'glance') return <GlanceScreen />;
  return <LiveScreen />;
}
