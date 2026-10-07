import type { ClaimId, SubjectRef } from '../shared/types';
import type { Claim } from './claim';

/**
 * Append-only Claim store (port). Business-scoped. Claims are immutable once appended — there is
 * deliberately NO update, NO delete, and NO supersede/resolve method: a later claim coexists with an
 * earlier (even contradictory) one, and this layer NEVER selects a "winning" or "current" claim.
 *
 * BUSINESS-SCOPE RULE: `append` carries `businessRef` explicitly (matching the RecognitionEvent /
 * FounderDeclaration convention) AND the claim carries its own `businessRef`. The frozen precondition is
 * `businessRef === claim.businessRef`; an implementation MUST reject a mismatch rather than trust either
 * side. All reads are scoped to their `businessRef` argument; cross-business reads return not-found and
 * reveal nothing about another business's claims or subjects.
 *
 * APPEND IDEMPOTENCY (domain-port level, no implementation metadata): `append` is idempotent by
 * `(businessRef, id)` — re-appending an existing id with IDENTICAL content is a no-op; re-appending an
 * existing id with DIVERGENT content MUST fail loudly. Command-level idempotency (a business-scoped
 * clientEventId) is an APPLICATION concern for the storage commit and is NEVER a field of `Claim` or a
 * parameter of this port.
 *
 * Reads are intentionally NON-evaluative. `history` and `bySubject` return EVERY matching claim in
 * repository APPEND order (the persistence-assigned sequence — NOT `recordedAt`, and not a `Claim` field).
 * There is deliberately no `latest`/`effective`/`active`/`current`/`resolved`/`accepted`/`valid`/
 * `strongest`/`verified` read — any such evaluation is a later Examiner's job, which reads claims but never
 * mutates them.
 */
export interface ClaimRepository {
  append(businessRef: SubjectRef, claim: Claim): Promise<void>;
  byId(businessRef: SubjectRef, id: ClaimId): Promise<Claim | null>;
  history(businessRef: SubjectRef): Promise<readonly Claim[]>;
  bySubject(businessRef: SubjectRef, subject: SubjectRef): Promise<readonly Claim[]>;
}
