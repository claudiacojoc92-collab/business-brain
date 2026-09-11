import {
  CommandBus,
  QueryBus,
  PgFounderProfileRepository,
  PgWeeklyCycleRepository,
  PgBusinessMemoryRepository,
  PgCampaignRepository,
  PgOutcomeReportRepository,
  PgEventStore,
  KyselyTransactionManager,
  JwtService,
  PasswordService,
  PgFounderAuthRepository,
  PgBusinessRepository,
  PgFounderAccountRepository,
  PgEvidenceRepository,
  PgBusinessEvidenceLinkRepository,
  PgDiscoveredProfileRepository,
  PgUnderstandingSnapshotRepository,
  PgAhaRepository,
  PgBusinessWebsiteRepository,
  PgRawCaptureRepository,
  PgObservationRepository,
  PgUnderstandingRevisionRepository,
  PgConversationRepository,
  PgInformationNeedRepository,
  PgFounderStateRepository,
  PgFounderObservationRepository,
  PgAha2Repository,
  PgStrategyRepository,
  PgStrategyPointerRepository,
  PgVoiceRepository,
  PgPlanRepository,
  PgCarouselRepository,
  PgPhotoLedRepository,
  PgReelRepository,
  ResvgCarouselRenderer,
  FfmpegReelRenderer,
  LocalObjectStore,
  S3ObjectStore,
  DeepgramTranscription,
  FakeTranscription,
  FsBlobStore,
  PgInternalBriefProjection,
  PgInternalBriefRepository,
  PgIntakeSessionRepository,
  PgFounderVoiceRepository,
  createLogger,
} from '@bb/infrastructure';
import type { KyselyDB } from '@bb/infrastructure';
import type { IInternalBriefRepository } from '@bb/domain';
import { SystemClock as UnderstandingClock } from '@bb/domain';
import { MemoryLayer, SystemClock, generateId } from '@bb/shared';

import {
  RegisterFounderHandler,
  StartIntakeHandler,
  SubmitIntakeSignalHandler,
  CompleteIntakeHandler,
  IntakeMemoryMapper,
  PauseFounderHandler,
  ResumeFounderHandler,
  UpdateOfferAvailabilityHandler,
  VersionOfferHandler,
  TriggerRecalibrationHandler,
  SubmitRecalibrationResponseHandler,
  CompleteRecalibrationHandler,
  StartWeeklyCycleHandler,
  CommitBriefHandler,
  ApproveContentHandler,
  EditAndApproveContentHandler,
  RejectContentHandler,
  ReportOutcomeHandler,
  SubmitFridaySignalHandler,
  InterruptCampaignHandler,
  GetFounderStatusHandler,
  GetIntakeStatusHandler,
  GetOfferHandler,
  GetRecalibrationStatusHandler,
  GetCurrentCycleHandler,
  GetCurrentReviewCycleHandler,
  GetCycleBriefHandler,
  GetContentForApprovalHandler,
  GetContentPieceForApprovalHandler,
  GetCycleHistoryHandler,
  GetBrainSnapshotHandler,
  GetMemoryConfidenceHandler,
  GetPatternsHandler,
  GetActiveCampaignHandler,
  AuthenticateFounderHandler,
  BusinessService,
  FounderAccountService,
  LearnBusinessService,
  ConversationService,
  BusinessCorrectionService,
  Aha2Service,
  StrategyService,
  VoiceService,
  allowedBusinessFacts,
  PlanService,
  CarouselService,
  resolveBrandContext,
  PhotoLedService,
  type CreateHandoff,
  type IDiscoveredProfileRepository,
  type IUnderstandingSnapshotRepository,
  type IAhaRepository,
} from '@bb/application';
import { WebsiteIngestionAdapter } from '@bb/infrastructure';
import { SocialDiscoveryAdapter } from '@bb/infrastructure';
import { AnthropicUnderstandingModel } from '@bb/infrastructure';
import { AnthropicConversationModel } from '@bb/infrastructure';
import { AnthropicAha2Model } from '@bb/infrastructure';
import { AnthropicStrategyModel } from '@bb/infrastructure';
import { AnthropicVoiceModel } from '@bb/infrastructure';
import { AnthropicPlanModel } from '@bb/infrastructure';
import { AnthropicCarouselModel } from '@bb/infrastructure';
import { AnthropicObservationModel, AnthropicOpportunityModel } from '@bb/infrastructure';
import { AnthropicVideoObservationModel, AnthropicReelOpportunityModel } from '@bb/infrastructure';
import { ReelService, ReelShootService } from '@bb/application';
import { PgReelShootRepository } from '@bb/infrastructure';
import { AnthropicConceptPlanModel } from '@bb/infrastructure';

