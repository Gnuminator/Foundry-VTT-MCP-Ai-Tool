// Module diagnostics: the errors and warnings Foundry modules raise in the GM's browser, as the
// bridge polls them (get-module-errors, feed/polling-feed.ts). They arrive on the live stream
// (`errors` events, GM only); this page only shows them. The space note says when the server's
// disk check (/api/space, space-route.ts) has stopped running.
import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';

import { OverlayPane } from '../components/OverlayPane';
import { api } from '../lib/api';
import { useModuleErrors, type ModuleError } from '../lib/stream';

type SpaceStatus =
  | { available: false; reason?: string }
  | { available: true; stale: boolean; checkedAt: string; host: string };

const SPACE_POLL_MS = 5 * 60 * 1000;

/** "module:foo" -> "foo"; no module -> "unknown". */
function moduleName(error: ModuleError): string {
  return (error.module ?? 'unknown').replace(/^(module|system|world):/, '');
}

function ErrorEntry({ error }: { error: ModuleError }): JSX.Element {
  const level = error.level === 'warn' ? 'warn' : 'error';
  return (
    <div
      className={`diag-entry lvl-${level}`}
      title={`${error.message}\n\n${error.stack ?? ''}`}
      role="listitem"
    >
      <span className="diag-level">{level}</span>
      <span className="diag-module">{moduleName(error)}</span>
      <span className="diag-msg">{error.message}</span>
      <span className="diag-time">{new Date(error.timestampMs).toLocaleTimeString()}</span>
    </div>
  );
}

/** Shown only while the server's disk check is overdue. */
function SpaceNote(): JSX.Element | null {
  const space = useQuery({
    queryKey: ['space'],
    queryFn: () => api<SpaceStatus>('/api/space'),
    refetchInterval: SPACE_POLL_MS,
  });
  const data = space.data;
  if (!data?.available || !data.stale) return null;
  return (
    <p className="diag-note">
      The space check on {data.host} has not run for over 3 hours (last check{' '}
      {new Date(data.checkedAt).toLocaleString()}).
    </p>
  );
}

export function ModuleDiagnosticsPane({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const log = useModuleErrors();
  const meta =
    log.errors + log.warns === 0 ? '0 issues' : `${log.errors} errors · ${log.warns} warns`;

  return (
    <OverlayPane
      open={open}
      onOpenChange={onOpenChange}
      title="Module Diagnostics"
      meta={meta}
      closeLabel="Close module diagnostics"
      id="pane-diagnostics"
      help="dashboard#module-diagnostics"
      note={<SpaceNote />}
      state={log.entries.length === 0 ? 'empty' : 'ready'}
      stateMessage="No module errors captured."
    >
      <div role="list" aria-label="Module errors">
        {log.entries.map(e => (
          <ErrorEntry key={e.id} error={e} />
        ))}
      </div>
    </OverlayPane>
  );
}
