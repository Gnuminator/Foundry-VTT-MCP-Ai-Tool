// Ready for session (D3, PB-17), inside Pre-flight: one click turns on what tonight needs (the
// module's write switches and the dashboard's GM Actions), one turns it off again, and a third
// starts the session log. The switches live in the module (`/api/session/switches`); GM Actions
// come from the stream's `settings` event, which the server sends again after each change.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, type JSX } from 'react';

import { useToast } from '../components/Toasts';
import { api, callTool, errorText } from '../lib/api';
import { SETTINGS_KEY, useDashboardSettings, type DashboardSettings } from '../lib/stream';

interface SessionSwitch {
  id: string;
  name: string;
  on: boolean;
}

/** The module's answer (session-switches.ts SessionSwitches on the server). */
interface SessionSwitches {
  switches: SessionSwitch[];
  /** What Ready turned on and when, or null when the world is not "ready". */
  ready: { at: number; turnedOn: string[] } | null;
  changed: string[];
  failed: string[];
}

interface SwitchesRead {
  switches: SessionSwitches | null;
  gmActionsEnabled: boolean;
  error: string | null;
}

interface SwitchesWrite {
  ok: boolean;
  switches: SessionSwitches | null;
  gmActionsEnabled: boolean;
  gmActionsChanged: boolean;
}

type SwitchAction = 'ready' | 'end';

const SWITCHES_KEY = ['session-switches'] as const;
const PLAY_SESSION_KEY = ['play-session'] as const;

const DEFAULT_NOTE =
  'Turns on, for tonight only: changes from the tool, handouts, live play (damage, conditions), the party, Tarokka and GM Actions. End session turns them off again. Every change can still be undone.';

/** "AI Tool: Handouts (writes)" reads "Handouts (writes)" on the chips and in toasts. */
const shortName = (name: string): string => name.replace(/^AI Tool: /, '');

function switchNames(list: SessionSwitch[], ids: string[]): string[] {
  return ids.map(id => shortName(list.find(s => s.id === id)?.name ?? id));
}

/**
 * Whether a play session is open (get-play-session), polled each minute as the old page does. A
 * failed poll keeps the last answer (a query keeps its data on error), as the old page does.
 */
function usePlaySessionOpen(): { open: boolean; refetch: () => Promise<unknown> } {
  const query = useQuery({
    queryKey: PLAY_SESSION_KEY,
    queryFn: async () =>
      Boolean((await callTool<{ open?: boolean }>('get-play-session', {}))?.open),
    refetchInterval: 60_000,
    retry: false,
  });
  return { open: query.data === true, refetch: query.refetch };
}

