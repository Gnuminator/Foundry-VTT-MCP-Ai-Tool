// The Pre-flight drawer (I-068), in its own chunk: first paint needs only the header button, the
// version banner and the quiet run on reconnect (Preflight.tsx); the drawer loads when it is shown.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type JSX, type RefObject } from 'react';

import { Drawer, DrawerClose } from '../components/Drawer';
import { errorText } from '../lib/api';
import { usage } from '../lib/usage';
import { Button, EmptyState, ErrorState } from '../ui';
import {
  PREFLIGHT_ICONS,
  PREFLIGHT_KEY,
  counts,
  fetchPreflight,
  statusOf,
  usePreflightResult,
  type PreflightCheck,
  type PreflightScan,
} from './Preflight';
import { ReadyBlock } from './ReadyForSession';

const MANUAL: [id: string, text: string][] = [
  ['scene-nav', 'The starting scene has a Navigation Name if its real name is a spoiler.'],
  [
    'creature-names',
    'Creatures whose names the players know show them (Prototype Token, Identity, Display Name: Hovered by Anyone).',
  ],
  ['hidden-tokens', 'Tokens the players should not know about yet are hidden.'],
  [
    'player-tab',
    'Opened /player in a second tab: combat order, feed and handouts show no secrets.',
  ],
  ['handouts', 'Handout pages are set to None unless you revealed them.'],
  ['prep-prompt', 'Ran the prep-next-session prompt in Claude Desktop.'],
  ['last-note', "Read last session's note in Obsidian."],
  [
    'private-screen',
    'Claude Desktop, the dashboard and Obsidian are on the screen the players cannot see.',
  ],
];

const TICKS_KEY = 'cogm_preflight_ticks';
type Ticks = Record<string, number>;

function readTicks(): Ticks {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TICKS_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Ticks) : {};
  } catch {
    return {};
  }
}

function writeTicks(ticks: Ticks): void {
  try {
    localStorage.setItem(TICKS_KEY, JSON.stringify(ticks));
  } catch {
    // Private mode or blocked storage: the ticks last until the page reloads.
  }
}

/**
 * The check this page makes itself, as the old page does: Tarokka's Show cards. It follows the
 * box live: the GM Actions gate can open this drawer over Tarokka with the cards shown.
 */
function tarokkaCheck(shown: boolean): PreflightCheck {
  return {
    id: 'tarokka-hidden',
    label: 'Tarokka cards hidden',
    status: shown ? 'warn' : 'ok',
    detail: shown
      ? 'Show cards is ticked in the Tarokka drawer. Hide them before players can see your screen.'
      : 'Show cards is not ticked.',
  };
}

function CheckItem({
  check,
  itemRef,
  children,
}: {
  check: PreflightCheck;
  /** Given, the row can take the focus (Hide cards hands it there as the button goes). */
  itemRef?: RefObject<HTMLLIElement | null>;
  children?: JSX.Element | false;
}): JSX.Element {
  const status = statusOf(check);
  return (
    <li
      className={`preflight-item pf-${status}`}
      {...(itemRef ? { ref: itemRef, tabIndex: -1 } : {})}
    >
      <span className="pf-icon" title={status}>
        {PREFLIGHT_ICONS[status]}
      </span>
      <span className="pf-text">
        <span className="pf-label">{check.label}</span>
        <span className="pf-detail">{check.detail}</span>
      </span>
      {children}
    </li>
  );
}

/** What the module's spoiler scan found (settings, names, modules), folded away. */
function Findings({ scan }: { scan: PreflightScan | null }): JSX.Element | null {
  if (!scan) return null;
  const rows = [
    ...(scan.settings ?? []).map(s => (
      <>
        <code>{s.setting}</code> {s.masked}: {s.reason}
      </>
    )),
    ...(scan.names ?? []).map(n => `${n.kind} "${n.name}" names ${(n.terms ?? []).join(', ')}`),
    ...(scan.modules ?? []).map(m => `${m.title}: ${m.reason}`),
  ];
  if (rows.length === 0) return null;
  // Uncontrolled: a list the GM opened stays open when a new run redraws it.
  return (
    <details className="preflight-findings">
      <summary data-track="dash.preflight.show-findings">{rows.length} finding(s)</summary>
      <ul>
        {rows.map((row, i) => (
          <li key={i}>{row}</li>
        ))}
      </ul>
    </details>
  );
}

