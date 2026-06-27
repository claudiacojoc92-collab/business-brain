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
  PgInternalBriefProjection,
  PgInternalBriefRepository,
  PgIntakeSessionRepository,
  PgFounderVoiceRepository,
  createLogger,
} from '@bb/infrastructure';
import type { KyselyDB } from '@bb/infrastructure';
import type { IInternalBriefRepository } from '@bb/domain';
import { MemoryLayer, SystemClock } from '@bb/shared';

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
} from '@bb/application';

export interface CompositionRoot {
  commandBus: CommandBus;
  queryBus:   QueryBus;
  internalBriefRepo: IInternalBriefRepository;
  jwtService: JwtService;
  passwordService: PasswordService;
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

  return { commandBus, queryBus, jwtService, passwordService, internalBriefRepo };
}
