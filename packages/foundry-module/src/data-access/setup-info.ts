/**
 * `getSetupInfo` (D-135): what the Foundry setup tool shows before it plans a change. A read
 * only; secret settings are listed by name with their value left out.
 *
 * - `area: "setting"`: registered settings (world, client and user scope), matched by
 *   `namespace.key` or a part of the key, name or namespace. Hidden settings (`config: false`)
 *   show only when `target` is their exact `namespace.key`.
 * - `area: "pack"`: compendium packs with their effective and configured ownership, locked flag
 *   and folder, plus the Compendium folders a pack can sit in.
 */
import {
  MAX_SETTING_JSON,
  isSecretSetting,
  readPackEntry,
  readSettingValue,
  registeredSettings,
  settingTypeName,
} from './virtual-targets.js';

const LIST_CAP = 50;

interface PackLike {
  collection?: string;
  metadata?: {
    label?: string;
    type?: string;
    packageName?: string;
    packageType?: string;
    ownership?: Record<string, string>;
  };
  title?: string;
  documentName?: string;
  locked?: boolean;
  ownership?: Record<string, string>;
  folder?: { id?: string; name?: string } | null;
  config?: { ownership?: Record<string, string>; locked?: boolean; folder?: string | null };
}

interface FolderLike {
  id: string;
  name: string;
  type?: string;
}

function settingsInfo(target: string | undefined): unknown {
  const wanted = (target ?? '').trim();
  const lower = wanted.toLowerCase();
  const all = registeredSettings();
  const exact = wanted.includes('.') && all.has(wanted);
  const rows: Array<
    [string, ReturnType<typeof registeredSettings> extends Map<string, infer V> ? V : never]
  > = [];
  for (const [id, meta] of all) {
    if (exact) {
      if (id === wanted) rows.push([id, meta]);
      continue;
    }
    if (meta.config === false) continue;
    const name = meta.name ? game.i18n.localize(meta.name) : '';
    if (!lower || `${id} ${name}`.toLowerCase().includes(lower)) rows.push([id, meta]);
  }
  rows.sort(([a], [b]) => a.localeCompare(b));
  const settings = rows.slice(0, LIST_CAP).map(([id, meta]) => {
    const namespace = id.slice(0, id.indexOf('.'));
    const key = id.slice(id.indexOf('.') + 1);
    const row: Record<string, unknown> = {
      id,
      name: meta.name ? game.i18n.localize(meta.name) : key,
      scope: meta.scope ?? 'client',
      type: settingTypeName(meta.type),
      config: meta.config !== false,
      requiresReload: meta.requiresReload === true,
      default: meta.default,
    };
    if (meta.choices) {
      row.choices = Object.fromEntries(
        Object.entries(meta.choices).map(([k, v]) => [
          k,
          typeof v === 'string' ? game.i18n.localize(v) : v,
        ])
      );
    }
    if (meta.range) row.range = meta.range;
    let value: unknown;
    try {
      value = readSettingValue(namespace, key);
    } catch (error) {
      row.valueError = error instanceof Error ? error.message : String(error);
    }
    if (isSecretSetting(namespace, key, value)) {
      row.redacted = true;
      delete row.default;
    } else if (!row.valueError) {
      const json = JSON.stringify(value ?? null);
      row.value =
        json.length > MAX_SETTING_JSON ? `(${json.length} characters, too long to show)` : value;
    }
    return row;
  });
  return { area: 'setting', total: rows.length, shown: settings.length, settings };
}

function packsInfo(target: string | undefined): unknown {
  const lower = (target ?? '').trim().toLowerCase();
  const packs = [...(game.packs as unknown as Iterable<PackLike>)];
  const rows = packs
    .filter(pack => {
      const id = pack.collection ?? '';
      return (
        !lower || `${id} ${pack.metadata?.label ?? pack.title ?? ''}`.toLowerCase().includes(lower)
      );
    })
    .map(pack => {
      const id = pack.collection ?? '';
      const configured = readPackEntry(id);
      return {
        id,
        label: pack.metadata?.label ?? pack.title ?? id,
        type: pack.documentName ?? pack.metadata?.type ?? null,
        package: pack.metadata?.packageName ?? null,
        ownership: pack.ownership ?? pack.config?.ownership ?? null,
        manifestOwnership: pack.metadata?.ownership ?? null,
        configured,
        locked: pack.locked ?? pack.config?.locked ?? false,
        folder: pack.folder ? { id: pack.folder.id ?? null, name: pack.folder.name ?? null } : null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const folders = [...(game.folders as unknown as Iterable<FolderLike>)]
    .filter(folder => folder.type === 'Compendium')
    .map(folder => ({ id: folder.id, name: folder.name }));
  return {
    area: 'pack',
    total: rows.length,
    shown: Math.min(rows.length, LIST_CAP),
    packs: rows.slice(0, LIST_CAP),
    folders,
  };
}

export function getSetupInfo(data: unknown): unknown {
  const { area, target } = (data ?? {}) as { area?: unknown; target?: unknown };
  const text = typeof target === 'string' ? target : undefined;
  if (area === 'setting') return settingsInfo(text);
  if (area === 'pack') return packsInfo(text);
  throw new Error('getSetupInfo needs area "setting" or "pack"');
}