function ManualList({
  ticks,
  onTick,
}: {
  ticks: Ticks;
  onTick: (id: string, on: boolean) => void;
}): JSX.Element {
  return (
    <ul className="preflight-list" aria-label="Check by hand">
      {MANUAL.map(([id, text]) => (
        <li key={id} className="preflight-item">
          <label className="pf-manual">
            <input
              type="checkbox"
              data-track="dash.preflight.manual-tick"
              checked={Boolean(ticks[id])}
              onChange={e => onTick(id, e.target.checked)}
            />
            <span>{text}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

const lastRun = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export function PreflightDrawer({
  open,
  onOpenChange,
  tarokkaShown,
  onHideTarokka,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tarokka's Show cards, which App holds. */
  tarokkaShown: boolean;
  onHideTarokka: () => void;
}): JSX.Element {
  const result = usePreflightResult();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [ticks, setTicks] = useState(readTicks);

  const run = async (): Promise<void> => {
    setRunning(true);
    setRunError(null);
    const outcome = await result.refetch({ cancelRefetch: false });
    setRunning(false);
    if (outcome.isError) setRunError(errorText(outcome.error));
  };

  useEffect(() => {
    if (!open) return;
    usage().trackView('dash.preflight.view');
    // Ticks may have changed on the old page since this one loaded.
    setTicks(readTicks());
    void run();
    return (): void => usage().endView('dash.preflight.view');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open]);

  const tick = (id: string, on: boolean): void => {
    const next = { ...readTicks() };
    if (on) next[id] = Date.now();
    else delete next[id];
    writeTicks(next);
    setTicks(next);
  };

  const data = result.data;
  const sub = running
    ? 'Running checks…'
    : runError !== null
      ? 'GM only. The checks did not run.'
      : data
        ? `GM only. Last run ${lastRun(result.dataUpdatedAt)}.`
        : 'GM only. Run it before the players join.';

  // A failed run shows its error, not the verdict of the run before it.
  const local = tarokkaCheck(tarokkaShown);
  const localRow = useRef<HTMLLIElement>(null);
  let summary: JSX.Element | null = null;
  if (data && runError === null) {
    const { fails, warns } = counts({ ...data, checks: [...data.checks, local] });
    summary = (
      <div
        className={`preflight-summary ${fails > 0 ? 'pf-fail' : warns > 0 ? 'pf-warn' : 'pf-ok'}`}
        role="status"
      >
        {fails > 0
          ? `Not ready: ${fails} to fix${warns > 0 ? `, ${warns} to look at` : ''}.`
          : warns > 0
            ? `Ready, with ${warns} to look at.`
            : 'Ready for the session.'}
      </div>
    );
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      id="preflight-drawer"
      title="✈ Pre-flight"
      sub={sub}
      help="dashboard#-pre-flight"
      close={<DrawerClose data-track="dash.preflight.close" />}
      onEscape={() => usage().track('shortcut', 'dash.shortcut.escape-preflight')}
      bodyClassName="preflight-body"
      actions={
        <>
          <Button
            variant="primary"
            data-track="dash.preflight.run"
            disabled={running}
            onClick={() => void run()}
          >
            ↻ Run checks
          </Button>
          <Button
            data-track="dash.preflight.clear-ticks"
            title="Untick the manual items for a new session"
            onClick={() => {
              writeTicks({});
              setTicks({});
            }}
          >
            Clear ticks
          </Button>
        </>
      }
    >
      {summary}
      <ReadyBlock
        onChanged={() => {
          // A quiet run, as when Foundry comes back: the row follows, a failure changes nothing.
          // Read at settle time: a run may have finished while the switches call was out.
          if (queryClient.getQueryData(PREFLIGHT_KEY)) {
            queryClient
              .fetchQuery({ queryKey: PREFLIGHT_KEY, queryFn: fetchPreflight, staleTime: 0 })
              .catch(() => undefined);
          }
        }}
      />
      <h3 className="preflight-h">Checked by the tool</h3>
      <ul className="preflight-list" aria-label="Checked by the tool">
        {runError !== null ? (
          <ErrorState as="li" error={runError}>
            Couldn&apos;t run the checks
          </ErrorState>
        ) : data ? (
          data.checks.map(c => <CheckItem key={c.id} check={c} />)
        ) : (
          <EmptyState as="li">Not run yet.</EmptyState>
        )}
        {/* This browser's own check: shown whether or not the server's run worked. */}
        <CheckItem check={local} itemRef={localRow}>
          {tarokkaShown && (
            <Button
              size="sm"
              className="pf-action"
              data-track="dash.preflight.hide-tarokka"
              onClick={() => {
                onHideTarokka();
                // The button goes with the warning: the row keeps the focus, and reads the new state.
                localRow.current?.focus();
              }}
            >
              Hide cards
            </Button>
          )}
        </CheckItem>
      </ul>
      {runError === null && <Findings scan={data?.scan ?? null} />}
      <h3 className="preflight-h">Check by hand</h3>
      <ManualList ticks={ticks} onTick={tick} />
    </Drawer>
  );
}
