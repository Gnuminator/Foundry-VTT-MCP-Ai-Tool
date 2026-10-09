/**
 * Scene-embedded documents besides tokens and regions: notes (map pins), walls, lights.
 *
 * Foundry VTT 14.368 shapes. Trailing comments are source refs relative to the Foundry app
 * folder (`common/`, `client/`). Schema fields are declared in full; client methods only where
 * useful. Fields that v14 added are optional so v13 data still type-checks.
 */

declare global {
  /** CONST.TEXT_ANCHOR_POINTS (common/constants.mjs): CENTER 0, BOTTOM 1, TOP 2, LEFT 3, RIGHT 4. */
  type FoundryTextAnchorPoint = 0 | 1 | 2 | 3 | 4;

  /**
   * NoteDocument (map pin; common/documents/note.mjs:43-65, client/documents/note.mjs).
   * v14 added `author`, `elevation` and `levels` (Scene Levels); there is no `label` field,
   * `label` is a derived getter. `texture` is a TextureData.
   */
  interface NoteDocument extends FoundryDocument {
    /** The user who placed the pin (v14, nullable). (v13 note) no `author` in v13. */
    readonly author: User | null; // common/documents/note.mjs:44
    entryId: string | null; // common/documents/note.mjs:45
    pageId: string | null; // common/documents/note.mjs:46
    x: number; // common/documents/note.mjs:47
    y: number; // common/documents/note.mjs:48
    /** v14 only. */
    elevation?: number; // common/documents/note.mjs:49
    /** v14 only: ids of the Scene Levels the pin shows on (empty = every level). Set at runtime, array in `_source`. */
    levels?: Set<string>; // common/documents/note.mjs:50
    sort: number; // common/documents/note.mjs:51
    locked: boolean; // common/documents/note.mjs:52
    texture: FoundryTextureData; // common/documents/note.mjs:53
    iconSize: number; // common/documents/note.mjs:55
    /** The label text; empty string when the pin uses the journal name instead. */
    text: string; // common/documents/note.mjs:57
    fontFamily: string; // common/documents/note.mjs:58
    fontSize: number; // common/documents/note.mjs:59
    textAnchor: FoundryTextAnchorPoint; // common/documents/note.mjs:61
    textColor: FoundryColor; // common/documents/note.mjs:63
    /** Visible at every zoom level (not hidden when zoomed out). */
    global: boolean; // common/documents/note.mjs:64
    /** Always false on a note (client field, not in the schema; Note has no hidden flag). */
    hidden: boolean; // client/documents/note.mjs:81
    /** The linked JournalEntry (game.journal.get(entryId)). */
    readonly entry: JournalEntry | undefined; // client/documents/note.mjs:87
    readonly page: JournalEntryPage | undefined; // client/documents/note.mjs:97
    /** text, else page name, else entry name, else localized "Unknown". */
    readonly label: string; // client/documents/note.mjs:107
    readonly isAuthor: boolean; // client/documents/note.mjs:117
  }

  /** CONST.EDGE_SENSE_TYPES: NONE 0, LIMITED 10, NORMAL 20, PROXIMITY 30, DISTANCE 40. */
  type FoundryEdgeSenseType = 0 | 10 | 20 | 30 | 40;
  /** CONST.WALL_MOVEMENT_TYPES: NONE 0, NORMAL 20. */
  type FoundryWallMovementType = 0 | 20;
  /** CONST.EDGE_DIRECTIONS: BOTH 0, LEFT 1, RIGHT 2. */
  type FoundryEdgeDirection = 0 | 1 | 2;
  /** CONST.WALL_DOOR_TYPES: NONE 0, DOOR 1, SECRET 2. CONST.WALL_DOOR_STATES: CLOSED 0, OPEN 1, LOCKED 2. */

  /**
   * WallDocument (common/documents/wall.mjs:53-95, client/documents/wall.mjs). The module only
   * counts walls (`scene.walls.size`, `.contents.length`) and lists them for the change journal;
   * no member is read.
   * v14 added `levels` and made the sense fields share EDGE_SENSE_TYPES. `hidden`/`locked` are fixed client fields.
   */
  interface WallDocument extends FoundryDocument {
    /** [x1, y1, x2, y2] in integer pixels. */
    c: [number, number, number, number]; // common/documents/wall.mjs:54
    /** v14 only: Scene Level ids the wall exists on. */
    levels?: Set<string>; // common/documents/wall.mjs:57
    light: FoundryEdgeSenseType; // common/documents/wall.mjs:58
    move: FoundryWallMovementType; // common/documents/wall.mjs:61
    sight: FoundryEdgeSenseType; // common/documents/wall.mjs:64
    sound: FoundryEdgeSenseType; // common/documents/wall.mjs:67
    dir: FoundryEdgeDirection; // common/documents/wall.mjs:70
    door: 0 | 1 | 2; // common/documents/wall.mjs:73
    ds: 0 | 1 | 2; // common/documents/wall.mjs:76
    doorSound?: string; // common/documents/wall.mjs:79
    threshold: {
      light: number | null;
      sight: number | null;
      sound: number | null;
      attenuation: boolean;
    }; // common/documents/wall.mjs:80
    /** Door animation; null when none. */
    animation: {
      direction: -1 | 1;
      double: boolean;
      duration: number;
      flip: boolean;
      strength: number;
      texture?: string;
      type: string;
    } | null; // common/documents/wall.mjs:86
    readonly hidden: false; // client/documents/wall.mjs:28
    readonly locked: false; // client/documents/wall.mjs:34
    readonly isDoor: boolean; // client/documents/wall.mjs:60
    readonly isOpen: boolean; // client/documents/wall.mjs:68
    readonly darkness: FoundryEdgeSenseType; // client/documents/wall.mjs:52
  }

  /**
   * AmbientLightDocument (common/documents/ambient-light.mjs:35-47, client/documents/ambient-light.mjs).
   * The module only counts lights (`scene.lights.size`, src/data-access/world-reads.ts:69); no member is read.
   * (v13 note) v13 and v14 both use `config` (LightData); v14 added `name`, `elevation` and `levels`.
   */
  interface AmbientLightDocument extends FoundryDocument {
    /** v14 only. */
    name?: string; // common/documents/ambient-light.mjs:36
    x: number; // common/documents/ambient-light.mjs:37
    y: number; // common/documents/ambient-light.mjs:38
    /** v14 only. */
    elevation?: number; // common/documents/ambient-light.mjs:39
    /** v14 only. */
    levels?: Set<string>; // common/documents/ambient-light.mjs:40
    rotation: number; // common/documents/ambient-light.mjs:41
    /** Whether walls block this light. */
    walls: boolean; // common/documents/ambient-light.mjs:42
    /** Whether the light also provides vision. */
    vision: boolean; // common/documents/ambient-light.mjs:43
    config: FoundryLightData; // common/documents/ambient-light.mjs:44
    hidden: boolean; // common/documents/ambient-light.mjs:45
    locked: boolean; // common/documents/ambient-light.mjs:46
    /** Global light: walls == false. */
    readonly isGlobal: boolean; // client/documents/ambient-light.mjs:25
  }
}

export {};
