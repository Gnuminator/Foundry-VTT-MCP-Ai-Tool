// End combat from a strip button (item dashboard-inline-condition-endcombat): plan-combat-change
// plans it, one plain confirm window asks, apply-planned-change ends the fight, and the Undo is on
// the toast and in Recent Changes. The live strip and the combat strip both use it, so the two
// End combat buttons ask the same question and say the same things when it fails.
import { useCallback } from 'react';

import { focusedElement, useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toasts';
import { callTool, errorText } from './api';
import { useGuardedTools } from './guarded';
import { endQuestion } from './liveStrip';

/**
 * Returns endCombat(onApplying): the gate (GM Actions), the plan, the confirm window, then the
 * apply. `onApplying` runs once the GM said yes and the write starts (a button that says it is busy
 * only while the write runs, not while the question is open). It never throws: errors are toasts.
 */
export function useEndCombat(): (onApplying?: () => void) => Promise<boolean> {
  const toast = useToast();
  const askConfirm = useConfirm();
  const { gated, applyApproved } = useGuardedTools();
  return useCallback(
    async (onApplying?: () => void): Promise<boolean> => {
      const from = focusedElement();
      if (gated('plan-combat-change')) return false;
      let planned: { planId?: unknown; summary?: unknown; warning?: unknown } | null;
      try {
        planned = await callTool<typeof planned>('plan-combat-change', { action: 'end' });
      } catch (err) {
        toast(`✗ End combat: ${errorText(err)}`, 'err');
        return false;
      }
      const planId = typeof planned?.planId === 'string' ? planned.planId : '';
      if (!planId) {
        toast('✗ End combat: the bridge made no plan', 'err');
        return false;
      }
      const ok = await askConfirm({
        title: 'End combat',
        summary: endQuestion(
          typeof planned?.summary === 'string' ? planned.summary : null,
          typeof planned?.warning === 'string' ? planned.warning : null
        ),
        diff: [],
        compact: true,
        confirmLabel: 'End combat',
        destructive: false,
        returnTo: from,
      });
      if (!ok) return false;
      onApplying?.();
      return (await applyApproved(planId, true)).status === 'done';
    },
    [toast, askConfirm, gated, applyApproved]
  );
}
