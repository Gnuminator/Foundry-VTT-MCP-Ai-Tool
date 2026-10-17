import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { api, errorText } from '../lib/api';
import { SETTINGS_KEY, useDashboardSettings, type DashboardSettings } from '../lib/stream';
import { Button } from '../ui';

import { useToast } from './Toasts';

/**
 * The GM Actions master switch in the header (the old page's #btn-gm): every game-changing action
 * of the dashboard needs it on, and the server flips it (`toggle-gm-actions`, so two pages never
 * disagree about which way a click goes). The stream's `settings` event updates every page; the
 * answer to the click updates this one at once. Off until the first settings event, as the guarded
 * paths treat it (lib/guarded.ts).
 */
export function GmActionsSwitch(): JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const on = useDashboardSettings()?.gmActionsEnabled === true;
  const [pending, setPending] = useState(false);

  const toggle = (): void => {
    setPending(true);
    api<DashboardSettings>('/api/control', {
      method: 'POST',
      body: JSON.stringify({ action: 'toggle-gm-actions' }),
    })
      .then(
        data =>
          queryClient.setQueryData<DashboardSettings>(SETTINGS_KEY, old => ({
            ...old,
            gmActionsEnabled: data.gmActionsEnabled,
          })),
        (err: unknown) => toast(`✗ GM Actions: ${errorText(err)}`, 'err')
      )
      .finally(() => setPending(false));
  };

  return (
    <Button
      id="btn-gm"
      className={on ? 'on' : undefined}
      data-track="dash.header.gm-actions"
      title="Master switch for game-changing actions"
      aria-pressed={on}
      disabled={pending}
      onClick={toggle}
    >
      {on ? '⚔ GM Actions: on' : '⚔ GM Actions: off'}
    </Button>
  );
}
