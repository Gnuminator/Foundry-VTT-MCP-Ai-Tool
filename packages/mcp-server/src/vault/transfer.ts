/**
 * Vault export/import. The vault is not part of Foundry's world backup, so the
 * GM backs it up with these (CLI: `npm run vault -- export <worldId> <file>`).
 *
 * A bundle holds every file of one world as raw text, so an import restores
 * exactly what was exported. Import refuses to overwrite existing files unless
 * asked to, validates every name, and checks each `.json` file's envelope.
 */
import { assertArea, assertFileName, assertWorldId, type VaultArea } from './paths.js';
import type { VaultStore } from './store.js';

export const VAULT_BUNDLE_FORMAT = 'foundry-ai-tool-vault';
export const VAULT_BUNDLE_VERSION = 1;

export interface VaultBundleFile {
  area: VaultArea;
  file: string;
  content: string;
}

export interface VaultBundle {
  format: typeof VAULT_BUNDLE_FORMAT;
  version: number;
  worldId: string;
  exportedAt: string;
  files: VaultBundleFile[];
}

export async function exportWorld(store: VaultStore, worldId: string): Promise<VaultBundle> {
  assertWorldId(worldId);
  await store.flush();
  const files: VaultBundleFile[] = [];
  for (const { area, file } of await store.listAll(worldId)) {
    const content = await store.readRaw(worldId, area, file);
    if (content !== null) files.push({ area, file, content });
  }
  return {
    format: VAULT_BUNDLE_FORMAT,
    version: VAULT_BUNDLE_VERSION,
    worldId,
    exportedAt: new Date().toISOString(),
    files,
  };
}

export interface ImportOptions {
  /** Import into this world instead of the bundle's own. */
  worldId?: string;
  /** Replace files that already exist (default: refuse). */
  overwrite?: boolean;
}

export interface ImportResult {
  worldId: string;
  written: number;
}

function validateBundle(raw: unknown): VaultBundle {
  const bundle = raw as Partial<VaultBundle> | null;
  if (!bundle || bundle.format !== VAULT_BUNDLE_FORMAT) {
    throw new Error('Not a Foundry AI Tool vault bundle');
  }
  if (bundle.version !== VAULT_BUNDLE_VERSION) {
    throw new Error(`Unsupported vault bundle version: ${String(bundle.version)}`);
  }
  assertWorldId(bundle.worldId);
  if (!Array.isArray(bundle.files)) throw new Error('Vault bundle has no files list');
  const seen = new Set<string>();
  for (const f of bundle.files) {
    assertArea(f?.area);
    assertFileName(f?.file);
    if (typeof f.content !== 'string') throw new Error(`No content for ${f.area}/${f.file}`);
    const key = `${f.area}/${f.file}`;
    if (seen.has(key)) throw new Error(`Duplicate file in bundle: ${key}`);
    seen.add(key);
    if (f.file.endsWith('.json')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(f.content);
      } catch {
        throw new Error(`${key} is not valid JSON`);
      }
      const env = parsed as Record<string, unknown> | null;
      if (!env || typeof env.schema !== 'number' || !('data' in env)) {
        throw new Error(`${key} has no vault envelope`);
      }
    }
  }
  return bundle as VaultBundle;
}

export async function importWorld(
  store: VaultStore,
  raw: unknown,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const bundle = validateBundle(raw);
  const worldId = assertWorldId(options.worldId ?? bundle.worldId);
  if (!options.overwrite) {
    const existing: string[] = [];
    for (const f of bundle.files) {
      if ((await store.readRaw(worldId, f.area, f.file)) !== null) {
        existing.push(`${f.area}/${f.file}`);
      }
    }
    if (existing.length > 0) {
      throw new Error(
        `Refusing to overwrite ${existing.length} existing file(s) (${existing
          .slice(0, 5)
          .join(', ')}); pass overwrite to replace them`
      );
    }
  }
  for (const f of bundle.files) await store.writeRaw(worldId, f.area, f.file, f.content);
  return { worldId, written: bundle.files.length };
}
