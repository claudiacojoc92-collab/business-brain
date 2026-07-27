/**
 * REAL end-to-end (§16): the real React BusinessBrainWorkspace driving the real
 * Phase 6 API over real HTTP against real Postgres. Env-gated on BB_IT_DATABASE_URL
 * (throwaway DB). NOT mocked — proves no_current_version → Connect → Start →
 * progress → completed → rendered Current, and survives a reload.
 *
 *   docker compose -f docker-compose.test.yml up -d postgres-test
 *   docker compose -f docker-compose.test.yml run --rm migrate-test
 *   BB_IT_DATABASE_URL=postgresql://bbuser:bbpassword@localhost:5433/businessbrain_test \
 *     npx vitest run apps/web/src/test/BusinessBrain.realapi.integration.spec.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';

const URL = process.env.BB_IT_DATABASE_URL;
const suite = URL ? describe : describe.skip;

// jsdom here exposes `localStorage` but its value is undefined; force a working one.
let hasLS = false;
try { hasLS = !!(globalThis as { localStorage?: unknown }).localStorage; } catch { hasLS = false; }
if (!hasLS) {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = String(v); },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    },
  });
}

suite('REAL end-to-end — React workspace ↔ Phase 6 API ↔ Postgres', () => {
  let server: FastifyInstance;
  let pool: Pool;
  let founderId: string;
  let base: string;

  beforeAll(async () => {
    const { createKyselyClient, JwtService } = await import('@bb/infrastructure');
    const { registerBusinessBrainRoutes } = await import('../../../api/src/routes/businessbrain.routes');
    const { registerErrorHandler } = await import('../../../api/src/plugins/error-handler.plugin');
    const client = await import('../api/client');

    pool = new Pool({ connectionString: URL });
    const db = createKyselyClient(URL!);
    const priv = readFileSync(join(process.cwd(), 'jwt-dev-private.pem'), 'utf8');
    const pub = readFileSync(join(process.cwd(), 'jwt-dev-public.pem'), 'utf8');
    const jwt = new JwtService(priv, pub);

    server = Fastify();
    registerErrorHandler(server, { warn() {}, info() {}, error() {} } as never);
    registerBusinessBrainRoutes(server, { db, jwtService: jwt } as never);
    await server.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/`;

    founderId = `01WEBIT${Date.now().toString(36).toUpperCase()}`.slice(0, 26);
    await pool.query(`INSERT INTO founder.founders (id, email, name, business_name) VALUES ($1,$2,$3,$4)`,
      [founderId, `${founderId}@it.test`, 'IT', 'IT']);
    const token = jwt.sign({ sub: founderId, role: 'founder', scopes: [] }).accessToken;

    client.setApiBase(base);
    globalThis.localStorage.setItem('bb_access_token', token);
  });

  afterAll(async () => {
    const client = await import('../api/client');
    client.setApiBase('/');
    await server.close();
    await pool.query(`DELETE FROM founder.founders WHERE id = $1`, [founderId]);
    await pool.end();
  });

  it('drives the full lifecycle and survives reload', async () => {
    const { BusinessBrainWorkspace } = await import('../businessbrain/BusinessBrainWorkspace');

    const view = render(<BusinessBrainWorkspace pollIntervalMs={80} />);

    // no_current_version
    expect(await screen.findByTestId('no-current-version', {}, { timeout: 8000 })).toBeInTheDocument();

    // Connect (dev adapter)
    fireEvent.click(await screen.findByRole('button', { name: /Connect Instagram/i }));
    await waitFor(() => expect(screen.getByTestId('connection-status')).toHaveTextContent('Instagram connected'), { timeout: 8000 });

    // Start Refresh → progress → completed → rendered Current
    await waitFor(() => expect((screen.getByTestId('start-refresh') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('start-refresh'));
    const cur = await screen.findByTestId('current-business-brain', {}, { timeout: 15000 });
    const vid = cur.getAttribute('data-version-id')!;
    expect(vid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // a ULID version id, public
    expect(screen.getByTestId('section-business-reality')).toHaveTextContent(/communication/i);
    expect(screen.getByTestId('section-evidence')).toHaveTextContent('%'); // measures only in Evidence

    // Reload: unmount + remount → authoritative refetch renders the SAME Current.
    view.unmount();
    cleanup();
    render(<BusinessBrainWorkspace pollIntervalMs={80} />);
    const cur2 = await screen.findByTestId('current-business-brain', {}, { timeout: 8000 });
    expect(cur2.getAttribute('data-version-id')).toBe(vid);
  }, 40000);
});
