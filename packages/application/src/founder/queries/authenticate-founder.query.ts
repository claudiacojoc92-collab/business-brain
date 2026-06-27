import type { Query } from '../../shared/query-bus';

export interface AuthenticateFounderQuery extends Query {
  readonly type: 'AuthenticateFounder';
  readonly email: string;
}

export interface AuthenticateFounderResult {
  founderId: string;
  passwordHash: string;
}
