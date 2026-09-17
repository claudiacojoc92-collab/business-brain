import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import type { ServerDeps } from '../server';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import { fetchDocument, extractReadableText } from '@bb/infrastructure';
import { recordFounderEvent, readArcFlags, readArcSources, readArcEmail, type FounderEventType } from '../telemetry/founder-events';
import { detectType, assertWithinBounds, MAX_BYTES } from '../connectors/upload/detect';
import { extractPdf, extractDocx, extractText } from '../connectors/upload/extract';
import { getInstagramConnector } from '../connectors/instagram/instagram-connector.instance';

interface AuthedUser { sub: string; role: string }
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}

/**
 * DAY ONE — the arc (/v1, JWT). One surface, nine moments. GET /arc returns the current moment's view (derived
 * from durable founder_event flags + engine state — survives refresh). The transition endpoints record a
 * durable flag and/or drive an existing engine (learn / conversation / mirror / strategy / plan / email), then
 * return the fresh view. No tabs, no panels — the strategist carries the founder through.
 */
export function registerArcRoutes(server: FastifyInstance, deps: ServerDeps): void {
  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    const account = await deps.founderAccountService.getById(founderId);
    return { founderId, business, language: account?.interfaceLocale ?? 'en' };
  }

  async function viewFor(businessId: string, businessName: string, language: string, founderId: string) {
    const ig = getInstagramConnector();
    const [flags, sources, email, igState] = await Promise.all([
      readArcFlags(deps.db, businessId, founderId),
      readArcSources(deps.db, businessId, founderId),
      readArcEmail(deps.db, businessId, founderId),
      ig ? ig.status(founderId).catch(() => 'disconnected' as const) : Promise.resolve('disconnected' as const),
    ]);
    return deps.arcService.view(businessId, businessName, language, flags, sources, email, igState === 'connected');
  }

  const mark = (founderId: string, businessId: string, type: FounderEventType, metadata: Record<string, unknown> = {}) =>
    recordFounderEvent(deps.db, { accountId: founderId, businessId, eventType: type, surface: 'arc', metadata });

  // ── the view ──
  server.get('/v1/businesses/:id/arc', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });

  // ── Moment 1: the multi-source POUR-IN. Each source is INGESTED as business-bound evidence WITHOUT
  //    synthesizing; the bridge fires ONCE on "Done adding — start" (below) over the union of every source. ──

  // WEBSITE — fetch + bind pages (observed). Records the durable source only on a real read.
  server.post('/v1/businesses/:id/arc/source', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const url = ((request.body as { url?: string })?.url ?? '').trim();
    if (!url) throw new ValidationError('WEBSITE_REQUIRED', 'A website URL is required.');
    const result = await deps.learnBusinessService.ingestWebsiteForPourIn({ businessId: business.id, founderId, url });
    if (result.state === 'synced' || result.state === 'partial') mark(founderId, business.id, 'arc_source_added', { url, type: 'website' });
    await reply.status(200).send({ state: result.state, pagesRead: result.pagesRead, error: result.error }); // web shows added ✓ / the real reason
  });

  // PASTE A LINK — fetch one arbitrary URL + extract its text (declared). Also the catch-all for "anything else".
  server.post('/v1/businesses/:id/arc/source/link', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const url = ((request.body as { url?: string })?.url ?? '').trim();
    if (!url) throw new ValidationError('URL_REQUIRED', 'A link is required.');
    const doc = await fetchDocument(url, { timeoutMs: 12000 });
    if (!doc.ok || !doc.body) { await reply.status(200).send({ state: 'failed', error: `I couldn't reach that link (${doc.error ?? 'no response'}).` }); return; }
    const text = extractReadableText(doc.body);
    if (!text.trim()) { await reply.status(200).send({ state: 'empty', error: 'I reached the link but found no readable text.' }); return; }
    let host = url; try { host = new URL(doc.finalUrl || url).host.replace(/^www\./, ''); } catch { /* keep the raw url as label */ }
    const { stored } = await deps.learnBusinessService.ingestTextForPourIn({
      businessId: business.id, founderId, source: 'founder_supplied', provenance: 'declared',
      items: [{ ref: `Link: ${host}`, url: doc.finalUrl || url, text, pageType: 'link' }],
    });
    if (stored > 0) mark(founderId, business.id, 'arc_source_added', { url, type: 'link' });
    await reply.status(200).send({ state: stored > 0 ? 'synced' : 'empty' });
  });

  // INSTAGRAM — read the founder's connected account (OAuth done via /api/sources/instagram/connect) and ingest
  // its profile + post captions as OBSERVED evidence (same lane as the website). needsAuth ⇒ connect first.
  server.post('/v1/businesses/:id/arc/source/instagram', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const ig = getInstagramConnector();
    if (!ig) { await reply.status(200).send({ state: 'failed', error: 'Instagram is not configured.' }); return; }
    if ((await ig.status(founderId)) !== 'connected') { await reply.status(200).send({ state: 'failed', needsAuth: true, error: 'Connect your Instagram first.' }); return; }
    try {
      const account = await ig.importAccount(founderId, { maxPosts: 12 });
      const username = account.username ?? 'instagram';
      const profileUrl = `https://instagram.com/${username}`;
      const items: { ref: string; url: string; text: string; pageType: string }[] = [];
      const profileBits = [
        `Instagram @${username}.`,
        account.followersCount != null ? `${account.followersCount} followers.` : '',
        account.mediaCount != null ? `${account.mediaCount} posts.` : '',
        account.accountType ? `Account type: ${account.accountType}.` : '',
      ].filter(Boolean).join(' ');
      if (profileBits.trim()) items.push({ ref: `Instagram (@${username})`, url: profileUrl, text: profileBits, pageType: 'instagram_profile' });
      account.posts.forEach((post, i) => {
        const caption = (post.caption ?? '').trim();
        if (!caption) return;
        const eng = [post.likes != null ? `${post.likes} likes` : '', post.comments != null ? `${post.comments} comments` : '', post.reach != null ? `reach ${post.reach}` : ''].filter(Boolean).join(', ');
        items.push({ ref: `Instagram post ${i + 1}`, url: post.permalink || `${profileUrl}/p/${post.postExternalId}`, text: eng ? `${caption}\n(${eng})` : caption, pageType: 'instagram_post' });
      });
      const { stored } = await deps.learnBusinessService.ingestTextForPourIn({ businessId: business.id, founderId, source: 'instagram', provenance: 'observed', items });
      if (stored > 0) mark(founderId, business.id, 'arc_source_added', { url: `@${username}`, type: 'instagram' });
      await reply.status(200).send({ state: stored > 0 ? 'synced' : 'empty', error: stored > 0 ? undefined : 'I connected but found no post captions to read.' });
    } catch (e) {
      await reply.status(200).send({ state: 'failed', error: e instanceof Error ? e.message : 'Instagram read failed.' });
    }
  });

  // PDF / DOCX / TEXT upload — extract text (declared). Multipart is scoped to this route (mirrors the
  // business-intelligence file route) so it never collides with the JSON body parser on the other routes.
  server.register(async (scope) => {
    await scope.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } });
    scope.post('/v1/businesses/:id/arc/source/file', async (request: FastifyRequest, reply: FastifyReply) => {
      const { founderId, business } = await requireBusiness(request);
      const file = await request.file();
      if (!file) throw new ValidationError('FILE_REQUIRED', 'A file is required.');
      const bytes = await file.toBuffer();
      assertWithinBounds(bytes);
      const type = detectType(bytes);
      if (type === 'unsupported') throw new ValidationError('UNSUPPORTED_FILE', 'That file type is not supported. Upload a PDF, Word, or text file.');
      const doc = type === 'pdf' ? await extractPdf(bytes, file.filename) : type === 'docx' ? await extractDocx(bytes, file.filename) : extractText(bytes, file.filename);
      const slug = (file.filename.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60)) || 'file';
      const items = doc.units.slice(0, 20).map((u, i) => ({ ref: `${file.filename} · ${u.anchor.label}`, url: `founder://file/${slug}/${i + 1}`, text: u.text, pageType: 'founder_supplied' }));
      const { stored } = await deps.learnBusinessService.ingestTextForPourIn({ businessId: business.id, founderId, source: 'founder_supplied', provenance: 'declared', items });
      if (stored > 0) mark(founderId, business.id, 'arc_source_added', { url: file.filename, type });
      await reply.status(200).send({ state: stored > 0 ? 'synced' : 'empty', error: stored > 0 ? undefined : 'That file had no readable text.' });
    });
  });

  // ── flag-only transitions (each records a durable marker, then returns the fresh view) ──
  const flagRoute = (path: string, type: FounderEventType) =>
    server.post(`/v1/businesses/:id/arc/${path}`, async (request: FastifyRequest, reply: FastifyReply) => {
      const { founderId, business, language } = await requireBusiness(request);
      mark(founderId, business.id, type);
      await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
    });
  // Moment 1 → 2: "Done adding — start" — the BRIDGE fires here, synthesizing ONE understanding snapshot over
  // the union of every poured-in source, THEN the durable phase flag advances the arc.
  server.post('/v1/businesses/:id/arc/pour-in/done', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    await deps.learnBusinessService.bridgePourIn({ businessId: business.id, founderId, businessName: business.name, interfaceLanguage: language });
    mark(founderId, business.id, 'arc_pour_in_done');
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });

  flagRoute('understanding/confirm', 'arc_understanding_confirmed'); // Moment 3 → 4
  flagRoute('email/export', 'arc_email_exported');          // Moment 8 → 9
  flagRoute('container/seen', 'arc_container_seen');        // Moment 9 → done

  // ── Moment 2: the few words while BB reads (reuses the conversation engine) ──
  server.post('/v1/businesses/:id/arc/reading', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const message = ((request.body as { message?: string })?.message ?? '').trim();
    if (message) {
      await deps.conversationService.startOrResume(business.id, founderId, business.name, language);
      await deps.conversationService.submitResponse(business.id, founderId, business.name, message, language);
    }
    mark(founderId, business.id, 'arc_reading_done');
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });

  // ── Moment 4: the conversation (reuses the conversation engine; advances to mirror when ready) ──
  server.post('/v1/businesses/:id/arc/conversation', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const message = ((request.body as { message?: string })?.message ?? '').trim();
    if (!message) throw new ValidationError('MESSAGE_REQUIRED', 'A message is required.');
    await deps.conversationService.startOrResume(business.id, founderId, business.name, language);
    await deps.conversationService.submitResponse(business.id, founderId, business.name, message, language);
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });

  // ── Moment 5: the founder answers the mirror (optional words captured), then it's seen ──
  server.post('/v1/businesses/:id/arc/mirror/seen', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const answer = ((request.body as { answer?: string })?.answer ?? '').trim();
    if (answer) {
      await deps.conversationService.startOrResume(business.id, founderId, business.name, language);
      await deps.conversationService.submitResponse(business.id, founderId, business.name, answer, language);
    }
    mark(founderId, business.id, 'arc_mirror_seen');
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });

  // ── Moment 6: adopt / challenge the strategy (reuses the strategy engine) ──
  server.post('/v1/businesses/:id/arc/strategy/adopt', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const versionId = ((request.body as { versionId?: string })?.versionId ?? '').trim();
    if (!versionId) throw new ValidationError('VERSION_REQUIRED', 'versionId is required.');
    await deps.strategyService.adopt(business.id, versionId, founderId);
    mark(founderId, business.id, 'strategy_adopted', {});
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });
  server.post('/v1/businesses/:id/arc/strategy/challenge', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const statement = ((request.body as { statement?: string })?.statement ?? '').trim();
    if (!statement) throw new ValidationError('STATEMENT_REQUIRED', 'A statement is required.');
    await deps.strategyService.recordFounderInput(business.id, founderId, business.name, 'constraint', statement, language);
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });

  // ── Moment 7: adopt the week/day plan (reuses the plan engine) ──
  server.post('/v1/businesses/:id/arc/week-day/adopt', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    let plan = await deps.planService.getLatestProposed(business.id);
    if (!plan) plan = await deps.planService.generateProposedPlan(business.id);
    if (plan) await deps.planService.acceptPlan(business.id, plan.planVersionId);
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });

  // ── Moment 8: draft / save the email (the one new engine) ──
  server.post('/v1/businesses/:id/arc/email/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const email = await deps.arcService.draftEmail(business.id, business.name, language);
    mark(founderId, business.id, 'arc_email_saved', { subject: email.subject, body: email.body.slice(0, 1600) });
    await reply.status(200).send({ email });
  });
  server.post('/v1/businesses/:id/arc/email/save', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const b = (request.body ?? {}) as { subject?: string; body?: string };
    const subject = (b.subject ?? '').trim(); const body = (b.body ?? '').trim();
    if (!subject || !body) throw new ValidationError('EMAIL_REQUIRED', 'The email needs a subject and a body.');
    mark(founderId, business.id, 'arc_email_saved', { subject, body: body.slice(0, 1600) });
    await reply.status(200).send({ ok: true });
  });
}
