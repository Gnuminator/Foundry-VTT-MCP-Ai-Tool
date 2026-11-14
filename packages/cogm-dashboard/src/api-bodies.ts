/**
 * What the dashboard's JSON routes answer with a 200, one type per route. The routes build their
 * answer `satisfies` these, and the browser tests (web/e2e `apiBody`) build their faked answers
 * from the same types, so a faked route cannot drift from the real one without a type error.
 * A new faked route goes into `ApiBodies` first.
 */
import type { GmPageInfo } from './gm-page.js';
import type { DashboardPreflightResult } from './preflight.js';
import type { SessionSwitches } from './session-switches.js';
import type { SpaceView } from './space-route.js';
import type { PlayerName } from './usage-route.js';

/** One row of GET /api/features (the module's feature switch, as the cards show it). */
export interface FeatureRow {
  id: string;
  name: string;
  enabled: boolean;
}

export interface FeaturesBody {
  features: FeatureRow[] | null;
  writesAllowed: boolean | null;
  error: string | null;
}

/** GET /api/session/switches. `switches` is null when the module cannot report them. */
export interface SessionSwitchesBody {
  switches: SessionSwitches | null;
  gmActionsEnabled: boolean;
  error: string | null;
}

/** GET /api/theme (and the stream's `theme` event). */
export interface ThemeBody {
  theme: string;
  themes: readonly string[];
}

export interface PlayerLinkRow {
  userId: string;
  name: string;
  link: string | null;
  createdAt: string | null;
}

export interface PlayerLinksBody {
  players: PlayerLinkRow[];
}

/** The 200 bodies by route path. */
export interface ApiBodies {
  '/api/features': FeaturesBody;
  '/api/gm-page': GmPageInfo;
  '/api/player-links': PlayerLinksBody;
  '/api/player/names': PlayerName[];
  '/api/preflight': DashboardPreflightResult;
  '/api/session/switches': SessionSwitchesBody;
  '/api/space': SpaceView;
  '/api/theme': ThemeBody;
}
