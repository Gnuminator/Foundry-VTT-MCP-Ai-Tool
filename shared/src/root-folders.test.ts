import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { rootFolder } from './root-folders.js';

describe('rootFolder', () => {
  it('stays at the drive root without a data folder', () => {
    // Not the real FVTT_DATA_DIR: an empty value means "none" (undefined would read the env).
    expect(rootFolder('FoundryPlanB', '', '/drive')).toBe(join('/drive', 'FoundryPlanB'));
    // A relative value is ignored.
    expect(rootFolder('FoundryPlanB', 'data', '/drive')).toBe(join('/drive', 'FoundryPlanB'));
    expect(rootFolder('FoundryPlanB', 'C:data', '/drive')).toBe(join('/drive', 'FoundryPlanB'));
  });

  it('follows the folder when it has moved, and the old place until then', () => {
    const root = mkdtempSync(join(tmpdir(), 'rootf-'));
    try {
      const drive = join(root, 'drive');
      const data = join(root, 'data');
      // Nothing anywhere: the data folder wins.
      expect(rootFolder('FoundryAI', data, drive)).toBe(join(data, 'FoundryAI'));
      // Only the old folder exists (not moved yet): the old place answers.
      mkdirSync(join(drive, 'FoundryAI'), { recursive: true });
      expect(rootFolder('FoundryAI', data, drive)).toBe(join(drive, 'FoundryAI'));
      // Moved: the data folder answers again.
      mkdirSync(join(data, 'FoundryAI'), { recursive: true });
      expect(rootFolder('FoundryAI', data, drive)).toBe(join(data, 'FoundryAI'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
