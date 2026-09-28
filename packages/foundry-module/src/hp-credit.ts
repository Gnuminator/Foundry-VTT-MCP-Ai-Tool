/**
 * Which roll an HP change came from, shared by the play recorder and the
 * session event feed. Exact when dnd5e applied it from a chat card; otherwise
 * a guess that must fit the roll under 5e rules.
 */

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/**
 * The chat message a dnd5e damage application came from, from the
 * `dnd5e.preApplyDamage(actor, amount, updates, options)` options (dnd5e 6.0.5
 * `Actor5e#applyDamage`): a card's Apply button passes it as
 * `options.originatingMessage` and `options.origin`; the token HP bar and
 * direct calls pass none (`null`).
 */
export function originatingMessageId(rawOptions: unknown): string | null {
  const options = asRecord(rawOptions);
  const origin = asRecord(options?.origin);
  const message =
    asRecord(options?.originatingMessage) ??
    (origin?.documentName === 'ChatMessage' ? origin : null);
  const id = message?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Whether an HP change could be a roll of `total` under 5e rules: the full
 * amount, half (resistance) or double (vulnerability), or less when the change
 * stopped at a limit (0 HP for damage, max HP for healing).
 */
export function hpChangeFitsRoll(amount: number, total: number, stoppedAtLimit: boolean): boolean {
  if (amount <= 0 || total <= 0) return false;
  if (amount === total || amount === Math.floor(total / 2) || amount === total * 2) return true;
  return stoppedAtLimit && amount < total;
}
