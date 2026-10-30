// Turn on for tonight (D3, PB-17), inside Pre-flight: one click turns on what tonight needs (the
// module's write switches and the dashboard's GM Actions), one turns it off again, and a third
// starts the session log. The switches live in the module (`/api/session/switches`); GM Actions
// come from the stream's `settings` event, which the server sends again after each change.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, type JSX } from 'react';

import { useToast } from '../components/Toasts';
import { api, errorText } from '../lib/api';
import { usePlaySessionMark } from '../lib/playSessionMark';
import { usePlaySession } from '../lib/session';
import {
  SWITCHES_KEY,
  applySwitchesWrite,
  shortName,
  type SessionSwitch,
  type SwitchAction,
  type SwitchesRead,
  type SwitchesWrite,
} from '../lib/sessionSwitches';
import { SETTINGS_KEY, useDashboardSettings, type DashboardSettings } from '../lib/stream';
import { Button } from '../ui';

const DEFAULT_NOTE =
  'Turns on, for tonight only: changes from the tool, handouts, live play (damage, conditions), the party, Tarokka and GM Actions. End session turns them off again. Every change can still be undone.';

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
  const playSession = usePlaySession();

  // The GM Actions gate (guarded.ts) reads the stream's settings. Until the first settings event,
  // seed them from this read, so a click does not say "GM Actions are off" while this block shows
  // them on. The stream's next event replaces the seed.
  const readGmActions = read.data?.gmActionsEnabled;
  useEffect(() => {
    if (typeof readGmActions !== 'boolean') return;
    queryClient.setQueryData<DashboardSettings | null>(
      SETTINGS_KEY,
      old => old ?? { gmActionsEnabled: readGmActions }
    );
  }, [queryClient, readGmActions]);

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
    onSuccess: (data, action) => applySwitchesWrite(queryClient, toast, data, action),
    onError: (err, action) => {
      toast(
        `✗ ${action === 'ready' ? 'Turn on for tonight' : 'Turning off'}: ${errorText(err)}`,
        'err'
      );
      // A failed End may still have turned GM Actions off (the server does that first), and the
      // module may have changed some switches: read them again.
      void read.refetch();
    },
    // The pre-flight row "Turn on for tonight" follows.
    onSettled: () => {
      sending.current = false;
      onChanged();
    },
  });

  // The header's Start session button shares this: one pending state for both.
  const startLog = usePlaySessionMark();

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
        <Button
          className={allOn ? 'lamp is-ready' : 'lamp'}
          id="btn-ready"
          data-track="dash.ready.turn-on"
          disabled={allOn || busy}
          onClick={() => send('ready')}
        >
          {allOn ? '✓ On for tonight' : 'Turn on for tonight'}
        </Button>
        {readyIsOn && (
          <Button
            id="btn-ready-off"
            data-track="dash.ready.turn-off"
            disabled={busy}
            onClick={() => send('end')}
          >
            Turn them off again
          </Button>
        )}
        {playSession.session?.open !== true && (
          <Button
            variant="quiet"
            id="btn-ready-log"
            data-track="dash.ready.start-log"
            busy={startLog.pending}
            busyLabel="Starting..."
            onClick={() => startLog.mark('start')}
          >
            Start the session log and live play
          </Button>
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
