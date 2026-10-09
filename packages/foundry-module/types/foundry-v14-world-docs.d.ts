/**
 * Playlists, playlist sounds and roll tables.
 *
 * Foundry VTT 14.368 shapes. Trailing comments are source refs relative to the Foundry app
 * folder (`common/`, `client/`). Schema fields are declared in full; client methods only where
 * useful. Fields that v14 added are optional so v13 data still type-checks.
 */

declare global {
  /**
   * PlaylistSoundDocument (common/documents/playlist-sound.mjs:43-54, client/documents/playlist-sound.mjs).
   * The module only reads `id`, `name`, `playing` and permission (src/preflight-scan.ts:308-311).
   */
  interface PlaylistSoundDocument extends FoundryDocument {
    name: string; // common/documents/playlist-sound.mjs:44
    description: string; // common/documents/playlist-sound.mjs:45
    path: string | null; // common/documents/playlist-sound.mjs:46
    /** "music", "environment", "interface" or "" (inherit from the playlist). */
    channel: string; // common/documents/playlist-sound.mjs:47
    playing: boolean; // common/documents/playlist-sound.mjs:48
    pausedTime: number | null; // common/documents/playlist-sound.mjs:49
    repeat: boolean; // common/documents/playlist-sound.mjs:50
    volume: number; // common/documents/playlist-sound.mjs:51
    fade: number | null; // common/documents/playlist-sound.mjs:52
    sort: number; // common/documents/playlist-sound.mjs:53
    readonly fadeDuration: number; // client/documents/playlist-sound.mjs:75
  }

  /**
   * PlaylistDocument (common/documents/playlist.mjs:43-60, client/documents/playlist.mjs). Used through
   * `game.playlists` (src/data-access/scene-fx.ts:25, src/data-access/ref-choices.ts:400,
   * src/preflight-scan.ts:302). `game.playlists` is a FoundryCollection<PlaylistDocument>.
   * (v13 note) unchanged: schemaVersion is still 13.341.
   */
  interface PlaylistDocument extends FoundryWorldDocument {
    description: string; // common/documents/playlist.mjs:45
    readonly sounds: FoundryCollection<PlaylistSoundDocument>; // common/documents/playlist.mjs:46
    channel: string; // common/documents/playlist.mjs:47
    /** CONST.PLAYLIST_MODES: DISABLED -1, SEQUENTIAL 0, SHUFFLE 1, SIMULTANEOUS 2. */
    mode: number; // common/documents/playlist.mjs:48
    playing: boolean; // common/documents/playlist.mjs:50
    fade: number | null; // common/documents/playlist.mjs:51
    sorting: string; // common/documents/playlist.mjs:53
    seed: number | null; // common/documents/playlist.mjs:56
    sort: number; // common/documents/playlist.mjs:57
    readonly visible: boolean; // client/documents/playlist.mjs:60
    readonly playbackOrder: string[]; // client/documents/playlist.mjs:33
    playAll(): Promise<this>; // client/documents/playlist.mjs:91
    stopAll(): Promise<this>; // client/documents/playlist.mjs:198
    playSound(sound: PlaylistSoundDocument): Promise<this>; // client/documents/playlist.mjs:161
    stopSound(sound: PlaylistSoundDocument): Promise<this>; // client/documents/playlist.mjs:185
  }

  /**
   * RollTable (common/documents/roll-table.mjs:49-61). `game.tables` is only used by the live sweep
   * (src/live-sweep.ts:109) to find and delete tables by name; nothing else is read.
   */
  interface TableResultDocument extends FoundryDocument {
    /** CONST.TABLE_RESULT_TYPES: "text" or "document" (strings). */
    readonly type: string; // common/documents/table-result.mjs:49
    name: string; // common/documents/table-result.mjs:50
    description: string; // common/documents/table-result.mjs:52
    documentUuid: string | null; // common/documents/table-result.mjs:53
    weight: number; // common/documents/table-result.mjs:54
    range: [number, number]; // common/documents/table-result.mjs:55
    drawn: boolean; // common/documents/table-result.mjs:61
  }

  interface RollTableDocument extends FoundryWorldDocument {
    img: string; // common/documents/roll-table.mjs:51
    description: string; // common/documents/roll-table.mjs:52
    readonly results: FoundryCollection<TableResultDocument>; // common/documents/roll-table.mjs:53
    formula: string; // common/documents/roll-table.mjs:54
    replacement: boolean; // common/documents/roll-table.mjs:55
    displayRoll: boolean; // common/documents/roll-table.mjs:56
    roll(
      options?: Record<string, unknown>
    ): Promise<{ roll: Roll; results: TableResultDocument[] }>; // client/documents/roll-table.mjs:264
    draw(
      options?: Record<string, unknown>
    ): Promise<{ roll: Roll; results: TableResultDocument[] }>; // client/documents/roll-table.mjs:98
  }
}

export {};
