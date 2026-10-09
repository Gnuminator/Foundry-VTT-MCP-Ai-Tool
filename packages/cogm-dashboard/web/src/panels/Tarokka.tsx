// Tarokka (I-108): the five positions of the current reading, from the bridge vault (never Foundry
// world data). Import and New reading replace the reading and a link pick links a card; all three
// are ordinary writes, applied in one click with an Undo toast. A reveal publishes text to the
// players, so it goes through the confirm window. GM only, and spoiler safe: with "Show cards"
// off the card names and GM notes are not on the page at all, only a blurred placeholder.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';

import { Drawer, DrawerClose } from '../components/Drawer';
import { useToast } from '../components/Toasts';
import { callTool, errorText } from '../lib/api';
import { useGuardedChange } from '../lib/guarded';
import { TAROKKA_KEY, useObsidianFileUrl } from '../lib/stream';
import { usage } from '../lib/usage';

/** One position of the reading (tarokka/service.ts PositionView on the bridge); fields used. */
interface TarokkaPosition {
  position: string;
  label: string;
  cardId: string;
  cardName: string;
  gmNote: string | null;
  /** journalPageUuid, sceneUuid and actorUuid, each when linked. */
  links?: Record<string, string | undefined>;
  revealed: boolean;
  revealPageUuid: string | null;
}

/** What get-tarokka-reading answers (TarokkaView); the fields used here. */
interface TarokkaView {
  available: boolean;
  reading?: {
    source: string;
    readAt: string;
    positions: TarokkaPosition[];
  };
  archivedReadings: number;
}

/** A document suggest-tarokka-links found (foundry-module tarokka.ts LinkCandidate). */
interface LinkCandidate {
  uuid: string;
  documentName: string;
  name: string;
  parentName?: string;
}

/** What a link search shows: the matches, or why there are none to show. */
type SearchResult = { candidates: LinkCandidate[] } | { error: string };

/**
 * Runs a guarded change, then the reload after it. Resolves once both are over, to whether the
 * change went in; to false at once when another change in the drawer is still running.
 */
type RunChange = (planTool: string, args: Record<string, unknown>) => Promise<boolean>;

const LINK_LABELS: Record<string, string> = {
  journalPageUuid: 'Journal',
  sceneUuid: 'Scene',
  actorUuid: 'Actor',
};

/**
 * The link field for a found document. The bridge has no field of its own for a whole journal,
 * so a JournalEntry goes under journalPageUuid with the pages, as on the old page; it opens the
 * same way.
 */
function linkField(documentName: string): string {
  if (documentName === 'Scene') return 'sceneUuid';
  if (documentName === 'Actor') return 'actorUuid';
  return 'journalPageUuid';
}

const loadReading = async (): Promise<TarokkaView> =>
  (await callTool<TarokkaView | null>('get-tarokka-reading', {})) ?? {
    available: false,
    archivedReadings: 0,
  };

/** The bridge refuses shorter searches; asking first would only show its error. */
const MIN_QUERY = 2;

