/**
 * Rules check helper (I-126): the read-only `check-action` tool says whether an item, spell or
 * attack looks legal right now (whose turn it is, what it costs, range to a target, spell slots
 * and uses left) and why, before anything is applied. It writes nothing. It is switched on by the
 * world setting `feature.rules-check.enabled` (off by default).
 *
 * The backend gathers the facts from existing read queries (`getCombatState`,
 * `getCharacterEntity`, `getCharacterResources`, `measureDistance`); there is no module query of
 * its own. dnd5e 6 data only; no book text.
 */

/** The guarded feature id and its world-setting switch (`feature.rules-check.enabled`). */
export const RULES_CHECK_FEATURE_ID = 'rules-check';

/** How one check came out. `unknown` means Foundry does not hold the facts to decide. */
export const RULES_CHECK_STATUSES = ['pass', 'warn', 'fail', 'unknown', 'info'] as const;
export type RulesCheckStatus = (typeof RULES_CHECK_STATUSES)[number];

/** The checks, in the order they are reported. */
export const RULES_CHECK_KINDS = ['turn', 'action-cost', 'range', 'slots', 'uses'] as const;
export type RulesCheckKind = (typeof RULES_CHECK_KINDS)[number];

/** One line of the report. */
export interface RulesCheckLine {
  check: RulesCheckKind;
  status: RulesCheckStatus;
  reason: string;
}

/** The overall verdict: `legal` (no fail or warn), `problem` (a fail), `unclear` (warn or unknown only). */
export type RulesCheckVerdict = 'legal' | 'problem' | 'unclear';

/** The `check-action` reply. */
export interface RulesCheckResult {
  verdict: RulesCheckVerdict;
  actor: string;
  item: string;
  target?: string;
  checks: RulesCheckLine[];
  /** One sentence for the table. */
  summary: string;
  /** What this check cannot see (kept short, always present). */
  limits: string[];
}
