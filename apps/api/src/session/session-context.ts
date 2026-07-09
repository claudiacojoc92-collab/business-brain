/**
 * Session-context resolver (S0-T2). Reads the session cookie from the request, looks the session up
 * SERVER-SIDE (never trusts a client-supplied founder id), and returns the founderId (or null). Routes
 * use this to scope to the authenticated founder. Reused by set-rls-context to bind RLS to the session.
 */
import type { FastifyRequest } from 'fastify';
import { readCookie, SESSION_COOKIE } from './cookie';
import { resolveSession, type IIdentityRepository } from './session.service';

/** Resolve the founderId for a request from its session cookie. null when there is no live session. */
export async function founderIdFromSession(request: FastifyRequest, repo: IIdentityRepository, now: Date): Promise<string | null> {
  const sessionId = readCookie(request.headers['cookie'], SESSION_COOKIE);
  if (!sessionId) return null;
  return resolveSession(sessionId, repo, now);
}