export interface CompositionRoot {
  commandBus: CommandBus;
  queryBus:   QueryBus;
  internalBriefRepo: IInternalBriefRepository;
  jwtService: JwtService;
  passwordService: PasswordService;
  businessService: BusinessService;
  founderAccountService: FounderAccountService;
  learnBusinessService: LearnBusinessService;
  discoveredProfileRepo: IDiscoveredProfileRepository;
  understandingRepo: IUnderstandingSnapshotRepository;
  ahaRepo: IAhaRepository;
  conversationService: ConversationService;
  businessCorrectionService: BusinessCorrectionService;
  aha2Service: Aha2Service;
  strategyService: StrategyService;
  voiceService: VoiceService;
  planService: PlanService;
  carouselService: CarouselService;
  photoLedService: PhotoLedService;
  photoLedRepo: PgPhotoLedRepository;
  reelService: ReelService;
  reelObjectStore: import('@bb/application').IObjectStore;
  reelRepo: import('@bb/application').IReelRepository;
  reelShootService: ReelShootService;
  reelShootRepo: import('@bb/application').IReelShootRepository;
}

/**
 * Wires all dependencies and registers all handlers.
 * Called once at API startup.
 * Source: Repository Structure V1 Section 02.
 */
export function buildCompositionRoot(db: KyselyDB): CompositionRoot {
  // Infrastructure
  const founderRepo  = new PgFounderProfileRepository(db);
  const cycleRepo    = new PgWeeklyCycleRepository(db);
  const memoryRepo   = new PgBusinessMemoryRepository(db);
  const campaignRepo = new PgCampaignRepository(db);
  const outcomeRepo  = new PgOutcomeReportRepository(db);
  const authRepo     = new PgFounderAuthRepository(db);
  const eventStore   = new PgEventStore(db);
  const briefProjection = new PgInternalBriefProjection(db);
  const internalBriefRepo = new PgInternalBriefRepository(db);
  const intakeSessionRepo = new PgIntakeSessionRepository(db);
  const voiceRepo    = new PgFounderVoiceRepository(db);

  // A2: intake → Business Memory seeding. FOUNDATION* resolves to BUSINESS_EVOLUTION.
  // No founder-stated IntelligenceEventType exists, so intakeEventType is omitted:
  // layer payloads seed; the intelligence-event trail is skipped and the gap is logged.
  const intakeMemoryMapper = new IntakeMemoryMapper(
    memoryRepo,
    voiceRepo,
    new SystemClock(),
    createLogger({ service: 'intake-memory-mapper' }),
    { foundationLayer: MemoryLayer.BUSINESS_EVOLUTION },
  );

  // Default transaction manager (system context). Per-request RLS context
  // is applied by the transaction manager when a founder id is available.
  const defaultTxManager = new KyselyTransactionManager(
    db, 'system', 'system', 'system',
  );

  const commandBus = new CommandBus();
  const queryBus   = new QueryBus();

  // ── Founder commands ──────────────────────────────────────────────
  commandBus.register('RegisterFounder',
    new RegisterFounderHandler(founderRepo, eventStore, defaultTxManager));
  commandBus.register('StartIntake',
    new StartIntakeHandler(founderRepo, eventStore, defaultTxManager));
  commandBus.register('SubmitIntakeSignal',
    new SubmitIntakeSignalHandler(founderRepo, intakeSessionRepo));
  commandBus.register('CompleteIntake',
    new CompleteIntakeHandler(
      founderRepo, intakeSessionRepo, eventStore, defaultTxManager, intakeMemoryMapper));
  commandBus.register('PauseFounder',
    new PauseFounderHandler(founderRepo, eventStore, defaultTxManager));
  commandBus.register('ResumeFounder',
    new ResumeFounderHandler(founderRepo, eventStore, defaultTxManager));
  commandBus.register('UpdateOfferAvailability',
    new UpdateOfferAvailabilityHandler(founderRepo, eventStore, defaultTxManager));
  commandBus.register('VersionOffer',
    new VersionOfferHandler(founderRepo, eventStore, defaultTxManager));
  commandBus.register('TriggerRecalibration',
    new TriggerRecalibrationHandler(founderRepo, eventStore, defaultTxManager));
  commandBus.register('SubmitRecalibrationResponse',
    new SubmitRecalibrationResponseHandler(founderRepo, eventStore, defaultTxManager));
  commandBus.register('CompleteRecalibration',
    new CompleteRecalibrationHandler(founderRepo, eventStore, defaultTxManager));

  // ── Cycle commands ────────────────────────────────────────────────
  commandBus.register('StartWeeklyCycle',
    new StartWeeklyCycleHandler(founderRepo, cycleRepo, eventStore, defaultTxManager));
  commandBus.register('CommitBrief',
    new CommitBriefHandler(cycleRepo, eventStore, defaultTxManager, briefProjection));
  commandBus.register('ApproveContent',
    new ApproveContentHandler(cycleRepo, eventStore, defaultTxManager));
  commandBus.register('EditAndApproveContent',
    new EditAndApproveContentHandler(cycleRepo, eventStore, defaultTxManager));
  commandBus.register('RejectContent',
    new RejectContentHandler(cycleRepo, eventStore, defaultTxManager));
  commandBus.register('ReportOutcome',
    new ReportOutcomeHandler(outcomeRepo, eventStore, defaultTxManager));
  commandBus.register('SubmitFridaySignal',
    new SubmitFridaySignalHandler(cycleRepo, eventStore, defaultTxManager));
  commandBus.register('InterruptCampaign',
    new InterruptCampaignHandler(campaignRepo, eventStore, defaultTxManager));

  // ── Founder queries ───────────────────────────────────────────────
  queryBus.register('GetFounderStatus',
    new GetFounderStatusHandler(founderRepo));
  queryBus.register('GetIntakeStatus',
    new GetIntakeStatusHandler(founderRepo));
  queryBus.register('GetOffer',
    new GetOfferHandler(founderRepo));
  queryBus.register('GetRecalibrationStatus',
    new GetRecalibrationStatusHandler(founderRepo));
  queryBus.register('AuthenticateFounder',
    new AuthenticateFounderHandler(authRepo));

  // ── Cycle queries ─────────────────────────────────────────────────
  queryBus.register('GetCurrentCycle',
    new GetCurrentCycleHandler(cycleRepo));
  queryBus.register('GetCurrentReviewCycle',
    new GetCurrentReviewCycleHandler(cycleRepo));
  queryBus.register('GetCycleBrief',
    new GetCycleBriefHandler(cycleRepo, internalBriefRepo));
  queryBus.register('GetContentForApproval',
    new GetContentForApprovalHandler(cycleRepo));
  queryBus.register('GetContentPieceForApproval',
    new GetContentPieceForApprovalHandler(cycleRepo));
  queryBus.register('GetCycleHistory',
    new GetCycleHistoryHandler(cycleRepo));

  // ── Memory queries ────────────────────────────────────────────────
  queryBus.register('GetBrainSnapshot',
    new GetBrainSnapshotHandler(memoryRepo));
  queryBus.register('GetMemoryConfidence',
    new GetMemoryConfidenceHandler(memoryRepo));
  queryBus.register('GetPatterns',
    new GetPatternsHandler(memoryRepo));

  // ── Campaign queries ──────────────────────────────────────────────
  queryBus.register('GetActiveCampaign',
    new GetActiveCampaignHandler(campaignRepo));

  const jwtService = new JwtService(
    process.env['JWT_PRIVATE_KEY'] ?? '',
    process.env['JWT_PUBLIC_KEY']  ?? '',
  );
  const passwordService = new PasswordService();

  // ── Slice 0: Business + Membership tenancy seam and founder account service ──
  const businessService = new BusinessService(new PgBusinessRepository(db));
  const founderAccountService = new FounderAccountService(new PgFounderAccountRepository(db));

  // ── Slice 1: "BB learned my business" — website understanding + Aha ──
  const discoveredProfileRepo = new PgDiscoveredProfileRepository(db);
  const understandingRepo = new PgUnderstandingSnapshotRepository(db);
  const ahaRepo = new PgAhaRepository(db);
  const learnBusinessService = new LearnBusinessService({
    evidenceRepo: new PgEvidenceRepository(db),
    ingestion: new WebsiteIngestionAdapter(db),
    discovery: new SocialDiscoveryAdapter(),
    model: new AnthropicUnderstandingModel(process.env['ANTHROPIC_API_KEY'] ?? ''),
    links: new PgBusinessEvidenceLinkRepository(db),
    profiles: discoveredProfileRepo,
    understanding: understandingRepo,
    aha: ahaRepo,
    website: new PgBusinessWebsiteRepository(db),
    // Canonical understanding ledger — the bridge writes web_page observations here.
    rawCaptures: new PgRawCaptureRepository(db),
    observations: new PgObservationRepository(db),
    revisions: new PgUnderstandingRevisionRepository(db),
    clock: new UnderstandingClock(),
  });

  // ── Slice 2: founder conversation + founder model + Aha 2 ──
  const anthropicKey = process.env['ANTHROPIC_API_KEY'] ?? '';
  const convRepo = new PgConversationRepository(db);
  const founderStateRepo = new PgFounderStateRepository(db);
  const founderObsRepo = new PgFounderObservationRepository(db);
  const conversationService = new ConversationService({
    conversations: convRepo,
    needs: new PgInformationNeedRepository(db),
    state: founderStateRepo,
    observations: founderObsRepo,
    model: new AnthropicConversationModel(anthropicKey),
    understanding: understandingRepo,
    aha1: ahaRepo,
  });
  // M2 — Business corrections reuse the same founder_state the conversation already reads (no new store).
  const businessCorrectionService = new BusinessCorrectionService({ state: founderStateRepo });
  const aha2Service = new Aha2Service({
    understanding: understandingRepo,
    state: founderStateRepo,
    observations: founderObsRepo,
    conversations: convRepo,
    model: new AnthropicAha2Model(anthropicKey),
    aha2: new PgAha2Repository(db),
    // Repair-loop telemetry (never founder-facing) — used for reliability inspection.
    // eslint-disable-next-line no-console
    log: (e) => console.error('[aha2]', JSON.stringify(e)),
  });

  // ── Slice 3: strategy (Candidate → Proposal → Current) ──
  const strategyService = new StrategyService({
    understanding: understandingRepo,
    state: founderStateRepo,
    observations: founderObsRepo,
    aha1: ahaRepo,
    aha2: new PgAha2Repository(db),
    model: new AnthropicStrategyModel(anthropicKey),
    strategy: new PgStrategyRepository(db),
    pointer: new PgStrategyPointerRepository(db),
    // eslint-disable-next-line no-console
    log: (e) => console.error('[strategy]', JSON.stringify(e)),
  });

  // ── Slice 4: voice (example-grounded Voice Model + calibration) ──
  // One shared voice model: its proposition-preservation judge is the SINGLE Layer-3 authority, reused by
  // Slice-6 Carousel so there is no second/forked claim checker.
  const voiceModel = new AnthropicVoiceModel(anthropicKey);
  const voiceService = new VoiceService({
    voice: new PgVoiceRepository(db),
    model: voiceModel,
    understanding: understandingRepo,
    currentStrategy: async (bid) => {
      const cur = await strategyService.getCurrent(bid);
      if (!cur) return null;
      const c = cur.record.bundle.core; const br = cur.record.bundle.branch;
      return { diagnosis: c.diagnosis, coreBet: c.coreBet.priority, messagingDirection: br.messagingDirection, contentRole: br.contentRole, audience: c.audiencePrimaryForGoal, ctaDirection: br.ctaDirection };
    },
    // Founder-owned facts (declaration authority only) — never a substitute for governed business evidence.
    founderFacts: async (bid) => (await founderStateRepo.listActive(bid)).filter((s) => s.kind !== 'business_correction').map((s) => s.statement),
    // eslint-disable-next-line no-console
    log: (e) => console.error('[voice]', JSON.stringify(e)),
  });

  // ── Slice 5: plan (Current Strategy → 30-day execution plan → adoption → Today) ──
  const planRepo = new PgPlanRepository(db);
  const planService = new PlanService({
    plan: planRepo,
    model: new AnthropicPlanModel(anthropicKey),
    currentStrategy: async (bid) => {
      const cur = await strategyService.getCurrent(bid);
      if (!cur) return null;
      const c = cur.record.bundle.core; const br = cur.record.bundle.branch;
      const licensedMaterial = [c.offerDirection, c.positioningDirection, ...(await founderStateRepo.listActive(bid)).filter((s) => s.kind !== 'business_correction').map((s) => s.statement)].map((s) => s.trim()).filter(Boolean);
      return {
        strategyVersionId: cur.record.id, goal: c.goal, coreBet: c.coreBet.priority,
        decisions: cur.record.bundle.decisions.map((d) => d.title).filter(Boolean),
        audience: c.audiencePrimaryForGoal, ctaDirection: br.ctaDirection,
        licensedMaterial,
        // No governed numeric/date target source on the strategy bundle yet ⇒ the planner may introduce none.
        authorizedNumbers: [],
        // No typed licensed-numeric-fact source yet (Strategy exposes none) ⇒ empty until one exists.
        licensedNumericFacts: [],
      };
    },
    // Resource envelope derived from the adopted strategy's constraints/resources/channels (no new questionnaire).
    founderIntelligence: async (bid) => {
      const cur = await strategyService.getCurrent(bid);
      if (!cur) return {};
      const c = cur.record.bundle.core; const br = cur.record.bundle.branch;
      return {
        channels: br.channelPriorities.map((cp) => cp.channel).filter(Boolean),
        constraints: [...c.founderConstraints].filter(Boolean),
        resources: [...c.resourceEnvelope].filter(Boolean),
      };
    },
    // eslint-disable-next-line no-console
    log: (e) => console.error('[plan]', JSON.stringify(e)),
  });

  // ── Slice 6: carousel (CreateHandoff → governed asset-level copy → deterministic render → export) ──
  const carouselRepo = new PgCarouselRepository(db);
  // Carousel governance context — reused by both the carousel service (claim authority) and the Slice-6.1
  // photo-led recommender (strategy conditioning). Photos NEVER add to this; claim authority stays here.
  const carouselContext = async (bid: string) => {
      const cur = await strategyService.getCurrent(bid);
      if (!cur) return null;
      const c = cur.record.bundle.core; const br = cur.record.bundle.branch;
      const active = await founderStateRepo.listActive(bid);
      const proofFacts = active.filter((s) => s.kind === 'resource').map((s) => s.statement.trim()).filter(Boolean);
      const founderProps = active.filter((s) => s.kind !== 'business_correction' && s.kind !== 'resource').map((s) => s.statement.trim()).filter(Boolean);
      // M5.5 — active founder business CORRECTIONS are founder-authoritative world FACTS (e.g. "we offer one
      // fixed-price starter audit"). They must be licensable so the carousel can state them, exactly as M3.5
      // routes them into Strategy. (Only ACTIVE corrections; superseded ones are already excluded upstream.)
      const founderCorrections = active.filter((s) => s.kind === 'business_correction').map((s) => s.statement.trim()).filter(Boolean);
      const snap = await understandingRepo.latest(bid);
      const businessEvidence = allowedBusinessFacts(snap?.understanding ?? null);
      const licensedPropositions = [
        ...businessEvidence.map((t, i) => ({ ref: `B${i + 1}`, text: t, source: 'business_evidence' as const })),
        ...founderCorrections.map((t, i) => ({ ref: `C${i + 1}`, text: t, source: 'founder_owned' as const })),
        ...founderProps.map((t, i) => ({ ref: `F${i + 1}`, text: t, source: 'founder_owned' as const })),
      ];
      let voiceLines: string[] = [];
      try { const p = await voiceService.projection(bid, 'brand', 'en'); if (p.calibrated) voiceLines = p.lines; } catch { /* uncalibrated */ }
      const mediaPool = await carouselRepo.listMedia(bid);
      const brand = resolveBrandContext(bid, await carouselRepo.getBrand(bid), mediaPool);
      return {
        strategyVersionId: cur.record.id, language: 'en', goal: c.goal, coreBet: c.coreBet.priority,
        audience: c.audiencePrimaryForGoal, ctaDirection: br.ctaDirection,
        licensedPropositions, proofFacts, ownedStances: founderProps, sourceRefs: mediaPool,
        brand, voiceLines, speakingRole: 'the founder',
      };
  };
  const carouselService = new CarouselService({
    repo: carouselRepo,
    model: new AnthropicCarouselModel(anthropicKey),
    render: new ResvgCarouselRenderer(),
    blob: new FsBlobStore(process.env['CAROUSEL_BLOB_DIR'] ?? '/tmp/bb-carousel-blobs'),
    // Frozen Layer-3 proposition-preservation judge, SHARED with Voice (same model + prompt, one authority).
    judge: {
      ...(voiceModel.checkPropositions ? { check: (i) => voiceModel.checkPropositions!(i) } : {}),
      ...(voiceModel.judgeContract ? { contract: () => voiceModel.judgeContract!() } : {}),
    },
    // Slice 6.1 (additive): resolve the photo-led media PLAN for this handoff, or null (plan path ⇒ frozen).
    // Enrich each planned photo with its LITERAL subject/face geometry (from the observations) so the frozen
    // renderer's deterministic legibility layer can place the dark content plane safely.
    mediaPlan: async (bid, chid) => {
      const c = await photoLedRepo.getPhotoLedContextByHandoff(bid, chid);
      if (!c) return null;
      const ps = await photoLedRepo.getPhotoSetUnderstanding(bid, c.photoSetUnderstandingId);
      const obsById = new Map((ps?.observations ?? []).map((o) => [o.observationId, o]));
      return c.selectedMedia.map((m) => {
        const o = m.observationRefs.map((r) => obsById.get(r)).find(Boolean);
        return { sourceRefId: m.sourceRefId, role: m.role, focalSubjectBox: o?.focalSubjectBox ?? null, faceBoxes: o?.faceBoxes ?? [] };
      });
    },
    handoff: async (bid, chid) => {
      const row = await (db as unknown as { selectFrom: (t: string) => { select: (c: string) => { where: (a: string, o: string, v: string) => { where: (a: string, o: string, v: string) => { executeTakeFirst: () => Promise<{ payload: unknown } | undefined> } } } } })
        .selectFrom('workspace.plan_create_handoff').select('payload').where('create_handoff_id', '=', chid).where('business_id', '=', bid).executeTakeFirst();
      if (!row) return null;
      return typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload as never);
    },
    context: carouselContext,
    businessName: async (bid) => {
      const row = await (db as unknown as { selectFrom: (t: string) => { select: (c: string) => { where: (a: string, o: string, v: string) => { executeTakeFirst: () => Promise<{ name: string } | undefined> } } } })
        .selectFrom('workspace.businesses').select('name').where('id', '=', bid).executeTakeFirst();
      return row?.name ?? 'your business';
    },
    // eslint-disable-next-line no-console
    log: (e) => console.error('[carousel]', JSON.stringify(e)),
  });

  const businessNameOf = async (bid: string): Promise<string> => {
    const row = await (db as unknown as { selectFrom: (t: string) => { select: (c: string) => { where: (a: string, o: string, v: string) => { executeTakeFirst: () => Promise<{ name: string } | undefined> } } } })
      .selectFrom('workspace.businesses').select('name').where('id', '=', bid).executeTakeFirst();
    return row?.name ?? 'your business';
  };
  // ── Slice 6.1: photo-led carousel — observe founder photos → recommend ONE strategy-specific angle → accept →
  //    emit the FROZEN normal CreateHandoff + immutable PhotoLedCarouselContext (media + provenance only). ──
  const photoLedRepo = new PgPhotoLedRepository(db);
  const photoLedService = new PhotoLedService({
    observationModel: new AnthropicObservationModel(anthropicKey),
    opportunityModel: new AnthropicOpportunityModel(anthropicKey),
    repo: photoLedRepo,
    context: carouselContext,
    businessName: businessNameOf,
    currentPlan: async (bid) => {
      const r = await (db as unknown as { selectFrom: (t: string) => { select: (c: string) => { where: (a: string, o: string, v: string) => { orderBy: (c: string, d: string) => { executeTakeFirst: () => Promise<{ plan_version_id: string } | undefined> } } } } })
        .selectFrom('workspace.plan_version').select('plan_version_id').where('business_id', '=', bid).orderBy('produced_at', 'desc').executeTakeFirst();
      return r ? { planVersionId: r.plan_version_id, actionId: null } : null;
    },
    emitHandoff: async ({ opportunity, ctx }) => {
      const createHandoffId = generateId();
      const handoff: CreateHandoff = {
        createHandoffId,
        actionId: opportunity.actionId ?? `opportunity:${opportunity.opportunityId}`,
        planVersionId: opportunity.planVersionId ?? '',
        strategyVersionId: opportunity.strategyVersionId,
        founderGoalTrace: ctx.goal, strategicBetTrace: ctx.coreBet,
        executionObjective: opportunity.communicationJob,
        communicationJob: opportunity.communicationJob,
        authorizedAudienceUseContext: ctx.audience,
        channel: 'instagram', requestedAssetFormat: 'image_carousel',
        ctaDirection: opportunity.ctaDirection ?? ctx.ctaDirection,
        requiredSourceMaterial: [], knownGapsBlockers: [], relevantConstraints: [],
        producedAt: new Date().toISOString(),
      };
      await planRepo.saveCreateHandoff(handoff);
      return { createHandoffId };
    },
    // eslint-disable-next-line no-console
    log: (e) => console.error('[photoled]', JSON.stringify(e)),
  });

  // ── Slice 7 (Vertical 1): Reel Creation — "Use my clips" → real MP4. Additive; frozen paths untouched. ──
  const reelRepo = new PgReelRepository(db);
  const reelObjectStore = process.env['R2_BUCKET'] && process.env['R2_ACCESS_KEY_ID'] && process.env['R2_SECRET_ACCESS_KEY']
    ? new S3ObjectStore({ endpoint: process.env['R2_ENDPOINT'], region: process.env['R2_REGION'] ?? 'auto', bucket: process.env['R2_BUCKET'], accessKeyId: process.env['R2_ACCESS_KEY_ID'], secretAccessKey: process.env['R2_SECRET_ACCESS_KEY'] })
    : new LocalObjectStore(process.env['REEL_BLOB_DIR'] ?? '/tmp/bb-reel-blobs');
  const reelTranscription = process.env['DEEPGRAM_API_KEY'] ? new DeepgramTranscription(process.env['DEEPGRAM_API_KEY']) : new FakeTranscription({});
  const reelContext = async (bid: string) => {
    const c = await carouselContext(bid);
    if (!c) return null;
    return {
      strategyVersionId: c.strategyVersionId, language: c.language, goal: c.goal, coreBet: c.coreBet, audience: c.audience,
      positioning: c.coreBet, ctaDirection: c.ctaDirection,
      licensedPropositions: c.licensedPropositions.map((p) => ({ ref: p.ref, text: p.text, source: p.source })),
      proofFacts: c.proofFacts, ownedStances: c.ownedStances ?? [], sourceRefs: [], voiceLines: c.voiceLines,
      speakingRole: c.speakingRole, brandContextVersion: c.brand.brandContextVersion,
    };
  };
  const reelService = new ReelService({
    repo: reelRepo, objectStore: reelObjectStore, render: new FfmpegReelRenderer(),
    observationModel: new AnthropicVideoObservationModel(anthropicKey), opportunityModel: new AnthropicReelOpportunityModel(anthropicKey),
    transcription: reelTranscription, context: reelContext,
    businessName: businessNameOf, currentPlan: async (bid) => { const r = await (db as unknown as { selectFrom: (t: string) => { select: (c: string) => { where: (a: string, o: string, v: string) => { orderBy: (c: string, d: string) => { executeTakeFirst: () => Promise<{ plan_version_id: string } | undefined> } } } } }).selectFrom('workspace.plan_version').select('plan_version_id').where('business_id', '=', bid).orderBy('produced_at', 'desc').executeTakeFirst(); return r ? { planVersionId: r.plan_version_id, actionId: null } : null; },
    judge: { ...(voiceModel.checkPropositions ? { check: (i) => voiceModel.checkPropositions!(i) } : {}), ...(voiceModel.judgeContract ? { contract: () => voiceModel.judgeContract!() } : {}) },
    // eslint-disable-next-line no-console
    log: (e) => console.error('[reel]', JSON.stringify(e)),
  });

  // Slice 7 V2 — "Tell me what to film": upstream shoot planning that converges into the frozen reelService.
  const reelShootRepo = new PgReelShootRepository(db);
  const reelShootService = new ReelShootService({
    shootRepo: reelShootRepo, conceptModel: new AnthropicConceptPlanModel(anthropicKey), reel: reelService, reelRepo,
    context: reelContext, businessName: businessNameOf, currentPlan: async (bid) => { const r = await (db as unknown as { selectFrom: (t: string) => { select: (c: string) => { where: (a: string, o: string, v: string) => { orderBy: (c: string, d: string) => { executeTakeFirst: () => Promise<{ plan_version_id: string } | undefined> } } } } }).selectFrom('workspace.plan_version').select('plan_version_id').where('business_id', '=', bid).orderBy('produced_at', 'desc').executeTakeFirst(); return r ? { planVersionId: r.plan_version_id, actionId: null } : null; },
    judge: { ...(voiceModel.checkPropositions ? { check: (i) => voiceModel.checkPropositions!(i) } : {}), ...(voiceModel.judgeContract ? { contract: () => voiceModel.judgeContract!() } : {}) },
    // eslint-disable-next-line no-console
    log: (e) => console.error('[reel-shoot]', JSON.stringify(e)),
  });

  return {
    commandBus, queryBus, jwtService, passwordService, internalBriefRepo,
    businessService, founderAccountService,
    learnBusinessService, discoveredProfileRepo, understandingRepo, ahaRepo,
    conversationService, businessCorrectionService, aha2Service, strategyService, voiceService, planService, carouselService,
    photoLedService, photoLedRepo,
    reelService, reelObjectStore, reelRepo,
    reelShootService, reelShootRepo,
  };
}
