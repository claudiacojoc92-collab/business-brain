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
  './apps/web/vite.config.ts',
]);
