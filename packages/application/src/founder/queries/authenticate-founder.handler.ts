import type { QueryHandler } from '../../shared/query-bus';
import type { IFounderAuthRepository } from '../repositories/founder-auth.repository';
import type {
  AuthenticateFounderQuery,
  AuthenticateFounderResult,
} from './authenticate-founder.query';

export class AuthenticateFounderHandler
  implements QueryHandler<AuthenticateFounderQuery, AuthenticateFounderResult | null>
{
  constructor(private readonly authRepo: IFounderAuthRepository) {}

  async handle(
    query: AuthenticateFounderQuery,
  ): Promise<AuthenticateFounderResult | null> {
    return this.authRepo.findByEmail(query.email);
  }
}
