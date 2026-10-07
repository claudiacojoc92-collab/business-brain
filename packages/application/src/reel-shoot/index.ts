// Slice 7 V2 — "Tell me what to film" (upstream of the frozen V1 reel engine)
export * from './contracts';
export { assembleConcept, assemblePlanVersion, buildConceptSeed, requiredRoles, clampDuration, ROLE_ORDER } from './plan';
export { matchFootage, assembleReport, assessShootSufficiency } from './matching';
export { ReelShootService } from './reel-shoot.service';
export type { ReelShootDeps, ProposeResult, MatchResult, ConvergeResult } from './reel-shoot.service';
