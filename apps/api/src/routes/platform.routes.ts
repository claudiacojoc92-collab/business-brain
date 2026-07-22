import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { readCookie, SESSION_COOKIE } from '../session/cookie';
import { resolveSession } from '../session/session.service';
import { PgUnderstandingRepository } from '../business-model/pg-understanding.repository';
import { PgUnderstandingItemRepository } from '../business-model/pg-understanding-item.repository';
import { PgFounderStrategicContextRepository } from '../business-model/pg-founder-strategic-context.repository';
import { PgMarketEntityRepository } from '../business-model/pg-market.repository';
import { PgPilotStore } from '../pilot/pg-pilot.repository';
import { resolveEffectiveStrategicContext } from '../business-model/effective-strategic-context.resolver';

/**
 * Platform (Phase 1) — the founder-facing composition endpoints that unify what several older subsystems already store into
 * ONE coherent view. No new capability: it reads existing data (pilot setup, founder-governed understanding items, synthesized
 * understanding, strategic context, market entities) and presents a single Business profile, a truthful Sources status, and a
 * language preference. Founder-scoped throughout. Meta is a declared source in a pending state — never fake data.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;
const SUPPORTED_LANGS = new Set(['en', 'ro']);
const strip = (s: string, prefixes: string[]): string | null => { for (const p of prefixes) if (s.toLowerCase().startsWith(p.toLowerCase())) return s.slice(p.length).trim(); return null; };

export function registerPlatformRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const identity = new PgIdentityRepository(db);
  const understanding = new PgUnderstandingRepository(db);
  const items = new PgUnderstandingItemRepository(db);
  const strategicContext = new PgFounderStrategicContextRepository(db);
  const entities = new PgMarketEntityRepository(db);
  const pilot = new PgPilotStore(db);

  async function need(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const sid = readCookie(request.headers['cookie'], SESSION_COOKIE);
    const f = sid ? await resolveSession(sid, identity, new Date()) : null;
    if (!f) { await reply.code(401).send({ error: 'authentication required' }); return null; }
    return f;
  }

  // GET /business/profile — ONE coherent business profile composed from every place the data already lives.
  server.get('/business/profile', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const [pf, u, current, fscItems, ents] = await Promise.all([
      pilot.getPilotFounder(f), understanding.latest(f), items.listCurrent(f), strategicContext.listActive(f), entities.list(f).catch(() => []),
    ]);
    const conc = (type: string): string | null => (u?.conclusions.find((c) => c.type === type && c.confirmationState !== 'rejected')?.statement ?? null);
    const founderSaid = current.filter((i) => i.truthLabel === 'you_told_me' || i.truthLabel === 'you_corrected_this');
    const pick = (prefixes: string[]): string | null => { for (const i of founderSaid) { const v = strip(i.statement, prefixes); if (v) return v; } return null; };
    const goals = [...fscItems.filter((i) => i.kind === 'GOAL').map((i) => i.statement), ...founderSaid.map((i) => strip(i.statement, ['A current goal:'])).filter((x): x is string => !!x)];
    const constraints = [...fscItems.filter((i) => i.kind === 'CONSTRAINT').map((i) => i.statement), ...founderSaid.map((i) => strip(i.statement, ['A constraint we work within:'])).filter((x): x is string => !!x)];
    const eff = resolveEffectiveStrategicContext(fscItems, new Date());

    const description = conc('what_it_is');
    const offer = pick(['What we offer:']) ?? conc('what_it_offers');
    const customer = pick(['Our primary customer:']) ?? conc('who_it_addresses');
    // "what you've told me" = founder items that aren't captured by the labelled fields above
    const otherToldMe = founderSaid.map((i) => i.statement).filter((s) => !/^(What we offer:|Our primary customer:|A current goal:|A constraint we work within:)/i.test(s));
    const hasAnyContext = Boolean(pf?.businessName || pf?.setupCompleted || u || current.length || fscItems.length || (ents as AnyDB[]).length);

    await reply.send({
      name: pf?.businessName ?? null,
      stage: pf?.stage ?? null,
      description, offer, customer,
      goals, constraints,
      resources: eff.resources.map((r) => r.statement),
      otherToldMe,
      positioningCount: (ents as AnyDB[]).length,
      hasAnyContext,
    });
  });

  // GET /sources/status — truthful state of every information input (Meta = access pending; no fake data, no fake metrics).
  server.get('/sources/status', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const [pf, u, current, ents] = await Promise.all([
      pilot.getPilotFounder(f), understanding.latest(f), items.listCurrent(f), entities.list(f).catch(() => []),
    ]);
    const founderInputPresent = Boolean(pf?.setupCompleted || current.some((i) => i.truthLabel === 'you_told_me' || i.truthLabel === 'you_corrected_this'));
    await reply.send({
      sources: [
        { key: 'founder', name: 'What you tell me', status: founderInputPresent ? 'connected' : 'not_added', detail: 'Describe your business in your own words.' },
        { key: 'website', name: 'Your website', status: u ? 'connected' : 'not_added', detail: 'I read your site to understand what you offer.' },
        { key: 'documents', name: 'Your materials', status: 'not_added', detail: 'Add documents that describe your business.' },
        { key: 'market', name: 'Market context', status: (ents as AnyDB[]).length ? 'connected' : 'not_added', detail: 'Who you’re compared with.' },
        { key: 'meta', name: 'Meta (Facebook / Instagram)', status: 'access_pending', detail: 'Connection is pending access. It will add real activity as one more source of evidence — nothing is connected yet.' },
        { key: 'future', name: 'More connections', status: 'unavailable', detail: 'Additional evidence sources will appear here over time.' },
      ],
    });
  });

  // GET/PUT /preferences — the founder's language (minimum sound language system; later phases reuse this).
  server.get('/preferences', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const r = await db.selectFrom('business.founder_preference').select('language').where('founder_id', '=', f).executeTakeFirst();
    await reply.send({ language: r?.language ?? 'en' });
  });
  server.put('/preferences', async (request, reply) => {
    const f = await need(request, reply); if (!f) return;
    const lang = String((request.body as { language?: string })?.language ?? '').trim();
    if (!SUPPORTED_LANGS.has(lang)) { await reply.code(400).send({ error: 'unsupported language' }); return; }
    await db.insertInto('business.founder_preference').values({ founder_id: f, language: lang, updated_at: new Date().toISOString() })
      .onConflict((oc: AnyDB) => oc.column('founder_id').doUpdateSet({ language: lang, updated_at: new Date().toISOString() })).execute();
    await reply.send({ language: lang });
  });
}
