import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { AuthenticationError, NotFoundError } from '@bb/shared';

interface AuthedUser {
  sub: string;
  role: string;
}

/** The authenticated founder id. Auth is enforced by the global /v1/* preHandler. */
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) {
    throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  }
  return user.sub;
}

interface CreateBusinessBody {
  name?: string;
  defaultConversationLanguage?: string;
}

interface SetLocaleBody {
  locale?: string;
}

/**
 * Slice 0 — Business + account routes under /v1 (JWT-authenticated via the global preHandler).
 *
 * The JWT identifies the person (sub); the path identifies the business; membership authorizes
 * access (M1 decision 2). A founder with no membership for a business receives 404 (existence is
 * not leaked) — enforced at the application layer, which is authoritative in dev where RLS is
 * bypassed by the owner DB role.
 */
export function registerBusinessRoutes(server: FastifyInstance, deps: ServerDeps): void {
  // ── Account ────────────────────────────────────────────────────────────────
  server.get('/v1/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = founderOf(request);
    const account = await deps.founderAccountService.getById(founderId);
    if (!account) throw new NotFoundError('ACCOUNT_NOT_FOUND', 'Account not found.');
    await reply.status(200).send({
      founderId:       account.founderId,
      email:           account.email,
      name:            account.name,
      interfaceLocale: account.interfaceLocale,
    });
  });

  server.put('/v1/me/locale', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = founderOf(request);
    const body = (request.body ?? {}) as SetLocaleBody;
    const locale = await deps.founderAccountService.setInterfaceLocale(founderId, body.locale);
    await reply.status(200).send({ interfaceLocale: locale });
  });

  // ── Businesses ───────────────────────────────────────────────────────────────
  server.post('/v1/businesses', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = founderOf(request);
    const body = (request.body ?? {}) as CreateBusinessBody;
    const business = await deps.businessService.createBusiness({
      founderId,
      name: body.name ?? '',
      defaultConversationLanguage: body.defaultConversationLanguage as never,
    });
    await reply.status(201).send(business);
  });

  server.get('/v1/businesses', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = founderOf(request);
    const businesses = await deps.businessService.listBusinesses(founderId);
    await reply.status(200).send({ businesses });
  });

  server.get('/v1/businesses/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    await reply.status(200).send(business);
  });
}
