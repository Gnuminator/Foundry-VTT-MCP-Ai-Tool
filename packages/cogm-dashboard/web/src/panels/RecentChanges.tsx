// Recent Changes (D-077, I-109): what changed at the table and an Undo for it.
// Three tabs when the bridge has `list-changes`: Tool (every change made through the AI
// Tool, Claude and the dashboard buttons: the guarded changes, list-recent-changes), Game (what
// players and the GM did directly in Foundry) and Everything (both, with a person filter and
// Redo); an older bridge shows the Tool list alone. It docks in the During
// and After views as a card (a fold card in During) and reloads when a change lands: an apply or an
// undo here (GAME_STATE_KEY), a `gm-change` event from Foundry (lib/stream.ts), or its ↻ button.
//
// Every Undo goes through the dashboard's guarded paths (lib/guarded.ts), never a new write path:
// the Tool tab's Undo and a Redo are undo-change after the confirm window; the Game and Everything tabs' Undo
// plans with plan-undo-changes, walks the undo window (just this, everything since, rewind) and
// applies the plan with apply-planned-change; a reveal's Undo (it also wrote the AI Tool's own
// data, which a plan cannot put back) is the plain undo-change, as the Tool tab's (PR #330). GM only:
// the player view never loads this page, and the routes it calls refuse a player.
import { useQuery } from '@tanstack/react-query';
import { useContext, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';

import { DockContext, useDockHost } from '../components/Drawer';
import { focusedElement } from '../components/ConfirmDialog';
import { useCardFold } from '../components/Folds';
import { useToast } from '../components/Toasts';
import { useUndoWindow } from '../components/UndoWindow';
import { api, callTool, errorText } from '../lib/api';
import {
  AI_LIMIT,
  EVERYONE_LIMIT,
  EVERYONE_TOOL,
  FILTER_AI,
  FILTER_ALL,
  CHANGES_TABS,
  changeState,
  dialogFor,
  filterChanges,
  foldTokenMoves,
  filterOptions,
  gameChanges,
  firstStage,
  needsDestructive,
  nextStep,
  obsidianChangePath,
  planArgs,
  EVERYONE_REFRESH_MS,
  readAiChanges,
  readEveryoneChanges,
  readUndoPlan,
  redoConfirm,
  rowView,
  validFilter,
  type AiChange,
  type ChangesTab,
  type EveryoneChange,
  type RowView,
  type UndoPlan,
  type UndoScope,
  type UndoStage,
} from '../lib/changes';
import { gmChangeLabel } from '../lib/feed';
import { REMEMBER, readChoice, readText, writeChoice } from '../lib/remember';
import { failCode, useGuardedTools, type GuardedTools } from '../lib/guarded';
import { CHANGES_KEY, useObsidianFileUrl } from '../lib/stream';
import { usage } from '../lib/usage';
import { Button, Panel, panelStateOf } from '../ui';

/** The two lists, under CHANGES_KEY so one invalidation reloads whichever is showing. */
const AI_KEY = [...CHANGES_KEY, 'ai'] as const;
const EVERYONE_KEY = [...CHANGES_KEY, 'everyone'] as const;

/** The tool catalog (the Tool Runner's query, same key and answer): tells if `list-changes` exists. */
const TOOLS_KEY = ['tools'] as const;

/** A time as the browser words it; the raw text when it is not one. */
function timeText(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms).toLocaleString();
}

/** The "Lines" fold under a row: nothing when there are none. */
function Lines({
  lines,
  track,
}: {
  lines: string[];
  track: 'ai' | 'everyone';
}): JSX.Element | null {
  if (lines.length === 0) return null;
  const items = lines.map((line, i) => <li key={i}>{line}</li>);
  const label = `${lines.length} line(s)`;
  return (
    <details>
      {track === 'ai' ? (
        <summary data-track="dash.changes.show-diff">{label}</summary>
      ) : (
        <summary data-track="dash.changes.everyone-show-lines">{label}</summary>
      )}
      <ul className="change-diff">{items}</ul>
    </details>
  );
}

