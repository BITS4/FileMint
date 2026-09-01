import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'server/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: [
        'server/**/*.ts',
        'src/constants/**/*.ts',
        'src/hooks/pdf-editor/object-state.ts',
        'src/lib/**/*.ts',
        'src/store/**/*.ts',
      ],
      exclude: [
        '**/*.spec.ts',
        '**/*.spec.tsx',
        // Process launchers are exercised by the production build and smoke job.
        'server/start.ts',
        'server/smoke.ts',
        // Browser adapters require DOM/native runners; their shared logic is covered above.
        'src/lib/image.web.ts',
        'src/lib/pdf-render.web.ts',
        'src/lib/storage.web.ts',
      ],
      thresholds: {
        statements: 94,
        branches: 85,
        functions: 97,
        lines: 96,
      },
    },
  },
});
