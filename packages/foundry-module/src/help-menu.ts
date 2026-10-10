import { trackUsage } from './usage-recorder.js';

/** The GM guides on the wiki (wiki v1, D-108): the page the settings Help button opens. */
export const GM_GUIDE_URL = 'https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/gm/';

type ApplicationV2Class = new () => object;

/**
 * The "Help" settings menu: a button in the module settings that opens the GM guides in a new
 * browser tab. Foundry requires an ApplicationV2 class for a menu and opens it with
 * `new type().render(true)`, so `render` opens the page instead of drawing a window. Built at
 * `init`, when Foundry's classes exist.
 */
export function createHelpMenu(
  open: (url: string) => unknown = url => window.open(url, '_blank', 'noopener')
): new () => object {
  const api = foundry.applications.api as { ApplicationV2: ApplicationV2Class };
  return class HelpMenu extends api.ApplicationV2 {
    render(): Promise<this> {
      trackUsage('action', 'module.settings.help');
      open(GM_GUIDE_URL);
      return Promise.resolve(this);
    }
  };
}
