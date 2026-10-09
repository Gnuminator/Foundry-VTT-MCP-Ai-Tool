// Guarded changes from the dashboard's own buttons (D-077): a plan-* tool turns one click into a
// plan, apply-planned-change carries it out, and the toast that says so has an Undo button
// (undo-change). Recent Changes keeps the full history. Port of the old page's planThenApply,
// runTool, confirmAction and undoToast (public/app.js): an ordinary write plan applies in the same
// click, any other plan (a reveal, a delete) opens the confirm window first.
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext } from 'react';

import { focusedElement, useConfirm } from '../components/ConfirmDialog';
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
  summary?: string;
  diff?: { text?: string }[];
  /** A live-play plan's own per-target lines ("Wolf 2: 12 fire damage, 6 taken"). */
  targets?: { line?: string }[];
}

/**
 * What a plan says it will change, one line each, as the old page shows it: a live-play plan's
 * per-target lines, else its diff. Null when the answer lists neither.
 */
function planLines(plan: Plan): string[] | null {
  if (Array.isArray(plan.targets) && plan.targets.length > 0) {
    return plan.targets.map(t => String(t?.line ?? ''));
  }
  if (Array.isArray(plan.diff)) return plan.diff.map(d => String(d?.text ?? ''));
  return null;
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

/**
 * The usage code of a failed call, as the old page logs it: the server's kind (tool, timeout,
 * channel), else the HTTP status, else a network error.
 */
export const failCode = (err: unknown): string =>
  err instanceof ApiError ? (err.kind ?? String(err.status)) : 'network';

/**
 * Whether a failed write may still have landed in Foundry: the request went out but the answer
 * did not come back. The bridge stopped waiting (timeout), the bridge link dropped after the send
 * (channel, a 502), a proxy gave up (a 5xx without a kind, such as a Cloudflare 524 after about
 * 100 s), or the network failed (not an ApiError). A tool error or a 4xx is a clear no.
 */
export function mayHaveApplied(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  if (err.kind === 'timeout' || err.kind === 'channel') return true;
  return err.kind === undefined && err.status >= 500;
}

const RECENT_CHANGES_HINT = 'It may have applied; check Recent Changes on the full dashboard.';

/**
 * Returns run(planTool, args): plans the change, applies it in the same click when the plan is
 * an ordinary write, asks in the confirm window first for any other plan, and shows the result.
 * It resolves to true once the change is in (or the plan said there was nothing to change) and to
 * false when it was refused, cancelled or failed; errors end up in toasts, never thrown. A panel can
 * close its form on true and keep the draft on false.
 */
export function useGuardedChange(): (
  planTool: string,
  args: Record<string, unknown>
) => Promise<boolean> {
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useDashboardSettings();
  const openGate = useContext(GmActionsGateContext);
  const askConfirm = useConfirm();
  // Off until the stream says otherwise, as on the old page: a click before the first settings
  // event would plan and then be refused at apply, leaving the plan behind.
  const gmActionsOff = settings?.gmActionsEnabled !== true;

  return useCallback(
    async (planTool, args) => {
      // The button clicked, read now: the panel disables it in the same click, and the confirm
      // window gives focus back to it (or to its panel) when it closes.
      const startedFrom = focusedElement();

      const gateClosed = (name: string, code: string): void => {
        usage().trackTool(name, 'error', code);
        toast(GATE_TEXT, 'warn');
        openGate();
      };

      const changed = (): void => void queryClient.invalidateQueries({ queryKey: GAME_STATE_KEY });

      /**
       * Runs a write tool with its confirm flags; null when it failed (the toast says why). A
       * failure past the gate may still have landed in Foundry (a timeout above all), so it
       * refreshes what the panels show.
       */
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
          if (err instanceof ApiError && err.status === 403) {
            gateClosed(name, '403');
            return null;
          }
          usage().trackTool(name, 'error', failCode(err));
          if (err instanceof ApiError && err.kind === 'timeout') {
            // The bridge stopped waiting after about 4 minutes; Foundry may still have done it.
            toast(`✗ ${name} timed out. ${RECENT_CHANGES_HINT}`, 'err');
          } else if (mayHaveApplied(err)) {
            const text = errorText(err).trim();
            const stop = /[.!?]$/.test(text) ? '' : '.';
            toast(`✗ ${name}: ${text}${stop} ${RECENT_CHANGES_HINT}`, 'err');
          } else {
            toast(`✗ ${name}: ${errorText(err)}`, 'err');
          }
          changed();
          return null;
        }
      };

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

      /**
       * The confirm window for a plan that is not an ordinary write: the flags to apply it with,
       * or null when the GM cancelled or the plan did not load. A plan answer without its summary
       * and lines is read again with get-planned-change, as the old page's apply path does.
       */
      const confirmPlan = async (plan: Plan, planId: string): Promise<ToolConfirm | null> => {
        let shown = plan;
        let lines = planLines(plan);
        if (lines === null || typeof plan.summary !== 'string') {
          try {
            shown = (await callTool<Plan | null>('get-planned-change', { planId })) ?? {};
          } catch (err) {
            usage().trackTool('apply-planned-change', 'error', failCode(err));
            toast(`✗ Can't load the plan: ${errorText(err)}`, 'err');
            return null;
          }
          lines = planLines(shown) ?? lines ?? [];
        }
        const destructive = (shown.risk ?? plan.risk) === 'destructive';
        const ok = await askConfirm({
          summary: typeof shown.summary === 'string' ? shown.summary : plan.summary,
          diff: lines,
          destructive,
          returnTo: startedFrom,
        });
        if (!ok) {
          // The plan stays on the bridge until it expires, as on the old page.
          usage().trackTool('apply-planned-change', 'cancelled');
          return null;
        }
        return destructive ? { confirm: true, confirmDestructive: true } : { confirm: true };
      };

      // The old page plans first and is refused at apply, leaving a plan behind; asking first
      // leaves none. The server still checks (the 403 below).
      if (gmActionsOff) {
        gateClosed('apply-planned-change', 'gm-actions-off');
        return false;
      }

      let plan: Plan | null;
      try {
        plan = await callTool<Plan | null>(planTool, args);
      } catch (err) {
        usage().trackTool(planTool, 'error', failCode(err));
        toast(`✗ ${planTool}: ${errorText(err)}`, 'err');
        return false;
      }
      usage().trackTool(planTool, 'ok');
      if (plan?.providerNote) toast(plan.providerNote, 'warn');
      if (!plan || typeof plan.planId !== 'string' || !plan.planId) {
        toast(typeof plan?.note === 'string' ? `✓ ${plan.note}` : `✓ ${planTool}`, 'ok');
        changed();
        return true;
      }
      // The click is the confirmation for an ordinary write; anything else asks first.
      const flags =
        plan.risk === 'write' ? { confirm: true } : await confirmPlan(plan, plan.planId);
      if (!flags) return false;

      const applied = await write('apply-planned-change', { planId: plan.planId }, flags);
      if (!applied) return false;
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
      return true;
    },
    [toast, queryClient, openGate, gmActionsOff, askConfirm]
  );
}
