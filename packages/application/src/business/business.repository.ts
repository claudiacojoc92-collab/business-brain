import type { BusinessRecord } from './types';

/** Row for the atomic business + owner-membership insert. */
export interface CreateBusinessRow {
  readonly id: string;
  readonly ownerFounderId: string;
  readonly name: string;
  readonly defaultConversationLanguage: string;
  readonly membershipId: string;
}

/**
 * Persistence port for the Business tenancy seam.
 *
 * Membership authorization is enforced here at the query level (the read methods are
 * membership-filtered) because in dev the owner DB role bypasses RLS — RLS is only
 * defense-in-depth. Every read is therefore scoped by the requesting founder.
 */
export interface IBusinessRepository {
  /** Atomically insert the business and its owner membership; returns the created business. */
  createWithOwnerMembership(row: CreateBusinessRow): Promise<BusinessRecord>;

  /** Businesses the founder is a member of, newest first. */
  listForFounder(founderId: string): Promise<BusinessRecord[]>;

  /** The business IF the founder has a membership for it; otherwise null. */
  getForFounder(businessId: string, founderId: string): Promise<BusinessRecord | null>;

  /** Whether the founder has a membership for the business. */
  hasMembership(businessId: string, founderId: string): Promise<boolean>;
}
