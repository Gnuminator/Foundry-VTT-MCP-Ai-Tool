/**
 * Selected tokens get their own colour (test 3: a selected token looked the same as the token
 * whose turn it is).
 *
 * Foundry 14 draws both itself: the combat turn marker (an orange ring that turns around the token
 * in the combat tracker's own colours) and, for a selected token, a border in
 * `CONFIG.Canvas.dispositionColors.CONTROLLED` (orange as well). Turn changes also select the turn
 * holder for the GM's own tokens, so both land on one token and the two are hard to tell apart.
 * Only the selection colour is ours to change, so it moves to cyan: the turn marker keeps its look.
 * A player's own tokens always show the controlled colour in core, so they get cyan too.
 */
export const SELECTION_COLOR = 0x00d5ff;

interface BorderToken {
  renderFlags?: { set: (flags: Record<string, boolean>) => void };
}

/** Set the selection colour and redraw the borders of the tokens already on the canvas. */
export function applySelectionColor(): boolean {
  const colors = (CONFIG as { Canvas?: { dispositionColors?: Record<string, number> } }).Canvas
    ?.dispositionColors;
  if (!colors) return false;
  colors.CONTROLLED = SELECTION_COLOR;
  const placeables = (canvas as { tokens?: { placeables?: BorderToken[] } } | undefined)?.tokens
    ?.placeables;
  for (const token of placeables ?? []) token.renderFlags?.set({ refreshBorder: true });
  return true;
}
