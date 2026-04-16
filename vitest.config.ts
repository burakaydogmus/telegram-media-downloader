import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@content': resolve(__dirname, 'src/content'),
      '@features': resolve(__dirname, 'src/features'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@background': resolve(__dirname, 'src/background'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/shared/types/**',
        'src/ui/components/panel-view-model.ts',
        'src/background/service-worker.ts',
        'src/background/download-manager.ts',
        'src/content/bootstrap.ts',
        'src/content/composition-root.ts',
        'src/popup/**',
        'src/options/**',
        'src/ui/icons/**',
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
