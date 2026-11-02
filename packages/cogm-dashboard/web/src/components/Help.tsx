// Help (the GM guides inside the dashboard): a pane that shows one built guide page
// (`GET /api/help/:page`, help-route.ts; the HTML is made from docs/ at build time) and scrolls to
// a heading. Anything can open it with useHelp()("page#anchor"), as data-help does on the old page.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type JSX, type MouseEvent, type ReactNode } from 'react';

import { api, errorText } from '../lib/api';
import { usage } from '../lib/usage';
import { helpLang, wikiUrl, type HelpLang } from '../lib/wiki';
import { HelpContext, type OpenHelp } from './HelpButton';
import { OverlayPane } from './OverlayPane';

interface HelpPage {
  page: string;
  title: string;
  html: string;
}

/** The guide's HTML, scrolled to the heading the link asked for (else to the top). */
function HelpHtml({
  html,
  anchor,
  seq,
  onLink,
}: {
  html: string;
  anchor: string;
  /** Counts every open, so the same link twice scrolls twice. */
  seq: number;
  onLink: OpenHelp;
}): JSX.Element {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A Danish page's headings also answer to the English id the link was written with.
    const id = CSS.escape(anchor);
    const target = anchor
      ? body.current?.querySelector(`[id="${id}"], [data-en-id="${id}"]`)
      : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else body.current?.closest('.pane-body')?.scrollTo({ top: 0 });
  }, [html, anchor, seq]);
  // Built from the repo's own docs by scripts/build-help.mjs, not from anything a user typed.
  // The guide's own links carry data-help="page#anchor" (the old page's click handler): they open
  // that page in this pane instead of following their href.
  const follow = (e: MouseEvent<HTMLDivElement>): void => {
    const link = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-help]') : null;
    if (!link?.dataset.help || !body.current?.contains(link)) return;
    e.preventDefault();
    onLink(link.dataset.help);
    // A link to another guide swaps the page and drops the clicked link; focus stays in the pane
    // (not on the body) so the keyboard and a screen reader keep their place.
    body.current.closest<HTMLElement>('.help-pane')?.focus({ preventScroll: true });
  };
  return <div ref={body} onClick={follow} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The help pane and the context that opens it. Wraps the page once, in App. */
export function HelpProvider({ children }: { children: ReactNode }): JSX.Element {
  // The last page stays after closing, so the pane never flashes "Help" or "Loading" on its way out.
  const [target, setTarget] = useState({ page: '', anchor: '', seq: 0 });
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<HelpLang>('en');
  const page = target.page;
  // A Foundry basics page has no Danish twin, so it stays English; so does a page whose Danish
  // twin is missing from the build (the English page is shown then).
  const wantsDanish = lang === 'da' && !page.startsWith('foundry-') && page !== '';

  const help = useQuery({
    queryKey: ['help', wantsDanish ? 'da' : 'en', page],
    queryFn: async () => {
      if (wantsDanish) {
        try {
          return await api<HelpPage>(`/api/help/${encodeURIComponent(`da-${page}`)}`);
        } catch {
          // Fall through to the English page; a real failure shows there.
        }
      }
      return api<HelpPage>(`/api/help/${encodeURIComponent(page)}`);
    },
    enabled: open,
    // A guide does not change while the page is open; a failure is asked again on the next open.
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    usage().trackView('dash.help.view');
    return (): void => usage().endView('dash.help.view');
  }, [open]);

  const openHelp: OpenHelp = to => {
    // Only the first # splits: an anchor may hold one itself.
    const hash = to.indexOf('#');
    const raw =
      hash < 0 ? { page: to, anchor: '' } : { page: to.slice(0, hash), anchor: to.slice(hash + 1) };
    // A link inside a Danish guide names its Danish twin (`da-<page>`); the page state is the
    // English key and the language picks the twin.
    const next = raw.page.startsWith('da-') ? { ...raw, page: raw.page.slice('da-'.length) } : raw;
    setLang(raw.page.startsWith('da-') ? 'da' : helpLang());
    setTarget(before => ({ ...next, seq: before.seq + 1 }));
    setOpen(true);
  };

  return (
    <HelpContext.Provider value={openHelp}>
      {children}
      <OverlayPane
        open={open}
        onOpenChange={setOpen}
        title={help.data?.title ?? 'Help'}
        closeLabel="Close help"
        id="pane-help"
        className="help-pane"
        bodyClassName="help-body"
        meta={
          <a
            className="help-wiki-link"
            href={wikiUrl(page, target.anchor, help.data?.page.startsWith('da-') ? 'da' : 'en')}
            target="_blank"
            rel="noopener noreferrer"
            data-track="dash.help.wiki"
          >
            Open this page on the wiki
          </a>
        }
      >
        {help.isPending ? (
          <p className="empty">Loading…</p>
        ) : help.isError ? (
          <p className="empty">Couldn&apos;t load the help: {errorText(help.error)}</p>
        ) : (
          <HelpHtml
            html={help.data.html}
            anchor={target.anchor}
            seq={target.seq}
            onLink={openHelp}
          />
        )}
      </OverlayPane>
    </HelpContext.Provider>
  );
}
