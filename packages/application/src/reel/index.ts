export * from './contracts';
export { ReelService, type ReelDeps } from './reel.service';
export { specFromReelAuthorization, governReelCopy, spokenClaimIsUnauthorized, type ReelCopyFinding } from './reel-safety';
export {
  buildTimeline, edlHash, targetDuration, filterRenderableRanges, validateSelectionRefs,
  disposeSpokenClaim, isLoadBearingRange, spokenTextOf, MIN_REEL_MS, MAX_REEL_MS, MIN_SEG_MS,
} from './reel';
