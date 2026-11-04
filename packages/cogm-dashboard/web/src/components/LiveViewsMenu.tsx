import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { api, ApiError } from '../lib/api';
import { useEscapeClose } from '../lib/escape';
import { LIVE_SCREEN_HREF } from '../lib/liveScreen';
import { Button } from '../ui';
import styles from './LiveViewsMenu.module.css';

/** What /api/gm-page answers (GM only): whether the dashboard knows Foundry's address. */
interface GmPageInfo {
  foundryUrl: string | null;
}

/** The three ways to see the live strip, one sentence each on when to use it. */
export const LIVE_VIEWS = {
  live: 'The strip and the combat order on one fixed page. Use it on a second screen or a tablet.',
  gm: 'Foundry and the strip in one browser window. Use it when there is only one screen. Close your normal Foundry tab first: a user can be joined once.',
  window:
    'A small window inside Foundry, next to the map. Turn it on in Foundry: the Settings tab, Game Settings, category Foundry AI Tool, "AI Tool: Live window". Then the Live button shows in the AI Tool group.',
} as const;

export const NO_FOUNDRY_ADDRESS_NOTE =
  'The dashboard does not know Foundry’s address yet, so the GM page cannot show Foundry and the Live window inside Foundry stays empty. Ask whoever set up the dashboard to add it.';

/**
 * The header's one Live views entry (live-views-find, gm-page-entry): Live screen, GM page and the
 * Live window, each with when to use it. The GM page and Live window rows are for the GM; a player
 * (the GM-only /api/gm-page answers 403) sees the Live screen alone. Not a Radix menu: three
 * links in a small disclosure, so it adds nothing to the first-load budget.
 */
export function LiveViewsMenu(): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const info = useQuery({
    queryKey: ['gm-page'],
    queryFn: () => api<GmPageInfo>('/api/gm-page'),
    retry: false,
    staleTime: Infinity,
  });
  // Only a refusal means "not the GM"; a restart or a bad gateway must not hide the rows for good.
  const refused =
    info.error instanceof ApiError && (info.error.status === 403 || info.error.status === 401);
  const isGm = info.isSuccess || (info.isError && !refused);
  const knowsFoundry = !info.isSuccess || info.data.foundryUrl != null;

  useEscapeClose(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={root} id="live-views">
      <Button
        ref={button}
        id="btn-live-views"
        data-track="dash.header.live-views"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(o => !o)}
      >
        Live views ▾
      </Button>
      {open ? (
        <div className={styles.panel} id={panelId} role="group" aria-label="Live views">
          <a className={styles.entry} id="live-views-live" href={LIVE_SCREEN_HREF}>
            <strong>Live screen</strong>
            <span>{LIVE_VIEWS.live}</span>
          </a>
          {isGm ? (
            <>
              <a className={styles.entry} id="live-views-gm" href="/gm">
                <strong>GM page</strong>
                <span>{LIVE_VIEWS.gm}</span>
              </a>
              <div className={styles.entry} id="live-views-window">
                <strong>Live window (in Foundry)</strong>
                <span>{LIVE_VIEWS.window}</span>
              </div>
              {knowsFoundry ? null : (
                <p className={styles.note} role="note">
                  {NO_FOUNDRY_ADDRESS_NOTE}
                </p>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
