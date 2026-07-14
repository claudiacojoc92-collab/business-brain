import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // VP-T2: the founder-facing API is under a single /api/* boundary; /reads, /connect, /account,
      // /auth as BROWSER routes are the SPA. Only /api and the dev preview endpoints proxy to the api.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Dev-only preview endpoints (SSE + /dev/*). Not founder-facing; not under /api.
      '/dev': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
  },
});
