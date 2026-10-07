import type { Claim, ClaimId, ClaimRepository, SubjectRef } from '@bb/domain';

export interface IClaimReadService {
  byId(businessRef: SubjectRef, id: ClaimId): Promise<Claim | null>;
  history(businessRef: SubjectRef): Promise<readonly Claim[]>;
  bySubject(businessRef: SubjectRef, subject: SubjectRef): Promise<readonly Claim[]>;
}

/**
 * Read-only access to the append-only Claim log. Exposes ONLY the frozen non-evaluative reads: `byId`,
 * `history` (all claims for the business), and `bySubject` (all claims about an exact subject). `history`
 * and `bySubject` return claims in repository APPEND order (not `recordedAt`). There is deliberately no
 * `latest`/`current`/`effective`/`accepted`/`verified`/`strongest`/`resolved` read — the log records
 * propositions; it never decides which is true. Reads perform no writes and reinterpret nothing.
 */
export class ClaimReadService implements IClaimReadService {
  constructor(private readonly deps: { readonly claims: ClaimRepository }) {}

  async byId(businessRef: SubjectRef, id: ClaimId): Promise<Claim | null> {
    return this.deps.claims.byId(businessRef, id);
  }

  async history(businessRef: SubjectRef): Promise<readonly Claim[]> {
    return this.deps.claims.history(businessRef);
  }

  async bySubject(businessRef: SubjectRef, subject: SubjectRef): Promise<readonly Claim[]> {
    return this.deps.claims.bySubject(businessRef, subject);
  }
}
