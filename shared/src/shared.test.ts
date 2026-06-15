/**
 * @gnuminator/shared — parity and contract-guard tests
 *
 * Three categories of coverage:
 *
 *   A. Frozen constants — assert exact wire-contract values. If any of these
 *      fail, the module, backend, and dashboard are no longer in sync.
 *
 *   B. Schema defaults — verify that `.default(…)` values are exactly what
 *      callers rely on (no silent drift from a schema reorganisation).
 *
 *   C. Validation bounds — confirm that out-of-range inputs are rejected and
 *      that sentinel defaults (e.g. `animate:false`) are applied correctly.
 *
 *   D. Round-trip parse — a representative CampaignStructure and
 *      CampaignTemplate must parse cleanly and produce stable output.
 */

import { describe, expect, it } from 'vitest';

import {
  MODULE_ID,
  MODULE_TITLE,
  SOCKET_EVENTS,
  MCP_METHODS,
  DEFAULT_CONFIG,
  CONNECTION_STATES,
  PACK_TYPES,
  TOKEN_DISPOSITIONS,
  ERROR_MESSAGES,
  LOG_LEVELS,
} from './constants.js';

import {
  ScalingOptionsSchema,
  CampaignPartSchema,
  CampaignMetadataSchema,
  CampaignSubPartSchema,
  CampaignStructureSchema,
  CampaignTemplateSchema,
  FoundryMCPConfigSchema,
  LevelRecommendationSchema,
  TokenMoveRequestSchema,
  TokenUpdateSchema,
} from './schemas.js';

// ---------------------------------------------------------------------------
// A. Frozen constant values
// ---------------------------------------------------------------------------

