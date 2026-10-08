// Prep (I-045): facts for the next session, no AI. One read, the bridge's get-prep-digest
// (shared/src/prep-digest.ts has the full shape; only the fields shown here are typed). Loads on
// open, on Refresh and on "All beats"; nothing in it writes. "Open" buttons run open-in-foundry,
// which the dashboard counts as a read.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

import { Drawer, DrawerClose } from '../components/Drawer';
import { useToast } from '../components/Toasts';
import { callTool, errorText } from '../lib/api';
import { usage } from '../lib/usage';
import { PREFLIGHT_ICONS, type CheckStatus } from './Preflight';

type PrepAction = 'summary' | 'last-session';

interface PrepCounter {
  max: number;
  remaining: number;
}

interface PrepLastSession {
  number: number;
  label: string;
  date: string;
  durationMin: number;
  scenes: string[];
  combats: number;
  combatRounds: number;
  pcDowns: number;
  wentDown: { pcs: string[]; others: string[] };
  beats: { at: string; kind: string; text: string }[];
  beatsTruncated: boolean;
  handoutsRevealed: { title: string; seenBy: string[] }[];
}

interface PrepNextSession {
  journalId: string;
  name: string;
  pages: { pageId: string; name: string; text: string; truncated: boolean }[];
  playerVisible: boolean;
}

interface PrepDigest {
  action: PrepAction;
  computedAt: number;
  lastSession: PrepLastSession | null;
  openQuests: { journalId: string; name: string; status: string }[] | null;
  openCampaignParts:
    | { journalId: string; name: string; parts: { title: string; status: string }[] }[]
    | null;
  /** Missing without Foundry (nothing shows); null when the world has no such journal. */
  nextSession?: PrepNextSession | null;
  handoutQueue: { title: string; sceneName: string | null; players?: string[] }[];
  bosses:
    | {
        tokenName: string;
        sceneName: string;
        hidden: boolean;
        legendary: PrepCounter | null;
        resistances: PrepCounter | null;
        lair: { inside: boolean } | null;
      }[]
    | null;
  preflight: { fail: number; warn: number; items: { severity: string; title: string }[] } | null;
  recentChanges: { count: number; latest: { title: string; appliedAt: string }[] };
  tarokka: { hasReading: boolean };
  warnings: string[];
}

const PREP_KEY = ['prep-digest'] as const;

