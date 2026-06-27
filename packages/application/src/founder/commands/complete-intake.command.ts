import type { Command } from '../../shared/command-bus';

/**
 * CompleteIntake (B1 Option-1, derivation-free).
 * Transitions the founder INTAKE_PENDING → ACTIVE and marks the intake
 * session completed. The 28-answers→profile derivation is a separate phase,
 * so this command no longer carries assembled voice/conviction/etc.
 */
export interface CompleteIntakeCommand extends Command {
  readonly type: 'CompleteIntake';
  readonly founderId: string;
}

export interface CompleteIntakeResult {
  founderId: string;
  activatedAt: Date;
}
