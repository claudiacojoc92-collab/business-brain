import { defineWorkspace } from 'vitest/config';

/**
 * Root Vitest workspace.
 *
 * The backend packages/apps run in the Node environment (as before B1).
 * The apps/web React app runs in jsdom, configured by its own vite.config.ts
 * (react plugin, jsdom, test setup). This lets `npx vitest run` at the repo
 * root execute both suites with the correct environment each.
 */
export default defineWorkspace([
  {
    test: {
      name: 'backend',
      environment: 'node',
      include: [
        'packages/*/src/**/*.test.ts',
        'apps/api/src/**/*.test.ts',
        'apps/workers/src/**/*.test.ts',
      ],
    },
  },
  {
    // Business Brain V1 Postgres integration project. Env-gated: it contributes ZERO
    // files unless BB_IT_DATABASE_URL is set, so the default `vitest run` fast glob is
    // untouched. Run it directly with: `npm run test:integration:businessbrain`
    // (which sets --project businessbrain-integration).
    test: {
      name: 'businessbrain-integration',
      environment: 'node',
      include: process.env.BB_IT_DATABASE_URL
        ? [
            'packages/infrastructure/src/__tests__/database/repositories/pg-businessbrain.integration.spec.ts',
            'apps/api/src/__tests__/__integration__/businessbrain-api.integration.spec.ts',
          ]
        : [],
    },
  },
  './apps/web/vite.config.ts',
]);
