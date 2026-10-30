/**
 * The sentences that say an AI Tool switch is off, in one place. The module, the bridge and the
 * dashboard all refuse a guarded write with these words, and the dashboard's refusal toast and
 * `isSwitchOffRefusal` (cogm-dashboard/web/src/lib/switchOff.ts) match on them.
 */

/** Where the switches are, in the words the GM sees in Foundry. */
export const SWITCH_OFF_PATH =
  'In Foundry, open Game Settings, Configure Settings, AI Tool and turn on';

/** The refusal for "Allow Write Operations" being off. */
export const WRITES_OFF_MESSAGE = `Write operations are disabled in the module settings. ${SWITCH_OFF_PATH} "Allow Write Operations".`;

/** The refusal for a feature switch being off: its name as Game Settings shows it, and where it is. */
export function featureOffMessage(name: string): string {
  return `"${name}" is switched off. ${SWITCH_OFF_PATH} "${name}".`;
}
