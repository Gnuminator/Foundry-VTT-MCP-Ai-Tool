import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignManagementTools } from './campaign-management.js';

/**
 * Tests for CampaignManagementTools — a thin layer over FoundryClient.query that:
 *   1. Validates args with inline zod schema (uses CampaignPartTypeSchema from @gnuminator/shared)
 *   2. Builds campaign structure from a template (or custom parts)
 *   3. Dispatches `foundry-mcp-bridge.createJournalEntry`
 *   4. On any failure routes through ErrorHandler.handleToolError → always throws
 *
 * NOTE: Constructor is POSITIONAL — new CampaignManagementTools(foundryClient, logger)
 * (not an options object like CombatTools / MovementTools).
 */

function makeTools(queryImpl?: (method: string, data: unknown) => unknown) {
  const query = vi.fn(
    queryImpl ??
      (() => ({
        success: true,
        id: 'journal-id-123',
        name: 'Test Campaign - Campaign Dashboard',
      }))
  );
  const foundryClient = { query } as any;
  // Minimal Logger stub: `.child()` returns itself; level methods are no-ops.
  const logger: any = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  logger.child = () => logger;
  // Positional constructor: (foundryClient, logger)
  return { tools: new CampaignManagementTools(foundryClient, logger), query };
}

// Minimal valid args for the happy path
const VALID_ARGS = {
  campaignTitle: 'The Whisperstone Conspiracy',
  campaignDescription: 'A dark mystery set in a haunted city',
  template: 'five-part-adventure',
} as const;

// ---------------------------------------------------------------------------
// getToolDefinitions
// ---------------------------------------------------------------------------

describe('CampaignManagementTools.getToolDefinitions', () => {
  it('exposes exactly one tool: create-campaign-dashboard', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('create-campaign-dashboard');
  });

  it('has an object inputSchema', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect((defs[0].inputSchema as any).type).toBe('object');
  });

  it('requires campaignTitle, campaignDescription, and template', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    expect((defs[0].inputSchema as any).required).toEqual([
      'campaignTitle',
      'campaignDescription',
      'template',
    ]);
  });

  it('template property enumerates the five expected values', () => {
    const { tools } = makeTools();
    const defs = tools.getToolDefinitions();
    const templateProp = (defs[0].inputSchema as any).properties.template;
    expect(templateProp.enum).toEqual([
      'five-part-adventure',
      'dungeon-crawl',
      'investigation',
      'sandbox',
      'custom',
    ]);
  });
});

// ---------------------------------------------------------------------------
// handleCreateCampaignDashboard — happy-path dispatch
// ---------------------------------------------------------------------------