/** The 📓 link to the month's change log in Obsidian; nothing until the vault and world are known. */
function ObsidianLink({ change }: { change: AiChange }): JSX.Element | null {
  const url = useObsidianFileUrl(obsidianChangePath(change) ?? '');
  if (!obsidianChangePath(change) || !url) return null;
  return (
    <a
      className="link-btn"
      data-track="dash.changes.open-obsidian"
      href={url}
      target="_blank"
      rel="noopener"
      title="Open this month's change log in Obsidian"
      aria-label="Open this month's change log in Obsidian"
    >
      📓 Obsidian
    </a>
  );
}

function AiRow({
  change,
  onUndo,
}: {
  change: AiChange;
  onUndo: (change: AiChange) => void;
}): JSX.Element {
  const state = changeState(change);
  return (
    <div className={`change-entry state-${state}`}>
      <div className="change-head">
        <span className="change-summary">{change.summary}</span>
        {change.canUndo && (
          <Button
            size="sm"
            data-track="dash.changes.undo"
            aria-label={`Undo: ${change.summary}`}
            onClick={() => onUndo(change)}
          >
            Undo
          </Button>
        )}
      </div>
      <div className="change-meta">
        <span className="change-state">{state}</span>
        <span>{gmChangeLabel(change.feature)}</span>
        <span>{change.target}</span>
        <span>{timeText(change.appliedAt)}</span>
        {change.requestedBy && <span>by {change.requestedBy}</span>}
        <ObsidianLink change={change} />
      </div>
      <Lines lines={change.diff} track="ai" />
    </div>
  );
}

function EveryoneRow({
  row,
  onUndo,
  onRedo,
}: {
  row: RowView;
  onUndo: (id: string) => void;
  onRedo: (id: string) => void;
}): JSX.Element {
  return (
    <div className={`change-entry ${row.undone ? 'state-undone' : 'state-applied'}`}>
      <div className="change-head">
        <span className="change-summary">{row.summary}</span>
        <span className="change-actions">
          {row.canUndo && (
            <Button
              size="sm"
              data-track="dash.changes.everyone-undo"
              aria-label={row.undoLabel}
              title={row.undoLabel}
              onClick={() => onUndo(row.id)}
            >
              Undo
            </Button>
          )}
          {row.redoId && (
            <Button
              size="sm"
              data-track="dash.changes.everyone-redo"
              title="Put this change back"
              aria-label={`Redo: ${row.summary}`}
              onClick={() => onRedo(row.id)}
            >
              Redo
            </Button>
          )}
        </span>
      </div>
      <div className="change-meta">
        <span className="change-who">{row.who}</span>
        <span>{timeText(row.at)}</span>
        {row.undone && <span className="change-badge">{row.undoneText}</span>}
      </div>
      <Lines lines={row.lines} track="everyone" />
    </div>
  );
}

/**
 * The Undo flow of the Everyone tab: plan it, then walk the choice (just this, everything since,
 * or the advanced rewind) until the GM applies a plan or cancels. Nothing changes before the
 * apply. The window was the confirmation (and the second one when the plan is destructive), so the
 * apply asks nothing more.
 */
