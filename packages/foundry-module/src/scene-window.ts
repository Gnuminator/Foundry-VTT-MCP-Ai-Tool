/**
 * The "Scene" GM window (I-134 part 2): the mood of the scene the table is looking at, read from
 * Foundry's own data: the scene name, how dark it is, whether the scene has global light, the
 * weather, and what is playing (playlists with a playing sound). Read only, nothing goes through
 * the AI Tool; the mood presets themselves are changed from Claude or the dashboard.
 *
 * {@link buildSceneView} and {@link renderSceneHtml} are pure and tested without Foundry.
 */
import { escapeHtml } from './ai-changes-model.js';
import { createPanelWindow } from './gm-windows.js';
import { viewedScene } from './viewed-scene.js';

/** The parts of a scene the panel reads (Foundry's `Scene`, structurally; v14 keeps light in `environment`). */
export interface SceneLike {
  name?: string;
  environment?: {
    darknessLevel?: number;
    globalLight?: { enabled?: boolean };
  };
  weather?: string;
}

/** A playlist as the panel reads it. */
export interface PlaylistLike {
  name?: string;
  playing?: boolean;
  sounds?: Iterable<{ name?: string; playing?: boolean }>;
}

export interface SceneView {
  empty: boolean;
  name: string;
  /** "Daylight", "Dusk", "Dark" or "Pitch dark", with the percentage; empty when unknown. */
  darkness: string;
  globalLight: boolean;
  weather: string;
  playing: string[];
}

const percent = (level: number): number => Math.round(Math.min(1, Math.max(0, level)) * 100);

function darknessText(level: unknown): string {
  if (typeof level !== 'number' || !Number.isFinite(level)) return '';
  const p = percent(level);
  const word = p < 25 ? 'Daylight' : p < 60 ? 'Dusk' : p < 90 ? 'Dark' : 'Pitch dark';
  return `${word} (${p}%)`;
}

export function buildSceneView(
  scene: SceneLike | null | undefined,
  playlists: Iterable<PlaylistLike>
): SceneView {
  const playing: string[] = [];
  for (const list of playlists) {
    for (const sound of list.sounds ?? []) {
      if (sound.playing)
        playing.push(`${sound.name ?? 'Unnamed sound'} (${list.name ?? 'Playlist'})`);
    }
  }
  if (!scene) {
    return { empty: true, name: '', darkness: '', globalLight: false, weather: '', playing };
  }
  return {
    empty: false,
    name: scene.name ?? 'Unnamed scene',
    darkness: darknessText(scene.environment?.darknessLevel),
    globalLight: scene.environment?.globalLight?.enabled === true,
    weather: typeof scene.weather === 'string' ? scene.weather : '',
    playing,
  };
}

export function renderSceneHtml(view: SceneView): string {
  if (view.empty) {
    return '<p class="fmb-ai-notice fmb-gm-empty">No scene is active.</p>';
  }
  const rows = [
    `<li class="fmb-gm-row"><span class="fmb-gm-main"><strong>${escapeHtml(view.name)}</strong></span></li>`,
    view.darkness
      ? `<li class="fmb-gm-row"><span class="fmb-gm-main">Light: ${escapeHtml(view.darkness)}${view.globalLight ? ' <span class="fmb-ai-tag">Global light</span>' : ''}</span></li>`
      : '',
    view.weather
      ? `<li class="fmb-gm-row"><span class="fmb-gm-main">Weather: ${escapeHtml(view.weather)}</span></li>`
      : '',
    `<li class="fmb-gm-row"><span class="fmb-gm-main">${
      view.playing.length > 0
        ? `Playing: ${view.playing.map(escapeHtml).join(', ')}`
        : '<span class="fmb-gm-muted">Nothing is playing.</span>'
    }</span></li>`,
  ];
  return `<ul class="fmb-ai-list fmb-gm-list">${rows.join('')}</ul>`;
}

const panel = createPanelWindow({
  id: 'fmb-gm-scene',
  title: 'Scene',
  icon: 'fa-solid fa-image',
  width: 340,
  height: 260,
  hooks: [
    'canvasReady',
    'updateScene',
    'createPlaylistSound',
    'updatePlaylistSound',
    'deletePlaylistSound',
    'updatePlaylist',
  ],
  render: () =>
    renderSceneHtml(
      buildSceneView(
        viewedScene(game.scenes),
        Array.from((game.playlists ?? []) as unknown as Iterable<PlaylistLike>)
      )
    ),
});

/** Open the "Scene" window (one per browser). */
export const openSceneWindow = (): Promise<boolean> => panel.open();

/** Forget the window (tests). */
export const resetSceneWindowForTests = (): void => panel.reset();
