// I-078: whether a passive score meets a DC the GM typed. Nothing is rolled or sent.

/** True when the score meets the DC; null when the DC is not a number or there is no score. */
export function noticed(score: number | null | undefined, dc: number | null): boolean | null {
  return score == null || dc == null ? null : score >= dc;
}
