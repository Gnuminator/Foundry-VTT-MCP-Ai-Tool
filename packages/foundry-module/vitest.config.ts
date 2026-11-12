import { defineConfig } from 'vitest/config';
import { sharedFromSource } from '../../vitest.shared-source.js';

export default defineConfig({
  ssr: sharedFromSource,
});
