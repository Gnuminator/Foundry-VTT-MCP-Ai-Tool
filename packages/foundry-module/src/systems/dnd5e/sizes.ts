/**
 * dnd5e creature sizes (M3). dnd5e stores a short key in `system.traits.size`
 * (verified: dnd5e.mjs 6.0.5 `CONFIG.DND5E.actorSizes` keys `tiny, sm, med,
 * lg, huge, grg`; `ActorSizeField` initial `"med"`; the same keys in 5.3),
 * while tools and people say "medium". Both spellings must compare equal.
 *
 * Mirror of `normalizeDnD5eSizeKey` in
 * `packages/mcp-server/src/systems/dnd5e/filters.ts` (the module cannot import
 * backend code); `sizes.contract.test.ts` pins the two together.
 */

/** dnd5e's own size keys (`CONFIG.DND5E.actorSizes`). */
export const DND5E_SIZE_KEYS = ['tiny', 'sm', 'med', 'lg', 'huge', 'grg'] as const;
export type Dnd5eSizeKey = (typeof DND5E_SIZE_KEYS)[number];

const SIZE_INPUT_TO_KEY: Readonly<Record<string, Dnd5eSizeKey>> = {
  tiny: 'tiny',
  small: 'sm',
  sm: 'sm',
  medium: 'med',
  med: 'med',
  large: 'lg',
  lg: 'lg',
  huge: 'huge',
  gargantuan: 'grg',
  grg: 'grg',
};

/** The dnd5e size key for a key or a display word (any case), or undefined when unknown. */
export function dnd5eSizeKey(size: string): Dnd5eSizeKey | undefined {
  const lower = size.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SIZE_INPUT_TO_KEY, lower)
    ? SIZE_INPUT_TO_KEY[lower]
    : undefined;
}

/**
 * Whether two size spellings name the same size: by dnd5e key when both are
 * known sizes, else (a size some module added) by case-insensitive text.
 */
export function sameDnd5eSize(a: string, b: string): boolean {
  const keyA = dnd5eSizeKey(a);
  const keyB = dnd5eSizeKey(b);
  if (keyA !== undefined && keyB !== undefined) return keyA === keyB;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
