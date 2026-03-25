import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['tests/integration-db/**'],
          coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/db/migrate.ts', 'src/index.ts'],
          },
          setupFiles: ['./tests/setup.ts'],
        },
      },
      {
        test: {
          name: 'integration-db',
          globals: true,
          environment: 'node',
          include: ['tests/integration-db/**/*.test.ts'],
          globalSetup: ['./tests/integration-db/globalSetup.ts'],
          setupFiles: ['./tests/integration-db/setup.ts'],
          sequence: { concurrent: false },
          fileParallelism: false,
        },
      },
    ],
  },
});
