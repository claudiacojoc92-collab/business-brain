/**
 * IntakeCompletedWithoutDerivation — emitted when intake is completed in the
 * B1 Option-1 flow: the founder transitions straight to ACTIVE without the
 * 28-answers→profile derivation (which runs in a later phase). The raw intake
 * signals remain in founder.intake_sessions for the pipeline to consume.
 *
 * Distinct from IntakeCompleted (which carries the assembled voice/conviction/
 * audience/offer) so the full-derivation contract is left untouched.
 */
export interface IntakeCompletedWithoutDerivationPayload {
  founderId: string;
  sessionId: string;
  completedAt: Date;
}

export function buildIntakeCompletedWithoutDerivationEvent(
  p: IntakeCompletedWithoutDerivationPayload,
): IntakeCompletedWithoutDerivationPayload {
  return p;
}
