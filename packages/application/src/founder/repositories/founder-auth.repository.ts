import type { AuthenticateFounderResult } from '../queries/authenticate-founder.query';

/**
 * Repository interface for founder authentication credentials.
 * Reads from app.founder_auth joined to founder.founders.
 */
export interface IFounderAuthRepository {
  findByEmail(email: string): Promise<AuthenticateFounderResult | null>;
}
