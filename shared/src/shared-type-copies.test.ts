/**
 * Ratchet (pick R13): a wire type has one definition, in `shared/src`. A package that declares an
 * interface or type alias with the same name as one in `shared` is a second copy that can drift.
 * The list below is the copies that still exist; it may only shrink. A new copy fails this test:
 * import the type from `@gnuminator/shared` instead (`import type` in the module, which the
 * browser cannot load the package for).
 *
 * Deliberate copies stay on the list with a reason, e.g. the bot's `space-status.ts` (contract test).
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DECLARATION = /^(?:export\s+)?(?:declare\s+)?(?:interface|type)\s+([A-Z]\w*)/gm;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'build'].includes(entry.name) || entry.name.startsWith('.')) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

function declaredNames(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(DECLARATION)].map(m => m[1] ?? '');
}

/** `name @ path` for every type declared in a package that shared also declares. */
function copies(): string[] {
  const sharedNames = new Set(sourceFiles(join(ROOT, 'shared/src')).flatMap(declaredNames));
  const found: string[] = [];
  for (const pkg of readdirSync(join(ROOT, 'packages'), { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    for (const file of sourceFiles(join(ROOT, 'packages', pkg.name))) {
      for (const name of declaredNames(file)) {
        if (sharedNames.has(name)) {
          found.push(`${name} @ ${relative(ROOT, file).replace(/\\/g, '/')}`);
        }
      }
    }
  }
  return found.sort();
}

const KNOWN_COPIES: string[] = [
  'BridgeStatus @ packages/cogm-dashboard/src/feed/types.ts',
  'BridgeStatus @ packages/cogm-dashboard/web/src/lib/stream.ts',
  'BridgeStatus @ packages/foundry-module/src/main.ts',
  'CallToolParams @ packages/mcp-server/src/types/server-types.ts',
  'ChangeJournalDocument @ packages/foundry-module/src/change-journal-types.ts',
  'ChangeJournalOptions @ packages/foundry-module/src/change-journal-types.ts',
  'ChangeJournalResponse @ packages/foundry-module/src/change-journal-types.ts',
  'ChangeOp @ packages/foundry-module/src/change-journal-types.ts',
  'ChangeWriteMode @ packages/foundry-module/src/change-journal-types.ts',
  'CharacterEffect @ packages/foundry-module/src/data-access/types.ts',
  'CharacterInfo @ packages/foundry-module/src/data-access/types.ts',
  'CompendiumSearchResult @ packages/foundry-module/src/data-access/types.ts',
  'ControlRequest @ packages/mcp-server/src/control-ping.ts',
  'GuardedApplyOutcome @ packages/foundry-module/src/data-access/guarded-write.ts',
  'GuardedApplyRequest @ packages/foundry-module/src/data-access/guarded-write.ts',
  'GuardedApplyResult @ packages/foundry-module/src/data-access/guarded-write.ts',
  'GuardedCreateOp @ packages/foundry-module/src/data-access/guarded-write.ts',
  'GuardedDeleteOp @ packages/foundry-module/src/data-access/guarded-write.ts',
  'GuardedOpResult @ packages/foundry-module/src/data-access/guarded-write.ts',
  'GuardedUpdateOp @ packages/foundry-module/src/data-access/guarded-write.ts',
  'ModuleRequestTool @ packages/foundry-module/src/constants.ts',
  'OpSnapshot @ packages/foundry-module/src/data-access/guarded-write.ts',
  'PartyGroup @ packages/cogm-dashboard/web/src/panels/Party.tsx',
  'PartyMember @ packages/cogm-dashboard/web/src/panels/Party.tsx',
  'PartyState @ packages/cogm-dashboard/web/src/panels/Party.tsx',
  'PathValue @ packages/foundry-module/src/data-access/guarded-write.ts',
  'PlayerHandout @ packages/mcp-server/src/handouts/service.ts',
  'PortraitType @ packages/foundry-module/src/player-portrait.ts',
  'PreflightCheck @ packages/cogm-dashboard/web/src/panels/Preflight.tsx',
  'PreflightScan @ packages/cogm-dashboard/web/src/panels/Preflight.tsx',
  'PrepDigest @ packages/cogm-dashboard/web/src/panels/Prep.tsx',
  'PrepLastSession @ packages/cogm-dashboard/web/src/panels/Prep.tsx',
  'PrepNextSession @ packages/cogm-dashboard/web/src/panels/Prep.tsx',
  'RefChoice @ packages/cogm-dashboard/web/src/lib/toolForm.ts',
  'RefChoice @ packages/foundry-module/src/data-access/ref-choices.ts',
  'RefChoicesResult @ packages/foundry-module/src/data-access/ref-choices.ts',
  'RefFilter @ packages/foundry-module/src/data-access/ref-choices.ts',
  'RulesTag @ packages/foundry-module/src/systems/dnd5e/rules-version.ts',
  'RulesVersion @ packages/foundry-module/src/systems/dnd5e/rules-version.ts',
  'SanitizeUsageOptions @ packages/foundry-module/src/usage-recorder.ts',
  'SceneNote @ packages/foundry-module/src/data-access/types.ts',
  'SceneToken @ packages/cogm-dashboard/web/src/lib/startCombat.ts',
  'SceneToken @ packages/foundry-module/src/data-access/types.ts',
  // The bot's copy is deliberate and pinned by a contract test.
  'SpaceDisk @ packages/discord-bot/src/space-status.ts',
  'SpaceLastJob @ packages/discord-bot/src/space-status.ts',
  'SpaceLevel @ packages/discord-bot/src/space-status.ts',
  'SpaceReaderOptions @ packages/discord-bot/src/space-status.ts',
  'SpaceReading @ packages/discord-bot/src/space-status.ts',
  'SpaceStatus @ packages/cogm-dashboard/web/src/panels/ModuleDiagnostics.tsx',
  'SpaceStatus @ packages/discord-bot/src/space-status.ts',
  'SpaceUnavailableReason @ packages/discord-bot/src/space-status.ts',
  'TokenDetails @ packages/foundry-module/src/data-access/scenes-tokens.ts',
  'ToolRef @ packages/cogm-dashboard/web/src/lib/toolForm.ts',
  'UsageEvent @ packages/foundry-module/src/usage-recorder.ts',
  'UsageKind @ packages/cogm-dashboard/web/src/lib/usage.ts',
  'UsageKind @ packages/foundry-module/src/usage-recorder.ts',
  'UsageOutcome @ packages/foundry-module/src/usage-recorder.ts',
  'UsageRecordsResponse @ packages/foundry-module/src/usage-recorder.ts',
  'UsageRole @ packages/foundry-module/src/usage-recorder.ts',
  'UsageSurface @ packages/foundry-module/src/usage-recorder.ts',
  'UsageWho @ packages/foundry-module/src/usage-recorder.ts',
  'WorldUser @ packages/foundry-module/src/data-access/types.ts',
];

describe('one definition per wire type', () => {
  it('has no type copy beyond the known list', () => {
    const fresh = copies().filter(c => !KNOWN_COPIES.includes(c));
    expect(fresh).toEqual([]);
  });

  it('keeps the known list free of copies that are gone', () => {
    const now = new Set(copies());
    expect(KNOWN_COPIES.filter(c => !now.has(c))).toEqual([]);
  });
});
