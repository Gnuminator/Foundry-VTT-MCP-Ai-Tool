// The GM page (item gm-page-wrapper), the third live screen at /gm: Foundry in one pane and the
// live strip (the same component as screens A and B) in the other, with a drag divider and a layout
// saved per browser. A pick on the Foundry map reaches the strip through this page: the Foundry
// module posts the picked token ids up, and only a message from the Foundry frame (or tab) on
// Foundry's origin counts (lib/gmLayout.ts). Design: vault Design/GM page design 2026-10-31.md.
import { useQuery } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import { ApiError, api } from '../lib/api';
import {
  DEFAULT_STRIP_PX,
  FRAME_WAIT_MS,
  MIN_STRIP_PX,
  clampStripPx,
  classifyMessage,
  fitsSideBySide,
  loadLayout,
  maxStripPx,
  saveLayout,
  type GmLayout,
  type GmMode,
} from '../lib/gmLayout';
import { LIVE_PICK_MESSAGE, currentMapPick, setMapPick } from '../lib/mapPick';
import { useDashboardStream } from '../lib/stream';
import { LiveStrip } from './LiveStrip';
import styles from './GmPage.module.css';

interface GmPageInfo {
  foundryUrl: string | null;
  foundryOrigin: string | null;
}

const MODES: ReadonlyArray<{ mode: GmMode; label: string }> = [
  { mode: 'right', label: 'Strip right' },
  { mode: 'left', label: 'Strip left' },
  { mode: 'window', label: 'Foundry alone' },
];

const STRIP_WINDOW = 'fmb-gm-strip';
const FOUNDRY_TAB = 'fmb-gm-foundry';
const STRIP_FEATURES = 'popup,width=420,height=900';

