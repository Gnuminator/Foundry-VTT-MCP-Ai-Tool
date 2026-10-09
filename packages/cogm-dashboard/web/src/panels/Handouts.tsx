// Handouts (I-039): the reveal queue and who has seen what, from the bridge's list-revealed-pages.
// "Reveal next" is a guarded reveal of the next queued page for the active scene, applied after
// the confirm window (reveals are destructive: players see them at once). Remove takes a page off
// the queue, a plain call that changes nothing in Foundry, so it needs no GM Actions. GM only, and
// spoiler safe: titles and player names only, never a page's text.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type JSX } from 'react';

import { Drawer, DrawerClose } from '../components/Drawer';
import { useToast } from '../components/Toasts';
import { api, callTool, errorText } from '../lib/api';
import { failCode, useGuardedChange } from '../lib/guarded';
import { HANDOUTS_KEY } from '../lib/stream';
import { usage } from '../lib/usage';

/** A player's first open of a handout (handouts/queue.ts SeenEntry on the bridge). */
interface SeenEntry {
  userId: string;
  name: string;
  at: string;
}

/** A revealed page (handouts/service.ts RevealedPageView); the fields shown here. */
interface RevealedPage {
  uuid: string;
  title: string | null;
  exists: boolean;
  observable: boolean;
  feature: string;
  copiedFrom?: string;
  /** Foundry user ids; absent means every player. */
  players?: string[];
  seenBy?: SeenEntry[];
}

/** A queued page (handouts/service.ts QueuedPageView). */
interface QueuedPage {
  entryId: string;
  uuid: string;
  title: string | null;
  exists: boolean;
  sceneId: string | null;
  players?: string[];
}

/** One player's display name (GET /api/player/names). */
interface PlayerName {
  userId: string;
  name: string;
}

interface Scene {
  id: string;
  name: string;
  active?: boolean;
}

interface HandoutsState {
  pages: RevealedPage[];
  queue: QueuedPage[];
  sceneNames: Record<string, string>;
  activeSceneId: string | null;
  players: PlayerName[];
}

/** The unqueue answer (QueueChangeView): no plan, nothing to apply. */
interface QueueChange {
  note?: string;
}

const list = <T,>(x: T[] | null | undefined): T[] => (Array.isArray(x) ? x : []);

/**
 * Loads the drawer: the queue and the seen log, the scenes (for the scene names and which one is
 * active) and the player names. Only list-revealed-pages failing fails the load; without scenes
 * "Reveal next" takes a page queued for any scene, and without names the ticks show user ids.
 */
async function loadHandouts(): Promise<HandoutsState> {
  const [view, scenes, players] = await Promise.all([
    callTool<{ pages?: RevealedPage[]; queue?: QueuedPage[] } | null>('list-revealed-pages', {}),
    callTool<Scene[] | { scenes?: Scene[] } | null>('list-scenes', {}).catch(() => []),
    api<PlayerName[]>('/api/player/names').catch((): PlayerName[] => []),
  ]);
  const sceneList = Array.isArray(scenes) ? scenes : list(scenes?.scenes);
  return {
    pages: list(view?.pages),
    queue: list(view?.queue),
    sceneNames: Object.fromEntries(sceneList.map(s => [s.id, s.name])),
    activeSceneId: sceneList.find(s => s.active)?.id ?? null,
    players: list(players),
  };
}

/** The queue entry "Reveal next" takes: the oldest for the active scene or for any scene. */
function nextQueued(s: HandoutsState): QueuedPage | null {
  return (
    s.queue.find(
      q => q.sceneId === null || s.activeSceneId === null || q.sceneId === s.activeSceneId
    ) ?? null
  );
}

