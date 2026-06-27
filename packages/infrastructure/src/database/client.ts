import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

/**
 * Creates and returns a Kysely database client.
 * The DB type parameter is intentionally unknown here — each repository
 * uses its own typed table definitions via the Kysely SelectQueryBuilder.
 * Source: Implementation Spec V1 Section 11, Repository Structure V1.
 */
// TYPED_ANY: DB schema type is built per-repository using Kysely's type system.
// A global schema type will be added in a later infrastructure milestone.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = any;

// TYPED_ANY: see DB comment above
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type KyselyDB = Kysely<any>;

export function createKyselyClient(databaseUrl: string): KyselyDB {
  const pool = new Pool({ connectionString: databaseUrl });
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  });
}
