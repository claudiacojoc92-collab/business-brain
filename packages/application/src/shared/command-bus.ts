import type { Result } from '@bb/shared';
import type { DomainError } from '@bb/shared';

/**
 * Base interface for all commands.
 * Every command carries identity and observability fields.
 * Source: Implementation Spec V1 Section 05.
 */
export interface Command {
  readonly type: string;
  readonly correlationId: string;
  readonly traceId: string;
  readonly idempotencyKey: string;
}

/**
 * A command handler processes exactly one command type.
 * Returns Result<TResult, TError> — never throws.
 * Source: Implementation Spec V1 Section 05.
 */
export interface CommandHandler<
  TCommand extends Command,
  TResult,
  TError extends DomainError | Error = DomainError,
> {
  handle(command: TCommand): Promise<Result<TResult, TError>>;
}

/**
 * Routes commands to their registered handler.
 * Implementation in packages/infrastructure/.
 * Source: Implementation Spec V1 Section 05.
 */
export interface ICommandBus {
  dispatch<TResult, TError extends DomainError | Error>(
    command: Command,
  ): Promise<Result<TResult, TError>>;

  register<TCommand extends Command, TResult, TError extends DomainError | Error>(
    commandType: string,
    handler: CommandHandler<TCommand, TResult, TError>,
  ): void;
}
