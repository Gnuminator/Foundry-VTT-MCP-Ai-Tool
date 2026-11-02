/**
 * Selected tokens get their own colour (test 3: a selected token looked the same as the token
 * whose turn it is).
 *
 * Foundry 14 core draws both: the combat turn marker (an orange ring around the turn holder) and,
 * for a selected token, a border in `CONFIG.Canvas.dispositionColors.CONTROLLED` (orange as
 * well). Core selects a token only when a combatant is clicked in the combat tracker; the optional
 * Monk's Combat Details selects the turn holder on its turn (`select-combatant`), so both marks can
 * land on one token and the two are hard to tell apart. None of the other Strahd modules draws a
 * turn ring or changes the border colour. Only the selection colour is ours to change, so it moves
 * to cyan: the turn marker keeps its look. A player's own token shows the same colour on hover.
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
