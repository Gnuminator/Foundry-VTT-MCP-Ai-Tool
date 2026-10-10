import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type JSX, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

import { AdvancedItem, AdvancedLabel, AdvancedMenu } from './components/AdvancedMenu';
import { ConfirmProvider } from './components/ConfirmDialog';
import {
  DuringBar,
  DuringMenuItems,
  LayoutTourGuide,
  LayoutTrialCard,
  useDuringLayout,
} from './components/During';
import {
  DockContext,
  DrawerBackdrop,
  isDocked,
  raiseDrawer,
  showDocked,
} from './components/Drawer';
import { FoldScope } from './components/Folds';
import { HelpProvider } from './components/Help';
import { useHelp } from './components/HelpButton';
import {
  DOCKS,
  MomentTabs,
  MomentViews,
  useDocks,
  useFocusAfterMoment,
  useMoment,
  type DockName,
  type Moment,
} from './components/Moments';
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
import { Button } from './ui';

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

/** Each drawer's element id (Drawer `id`), for raiseDrawer. */
const DRAWER_IDS: Record<DrawerName, string> = {
  preflight: 'preflight-drawer',
  prep: 'prep-drawer',
  party: 'party-drawer',
  handouts: 'handouts-drawer',
  tarokka: 'tarokka-drawer',
  tools: 'tools-drawer',
};

/** A drawer open over the page is closed when its moment docks it: it sits in the page now. */
function undock(drawers: Record<DrawerName, boolean>, moment: Moment): Record<DrawerName, boolean> {
  const docked = DOCKS[moment].filter(name => drawers[name]);
  if (docked.length === 0) return drawers;
  return { ...drawers, ...Object.fromEntries(docked.map(name => [name, false])) };
}