export function TarokkaDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const toast = useToast();
  const runChange = useGuardedChange();
  // Loads on every opening (stale at once), after a change or undo while open (GAME_STATE_KEY),
  // and on Refresh. No stream event is about Tarokka.
  const tarokka = useQuery({
    queryKey: TAROKKA_KEY,
    queryFn: loadReading,
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const obsidianUrl = useObsidianFileUrl('AI Tool/Tarokka/Current reading');
  // Never stored, and off again whenever the drawer closes: the cards show only while the GM
  // looks at them on purpose.
  const [showCards, setShowCards] = useState(false);
  // One change at a time in the whole drawer, the reload after it included. A reveal planned for
  // one card must not land on the card a New reading deals while its confirm window is open: the
  // bridge's check would pass, as a new card is unrevealed too. The ref also catches a double
  // click before the re-render.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    usage().trackView('dash.tarokka.view');
    return (): void => {
      usage().endView('dash.tarokka.view');
      setShowCards(false);
    };
  }, [open]);

  // Reloads after every attempt, as Handouts does: a cancelled or failed change may still mean
  // the reading moved (another tab, Claude). An apply already started a reload (GAME_STATE_KEY);
  // this joins it. Every change button stays disabled until the reload is in.
  const change: RunChange = async (planTool, args) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      const done = await runChange(planTool, args);
      await tarokka.refetch({ cancelRefetch: false });
      return done;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const importReading = (source: 'tarokka-reading' | 'builtin-roll'): void => {
    void change('plan-tarokka-import', { source });
  };

  // Opens the document on the GM's own Foundry screen; nothing changes, so no reload.
  const openDocument = (uuid: string): void => {
    callTool('open-in-foundry', { uuid }).then(
      () => toast('Opened in Foundry', 'ok'),
      (err: unknown) => toast(`✗ open-in-foundry: ${errorText(err)}`, 'err')
    );
  };

  // A failed reload keeps the last reading under the error, and its subtitle with it.
  const view = tarokka.data;
  const reading = view?.available ? view.reading : undefined;
  const sub = !view
    ? 'GM only. Stored in the bridge vault.'
    : !reading
      ? 'GM only. No reading stored yet.'
      : `GM only · ${reading.source} · ${new Date(reading.readAt).toLocaleString()} · ${view.archivedReadings} archived`;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      id="tarokka-drawer"
      title="🃏 Tarokka"
      sub={<span id="tarokka-sub">{sub}</span>}
      help="dashboard#the-tarokka-drawer--tarokka"
      close={<DrawerClose id="tarokka-close" data-track="dash.tarokka.close" />}
      onEscape={() => usage().track('shortcut', 'dash.shortcut.escape-tarokka')}
      actions={
        <>
          <button
            className="btn"
            id="tarokka-refresh"
            data-track="dash.tarokka.refresh"
            disabled={tarokka.isFetching}
            onClick={() => void tarokka.refetch()}
          >
            ↻ Refresh
          </button>
          <button
            className="btn"
            id="tarokka-import"
            data-track="dash.tarokka.import"
            disabled={busy}
            onClick={() => importReading('tarokka-reading')}
          >
            Import from tarokka-reading
          </button>
          <button
            className="btn"
            id="tarokka-roll"
            data-track="dash.tarokka.roll"
            disabled={busy}
            onClick={() => importReading('builtin-roll')}
          >
            New reading (built-in roll)
          </button>
          {obsidianUrl && (
            <a
              id="tarokka-obsidian"
              className="link-btn"
              data-track="dash.tarokka.open-obsidian"
              href={obsidianUrl}
              target="_blank"
              rel="noopener"
              title="Open the current reading in Obsidian"
            >
              📓 Obsidian
            </a>
          )}
          <label className="tarokka-show">
            <input
              type="checkbox"
              id="tarokka-show"
              data-track="dash.tarokka.show-cards"
              checked={showCards}
              onChange={e => setShowCards(e.target.checked)}
            />{' '}
            Show cards
          </label>
        </>
      }
    >
      <div id="tarokka-body">
        {tarokka.isError && (
          <p className="empty">Couldn&apos;t load the reading: {errorText(tarokka.error)}</p>
        )}
        {!view ? (
          !tarokka.isError && <p className="empty">Loading…</p>
        ) : !reading ? (
          <p className="empty">
            No reading in the vault. Import one from tarokka-reading or deal a new one.
          </p>
        ) : (
          reading.positions.map(p => (
            // Keyed by the card too: an open form stays across reloads, but not onto another card.
            <PositionCard
              key={`${p.position}:${p.cardId}`}
              p={p}
              showCards={showCards}
              busy={busy}
              change={change}
              openDocument={openDocument}
            />
          ))
        )}
      </div>
    </Drawer>
  );
}

