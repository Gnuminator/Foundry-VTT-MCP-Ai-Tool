/**
 * Plain-words messages for the GM. A pop-up in Foundry is read by someone who is mid-session and
 * new to the tool, so it says what did not work and what to do next, never a raw error string.
 * The technical detail stays in the browser console (the callers log it before they notify).
 */

/** The reasons that are worth naming. Matched against the error text, first hit wins. */
const KNOWN_REASONS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /permission|not allowed|unauthori[sz]ed|forbidden|only (?:a )?gm/i,
    'You may not have permission for this.',
  ],
  [/timed? ?out|timeout/i, 'It took too long to answer. Try again in a moment.'],
  [
    /not connected|disconnect|socket|network|fetch|econn|offline/i,
    'The AI Tool is not connected right now. Check that it is running, then try again.',
  ],
  [
    /no longer exists|not found|missing|unknown (?:actor|scene|journal|item)/i,
    'Something it needs is gone or has been renamed.',
  ],
];

/** What to do when no reason is known. Short, because the console has the rest. */
const FALLBACK_HINT = 'Try again. If it keeps happening, press F12 and look at the Console tab.';

/**
 * A GM-facing sentence for something that failed. `what` is the thing the GM tried, as a short
 * noun phrase or an action in plain words ("open the live window", "save the campaign progress").
 * The raw error is only used to pick a known reason; it is never shown.
 */
export function toGmMessage(what: string, error?: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const reason = KNOWN_REASONS.find(([pattern]) => pattern.test(text))?.[1] ?? FALLBACK_HINT;
  return `Could not ${what}. ${reason}`;
}
