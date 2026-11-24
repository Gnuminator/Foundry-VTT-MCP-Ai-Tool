// Tool permissions: what Claude may do through its connector. Each tool, or a whole set, is
// Allow, Ask or Deny. A tool on Ask is refused once and shows up here as a card; Allow once lets
// Claude's next try of that tool through. The dashboard's own buttons are never affected.
// Route: POST /api/tool-permissions (routes/api-switches.ts), a GM-only bridge control method.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';

import { OverlayPane } from '../components/OverlayPane';
import { useToast } from '../components/Toasts';
import { api, errorText } from '../lib/api';
import { Button } from '../ui';

type Policy = 'allow' | 'ask' | 'deny';

export interface PermissionsSnapshot {
  sets: Array<{ set: string; policy: Policy | null }>;
  tools: Array<{ tool: string; set: string | null; own: Policy | null; effective: Policy }>;
  pending: Array<{ tool: string; set: string | null; at: number }>;
}

const KEY = ['tool-permissions'] as const;
const POLL_MS = 5000;

const post = (body: Record<string, unknown>): Promise<PermissionsSnapshot> =>
  api<PermissionsSnapshot>('/api/tool-permissions', {
    method: 'POST',
    body: JSON.stringify(body),
  });

const LABEL: Record<Policy, string> = { allow: 'Allow', ask: 'Ask me first', deny: 'Deny' };

function PolicySelect({
  label,
  value,
  inherit,
  onChange,
}: {
  label: string;
  value: Policy | null;
  /** What "follow the set" means for this row, or null for a set row (its default is Allow). */
  inherit: string | null;
  onChange: (policy: Policy | 'default') => void;
}): JSX.Element {
  return (
    <select
      aria-label={label}
      value={value ?? 'default'}
      onChange={e => onChange(e.target.value as Policy | 'default')}
    >
      <option value="default">{inherit ?? 'Allow (default)'}</option>
      <option value="allow">{LABEL.allow}</option>
      <option value="ask">{LABEL.ask}</option>
      <option value="deny">{LABEL.deny}</option>
    </select>
  );
}

export function ToolPermissionsPane({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => post({ action: 'get' }),
    enabled: open,
    refetchInterval: open ? POLL_MS : false,
  });
  const change = useMutation({
    mutationFn: post,
    onSuccess: snap => queryClient.setQueryData(KEY, snap),
    onError: err => toast(`✗ ${errorText(err)}`, 'err'),
  });
  const data = query.data;
  const setPolicy = (kind: 'tool' | 'set', name: string, policy: Policy | 'default'): void =>
    change.mutate({ action: 'set', kind, name, policy });

  return (
    <OverlayPane
      open={open}
      onOpenChange={onOpenChange}
      title="Tool permissions"
      meta={data && data.pending.length > 0 ? `${data.pending.length} waiting` : undefined}
      closeLabel="Close tool permissions"
      id="pane-tool-permissions"
      state={query.isError ? 'error' : data ? 'ready' : 'loading'}
      stateMessage={query.isError ? 'Could not read the permissions from the bridge.' : undefined}
    >
      {data ? (
        <div className="perm-body">
          <p className="perm-note">
            What Claude may use. Everything is allowed until you change it. A tool on Ask is refused
            once and appears here; press Allow once and Claude can try again. The dashboard&apos;s
            own buttons always work.
          </p>
          {data.pending.length > 0 ? (
            <ul className="perm-pending" aria-label="Waiting for your OK">
              {data.pending.map(p => (
                <li key={p.tool}>
                  <code>{p.tool}</code> asked at {new Date(p.at).toLocaleTimeString()}{' '}
                  <Button onClick={() => change.mutate({ action: 'approve', name: p.tool })}>
                    Allow once
                  </Button>{' '}
                  <Button onClick={() => change.mutate({ action: 'dismiss', name: p.tool })}>
                    Dismiss
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {data.sets
            .filter(s => s.set !== 'player')
            .map(s => {
              const tools = data.tools.filter(t => t.set === s.set);
              return (
                <details key={s.set} className="perm-set">
                  <summary>
                    <strong>{s.set}</strong> ({tools.length} tools){' '}
                    <PolicySelect
                      label={`All ${s.set} tools`}
                      value={s.policy}
                      inherit={null}
                      onChange={p => setPolicy('set', s.set, p)}
                    />
                  </summary>
                  <ul>
                    {tools.map(t => (
                      <li key={t.tool}>
                        <code>{t.tool}</code>{' '}
                        <PolicySelect
                          label={t.tool}
                          value={t.own}
                          inherit={`Like ${s.set}: ${LABEL[t.effective]}`}
                          onChange={p => setPolicy('tool', t.tool, p)}
                        />
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
        </div>
      ) : null}
    </OverlayPane>
  );
}
