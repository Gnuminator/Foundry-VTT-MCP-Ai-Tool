// Version tracker (I-127): what is installed against the newest release for Foundry, the game
// system and each module, and the last test-kit result. GM only; the Advanced menu shows the entry
// only once the GM has switched the tracker on (the `versionTracker` pref, off by default).
// The server (src/versions.ts) checks the newest versions online at most every six hours.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';

import { OverlayPane } from '../components/OverlayPane';
import { api, errorText } from '../lib/api';
import { Button } from '../ui';

export type VersionStatus = 'ok' | 'behind' | 'unknown';

export interface VersionRow {
  id: string;
  kind: 'core' | 'system' | 'module';
  title: string;
  installed: string;
  newest: string | null;
  status: VersionStatus;
  active: boolean;
}

export interface KitResult {
  state: string;
  at: string | null;
  text: string;
}

export type VersionsView =
  | { enabled: false }
  | {
      enabled: true;
      rows: VersionRow[] | null;
      checkedAt: string | null;
      lookupErrors: number;
      kit: KitResult | null;
    };

export const VERSIONS_KEY = ['versions'] as const;

const STATUS_TEXT: Record<VersionStatus, string> = {
  ok: 'Up to date',
  behind: 'Update available',
  unknown: 'Not checked',
};

/** How many rows are behind (the pane's meta line). */
export function behindCount(rows: VersionRow[] | null): number {
  return rows ? rows.filter(r => r.status === 'behind').length : 0;
}

function KitLine({ kit }: { kit: KitResult | null }): JSX.Element {
  if (!kit) return <p className="ver-kit">No test-kit result on this computer.</p>;
  const when = kit.at ? new Date(kit.at).toLocaleString() : 'time unknown';
  return (
    <p className={`ver-kit kit-${kit.state}`}>
      Last test: <strong>{kit.state}</strong> ({when}){kit.text ? `. ${kit.text}` : ''}
    </p>
  );
}

function Row({ row }: { row: VersionRow }): JSX.Element {
  return (
    <tr className={`ver-row st-${row.status}${row.active ? '' : ' inactive'}`}>
      <th scope="row">
        {row.title}
        {row.active ? null : <span className="ver-off"> (off)</span>}
      </th>
      <td>{row.installed}</td>
      <td>{row.newest ?? '-'}</td>
      <td>
        <span className="ver-status">{STATUS_TEXT[row.status]}</span>
      </td>
    </tr>
  );
}

export function VersionsPane({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const versions = useQuery({
    queryKey: VERSIONS_KEY,
    queryFn: () => api<VersionsView>('/api/versions'),
    enabled: open,
  });
  const queryClient = useQueryClient();
  const recheckNow = useMutation({
    mutationFn: () => api<VersionsView>('/api/versions?refresh=1'),
    onSuccess: fresh => queryClient.setQueryData(VERSIONS_KEY, fresh),
  });
  const recheck = (): void => recheckNow.mutate();
  const data = versions.data;
  const view = data?.enabled ? data : null;
  const rows = view?.rows ?? null;
  const behind = behindCount(rows);
  const meta = !view ? '' : behind === 0 ? 'all up to date' : `${behind} to update`;

  let state: 'loading' | 'error' | 'empty' | 'ready' = 'ready';
  let stateMessage: string | undefined;
  if (versions.isPending) state = 'loading';
  else if (versions.isError) {
    state = 'error';
    stateMessage = errorText(versions.error);
  } else if (!view) {
    state = 'empty';
    stateMessage = 'The version tracker is off. Switch it on in the Advanced menu.';
  } else if (!rows) {
    state = 'empty';
    stateMessage = 'Foundry has not answered yet, so the installed versions are not known.';
  }

  return (
    <OverlayPane
      open={open}
      onOpenChange={onOpenChange}
      title="Versions"
      meta={meta}
      closeLabel="Close versions"
      id="pane-versions"
      state={state}
      {...(stateMessage ? { stateMessage } : {})}
      bodyProps={{ role: 'group', 'aria-label': 'Versions, scrollable', tabIndex: 0 }}
    >
      {view && rows ? (
        <>
          <KitLine kit={view.kit} />
          <table className="ver-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Installed</th>
                <th scope="col">Newest</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <Row key={`${r.kind}:${r.id}`} row={r} />
              ))}
            </tbody>
          </table>
          <p className="ver-foot">
            {view.checkedAt
              ? `Newest versions checked ${new Date(view.checkedAt).toLocaleString()}.`
              : 'The newest versions were not checked.'}
            {view.lookupErrors > 0
              ? ` ${view.lookupErrors} lookup${view.lookupErrors === 1 ? '' : 's'} failed.`
              : ''}{' '}
            <Button
              onClick={recheck}
              disabled={recheckNow.isPending}
              data-track="dash.versions.recheck"
            >
              Check again
            </Button>
          </p>
        </>
      ) : null}
    </OverlayPane>
  );
}

export default VersionsPane;
