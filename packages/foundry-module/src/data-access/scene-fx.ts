import * as shared from './shared.js';

/**
 * Scene FX domain: the one scene-dressing write that stays direct, playing or
 * stopping a playlist. Everything else (templates, darkness and light, map
 * notes, loot) is planned by `scene-plan.ts` and applied through the guarded
 * write system (I-112); music leaves nothing to undo.
 */
export class SceneFxDataAccess {
  /**
   * Resolve a playlist by name and play/stop it (default: play). Returns a
   * human-readable status string, or a "not found" message when the name
   * doesn't resolve.
   */
  async playPlaylist(data: {
    playlistName?: string;
    action?: 'play' | 'stop';
  }): Promise<{ success: true; playlist: string }> {
    shared.validateFoundryState();
    const playlistName = data.playlistName;
    if (!playlistName) {
      throw new Error('playlistName is required');
    }
    const pl =
      game.playlists?.getName?.(playlistName) ??
      game.playlists?.find?.(p => p.name?.toLowerCase() === playlistName.toLowerCase());
    if (!pl) {
      return { success: true, playlist: `Playlist not found: ${playlistName}` };
    }
    const verb = data.action ?? 'play';
    if (verb === 'stop') {
      await pl.stopAll();
    } else {
      await pl.playAll();
    }
    return { success: true, playlist: `${verb} "${pl.name}"` };
  }
}
