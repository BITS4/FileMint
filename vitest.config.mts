import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'react-native': 'react-native-web',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.{ts,tsx}', 'server/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: [
        'server/**/*.ts',
        'src/constants/**/*.ts',
        'src/components/ui/Badge.tsx',
        'src/components/ui/Button.tsx',
        'src/components/ui/Card.tsx',
        'src/components/ui/Chip.tsx',
        'src/components/ui/EmptyState.tsx',
        'src/components/ui/FilterChips.tsx',
        'src/components/ui/IconButton.tsx',
        'src/components/ui/PromptModal.tsx',
        'src/components/ui/Segmented.tsx',
        'src/components/ui/TextField.tsx',
        'src/components/ui/Txt.tsx',
        'src/hooks/use-runner.ts',
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
        statements: 95,
        branches: 86,
        functions: 98,
        lines: 97,
      },
    },
  },
});
