// Pre-flight (I-068): the checks before the players join. The tool's own checks come from
// `GET /api/preflight` (preflight.ts: the bridge's get-preflight list plus Ready for session and
// the /player secret-terms check); the hand checklist stays in this browser, under the same
// localStorage key as the old page, so ticks carry over between the two pages.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type JSX } from 'react';

import { Drawer, DrawerClose } from '../components/Drawer';
import { api, errorText } from '../lib/api';
import { useBridgeStatus } from '../lib/stream';
import { usage } from '../lib/usage';

type CheckStatus = 'ok' | 'warn' | 'fail' | 'info' | 'unknown';

interface PreflightCheck {
  id: string;
  label: string;
  status: string;
  detail: string;
}

interface PreflightScan {
  settings?: { setting: string; masked: string; reason: string }[];
  names?: { kind: string; name: string; terms?: string[] }[];
  modules?: { title: string; reason: string }[];
}

interface PreflightResult {
  ready: boolean;
  checks: PreflightCheck[];
  scan: PreflightScan | null;
}

const PREFLIGHT_KEY = ['preflight'] as const;

const ICONS: Record<CheckStatus, string> = {
  ok: '✓',
  warn: '!',
  fail: '✗',
  info: 'i',
  unknown: '?',
};

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

const fetchPreflight = (): Promise<PreflightResult> => api<PreflightResult>('/api/preflight');

/** The last run's result; runs only when asked (the drawer, or Foundry coming back). */
function usePreflightResult(): ReturnType<typeof useQuery<PreflightResult>> {
  return useQuery({
    queryKey: PREFLIGHT_KEY,
    queryFn: fetchPreflight,
    enabled: false,
    retry: false,
    staleTime: Infinity,
  });
}

function statusOf(check: PreflightCheck): CheckStatus {
  return check.status in ICONS ? (check.status as CheckStatus) : 'unknown';
}

function counts(result: PreflightResult): { fails: number; warns: number } {
  return {
    fails: result.checks.filter(c => c.status === 'fail').length,
    warns: result.checks.filter(c => c.status === 'warn').length,
  };
}

/**
 * Runs the checks quietly each time Foundry becomes reachable (also on the first status after
 * the page loads), so the header button and the version banner are current. Mounted in App.
 */
export function usePreflightOnReconnect(): void {
  const queryClient = useQueryClient();
  const foundry = useBridgeStatus()?.foundry;
  const wasReachable = useRef(false);
  useEffect(() => {
    const reachable = foundry === 'reachable';
    if (reachable && !wasReachable.current) {
      // A quiet run: a failure leaves the last result as it was.
      queryClient
        .fetchQuery({ queryKey: PREFLIGHT_KEY, queryFn: fetchPreflight, staleTime: 0 })
        .catch(() => undefined);
    }
    wasReachable.current = reachable;
  }, [foundry, queryClient]);
}

/** The header button: it shows the last run's verdict. */
export function PreflightButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  const { data } = usePreflightResult();
  const fails = data ? counts(data).fails : 0;
  const label = !data
    ? '✈ Pre-flight'
    : fails > 0
      ? `✈ Pre-flight: ${fails} to fix`
      : '✈ Pre-flight: ready';
  return (
    <button
      id="btn-preflight"
      className={fails > 0 ? 'btn preflight-bad' : 'btn'}
      data-track="dash.header.preflight"
      title="Pre-flight check before the players join (GM only)"
      aria-expanded={open}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}

/** The page-wide warning when the bridge, module and dashboard versions do not match. */
export function VersionBanner(): JSX.Element | null {
  const { data } = usePreflightResult();
  const versions = data?.checks.find(c => c.id === 'versions');
  if (versions?.status !== 'fail') return null;
  return (
    <div className="link-banner" id="version-banner" role="alert">
      {versions.detail}
    </div>
  );
}

function CheckItem({ check }: { check: PreflightCheck }): JSX.Element {
  const status = statusOf(check);
  return (
    <li className={`preflight-item pf-${status}`}>
      <span className="pf-icon" title={status}>
        {ICONS[status]}
      </span>
      <span className="pf-text">
        <span className="pf-label">{check.label}</span>
        <span className="pf-detail">{check.detail}</span>
      </span>
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const result = usePreflightResult();
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
    return () => usage().endView('dash.preflight.view');
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

  let summary: JSX.Element | null = null;
  if (data) {
    const { fails, warns } = counts(data);
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
          <button
            className="btn btn-primary"
            data-track="dash.preflight.run"
            disabled={running}
            onClick={() => void run()}
          >
            ↻ Run checks
          </button>
          <button
            className="btn"
            data-track="dash.preflight.clear-ticks"
            title="Untick the manual items for a new session"
            onClick={() => {
              writeTicks({});
              setTicks({});
            }}
          >
            Clear ticks
          </button>
        </>
      }
    >
      {summary}
      <h3 className="preflight-h">Checked by the tool</h3>
      <ul className="preflight-list" aria-label="Checked by the tool">
        {runError !== null ? (
          <li className="empty">Couldn&apos;t run the checks: {runError}</li>
        ) : data ? (
          data.checks.map(c => <CheckItem key={c.id} check={c} />)
        ) : (
          <li className="empty">Not run yet.</li>
        )}
      </ul>
      {runError === null && <Findings scan={data?.scan ?? null} />}
      <h3 className="preflight-h">Check by hand</h3>
      <ManualList ticks={ticks} onTick={tick} />
    </Drawer>
  );
}
