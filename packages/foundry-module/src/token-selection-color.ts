/**
 * Selected tokens get their own colour (test 3: a selected token looked the same as the token
 * whose turn it is).
 *
 * Foundry 14 core draws both: the combat turn marker (an orange ring around the turn holder) and,
 * for a selected token, a border in `CONFIG.Canvas.dispositionColors.CONTROLLED` (orange as
 * well). The optional Monk's Combat Details selects the turn holder on its turn
 * (`select-combatant`), and a click on a combatant in the tracker does too, so both marks can land
 * on one token and the two are hard to tell apart. None of the other Strahd modules draws a turn
 * ring or changes the border colour. Only the selection colour is ours to change, so it moves to
 * white: the turn marker keeps its look. Cyan was too close to core's friendly colour (hover shows
 * a border too), and the border has a black outline, so white shows on light and dark maps. The
 * same colour also tints the controls of selected lights, tiles, drawings, notes and regions, and
 * a player's own token on hover.
 */
export const SELECTION_COLOR = 0xffffff;

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
  // The colour is a tint set by the state refresh, so the redraw needs refreshState.
  for (const token of placeables ?? [])
    token.renderFlags?.set({ refreshState: true, refreshBorder: true });
  return true;
}
