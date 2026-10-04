/**
 * The shared theme between Obsidian and the dashboard (I-099), without `obsidian` so it runs in
 * node tests. One theme per world lives in the dashboard; the plugin keeps the last one it saw
 * (for when the dashboard is offline), whether the styling is on here, and a pick made while
 * the dashboard did not answer, which it sends on the next sync.
 */
import { DashboardError } from './dashboard.js';
import { THEME_LABELS, type ThemeId } from './theme.js';

export interface ThemeState {
  /** The world's theme as last seen in the dashboard. */
  theme: ThemeId;
  /** False when the theme is Off: no styling in this Obsidian; the dashboard keeps its theme. */
  themeEnabled: boolean;
  /**
   * A theme picked here while the dashboard did not answer; sent when it answers again. Only
   * within one Obsidian session (the plugin drops it on load): while the dashboard is down or has
   * no world it cannot change the theme either, so the pick here is the newest one.
   */
  pendingTheme: ThemeId | null;
}

export interface ThemeClient {
  theme(): Promise<ThemeId>;
  setTheme(theme: ThemeId): Promise<ThemeId>;
}

/** Worth trying again later: the dashboard did not answer (0) or does not know the world yet (409). */
function retryable(error: unknown): boolean {
  if (!(error instanceof DashboardError)) return true;
  return error.status === 0 || error.status === 409;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A pick in the settings. Neutral or The Veil also become the dashboard's theme for the world
 * (kept as pending when the dashboard cannot take it yet); Off only turns the styling off here.
 * Returns the new state and a notice for the GM, if any.
 */
export async function pickTheme(
  state: ThemeState,
  choice: ThemeId | 'off',
  client: ThemeClient
): Promise<{ state: ThemeState; notice: string | null }> {
  if (choice === 'off') return { state: { ...state, themeEnabled: false }, notice: null };
  try {
    const theme = await client.setTheme(choice);
    return { state: { theme, themeEnabled: true, pendingTheme: null }, notice: null };
  } catch (error) {
    if (retryable(error)) {
      return {
        state: { theme: choice, themeEnabled: true, pendingTheme: choice },
        notice: `Obsidian shows ${THEME_LABELS[choice]} now. The dashboard did not take it yet (${messageOf(error)}); it gets it when it answers.`,
      };
    }
    // Refused (for example no GM token): keep the dashboard's theme.
    const notice = `The dashboard kept its theme: ${messageOf(error)}`;
    try {
      const theme = await client.theme();
      return { state: { theme, themeEnabled: true, pendingTheme: null }, notice };
    } catch {
      return { state: { ...state, themeEnabled: true, pendingTheme: null }, notice };
    }
  }
}

/**
 * Takes the dashboard's theme, or first sends a pick made here while it was offline. Offline
 * keeps the last theme; a refusal drops the pending pick.
 */
export async function syncTheme(state: ThemeState, client: ThemeClient): Promise<ThemeState> {
  const pending = state.pendingTheme;
  try {
    if (pending) return { ...state, theme: await client.setTheme(pending), pendingTheme: null };
    return { ...state, theme: await client.theme() };
  } catch (error) {
    if (!pending || retryable(error)) return state;
    return { ...state, pendingTheme: null };
  }
}

export function sameThemeState(a: ThemeState, b: ThemeState): boolean {
  return (
    a.theme === b.theme && a.themeEnabled === b.themeEnabled && a.pendingTheme === b.pendingTheme
  );
}
