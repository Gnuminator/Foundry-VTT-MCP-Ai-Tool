/** The bridge still takes the actor as `actorIdentifier`; the tool input calls it `actor`. */
export function toBridge<T extends { actor: string }>(
  parsed: T
): Omit<T, 'actor'> & { actorIdentifier: string } {
  const { actor, ...rest } = parsed;
  return { ...rest, actorIdentifier: actor };
}
