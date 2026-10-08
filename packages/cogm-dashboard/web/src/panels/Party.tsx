// Party (I-079, I-097): the dnd5e party at a glance from the bridge's get-party (shared/src/party.ts
// has the full shape; only the fields shown here are typed), and four one-click changes through
// plan-party-change (travel pace, into the encounter, place the tokens, a rest request). Each
// change lands in Recent Changes, and its toast has Undo. GM only: exact HP and hidden tokens.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type JSX } from 'react';

import { Drawer, DrawerClose } from '../components/Drawer';
import { useToast } from '../components/Toasts';
import { callTool, errorText } from '../lib/api';
import { GAME_STATE_KEY, useGuardedChange } from '../lib/guarded';
import { usage } from '../lib/usage';

interface PartyToken {
  hidden: boolean;
  inCombat: boolean;
}

interface PartyMember {
  actorId: string;
  uuid: string;
  name: string;
  level: number | null;
  hp: { value: number; max: number; temp: number } | null;
  ac: number | null;
  passivePerception: number | null;
  exhaustion: number;
  hitDice: { value: number; max: number } | null;
  deathSaves: { success: number; failure: number } | null;
  conditions: string[];
  inspiration: boolean;
  tokens: PartyToken[];
}

interface PartyGroup {
  actorId: string;
  name: string;
  primary: boolean;
  level: number;
  pace: { value: string; label: string; slowed: boolean } | null;
  members: PartyMember[];
  restCards: Partial<Record<'short' | 'long', unknown>>;
}

interface PartyState {
  groups: PartyGroup[];
  paceOptions: { value: string; label: string }[];
  scene: { name: string } | null;
  encounter: { round: number; started: boolean } | null;
  warnings: string[];
}

/** Under GAME_STATE_KEY: an applied change or an undo refetches it while the drawer is open. */
const PARTY_KEY = [...GAME_STATE_KEY, 'party'] as const;

/** The plan-party-change actions (the bridge's tools/party.ts). */
type PartyActionArgs =
  | { action: 'pace'; pace: string }
  | { action: 'add-to-combat' }
  | { action: 'place' }
  | { action: 'rest-request'; rest: 'short' | 'long' };

const list = <T,>(x: T[] | null | undefined): T[] => (Array.isArray(x) ? x : []);

const hpClass = (ratio: number): string => (ratio <= 0.33 ? 'low' : ratio <= 0.66 ? 'mid' : '');

function MemberRow({
  m,
  sceneName,
  onOpen,
}: {
  m: PartyMember;
  sceneName: string;
  onOpen: (uuid: string) => void;
}): JSX.Element {
  const facts: string[] = [];
  if (m.level != null) facts.push(`Level ${m.level}`);
  if (m.ac != null) facts.push(`AC ${m.ac}`);
  if (m.passivePerception != null) facts.push(`Passive Perception ${m.passivePerception}`);
  if (m.hitDice) facts.push(`Hit dice ${m.hitDice.value}/${m.hitDice.max}`);
  const chips = list(m.conditions);
  if (m.exhaustion > 0) chips.unshift(`Exhaustion ${m.exhaustion}`);
  const tokens = list(m.tokens);
  let tokenText = sceneName ? `No token on ${sceneName}` : '';
  if (tokens.length > 0) {
    const inCombat = tokens.some(t => t.inCombat) ? ', in the encounter' : '';
    const hidden = tokens.some(t => t.hidden) ? ', hidden' : '';
    tokenText = `On ${sceneName}${hidden}${inCombat}`;
  }
  const hp = m.hp && m.hp.max > 0 ? m.hp : null;
  const ratio = hp ? hp.value / hp.max : 0;
  return (
    <li className="preflight-item party-member">
      <span className="pf-text">
        <span className="pf-label">
          {m.name}
          {m.inspiration && (
            <>
              {' '}
              <span className="party-inspiration" title="Inspiration">
                ★
              </span>
            </>
          )}
        </span>
        <span className="pf-detail">{facts.join(' · ')}</span>
        {chips.length > 0 && (
          <div className="conditions">
            {chips.map((c, i) => (
              <span key={i} className="condition-chip">
                {c}
              </span>
            ))}
          </div>
        )}
        {m.deathSaves && (
          <div className="death-saves">
            Death saves: {m.deathSaves.success} saved, {m.deathSaves.failure} failed
          </div>
        )}
        {tokenText && <span className="pf-detail">{tokenText}</span>}
      </span>
      {hp && (
        <div className="hp party-hp">
          <div className="hp-text">{`${hp.value}/${hp.max}${hp.temp > 0 ? ` +${hp.temp}` : ''}`}</div>
          <div className="hp-bar">
            <div
              className={['hp-fill', hpClass(ratio)].filter(Boolean).join(' ')}
              style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
            />
          </div>
        </div>
      )}
      <button
        type="button"
        className="btn btn-small"
        data-track="dash.party.open-actor"
        onClick={() => onOpen(m.uuid)}
      >
        Open
      </button>
    </li>
  );
}

