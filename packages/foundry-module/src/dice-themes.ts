/**
 * Themed dice (I-085): two Dice So Nice colour sets that match the dashboard's themes (D-085),
 * "AI Tool: The Veil" (the campaign theme) and "AI Tool: Neutral" (the README brand). Every
 * client registers them, players included, since everyone rolls. Each player picks dice in Dice
 * So Nice's own appearance settings; the GM can set the world default there once.
 *
 * Silent when Dice So Nice is missing or its API changes: nothing happens unless the
 * `diceSoNiceReady` hook brings an object with `addColorset`. Registers client-side appearance
 * only; nothing in the world changes.
 */
import { MODULE_ID } from './constants.js';

/** A Dice So Nice colour set (its `addColorset` fields). */
export interface DiceColorset {
  name: string;
  description: string;
  category: string;
  foreground: string;
  background: string;
  outline: string;
  edge: string;
  texture: string;
  material: string;
}

export const DICE_COLORSETS: readonly DiceColorset[] = [
  {
    // The Veil: pewter grey-green smoky glass with drifting mist, the numbers in the lamp's gold
    // and silver edges (picked from four variants rendered on the test server).
    name: 'ai-tool-veil',
    description: 'AI Tool: The Veil',
    category: 'AI Tool',
    foreground: '#f2d88a',
    background: '#5e6b66',
    outline: '#1a1d1c',
    edge: '#c9cfca',
    texture: 'cloudy',
    material: 'glass',
  },
  {
    // Neutral: the README brand, deep navy with blue-white numbers and the accent blue.
    name: 'ai-tool-neutral',
    description: 'AI Tool: Neutral',
    category: 'AI Tool',
    foreground: '#e6e9ef',
    background: '#1d2a44',
    outline: '#0f1115',
    edge: '#4ea1ff',
    texture: 'none',
    material: 'plastic',
  },
];

interface Dice3dApi {
  addColorset(colorset: DiceColorset, mode?: string): unknown;
}

/** Add the colour sets to Dice So Nice; returns how many were added (0 without a usable API). */
export async function addDiceThemes(dice3d: unknown): Promise<number> {
  const api = dice3d as Partial<Dice3dApi> | null | undefined;
  if (typeof api?.addColorset !== 'function') return 0;
  let added = 0;
  for (const colorset of DICE_COLORSETS) {
    try {
      await api.addColorset({ ...colorset }, 'default');
      added++;
    } catch (error) {
      console.warn(`[${MODULE_ID}] Could not add the dice colour set ${colorset.name}:`, error);
    }
  }
  return added;
}

/** Call from the module `init` hook on every client. */
export function registerDiceThemes(): void {
  Hooks.once('diceSoNiceReady', (dice3d: unknown) => {
    void addDiceThemes(dice3d);
  });
}
