/**
 * Opaque transaction handle passed through the call chain.
 * The concrete type is Kysely's transaction object in the infrastructure layer.
 * Application layer treats it as unknown — never inspects internals.
 * Source: Implementation Spec V1 Section 03.
 */
export type Transaction = unknown;

/**
 * Opens a database transaction, executes the work function, and commits.
 * On any thrown error the transaction is rolled back automatically.
 *
 * RULE: Command Handlers own transactions. No transaction is opened
 * inside a repository, domain aggregate, or application service.
 *
 * RULE: RLS context is always set inside the transaction — never outside.
 *
 * Source: Implementation Spec V1 Section 03.
 */
export interface ITransactionManager {
  run<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
