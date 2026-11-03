/**
 * One place for the error words the tools send back to Claude: the message of a caught value, the
 * "switched off" refusal, and the next step Claude should take after an error. A refusal that ends
 * in what to do next keeps Claude from retrying or working around a switch the GM has to turn on.
 */
import { SWITCH_OFF_PATH } from '../switch-off.js';

/** The message of a caught value: an Error's message, a string as it is, anything else as text. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json === undefined ? String(error) : json;
  } catch {
    return String(error);
  }
}

/** Said after a refusal Claude cannot fix itself. */
export const STOP_AND_TELL = 'Tell the GM and stop here; do not work around it with other tools.';

/**
 * The refusal for a feature switch that is off. `label` is how the feature reads in a sentence
 * ("The rules check", "Paper sync"), `switchName` the setting as Game Settings shows it. The
 * "is switched off. In Foundry, open" wording is what the dashboard matches to show its hint.
 */
export function featureSwitchOff(label: string, switchName: string): string {
  return `${label} is switched off. ${SWITCH_OFF_PATH} "${switchName}". ${STOP_AND_TELL}`;
}

/** A lookup that found nothing: names the tool that lists what exists. */
export function notFoundMessage(what: string, lookupTool: string): string {
  return `${what} not found. Use ${lookupTool} to find the right one, then try again.`;
}

/** The Foundry link is down. */
export const NOT_CONNECTED_TAIL =
  'Tell the GM that Foundry is not connected (the world must be open in a browser with a GM joined); do not retry.';

/** A plan that is gone (expired, applied or cancelled). */
export const PLAN_GONE_TAIL = 'List the pending plans with get-planned-change, or make a new plan.';

/** A tool name the backend does not know. */
export function unknownToolMessage(name: string): string {
  return `Unknown tool: ${name}. If it should exist, its tool set may be switched off in Claude's Search and tools menu; tell the GM which set to switch on.`;
}
