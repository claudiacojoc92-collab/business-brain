import type { ICommandBus, Command, CommandHandler } from '@bb/application';
import type { Result } from '@bb/shared';

/**
 * In-process command bus.
 * Handlers are registered by command type string.
 * dispatch() routes to the registered handler and returns its Result.
 */
export class CommandBus implements ICommandBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly handlers = new Map<string, CommandHandler<any, any, any>>();

  register<TCommand extends Command>(
    type: TCommand['type'],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: CommandHandler<TCommand, any, any>,
  ): void {
    this.handlers.set(type, handler);
  }

  async dispatch<TResult, TError>(
    command: Command,
  ): Promise<Result<TResult, TError>> {
    const handler = this.handlers.get(command.type);
    if (!handler) {
      throw new Error(`No handler registered for command: ${command.type}`);
    }
    return handler.handle(command) as Promise<Result<TResult, TError>>;
  }
}
