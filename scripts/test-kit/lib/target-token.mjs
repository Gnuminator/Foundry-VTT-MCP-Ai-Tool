/**
 * The GM action `targetToken`: targets one token on the active scene as the GM user would (T on
 * the map), releasing every other target; without `tokenId` it only clears the targets. Self-
 * contained like every GM action (Playwright serializes it into the Foundry page).
 * @param {{sceneId: string, tokenId?: string}} args
 */
export async function targetToken(args) {
  for (const t of Array.from(game.user.targets)) t.setTarget(false, { releaseOthers: false });
  if (args.tokenId) {
    const token = canvas.tokens.get(args.tokenId);
    if (!token || canvas.scene?.id !== args.sceneId) {
      throw new Error(`targetToken: no token ${args.tokenId} on the active scene ${args.sceneId}`);
    }
    token.setTarget(true, { releaseOthers: true });
  }
  return { targeted: Array.from(game.user.targets).map(t => t.id) };
}
