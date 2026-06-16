/**
 * Shared data-access type definitions.
 *
 * Local (not re-exported from `@gnuminator/shared`) to avoid the shared-package
 * import friction the monolith documented; these describe the shapes the
 * `FoundryDataAccess` facade and its domain modules pass around.
 */

export interface CharacterInfo {
  id: string;
  name: string;
  type: string;
  img?: string;
  system: Record<string, unknown>;
  items: CharacterItem[];
  effects: CharacterEffect[];
  actions?: any[]; // system actions (strikes, spells, etc.)
  itemVariants?: any[]; // Item rule element variants (ChoiceSet, etc.)
  itemToggles?: any[]; // Item rule element toggles (RollOption, ToggleProperty, equipped)
  spellcasting?: SpellcastingEntry[]; // spellcasting entries
}

export interface SpellcastingEntry {
  id: string;
  name: string;
  tradition?: string | undefined; // arcane, divine, etc.
  type: string; // prepared, spontaneous, innate, focus, or class name (5e)
  ability?: string | undefined; // spellcasting ability (int, wis, cha)
  dc?: number | undefined;
  attack?: number | undefined;
  slots?: Record<string, { value: number; max: number }> | undefined; // spell slots per level/rank
  spells: SpellInfo[];
}

export interface SpellInfo {
  id: string;
  name: string;
  level: number; // spell level/rank
  prepared?: boolean | undefined; // for prepared casters
  expended?: boolean | undefined; // has this spell slot been used
  traits?: string[] | undefined;
  actionCost?: string | undefined; // 1, 2, 3, reaction, free
  // Targeting info - helps Claude decide whether to specify targets
  range?: string | undefined; // "touch", "self", "60 feet", etc.
  target?: string | undefined; // "1 creature", "self", "area", etc.
  area?: string | undefined; // "20-foot radius", "30-foot cone", etc. (for template spells)
}

export interface CharacterItem {
  id: string;
  name: string;
  type: string;
  img?: string;
  system: Record<string, unknown>;
}

export interface CharacterEffect {
  id: string;
  name: string;
  icon?: string;
  disabled: boolean;
  duration?: {
    type: string;
    duration?: number;
    remaining?: number;
  };
}

export interface CompendiumSearchResult {
  id: string;
  name: string;
  type: string;
  img?: string;
  pack: string;
  packLabel: string;
  system?: Record<string, unknown>;
  summary?: string;
  hasImage?: boolean;
  description?: string;
}

// D&D 5e Enhanced Creature Index
export interface DnD5eCreatureIndex {
  id: string;
  name: string;
  type: string;
  pack: string;
  packLabel: string;
  challengeRating: number;
  creatureType: string;
  size: string;
  hitPoints: number;
  armorClass: number;
  hasSpells: boolean;
  hasLegendaryActions: boolean;
  alignment: string;
  description?: string;
  img?: string;
}

// D&D 5e is the only supported system
export type EnhancedCreatureIndex = DnD5eCreatureIndex;

export interface PersistentIndexMetadata {
  version: string;
  timestamp: number;
  packFingerprints: Map<string, PackFingerprint>;
  totalCreatures: number;
  gameSystem: string; // 'dnd5e'
}

export interface PackFingerprint {
  packId: string;
  packLabel: string;
  lastModified: number;
  documentCount: number;
  checksum: string;
}

export interface PersistentEnhancedIndex {
  metadata: PersistentIndexMetadata;
  creatures: EnhancedCreatureIndex[];
}

export interface SceneInfo {
  id: string;
  name: string;
  img?: string;
  background?: string;
  width: number;
  height: number;
  padding: number;
  active: boolean;
  navigation: boolean;
  tokens: SceneToken[];
  walls: number;
  lights: number;
  sounds: number;
  notes: SceneNote[];
}

export interface SceneToken {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  actorId?: string;
  img: string;
  hidden: boolean;
  disposition: number;
}

export interface SceneNote {
  id: string;
  text: string;
  x: number;
  y: number;
}

export interface WorldInfo {
  id: string;
  title: string;
  system: string;
  systemVersion: string;
  foundryVersion: string;
  users: WorldUser[];
}

export interface WorldUser {
  id: string;
  name: string;
  active: boolean;
  isGM: boolean;
}

// Phase 2: Write Operation Interfaces
export interface ActorCreationRequest {
  creatureType: string;
  customNames?: string[] | undefined;
  packPreference?: string | undefined;
  quantity?: number | undefined;
  addToScene?: boolean | undefined;
}

export interface ActorCreationResult {
  success: boolean;
  actors: CreatedActorInfo[];
  errors?: string[] | undefined;
  tokensPlaced?: number;
  totalRequested: number;
  totalCreated: number;
}

export interface CreatedActorInfo {
  id: string;
  name: string;
  originalName: string;
  type: string;
  sourcePackId: string;
  sourcePackLabel: string;
  img?: string;
}

export interface CompendiumEntryFull {
  id: string;
  name: string;
  type: string;
  img?: string;
  pack: string;
  packLabel: string;
  system: Record<string, unknown>;
  items?: CompendiumItem[];
  effects?: CompendiumEffect[];
  fullData: Record<string, unknown>;
}

export interface CompendiumItem {
  id: string;
  name: string;
  type: string;
  img?: string;
  system: Record<string, unknown>;
}

export interface CompendiumEffect {
  id: string;
  name: string;
  icon?: string;
  disabled: boolean;
  duration?: Record<string, unknown>;
}

export interface SceneTokenPlacement {
  actorIds: string[];
  placement: 'random' | 'grid' | 'center' | 'coordinates';
  hidden: boolean;
  coordinates?: { x: number; y: number }[];
}

export interface TokenPlacementResult {
  success: boolean;
  tokensCreated: number;
  tokenIds: string[];
  errors?: string[] | undefined;
}