const clock = (at: string | number): string => {
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

const minutes = (min: number): string => {
  const n = Math.max(0, Math.round(Number(min) || 0));
  return n >= 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${n} min`;
};

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const counter = (label: string, c: PrepCounter | null): string =>
  c ? `${label} ${c.remaining}/${c.max}` : '';

/** A row of the old page's lists: a label, a detail under it, and maybe an Open button. */
function Row({
  label,
  detail,
  extra,
}: {
  label: string;
  detail?: string;
  extra?: ReactNode;
}): JSX.Element {
  return (
    <li className="preflight-item">
      <span className="pf-text">
        <span className="pf-label">{label}</span>
        {detail ? <span className="pf-detail">{detail}</span> : null}
      </span>
      {extra}
    </li>
  );
}

type OpenJournal = (journalId: string) => void;

function OpenButton({ id, onOpen }: { id: string; onOpen: OpenJournal }): JSX.Element | null {
  if (!id) return null;
  return (
    <button
      type="button"
      className="btn btn-small"
      data-track="dash.prep.open-journal"
      onClick={() => onOpen(id)}
    >
      Open
    </button>
  );
}

const SubHead = ({ children }: { children: ReactNode }): JSX.Element => (
  <h4 className="prep-sub-h">{children}</h4>
);

const Empty = ({ children }: { children: ReactNode }): JSX.Element => (
  <p className="empty">{children}</p>
);

function LastSession({
  last,
  action,
  onAllBeats,
}: {
  last: PrepLastSession | null;
  action: PrepAction;
  onAllBeats: () => void;
}): JSX.Element {
  if (!last) return <Empty>No play session recorded yet.</Empty>;
  // "Went down" = dropped to 0 HP; the tool never knows whether someone died.
  const pcsDown = last.wentDown?.pcs ?? [];
  const othersDown = last.wentDown?.others ?? [];
  const handouts = last.handoutsRevealed ?? [];
  const scenes = last.scenes ?? [];
  const beats = last.beats ?? [];
  return (
    <>
      <ul className="preflight-list" aria-label="Last session">
        <Row
          label={last.label || `Session ${last.number}`}
          detail={`${last.date || ''} · ${minutes(last.durationMin)}`}
        />
        <Row label="Scenes" detail={scenes.length > 0 ? scenes.join(', then ') : 'None'} />
        <Row
          label="Fights"
          detail={`${count(last.combats || 0, 'fight', 'fights')}, ${count(last.combatRounds || 0, 'round', 'rounds')}`}
        />
        <Row
          label="Downs"
          detail={count(last.pcDowns || 0, 'player character down', 'player character downs')}
        />
        <Row label="PCs who went down" detail={pcsDown.length > 0 ? pcsDown.join(', ') : 'None'} />
        <Row
          label="NPCs who went down"
          detail={othersDown.length > 0 ? othersDown.join(', ') : 'None'}
        />
      </ul>
      <SubHead>Handouts revealed</SubHead>
      {handouts.length === 0 ? (
        <p className="pf-detail">No handouts revealed.</p>
      ) : (
        <ul className="preflight-list" aria-label="Handouts revealed">
          {handouts.map((h, i) => (
            <Row
              key={i}
              label={h.title || 'Untitled'}
              detail={
                (h.seenBy ?? []).length > 0
                  ? `Seen by ${h.seenBy.join(', ')}`
                  : 'Not opened by anyone yet'
              }
            />
          ))}
        </ul>
      )}
      {beats.length === 0 ? (
        <p className="pf-detail">No beats recorded.</p>
      ) : (
        // Uncontrolled: beats the GM opened stay open when a refresh redraws them.
        <details className="prep-beats">
          <summary data-track="dash.prep.show-beats">Beats ({beats.length})</summary>
          <ul>
            {beats.map((b, i) => (
              <li key={i}>
                <span className="prep-beat-time">{clock(b.at)}</span>{' '}
                {String(b.kind || '').replace(/-/g, ' ')}: {b.text || ''}
              </li>
            ))}
          </ul>
          {last.beatsTruncated && (
            <p className="pf-detail">
              {action === 'summary'
                ? 'Only the latest beats are shown.'
                : 'Only the latest 200 beats are shown.'}
            </p>
          )}
        </details>
      )}
      {action === 'summary' && last.beatsTruncated && (
        <button
          type="button"
          className="btn btn-small"
          data-track="dash.prep.all-beats"
          onClick={onAllBeats}
        >
          All beats
        </button>
      )}
    </>
  );
}

function Threads({ d, onOpen }: { d: PrepDigest; onOpen: OpenJournal }): JSX.Element {
  const quests = d.openQuests;
  const campaigns = d.openCampaignParts;
  return (
    <>
      <SubHead>Quests</SubHead>
      {quests == null ? (
        <Empty>Needs Foundry: quests are not loaded.</Empty>
      ) : quests.length === 0 ? (
        <Empty>No open quests.</Empty>
      ) : (
        <ul className="preflight-list" aria-label="Quests">
          {quests.map((q, i) => (
            <Row
              key={i}
              label={q.name}
              detail={q.status || 'Open'}
              extra={<OpenButton id={q.journalId} onOpen={onOpen} />}
            />
          ))}
        </ul>
      )}
      <SubHead>Campaign parts</SubHead>
      {campaigns == null ? (
        <Empty>Needs Foundry: campaign parts are not loaded.</Empty>
      ) : campaigns.length === 0 ? (
        <Empty>No open campaign parts.</Empty>
      ) : (
        campaigns.map((c, i) => (
          <div key={i}>
            <SubHead>
              {c.name} <OpenButton id={c.journalId} onOpen={onOpen} />
            </SubHead>
            <ul className="preflight-list" aria-label={c.name}>
              {(c.parts ?? []).map((p, j) => (
                <Row key={j} label={p.title} detail={String(p.status || '').replace(/_/g, ' ')} />
              ))}
            </ul>
          </div>
        ))
      )}
    </>
  );
}

function NextSessionNotes({
  next,
  onOpen,
}: {
  next: PrepNextSession | null | undefined;
  onOpen: OpenJournal;
}): JSX.Element | null {
  if (next === undefined) return null;
  if (next === null) {
    return (
      <Empty>
        Create a GM-only journal named &apos;Next session&apos; in Foundry for your prep notes.
      </Empty>
    );
  }
  const pages = next.pages ?? [];
  return (
    <>
      {next.playerVisible && (
        <div className="preflight-summary pf-warn">Players can see this journal</div>
      )}
      <p className="pf-detail">
        {next.name || 'Next session'} <OpenButton id={next.journalId} onOpen={onOpen} />
      </p>
      {pages.length === 0 ? (
        <Empty>The journal has no pages yet.</Empty>
      ) : (
        pages.map((p, i) => (
          <div key={p.pageId || i} className="prep-note">
            <div className="pf-label">{p.name || 'Untitled'}</div>
            <div className="prep-note-text">
              {p.text || ''}
              {p.truncated ? ' …' : ''}
            </div>
          </div>
        ))
      )}
    </>
  );
}

function Ready({
  d,
  onOpenPreflight,
}: {
  d: PrepDigest;
  onOpenPreflight: () => void;
}): JSX.Element {
  const queue = d.handoutQueue ?? [];
  const groups = new Map<string, PrepDigest['handoutQueue']>();
  for (const q of queue) {
    const key = q.sceneName ? q.sceneName : 'Any scene';
    groups.set(key, [...(groups.get(key) ?? []), q]);
  }
  const bosses = d.bosses;
  const pf = d.preflight;
  return (
    <>
      <SubHead>Handout queue</SubHead>
      {queue.length === 0 ? (
        <Empty>No handouts queued.</Empty>
      ) : (
        [...groups].map(([scene, items]) => (
          <div key={scene}>
            <SubHead>{scene}</SubHead>
            <ul className="preflight-list" aria-label={`Queued: ${scene}`}>
              {items.map((q, i) => (
                <Row
                  key={i}
                  label={q.title || 'Untitled'}
                  detail={
                    q.players && q.players.length > 0
                      ? `For ${count(q.players.length, 'player', 'players')}`
                      : ''
                  }
                />
              ))}
            </ul>
          </div>
        ))
      )}
      <SubHead>Bosses</SubHead>
      {bosses == null ? (
        <Empty>Needs Foundry: bosses are not loaded.</Empty>
      ) : bosses.length === 0 ? (
        <Empty>No boss creatures on scenes.</Empty>
      ) : (
        <ul className="preflight-list" aria-label="Bosses">
          {bosses.map((b, i) => (
            <Row
              key={i}
              label={`${b.tokenName}${b.hidden ? ' (hidden)' : ''}`}
              detail={[
                b.sceneName,
                counter('Legendary', b.legendary),
                counter('Resistances', b.resistances),
                b.lair ? (b.lair.inside ? 'Lair: inside' : 'Lair') : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
        </ul>
      )}
      <SubHead>Pre-flight</SubHead>
      {!pf ? (
        <Empty>The pre-flight check could not run.</Empty>
      ) : (
        <>
          <p className="pf-detail">{`${pf.fail} to fix, ${pf.warn} to look at`}</p>
          {(pf.items ?? []).length > 0 && (
            <ul className="preflight-list" aria-label="Pre-flight items">
              {pf.items.map((item, i) => {
                const sev: CheckStatus =
                  item.severity in PREFLIGHT_ICONS ? (item.severity as CheckStatus) : 'unknown';
                return (
                  <li key={i} className={`preflight-item pf-${sev}`}>
                    <span className="pf-icon">{PREFLIGHT_ICONS[sev]}</span>
                    <span className="pf-text">
                      <span className="pf-label">{item.title}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            className="btn btn-small"
            data-track="dash.prep.open-preflight"
            onClick={onOpenPreflight}
          >
            Open Pre-flight
          </button>
        </>
      )}
    </>
  );
}

function Changes({ rc }: { rc: PrepDigest['recentChanges'] | undefined }): JSX.Element {
  const n = rc && Number.isFinite(rc.count) ? rc.count : 0;
  if (n === 0) return <Empty>No changes made through the tool yet.</Empty>;
  return (
    <>
      <p className="pf-detail">{count(n, 'change', 'changes')} made through the tool.</p>
      <ul className="preflight-list" aria-label="Recent changes">
        {(rc?.latest ?? []).map((c, i) => (
          <Row
            key={i}
            label={c.title || 'Change'}
            detail={c.appliedAt ? new Date(c.appliedAt).toLocaleString() : ''}
          />
        ))}
      </ul>
    </>
  );
}

export function PrepDrawer({
  open,
  onOpenChange,
  onOpenPreflight,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Open Pre-flight": App closes this drawer and opens that one. */
  onOpenPreflight: () => void;
}): JSX.Element {
  const toast = useToast();
  // The action the next load asks for; Refresh repeats the last one that loaded, as the old
  // page does ("All beats" sticks until the page reloads).
  const nextAction = useRef<PrepAction>('summary');
  const digest = useQuery({
    queryKey: PREP_KEY,
    queryFn: async () => {
      const d = await callTool<PrepDigest | null>('get-prep-digest', {
        action: nextAction.current,
      });
      if (!d || typeof d !== 'object') throw new Error('The bridge sent no digest.');
      return d;
    },
    enabled: false,
    retry: false,
    staleTime: Infinity,
  });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const action: PrepAction = digest.data?.action ?? 'summary';

  const load = async (next: PrepAction = action): Promise<void> => {
    // A load while one runs is dropped, as on the old page.
    if (loading) return;
    nextAction.current = next;
    setLoading(true);
    setLoadError(null);
    const outcome = await digest.refetch({ cancelRefetch: false });
    setLoading(false);
    if (outcome.isError) setLoadError(errorText(outcome.error));
  };

  useEffect(() => {
    if (!open) return;
    usage().trackView('dash.prep.view');
    void load();
    return () => usage().endView('dash.prep.view');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open]);

  const openJournal = (journalId: string): void => {
    callTool('open-in-foundry', { uuid: `JournalEntry.${journalId}` }).then(
      () => toast('Opened in Foundry', 'ok'),
      (err: unknown) => toast(`✗ open-in-foundry: ${errorText(err)}`, 'err')
    );
  };

  const d = loadError === null ? digest.data : undefined;
  const sub = loading
    ? 'Loading…'
    : loadError !== null
      ? 'GM only. The digest did not load.'
      : d
        ? `GM only. Loaded ${clock(Number(d.computedAt) || Date.now()) || 'just now'}.`
        : 'GM only. Facts for your next session.';

  // A failed load empties the sections and says why under "Last session".
  const last =
    loadError !== null ? (
      <Empty>Couldn&apos;t load the prep digest: {loadError}</Empty>
    ) : d ? (
      <LastSession
        last={d.lastSession}
        action={action}
        onAllBeats={() => void load('last-session')}
      />
    ) : (
      <Empty>Loading…</Empty>
    );

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      id="prep-drawer"
      title="📋 Prep"
      sub={sub}
      help="dashboard#the-prep-drawer--prep"
      close={<DrawerClose data-track="dash.prep.close" />}
      onEscape={() => usage().track('shortcut', 'dash.shortcut.escape-prep')}
      bodyClassName="prep-body"
      actions={
        <button
          className="btn btn-primary"
          data-track="dash.prep.refresh"
          disabled={loading}
          onClick={() => void load()}
        >
          ↻ Refresh
        </button>
      }
    >
      <div>
        {(d?.warnings ?? []).map((w, i) => (
          <div key={i} className="preflight-summary pf-warn">
            {w}
          </div>
        ))}
      </div>
      <h3 className="preflight-h">Last session</h3>
      <div>{last}</div>
      <h3 className="preflight-h">Open threads</h3>
      <div>{d && <Threads d={d} onOpen={openJournal} />}</div>
      <h3 className="preflight-h">Next session notes</h3>
      <div>{d && <NextSessionNotes next={d.nextSession} onOpen={openJournal} />}</div>
      <h3 className="preflight-h">Ready</h3>
      <div>{d && <Ready d={d} onOpenPreflight={onOpenPreflight} />}</div>
      <h3 className="preflight-h">Recent changes</h3>
      <div>{d && <Changes rc={d.recentChanges} />}</div>
      <div>{d?.tarokka?.hasReading && <p className="pf-detail">A Tarokka reading exists.</p>}</div>
    </Drawer>
  );
}
