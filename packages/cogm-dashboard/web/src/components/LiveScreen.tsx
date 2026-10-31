// Live screen A (item live-screen-a): the opt-in "Live" view of the dashboard at /?live=1, next to
// today's During view, which stays the default. One fixed page for the whole evening: the live
// strip on top, Party always open, Handouts, and "What just happened" as one list with Undo on
// each line, with a permanent "Undo: <last change>" and "Live play on" in the header. The page
// does not rearrange itself: nothing here shows or hides a panel (the strip's own fight and no-fight
// faces and the Start / End session button are the only things an event of the GM's changes).
// It draws the same components as the default dashboard (LiveStrip, the Party, Handouts and Recent
// Changes panels); the layout choices, the old-dashboard banner and the moment tabs are not here.
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState, type JSX } from 'react';

import { callTool } from '../lib/api';
import { AI_LIMIT, readAiChanges } from '../lib/changes';
import { GmActionsGateContext, useGuardedTools } from '../lib/guarded';
import { StripUndoContext, lastUndoable, undoLabel } from '../lib/liveStrip';
import { BACK_TO_STANDARD_TEXT, STANDARD_HREF } from '../lib/liveScreen';
import { CHANGES_KEY, useDashboardStream } from '../lib/stream';
import { RollNpcInitiativeContext } from '../lib/startCombat';
import { useWorldTheme } from '../lib/worldTheme';
import { Button, Popover } from '../ui';
import { focusedElement, useConfirm } from './ConfirmDialog';
import { DockContext } from './Drawer';
import { LivePlayLine } from './GmActionsSwitch';
import { useHelp } from './HelpButton';
import { LazyPanel, panelChunk, usePreloadPanels } from './LazyPanel';
import { LiveStrip } from './LiveStrip';
import { RoleNotice } from './RoleNotice';
import { SessionMarker } from './SessionMarker';
import { StreamState } from './StreamState';
import { ThemePicker } from './ThemePicker';
import { useToast } from './Toasts';
import styles from './LiveScreen.module.css';

const partyChunk = panelChunk(() =>
  import('../panels/Party').then(m => ({ default: m.PartyDrawer }))
);
const handoutsChunk = panelChunk(() =>
  import('../panels/Handouts').then(m => ({ default: m.HandoutsDrawer }))
);
const changesChunk = panelChunk(() => import('../panels/RecentChanges'));

const AI_KEY = [...CHANGES_KEY, 'ai'] as const;

/**
 * The permanent "Undo: <last change>" in the header. One click undoes the newest change the AI
 * made; only a destructive one asks first (the strip's Undo always asks). A refusal or failure
 * says why in a toast, and nothing is undone behind the GM's back.
 */
