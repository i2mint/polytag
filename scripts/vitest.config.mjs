import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests for the repo's own scripts (not a workspace package).
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  test: { include: ['**/*.test.mjs'], exclude: ['fixtures/**', '**/node_modules/**'] },
});
