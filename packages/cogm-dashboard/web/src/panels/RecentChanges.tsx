// Recent Changes (D-077, I-109): what changed at the table and an Undo for it, ported from the old
// page. Two lists when the bridge has `list-changes`: AI (the guarded changes, list-recent-changes)
// and Everyone (players, the GM and the AI, with a person filter and Redo). It docks in the During
// and After views as a card (a fold card in During) and reloads when a change lands: an apply or an
// undo here (GAME_STATE_KEY), a `gm-change` event from Foundry (lib/stream.ts), or its ↻ button.
//
// Every Undo goes through the dashboard's guarded paths (lib/guarded.ts), never a new write path:
// the AI tab's Undo and a Redo are undo-change after the confirm window; the Everyone tab's Undo
// plans with plan-undo-changes, walks the undo window (just this, everything since, rewind) and
// applies the plan with apply-planned-change; a reveal's Undo (it also wrote the AI Tool's own
// data, which a plan cannot put back) is the plain undo-change, as the AI tab's (PR #330). GM only:
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
  FILTER_ALL,
  changeState,
  dialogFor,
  filterChanges,
  filterOptions,
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
  type EveryoneChange,
  type RowView,
  type UndoPlan,
  type UndoScope,
  type UndoStage,
} from '../lib/changes';
import { failCode, useGuardedTools, type GuardedTools } from '../lib/guarded';
import { CHANGES_KEY, useObsidianFileUrl } from '../lib/stream';
import { usage } from '../lib/usage';
import { Button, Panel, panelStateOf } from '../ui';

type Tab = 'ai' | 'everyone';

/** The two lists, under CHANGES_KEY so one invalidation reloads whichever is showing. */
const AI_KEY = [...CHANGES_KEY, 'ai'] as const;
const EVERYONE_KEY = [...CHANGES_KEY, 'everyone'] as const;

/** The tool catalog (the Tool runner's query, same key and answer): tells if `list-changes` exists. */
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
      📓
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
        <span>{change.feature}</span>
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
              aria-label={`Undo: ${row.summary}`}
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

function ChangesCard({ active }: { active: boolean }): JSX.Element {
  const fold = useCardFold();
  const toast = useToast();
  const guarded = useGuardedTools();
  const undoWindow = useUndoWindow();
  const [tab, setTab] = useState<Tab>('ai');
  const [person, setPerson] = useState(FILTER_ALL);
  const cardRef = useRef<HTMLElement>(null);

  // The Everyone tab needs the bridge's list-changes: an older bridge has none and the tab stays
  // hidden (the catalog is the Tool runner's, kept by the server for a minute).
  const catalog = useQuery({
    queryKey: TOOLS_KEY,
    queryFn: () => api<{ tools?: { name: string }[] }>('/api/tools'),
    enabled: active,
    staleTime: 60_000,
    retry: false,
  });
  const supported = catalog.data?.tools?.some(t => t.name === EVERYONE_TOOL) === true;
  const shown: Tab = supported ? tab : 'ai';

  // Each list loads while its tab shows (the Everyone list is not read otherwise), on every
  // switch to it, after a change or undo (GAME_STATE_KEY) and on a gm-change event (stream.ts).
  const ai = useQuery({
    queryKey: AI_KEY,
    queryFn: async () => readAiChanges(await callTool('list-recent-changes', { limit: AI_LIMIT })),
    enabled: active && shown === 'ai',
    staleTime: 0,
    retry: false,
  });
  const everyone = useQuery({
    queryKey: EVERYONE_KEY,
    queryFn: async () =>
      readEveryoneChanges(await callTool(EVERYONE_TOOL, { limit: EVERYONE_LIMIT })),
    enabled: active && shown === 'everyone',
    staleTime: 0,
    retry: false,
    // A token a player or the GM moved in Foundry sends no gm-change event: the tab reads again
    // while it shows (not in a hidden browser tab).
    refetchInterval: EVERYONE_REFRESH_MS,
  });
  const current = shown === 'ai' ? ai : everyone;

  const all: EveryoneChange[] = everyone.data?.changes ?? [];
  const personNow = validFilter(all, person);
  const rows = filterChanges(all, personNow);
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

  // Redo is undoing the undo: it asks first, like Undo on the AI tab.
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
  const state = shown === 'ai' ? aiState : everyoneState;
  const count = shown === 'ai' ? (ai.data?.length ?? 0) : rows.length;
  const meta = state === 'ready' || state === 'empty' ? `${count} shown` : '-';
  const emptyText =
    shown === 'ai'
      ? 'No guarded changes yet.'
      : all.length === 0
        ? 'No changes in the last 7 days.'
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
        title="Recent Changes"
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
          supported ? (
            <div className="changes-toolbar" id="changes-toolbar">
              <div className="changes-tabs" role="group" aria-label="Which changes to show">
                <button
                  type="button"
                  className="changes-tab"
                  id="changes-tab-ai"
                  data-track="dash.changes.tab-ai"
                  aria-pressed={shown === 'ai'}
                  onClick={() => setTab('ai')}
                >
                  AI
                </button>
                <button
                  type="button"
                  className="changes-tab"
                  id="changes-tab-everyone"
                  data-track="dash.changes.tab-everyone"
                  aria-pressed={shown === 'everyone'}
                  onClick={() => setTab('everyone')}
                >
                  Everyone
                </button>
              </div>
              {shown === 'everyone' && (
                <select
                  id="changes-person"
                  className="select changes-person"
                  data-track="dash.changes.person"
                  aria-label="Show changes by"
                  value={personNow}
                  onChange={e => setPerson(e.target.value)}
                >
                  {filterOptions(all).map(o => (
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
        {shown === 'ai' && ai.data?.map(c => <AiRow key={c.changeId} change={c} onUndo={undoAi} />)}
        {shown === 'everyone' && (
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
export default function RecentChangesPane(): JSX.Element {
  const slot = useContext(DockContext);
  const host = useDockHost(slot);
  return createPortal(<ChangesCard active={slot !== null} />, host);
}
