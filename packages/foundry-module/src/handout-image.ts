/**
 * `plan-handout-press`: the backend renders a handout picture (letter, notice or card) on the PC
 * and sends the PNG bytes here; this GM-client query checks them again and stores the file through
 * Foundry's FilePicker.upload in one folder:
 *
 *   assets/ai-art/handouts/
 *
 * Nothing from the caller names the folder or the file: the file name is made here
 * (`handout-<time>-<random>.png`, never an existing name). The query only stores the file; the
 * page itself is a guarded write the backend plans (apply confirms, undo removes the page, the
 * file stays). A write (write-gate.ts); GM client only.
 */
import type { UploadHandoutImageReply, UploadHandoutImageRequest } from '@gnuminator/shared';

import { isFeatureEnabled, featureName, featureOffMessage } from './guarded-features.js';
import { PORTRAIT_MAX_BYTES, sniffType, type PortraitPicker } from './player-portrait.js';

/** Query name (shared's UPLOAD_HANDOUT_IMAGE_QUERY; a module file imports types only). */
export const UPLOAD_HANDOUT_IMAGE_QUERY = 'uploadHandoutImage';

/** Guarded-write feature id of handouts (the same switch as revealing). */
const HANDOUTS_FEATURE_ID = 'handouts';

const FOLDER = 'assets/ai-art/handouts';
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface HandoutImageEnv {
  enabled(): boolean;
  picker(): PortraitPicker;
  now(): Date;
  random(): string;
}

function liveEnv(): HandoutImageEnv {
  const g = globalThis as unknown as {
    foundry?: { applications?: { apps?: { FilePicker?: { implementation?: PortraitPicker } } } };
  };
  return {
    enabled: () => isFeatureEnabled(HANDOUTS_FEATURE_ID),
    picker: (): PortraitPicker => {
      const picker = g.foundry?.applications?.apps?.FilePicker?.implementation;
      if (!picker) throw new Error('Foundry file upload is not available');
      return picker;
    },
    now: () => new Date(),
    random: () => Math.random().toString(36).slice(2, 10).padEnd(8, '0'),
  };
}

function refuse(error: string): UploadHandoutImageReply {
  return { success: false, error };
}

export function handoutFileName(now: Date, random: string): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `handout-${stamp}-${random}.png`;
}

async function ensureFolder(picker: PortraitPicker): Promise<string> {
  let path = '';
  for (const part of FOLDER.split('/')) {
    path = path ? `${path}/${part}` : part;
    try {
      await picker.createDirectory('data', path);
    } catch {
      // Foundry throws when the folder exists; the upload below fails if it truly is not there.
    }
  }
  return path;
}

/** The query handler: store a rendered handout picture. */
export async function uploadHandoutImage(
  data: unknown,
  env: HandoutImageEnv = liveEnv()
): Promise<UploadHandoutImageReply> {
  if (!env.enabled()) return refuse(featureOffMessage(featureName(HANDOUTS_FEATURE_ID)));
  const base64 = ((data ?? {}) as Partial<UploadHandoutImageRequest>).data;
  if (typeof base64 !== 'string' || base64 === '' || !BASE64.test(base64)) {
    return refuse('A picture is required.');
  }
  if (base64.length > Math.ceil(PORTRAIT_MAX_BYTES / 3) * 4) {
    return refuse('That picture is too big. The limit is 5 MB.');
  }
  let bytes: Uint8Array;
  try {
    const bin = atob(base64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return refuse('A picture is required.');
  }
  if (bytes.length > PORTRAIT_MAX_BYTES)
    return refuse('That picture is too big. The limit is 5 MB.');
  if (sniffType(bytes) !== 'png') return refuse('Only a PNG picture works here.');

  const picker = env.picker();
  const folder = await ensureFolder(picker);
  const name = handoutFileName(env.now(), env.random());
  const file = new File([bytes as BlobPart], name, { type: 'image/png' });
  const stored = (await picker.upload('data', folder, file, {}, { notify: false })) as
    | { path?: unknown }
    | false
    | undefined;
  if (!stored || typeof stored !== 'object' || typeof stored.path !== 'string') {
    return refuse('Foundry did not accept the picture.');
  }
  const path = `${folder}/${name}`;
  if (!decodeURIComponent(stored.path).endsWith(path)) {
    return refuse('Foundry stored the picture somewhere unexpected.');
  }
  return { success: true, path };
}
