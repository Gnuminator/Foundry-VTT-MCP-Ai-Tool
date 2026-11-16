/** A fresh 16-character document id: Foundry's own `randomID` when it exists, else the platform CSPRNG. */
export function newId(): string {
  const randomID = (
    globalThis as { foundry?: { utils?: { randomID?: (length: number) => string } } }
  ).foundry?.utils?.randomID;
  if (typeof randomID === 'function') return randomID(16);
  // Foundry always has randomID; this fallback is for the test harness.
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}
