/**
 * Base interface for all queries.
 * Source: Implementation Spec V1 Section 05.
 */
export interface Query {
  readonly type: string;
  readonly correlationId: string;
  readonly traceId: string;
}

/**
 * A query handler processes exactly one query type.
 * Query handlers are read-only — no state changes, no events.
 * Source: Implementation Spec V1 Section 05.
 */
export interface QueryHandler<TQuery extends Query, TResult> {
  handle(query: TQuery): Promise<TResult>;
}

/**
 * Routes queries to their registered handler.
 * Implementation in packages/infrastructure/.
 * Source: Implementation Spec V1 Section 05.
 */
export interface IQueryBus {
  dispatch<TResult>(query: Query): Promise<TResult>;

  register<TQuery extends Query, TResult>(
    queryType: string,
    handler: QueryHandler<TQuery, TResult>,
  ): void;
}
