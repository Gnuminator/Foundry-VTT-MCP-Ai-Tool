// The OBS scenes of the demo scene collection and the browser window each one captures.
// OBS finds a window by its title, so every demo window gets a fixed title (see
// browser.mjs, which pins document.title). Change both together.

export const OBS_PROFILE = 'Foundry AI Tool demo';
export const OBS_COLLECTION = 'Foundry AI Tool demo';

/** Scene name -> window title. */
export const SCENES = {
  Foundry: 'Demo Foundry GM',
  Dashboard: 'Demo Dashboard',
  'Player page': 'Demo Player Page',
  'Foundry player': 'Demo Foundry Player',
};

/** OBS window_capture "window" setting for a title: "title:class:exe". */
export function windowSpec(title) {
  return `${title}:Chrome_WidgetWin_1:msedge.exe`;
}