describe('frozen wire-contract constants', () => {
  it('MODULE_ID is the Foundry module identifier', () => {
    expect(MODULE_ID).toBe('foundry-mcp-bridge');
  });

  it('MODULE_TITLE is the human-readable product name', () => {
    expect(MODULE_TITLE).toBe('Foundry MCP Bridge');
  });

  it('SOCKET_EVENTS values match the Foundry-link frame types', () => {
    expect(SOCKET_EVENTS.MCP_QUERY).toBe('mcp-query');
    expect(SOCKET_EVENTS.MCP_RESPONSE).toBe('mcp-response');
    expect(SOCKET_EVENTS.BRIDGE_STATUS).toBe('bridge-status');
    expect(SOCKET_EVENTS.PING).toBe('ping');
    expect(SOCKET_EVENTS.PONG).toBe('pong');
  });

  it('MCP_METHODS values match the CONFIG.queries handler keys', () => {
    expect(MCP_METHODS.GET_CHARACTER_INFO).toBe('getCharacterInfo');
    expect(MCP_METHODS.SEARCH_COMPENDIUM).toBe('searchCompendium');
    expect(MCP_METHODS.GET_SCENE_INFO).toBe('getSceneInfo');
    expect(MCP_METHODS.GET_WORLD_INFO).toBe('getWorldInfo');
    expect(MCP_METHODS.GET_AVAILABLE_PACKS).toBe('getAvailablePacks');
    expect(MCP_METHODS.PING).toBe('ping');
  });

  it('DEFAULT_CONFIG.MCP_PORT is the load-bearing WebSocket port', () => {
    expect(DEFAULT_CONFIG.MCP_PORT).toBe(31415);
  });

  it('DEFAULT_CONFIG other values are unchanged', () => {
    expect(DEFAULT_CONFIG.MCP_HOST).toBe('localhost');
    expect(DEFAULT_CONFIG.CONNECTION_TIMEOUT).toBe(10);
    expect(DEFAULT_CONFIG.RECONNECT_ATTEMPTS).toBe(5);
    expect(DEFAULT_CONFIG.RECONNECT_DELAY).toBe(1000);
    expect(DEFAULT_CONFIG.LOG_LEVEL).toBe('info');
  });

  it('CONNECTION_STATES values match the socket-bridge state machine', () => {
    expect(CONNECTION_STATES.DISCONNECTED).toBe('disconnected');
    expect(CONNECTION_STATES.CONNECTING).toBe('connecting');
    expect(CONNECTION_STATES.CONNECTED).toBe('connected');
    expect(CONNECTION_STATES.RECONNECTING).toBe('reconnecting');
  });

  it('PACK_TYPES values match Foundry DocumentType strings', () => {
    expect(PACK_TYPES.ACTOR).toBe('Actor');
    expect(PACK_TYPES.ITEM).toBe('Item');
    expect(PACK_TYPES.SCENE).toBe('Scene');
    expect(PACK_TYPES.JOURNAL_ENTRY).toBe('JournalEntry');
    expect(PACK_TYPES.MACRO).toBe('Macro');
    expect(PACK_TYPES.ROLL_TABLE).toBe('RollTable');
    expect(PACK_TYPES.PLAYLIST).toBe('Playlist');
    expect(PACK_TYPES.CARDS).toBe('Cards');
  });

  it('TOKEN_DISPOSITIONS values match Foundry CONST.TOKEN_DISPOSITIONS', () => {
    expect(TOKEN_DISPOSITIONS.HOSTILE).toBe(-1);
    expect(TOKEN_DISPOSITIONS.NEUTRAL).toBe(0);
    expect(TOKEN_DISPOSITIONS.FRIENDLY).toBe(1);
  });

  it('ERROR_MESSAGES values are unchanged', () => {
    expect(ERROR_MESSAGES.NOT_INITIALIZED).toBe('Data provider not initialized');
    expect(ERROR_MESSAGES.NOT_CONNECTED).toBe('Not connected to Foundry VTT');
    expect(ERROR_MESSAGES.CHARACTER_NOT_FOUND).toBe('Character not found');
    expect(ERROR_MESSAGES.SCENE_NOT_FOUND).toBe('Scene not found');
    expect(ERROR_MESSAGES.ACCESS_DENIED).toBe('Access denied - feature is disabled');
    expect(ERROR_MESSAGES.QUERY_TIMEOUT).toBe('Query timeout');
    expect(ERROR_MESSAGES.UNKNOWN_METHOD).toBe('Unknown method');
    expect(ERROR_MESSAGES.BRIDGE_NOT_RUNNING).toBe('MCP Bridge is not running');
  });

  it('LOG_LEVELS values are unchanged', () => {
    expect(LOG_LEVELS.ERROR).toBe('error');
    expect(LOG_LEVELS.WARN).toBe('warn');
    expect(LOG_LEVELS.INFO).toBe('info');
    expect(LOG_LEVELS.DEBUG).toBe('debug');
  });
});

// ---------------------------------------------------------------------------
// B. Schema defaults
// ---------------------------------------------------------------------------

