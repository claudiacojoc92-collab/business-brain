import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import type { ServerDeps } from '../server';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import { recordFounderEvent } from '../telemetry/founder-events';
import { detectType, assertWithinBounds, MAX_BYTES } from '../connectors/upload/detect';
import { extractPdf, extractDocx, extractText } from '../connectors/upload/extract';

interface AuthedUser {
  sub: string;
  role: string;
}

function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}

interface LearnBody {
  url?: string;
}
interface ProfileStatusBody {
  status?: 'confirmed' | 'rejected';
}

/**
 * Slice 1 — "BB learned my business" routes (/v1, JWT via the global preHandler).
 * Every route resolves the business through membership first (404 if not a member).
 */
export function registerBusinessIntelligenceRoutes(server: FastifyInstance, deps: ServerDeps): void {
  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    return { founderId, business };
  }

  // Learn: read the real website, bind evidence, discover profiles, synthesize understanding + Aha.
  server.post('/v1/businesses/:id/learn', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const body = (request.body ?? {}) as LearnBody;
    const url = (body.url ?? '').trim();
    if (!url) throw new ValidationError('WEBSITE_REQUIRED', 'A website URL is required.');

    const account = await deps.founderAccountService.getById(founderId);
    const result = await deps.learnBusinessService.learn({
      businessId: business.id,
      founderId,
      businessName: business.name,
      url,
      interfaceLanguage: account?.interfaceLocale ?? 'en',
    });
    await reply.status(200).send(result);
  });

  // Founder-supplied material path: the founder pastes text about the business (bio/captions/offer copy).
  // Persists as DECLARED evidence and runs the SAME synthesis → understanding + Aha. No website required.
  server.post('/v1/businesses/:id/learn/material', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const body = (request.body ?? {}) as { material?: string; origin?: string };
    const material = (body.material ?? '').trim();
    if (!material) throw new ValidationError('MATERIAL_REQUIRED', 'Some material about the business is required.');
    if (material.length > 20000) throw new ValidationError('MATERIAL_TOO_LONG', 'That is a lot of text — trim it a little.');
    const account = await deps.founderAccountService.getById(founderId);
    const result = await deps.learnBusinessService.learnFromMaterial({
      businessId: business.id,
      founderId,
      businessName: business.name,
      material,
      interfaceLanguage: account?.interfaceLocale ?? 'en',
    });
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'source_material_submitted', surface: 'onboarding', metadata: { origin: (body.origin ?? 'chooser').slice(0, 32), chars: material.length } });
    await reply.status(200).send(result);
  });

  // Founder-supplied material as a FILE (PDF / Word / text) — e.g. a brochure. Reuses the existing safe,
  // text-only extractors (pdf-parse / mammoth; PDF JS + DOCX macros are never executed) then ingests the
  // extracted text as DECLARED material — never observed, never business truth. Scoped multipart so it
  // doesn't collide with the dev upload route's own registration.
  server.register(async (scope) => {
    await scope.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } });
    scope.post('/v1/businesses/:id/learn/material/file', async (request: FastifyRequest, reply: FastifyReply) => {
      const { founderId, business } = await requireBusiness(request);
      const file = await (request as unknown as { file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> } | undefined> }).file();
      if (!file) throw new ValidationError('FILE_REQUIRED', 'Attach a file.');
      const bytes = await file.toBuffer();
      assertWithinBounds(bytes);
      const type = detectType(bytes);
      if (type === 'unsupported') throw new ValidationError('UNSUPPORTED_FILE', 'I can read PDF, Word, or text files.');
      const doc = type === 'pdf' ? await extractPdf(bytes, file.filename) : type === 'docx' ? await extractDocx(bytes, file.filename) : extractText(bytes, file.filename);
      const material = doc.units.map((u) => u.text).join('\n\n').slice(0, 20000);
      if (material.trim().length < 20) throw new ValidationError('MATERIAL_EMPTY', 'I couldn’t read enough text from that file.');
      const account = await deps.founderAccountService.getById(founderId);
      const result = await deps.learnBusinessService.learnFromMaterial({
        businessId: business.id, founderId, businessName: business.name, material, interfaceLanguage: account?.interfaceLocale ?? 'en',
      });
      recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'source_material_submitted', surface: 'onboarding', metadata: { origin: 'file', filetype: type, chars: material.length } });
      await reply.status(200).send(result);
    });
  });

  server.get('/v1/businesses/:id/aha', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const aha = await deps.ahaRepo.latest(business.id);
    if (!aha) {
      await reply.status(200).send({ state: 'none' });
      return;
    }
    await reply.status(200).send({ state: aha.status, findings: aha.findings, createdAt: aha.createdAt });
  });

  server.get('/v1/businesses/:id/understanding', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const snap = await deps.understandingRepo.latest(business.id);
    if (!snap) {
      await reply.status(200).send({ state: 'none' });
      return;
    }
    await reply.status(200).send({
      state: 'present',
      profileVersion: snap.profileVersion,
      sourceLanguage: snap.sourceLanguage,
      understanding: snap.understanding,
      createdAt: snap.createdAt,
    });
  });

  server.get('/v1/businesses/:id/discovered-profiles', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const profiles = await deps.discoveredProfileRepo.list(business.id);
    await reply.status(200).send({ profiles });
  });

  server.post('/v1/businesses/:id/discovered-profiles/:pid', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { pid } = request.params as { pid: string };
    const body = (request.body ?? {}) as ProfileStatusBody;
    if (body.status !== 'confirmed' && body.status !== 'rejected') {
      throw new ValidationError('INVALID_STATUS', 'status must be confirmed or rejected.');
    }
    const updated = await deps.discoveredProfileRepo.setStatus(business.id, pid, body.status);
    if (!updated) throw new NotFoundError('PROFILE_NOT_FOUND', 'Discovered profile not found.');
    await reply.status(200).send(updated);
  });
}
