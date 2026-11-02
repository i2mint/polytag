import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tests/agnostic/ only makes sense under the boundary guard: vitest.agnostic.config.ts.
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/agnostic/**', '**/node_modules/**'] },
});