describe('schema default values', () => {
  it('ScalingOptionsSchema fills all three defaults from {}', () => {
    const result = ScalingOptionsSchema.parse({});
    expect(result).toEqual({
      adjustForPartySize: true,
      adjustForLevel: true,
      difficultyModifier: 0,
    });
  });

  it('CampaignPartSchema applies status, dependencies, gmNotes, playerContent, scaling defaults', () => {
    const result = CampaignPartSchema.parse({
      id: 'p1',
      title: 'Prologue',
      description: 'The adventure begins.',
      type: 'main_part',
      levelRecommendation: { start: 1, end: 3 },
    });
    expect(result.status).toBe('not_started');
    expect(result.dependencies).toEqual([]);
    expect(result.gmNotes).toBe('');
    expect(result.playerContent).toBe('');
    expect(result.scaling).toEqual({
      adjustForPartySize: true,
      adjustForLevel: true,
      difficultyModifier: 0,
    });
  });

  it('CampaignSubPartSchema defaults status to not_started', () => {
    const result = CampaignSubPartSchema.parse({
      id: 'sp1',
      title: 'Encounter 1',
      description: '',
      type: 'session',
    });
    expect(result.status).toBe('not_started');
  });

  it('CampaignMetadataSchema defaults tags to []', () => {
    const result = CampaignMetadataSchema.parse({});
    expect(result.tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C. Validation bounds
// ---------------------------------------------------------------------------

describe('schema validation bounds', () => {
  it('FoundryMCPConfigSchema rejects mcpPort below 1024', () => {
    const input = {
      enabled: true,
      mcpHost: 'localhost',
      mcpPort: 80,
      connectionTimeout: 10,
      debugLogging: false,
    };
    expect(() => FoundryMCPConfigSchema.parse(input)).toThrow();
  });

  it('FoundryMCPConfigSchema rejects mcpPort above 65535', () => {
    const input = {
      enabled: true,
      mcpHost: 'localhost',
      mcpPort: 99999,
      connectionTimeout: 10,
      debugLogging: false,
    };
    expect(() => FoundryMCPConfigSchema.parse(input)).toThrow();
  });

  it('FoundryMCPConfigSchema accepts port 31415 (the default wire port)', () => {
    const input = {
      enabled: true,
      mcpHost: 'localhost',
      mcpPort: 31415,
      connectionTimeout: 10,
      debugLogging: false,
    };
    expect(() => FoundryMCPConfigSchema.parse(input)).not.toThrow();
  });

  it('LevelRecommendationSchema rejects level 0', () => {
    expect(() => LevelRecommendationSchema.parse({ start: 0, end: 5 })).toThrow();
  });

  it('LevelRecommendationSchema rejects level 21', () => {
    expect(() => LevelRecommendationSchema.parse({ start: 1, end: 21 })).toThrow();
  });

  it('LevelRecommendationSchema accepts the full 1–20 range', () => {
    expect(() => LevelRecommendationSchema.parse({ start: 1, end: 20 })).not.toThrow();
  });

  it('ScalingOptionsSchema rejects difficultyModifier below -2', () => {
    expect(() => ScalingOptionsSchema.parse({ difficultyModifier: -3 })).toThrow();
  });

  it('ScalingOptionsSchema rejects difficultyModifier above 2', () => {
    expect(() => ScalingOptionsSchema.parse({ difficultyModifier: 3 })).toThrow();
  });

  it('ScalingOptionsSchema accepts boundary values -2 and 2', () => {
    expect(() => ScalingOptionsSchema.parse({ difficultyModifier: -2 })).not.toThrow();
    expect(() => ScalingOptionsSchema.parse({ difficultyModifier: 2 })).not.toThrow();
  });

  it('TokenMoveRequestSchema defaults animate to false when omitted', () => {
    const result = TokenMoveRequestSchema.parse({ tokenId: 't1', x: 100, y: 200 });
    expect(result.animate).toBe(false);
  });

  it('TokenMoveRequestSchema preserves animate:true when supplied', () => {
    const result = TokenMoveRequestSchema.parse({ tokenId: 't1', x: 0, y: 0, animate: true });
    expect(result.animate).toBe(true);
  });

  it('TokenUpdateSchema rejects rotation outside 0–360', () => {
    expect(() => TokenUpdateSchema.parse({ tokenId: 't1', updates: { rotation: 400 } })).toThrow();
    expect(() => TokenUpdateSchema.parse({ tokenId: 't1', updates: { rotation: -1 } })).toThrow();
  });

  it('TokenUpdateSchema rejects non-positive width and height', () => {
    expect(() => TokenUpdateSchema.parse({ tokenId: 't1', updates: { width: 0 } })).toThrow();
    expect(() => TokenUpdateSchema.parse({ tokenId: 't1', updates: { height: -2 } })).toThrow();
  });

  it('TokenUpdateSchema accepts all three disposition literals', () => {
    for (const d of [-1, 0, 1] as const) {
      expect(() =>
        TokenUpdateSchema.parse({ tokenId: 't1', updates: { disposition: d } })
      ).not.toThrow();
    }
  });

  it('TokenUpdateSchema rejects an invalid disposition value', () => {
    expect(() => TokenUpdateSchema.parse({ tokenId: 't1', updates: { disposition: 2 } })).toThrow();
  });

  it('CampaignPartSchema rejects empty title', () => {
    expect(() =>
      CampaignPartSchema.parse({
        id: 'p1',
        title: '',
        description: 'desc',
        type: 'chapter',
        levelRecommendation: { start: 1, end: 3 },
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// D. Round-trip parse
// ---------------------------------------------------------------------------

describe('round-trip parse', () => {
  const now = Date.now();

  const minimalPart = {
    id: 'p1',
    title: 'The Gathering Dark',
    description: 'Act 1 of the campaign.',
    type: 'main_part' as const,
    levelRecommendation: { start: 1, end: 4 },
  };

  it('CampaignStructureSchema round-trips a minimal campaign', () => {
    const input = {
      id: 'cs1',
      title: 'Curse of the Hollow King',
      description: 'A gothic horror campaign for five players.',
      parts: [minimalPart],
      metadata: { tags: ['horror', 'mystery'] },
      createdAt: now,
      updatedAt: now,
    };

    const result = CampaignStructureSchema.parse(input);

    expect(result.id).toBe('cs1');
    expect(result.title).toBe('Curse of the Hollow King');
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].status).toBe('not_started');
    expect(result.parts[0].dependencies).toEqual([]);
    expect(result.parts[0].scaling.difficultyModifier).toBe(0);
    expect(result.metadata.tags).toEqual(['horror', 'mystery']);
    expect(result.createdAt).toBe(now);
    expect(result.updatedAt).toBe(now);
  });

  it('CampaignStructureSchema round-trips a campaign with sub-parts and a quest giver', () => {
    const input = {
      id: 'cs2',
      title: 'The Iron Throne War',
      description: 'A political intrigue campaign.',
      parts: [
        {
          ...minimalPart,
          id: 'p2',
          title: 'Opening Moves',
          status: 'in_progress' as const,
          dependencies: [],
          questGiver: { id: 'npc1', name: 'Lady Mira', actorId: 'actor-abc' },
          subParts: [
            {
              id: 'sp1',
              title: 'The Gala',
              description: 'Attend the royal gala.',
              type: 'session' as const,
            },
          ],
          scaling: { adjustForPartySize: false, adjustForLevel: true, difficultyModifier: 1 },
        },
      ],
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };

    const result = CampaignStructureSchema.parse(input);

    expect(result.parts[0].status).toBe('in_progress');
    expect(result.parts[0].questGiver?.name).toBe('Lady Mira');
    expect(result.parts[0].subParts).toHaveLength(1);
    expect(result.parts[0].subParts![0].status).toBe('not_started');
    expect(result.parts[0].scaling.adjustForPartySize).toBe(false);
    expect(result.parts[0].scaling.difficultyModifier).toBe(1);
    expect(result.metadata.tags).toEqual([]); // default applied
  });

  it('CampaignTemplateSchema round-trips a five-part template', () => {
    const input = {
      id: 'tpl1',
      name: 'Five-Part Adventure',
      description: 'Classic three-act structure expanded to five beats.',
      parts: [
        {
          title: 'The Call to Adventure',
          description: 'Hook the party.',
          type: 'main_part' as const,
          dependencies: [],
          levelRecommendation: { start: 1, end: 2 },
        },
        {
          title: 'Rising Tension',
          description: 'Complications arise.',
          type: 'main_part' as const,
          dependencies: ['0'],
          levelRecommendation: { start: 3, end: 5 },
          subParts: [
            { title: 'Side Quest', description: 'Optional branch.', type: 'optional' as const },
          ],
        },
      ],
      metadata: { theme: 'classic fantasy' },
    };

    const result = CampaignTemplateSchema.parse(input);

    expect(result.id).toBe('tpl1');
    expect(result.parts).toHaveLength(2);
    expect(result.parts[0].dependencies).toEqual([]);
    expect(result.parts[1].dependencies).toEqual(['0']);
    expect(result.parts[1].subParts).toHaveLength(1);
    expect(result.metadata.theme).toBe('classic fantasy');
    // Partial metadata — tags should be absent (no default applied on .partial())
    expect((result.metadata as { tags?: string[] }).tags).toBeUndefined();
  });
});