async function walkUndo(
  id: string,
  row: RowView,
  deps: {
    guarded: GuardedTools;
    ask: ReturnType<typeof useUndoWindow>['ask'];
    fail: (text: string) => void;
  }
): Promise<void> {
  const { guarded, ask, fail } = deps;
  const planFor = async (scope: UndoScope): Promise<UndoPlan | null> => {
    try {
      const plan = readUndoPlan(await callTool('plan-undo-changes', planArgs(id, scope)));
      if (!plan) throw new Error('The bridge sent no plan.');
      usage().trackTool('plan-undo-changes', 'ok');
      return plan;
    } catch (err) {
      usage().trackTool('plan-undo-changes', 'error', failCode(err));
      fail(`✗ ${errorText(err)}`);
      return null;
    }
  };
  let plan = await planFor({ scope: 'just-this' });
  if (!plan) return;
  let stage: UndoStage = firstStage(plan);
  for (;;) {
    const key = await ask(dialogFor(stage, plan, row.thing));
    const step = nextStep(stage, key);
    if ('done' in step) return;
    if ('apply' in step) {
      await guarded.applyApproved(plan.planId, needsDestructive(plan));
      return;
    }
    if (step.plan) {
      const next = await planFor(step.plan);
      if (!next) continue;
      plan = next;
    }
    stage = step.stage;
  }
}

/** The one-line body of a list that is not there: a failure words itself, the rest use Panel's. */
const failedText = (err: unknown): string => `Couldn't load changes: ${errorText(err)}`;

/** What each tab is called and what it lists (its tooltip). The usage names are literals in TabButton. */
const TAB_TEXT: Record<ChangesTab, { label: string; title: string }> = {
  tool: {
    label: 'Tool',
    title:
      'The guarded changes made through the AI Tool (Claude and the dashboard buttons), with Undo where it can still be done.',
  },
  game: {
    label: 'Game',
    title: 'What players and you changed directly in Foundry, over the last 7 days.',
  },
  everything: {
    label: 'Everything',
    title: 'Tool and Game changes together, newest first.',
  },
};

function TabButton({
  tab,
  shown,
  onPick,
}: {
  tab: ChangesTab;
  shown: ChangesTab;
  onPick: (tab: ChangesTab) => void;
}): JSX.Element {
  const { label, title } = TAB_TEXT[tab];
  const props = {
    type: 'button',
    className: 'changes-tab',
    id: `changes-tab-${tab}`,
    title,
    'aria-pressed': shown === tab,
    onClick: () => onPick(tab),
  } as const;
  switch (tab) {
    case 'tool':
      return (
        <button {...props} data-track="dash.changes.tab-tool">
          {label}
        </button>
      );
    case 'game':
      return (
        <button {...props} data-track="dash.changes.tab-game">
          {label}
        </button>
      );
    case 'everything':
      return (
        <button {...props} data-track="dash.changes.tab-everything">
          {label}
        </button>
      );
  }
}