/** Opened 19:05: the time only, 24-hour, as the old page shows it. */
const openedAt = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export function HandoutsDrawer({
  open,
  onOpenChange,
  onQueuePage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "+ Queue a page": the Tool runner on plan-page-reveal, queue, for the active scene if known. */
  onQueuePage: (sceneId: string | null) => void;
}): JSX.Element {
  const toast = useToast();
  const runChange = useGuardedChange();
  // Loads on every opening (stale at once), after a change or undo while open, and when the
  // stream says a player opened a handout (handouts-seen).
  const handouts = useQuery({
    queryKey: HANDOUTS_KEY,
    queryFn: loadHandouts,
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  // "Show it now" is off unless ticked for this reveal, and goes back to off after every attempt.
  const [showNow, setShowNow] = useState(false);
  // One reveal at a time; the ref also catches a double click before the re-render.
  const [revealing, setRevealing] = useState(false);
  const revealingRef = useRef(false);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    usage().trackView('dash.handouts.view');
    return (): void => {
      usage().endView('dash.handouts.view');
      setShowNow(false);
    };
  }, [open]);

  // A failed reload keeps the last rows and says so in the queue, as on the old page.
  const s = handouts.data;
  const next = s ? nextQueued(s) : null;
  const nameOf = (userId: string): string =>
    s?.players.find(p => p.userId === userId)?.name ?? userId;
  const audienceText = (players: string[] | undefined): string =>
    Array.isArray(players) && players.length > 0
      ? `for ${players.map(nameOf).join(', ')}`
      : 'for every player';

  const revealNext = (): void => {
    if (revealingRef.current || !s) return;
    revealingRef.current = true;
    setRevealing(true);
    const args = {
      action: 'reveal-next',
      ...(s.activeSceneId ? { sceneId: s.activeSceneId } : {}),
      ...(showNow ? { showNow: true } : {}),
    };
    // Reloads after every attempt, as the old page does: a cancelled or failed reveal may still
    // have changed the queue. An apply already started a reload (GAME_STATE_KEY); this joins it.
    // The button waits for the reload, so it never offers the page just revealed a second time.
    void runChange('plan-page-reveal', args).finally(() => {
      setShowNow(false);
      void handouts.refetch({ cancelRefetch: false }).finally(() => {
        revealingRef.current = false;
        setRevealing(false);
        setRefocus(true);
      });
    });
  };

  // The confirm window parks focus on the drawer while Reveal next is disabled and gives it back
  // when the button is enabled again. A reveal that never opened the window (a failed plan) leaves
  // focus on the page body, where the disabled button dropped it. Either way, once the reveal is
  // over and the queue reloaded, the button takes focus if there is a next page, else the drawer
  // does (never the page body). Focus the GM moved elsewhere meanwhile stays put.
  const [refocus, setRefocus] = useState(false);
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!refocus) return;
    setRefocus(false);
    const button = nextRef.current;
    if (!button) return;
    const drawer = button.closest<HTMLElement>('[role="dialog"]');
    const active = document.activeElement;
    if (active !== document.body && active !== drawer && active !== button) return;
    if (button.disabled) drawer?.focus();
    else button.focus();
  }, [refocus]);

  // Not a guarded change: no plan to apply and nothing changes in Foundry, so no GM Actions gate.
  // The old page says nothing when it works; the toast here says the row went on purpose, as
  // a guarded change reports its result.
  const unqueue = (uuid: string): void => {
    setRemoving(uuid);
    callTool<QueueChange | null>('plan-page-reveal', { action: 'unqueue', pageUuid: uuid })
      .then(
        result => {
          usage().trackTool('plan-page-reveal', 'ok');
          toast(typeof result?.note === 'string' ? `✓ ${result.note}` : '✓ plan-page-reveal', 'ok');
        },
        (err: unknown) => {
          usage().trackTool('plan-page-reveal', 'error', failCode(err));
          toast(`✗ plan-page-reveal: ${errorText(err)}`, 'err');
        }
      )
      .finally(() => {
        setRemoving(null);
        void handouts.refetch();
      });
  };

  const queueBlock = handouts.isError ? (
    <li className="empty">Couldn&apos;t load the handouts: {errorText(handouts.error)}</li>
  ) : !s ? (
    <li className="empty">Loading…</li>
  ) : s.queue.length === 0 ? (
    <li className="empty">
      Nothing queued. Queue pages during prep, then reveal each in one click.
    </li>
  ) : (
    s.queue.map(q => (
      <li
        key={q.entryId}
        className={`preflight-item${next?.entryId === q.entryId ? ' pf-info' : ''}`}
      >
        <span className="pf-text">
          <span className="pf-label">
            {q.title || 'Untitled'}
            {!q.exists && (
              <>
                {' '}
                <span className="pf-detail">(page deleted)</span>
              </>
            )}
          </span>
          <span className="pf-detail">
            {q.sceneId ? (s.sceneNames[q.sceneId] ?? 'another scene') : 'any scene'} ·{' '}
            {audienceText(q.players)}
          </span>
        </span>
        <button
          type="button"
          className="btn btn-small"
          data-track="dash.handouts.unqueue"
          disabled={removing === q.uuid}
          onClick={() => unqueue(q.uuid)}
        >
          Remove
        </button>
      </li>
    ))
  );

  const shown = list(s?.pages).filter(p => p.feature === 'handouts' || p.copiedFrom);
  const revealedBlock = !s ? null : shown.length === 0 ? (
    <li className="empty">No handout revealed yet.</li>
  ) : (
    shown.map(p => {
      // The ticks follow the audience: everyone known when the page is for every player.
      const audience =
        Array.isArray(p.players) && p.players.length > 0 ? p.players : s.players.map(n => n.userId);
      const seen = new Map(list(p.seenBy).map(e => [e.userId, e]));
      return (
        <li key={p.uuid} className="preflight-item">
          <span className="pf-text">
            <span className="pf-label">{p.exists ? p.title || 'Untitled' : '(page deleted)'}</span>
            <span className="pf-detail">
              {audienceText(p.players)}
              {p.observable ? '' : ' · not visible in Foundry'}
            </span>
            <span className="seen-row">
              {audience.length === 0 ? (
                <span className="pf-detail">No players known yet.</span>
              ) : (
                audience.map(id => {
                  const e = seen.get(id);
                  return (
                    <span
                      key={id}
                      className={`seen-tick${e ? ' seen' : ''}`}
                      title={e ? `Opened ${openedAt(e.at)}` : 'Not opened yet'}
                    >
                      {`${e ? '✓' : '·'} ${nameOf(id)}`}
                    </span>
                  );
                })
              )}
            </span>
          </span>
        </li>
      );
    })
  );

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      id="handouts-drawer"
      title="📜 Handouts"
      sub="GM only. Queue pages, reveal the next in one click."
      help="dashboard#the-handout-drawer--handouts"
      close={<DrawerClose id="handouts-close" data-track="dash.handouts.close" />}
      onEscape={() => usage().track('shortcut', 'dash.shortcut.escape-handouts')}
      actions={
        <>
          <button
            className="btn btn-primary"
            id="handouts-next"
            ref={nextRef}
            data-track="dash.handouts.reveal-next"
            disabled={!next || revealing}
            onClick={revealNext}
          >
            {next ? `Reveal next: ${next.title || 'Untitled'}` : 'Reveal next'}
          </button>
          <label className="show-now" htmlFor="handouts-show-now">
            <input
              type="checkbox"
              id="handouts-show-now"
              data-track="dash.handouts.show-now"
              checked={showNow}
              onChange={e => setShowNow(e.target.checked)}
            />{' '}
            Show it now
          </label>
          {/* Opens the Tool runner with the form filled in; the GM picks the page and runs it. */}
          <button
            className="btn"
            id="handouts-add"
            data-track="dash.handouts.queue-page"
            title="Queue a page for later: opens the tool runner on plan-page-reveal"
            onClick={() => onQueuePage(s?.activeSceneId ?? null)}
          >
            + Queue a page
          </button>
          <button
            className="btn"
            id="handouts-refresh"
            data-track="dash.handouts.refresh"
            disabled={handouts.isFetching}
            onClick={() => void handouts.refetch()}
          >
            ↻ Refresh
          </button>
        </>
      }
    >
      <h3 className="preflight-h">Queue</h3>
      <ul className="preflight-list" id="handouts-queue" aria-label="Queue">
        {queueBlock}
      </ul>
      <h3 className="preflight-h">Revealed</h3>
      <ul className="preflight-list" id="handouts-revealed" aria-label="Revealed">
        {revealedBlock}
      </ul>
    </Drawer>
  );
}