export function ReadyBlock({ onChanged }: { onChanged: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const toast = useToast();
  // Read each time Pre-flight opens (the drawer mounts its body then).
  const read = useQuery({
    queryKey: SWITCHES_KEY,
    queryFn: () => api<SwitchesRead>('/api/session/switches'),
    retry: false,
    staleTime: 0,
  });
  const settings = useDashboardSettings();
  const playSession = usePlaySessionOpen();

  const state = read.data?.switches ?? null;
  const list = state?.switches ?? [];
  const gmActions = settings?.gmActionsEnabled ?? read.data?.gmActionsEnabled ?? false;
  const readError = read.error ? errorText(read.error) : (read.data?.error ?? null);

  // Set before the first re-render disables the buttons, so a fast double click sends once.
  const sending = useRef(false);
  const write = useMutation({
    mutationFn: (action: SwitchAction) =>
      api<SwitchesWrite>('/api/session/switches', {
        method: 'POST',
        body: JSON.stringify({ action }),
      }),
    onSuccess: (data, action) => {
      queryClient.setQueryData<SwitchesRead>(SWITCHES_KEY, old => ({
        switches: data.switches ?? old?.switches ?? null,
        gmActionsEnabled: data.gmActionsEnabled,
        error: null,
      }));
      queryClient.setQueryData<DashboardSettings>(SETTINGS_KEY, old => ({
        ...old,
        gmActionsEnabled: data.gmActionsEnabled,
      }));
      const all = data.switches?.switches ?? list;
      const changed = switchNames(all, data.switches?.changed ?? []);
      if (data.gmActionsChanged) changed.push('GM Actions');
      const failed = switchNames(all, data.switches?.failed ?? []);
      if (action === 'ready') {
        toast(
          changed.length > 0
            ? `✓ Ready for session. Turned on: ${changed.join(', ')}`
            : '✓ Already on',
          'ok'
        );
      } else if (changed.length > 0) {
        toast(`✓ Turned off again: ${changed.join(', ')}`, 'ok');
      }
      if (failed.length > 0) {
        toast(`✗ Foundry did not change: ${failed.join(', ')}. Check the module settings.`, 'err');
      }
    },
    onError: (err, action) => {
      toast(
        `✗ ${action === 'ready' ? 'Ready for session' : 'Turning off'}: ${errorText(err)}`,
        'err'
      );
      // A failed End may still have turned GM Actions off (the server does that first), and the
      // module may have changed some switches: read them again.
      void read.refetch();
    },
    // The pre-flight row "Ready for session" follows.
    onSettled: () => {
      sending.current = false;
      onChanged();
    },
  });

  const startLog = useMutation({
    mutationFn: () => callTool('mark-play-session', { action: 'start' }),
    onSuccess: () => toast('✓ Play session started', 'ok'),
    onError: err => toast(`✗ mark-play-session: ${errorText(err)}`, 'err'),
    onSettled: async () => {
      const outcome = (await playSession.refetch()) as { error?: unknown };
      if (outcome.error) toast(`✗ get-play-session: ${errorText(outcome.error)}`, 'err');
    },
  });

  const busy = write.isPending;
  const send = (action: SwitchAction): void => {
    if (sending.current) return;
    sending.current = true;
    write.mutate(action);
  };
  const allOn = list.length > 0 && list.every(s => s.on) && gmActions;
  // Ready turned something on (the module remembers it), or GM Actions are on.
  const readyIsOn = Boolean(state?.ready) || gmActions;
  const chips: SessionSwitch[] = [...list, { id: 'gm-actions', name: 'GM Actions', on: gmActions }];

  let note = DEFAULT_NOTE;
  if (readError !== null) {
    note = `Could not read the switches: ${readError}`;
  } else if (allOn && state?.ready?.at) {
    const time = new Date(state.ready.at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    note = `On since ${time}, for tonight. End session turns off what Ready turned on. Every change can still be undone.`;
  }

  return (
    <div className="ready-block" id="ready-block">
      <div className="ready-actions">
        <button
          className={allOn ? 'btn lamp is-ready' : 'btn lamp'}
          id="btn-ready"
          data-track="dash.ready.turn-on"
          disabled={allOn || busy}
          onClick={() => send('ready')}
        >
          {allOn ? '✓ Ready for tonight' : 'Ready for session'}
        </button>
        {readyIsOn && (
          <button
            className="btn"
            id="btn-ready-off"
            data-track="dash.ready.turn-off"
            disabled={busy}
            onClick={() => send('end')}
          >
            Turn them off again
          </button>
        )}
        {!playSession.open && (
          <button
            className="btn btn-quiet"
            id="btn-ready-log"
            data-track="dash.ready.start-log"
            disabled={startLog.isPending}
            onClick={() => startLog.mutate()}
          >
            Start the session log
          </button>
        )}
      </div>
      <p className="ready-note" id="ready-note">
        {note}
      </p>
      <ul className="ready-switches" id="ready-switches" aria-label="Switches for tonight">
        {chips.map(s => (
          <li
            key={s.id}
            className={s.on ? 'on' : undefined}
            title={`${s.name}: ${s.on ? 'on' : 'off'}`}
          >
            {s.on ? '✓' : '○'} {shortName(s.name)}
          </li>
        ))}
      </ul>
    </div>
  );
}
