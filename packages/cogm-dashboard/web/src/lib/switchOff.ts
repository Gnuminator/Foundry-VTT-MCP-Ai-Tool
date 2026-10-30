/**
 * Whether a refusal is "an AI Tool switch is off" (the module's and the bridge's switch-off
 * sentences end in where to turn it on). Nothing was written, so it is a hint, not a failure.
 */
export function isSwitchOffRefusal(text: string): boolean {
  return /\bis switched off\. In Foundry, open Game Settings|Write operations are disabled in the module settings/i.test(
    text
  );
}

const SETTINGS_PATH = 'In Foundry, open Game Settings, Configure Settings, AI Tool and turn on';

/** The bridge's feature list (GET /api/features); null when it cannot be read. */
export interface FeatureList {
  features: Array<{ id: string; name: string; enabled: boolean }> | null;
  writesAllowed: boolean | null;
}

/**
 * Said above the Handouts queue while Reveal next would be refused: what is off and where to turn
 * it on. Queueing and moving pages work without the switch; only the reveal is a guarded write.
 */
export function handoutsSwitchOff(f: FeatureList | null): string | null {
  if (!f) return null;
  if (f.writesAllowed === false) {
    return `Revealing is refused: "Allow Write Operations" is off. ${SETTINGS_PATH} "Allow Write Operations".`;
  }
  const handouts = f.features?.find(x => x.id === 'handouts');
  if (handouts && !handouts.enabled) {
    return `Revealing is refused: "${handouts.name}" is switched off. ${SETTINGS_PATH} "${handouts.name}". You can still queue and reorder pages.`;
  }
  return null;
}
