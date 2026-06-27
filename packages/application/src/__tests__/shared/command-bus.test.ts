import { describe, it, expect } from 'vitest';
import type { Command, CommandHandler, ICommandBus } from '../../shared/command-bus';
import { ok, err, type Result } from '@bb/shared';
import { PreconditionFailed } from '@bb/shared';

// ---------------------------------------------------------------------------
// Minimal concrete command for testing
// ---------------------------------------------------------------------------

interface TestCommand extends Command {
  readonly type: 'TestCommand';
  readonly payload: string;
}

// ---------------------------------------------------------------------------
// Minimal in-memory CommandBus for structural testing
// (not the production implementation — that lives in infrastructure)
// ---------------------------------------------------------------------------

class TestCommandBus implements ICommandBus {
  private readonly handlers = new Map<string, CommandHandler<Command, unknown, Error>>();

  register<TCommand extends Command, TResult, TError extends Error>(
    commandType: string,
    handler: CommandHandler<TCommand, TResult, TError>,
  ): void {
    this.handlers.set(commandType, handler as CommandHandler<Command, unknown, Error>);
  }

  async dispatch<TResult, TError extends Error>(
    command: Command,
  ): Promise<Result<TResult, TError>> {
    const handler = this.handlers.get(command.type);
    if (!handler) {
      return err(new Error(`No handler for ${command.type}`)) as Result<TResult, TError>;
    }
    return handler.handle(command) as Promise<Result<TResult, TError>>;
  }
}

describe('CommandBus structural contract', () => {
  it('dispatches a command to its registered handler', async () => {
    const bus = new TestCommandBus();

    const handler: CommandHandler<TestCommand, string, PreconditionFailed> = {
      async handle(cmd) {
        return ok(`handled: ${cmd.payload}`);
      },
    };

    bus.register<TestCommand, string, PreconditionFailed>('TestCommand', handler);

    const cmd: TestCommand = {
      type:             'TestCommand',
      payload:          'hello',
      correlationId:    'corr-01',
      traceId:          'trace-01',
      idempotencyKey:   'idem-01',
    };

    const result = await bus.dispatch<string, PreconditionFailed>(cmd);
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value).toBe('handled: hello');
    }
  });

  it('returns err when no handler is registered', async () => {
    const bus = new TestCommandBus();
    const cmd: TestCommand = {
      type:           'TestCommand',
      payload:        'hello',
      correlationId:  'corr-01',
      traceId:        'trace-01',
      idempotencyKey: 'idem-01',
    };
    const result = await bus.dispatch<string, Error>(cmd);
    expect(result.isErr).toBe(true);
  });
});