/** One position: its card (veiled unless shown), links, reveal state and its two forms. */
function PositionCard({
  p,
  showCards,
  busy,
  change,
  openDocument,
}: {
  p: TarokkaPosition;
  showCards: boolean;
  /** A change in the drawer is running: every change button waits for it. */
  busy: boolean;
  change: RunChange;
  openDocument: (uuid: string) => void;
}): JSX.Element {
  const toast = useToast();
  // One form at a time per position, as on the old page. Both drafts live here, so switching
  // forms, a reload or a failed or cancelled change keeps what was typed; Link… or Reveal… again
  // closes the form. A reveal that went in closes it and clears the draft.
  const [form, setForm] = useState<'link' | 'reveal' | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const searchSeq = useRef(0);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  // "Show it now" is off unless ticked for this reveal, and goes back to off after every attempt.
  const [showNow, setShowNow] = useState(false);

  const queryRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const revealToggleRef = useRef<HTMLButtonElement>(null);
  const revealFormRef = useRef<HTMLDivElement>(null);

  // A form takes focus when it opens.
  useEffect(() => {
    if (form === 'link') queryRef.current?.focus();
    if (form === 'reveal') textRef.current?.focus();
  }, [form]);

  const toggleForm = (next: 'link' | 'reveal'): void => setForm(f => (f === next ? null : next));

  const search = (e: FormEvent): void => {
    e.preventDefault();
    const q = query.trim();
    const seq = ++searchSeq.current;
    if (q.length < MIN_QUERY) {
      setResult({ error: `Type at least ${MIN_QUERY} characters.` });
      return;
    }
    callTool<{ candidates?: LinkCandidate[] } | null>('suggest-tarokka-links', {
      query: q,
      limit: 20,
    }).then(
      found => {
        // A slower earlier search never overwrites a newer one.
        if (seq !== searchSeq.current) return;
        const candidates = Array.isArray(found?.candidates) ? found.candidates : [];
        setResult({ candidates });
      },
      (err: unknown) => {
        if (seq !== searchSeq.current) return;
        setResult({ error: `Couldn't search: ${errorText(err)}` });
      }
    );
  };

  const pick = (c: LinkCandidate): void => {
    // The form and its results stay, also after a link went in: a scene and an actor can be
    // linked from one search, and a second pick is an ordinary write with its own Undo.
    void change('plan-tarokka-links', {
      position: p.position,
      [linkField(c.documentName)]: c.uuid,
    });
  };

  const planReveal = (): void => {
    const body = text.trim();
    const pageTitle = title.trim();
    if (!body) {
      toast('Write the text the players will read first.', 'warn');
      return;
    }
    void change('plan-tarokka-reveal', {
      position: p.position,
      text: body,
      ...(pageTitle ? { title: pageTitle } : {}),
      ...(showNow ? { showNow: true } : {}),
    }).then(done => {
      setShowNow(false);
      if (!done) return;
      // The text is on the players' page now. Kept in the form, one more click would plan it
      // again as an update of that page.
      setForm(null);
      setTitle('');
      setText('');
      // Plan reveal goes with the form, so focus moves to Reveal… when it was in the form or
      // parked on the drawer or the page (the confirm window does that while the button is
      // disabled), and stays where the GM moved it otherwise.
      const toggle = revealToggleRef.current;
      const active = document.activeElement;
      const parked = !active || active.contains(toggle) || revealFormRef.current?.contains(active);
      if (toggle && parked) toggle.focus();
    });
  };

  const links = Object.entries(p.links ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''
  );

  return (
    <div className="tarokka-pos" data-position={p.position}>
      <div className="tarokka-pos-head">
        <span className="tarokka-label">{p.label}</span>
        {showCards ? (
          <span className="tarokka-card">
            {p.cardName} <code>{p.cardId}</code>
          </span>
        ) : (
          // The same look as the old page's blurred name, but a fixed placeholder: neither the
          // name nor its length is on the page while the cards are hidden.
          <span className="tarokka-card veiled" title="Tick “Show cards” to see it">
            Hidden card <code>·····</code>
          </span>
        )}
      </div>
      {showCards && p.gmNote && <div className="tarokka-note">{p.gmNote}</div>}
      <div className="tarokka-row">
        {links.length > 0 ? (
          links.map(([key, uuid]) => (
            <button
              key={key}
              type="button"
              className="btn btn-small"
              data-track="dash.tarokka.open-document"
              onClick={() => openDocument(uuid)}
            >
              Open {LINK_LABELS[key] ?? key}
            </button>
          ))
        ) : (
          <span className="tarokka-badge warn">not linked</span>
        )}{' '}
        {p.revealed ? (
          <>
            <span className="tarokka-badge revealed">revealed</span>
            {p.revealPageUuid && (
              <button
                type="button"
                className="btn btn-small"
                data-track="dash.tarokka.open-document"
                onClick={() => openDocument(p.revealPageUuid ?? '')}
              >
                Open page
              </button>
            )}
          </>
        ) : (
          <span className="tarokka-badge">hidden from players</span>
        )}
      </div>
      <div className="tarokka-row">
        <button
          type="button"
          className="btn btn-small"
          data-track="dash.tarokka.link"
          aria-expanded={form === 'link'}
          onClick={() => toggleForm('link')}
        >
          Link…
        </button>
        <button
          type="button"
          className="btn btn-small"
          data-track="dash.tarokka.reveal"
          ref={revealToggleRef}
          aria-expanded={form === 'reveal'}
          onClick={() => toggleForm('reveal')}
        >
          Reveal…
        </button>
      </div>
      {form === 'link' && (
        <form className="tarokka-form" data-form={p.position} onSubmit={search}>
          <input
            className="field-control"
            type="text"
            placeholder="Search journals, pages, scenes, actors…"
            aria-label={`Find a document to link to ${p.label}`}
            ref={queryRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button type="submit" className="btn btn-small" data-track="dash.tarokka.link-search">
            Search
          </button>
          <div className="tarokka-candidates">
            {result === null ? null : 'error' in result ? (
              <p className="empty">{result.error}</p>
            ) : result.candidates.length === 0 ? (
              <p className="empty">No matches.</p>
            ) : (
              result.candidates.map(c => (
                <div className="tarokka-candidate" key={c.uuid}>
                  <span>
                    {c.documentName}: {c.name}
                    {c.parentName && (
                      <>
                        {' '}
                        <em>({c.parentName})</em>
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn-small"
                    data-track="dash.tarokka.link-pick"
                    disabled={busy}
                    onClick={() => pick(c)}
                  >
                    Link
                  </button>
                </div>
              ))
            )}
          </div>
        </form>
      )}
      {form === 'reveal' && (
        <div className="tarokka-form" data-form={p.position} ref={revealFormRef}>
          <input
            className="field-control"
            type="text"
            placeholder="Page title (optional)"
            aria-label={`Page title for ${p.label}`}
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <textarea
            className="field-control"
            rows={4}
            placeholder="Exactly what the players may read"
            aria-label={`What the players may read about ${p.label}`}
            ref={textRef}
            value={text}
            onChange={e => setText(e.target.value)}
          />
          <label className="show-now" title="Undo does not close a popup the players already saw.">
            <input
              type="checkbox"
              data-track="dash.tarokka.show-now"
              checked={showNow}
              onChange={e => setShowNow(e.target.checked)}
            />{' '}
            Show it now
          </label>
          <button
            type="button"
            className="btn btn-small"
            data-track="dash.tarokka.plan-reveal"
            disabled={busy}
            onClick={planReveal}
          >
            Plan reveal…
          </button>
        </div>
      )}
    </div>
  );
}