function useViewportWidth(): number {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return (): void => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

export function GmPage(): JSX.Element {
  useDashboardStream();
  const info = useQuery({
    queryKey: ['gm-page'],
    queryFn: () => api<GmPageInfo>('/api/gm-page'),
    retry: false,
    staleTime: Infinity,
  });
  if (info.isPending) return <main className={styles.page} aria-busy="true" />;
  if (info.isError) {
    const gmOnly = info.error instanceof ApiError && info.error.status === 403;
    return (
      <main className={styles.page}>
        <p className={styles.note} role="alert">
          {gmOnly
            ? 'This page is for the GM.'
            : 'The GM page could not load. Check that you are signed in as the GM.'}{' '}
          <a href={gmOnly ? '/player' : './'}>
            {gmOnly ? 'Open the player view' : 'Back to the dashboard'}
          </a>
        </p>
      </main>
    );
  }
  if (info.data.foundryUrl === null || info.data.foundryOrigin === null) {
    return (
      <main className={styles.page}>
        <p className={styles.note} role="alert">
          Set the Foundry address first: DASHBOARD_FOUNDRY_URL, the address your browser uses for
          Foundry (see the dashboard setup notes). <a href="./">Back to the dashboard</a>
        </p>
      </main>
    );
  }
  return <GmWorkspace foundryUrl={info.data.foundryUrl} foundryOrigin={info.data.foundryOrigin} />;
}

function GmWorkspace({
  foundryUrl,
  foundryOrigin,
}: {
  foundryUrl: string;
  foundryOrigin: string;
}): JSX.Element {
  const viewport = useViewportWidth();
  // Once the panes show, a smaller window (browser zoom, a snapped window, devtools) must not take
  // the Foundry frame away mid-fight: it only squeezes. A window that opens narrow shows the strip
  // alone until it is widened.
  const [sideBySide, setSideBySide] = useState(() => fitsSideBySide(viewport));
  if (!sideBySide && fitsSideBySide(viewport)) setSideBySide(true);
  const [layout, setLayout] = useState<GmLayout>(loadLayout);
  const [dragging, setDragging] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [bannerHidden, setBannerHidden] = useState(false);
  const [tabOpen, setTabOpen] = useState(false);
  const [stripWindowOpen, setStripWindowOpen] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stripPaneRef = useRef<HTMLDivElement>(null);
  const foundryTab = useRef<Window | null>(null);
  const stripWindow = useRef<Window | null>(null);

  const update = useCallback((patch: Partial<GmLayout>): void => {
    setLayout(prev => {
      const next = { ...prev, ...patch };
      saveLayout(next);
      return next;
    });
  }, []);

  const stripPx = clampStripPx(layout.stripPx, viewport);

  // Messages: a pick from Foundry (frame or tab) feeds the strip; the strip window's "ready"
  // gets the current pick back.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const message = classifyMessage(event, {
        foundryFrame: frameRef.current?.contentWindow ?? null,
        foundryTab: foundryTab.current,
        stripWindow: stripWindow.current,
        foundryOrigin,
        ownOrigin: window.location.origin,
      });
      if (message === null) return;
      if (message.kind === 'pick') {
        setConnected(true);
        setMapPick(message.ids);
        postToStripWindow(stripWindow.current, message.ids);
      } else {
        postToStripWindow(stripWindow.current, currentMapPick() ?? []);
      }
    };
    window.addEventListener('message', onMessage);
    return (): void => window.removeEventListener('message', onMessage);
  }, [foundryOrigin]);

  // The frame loaded: ask the Foundry module for the current pick (it answers a "ready" from this
  // page only), and start the wait. A blocked frame also fires load, so only a pick means "here".
  const onFrameLoad = useCallback((): void => {
    setFrameLoaded(true);
    frameRef.current?.contentWindow?.postMessage({ type: 'fmb-live-ready' }, foundryOrigin);
  }, [foundryOrigin]);
  useEffect(() => {
    if (!frameLoaded || connected) return;
    const timer = window.setTimeout(() => setTimedOut(true), FRAME_WAIT_MS);
    return (): void => window.clearTimeout(timer);
  }, [frameLoaded, connected]);

  // The strip window and the Foundry tab are handles: notice when the GM closes them.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (stripWindow.current?.closed === true) stripWindow.current = null;
      if (foundryTab.current?.closed === true) foundryTab.current = null;
      setStripWindowOpen(stripWindow.current !== null);
      setTabOpen(foundryTab.current !== null);
    }, 1000);
    return (): void => window.clearInterval(timer);
  }, []);

  const openStripWindow = (): void => {
    stripWindow.current = window.open('/?strip=1', STRIP_WINDOW, STRIP_FEATURES);
    setStripWindowOpen(stripWindow.current !== null);
  };
  const openFoundryTab = (): void => {
    foundryTab.current = window.open(foundryUrl, FOUNDRY_TAB);
    setTabOpen(foundryTab.current !== null);
  };

  // The jump keys work while focus is on this page (keys typed inside the Foundry frame never
  // reach it): Alt+1 the strip, Alt+2 Foundry. Not Alt+Shift: Windows uses that to switch the
  // keyboard language, which a Danish and English setup has.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (!event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return;
      if (event.code === 'Digit1') {
        stripPaneRef.current?.focus();
        event.preventDefault();
      } else if (event.code === 'Digit2') {
        frameRef.current?.focus();
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, []);

  // The divider.
  const onDividerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onDividerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    const edge = layout.mode === 'left' ? event.clientX : window.innerWidth - event.clientX;
    // Saved on release, not on every move.
    setLayout(prev => ({ ...prev, stripPx: clampStripPx(edge, window.innerWidth) }));
  };
  const endDrag = useCallback((): void => {
    setDragging(false);
    setLayout(prev => {
      saveLayout(prev);
      return prev;
    });
  }, []);
  useEffect(() => {
    window.addEventListener('blur', endDrag);
    return (): void => window.removeEventListener('blur', endDrag);
  }, [endDrag]);
  const onDividerKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 64 : 16;
    // The strip grows away from its screen edge: with the strip on the right, Left widens it.
    const grow = layout.mode === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = layout.mode === 'left' ? 'ArrowLeft' : 'ArrowRight';
    let next: number | null = null;
    if (event.key === grow) next = stripPx + step;
    else if (event.key === shrink) next = stripPx - step;
    else if (event.key === 'Home') next = MIN_STRIP_PX;
    else if (event.key === 'End') next = maxStripPx(viewport);
    else if (event.key === 'Enter') next = DEFAULT_STRIP_PX;
    if (next === null) return;
    event.preventDefault();
    update({ stripPx: clampStripPx(next, viewport) });
  };

  const stripOnly = !sideBySide || tabOpen;
  const showBanner =
    !stripOnly && timedOut && !connected && !bannerHidden && layout.mode !== 'window';

  return (
    <div className={styles.root} data-dragging={dragging ? '' : undefined}>
      <header className={styles.bar}>
        <strong className={styles.title}>GM page</strong>
        {sideBySide && !tabOpen ? (
          <div role="group" aria-label="Layout" className={styles.switcher}>
            {MODES.map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                className={styles.mode}
                aria-pressed={layout.mode === mode}
                onClick={() => update({ mode })}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <a className={styles.back} href="./">
          Back to the dashboard
        </a>
      </header>
      {stripOnly ? (
        <div className={styles.single} ref={stripPaneRef} tabIndex={-1}>
          <p className={styles.line}>
            {tabOpen
              ? 'Foundry is open in its own tab. Map picks still arrive here.'
              : 'Too narrow for Foundry and the strip side by side.'}{' '}
            <button type="button" className={styles.link} onClick={openFoundryTab}>
              Open Foundry in its own tab
            </button>
          </p>
          <LiveStrip />
        </div>
      ) : (
        <div
          className={styles.panes}
          data-mode={layout.mode}
          style={{ ['--strip-px' as string]: `${stripPx}px` }}
        >
          <section className={styles.foundry} aria-label="Foundry">
            {showBanner ? (
              <div className={styles.banner} role="status">
                <span>
                  Can&apos;t see Foundry here? It may refuse to open inside this page, you may not
                  have joined the world yet, or the module&apos;s &quot;Live window address&quot; is
                  not set to this page.
                </span>
                <button type="button" className={styles.primary} onClick={openFoundryTab}>
                  Open Foundry in its own tab
                </button>
                <button type="button" className={styles.link} onClick={() => setBannerHidden(true)}>
                  Hide
                </button>
              </div>
            ) : null}
            {layout.mode === 'window' ? (
              <div className={styles.windowBar}>
                {stripWindowOpen ? (
                  'The live strip is open in its own window.'
                ) : (
                  <>
                    The live strip opens in its own window.{' '}
                    <button type="button" className={styles.primary} onClick={openStripWindow}>
                      Open the strip window
                    </button>
                  </>
                )}
              </div>
            ) : null}
            <div className={styles.frameWrap}>
              {!frameLoaded ? <p className={styles.loading}>Loading Foundry...</p> : null}
              <iframe
                ref={frameRef}
                className={styles.frame}
                data-loaded={frameLoaded ? '' : undefined}
                title="Foundry"
                src={foundryUrl}
                allow="autoplay; fullscreen; clipboard-write"
                referrerPolicy="no-referrer-when-downgrade"
                onLoad={onFrameLoad}
              />
            </div>
          </section>
          {layout.mode !== 'window' ? (
            <>
              <div
                className={styles.divider}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize the live strip"
                aria-valuemin={MIN_STRIP_PX}
                aria-valuemax={maxStripPx(viewport)}
                aria-valuenow={stripPx}
                aria-valuetext={`${stripPx} pixels`}
                title="Drag to resize, double-click to reset"
                tabIndex={0}
                onPointerDown={onDividerDown}
                onPointerMove={onDividerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={() => update({ stripPx: DEFAULT_STRIP_PX })}
                onKeyDown={onDividerKey}
              />
              <aside
                className={styles.strip}
                ref={stripPaneRef}
                tabIndex={-1}
                aria-label="Live strip"
              >
                {!layout.hintSeen ? (
                  <p className={styles.hint}>
                    Pick tokens on the map and they are picked here too. Drag the line between the
                    panes to resize.{' '}
                    <button
                      type="button"
                      className={styles.link}
                      onClick={() => update({ hintSeen: true })}
                    >
                      Got it
                    </button>
                  </p>
                ) : null}
                <LiveStrip />
              </aside>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Send a pick to the strip window, to this page's own origin only. */
function postToStripWindow(target: Window | null, ids: readonly string[]): void {
  if (target === null || target.closed) return;
  try {
    target.postMessage({ type: LIVE_PICK_MESSAGE, tokenIds: [...ids] }, window.location.origin);
  } catch {
    // A window that just closed has nothing to show.
  }
}
