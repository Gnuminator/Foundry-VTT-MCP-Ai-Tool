import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { ConfirmProvider } from './components/ConfirmDialog';
import { DrawerBackdrop, raiseDrawer } from './components/Drawer';
import { HelpProvider } from './components/Help';
import { useHelp } from './components/HelpButton';
import { HandoutsDrawer } from './panels/Handouts';
import { ModuleDiagnosticsPane } from './panels/ModuleDiagnostics';
import { PartyDrawer } from './panels/Party';
import { PlayerLinksPane } from './panels/PlayerLinks';
import { PrepDrawer } from './panels/Prep';
import {
  PreflightButton,
  PreflightDrawer,
  VersionBanner,
  usePreflightOnReconnect,
} from './panels/Preflight';
import { TarokkaDrawer } from './panels/Tarokka';
import { ToolsDrawer, type ToolRequest } from './panels/Tools';
import { api } from './lib/api';
import { GmActionsGateContext } from './lib/guarded';
import { useDashboardStream } from './lib/stream';
import { applyTheme } from './lib/theme';

/** The README brand's mark (docs/images/brand/logo.svg), coloured by themes/brand.css. */
function BrandMark(): JSX.Element {
  return (
    <svg className="brand-mark" viewBox="0 0 100 100">
      <circle className="mark-glow" cx="50" cy="31" r="16" />
      <polygon className="mark-hex" points="90,50 70,84.64 30,84.64 10,50 30,15.36 70,15.36" />
      <line className="mark-edge" x1="34" y1="63" x2="50" y2="31" />
      <line className="mark-edge" x1="34" y1="63" x2="66" y2="63" />
      <line className="mark-spark" x1="50" y1="31" x2="66" y2="63" />
      <circle className="mark-ring" cx="34" cy="63" r="4" />
      <circle className="mark-ring" cx="66" cy="63" r="4" />
      <circle className="mark-node" cx="50" cy="31" r="5.5" />
    </svg>
  );
}

/** The world's theme (/api/theme); until it answers, the cached one from main.tsx shows. */
function useWorldTheme(): void {
  const theme = useQuery({
    queryKey: ['theme'],
    queryFn: () => api<{ theme: string }>('/api/theme'),
    retry: false,
  });
  useEffect(() => {
    if (theme.data) applyTheme(theme.data.theme);
  }, [theme.data]);
}

/**
 * The new dashboard (D-109), served at /next/ next to the old page at /. Panels move here one
 * at a time; until the default switches, the old page stays the full dashboard.
 */
export function App(): JSX.Element {
  return (
    <HelpProvider>
      <ConfirmProvider>
        <Dashboard />
      </ConfirmProvider>
    </HelpProvider>
  );
}

/** The drawers this page has so far; each one's open state. */
type DrawerName = 'preflight' | 'prep' | 'party' | 'handouts' | 'tarokka' | 'tools';
const NO_DRAWERS: Record<DrawerName, boolean> = {
  preflight: false,
  prep: false,
  party: false,
  handouts: false,
  tarokka: false,
  tools: false,
};

