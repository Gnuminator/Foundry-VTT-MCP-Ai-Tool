import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedConfig } from '../../vitest.shared.mjs';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts', 'announce/**/*.test.mjs'],
    },
  })
);