describe('CampaignManagementTools.handleCreateCampaignDashboard — dispatch', () => {
  it('dispatches foundry-mcp-bridge.createJournalEntry with the correct name and folderName', async () => {
    const { tools, query } = makeTools();
    await tools.handleCreateCampaignDashboard(VALID_ARGS);

    expect(query).toHaveBeenCalledOnce();
    const [method, params] = query.mock.calls[0] as [string, any];
    expect(method).toBe('foundry-mcp-bridge.createJournalEntry');
    expect(params.name).toBe('The Whisperstone Conspiracy - Campaign Dashboard');
    expect(params.folderName).toBe('The Whisperstone Conspiracy');
    // content is generated HTML — just confirm it is a non-empty string
    expect(typeof params.content).toBe('string');
    expect(params.content.length).toBeGreaterThan(0);
  });

  it('returns success:true with campaignId, dashboardJournalId, and a message', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateCampaignDashboard(VALID_ARGS);

    expect(result.success).toBe(true);
    expect(result.dashboardJournalId).toBe('journal-id-123');
    expect(typeof result.campaignId).toBe('string');
    expect(result.message).toContain('The Whisperstone Conspiracy');
  });

  it('includes the generated campaignStructure in the response', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateCampaignDashboard(VALID_ARGS);

    expect(result.campaignStructure).toBeDefined();
    expect(result.campaignStructure.title).toBe('The Whisperstone Conspiracy');
    expect(Array.isArray(result.campaignStructure.parts)).toBe(true);
  });

  it('five-part-adventure template yields 5 parts', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateCampaignDashboard({
      ...VALID_ARGS,
      template: 'five-part-adventure',
    });
    expect(result.campaignStructure.parts).toHaveLength(5);
  });

  it('dungeon-crawl template yields 4 parts', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateCampaignDashboard({
      ...VALID_ARGS,
      template: 'dungeon-crawl',
    });
    expect(result.campaignStructure.parts).toHaveLength(4);
  });

  it('investigation template yields 5 parts', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateCampaignDashboard({
      ...VALID_ARGS,
      template: 'investigation',
    });
    expect(result.campaignStructure.parts).toHaveLength(5);
  });

  it('sandbox template yields 4 parts', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateCampaignDashboard({
      ...VALID_ARGS,
      template: 'sandbox',
    });
    expect(result.campaignStructure.parts).toHaveLength(4);
  });

  it('passes optional defaultQuestGiver and defaultLocation through to the structure', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateCampaignDashboard({
      ...VALID_ARGS,
      defaultQuestGiver: 'Elder Mira',
      defaultLocation: 'Whisperstone City',
    });
    expect(result.campaignStructure.metadata.defaultQuestGiver?.name).toBe('Elder Mira');
    expect(result.campaignStructure.metadata.defaultLocation).toBe('Whisperstone City');
  });

  it('accepts custom template with customParts and uses them directly', async () => {
    const { tools } = makeTools();
    const customParts = [
      {
        title: 'Prologue',
        description: 'The adventure begins',
        type: 'main_part',
        levelStart: 1,
        levelEnd: 3,
      },
      {
        title: 'The Rising',
        description: 'Danger escalates',
        type: 'main_part',
        levelStart: 3,
        levelEnd: 6,
      },
    ];
    const result = await tools.handleCreateCampaignDashboard({
      campaignTitle: 'Custom Campaign',
      campaignDescription: 'A custom adventure',
      template: 'custom',
      customParts,
    });
    expect(result.campaignStructure.parts).toHaveLength(2);
    expect(result.campaignStructure.parts[0].title).toBe('Prologue');
    expect(result.campaignStructure.parts[1].title).toBe('The Rising');
  });

  it('only dispatches one query (storeCampaignStructure does not call foundryClient)', async () => {
    const { tools, query } = makeTools();
    await tools.handleCreateCampaignDashboard(VALID_ARGS);
    expect(query).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// handleCreateCampaignDashboard — failure handling (always throws, never returns string)
// ---------------------------------------------------------------------------

describe('CampaignManagementTools.handleCreateCampaignDashboard — failure handling', () => {
  let consoleErr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('throws when Foundry returns an error field', async () => {
    const { tools } = makeTools(() => ({
      error: 'Failed to create journal',
    }));
    await expect(tools.handleCreateCampaignDashboard(VALID_ARGS)).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws when Foundry returns a falsy result (null)', async () => {
    const { tools } = makeTools(() => null);
    await expect(tools.handleCreateCampaignDashboard(VALID_ARGS)).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws when query itself rejects (connection failure)', async () => {
    const { tools } = makeTools(() => {
      throw new Error('connection refused');
    });
    await expect(tools.handleCreateCampaignDashboard(VALID_ARGS)).rejects.toThrow();
    consoleErr.mockRestore();
  });

  it('throws (not returns string) on zod validation failure — missing campaignTitle', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleCreateCampaignDashboard({
        campaignDescription: 'desc',
        template: 'five-part-adventure',
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws (not returns string) on zod validation failure — missing template', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleCreateCampaignDashboard({
        campaignTitle: 'My Campaign',
        campaignDescription: 'desc',
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws (not returns string) on zod validation failure — invalid template enum', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleCreateCampaignDashboard({
        campaignTitle: 'My Campaign',
        campaignDescription: 'desc',
        template: 'not-a-valid-template',
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws (not returns string) on zod validation failure — empty campaignTitle string', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleCreateCampaignDashboard({
        campaignTitle: '',
        campaignDescription: 'desc',
        template: 'five-part-adventure',
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('throws (not returns string) on zod validation failure — invalid customParts type field', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleCreateCampaignDashboard({
        campaignTitle: 'My Campaign',
        campaignDescription: 'desc',
        template: 'custom',
        customParts: [
          {
            title: 'Part 1',
            description: 'desc',
            type: 'bad_type', // invalid CampaignPartTypeSchema value
            levelStart: 1,
            levelEnd: 5,
          },
        ],
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    consoleErr.mockRestore();
  });
});
