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
      reporter: ['text', 'json-summary'],
      include: [
        'server/auth.schemas.ts',
        'src/lib/base64.ts',
        'src/lib/color.ts',
        'src/lib/format.ts',
        'src/lib/image-sniff.ts',
        'src/lib/text.ts',
        'server/config.ts',
        'server/edit.ts',
        'server/metrics.ts',
        'server/middleware.ts',
        'server/observability.ts',
        'src/lib/api.ts',
        'src/lib/auth-api.ts',
        'src/lib/confirm.ts',
        'src/lib/convert-to-pdf/model.ts',
        'src/lib/haptics.ts',
        'src/lib/image.ts',
        'src/lib/nav.ts',
        'src/lib/ocr.ts',
        'src/lib/ocr.web.ts',
        'src/lib/operations.helpers.ts',
        'src/lib/operations.values.ts',
        'src/lib/pdf-editor/doodle.ts',
        'src/lib/pdf-editor/geometry.ts',
        'src/lib/pdf-editor/model.ts',
        'src/lib/pdf-editor/preview.ts',
        'src/lib/pdf-render.ts',
        'src/lib/pick.ts',
        'src/lib/share.ts',
        'src/lib/storage.ts',
        'src/lib/uid.ts',
        'src/store/useLibrary.ts',
        'src/store/useSettings.ts',
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
