import type { Command } from '../../shared/command-bus';
import type { FounderVoice, ConvictionAngle } from '@bb/domain';

export interface CompleteRecalibrationCommand extends Command {
  readonly type: 'CompleteRecalibration';
  readonly founderId: string;
  readonly sessionId: string;
  readonly newVoice: FounderVoice | null;
  readonly newConviction: ConvictionAngle | null;
}

export interface CompleteRecalibrationResult {
  founderId: string;
  completedAt: Date;
}
