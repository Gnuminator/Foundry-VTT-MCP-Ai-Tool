// The After view's two cards (D-085, PB-16), ported from the old page: Tonight's stats (rolls, most
// damage, the highest roll and who went down, from get-play-stats for the latest session, with Copy
// for Discord and the Open the session note link) and Session notes (recap lane, D-087: where the
// notes the pipeline wrote are, with Read, Put in Foundry, Approve without revealing and Undo).
// Nothing loads until After is on screen. GM only: the stats and the notes never reach /player.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { useHelp } from '../components/HelpButton';
import { OverlayPane } from '../components/OverlayPane';
import { useToast } from '../components/Toasts';
import { api, callTool, errorText } from '../lib/api';
import {
  plural,
  sessionMeta,
  statsForDiscord,
  summarizeSession,
  times,
  type PlayStats,
  type SessionSummary,
} from '../lib/afterStats';
import { GAME_STATE_KEY, useGuardedTools } from '../lib/guarded';
import {
  notesView,
  sanitizeNotesHtml,
  type NotesAction,
  type NotesPage,
  type SessionNotes,
} from '../lib/sessionNotes';
import { useObsidianFileUrl } from '../lib/stream';
import { Button, Pill, Stat } from '../ui';

const STATS_KEY = [...GAME_STATE_KEY, 'after-stats'] as const;
const NOTES_KEY = [...GAME_STATE_KEY, 'session-notes'] as const;

/** The notes put and approve routes answer with the applied change when there is one. */
interface NotesWrite {
  changeId?: string;
  summary?: string;
}

function StatCards({ a }: { a: SessionSummary }): JSX.Element {
  const hr = a.highestRoll;
  const downTotal = a.downs.reduce((sum, [, k]) => sum + k, 0);
  return (
    <div className="stat-cards" id="stat-cards">
      <Stat
        label="Rolls"
        value={String(a.rolls)}
        hint={`${plural(a.nat20, 'natural 20', 'natural 20s')}, ${plural(a.nat1, 'natural 1', 'natural 1s')}`}
      />
      {a.mostDamage ? (
        <Stat
          label="Most damage"
          value={a.mostDamage.name}
          hint={`${a.mostDamage.amount} hp over ${plural(a.mostDamage.fights, 'fight', 'fights')}`}
          name
        />
      ) : (
        <Stat
          label="Most damage"
          value="Nobody"
          hint={a.fights ? 'no damage dealt by a hero' : 'no fights'}
          name
        />
      )}
      {hr ? (
        <Stat
          label="Highest roll"
          value={String(hr.total)}
          hint={hr.label ? `${hr.name}, ${hr.label}` : hr.name}
        />
      ) : (
        <Stat label="Highest roll" value="-" hint="no d20 roll by a hero" />
      )}
      {a.downs.length > 0 ? (
        <Stat
          label="Went down"
          value={a.downs.map(([n, k]) => `${n}, ${times(k)}`).join('; ')}
          hint={plural(downTotal, 'down tonight', 'downs tonight')}
          name
        />
      ) : (
        <Stat label="Went down" value="Nobody" hint="every hero stayed up" name />
      )}
    </div>
  );
}

/** Tonight's stats for the latest play session. */
function AfterStats({ active }: { active: boolean }): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: STATS_KEY,
    queryFn: async () =>
      summarizeSession(await callTool<PlayStats | null>('get-play-stats', { session: 'latest' })),
    enabled: active,
    retry: false,
  });
  const a = query.data ?? null;
  const noteUrl = useObsidianFileUrl(a?.label ? `AI Tool/Sessions/${a.label}` : '');
  const copy = async (): Promise<void> => {
    if (!a) return;
    try {
      await navigator.clipboard.writeText(statsForDiscord(a));
      toast('✓ Copied. The highest roll is left out (it may have been a private roll).', 'ok');
    } catch (err) {
      toast(`✗ Could not copy: ${errorText(err)}`, 'err');
    }
  };
  let body: JSX.Element;
  if (query.isError) {
    body = <p className="empty">{`Couldn't load the stats: ${errorText(query.error)}`}</p>;
  } else if (query.isPending) {
    body = <p className="empty">Loading tonight&apos;s stats…</p>;
  } else if (!a) {
    body = <p className="empty">No play session recorded yet.</p>;
  } else {
    body = <StatCards a={a} />;
  }
  return (
    <section className="after-stats" id="after-stats" aria-label="Tonight's stats">
      {body}
      <div className="stat-session">
        <div>
          <h3 className="stat-session-title">
            <span id="stat-session-title">{a ? a.label || 'Last session' : 'Last session'}</span>
          </h3>
          <span className="pf-detail" id="stat-session-meta">
            {a ? sessionMeta(a) : ''}
          </span>
        </div>
        <div className="ready-actions">
          {noteUrl && a?.label ? (
            <a
              className="btn lamp"
              id="btn-session-note"
              data-track="dash.after.open-note"
              href={noteUrl}
            >
              Open the session note
            </a>
          ) : null}
          <Button
            variant="quiet"
            id="btn-copy-stats"
            data-track="dash.after.copy-stats"
            disabled={!a}
            onClick={() => void copy()}
          >
            Copy the stats for Discord
          </Button>
          <Button
            variant="quiet"
            id="btn-stats-refresh"
            data-track="dash.after.refresh"
            onClick={() => {
              void query.refetch();
              void queryClient.invalidateQueries({ queryKey: NOTES_KEY });
            }}
          >
            ↻ Refresh
          </Button>
        </div>
      </div>
    </section>
  );
}

