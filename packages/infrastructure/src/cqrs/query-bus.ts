import type { IQueryBus, Query, QueryHandler } from '@bb/application';

/**
 * In-process query bus.
 * Handlers are registered by query type string.
 * dispatch() routes to the registered handler and returns the result directly.
 */
export class QueryBus implements IQueryBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly handlers = new Map<string, QueryHandler<any, any>>();

  register<TQuery extends Query>(
    type: TQuery['type'],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: QueryHandler<TQuery, any>,
  ): void {
    this.handlers.set(type, handler);
  }

  async dispatch<TResult>(query: Query): Promise<TResult> {
    const handler = this.handlers.get(query.type);
    if (!handler) {
      throw new Error(`No handler registered for query: ${query.type}`);
    }
    return handler.handle(query) as Promise<TResult>;
  }
}
