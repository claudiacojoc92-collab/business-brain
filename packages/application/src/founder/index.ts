// Commands
// (RegisterFounder command/handler retired in S0-T2 C3 with the M2 auth bridge.)
export type {
  StartIntakeCommand,
  StartIntakeResult,
} from './commands/start-intake.command';
export { StartIntakeHandler } from './commands/start-intake.handler';

export type {
  SubmitIntakeSignalCommand,
  SubmitIntakeSignalResult,
} from './commands/submit-intake-signal.command';
export { SubmitIntakeSignalHandler } from './commands/submit-intake-signal.handler';

export type {
  CompleteIntakeCommand,
  CompleteIntakeResult,
} from './commands/complete-intake.command';
export { CompleteIntakeHandler } from './commands/complete-intake.handler';

export type {
  PauseFounderCommand,
  PauseFounderResult,
} from './commands/pause-founder.command';
export { PauseFounderHandler } from './commands/pause-founder.handler';

export type {
  ResumeFounderCommand,
  ResumeFounderResult,
} from './commands/resume-founder.command';
export { ResumeFounderHandler } from './commands/resume-founder.handler';

export type {
  UpdateOfferAvailabilityCommand,
  UpdateOfferAvailabilityResult,
} from './commands/update-offer-availability.command';
export { UpdateOfferAvailabilityHandler } from './commands/update-offer-availability.handler';

export type {
  VersionOfferCommand,
  VersionOfferResult,
} from './commands/version-offer.command';
export { VersionOfferHandler } from './commands/version-offer.handler';

export type {
  TriggerRecalibrationCommand,
  TriggerRecalibrationResult,
} from './commands/trigger-recalibration.command';
export { TriggerRecalibrationHandler } from './commands/trigger-recalibration.handler';

export type {
  SubmitRecalibrationResponseCommand,
  SubmitRecalibrationResponseResult,
} from './commands/submit-recalibration-response.command';
export { SubmitRecalibrationResponseHandler } from './commands/submit-recalibration-response.handler';

export type {
  CompleteRecalibrationCommand,
  CompleteRecalibrationResult,
} from './commands/complete-recalibration.command';
export { CompleteRecalibrationHandler } from './commands/complete-recalibration.handler';

// Queries
export type {
  GetFounderStatusQuery,
  FounderStatusDTO,
} from './queries/get-founder-status.query';
export { GetFounderStatusHandler } from './queries/get-founder-status.handler';

export type {
  GetIntakeStatusQuery,
  IntakeStatusDTO,
} from './queries/get-intake-status.query';
export { GetIntakeStatusHandler } from './queries/get-intake-status.handler';

export type { GetOfferQuery, OfferDTO } from './queries/get-offer.query';
export { GetOfferHandler } from './queries/get-offer.handler';

export type {
  GetRecalibrationStatusQuery,
  RecalibrationStatusDTO,
} from './queries/get-recalibration-status.query';
export { GetRecalibrationStatusHandler } from './queries/get-recalibration-status.handler';

// (AuthenticateFounder query/handler + IFounderAuthRepository retired in S0-T2 C3 with the M2 auth bridge.)
export type {
  IIntakeSessionRepository,
  IntakeSessionRecord,
} from './repositories/intake-session.repository';

// Process managers and sagas
export { IntakeProcessManager } from './process-managers/intake.process-manager';
export { RecalibrationProcessManager } from './process-managers/recalibration.process-manager';
export { BusinessEvolutionSaga } from './sagas/business-evolution.saga';

// Intake → Memory seeding (A2)
export {
  IntakeMemoryMapper,
  type IntakeMemoryMapperConfig,
  type IntakeSeedResult,
  type IIntakeMapperLogger,
  type SignalMap,
  type RawSignal,
} from './intake-memory-mapper';

// Services
export { FounderRegistrationService } from './services/founder-registration.service';
export { FounderLifecycleService } from './services/founder-lifecycle.service';
