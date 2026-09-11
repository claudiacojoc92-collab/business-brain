import { generateId } from '@bb/shared';
import type { IFounderStateRepository } from '../conversation/index';

/**
 * Business Understanding — founder corrections (M2).
 *
 * A founder correction about a business FACT is a first-class, founder-owned truth. It reuses the real,
 * persisted `founder_state` path (kind `business_correction`) — the SAME state the strategist conversation
 * already reads — so a correction made on the Business surface is genuinely held and consumed downstream by
 * Talk to BB, not a cosmetic badge. This service is deliberately thin: it does NOT regenerate strategy (unlike
 * strategy/respond), does NOT touch the immutable understanding snapshot, and adds no new table.
 *
 * A correction is SCOPED to a claim subject (e.g. 'offer', 'positioning', 'audience'). Correcting the same
 * subject again supersedes the prior correction (current state must never lie), while history is preserved as
 * a status flip (`active` → `superseded`), never a destructive edit.
 */
export interface BusinessCorrection {
  readonly id: string;
  readonly subject: string;
  readonly statement: string;
}

export interface BusinessCorrectionDeps {
  readonly state: IFounderStateRepository;
}

export class BusinessCorrectionService {
  constructor(private readonly deps: BusinessCorrectionDeps) {}

  /** Active founder corrections for this business, scoped by claim subject. */
  async list(businessId: string): Promise<BusinessCorrection[]> {
    const items = await this.deps.state.listActive(businessId);
    return items
      .filter((s) => s.kind === 'business_correction')
      .map((s) => ({ id: s.id, subject: s.scope ?? '', statement: s.statement }));
  }

  /**
   * Record a founder correction about a claim subject. Any active correction on the SAME subject is
   * superseded first (append-only history), then the new founder-held truth is appended and returned.
   */
  async record(
    businessId: string,
    founderId: string,
    subject: string,
    statement: string,
    language: string,
  ): Promise<BusinessCorrection> {
    const active = await this.deps.state.listActive(businessId);
    for (const s of active) {
      if (s.kind === 'business_correction' && (s.scope ?? '') === subject) {
        await this.deps.state.setStatus(businessId, s.id, 'superseded');
      }
    }
    const rec = await this.deps.state.append({
      id: generateId(),
      businessId,
      founderId,
      kind: 'business_correction',
      statement,
      scope: subject,
      language,
      sourceTurnId: null,
    });
    return { id: rec.id, subject: rec.scope ?? subject, statement: rec.statement };
  }
}
