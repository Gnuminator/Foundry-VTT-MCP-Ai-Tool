// Guarded changes from the dashboard's own buttons (D-077): a plan-* tool turns one click into a
// plan, apply-planned-change carries it out, and the toast that says so has an Undo button
// (undo-change). Recent Changes keeps the full history. Port of the old page's planThenApply,
// runTool and undoToast (public/app.js) for one-click plans; the confirm dialog for the other
// plans comes with the Tool runner.
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext } from 'react';

import { useToast } from '../components/Toasts';
import { ApiError, callTool, errorText, type ToolConfirm } from './api';
import { useDashboardSettings } from './stream';
import { usage } from './usage';

/**
 * Query keys under this prefix show game state that an applied change or an undo can move (the
 * party, ...); both refetch the ones a panel is showing.
 */
export const GAME_STATE_KEY = ['game'] as const;

/** Opens the place where the GM turns GM Actions on; App provides it. */
export const GmActionsGateContext = createContext<() => void>(() => undefined);

const GATE_TEXT = 'GM Actions are off. Ready for session in Pre-flight turns them on.';

/** What a plan-* tool answers (guarded-write/service.ts on the bridge); the fields used here. */
interface Plan {
  planId?: unknown;
  risk?: string;
  providerNote?: string;
  /** Plans that change nothing in Foundry apply at once and say so here. */
  note?: string;
}

/** What apply-planned-change and undo-change answer; the fields used here. */
interface Applied {
  changeId?: string;
  summary?: string;
  /** "Show it now" on a handout reveal: the popup on the players' screens. */
  shown?: { ok: boolean; error?: string };
  copy?: unknown;
  note?: unknown;
}

/** The toast text of a change, as the old page's doneText words it. */
function doneText(name: string, result: Applied | null): string {
  const summary = typeof result?.summary === 'string' ? result.summary : '';
  if (name === 'apply-planned-change' && summary) {
    const shown = result?.shown?.ok === true ? ' and shown to players' : '';
    return `✓ Applied: ${summary}${shown}`;
  }
  if (name === 'undo-change' && summary) return `✓ ${summary}`;
  return `✓ ${name}`;
}

/** The usage code of a failed call: the HTTP status, else a network error. */
const failCode = (err: unknown): string =>
  err instanceof ApiError ? String(err.status) : 'network';

/**
 * Returns run(planTool, args): plans the change, applies it in the same click when the plan is
 * an ordinary write, and shows the result. It resolves once the change is in or refused; errors
 * end up in toasts, never thrown.
 */
export function useGuardedChange(): (
  planTool: string,
  args: Record<string, unknown>
) => Promise<void> {
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useDashboardSettings();
  const openGate = useContext(GmActionsGateContext);
  const gmActionsOff = settings?.gmActionsEnabled === false;

  return useCallback(
    async (planTool, args) => {
      const gateClosed = (name: string, code: string): void => {
        usage().trackTool(name, 'error', code);
        toast(GATE_TEXT, 'warn');
        openGate();
      };

      /** Runs a write tool with its confirm flags; null when it failed (the toast says why). */
      const write = async (
        name: string,
        args: Record<string, unknown>,
        confirm: ToolConfirm
      ): Promise<Applied | null> => {
        try {
          const result = await callTool<Applied | null>(name, args, confirm);
          usage().trackTool(name, 'ok');
          return result ?? {};
        } catch (err) {
          if (err instanceof ApiError && err.status === 403) gateClosed(name, '403');
          else {
            usage().trackTool(name, 'error', failCode(err));
            toast(`✗ ${name}: ${errorText(err)}`, 'err');
          }
          return null;
        }
      };

      const changed = (): void => void queryClient.invalidateQueries({ queryKey: GAME_STATE_KEY });

      // The click on Undo is the confirmation, as on the old page.
      const undo = async (changeId: string): Promise<void> => {
        const result = await write(
          'undo-change',
          { changeId },
          { confirm: true, confirmDestructive: true }
        );
        if (!result) return;
        toast(doneText('undo-change', result), 'ok');
        changed();
      };

      // The old page plans first and is refused at apply, leaving a plan behind; asking first
      // leaves none. The server still checks (the 403 below).
      if (gmActionsOff) {
        gateClosed('apply-planned-change', 'gm-actions-off');
        return;
      }

      let plan: Plan | null;
      try {
        plan = await callTool<Plan | null>(planTool, args);
      } catch (err) {
        usage().trackTool(planTool, 'error', failCode(err));
        toast(`✗ ${planTool}: ${errorText(err)}`, 'err');
        return;
      }
      usage().trackTool(planTool, 'ok');
      if (plan?.providerNote) toast(plan.providerNote, 'warn');
      if (!plan || typeof plan.planId !== 'string' || !plan.planId) {
        toast(typeof plan?.note === 'string' ? `✓ ${plan.note}` : `✓ ${planTool}`, 'ok');
        changed();
        return;
      }
      if (plan.risk !== 'write') {
        // A deleting plan needs the confirm dialog, which comes with the Tool runner.
        usage().trackTool('apply-planned-change', 'cancelled');
        toast(
          'This change needs a confirm step this page does not have yet. Use the full dashboard.',
          'warn'
        );
        return;
      }

      const applied = await write(
        'apply-planned-change',
        { planId: plan.planId },
        { confirm: true }
      );
      if (!applied) return;
      const changeId = applied.changeId;
      if (changeId) {
        toast(doneText('apply-planned-change', applied), 'ok', {
          label: 'Undo',
          onClick: () => void undo(changeId),
        });
      } else {
        toast(doneText('apply-planned-change', applied), 'ok');
      }
      if (applied.copy && typeof applied.note === 'string') toast(applied.note, 'ok');
      if (applied.shown?.ok === false) {
        toast(`Revealed, but the popup failed: ${applied.shown.error ?? ''}`, 'warn');
      }
      changed();
    },
    [toast, queryClient, openGate, gmActionsOff]
  );
}
