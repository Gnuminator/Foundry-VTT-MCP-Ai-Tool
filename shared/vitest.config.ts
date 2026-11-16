import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedConfig } from '../vitest.shared.mjs';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      globals: true,
      include: ['src/**/*.test.ts'],
    },
  })
);
