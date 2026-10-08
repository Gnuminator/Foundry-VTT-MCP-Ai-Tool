// Help (the GM guides inside the dashboard): a pane that shows one built guide page
// (`GET /api/help/:page`, help-route.ts; the HTML is made from docs/ at build time) and scrolls to
// a heading. Anything can open it with useHelp()("page#anchor"), as data-help does on the old page.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

import { api, errorText } from '../lib/api';
import { usage } from '../lib/usage';
import { HelpContext, type OpenHelp } from './HelpButton';
import { OverlayPane } from './OverlayPane';

interface HelpPage {
  page: string;
  title: string;
  html: string;
}

/** The guide's HTML, scrolled to the heading the link asked for (else to the top). */
function HelpHtml({ html, anchor }: { html: string; anchor: string }): JSX.Element {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = anchor ? body.current?.querySelector(`[id="${CSS.escape(anchor)}"]`) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else body.current?.closest('.pane-body')?.scrollTo({ top: 0 });
  }, [html, anchor]);
  // Built from the repo's own docs by scripts/build-help.mjs, not from anything a user typed.
  return <div ref={body} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The help pane and the context that opens it. Wraps the page once, in App. */
export function HelpProvider({ children }: { children: ReactNode }): JSX.Element {
  const [target, setTarget] = useState<{ page: string; anchor: string } | null>(null);
  const open = target !== null;
  const page = target?.page ?? '';

  const help = useQuery({
    queryKey: ['help', page],
    queryFn: () => api<HelpPage>(`/api/help/${encodeURIComponent(page)}`),
    enabled: open,
    // A guide does not change while the page is open; a failure is asked again on the next open.
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    usage().trackView('dash.help.view');
    return () => usage().endView('dash.help.view');
  }, [open]);

  const openHelp: OpenHelp = to => {
    const [toPage = '', anchor = ''] = to.split('#');
    setTarget({ page: toPage, anchor });
  };

  return (
    <HelpContext.Provider value={openHelp}>
      {children}
      <OverlayPane
        open={open}
        onOpenChange={next => {
          if (!next) setTarget(null);
        }}
        title={help.data?.title ?? 'Help'}
        closeLabel="Close help"
        id="pane-help"
        className="help-pane"
        bodyClassName="help-body"
      >
        {help.isPending ? (
          <p className="empty">Loading…</p>
        ) : help.isError ? (
          <p className="empty">Couldn&apos;t load the help: {errorText(help.error)}</p>
        ) : (
          <HelpHtml html={help.data.html} anchor={target?.anchor ?? ''} />
        )}
      </OverlayPane>
    </HelpContext.Provider>
  );
}