/** The notes' pages in a pane over the page (the old page used the guide pane). */
function NotesReader({
  notes,
  open,
  onOpenChange,
}: {
  notes: SessionNotes;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const query = useQuery({
    queryKey: [...NOTES_KEY, 'pages', notes.sessionId],
    queryFn: () =>
      api<{ pages?: NotesPage[] }>(`/api/session-notes/${encodeURIComponent(notes.sessionId)}`),
    enabled: open,
    retry: false,
    staleTime: 0,
  });
  const pages = Array.isArray(query.data?.pages) ? query.data.pages : [];
  return (
    <OverlayPane
      open={open}
      onOpenChange={onOpenChange}
      id="pane-session-notes"
      className="help-pane"
      bodyClassName="help-body"
      title={`Session notes: ${notes.title || notes.date || ''}`}
      closeLabel="Close the session notes"
    >
      {query.isError ? (
        <p className="empty">{`Couldn't load the notes: ${errorText(query.error)}`}</p>
      ) : query.isPending ? (
        <p className="empty">Loading…</p>
      ) : (
        pages.map((page, i) => (
          <div key={page.key ?? i}>
            <h2>{page.title || page.key}</h2>
            {/* Plain text tags only, no attributes (sanitizeNotesHtml). */}
            <div dangerouslySetInnerHTML={{ __html: sanitizeNotesHtml(page.html) }} />
          </div>
        ))
      )}
    </OverlayPane>
  );
}

/** The latest session's notes, if the bridge has any. */
function SessionNotesCard({ active }: { active: boolean }): JSX.Element | null {
  const toast = useToast();
  const queryClient = useQueryClient();
  const guarded = useGuardedTools();
  const openHelp = useHelp();
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: NOTES_KEY,
    // No notes, or a bridge without the session notes lane: no card.
    queryFn: async () => {
      try {
        const data = await api<{ items?: SessionNotes[] }>('/api/session-notes');
        return (Array.isArray(data.items) ? data.items[0] : undefined) ?? null;
      } catch {
        return null;
      }
    },
    enabled: active,
  });
  const n = query.data ?? null;
  if (!n) return null;
  const view = notesView(n);

  const reload = (): void => {
    void queryClient.invalidateQueries({ queryKey: NOTES_KEY });
    // The bridge marks the notes as staged just after the undo itself answers.
    setTimeout(() => void queryClient.invalidateQueries({ queryKey: NOTES_KEY }), 1500);
  };
  const undo = async (changeId: string): Promise<void> => {
    await guarded.write('undo-change', { changeId }, 'destructive', {
      summary: 'Take the session notes out of Foundry again?',
    });
    reload();
  };
  const act = async (action: NotesAction): Promise<void> => {
    if (action === 'read') {
      setReading(true);
      return;
    }
    if (action === 'undo') {
      if (n.changeId) await undo(n.changeId);
      return;
    }
    if (guarded.gated('session-notes')) return;
    setBusy(true);
    try {
      const id = encodeURIComponent(n.sessionId);
      if (action === 'put') {
        const result = await api<NotesWrite | null>(`/api/session-notes/${id}/put`, {
          method: 'POST',
          body: '{}',
        });
        const changeId = result?.changeId;
        if (changeId) {
          toast(`✓ ${result.summary ?? 'The notes are in Foundry.'}`, 'ok', {
            label: 'Undo',
            onClick: () => void undo(changeId),
          });
        } else {
          toast('✓ The notes are in Foundry.', 'ok');
        }
      } else {
        await api(`/api/session-notes/${id}/approve`, { method: 'POST', body: '{}' });
        toast('✓ Approved. The audio is kept.', 'ok');
      }
    } catch (err) {
      toast(`✗ ${errorText(err)}`, 'err');
    } finally {
      setBusy(false);
      reload();
    }
  };
  return (
    <>
      <section className="notes-card" id="notes-card" aria-label="Session notes">
        <div className="notes-card-head">
          <h3>
            <span id="notes-title">{view.title}</span>
          </h3>
          <Pill tone={view.tone}>{view.status}</Pill>
        </div>
        <p className="notes-line" id="notes-line">
          {view.line}
        </p>
        {view.warn && (
          <p className="notes-line notes-warn" id="notes-warn">
            {view.warn}
          </p>
        )}
        <div className="ready-actions" id="notes-actions">
          {/* One tag each with a literal data-track, which the usage catalog can read. */}
          <Button
            variant={view.readQuiet ? 'quiet' : 'default'}
            className={view.readQuiet ? undefined : 'lamp'}
            data-track="dash.notes.read"
            onClick={() => void act('read')}
          >
            Read
          </Button>
          {view.actions.includes('put') && (
            <Button
              variant="quiet"
              data-track="dash.notes.put"
              disabled={busy}
              onClick={() => void act('put')}
            >
              Put in Foundry
            </Button>
          )}
          {view.actions.includes('approve') && (
            <Button
              variant="quiet"
              data-track="dash.notes.approve"
              disabled={busy}
              onClick={() => void act('approve')}
            >
              Approve without revealing
            </Button>
          )}
          {view.actions.includes('undo') && (
            <Button
              variant="quiet"
              data-track="dash.notes.undo"
              disabled={busy}
              onClick={() => void act('undo')}
            >
              Undo
            </Button>
          )}
          {view.aboutSwitch && (
            <button
              type="button"
              className="link-btn"
              data-track="dash.notes.about-switch"
              onClick={() => openHelp('features#session-notes')}
            >
              About the switch
            </button>
          )}
        </div>
      </section>
      <NotesReader notes={n} open={reading} onOpenChange={setReading} />
    </>
  );
}

/** The After view's top: tonight's stats, then the session notes. `active` is After on screen. */
export default function AfterTop({ active }: { active: boolean }): JSX.Element {
  return (
    <>
      <AfterStats active={active} />
      <SessionNotesCard active={active} />
    </>
  );
}