function ChangesCard({ active, oneList }: { active: boolean; oneList: boolean }): JSX.Element {
  const fold = useCardFold();
  const toast = useToast();
  const guarded = useGuardedTools();
  const undoWindow = useUndoWindow();
  // The GM's last tab and person come back on the next visit (lib/remember.ts).
  const [tab, setTabState] = useState<ChangesTab>(() =>
    readChoice(REMEMBER.changesTab, CHANGES_TABS, 'tool')
  );
  // The Live screen's AI only box is its own choice, so it never changes the dashboard's person.
  const personKey = oneList ? REMEMBER.liveAiOnly : REMEMBER.changesPerson;
  const [person, setPersonState] = useState(() => {
    const saved = readText(personKey, FILTER_ALL);
    return oneList && saved !== FILTER_AI ? FILTER_ALL : saved;
  });
  const setTab = (next: ChangesTab): void => {
    setTabState(next);
    writeChoice(REMEMBER.changesTab, next);
  };
  const setPerson = (next: string): void => {
    setPersonState(next);
    writeChoice(personKey, next);
  };
  const cardRef = useRef<HTMLElement>(null);

  // The Game and Everything tabs need the bridge's list-changes: an older bridge has none and
  // the Tool list stands alone (the catalog is the Tool Runner's, kept by the server for a minute).
  const catalog = useQuery({
    queryKey: TOOLS_KEY,
    queryFn: () => api<{ tools?: { name: string }[] }>('/api/tools'),
    enabled: active,
    staleTime: 60_000,
    retry: false,
  });
  const supported = catalog.data?.tools?.some(t => t.name === EVERYONE_TOOL) === true;
  // The Live screen's "What just happened" is the Everything list alone, with an AI only box.
  const shown: ChangesTab = supported ? (oneList ? 'everything' : tab) : 'tool';
  const fromBridge = shown !== 'tool';

  // Each list loads while its tab shows (the Game and Everything lists are not read otherwise), on every
  // switch to it, after a change or undo (GAME_STATE_KEY) and on a gm-change event (stream.ts).
  const ai = useQuery({
    queryKey: AI_KEY,
    queryFn: async () => readAiChanges(await callTool('list-recent-changes', { limit: AI_LIMIT })),
    enabled: active && !fromBridge,
    staleTime: 0,
    retry: false,
  });
  const everyone = useQuery({
    queryKey: EVERYONE_KEY,
    queryFn: async () =>
      readEveryoneChanges(await callTool(EVERYONE_TOOL, { limit: EVERYONE_LIMIT })),
    enabled: active && fromBridge,
    staleTime: 0,
    retry: false,
    // A token a player or the GM moved in Foundry sends no gm-change event: the tab reads again
    // while it shows (not in a hidden browser tab).
    refetchInterval: EVERYONE_REFRESH_MS,
  });
  const current = fromBridge ? everyone : ai;

  const all: EveryoneChange[] = everyone.data?.changes ?? [];
  // The Game tab lists only what people did in Foundry, so its people and rows come from that.
  const pool = shown === 'game' ? gameChanges(all) : all;
  const personNow = validFilter(pool, person, shown !== 'game');
  const rows = foldTokenMoves(filterChanges(pool, personNow));
  const note = everyone.data?.note ?? '';

  // One Undo or Redo at a time: a second click while one runs (or its window is open) is ignored.
  const busy = useRef(false);
  const run = async (flow: () => Promise<void>): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    const from = focusedElement();
    try {
      await flow();
      // The list reloads after a change; the clicked row may be gone, and focus with it.
      await current.refetch({ cancelRefetch: false }).catch(() => undefined);
    } finally {
      busy.current = false;
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost) {
        if (from?.isConnected && !from.matches(':disabled')) from.focus();
        else cardRef.current?.focus();
      }
    }
  };

  const undoAi = (change: AiChange): void =>
    void run(async () => {
      // The click opens the confirm window (a delete-grade write), then undo-change.
      await guarded.write('undo-change', { changeId: change.changeId }, 'destructive', {
        lines: change.diff,
        summary: `Undo: ${change.summary}`,
      });
    });

  const undoEveryone = (id: string): void =>
    void run(async () => {
      const change = all.find(c => c.id === id);
      if (!change) return;
      // Asks before it plans, so a refusal leaves no plan behind.
      if (guarded.gated('apply-planned-change')) return;
      const row = rowView(change, all);
      if (row.ownData) {
        // A reveal also wrote the AI Tool's own data, which a plan cannot put back: the plain
        // undo (the AI tab's), after its own confirm.
        await guarded.write('undo-change', { changeId: id }, 'destructive', {
          lines: row.lines,
          summary: `Undo: ${row.summary}`,
        });
        return;
      }
      await walkUndo(id, row, {
        guarded,
        ask: undoWindow.ask,
        fail: text => toast(text, 'err'),
      });
    });

  // Redo is undoing the undo: it asks first, like Undo on the Tool tab.
  const redo = (id: string): void =>
    void run(async () => {
      const change = all.find(c => c.id === id);
      const row = change ? rowView(change, all) : null;
      if (!change || !row?.redoId) return;
      const confirm = redoConfirm(change, all);
      await guarded.write('undo-change', { changeId: row.redoId }, 'destructive', confirm);
    });

  const aiState = panelStateOf(ai, { isEmpty: d => d.length === 0, detect: true });
  const everyoneState = panelStateOf(everyone, {
    isEmpty: d => rows.length === 0 && d.note === '',
    detect: true,
  });
  const state = fromBridge ? everyoneState : aiState;
  const count = fromBridge ? rows.length : (ai.data?.length ?? 0);
  const meta = state === 'ready' || state === 'empty' ? `${count} shown` : '-';
  const emptyText = !fromBridge
    ? 'No changes through the AI Tool yet.'
    : all.length === 0
      ? 'No changes in the last 7 days.'
      : shown === 'game' && pool.length === 0
        ? 'No changes made in Foundry in the last 7 days.'
        : 'No changes by this person.';
  const message =
    state === 'error' ? failedText(current.error) : state === 'empty' ? emptyText : undefined;

  const folded = fold?.folded === true;
  return (
    <>
      <Panel
        ref={cardRef}
        id="pane-changes"
        tabIndex={-1}
        className={folded ? 'is-folded' : undefined}
        title={oneList ? 'What just happened' : 'Recent Changes'}
        titleId="changes-title"
        aria-labelledby="changes-title"
        help="dashboard#recent-changes"
        status={<span id="changes-meta">{meta}</span>}
        {...(fold
          ? { headStart: fold.button, ...(folded ? { onTitleClick: fold.toggle } : {}) }
          : {})}
        actions={
          <button
            type="button"
            className="link-btn"
            id="changes-refresh"
            data-track="dash.changes.refresh"
            title="Reload recent changes"
            aria-label="Reload recent changes"
            onClick={() => void current.refetch()}
          >
            ↻
          </button>
        }
        lead={
          supported && oneList ? (
            <div className="changes-toolbar" id="changes-toolbar">
              <label className="changes-ai-only">
                <input
                  type="checkbox"
                  id="changes-ai-only"
                  data-track="dash.changes.ai-only"
                  checked={personNow === FILTER_AI}
                  onChange={e => setPerson(e.target.checked ? FILTER_AI : FILTER_ALL)}
                />{' '}
                AI only
              </label>
            </div>
          ) : supported ? (
            <div className="changes-toolbar" id="changes-toolbar">
              <div className="changes-tabs" role="group" aria-label="Which changes to show">
                <TabButton tab="tool" shown={shown} onPick={setTab} />
                <TabButton tab="game" shown={shown} onPick={setTab} />
                <TabButton tab="everything" shown={shown} onPick={setTab} />
              </div>
              {fromBridge && (
                <select
                  id="changes-person"
                  className="select changes-person"
                  data-track="dash.changes.person"
                  aria-label="Show changes by"
                  value={personNow}
                  onChange={e => setPerson(e.target.value)}
                >
                  {filterOptions(pool, shown !== 'game').map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : undefined
        }
        bodyId="pane-changes-body"
        state={state}
        {...(message !== undefined ? { stateMessage: message } : {})}
        onRetry={() => void current.refetch()}
      >
        {!fromBridge && ai.data?.map(c => <AiRow key={c.changeId} change={c} onUndo={undoAi} />)}
        {fromBridge && (
          <>
            {note && <p className="empty">{note}</p>}
            {rows.map(c => (
              <EveryoneRow key={c.id} row={rowView(c, all)} onUndo={undoEveryone} onRedo={redo} />
            ))}
          </>
        )}
      </Panel>
      {undoWindow.element}
    </>
  );
}

/**
 * The Recent Changes card in the During and After views. It sits in the slot its moment gives it
 * (App wraps it in a dock, as Party and Handouts) through a host that moves with the moment, so
 * its tab, filter and data stay when the view changes. Over Before it has no slot: it loads
 * nothing and shows nothing.
 */
export default function RecentChangesPane({
  oneList = false,
}: {
  /** The Live screen: one list ("What just happened") with an AI only box, no tabs. */
  oneList?: boolean;
}): JSX.Element {
  const slot = useContext(DockContext);
  const host = useDockHost(slot);
  return createPortal(<ChangesCard active={slot !== null} oneList={oneList} />, host);
}
