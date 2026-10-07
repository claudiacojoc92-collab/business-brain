import type { Command } from '../../shared/command-bus';

export interface RegisterFounderCommand extends Command {
  readonly type: 'RegisterFounder';
  readonly email: string;
  readonly name: string;
  readonly businessName: string;
  readonly timezone: string;
}

export interface RegisterFounderResult {
  founderId: string;
}