function Dashboard(): JSX.Element {
  useWorldTheme();
  useDashboardStream();
  usePreflightOnReconnect();
  const { moment, pick } = useMoment();
  const during = useDuringLayout(moment, () => pick('during'));
  const { slotRefs, dockOf } = useDocks(moment);
  const [drawers, setDrawers] = useState(NO_DRAWERS);
  const [seenMoment, setSeenMoment] = useState(moment);
  if (moment !== seenMoment) {
    setSeenMoment(moment);
    if (moment) setDrawers(d => undock(d, moment));
  }
  useFocusAfterMoment(moment);
  const docked = (name: DrawerName): boolean =>
    name !== 'tarokka' && name !== 'tools' && dockOf(name) !== null;
  const setDrawer = (name: DrawerName, open: boolean): void =>
    setDrawers(d => ({ ...d, [name]: open }));
  // The Advanced menu opens a drawer, as on the old page; one already open comes to the top and
  // takes the focus (the menu keeps its own close from moving it, and nothing opens to take it).
  // A docked one is already on screen: it scrolls into view and takes the focus instead.
  const openDrawer = (name: DrawerName): void => {
    // A folded During card opens first (and shows its body) so there is something to focus.
    if (moment === 'during' && (name === 'party' || name === 'handouts') && docked(name))
      flushSync(() => during.folds.open(name));
    if (showDocked(DRAWER_IDS[name])) return;
    setDrawer(name, true);
    raiseDrawer(DRAWER_IDS[name]);
    if (drawers[name]) document.getElementById(DRAWER_IDS[name])?.focus();
  };
  // A panel's `open`: docked counts as open, so it loads and counts its view while on screen.
  const shown = (name: DrawerName): boolean => drawers[name] || docked(name);
  const dock = (name: DockName, panel: ReactNode): JSX.Element => (
    <DockContext.Provider value={dockOf(name)}>
      {name === 'party' || name === 'handouts' ? (
        <FoldScope card={name} folds={during.folds} active={moment === 'during'}>
          {panel}
        </FoldScope>
      ) : (
        panel
      )}
    </DockContext.Provider>
  );
  const openHelp = useHelp();
  const [linksOpen, setLinksOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  // Tarokka's Show cards, here so Pre-flight can warn while it is on (both drawers can be open).
  const [tarokkaShown, setTarokkaShown] = useState(false);
  // A guarded change refused for GM Actions opens Pre-flight, whose Ready for session turns them
  // on (the old page opens the Tool runner's gate; the Tool runner points at its own gate bar).
  // Already open under another drawer, it comes to the top.
  // Docked in Before, the drawers over the page close so it shows, and it takes the focus once
  // they are gone.
  const [showPreflight, setShowPreflight] = useState(0);
  useEffect(() => {
    if (showPreflight > 0) showDocked(DRAWER_IDS.preflight);
  }, [showPreflight]);
  const openGmActionsGate = useCallback(() => {
    if (isDocked(DRAWER_IDS.preflight)) {
      setDrawers(NO_DRAWERS);
      setShowPreflight(n => n + 1);
      return;
    }
    setDrawers(d => ({ ...d, preflight: true }));
    raiseDrawer(DRAWER_IDS.preflight);
  }, []);
  // Prep's "Open Pre-flight": Prep closes when it floats, and Pre-flight opens. In Before both
  // sit in the page: Pre-flight scrolls into view and takes the focus.
  const openPreflightFromPrep = (): void => {
    if (showDocked(DRAWER_IDS.preflight)) {
      setDrawer('prep', false);
      return;
    }
    setDrawers(d => ({ ...d, prep: false, preflight: true }));
  };
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
        <MomentTabs moment={moment} onPick={pick} />
        <div className="controls">
          <PreflightButton
            open={shown('preflight')}
            onToggle={() => {
              if (!showDocked(DRAWER_IDS.preflight)) setDrawer('preflight', !drawers.preflight);
            }}
          />
          <AdvancedMenu>
            <AdvancedItem onSelect={() => openHelp('README')}>
              <Button id="btn-guides" data-track="dash.header.guides">
                📖 GM guides
              </Button>
            </AdvancedItem>
            <AdvancedLabel>Panels</AdvancedLabel>
            <AdvancedItem onSelect={() => openDrawer('prep')}>
              <Button
                id="btn-prep"
                data-track="dash.header.prep"
                title="Session prep: last session, open threads, next session notes (GM only)"
              >
                📋 Prep
              </Button>
            </AdvancedItem>
            <AdvancedItem onSelect={() => openDrawer('party')}>
              <Button
                id="btn-party"
                data-track="dash.header.party"
                title="The party: members at a glance, travel pace, combat and rests (GM only)"
              >
                🛡 Party
              </Button>
            </AdvancedItem>
            <AdvancedItem onSelect={() => openDrawer('handouts')}>
              <Button
                id="btn-handouts"
                data-track="dash.header.handouts"
                title="Handout queue and who has seen what (GM only)"
              >
                📜 Handouts
              </Button>
            </AdvancedItem>
            <AdvancedItem onSelect={() => openDrawer('tarokka')}>
              <Button
                id="btn-tarokka"
                data-track="dash.header.tarokka"
                title="Tarokka reading (GM only)"
              >
                🃏 Tarokka
              </Button>
            </AdvancedItem>
            <DuringMenuItems during={during} />
            <AdvancedLabel>Tools</AdvancedLabel>
            <AdvancedItem onSelect={() => openDrawer('tools')}>
              <Button
                id="btn-tools"
                data-track="dash.header.tools"
                title="Open the tool runner (run any bridge tool)"
              >
                🛠 Tools
              </Button>
            </AdvancedItem>
            <AdvancedItem
              onSelect={() => {
                setDiagOpen(!diagOpen);
                return !diagOpen;
              }}
            >
              <Button
                id="btn-show-diag"
                data-track="dash.header.show-diagnostics"
                title="Errors and warnings from Foundry modules"
              >
                🩺 Module diagnostics
              </Button>
            </AdvancedItem>
            <AdvancedItem
              onSelect={() => {
                setLinksOpen(!linksOpen);
                return !linksOpen;
              }}
            >
              <Button
                id="btn-show-links"
                data-track="dash.header.player-links"
                title="Each player's private link to their own character sheet (GM only)"
              >
                🔗 Player links
              </Button>
            </AdvancedItem>
          </AdvancedMenu>
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
      <MomentViews
        moment={moment}
        slotRefs={slotRefs}
        duringScreen={during.screen}
        duringBar={<DuringBar during={during} />}
        duringFolds={during.folds}
        beforeTop={<LayoutTrialCard during={during} />}
      />
      <LayoutTourGuide during={during} />
      <PlayerLinksPane open={linksOpen} onOpenChange={setLinksOpen} />
      <ModuleDiagnosticsPane open={diagOpen} onOpenChange={setDiagOpen} />
      <DrawerBackdrop
        shown={(Object.keys(drawers) as DrawerName[]).some(n => drawers[n] && !docked(n))}
        onClose={() => setDrawers(NO_DRAWERS)}
      />
      {dock(
        'preflight',
        <PreflightDrawer
          open={shown('preflight')}
          onOpenChange={open => setDrawer('preflight', open)}
          tarokkaShown={tarokkaShown}
          onHideTarokka={() => setTarokkaShown(false)}
        />
      )}
      {dock(
        'prep',
        <PrepDrawer
          open={shown('prep')}
          onOpenChange={open => setDrawer('prep', open)}
          onOpenPreflight={openPreflightFromPrep}
        />
      )}
      {dock(
        'party',
        <PartyDrawer open={shown('party')} onOpenChange={open => setDrawer('party', open)} />
      )}
      {dock(
        'handouts',
        <HandoutsDrawer
          open={shown('handouts')}
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
      )}
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
