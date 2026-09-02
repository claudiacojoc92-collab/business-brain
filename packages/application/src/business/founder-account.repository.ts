/**
 * Persistence port for the founder ACCOUNT (person/user identity) used by Slice-0 auth.
 *
 * This is the account seam that makes real self-registration and Google account sign-in work.
 * It writes founder.founders + app.founder_auth directly (the person identity), deliberately
 * NOT going through the heavy legacy FounderProfile aggregate — account creation no longer
 * requires a business name (business identity now lives in workspace.businesses).
 */
export interface FounderAccountRecord {
  readonly founderId: string;
  readonly email: string;
  readonly name: string;
  readonly interfaceLocale: string;
}

export interface CreateFounderAccountRow {
  readonly founderId: string;
  readonly email: string;
  readonly name: string;
  readonly interfaceLocale: string;
  /** bcrypt hash, or null for OAuth-only (Google) accounts that have no password. */
  readonly passwordHash: string | null;
}

export interface IFounderAccountRepository {
  findByEmail(email: string): Promise<FounderAccountRecord | null>;
  getById(founderId: string): Promise<FounderAccountRecord | null>;
  /** Insert the founder row and (when passwordHash is present) the auth row, atomically. */
  createAccount(row: CreateFounderAccountRow): Promise<FounderAccountRecord>;
  updateInterfaceLocale(founderId: string, locale: string): Promise<void>;
}