function HeaderUndo(): JSX.Element {
  const toast = useToast();
  const askConfirm = useConfirm();
  const { gated, call } = useGuardedTools();
  const [busy, setBusy] = useState(false);
  const changes = useQuery({
    queryKey: AI_KEY,
    queryFn: async () => readAiChanges(await callTool('list-recent-changes', { limit: AI_LIMIT })),
    retry: false,
  });
  const undoable = lastUndoable(changes.data ?? []);
  const off = busy || undoable === null;
  const undo = async (): Promise<void> => {
    if (!undoable || busy || gated('undo-change')) return;
    setBusy(true);
    try {
      if (undoable.risk === 'destructive') {
        const ok = await askConfirm({
          title: 'Undo',
          summary: `Undo ${undoable.summary}?`,
          diff: [],
          compact: true,
          confirmLabel: 'Undo',
          destructive: true,
          returnTo: focusedElement(),
        });
        if (!ok) return;
      }
      const done = await call(
        'undo-change',
        { changeId: undoable.changeId },
        { confirm: true, confirmDestructive: true },
        { checkIn: 'What just happened' }
      );
      if (done.status === 'done') toast(`✓ Undone: ${undoable.summary}`, 'ok');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      type="button"
      id="live-header-undo"
      className={styles['undo']}
      data-track="dash.live.header-undo"
      aria-disabled={off ? 'true' : undefined}
      title={undoable?.summary}
      onClick={() => {
        if (!off) void undo();
      }}
    >
      {changes.isPending ? 'Loading changes' : busy ? 'Undoing...' : undoLabel(undoable)}
    </Button>
  );
}

export function LiveScreen(): JSX.Element {
  useWorldTheme();
  useDashboardStream();
  usePreloadPanels([partyChunk, handoutsChunk, changesChunk], []);
  const openHelp = useHelp();
  const toast = useToast();
  // The slots the panels dock into; a panel waits for its slot (DockContext null) and then sits in it.
  const [partySlot, setPartySlot] = useState<HTMLElement | null>(null);
  const [handoutsSlot, setHandoutsSlot] = useState<HTMLElement | null>(null);
  const [changesSlot, setChangesSlot] = useState<HTMLElement | null>(null);
  // A refusal toast points at the header's Turn on button; there is no Pre-flight drawer to open.
  const openGate = useCallback((): void => {
    document.getElementById('btn-gm')?.focus();
  }, []);
  return (
    <GmActionsGateContext.Provider value={openGate}>
      <header className="topbar" id="live-header">
        <h1>Dashboard</h1>
        <div className="controls">
          <SessionMarker />
          <LivePlayLine />
          <StreamState />
          <HeaderUndo />
          <Button
            type="button"
            id="live-how-do-i"
            data-track="dash.live.how-do-i"
            title="The GM coach: how to do things during a session"
            onClick={() => openHelp('gm-coach')}
          >
            How do I...
          </Button>
          <Popover
            label="More"
            align="end"
            trigger={
              <Button type="button" id="live-more" data-track="dash.live.more">
                More
              </Button>
            }
          >
            <div className={styles['menu']}>
              <label className={styles['menuLabel']}>
                Theme
                <ThemePicker />
              </label>
              <a className="btn" href={STANDARD_HREF} data-track="dash.live.back">
                {BACK_TO_STANDARD_TEXT}
              </a>
              <a className="btn" href="/legacy/" data-track="dash.live.legacy">
                Old dashboard
              </a>
            </div>
          </Popover>
        </div>
      </header>
      <RoleNotice />
      <main className={styles['page']} id="live-screen">
        <RollNpcInitiativeContext.Provider value>
          {/* The header has the one Undo on this page. */}
          <StripUndoContext.Provider value={false}>
            <LiveStrip />
          </StripUndoContext.Provider>
        </RollNpcInitiativeContext.Provider>
        <div className={styles['grid']}>
          <DockContext.Provider value={partySlot}>
            <div className={styles['slot']} ref={setPartySlot} data-slot="party" />
            <LazyPanel
              chunk={partyChunk}
              shell={{ id: 'party-drawer', title: '🛡 Party' }}
              show
              open
              onOpenChange={() => undefined}
            />
          </DockContext.Provider>
          <div className={styles['side']}>
            <DockContext.Provider value={handoutsSlot}>
              <div className={styles['slot']} ref={setHandoutsSlot} data-slot="handouts" />
              <LazyPanel
                chunk={handoutsChunk}
                shell={{ id: 'handouts-drawer', title: '📜 Handouts' }}
                show
                open
                onOpenChange={() => undefined}
                onQueuePage={() =>
                  // Queueing a page is prep work and opens the Tool runner, which is not on this page.
                  toast(
                    `Queue pages in Handouts on the default dashboard (More: ${BACK_TO_STANDARD_TEXT}).`
                  )
                }
              />
            </DockContext.Provider>
            <DockContext.Provider value={changesSlot}>
              <div className={styles['slot']} ref={setChangesSlot} data-slot="changes" />
              <LazyPanel
                chunk={changesChunk}
                shell={{ id: 'pane-changes', title: 'What just happened', pane: true }}
                show
                oneList
              />
            </DockContext.Provider>
          </div>
        </div>
      </main>
    </GmActionsGateContext.Provider>
  );
}
