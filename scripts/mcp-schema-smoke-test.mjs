import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'packages', 'mcp-server', 'dist');

const fail = (message) => {
  console.error(`\n[MCP Schema Smoke Test] ${message}`);
  process.exit(1);
};

if (!fs.existsSync(distDir)) {
  fail(
    `Build output not found at ${distDir}. Run "npm -w @gnuminator/mcp-server run build" and re-run this test.`,
  );
}

const importDist = async (relativePath) =>
  import(pathToFileURL(path.join(distDir, relativePath)).href);

const [{ config }, { Logger }, { FoundryClient }, { CharacterTools }, { CompendiumTools }, { SceneTools },
  { ActorCreationTools }, { QuestCreationTools }, { DiceRollTools }, { CampaignManagementTools },
  { OwnershipTools }, { TokenManipulationTools },
  { ChatLogTools }, { ResourceTools }, { EffectsTools }, { CombatTools }, { MovementTools },
  { SessionLogTools }, { CombatResolutionTools }, { EncounterTools }, { SceneChangeTools },
  { DiagnosticsTools }, { GuardedChangeTools }, { TarokkaTools }, { getSystemRegistry },
  { DnD5eAdapter }] = await Promise.all([
  importDist('config.js'),
  importDist('logger.js'),
  importDist('foundry-client.js'),
  importDist('tools/character.js'),
  importDist('tools/compendium.js'),
  importDist('tools/scene.js'),
  importDist('tools/actor-creation.js'),
  importDist('tools/quest-creation.js'),
  importDist('tools/dice-roll.js'),
  importDist('tools/campaign-management.js'),
  importDist('tools/ownership.js'),
  importDist('tools/token-manipulation.js'),
  importDist('tools/chat-log.js'),
  importDist('tools/resources.js'),
  importDist('tools/effects.js'),
  importDist('tools/combat.js'),
  importDist('tools/movement.js'),
  importDist('tools/session-log.js'),
  importDist('tools/combat-resolution.js'),
  importDist('tools/encounter.js'),
  importDist('tools/scene-change.js'),
  importDist('tools/diagnostics.js'),
  importDist('tools/guarded-changes.js'),
  importDist('tools/tarokka.js'),
  importDist('systems/index.js'),
  importDist('systems/dnd5e/adapter.js'),
]);

const logger = new Logger({ level: 'error', enableConsole: false, enableFile: false });
const foundryClient = new FoundryClient(config.foundry, logger);

const systemRegistry = getSystemRegistry(logger);
systemRegistry.register(new DnD5eAdapter());

const tools = [
  ...new CharacterTools({ foundryClient, logger, systemRegistry }).getToolDefinitions(),
  ...new CompendiumTools({ foundryClient, logger, systemRegistry }).getToolDefinitions(),
  ...new SceneTools({ foundryClient, logger }).getToolDefinitions(),
  ...new ActorCreationTools({ foundryClient, logger }).getToolDefinitions(),
  ...new QuestCreationTools({ foundryClient, logger }).getToolDefinitions(),
  ...new DiceRollTools({ foundryClient, logger }).getToolDefinitions(),
  ...new CampaignManagementTools(foundryClient, logger).getToolDefinitions(),
  ...new OwnershipTools({ foundryClient, logger }).getToolDefinitions(),
  ...new TokenManipulationTools({ foundryClient, logger }).getToolDefinitions(),
  ...new ChatLogTools({ foundryClient, logger }).getToolDefinitions(),
  ...new ResourceTools({ foundryClient, logger }).getToolDefinitions(),
  ...new EffectsTools({ foundryClient, logger }).getToolDefinitions(),
  ...new CombatTools({ foundryClient, logger }).getToolDefinitions(),
  ...new MovementTools({ foundryClient, logger }).getToolDefinitions(),
  ...new SessionLogTools({ foundryClient, logger }).getToolDefinitions(),
  ...new CombatResolutionTools({ foundryClient, logger }).getToolDefinitions(),
  ...new EncounterTools({ foundryClient, logger }).getToolDefinitions(),
  ...new SceneChangeTools({ foundryClient, guardedWrites: {}, logger }).getToolDefinitions(),
  ...new DiagnosticsTools({ foundryClient, logger }).getToolDefinitions(),
  ...new GuardedChangeTools({ guardedWrites: {}, foundryClient, logger }).getToolDefinitions(),
  ...new TarokkaTools({ tarokka: {}, logger }).getToolDefinitions(),
];

if (!tools.length) {
  fail('No tools were loaded from the runtime tool registry.');
}

const objectSchemas = [];
for (const tool of tools) {
  if (!tool.inputSchema || tool.inputSchema.type !== 'object') {
    fail(`Tool "${tool.name}" does not define an inputSchema of type "object".`);
  }
  objectSchemas.push({ tool, schema: tool.inputSchema });
}

const additionalPropertiesFalseCount = objectSchemas.filter(
  ({ schema }) => schema.additionalProperties === false,
).length;

if (additionalPropertiesFalseCount === objectSchemas.length) {
  fail(
    'Every tool schema has additionalProperties=false. This indicates schema normalization is forcing strictness globally.',
  );
}

const switchSceneSchema = tools.find((tool) => tool.name === 'switch-scene')?.inputSchema;
if (!switchSceneSchema) {
  fail('Expected tool "switch-scene" to be present but it was not found.');
}

if (switchSceneSchema.additionalProperties === false) {
  fail(
    'Tool "switch-scene" schema sets additionalProperties=false. This can reject alias parameters like "sceneId" and breaks client compatibility.',
  );
}

console.log('[MCP Schema Smoke Test] PASS: tool schemas load, use object input, and do not enforce global additionalProperties=false.');

// MCP prompts (the ready-made "/" prompts): the built module lists the six locked names and
// serves each one as a single user message. (prompts.test.ts checks every tool name against the
// full catalog; the standalone smoke test checks them against a running backend.)
const { listPrompts, getPrompt } = await importDist('prompts/index.js');

const LOCKED_PROMPTS = [
  'prep-next-session',
  'rules-question',
  'session-recap',
  'npc-improv',
  'encounter-check',
  'reveal-handout',
];
const listed = listPrompts();
if (JSON.stringify(listed.map((p) => p.name)) !== JSON.stringify(LOCKED_PROMPTS)) {
  fail(`Prompt names changed: expected ${LOCKED_PROMPTS.join(', ')} but got ${listed.map((p) => p.name).join(', ')}.`);
}

for (const prompt of listed) {
  const args = {};
  for (const arg of prompt.arguments) if (arg.required) args[arg.name] = 'smoke test value';

  const result = getPrompt(prompt.name, args);
  const message = result.messages?.[0];
  if (result.messages?.length !== 1 || message?.role !== 'user' || message?.content?.type !== 'text') {
    fail(`Prompt "${prompt.name}" did not return exactly one user text message.`);
  }
  // En dash, em dash and horizontal bar, built from code points so this file contains none of them.
  if (new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0x2015)}]`).test(message.content.text)) {
    fail(`Prompt "${prompt.name}" contains a dash character that the project forbids.`);
  }

  for (const arg of prompt.arguments.filter((a) => a.required)) {
    let refused = false;
    try {
      getPrompt(prompt.name, {});
    } catch {
      refused = true;
    }
    if (!refused) fail(`Prompt "${prompt.name}" accepted a missing required argument "${arg.name}".`);
  }
}

console.log(`[MCP Schema Smoke Test] PASS: ${listed.length} prompts list and build (${LOCKED_PROMPTS.join(', ')}).`);
