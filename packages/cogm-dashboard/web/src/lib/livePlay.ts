// Live play is one switch: Start session turns on GM Actions and every Turn on for tonight switch
// (the module's `ready`), End session turns them off. This is the read side every gated control
// shares: which switches a control needs, which of them are off, and the one "Turn on" that sets
// them all, so a control renders disabled with its reason instead of disappearing.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useToast } from '../components/Toasts';

import { api, errorText } from './api';
import { COMBAT_NEEDS, GM_ACTIONS, offSwitches } from './liveSwitches';
import {
  SWITCHES_KEY,
  applySwitchesWrite,
  type SessionSwitch,
  type SwitchesRead,
  type SwitchesWrite,
} from './sessionSwitches';
import { useDashboardSettings } from './stream';

export interface LivePlay {
  /** Names of the needed switches that are off; empty when the control may run. */
  off: (needs?: readonly string[]) => string[];
  /** Every switch of Turn on for tonight and GM Actions are on. */
  allOn: boolean;
  /** The module's switches, once read. */
  list: SessionSwitch[];
  /** Turns everything on, as Start session does. */
  turnOn: () => void;
  pending: boolean;
}

export function useLivePlay(): LivePlay {
  const queryClient = useQueryClient();
  const toast = useToast();
  const gmActions = useDashboardSettings()?.gmActionsEnabled === true;
  const read = useQuery({
    queryKey: SWITCHES_KEY,
    queryFn: () => api<SwitchesRead>('/api/session/switches'),
    retry: false,
    staleTime: 15_000,
  });
  const list = read.data?.switches?.switches ?? [];
  const turn = useMutation({
    mutationFn: () =>
      api<SwitchesWrite>('/api/session/switches', {
        method: 'POST',
        body: JSON.stringify({ action: 'ready' }),
      }),
    onSuccess: data => applySwitchesWrite(queryClient, toast, data, 'ready'),
    onError: err => {
      toast(`✗ Turn on: ${errorText(err)}`, 'err');
      void queryClient.invalidateQueries({ queryKey: SWITCHES_KEY });
    },
  });
  const all = [GM_ACTIONS, ...list.map(s => s.id)];
  return {
    off: (needs = COMBAT_NEEDS): string[] => offSwitches(needs, gmActions, list),
    allOn: offSwitches(all, gmActions, list).length === 0,
    list,
    turnOn: (): void => {
      if (!turn.isPending) turn.mutate();
    },
    pending: turn.isPending,
  };
}