function Dashboard(): JSX.Element {
  useWorldTheme();
  useDashboardStream();
  usePreflightOnReconnect();
  const [drawers, setDrawers] = useState(NO_DRAWERS);
  const setDrawer = (name: DrawerName, open: boolean): void =>
    setDrawers(d => ({ ...d, [name]: open }));
  const openHelp = useHelp();
  const [linksOpen, setLinksOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  // Tarokka's Show cards, here so Pre-flight can warn while it is on (both drawers can be open).
  const [tarokkaShown, setTarokkaShown] = useState(false);
  // A guarded change refused for GM Actions opens Pre-flight, whose Ready for session turns them
  // on (the old page opens the Tool runner's gate; the Tool runner points at its own gate bar).
  // Already open under another drawer, it comes to the top.
  const openGmActionsGate = useCallback(() => {
    setDrawers(d => ({ ...d, preflight: true }));
    raiseDrawer('preflight-drawer');
  }, []);
  // Another panel opens the Tool runner on a tool with its form filled in.
  const [toolRequest, setToolRequest] = useState<ToolRequest | null>(null);

  return (
    <GmActionsGateContext.Provider value={openGmActionsGate}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            <BrandMark />
          </span>
          <div>
            <h1>
              Foundry <span className="wordmark-ai">AI</span> Tool
            </h1>
            <p className="subtitle">New dashboard (preview)</p>
          </div>
        </div>
        <div className="controls">
          <PreflightButton
            open={drawers.preflight}
            onToggle={() => setDrawer('preflight', !drawers.preflight)}
          />
          <button
            id="btn-prep"
            className="btn"
            data-track="dash.header.prep"
            title="Session prep: last session, open threads, next session notes (GM only)"
            aria-expanded={drawers.prep}
            onClick={() => setDrawer('prep', !drawers.prep)}
          >
            📋 Prep
          </button>
          <button
            id="btn-party"
            className="btn"
            data-track="dash.header.party"
            title="The party: members at a glance, travel pace, combat and rests (GM only)"
            aria-expanded={drawers.party}
            onClick={() => setDrawer('party', !drawers.party)}
          >
            🛡 Party
          </button>
          <button
            id="btn-handouts"
            className="btn"
            data-track="dash.header.handouts"
            title="Handout queue and who has seen what (GM only)"
            aria-expanded={drawers.handouts}
            onClick={() => setDrawer('handouts', !drawers.handouts)}
          >
            📜 Handouts
          </button>
          <button
            id="btn-tarokka"
            className="btn"
            data-track="dash.header.tarokka"
            title="Tarokka reading (GM only)"
            aria-expanded={drawers.tarokka}
            onClick={() => setDrawer('tarokka', !drawers.tarokka)}
          >
            🃏 Tarokka
          </button>
          <button
            id="btn-tools"
            className="btn"
            data-track="dash.header.tools"
            title="Open the tool runner (run any bridge tool)"
            aria-expanded={drawers.tools}
            onClick={() => setDrawer('tools', !drawers.tools)}
          >
            🛠 Tools
          </button>
          <button
            className="btn"
            data-track="dash.header.player-links"
            title="Each player's private link to their own character sheet (GM only)"
            aria-expanded={linksOpen}
            onClick={() => setLinksOpen(open => !open)}
          >
            🔗 Player links
          </button>
          <button
            className="btn"
            data-track="dash.header.show-diagnostics"
            title="Errors and warnings from Foundry modules"
            aria-expanded={diagOpen}
            onClick={() => setDiagOpen(open => !open)}
          >
            🩺 Module diagnostics
          </button>
          <button
            className="btn"
            data-track="dash.header.guides"
            onClick={() => openHelp('README')}
          >
            📖 GM guides
          </button>
          <a className="btn" href="/">
            Full dashboard
          </a>
        </div>
      </header>
      <div className="link-banner" role="note">
        This is the new dashboard, still being built. Panels move here one at a time; the full
        dashboard is still at the main address.
      </div>
      <VersionBanner />
      <PlayerLinksPane open={linksOpen} onOpenChange={setLinksOpen} />
      <ModuleDiagnosticsPane open={diagOpen} onOpenChange={setDiagOpen} />
      <DrawerBackdrop
        shown={Object.values(drawers).some(Boolean)}
        onClose={() => setDrawers(NO_DRAWERS)}
      />
      <PreflightDrawer
        open={drawers.preflight}
        onOpenChange={open => setDrawer('preflight', open)}
        tarokkaShown={tarokkaShown}
        onHideTarokka={() => setTarokkaShown(false)}
      />
      <PrepDrawer
        open={drawers.prep}
        onOpenChange={open => setDrawer('prep', open)}
        onOpenPreflight={() => setDrawers(d => ({ ...d, prep: false, preflight: true }))}
      />
      <PartyDrawer open={drawers.party} onOpenChange={open => setDrawer('party', open)} />
      <HandoutsDrawer
        open={drawers.handouts}
        onOpenChange={open => setDrawer('handouts', open)}
        onQueuePage={sceneId => {
          setToolRequest(r => ({
            name: 'plan-page-reveal',
            prefill: { action: 'queue', ...(sceneId ? { sceneId } : {}) },
            seq: (r?.seq ?? 0) + 1,
          }));
          setDrawers(d => ({ ...d, handouts: false, tools: true }));
        }}
      />
      <TarokkaDrawer
        open={drawers.tarokka}
        onOpenChange={open => setDrawer('tarokka', open)}
        showCards={tarokkaShown}
        onShowCardsChange={setTarokkaShown}
      />
      <ToolsDrawer
        open={drawers.tools}
        onOpenChange={open => setDrawer('tools', open)}
        request={toolRequest}
      />
    </GmActionsGateContext.Provider>
  );
}