type Act = (args: PartyActionArgs) => void;

function Pace({
  g,
  options,
  busy,
  act,
}: {
  g: PartyGroup;
  options: PartyState['paceOptions'];
  busy: boolean;
  act: Act;
}): JSX.Element {
  const pace = g.pace;
  if (!pace) return <p className="pf-detail">This group has no travel pace.</p>;
  return (
    <>
      <p className="pf-detail">
        Now: <strong>{pace.label}</strong>
        {pace.slowed ? '. A slowed member holds the party to slow pace.' : ''}
      </p>
      {options.length > 0 && (
        <div className="party-buttons">
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              className="btn btn-small"
              data-track="dash.party.pace"
              // A slowed party can still pick its set pace again.
              disabled={busy || (o.value === pace.value && !pace.slowed)}
              onClick={() => act({ action: 'pace', pace: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Combat({
  s,
  g,
  busy,
  act,
}: {
  s: PartyState;
  g: PartyGroup;
  busy: boolean;
  act: Act;
}): JSX.Element {
  if (!s.scene) return <p className="pf-detail">No active scene.</p>;
  const sceneName = s.scene.name || 'the scene';
  const tokens = list(g.members).flatMap(m => list(m.tokens));
  const toAdd = tokens.filter(t => !t.inCombat).length;
  const where = s.encounter
    ? `Encounter on ${sceneName}, round ${s.encounter.round}${s.encounter.started ? '' : ' (not started)'}.`
    : `No encounter. The button starts one on ${sceneName}.`;
  let label = s.encounter ? `Add ${toAdd} to the encounter` : `Start an encounter with ${toAdd}`;
  if (tokens.length === 0) label = `No party tokens on ${sceneName}`;
  else if (toAdd === 0) label = 'Everyone is in the encounter';
  return (
    <>
      <p className="pf-detail">{where}</p>
      <div className="party-buttons">
        <button
          type="button"
          className="btn btn-small"
          data-track="dash.party.add-to-combat"
          disabled={busy || toAdd === 0}
          onClick={() => act({ action: 'add-to-combat' })}
        >
          {label}
        </button>
      </div>
      <p className="pf-detail">
        Puts everyone without a token on the scene you are looking at in Foundry next to each other,
        around the centre of your view. Undo removes them again.
      </p>
      <div className="party-buttons">
        <button
          type="button"
          className="btn btn-small"
          data-track="dash.party.place"
          disabled={busy}
          onClick={() => act({ action: 'place' })}
        >
          Place the party here
        </button>
      </div>
    </>
  );
}

function Rest({ g, busy, act }: { g: PartyGroup; busy: boolean; act: Act }): JSX.Element {
  const cards = g.restCards ?? {};
  return (
    <>
      <p className="pf-detail">
        Posts dnd5e&apos;s rest card to chat; each player clicks it to rest their character. Undo
        removes the card while nobody has used it.
      </p>
      <div className="party-buttons">
        <button
          type="button"
          className="btn btn-small"
          data-track="dash.party.rest-short"
          disabled={busy || !cards.short}
          onClick={() => act({ action: 'rest-request', rest: 'short' })}
        >
          Short rest request
        </button>
        <button
          type="button"
          className="btn btn-small"
          data-track="dash.party.rest-long"
          disabled={busy || !cards.long}
          onClick={() => act({ action: 'rest-request', rest: 'long' })}
        >
          Long rest request
        </button>
      </div>
    </>
  );
}

export function PartyDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const toast = useToast();
  const runChange = useGuardedChange();
  // Loads on every opening (stale at once) and after a change or undo while open; nothing in
  // the stream says the party moved, so a change made in Foundry shows on Refresh.
  const party = useQuery({
    queryKey: PARTY_KEY,
    queryFn: async () => {
      const s = await callTool<PartyState | null>('get-party', {});
      if (!s || typeof s !== 'object') throw new Error('The bridge sent no party.');
      return s;
    },
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const [groupId, setGroupId] = useState<string | null>(null);
  // One change at a time; the ref also catches a double click before the re-render.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    usage().trackView('dash.party.view');
    return (): void => usage().endView('dash.party.view');
  }, [open]);

  // A failed load empties the sections and says why under Members, as on the old page.
  const s = party.isError ? undefined : party.data;
  const groups = list(s?.groups);
  const g = groups.find(x => x.actorId === groupId) ?? groups[0];
  const members = list(g?.members);

  const act: Act = args => {
    if (busyRef.current || !g) return;
    busyRef.current = true;
    setBusy(true);
    void runChange('plan-party-change', { ...args, groupId: g.actorId }).finally(() => {
      busyRef.current = false;
      setBusy(false);
    });
  };

  const openActor = (uuid: string): void => {
    callTool('open-in-foundry', { uuid }).then(
      () => toast('Opened in Foundry', 'ok'),
      (err: unknown) => toast(`✗ open-in-foundry: ${errorText(err)}`, 'err')
    );
  };

  const sub = party.isFetching
    ? 'Loading…'
    : party.isError
      ? 'GM only. The party did not load.'
      : !s
        ? 'GM only. The dnd5e party at a glance.'
        : !g
          ? 'GM only. No party yet.'
          : `GM only. ${g.name}, level ${g.level}, ${members.length} ${members.length === 1 ? 'member' : 'members'}.${g.primary ? '' : ' Not the primary party.'}`;

  const sceneName = s?.scene ? s.scene.name : '';
  const memberBlock = party.isError ? (
    <p className="empty">Couldn&apos;t load the party: {errorText(party.error)}</p>
  ) : !s ? (
    <p className="empty">Loading…</p>
  ) : !g ? (
    <p className="empty">
      No party yet. In Foundry, create an Actor of type Group, drag the characters onto it, then
      right-click it in the Actors tab and set it as the primary party.
    </p>
  ) : members.length === 0 ? (
    <p className="empty">The group has no members. Drag characters onto it in Foundry.</p>
  ) : (
    <ul className="preflight-list" aria-label="Members">
      {members.map(m => (
        <MemberRow key={m.actorId || m.uuid} m={m} sceneName={sceneName} onOpen={openActor} />
      ))}
    </ul>
  );

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      id="party-drawer"
      title="🛡 Party"
      sub={sub}
      help="dashboard#the-party-drawer--party"
      close={<DrawerClose data-track="dash.party.close" />}
      onEscape={() => usage().track('shortcut', 'dash.shortcut.escape-party')}
      bodyClassName="party-body"
      actions={
        <>
          <button
            className="btn btn-primary"
            id="party-refresh"
            data-track="dash.party.refresh"
            disabled={party.isFetching}
            onClick={() => void party.refetch()}
          >
            ↻ Refresh
          </button>
          {groups.length > 1 && g && (
            <select
              id="party-group"
              className="party-group"
              aria-label="Party group"
              data-track="dash.party.group"
              value={g.actorId}
              onChange={e => setGroupId(e.target.value)}
            >
              {groups.map(x => (
                <option key={x.actorId} value={x.actorId}>
                  {x.name + (x.primary ? ' (primary)' : '')}
                </option>
              ))}
            </select>
          )}
        </>
      }
    >
      <div id="party-warnings">
        {list(s?.warnings).map((w, i) => (
          <div key={i} className="preflight-summary pf-warn">
            {w}
          </div>
        ))}
      </div>
      <h3 className="preflight-h">Members</h3>
      <div id="party-members">{memberBlock}</div>
      {s && g && (
        <div id="party-actions">
          <h3 className="preflight-h">Travel pace</h3>
          <div id="party-pace">
            <Pace g={g} options={list(s.paceOptions)} busy={busy} act={act} />
          </div>
          <h3 className="preflight-h">Combat</h3>
          <div id="party-combat">
            <Combat s={s} g={g} busy={busy} act={act} />
          </div>
          <h3 className="preflight-h">Rest</h3>
          <div id="party-rest">
            <Rest g={g} busy={busy} act={act} />
          </div>
        </div>
      )}
      <p className="pf-detail party-hint">
        Actions apply in one click and land in Recent Changes with Undo. They need the &quot;AI
        Tool: Party (writes)&quot; switch in the module settings (Ready for session turns it on).
      </p>
    </Drawer>
  );
}
