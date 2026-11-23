// One tool call, the way the Tool Runner runs it and a pinned button runs it. A plan-* tool is
// planned and applied after the confirm window, always; any other write goes through the same
// window; a read runs at once. The gates (GM Actions, the window) are the guarded tools', so a
// pin can never run something the form could not.
import type { QueryClient } from '@tanstack/react-query';

import type { useToast } from '../components/Toasts';

import { callTool, errorText } from './api';
import { GAME_STATE_KEY, failCode, type GuardedOutcome, type GuardedTools } from './guarded';
import { isPlanTool, isQueueCall } from './tool-form';
import { usage } from './usage';

/** What shows under the form: the answer or the error. */
export interface ToolResult {
  tool: string;
  ok: boolean;
  payload: unknown;
}

const GATE_TEXT = 'GM Actions are off. Enable GM Actions at the top of the Tool Runner.';

const fromOutcome = (name: string, outcome: GuardedOutcome): ToolResult | null => {
  if (outcome.status === 'done') return { tool: name, ok: true, payload: outcome.result };
  if (outcome.status === 'failed') return { tool: name, ok: false, payload: outcome.error };
  // Refused or cancelled: nothing ran, the form keeps its values for another try.
  return null;
};

export async function runToolCall(
  deps: { guarded: GuardedTools; toast: ReturnType<typeof useToast>; queryClient: QueryClient },
  tool: { name: string; mutates: 'read' | 'write' | 'destructive' },
  args: Record<string, unknown>,
  lines: string[] | undefined
): Promise<ToolResult | null> {
  const { guarded, toast, queryClient } = deps;
  const name = tool.name;
  if (isPlanTool(name) && !isQueueCall(name, args)) {
    return fromOutcome(
      name,
      await guarded.plan(name, args, { alwaysConfirm: true, gateText: GATE_TEXT })
    );
  }
  if (tool.mutates !== 'read') {
    return fromOutcome(
      name,
      await guarded.write(name, args, tool.mutates, {
        gateText: GATE_TEXT,
        ...(lines ? { lines } : {}),
      })
    );
  }
  // A read, or a queue change that touches nothing in Foundry: runs at once, no GM Actions.
  try {
    const answer = await callTool<unknown>(name, args);
    usage().trackTool(name, 'ok');
    if (isQueueCall(name, args)) {
      const note = (answer as { note?: unknown } | null)?.note;
      toast(typeof note === 'string' ? `✓ ${note}` : `✓ ${name}`, 'ok');
      void queryClient.invalidateQueries({ queryKey: GAME_STATE_KEY });
    }
    return { tool: name, ok: true, payload: answer };
  } catch (err) {
    usage().trackTool(name, 'error', failCode(err));
    return { tool: name, ok: false, payload: errorText(err) };
  }
}
