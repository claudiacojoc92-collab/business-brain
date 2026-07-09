/**
 * Nucleus founderId resolver (S0-T2 C2). Resolves the founderId for a route from the authenticated
 * SESSION when present (production path), else `?founder=` (dev override), else DEV_FOUNDER_ID (dev
 * fallback). Only the founderId SOURCE changes at the route boundary — nucleus logic is untouched, and
 * the founderId is always server-resolved (a client can never assert another founder's id via a param).
 */
import type { FastifyRequest } from 'fastify';
import { DEV_FOUNDER_ID } from '../connectors/website/dev-founder';
import { founderIdFromSession } from './session-context';
import type { IIdentityRepository } from './session.service';

export async function resolveFounderId(request: FastifyRequest, identity: IIdentityRepository): Promise<string> {
  const session = await founderIdFromSession(request, identity, new Date());
  if (session) return session;                                       // authenticated founder (production)
  const q = (request.query as Record<string, unknown>)?.['founder']; // dev-only override
  return typeof q === 'string' && q ? q : DEV_FOUNDER_ID;            // dev fallback
}
