export * from './contracts';
export * from './proposition-classes';
export * from './proposition-safety';
export * from './authorization-snapshot';
export {
  classifyVoiceSample,
  sampleText,
  wrongLanguage,
  parrotsExample,
  detectUnsupportedClaims,
  auditAssertions,
  isExplicitBoundary,
  type ClaimType,
  type AssertionAudit,
  type VoiceRejection,
  type VoiceSampleContext,
  type VoiceValidation,
} from './validation';
export {
  VoiceService,
  buildAuthorizedMessageSpec,
  allowedBusinessFacts,
  type VoiceDeps,
  type VoiceEvent,
  type VoiceStrategyView,
} from './voice.service';
