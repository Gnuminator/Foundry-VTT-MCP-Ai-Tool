// Guarded changes from the dashboard's own buttons (D-077): a plan-* tool turns one click into a
// plan, apply-planned-change carries it out, and the toast that says so has an Undo button
// (undo-change). Recent Changes keeps the full history. Port of the old page's planThenApply,
// runTool, confirmAction and undoToast (public/app.js): an ordinary write plan applies in the same
// click, any other plan (a reveal, a delete) opens the confirm window first.
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo } from 'react';

import { focusedElement, useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toasts';
import { api, ApiError, callTool, errorText, type ToolConfirm } from './api';
import {
  applySwitchesWrite,
  shortName,
  SWITCHES_KEY,
  type SwitchesRead,
  type SwitchesWrite,
} from './sessionSwitches';
import { isSwitchOffRefusal, refusedSwitchName } from './switchOff';
import { SETTINGS_KEY, useDashboardSettings, type DashboardSettings } from './stream';
import { usage } from './usage';

/**
 * Query keys under this prefix show game state that an applied change or an undo can move (the
 * party, ...); both refetch the ones a panel is showing.
 */
export const GAME_STATE_KEY = ['game'] as const;

/** Opens the place where the GM turns GM Actions on; App provides it. */
export const GmActionsGateContext = createContext<() => void>(() => undefined);

const GATE_TEXT = 'GM Actions are off. Start session or the header Turn on button turns them on.';

/** What a plan-* tool answers (guarded-write/service.ts on the bridge); the fields used here. */
interface Plan {
  planId?: unknown;
  risk?: string;
  /** A page-reveal plan's page: what the plan will show, whatever the caller expected. */
  pageUuid?: string;
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

const RECENT_CHANGES_HINT = 'It may have applied; check Recent Changes.';

/** How a guarded change ended; the Tool runner shows done and failed under its form. */
export type GuardedOutcome =
  /** The change went in (result: the apply answer), or the plan changed nothing (the plan). */
  | { status: 'done'; result: unknown }
  /** GM Actions are off: nothing was planned or sent (the toast says so). */
  | { status: 'refused' }
  /** The GM said no in the confirm window. */
  | { status: 'cancelled' }
  /**
   * The plan, the apply or the write failed (the toast says so); error is the reason.
   * `mayHaveApplied` is set when the request went out but no answer came back, so it may have
   * landed in Foundry (a form that would send the same thing again should not keep its draft).
   */
  | { status: 'failed'; error: string; mayHaveApplied?: true };

export interface GuardedOptions {
  /**
   * Ask in the confirm window even for an ordinary write plan: a plan typed by hand in the Tool
   * runner, where Enter in a field submits the form.
   */
  alwaysConfirm?: boolean;
  /** The toast when GM Actions are off; the default points at Pre-flight. */
  gateText?: string;
  /** The confirm window's lines for a write that is not a plan (default: the args as key: value). */
  lines?: string[];
  /** The confirm window's summary for a write that is not a plan (default: "Run <tool> ..."). */
  summary?: string;
  /**
   * A plan's confirm as one line (a reveal): the window shows this question and nothing else,
   * with `confirmLabel` on the button. Implies alwaysConfirm.
   */
  confirmLine?: {
    title: string;
    question: string;
    confirmLabel: string;
    pageUuid?: string | undefined;
  };
}

export interface GuardedTools {
  /** Plans with planTool, then applies the plan as useGuardedChange describes. */
  plan: (
    planTool: string,
    args: Record<string, unknown>,
    options?: GuardedOptions
  ) => Promise<GuardedOutcome>;
  /**
   * Runs a write tool that is not a plan (the Tool runner): the gate, then the confirm window,
   * then the call with its confirm flags. apply-planned-change shows the plan it applies and has
   * the Undo toast.
   */
  write: (
    name: string,
    args: Record<string, unknown>,
    kind: 'write' | 'destructive',
    options?: GuardedOptions
  ) => Promise<GuardedOutcome>;
  /**
   * True when GM Actions are off, after saying so (the toast, the gate): the caller stops. For a
   * flow that plans before it applies (Recent Changes' Undo), so it asks before it plans.
   */
  gated: (name: string, options?: GuardedOptions) => boolean;
  /**
   * Applies a plan the GM already approved in a window of their own (the undo window: the choice
   * and the tick for a destructive plan were the confirmation). The gate, then apply-planned-change
   * with its confirm flags, then the Undo toast. The plan came from a plan-* tool here.
   */
  applyApproved: (
    planId: string,
    destructive: boolean,
    options?: GuardedOptions
  ) => Promise<GuardedOutcome>;
}

const REFUSED: GuardedOutcome = { status: 'refused' };
const CANCELLED: GuardedOutcome = { status: 'cancelled' };

/** The args of a write, one line each, for the confirm window. */
export function argLines(args: Record<string, unknown>): string[] {
  const lines = Object.entries(args).map(
    ([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`
  );
  return lines.length > 0 ? lines : ['(no arguments)'];
}

/**
 * The guarded paths of the dashboard: plan (plan, then apply) and write (a write tool that is not
 * a plan). Both check GM Actions first, use the one confirm window, and end in toasts; neither
 * throws.
 */
export function useGuardedTools(): GuardedTools {
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useDashboardSettings();
  const openGate = useContext(GmActionsGateContext);
  const askConfirm = useConfirm();
  // Off until the stream says otherwise, as on the old page: a click before the first settings
  // event would plan and then be refused at apply, leaving the plan behind.
  const gmActionsOff = settings?.gmActionsEnabled !== true;

  return useMemo(() => {
    /** Turn on for tonight from a refusal toast: the same call as the Ready block in Pre-flight. */
    const turnOnForTonight = (): void => {
      api<SwitchesWrite>('/api/session/switches', {
        method: 'POST',
        body: JSON.stringify({ action: 'ready' }),
      })
        .then(data => applySwitchesWrite(queryClient, toast, data, 'ready'))
        .catch((err: unknown) => toast(`✗ Turn on for tonight: ${errorText(err)}`, 'err'));
    };

    /**
     * Whether the dashboard's Turn on for tonight controls the switch a refusal names. The GM
     * Actions gate has no button: it opens Pre-flight, which has the real one. Other switches keep
     * the named pointer to Foundry's settings.
     */
    const controlsSwitch = async (switchName: string): Promise<boolean> => {
      if (switchName === 'Allow Write Operations') return true;
      try {
        const read = await queryClient.fetchQuery({
          queryKey: SWITCHES_KEY,
          queryFn: () => api<SwitchesRead>('/api/session/switches'),
          staleTime: 30_000,
        });
        return read.switches?.switches.some(s => s.name === switchName) === true;
      } catch {
        return false;
      }
    };

    /** The warning toast of a refusal, with the Turn on for tonight button where it applies. */
    const refusalToast = async (text: string, switchName: string | null): Promise<void> => {
      const turnOn =
        switchName !== null && (await controlsSwitch(switchName))
          ? {
              label: `Turn on ${shortName(switchName)} and the rest for tonight`,
              onClick: turnOnForTonight,
            }
          : undefined;
      toast(text, 'warn', turnOn);
    };

    const refuse = (name: string, code: string, options: GuardedOptions): GuardedOutcome => {
      usage().trackTool(name, 'error', code);
      void refusalToast(options.gateText ?? GATE_TEXT, null);
      openGate();
      return REFUSED;
    };

    const changed = (): void => void queryClient.invalidateQueries({ queryKey: GAME_STATE_KEY });

    /**
     * Runs a write tool with its confirm flags: its answer, or how it ended when it failed (the
     * toast says why). A failure past the gate may still have landed in Foundry (a timeout above
     * all), so it refreshes what the panels show.
     */
    const send = async (
      name: string,
      args: Record<string, unknown>,
      confirm: ToolConfirm,
      options: GuardedOptions
    ): Promise<{ result: Applied } | { outcome: GuardedOutcome }> => {
      try {
        const result = await callTool<Applied | null>(name, args, confirm);
        usage().trackTool(name, 'ok');
        return { result: result ?? {} };
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          // The server says GM Actions are off, whatever the page last heard: the gates show
          // (the Tool runner's bar too) until the stream says otherwise. Before the stream's first
          // settings there is nothing else to keep: GM Actions stand in alone, as the Tool runner's
          // catalog and Turn on for tonight do (the Obsidian link waits for the stream).
          if (err.code === 'gm-actions-disabled') {
            queryClient.setQueryData<DashboardSettings | null>(SETTINGS_KEY, old =>
              old ? { ...old, gmActionsEnabled: false } : { gmActionsEnabled: false }
            );
          }
          return { outcome: refuse(name, '403', options) };
        }
        usage().trackTool(name, 'error', failCode(err));
        let error = errorText(err);
        if (isSwitchOffRefusal(error) && !mayHaveApplied(err)) {
          // Nothing was written and nothing is wrong: a switch to turn on, said as a hint.
          const hint = error.replace(/^Error:\s*/, '');
          void refusalToast(hint, refusedSwitchName(hint));
          return { outcome: { status: 'failed', error: hint } };
        }
        if (err instanceof ApiError && err.kind === 'timeout') {
          // The bridge stopped waiting after about 4 minutes; Foundry may still have done it.
          toast(`✗ ${name} timed out. ${RECENT_CHANGES_HINT}`, 'err');
          error = `Timed out. ${RECENT_CHANGES_HINT}`;
        } else if (mayHaveApplied(err)) {
          const text = error.trim();
          const stop = /[.!?]$/.test(text) ? '' : '.';
          error = `${text}${stop} ${RECENT_CHANGES_HINT}`;
          toast(`✗ ${name}: ${error}`, 'err');
        } else {
          toast(`✗ ${name}: ${error}`, 'err');
        }
        changed();
        return {
          outcome: {
            status: 'failed',
            error,
            ...(mayHaveApplied(err) ? { mayHaveApplied: true as const } : {}),
          },
        };
      }
    };

    // The click on Undo is the confirmation, as on the old page. A refusal says what the run
    // that made the toast would have said (its gate text), and opens the same gate.
    const undo = async (changeId: string, options: GuardedOptions): Promise<void> => {
      const sent = await send(
        'undo-change',
        { changeId },
        { confirm: true, confirmDestructive: true },
        options
      );
      if ('outcome' in sent) return;
      toast(doneText('undo-change', sent.result), 'ok');
      changed();
    };

    /**
     * The confirm window for a plan: the flags to apply it with, or how it ended when the GM
     * cancelled or the plan did not load. A plan answer without its summary and lines is read
     * again with get-planned-change, as the old page's apply path does.
     */
    const confirmPlan = async (
      plan: Plan,
      planId: string,
      returnTo: HTMLElement | null,
      line?: GuardedOptions['confirmLine']
    ): Promise<{ flags: ToolConfirm } | { outcome: GuardedOutcome }> => {
      // The drawer's line names the page it last read; when the server planned another page
      // (the queue moved since), the full window shows the plan's own summary instead.
      const sameTarget = line?.pageUuid === undefined || plan.pageUuid === line.pageUuid;
      if (line && sameTarget && (plan.risk === 'write' || plan.risk === undefined)) {
        // One line, no list and no tick: the plan has a working Undo, the window only asks.
        const ok = await askConfirm({
          title: line.title,
          summary: line.question,
          diff: [],
          compact: true,
          confirmLabel: line.confirmLabel,
          destructive: false,
          returnTo,
        });
        if (!ok) {
          usage().trackTool('apply-planned-change', 'cancelled');
          return { outcome: CANCELLED };
        }
        return { flags: { confirm: true } };
      }
      let shown = plan;
      let lines = planLines(plan);
      if (lines === null || typeof plan.summary !== 'string') {
        try {
          shown = (await callTool<Plan | null>('get-planned-change', { planId })) ?? {};
        } catch (err) {
          usage().trackTool('apply-planned-change', 'error', failCode(err));
          toast(`✗ Can't load the plan: ${errorText(err)}`, 'err');
          return { outcome: { status: 'failed', error: `Can't load the plan: ${errorText(err)}` } };
        }
        lines = planLines(shown) ?? lines ?? [];
      }
      const destructive = (shown.risk ?? plan.risk) === 'destructive';
      const ok = await askConfirm({
        summary: typeof shown.summary === 'string' ? shown.summary : plan.summary,
        diff: lines,
        destructive,
        returnTo,
      });
      if (!ok) {
        // The plan stays on the bridge until it expires, as on the old page.
        usage().trackTool('apply-planned-change', 'cancelled');
        return { outcome: CANCELLED };
      }
      return {
        flags: destructive ? { confirm: true, confirmDestructive: true } : { confirm: true },
      };
    };

    /** Applies a plan with its flags; the toast has Undo when the bridge recorded the change. */
    const apply = async (
      args: Record<string, unknown>,
      flags: ToolConfirm,
      options: GuardedOptions
    ): Promise<GuardedOutcome> => {
      const sent = await send('apply-planned-change', args, flags, options);
      if ('outcome' in sent) return sent.outcome;
      const applied = sent.result;
      const changeId = applied.changeId;
      if (changeId) {
        toast(doneText('apply-planned-change', applied), 'ok', {
          label: 'Undo',
          onClick: () => void undo(changeId, options),
        });
      } else {
        toast(doneText('apply-planned-change', applied), 'ok');
      }
      if (applied.copy && typeof applied.note === 'string') toast(applied.note, 'ok');
      if (applied.shown?.ok === false) {
        toast(`Revealed, but the popup failed: ${applied.shown.error ?? ''}`, 'warn');
      }
      changed();
      return { status: 'done', result: applied };
    };

    const plan: GuardedTools['plan'] = async (planTool, args, options = {}) => {
      // The button clicked, read now: the panel disables it in the same click, and the confirm
      // window gives focus back to it (or to its panel) when it closes.
      const startedFrom = focusedElement();
      // The old page plans first and is refused at apply, leaving a plan behind; asking first
      // leaves none. The server still checks (the 403 in send).
      if (gmActionsOff) return refuse('apply-planned-change', 'gm-actions-off', options);

      let planned: Plan | null;
      try {
        planned = await callTool<Plan | null>(planTool, args);
      } catch (err) {
        usage().trackTool(planTool, 'error', failCode(err));
        toast(`✗ ${planTool}: ${errorText(err)}`, 'err');
        return { status: 'failed', error: errorText(err) };
      }
      usage().trackTool(planTool, 'ok');
      if (planned?.providerNote) toast(planned.providerNote, 'warn');
      if (!planned || typeof planned.planId !== 'string' || !planned.planId) {
        toast(typeof planned?.note === 'string' ? `✓ ${planned.note}` : `✓ ${planTool}`, 'ok');
        changed();
        return { status: 'done', result: planned };
      }
      // The click is the confirmation for an ordinary write; anything else asks first.
      let flags: ToolConfirm = { confirm: true };
      if (planned.risk !== 'write' || options.alwaysConfirm || options.confirmLine) {
        const asked = await confirmPlan(planned, planned.planId, startedFrom, options.confirmLine);
        if ('outcome' in asked) return asked.outcome;
        flags = asked.flags;
      }
      return apply({ planId: planned.planId }, flags, options);
    };

    const write: GuardedTools['write'] = async (name, args, kind, options = {}) => {
      const startedFrom = focusedElement();
      if (gmActionsOff) return refuse(name, 'gm-actions-off', options);
      if (name === 'apply-planned-change') {
        // A plan Claude made: the window shows what it changes, as on the old page.
        const planId = typeof args['planId'] === 'string' ? args['planId'] : '';
        const asked = await confirmPlan({}, planId, startedFrom);
        if ('outcome' in asked) return asked.outcome;
        return apply(args, asked.flags, options);
      }
      const destructive = kind === 'destructive';
      const ok = await askConfirm({
        summary: options.summary ?? `Run ${name} against the live game?`,
        diff: options.lines ?? argLines(args),
        destructive,
        returnTo: startedFrom,
      });
      if (!ok) {
        usage().trackTool(name, 'cancelled');
        return CANCELLED;
      }
      const flags = destructive ? { confirm: true, confirmDestructive: true } : { confirm: true };
      const sent = await send(name, args, flags, options);
      if ('outcome' in sent) return sent.outcome;
      toast(doneText(name, sent.result), 'ok');
      changed();
      return { status: 'done', result: sent.result };
    };

    const gated: GuardedTools['gated'] = (name, options = {}) => {
      if (!gmActionsOff) return false;
      refuse(name, 'gm-actions-off', options);
      return true;
    };

    const applyApproved: GuardedTools['applyApproved'] = async (
      planId,
      destructive,
      options = {}
    ) => {
      if (gmActionsOff) return refuse('apply-planned-change', 'gm-actions-off', options);
      const flags = destructive ? { confirm: true, confirmDestructive: true } : { confirm: true };
      return apply({ planId }, flags, options);
    };

    return { plan, write, gated, applyApproved };
  }, [toast, queryClient, openGate, gmActionsOff, askConfirm]);
}

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
  const { plan } = useGuardedTools();
  return useCallback(
    async (planTool, args) => (await plan(planTool, args)).status === 'done',
    [plan]
  );
}
