/**
 * V086 Postgres integration: conversation_turns.surface round-trips through the real repository. Env-gated: runs ONLY
 * when BB_IT_DATABASE_URL points at a throwaway database migrated to V086. Each run uses fresh ids.
 *
 *   BB_IT_DATABASE_URL=postgresql://… npm run test:integration:businessbrain
 */
import { describe, it, expect, afterAll } from 'vitest';
import { sql } from 'kysely';
import { createKyselyClient } from '../../../database/client';
import { PgConversationRepository } from '../../../database/repositories/pg-conversation.repository';

const url = process.env['BB_IT_DATABASE_URL'] ?? '';
const db = createKyselyClient(url);
afterAll(async () => { await db.destroy(); });

describe('conversation turn surface (V086)', () => {
  const run = `it-${Date.now()}`;
  const repo = new PgConversationRepository(db);

  it('stores the surface kind per turn, reads it back, and leaves an unknown surface NULL', async () => {
    await sql`INSERT INTO founder.founders (id, email, name) VALUES (${`f-${run}`}, ${`${run}@example.test`}, 'IT founder')`.execute(db);
    await sql`INSERT INTO workspace.businesses (id, owner_founder_id, name) VALUES (${`b-${run}`}, ${`f-${run}`}, 'IT business')`.execute(db);
    const s = await repo.create({ id: `s-${run}`, businessId: `b-${run}`, founderId: `f-${run}`, conversationLanguage: 'ro' });
    const base = { sessionId: s.id, businessId: `b-${run}`, language: 'ro', infoNeedKey: null };
    await repo.appendTurn({ ...base, id: `t1-${run}`, role: 'bb', content: 'opener', surface: 'onboarding' });
    await repo.appendTurn({ ...base, id: `t2-${run}`, role: 'founder', content: 'ok, fa asa', surface: 'talk' });
    await repo.appendTurn({ ...base, id: `t3-${run}`, role: 'founder', content: 'no surface given' });
    expect((await repo.listTurns(s.id)).map((t) => [t.role, t.surface])).toEqual([['bb', 'onboarding'], ['founder', 'talk'], ['founder', null]]);
  });

  it('the database refuses a surface outside the closed set', async () => {
    const s = await repo.getByBusiness(`b-${run}`);
    await expect(repo.appendTurn({ id: `t4-${run}`, sessionId: s!.id, businessId: `b-${run}`, role: 'founder', content: 'x', language: 'ro', infoNeedKey: null, surface: 'home-screen' as never }))
      .rejects.toThrow(/conversation_turns_surface_chk/);
  });
});
