// Starting and ending the play session (mark-play-session, a log-only tool: no GM Actions, no
// confirm). One hook for every button that does it (the header marker, Turn on for tonight's
// "Start the session log"), so they share one pending state and one flow. Starting also turns on
// live play (GM Actions and every Turn on for tonight switch); ending turns off what that turned
// on, as the old page's End session did.
import {
  useIsMutating,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { useToast } from '../components/Toasts';

import { api, callTool, errorText } from './api';
import { PLAY_SESSION_KEY, usePlaySession, type PlaySession } from './session';
import {
  SWITCHES_KEY,
  applySwitchesWrite,
  type SwitchesRead,
  type SwitchesWrite,
} from './sessionSwitches';
import { SETTINGS_KEY, type DashboardSettings } from './stream';

export type MarkAction = 'start' | 'end';

const MARK_KEY = ['mark-play-session'] as const;

type Toast = (text: string, kind: 'ok' | 'err') => void;

/**
 * Turns off what Turn on for tonight turned on, when it is on: the module remembers a Ready, or GM
 * Actions are on. The switches are read first when this page has not seen them (Pre-flight never
 * opened). A failure is toasted; the end of the session itself has already happened.
 */
export async function endTonightsSwitches(queryClient: QueryClient, toast: Toast): Promise<void> {
  try {
    let ready = queryClient.getQueryData<SwitchesRead>(SWITCHES_KEY)?.switches?.ready ?? null;
    let gmActions =
      queryClient.getQueryData<DashboardSettings>(SETTINGS_KEY)?.gmActionsEnabled === true;
    if (!ready && !gmActions) {
      const read = await queryClient.fetchQuery({
        queryKey: SWITCHES_KEY,
        queryFn: () => api<SwitchesRead>('/api/session/switches'),
        staleTime: 0,
      });
      ready = read.switches?.ready ?? null;
      gmActions = read.gmActionsEnabled;
    }
    if (!ready && !gmActions) return;
    const data = await api<SwitchesWrite>('/api/session/switches', {
      method: 'POST',
      body: JSON.stringify({ action: 'end' }),
    });
    applySwitchesWrite(queryClient, toast, data, 'end');
  } catch (err) {
    toast(`✗ Turning off: ${errorText(err)}`, 'err');
    // The server turns GM Actions off first, and the module may have changed some switches.
    void queryClient.invalidateQueries({ queryKey: SWITCHES_KEY });
  }
}

/**
 * Turns on live play when the session starts: the same call as Turn on for tonight. The session
 * itself has already started, so a failure is toasted and the header line offers Turn on again.
 */
export async function startTonightsSwitches(queryClient: QueryClient, toast: Toast): Promise<void> {
  try {
    const data = await api<SwitchesWrite>('/api/session/switches', {
      method: 'POST',
      body: JSON.stringify({ action: 'ready' }),
    });
    applySwitchesWrite(queryClient, toast, data, 'ready');
  } catch (err) {
    toast(`✗ Turn on for tonight: ${errorText(err)}`, 'err');
    void queryClient.invalidateQueries({ queryKey: SWITCHES_KEY });
  }
}

/** The session as it is right after a mark that worked, until the next read says it. */
function markedSession(action: MarkAction): PlaySession {
  const now = new Date().toISOString();
  return action === 'start'
    ? { open: true, startedAt: now, endedAt: null }
    : { open: false, startedAt: null, endedAt: now };
}

/**
 * `mark(action)` starts or ends the play session; `pending` is true while any button's mark runs,
 * so two buttons cannot send at once. The status shows the new state at once and the next read
 * confirms it.
 */
export function usePlaySessionMark(): { mark: (action: MarkAction) => void; pending: boolean } {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { refetch } = usePlaySession();
  const mutation = useMutation({
    mutationKey: MARK_KEY,
    mutationFn: (action: MarkAction) => callTool('mark-play-session', { action }),
    onSuccess: (_, action) => {
      toast(action === 'start' ? '✓ Play session started' : '✓ Play session ended', 'ok');
      queryClient.setQueryData<PlaySession>(PLAY_SESSION_KEY, markedSession(action));
    },
    onError: err => toast(`✗ mark-play-session: ${errorText(err)}`, 'err'),
    onSettled: async (_data, err, action) => {
      // Ending also turns off what Ready turned on, whether or not the mark itself went through.
      if (action === 'end') await endTonightsSwitches(queryClient, toast);
      // Starting is the one switch for live play: GM Actions and every Turn on for tonight switch.
      else if (!err) await startTonightsSwitches(queryClient, toast);
      const outcome = (await refetch()) as { error?: unknown };
      if (outcome.error) toast(`✗ get-play-session: ${errorText(outcome.error)}`, 'err');
    },
  });
  const pending = useIsMutating({ mutationKey: MARK_KEY }) > 0;
  return { mark: mutation.mutate, pending };
}
