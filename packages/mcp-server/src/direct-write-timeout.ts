/**
 * Truth about a direct write that got no answer.
 *
 * A direct write (a tool whose description starts "Direct write.") acts at once. When the bridge
 * waits for Foundry's answer and none arrives in time, the change may still have happened (the
 * module may be slow, or the answer lost on the way). "Query timeout: ..." tells Claude nothing
 * and invites a blind retry, which double-posts a chat message or double-advances a turn. This
 * file is the one place that turns that into an honest answer, for every direct-write route.
 *
 * Plan, apply and undo have their own outcome check (guarded-write/service.ts) and are left alone.
 *
 * Pure apart from the AsyncLocalStorage the connector reads: no SDK, no I/O.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** The default query timeout is 10 s (foundry-connector.ts); a direct write may take longer. */
export const DIRECT_WRITE_TIMEOUT_MS = 30_000;

/** The timeout the connector uses for queries made inside a direct write, when the query names none. */
export const queryTimeoutContext = new AsyncLocalStorage<{ timeoutMs: number }>();

/** The tools that are not direct writes although they are not reads: the plan story's own writes. */
const NOT_DIRECT = new Set(['apply-planned-change', 'undo-change']);

/** Whether a tool is a direct write, from its hint kind and name. */
export function isDirectWriteTool(name: string, kind: string | undefined): boolean {
  if (kind === undefined || kind === 'read') return false;
  return !name.startsWith('plan-') && !NOT_DIRECT.has(name);
}

/** Errors that mean "no answer arrived", as opposed to Foundry refusing the change. */
export function isLostAnswerMessage(message: string): boolean {
  return /query timeout|connection closed/i.test(message);
}

/** The honest answer for a direct write whose answer never came. */
export function directWriteLostAnswerMessage(tool: string, timeoutMs: number): string {
  const seconds = Math.round(timeoutMs / 1000);
  return (
    `${tool}: no answer from Foundry in ${seconds} s. The change may or may not have happened: ` +
    'check the chat log or the change list before trying again.'
  );
}

/** The honest answer when the link closed before the answer came (the call log reads "no answer from"). */
export function directWriteLinkClosedMessage(tool: string): string {
  return `${tool}: no answer from Foundry, the link closed first. The change may or may not have happened: check the chat log or the change list before trying again.`;
}

/**
 * Run a direct write with the longer timeout; a lost answer becomes the honest message, any other
 * error passes through unchanged.
 */
export async function runDirectWrite<T>(
  tool: string,
  run: () => Promise<T>,
  timeoutMs: number = DIRECT_WRITE_TIMEOUT_MS
): Promise<T> {
  try {
    return await queryTimeoutContext.run({ timeoutMs }, run);
  } catch (error) {
    // Some tools wrap the bridge error (ErrorHandler keeps it as `cause`): look down the chain.
    for (let e: unknown = error, depth = 0; e !== undefined && depth < 5; depth++) {
      const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
      if (isLostAnswerMessage(message)) {
        const closed = !/query timeout/i.test(message);
        throw new Error(
          closed
            ? directWriteLinkClosedMessage(tool)
            : directWriteLostAnswerMessage(tool, timeoutMs),
          { cause: error }
        );
      }
      e = e instanceof Error ? e.cause : undefined;
    }
    throw error;
  }
}
