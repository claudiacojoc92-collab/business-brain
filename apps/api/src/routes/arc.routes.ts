import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import type { ServerDeps } from '../server';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import { fetchDocument, extractReadableText } from '@bb/infrastructure';
import { recordFounderEvent, recordFounderEventAwaited, readArcFlags, readArcSources, readArcEmail, recordArcCorrectionReflection, readArcCorrectionReflection, recordArcMirror, readArcMirror, type FounderEventType } from '../telemetry/founder-events';
import { detectType, assertWithinBounds, MAX_BYTES } from '../connectors/upload/detect';
import { extractPdf, extractDocx, extractText } from '../connectors/upload/extract';
import { contentLanguageFor, noteFounderText } from './content-language';
import { getInstagramConnector } from '../connectors/instagram/instagram-connector.instance';
import { fileSourceSlug } from '@bb/application';

// How many recent Instagram posts the pour-in reads (2 media pages of 25 + one reach-insights call per post).
const IG_POURIN_MAX_POSTS = 50;

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
    return { founderId, business, language: await contentLanguageFor(deps.contentLanguageStore, business.id, account?.interfaceLocale) };
  }

  async function viewFor(businessId: string, businessName: string, language: string, founderId: string) {
    const ig = getInstagramConnector();
    const [flags, sources, email, reflection, savedMirror, igState] = await Promise.all([
      readArcFlags(deps.db, businessId, founderId),
      readArcSources(deps.db, businessId, founderId),
      readArcEmail(deps.db, businessId, founderId),
      readArcCorrectionReflection(deps.db, businessId, founderId),
      readArcMirror(deps.db, businessId, founderId),
      ig ? ig.status(founderId).catch(() => 'disconnected' as const) : Promise.resolve('disconnected' as const),
    ]);
    const connected = igState === 'connected';
    let view = await deps.arcService.view(businessId, businessName, language, flags, sources, email, connected, savedMirror);

    // Persist a freshly-built mirror contrast so it is STABLE across refresh and not re-generated on every view.
    if (view.moment === 'mirror' && !savedMirror && view.mirror) recordArcMirror(deps.db, founderId, businessId, view.mirror);

    // Moment 4 opener is generated LAZILY on view (startOrResume runs otherwise only on a POST). WRAPPED so a model
    // failure here is a PER-MOMENT error (the founder retries the conversation), never a whole-arc surface failure.
    if (view.moment === 'conversation' && (view.turns?.length ?? 0) === 0) {
      try {
        await deps.conversationService.startOrResume(businessId, founderId, businessName, language);
        view = await deps.arcService.view(businessId, businessName, language, flags, sources, email, connected, savedMirror);
      } catch {
        view = { ...view, error: { kind: 'generation' } };
      }
    }

    // The Moment 3 reply is durable: if the founder has corrected, re-attach the persisted reflection so a
    // refresh re-shows the reflection + its question (they clear only when the founder confirms → the moment advances).
    return view.moment === 'understanding' && reflection ? { ...view, correctionReflection: reflection } : view;
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
    if (result.state === 'synced' || result.state === 'partial') mark(founderId, business.id, 'arc_source_added', { url, type: 'website', detail: result.pagesRead > 0 ? `${result.pagesRead} page${result.pagesRead === 1 ? '' : 's'} read` : 'added' });
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
      items: [{ ref: `Link: ${host}`, url: doc.finalUrl || url, text, pageType: 'link', meta: { sourceKey: url } }],
    });
    if (stored > 0) mark(founderId, business.id, 'arc_source_added', { url, type: 'link', detail: host });
    await reply.status(200).send({ state: stored > 0 ? 'synced' : 'empty' });
  });

  // DESCRIBE IN TEXT — the founder types what their business is, in their own words (DECLARED). The no-source exit:
  // a founder with no website and an unreadable file can still give BB something to work with. Error is a CODE.
  server.post('/v1/businesses/:id/arc/source/text', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const text = ((request.body as { text?: string })?.text ?? '').trim();
    if (!text) throw new ValidationError('TEXT_REQUIRED', 'A description is required.');
    const { stored } = await deps.learnBusinessService.ingestTextForPourIn({
      businessId: business.id, founderId, source: 'founder_supplied', provenance: 'declared',
      items: [{ ref: 'Your description', url: 'founder://text', text, pageType: 'founder_supplied' }],
    });
    if (stored > 0) mark(founderId, business.id, 'arc_source_added', { url: 'Your description', type: 'description' });
    await reply.status(200).send({ state: stored > 0 ? 'synced' : 'empty', error: stored > 0 ? undefined : 'FILE_NO_TEXT' });
  });

  // INSTAGRAM — read the founder's connected account (OAuth done via /api/sources/instagram/connect) and ingest
  // its profile + post captions as OBSERVED evidence (same lane as the website). needsAuth ⇒ connect first.
  server.post('/v1/businesses/:id/arc/source/instagram', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const ig = getInstagramConnector();
    if (!ig) { await reply.status(200).send({ state: 'failed', error: 'IG_NOT_CONFIGURED' }); return; }
    if ((await ig.status(founderId)) !== 'connected') { await reply.status(200).send({ state: 'failed', needsAuth: true, error: 'IG_NOT_CONNECTED' }); return; }
    try {
      const account = await ig.importAccount(founderId, { maxPosts: IG_POURIN_MAX_POSTS });
      const username = account.username ?? 'instagram';
      const profileUrl = `https://instagram.com/${username}`;
      // `meta` keeps the structured fields next to the text so synthesis can build its one Instagram summary
      // (date · caption · likes, comments) without re-parsing prose.
      const items: { ref: string; url: string; text: string; pageType: string; meta?: Record<string, unknown> }[] = [];
      const profileBits = [
        `Instagram @${username}.`,
        account.followersCount != null ? `${account.followersCount} followers.` : '',
        account.mediaCount != null ? `${account.mediaCount} posts.` : '',
        account.accountType ? `Account type: ${account.accountType}.` : '',
      ].filter(Boolean).join(' ');
      if (profileBits.trim()) items.push({ ref: `Instagram (@${username})`, url: profileUrl, text: profileBits, pageType: 'instagram_profile',
        meta: { username, followersCount: account.followersCount, mediaCount: account.mediaCount, accountType: account.accountType } });
      account.posts.forEach((post, i) => {
        const caption = (post.caption ?? '').trim();
        if (!caption) return;
        const eng = [post.likes != null ? `${post.likes} likes` : '', post.comments != null ? `${post.comments} comments` : '', post.reach != null ? `reach ${post.reach}` : ''].filter(Boolean).join(', ');
        items.push({ ref: `Instagram post ${i + 1}`, url: post.permalink || `${profileUrl}/p/${post.postExternalId}`, text: eng ? `${caption}\n(${eng})` : caption, pageType: 'instagram_post',
          meta: { caption, postedAt: post.postedAt, likes: post.likes, comments: post.comments } });
      });
      const { stored } = await deps.learnBusinessService.ingestTextForPourIn({ businessId: business.id, founderId, source: 'instagram', provenance: 'observed', items });
      const postCount = items.filter((it) => it.pageType === 'instagram_post').length;
      if (stored > 0) mark(founderId, business.id, 'arc_source_added', { url: `@${username}`, type: 'instagram', detail: `${postCount} post${postCount === 1 ? '' : 's'} read` });
      await reply.status(200).send({ state: stored > 0 ? 'synced' : 'empty', error: stored > 0 ? undefined : 'IG_NO_CAPTIONS' });
    } catch (e) {
      await reply.status(200).send({ state: 'failed', error: 'IG_READ_FAILED' });
    }
  });

  // PDF / DOCX / TEXT upload — extract text (declared). ONE file per request; the web fires one request per
  // selected file so each becomes its own source with its own ✓/error. Multipart is scoped to this route so it
  // never collides with the JSON body parser. Every failure returns a SPECIFIC message as a 200 body (the prod
  // error-handler masks thrown errors to "An error occurred.", so specific reasons must be returned, not thrown).
  const TOO_LARGE = 'FILE_TOO_LARGE';
  server.register(async (scope) => {
    await scope.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } });
    scope.post('/v1/businesses/:id/arc/source/file', async (request: FastifyRequest, reply: FastifyReply) => {
      const { founderId, business } = await requireBusiness(request);
      let file;
      try { file = await request.file(); }
      catch { await reply.status(200).send({ state: 'failed', error: TOO_LARGE }); return; }
      if (!file) { await reply.status(200).send({ state: 'failed', error: 'FILE_NONE' }); return; }

      let bytes: Buffer;
      try { bytes = await file.toBuffer(); }
      catch { await reply.status(200).send({ state: 'failed', error: TOO_LARGE }); return; } // multipart throws when it exceeds the fileSize limit
      try { assertWithinBounds(bytes); }
      catch { await reply.status(200).send({ state: 'failed', error: TOO_LARGE }); return; }

      const type = detectType(bytes);
      if (type === 'unsupported') { await reply.status(200).send({ state: 'failed', error: 'FILE_UNSUPPORTED' }); return; }

      let doc;
      try { doc = type === 'pdf' ? await extractPdf(bytes, file.filename) : type === 'docx' ? await extractDocx(bytes, file.filename) : extractText(bytes, file.filename); }
      catch { await reply.status(200).send({ state: 'failed', error: 'FILE_UNREADABLE' }); return; }

      const slug = fileSourceSlug(file.filename);
      const items = doc.units.slice(0, 20).map((u, i) => ({ ref: `${file.filename} · ${u.anchor.label}`, url: `founder://file/${slug}/${i + 1}`, text: u.text, pageType: 'founder_supplied', meta: { sourceKey: file.filename } }));
      const { stored } = await deps.learnBusinessService.ingestTextForPourIn({ businessId: business.id, founderId, source: 'founder_supplied', provenance: 'declared', items });
      if (stored > 0) {
        const partWord = type === 'pdf' ? 'page' : 'section';
        mark(founderId, business.id, 'arc_source_added', { url: file.filename, type, detail: `${doc.units.length} ${partWord}${doc.units.length === 1 ? '' : 's'} read` });
        await reply.status(200).send({ state: 'synced' });
        return;
      }
      // Reached the file but extracted no text. For a PDF this is almost always a scanned/image-only PDF.
      await reply.status(200).send({
        state: 'empty',
        error: type === 'pdf' ? 'FILE_PDF_IMAGE' : 'FILE_NO_TEXT',
      });
    });
  });

  // ── flag-only transitions (each records a durable marker, then returns the fresh view) ──
  const flagRoute = (path: string, type: FounderEventType) =>
    server.post(`/v1/businesses/:id/arc/${path}`, async (request: FastifyRequest, reply: FastifyReply) => {
      const { founderId, business, language } = await requireBusiness(request);
      // Awaited: the view below derives the moment from this very flag (fire-and-forget raced it, so a confirm
      // could come back still showing the old moment until the next reload).
      await recordFounderEventAwaited(deps.db, { accountId: founderId, businessId: business.id, eventType: type, surface: 'arc' });
      await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
    });
  // Moment 1 → 2: "Done adding — start" — the BRIDGE fires here, synthesizing ONE understanding snapshot over
  // the union of every poured-in source, THEN the durable phase flag advances the arc.
  server.post('/v1/businesses/:id/arc/pour-in/done', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    // The bridge can THROW (synthesis malformed / model error) or return EMPTY (no readable text anywhere). In
    // BOTH cases the arc must NOT advance into a hollow understanding — stay at pour-in and tell the founder to
    // fix/retry their sources. The flag is marked ONLY on a real snapshot.
    let result;
    try {
      result = await deps.learnBusinessService.bridgePourIn({ businessId: business.id, founderId, businessName: business.name, interfaceLanguage: language });
    } catch {
      const view = await viewFor(business.id, business.name, language, founderId); // still pour_in (flag unmarked)
      await reply.status(200).send({ ...view, error: { kind: 'pourin_failed' } });
      return;
    }
    if (result.state === 'empty' || !result.understandingId) {
      const view = await viewFor(business.id, business.name, language, founderId);
      await reply.status(200).send({ ...view, error: { kind: 'pourin_empty' } });
      return;
    }
    // Back from a later moment with changed sources: this is a RE-READ. The new understanding needs the founder's
    // review again (progress is kept: conversation answers, an adopted strategy and the plan all stay), and an
    // adopted strategy is checked against it by the existing impact evaluator (never re-adopted automatically).
    const before = await readArcFlags(deps.db, business.id, founderId);
    if (before.pourInDone) {
      await recordFounderEventAwaited(deps.db, { accountId: founderId, businessId: business.id, eventType: 'arc_understanding_reopened', surface: 'arc' });
    } else {
      await recordFounderEventAwaited(deps.db, { accountId: founderId, businessId: business.id, eventType: 'arc_pour_in_done', surface: 'arc' });
    }
    const view = await viewFor(business.id, business.name, language, founderId);
    if (before.pourInDone) void checkStrategyAgainstNewSources(founderId, business.id, business.name, language, view);
    await reply.status(200).send(view);
  });

  // An adopted strategy meets the re-read business: run the living-state impact check in the background (it is a
  // model call; the founder is already reviewing the new understanding). The verdict lands as an impact_evaluated
  // event, which the home "what changed" surfaces already read. Failures never reach the founder.
  async function checkStrategyAgainstNewSources(founderId: string, businessId: string, businessName: string, language: string, view: Awaited<ReturnType<typeof viewFor>>): Promise<void> {
    try {
      const current = await deps.strategyService.getCurrent(businessId);
      if (!current) return;
      const sources = await readArcSources(deps.db, businessId, founderId);
      const u = view.understanding;
      const text = [
        `The founder changed the business's sources and BB re-read them. Sources now: ${sources.map((x) => `${x.url} (${x.type})`).join(', ') || 'none'}.`,
        u ? `Updated understanding: what it does: ${u.does} Who it serves: ${u.serves} What stands out: ${u.standsOut}` : '',
      ].filter(Boolean).join('\n');
      let currentMove: { actionId: string; what: string } | null = null;
      try { const first = (await deps.planService.today(businessId))?.ready?.[0]; if (first) currentMove = { actionId: first.actionId, what: first.what }; } catch { /* no plan */ }
      const { result, newVersion } = await deps.impactService.evaluate(businessId, founderId, businessName, 'add_context', text, language, { persistInput: false, currentMove });
      recordFounderEvent(deps.db, {
        accountId: founderId, businessId, eventType: 'impact_evaluated', surface: 'add_context',
        metadata: {
          verdict: result.verdict, source: 'add_context', whatChanged: result.whatChanged.slice(0, 4),
          todayChanges: result.todayImpact.changes, todayReason: result.todayImpact.reason ?? '', newMove: result.todayImpact.newMove,
          strategyChanges: result.strategyImpact.changes, newVersionId: newVersion?.id ?? null,
        },
      });
    } catch (e) {
      server.log.warn({ err: e instanceof Error ? e.message : 'impact failed' }, 'arc re-read impact check');
    }
  }

  // The source list at ANY moment (the pour-in screen re-opened from later in the arc, or from Home).
  server.get('/v1/businesses/:id/arc/sources', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const ig = getInstagramConnector();
    const [sources, igState] = await Promise.all([
      readArcSources(deps.db, business.id, founderId),
      ig ? ig.status(founderId).catch(() => 'disconnected' as const) : Promise.resolve('disconnected' as const),
    ]);
    await reply.status(200).send({ sources, igConnected: igState === 'connected' });
  });

  // REMOVE a source: unlink its fragments from the business (the ledger keeps them) and drop it from the list.
  server.post('/v1/businesses/:id/arc/source/remove', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const body = (request.body ?? {}) as { url?: string; type?: string };
    const url = (body.url ?? '').trim();
    const type = (body.type ?? '').trim();
    if (!url || !type) throw new ValidationError('SOURCE_REQUIRED', 'Which source should I remove?');
    const listed = (await readArcSources(deps.db, business.id, founderId)).find((x) => x.url === url && x.type === type);
    if (!listed) throw new NotFoundError('SOURCE_NOT_FOUND', 'That source is not on this business.');
    const { unlinked } = await deps.learnBusinessService.unlinkPourInSource({ businessId: business.id, founderId, source: { url, type } });
    await recordFounderEventAwaited(deps.db, { accountId: founderId, businessId: business.id, eventType: 'arc_source_removed', surface: 'arc', metadata: { url, type, unlinked } });
    await reply.status(200).send({ removed: true, unlinked, sources: await readArcSources(deps.db, business.id, founderId) });
  });

  // Moment 3: the founder corrects what BB understood. HELD as founder-owned state (business_correction),
  // deterministically — NO conversation model step (that belongs to Moment 4 and could fail/advance the
  // interview prematurely). Returns the fresh view; the moment stays 'understanding' and the web acknowledges it.
  server.post('/v1/businesses/:id/arc/understanding/correct', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const statement = ((request.body as { message?: string })?.message ?? '').trim();
    if (!statement) throw new ValidationError('MESSAGE_REQUIRED', 'A correction is required.');
    await deps.businessCorrectionService.record(business.id, founderId, 'understanding', statement, language);
    // The SUBSTANTIVE reply (what BB understood / what it changes / what still holds / what else) — grounded in
    // the correction + the current understanding, generated fresh. Fails safe (never throws).
    const correctionReflection = await deps.arcService.reflectCorrection(business.id, business.name, language, statement);
    recordArcCorrectionReflection(deps.db, founderId, business.id, correctionReflection); // persist → survives refresh
    const view = await viewFor(business.id, business.name, language, founderId);
    await reply.status(200).send({ ...view, correctionReflection }); // fresh reflection on the immediate response (no read-after-write race)
  });

  flagRoute('understanding/confirm', 'arc_understanding_confirmed'); // Moment 3 → 4
  flagRoute('email/export', 'arc_email_exported');          // Moment 8 → 9
  flagRoute('container/seen', 'arc_container_seen');        // Moment 9 → done

  // (No "reading" route: after pour-in/done the bridge synthesizes during a UI progress state and the arc lands
  //  straight on 'understanding' — the founder is never asked to describe the business before BB shows what it read.)

  // ── Moment 3: the conversation (reuses the conversation engine; advances to mirror when ready) ──
  server.post('/v1/businesses/:id/arc/conversation', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language: current } = await requireBusiness(request);
    const body = (request.body ?? {}) as { message?: string; skip?: boolean };
    const message = (body.message ?? '').trim();
    if (!body.skip && !message) throw new ValidationError('MESSAGE_REQUIRED', 'A message is required.');
    const language = message ? await noteFounderText(deps.contentLanguageStore, business.id, message, current) : current;
    await deps.conversationService.startOrResume(business.id, founderId, business.name, language);
    // FIX 3 / Addition 1 — one-tap skip: decline the current question's need FIRST (deterministic, so the depth cap
    // never re-forces it), then let the interview move on. The founder's (localized) message carries the skip.
    if (body.skip) {
      await deps.conversationService.declineCurrentNeed(business.id);
      mark(founderId, business.id, 'talk_turn_submitted', { skip: true });
    }
    await deps.conversationService.submitResponse(business.id, founderId, business.name, message || '(skip)', language);
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
    // recordFounderInput holds the challenge as a constraint and REGENERATES the proposal, so the bet the founder
    // sees next already reflects it. Surface a transient "the bet changed because you said X" note on this response.
    await deps.strategyService.recordFounderInput(business.id, founderId, business.name, 'constraint', statement, language);
    const view = await viewFor(business.id, business.name, language, founderId);
    await reply.status(200).send({ ...view, strategyChange: { because: statement } });
  });

  // ── Goal confirmation (reflect-back). The founder confirms (optionally edits) the goal we reflected from their
  //    own words; it is written DIRECTLY as kind='goal' (never re-classified), then the arc re-derives — strategy
  //    now has its goal and generates. Reachable from wherever need_goal appeared; no trip back through the gate.
  server.post('/v1/businesses/:id/arc/goal', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    const body = (request.body ?? {}) as { statement?: string; fromStateId?: string };
    const statement = (body.statement ?? '').trim();
    const fromStateId = (body.fromStateId ?? '').trim() || null;
    if (!statement) throw new ValidationError('GOAL_REQUIRED', 'A goal is required.');
    await deps.conversationService.setGoal(business.id, founderId, statement, language);
    mark(founderId, business.id, 'goal_confirmed', { fromCandidate: Boolean(fromStateId), edited: Boolean(fromStateId), length: statement.length });
    await reply.status(200).send(await viewFor(business.id, business.name, language, founderId));
  });

  // ── Moment 7: adopt the week/day plan (reuses the plan engine) ──
  server.post('/v1/businesses/:id/arc/week-day/adopt', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business, language } = await requireBusiness(request);
    let plan = await deps.planService.getLatestProposed(business.id);
    if (!plan) plan = await deps.planService.generateProposedPlan(business.id);
    if (!plan) {
      // Fail-closed: no plan could be produced. Surface the generation error EXPLICITLY — never a silent no-op
      // that leaves the founder on the same screen as if the adopt did nothing.
      const view = await viewFor(business.id, business.name, language, founderId);
      await reply.status(200).send({ ...view, error: { kind: 'generation' } });
      return;
    }
    await deps.planService.acceptPlan(business.id, plan.planVersionId);
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
