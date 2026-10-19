// The plan link (lib/planLink.ts): a page opened as /?plan=<planId> shows that plan's confirm window
// once GM Actions are on, then drops the parameter from the address. Until GM Actions are on it
// says so once. The plan goes through the same guarded path as any plan made on this page.
import { useEffect, useRef, useState } from 'react';

import { planIdFromSearch } from '../lib/planLink';
import { useGuardedTools } from '../lib/guarded';
import { useDashboardSettings } from '../lib/stream';

import { useToast } from './Toasts';

export function PlanLink(): null {
  const toast = useToast();
  const guarded = useGuardedTools();
  const settings = useDashboardSettings();
  const [planId] = useState(() => planIdFromSearch(window.location.search));
  const warned = useRef(false);
  const started = useRef(false);
  const gmActionsEnabled = settings?.gmActionsEnabled;

  useEffect(() => {
    // Nothing until the stream has said whether GM Actions are on.
    if (!planId || started.current || gmActionsEnabled === undefined) return;
    if (!gmActionsEnabled) {
      if (!warned.current) {
        warned.current = true;
        toast('A plan from Obsidian is waiting: turn on GM Actions to review it.', 'warn');
      }
      return;
    }
    started.current = true;
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch {
      // Keep the address as it is.
    }
    void guarded.write('apply-planned-change', { planId }, 'write');
  }, [planId, gmActionsEnabled, guarded, toast]);

  return null;
}
