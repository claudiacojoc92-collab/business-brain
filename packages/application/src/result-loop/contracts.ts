/**
 * RESULT LOOP V1 (intent/2026-10-14-result-loop). The minimum durable state that closes ONE acquisition loop:
 * STRATEGY → CONTACT → OUTREACH → FOLLOW-UP → OUTCOME → IMPACT → NEXT MOVE. Not a CRM.
 *
 * Epistemic types stay explicit: a contact is who; a TOUCH is what was done (append-only); an OUTCOME is what came of
 * it (append-only, typed, with the founder's original words as evidence); a FOLLOW-UP is what is owed next. None of
 * these is ever written as founder_state (a constraint, a correction, a preference).
 */

export type ContactType = 'ORGANISATION' | 'PERSON';
export type ContactStatus = 'TARGET' | 'CONTACTED' | 'IN_CONVERSATION' | 'PARTNER' | 'NOT_INTERESTED' | 'NEEDS_DETAILS';
export type TouchChannel = 'EMAIL' | 'PHONE' | 'WHATSAPP' | 'VISIT' | 'OTHER';
export type TouchDirection = 'OUTBOUND' | 'INBOUND';
export type TouchType = 'SENT' | 'VISITED' | 'REPLIED' | 'FOLLOW_UP' | 'NOTE';
export type CreatedBy = 'BB' | 'FOUNDER' | 'SYSTEM';
export type OutcomeType =
  | 'NO_RESPONSE' | 'NOT_INTERESTED' | 'MATERIAL_REQUESTED' | 'FOLLOW_UP_REQUESTED'
  | 'MEETING_REQUESTED' | 'REFERRAL_RECEIVED' | 'CONVERTED' | 'OTHER';
export type FollowUpStatus = 'OPEN' | 'DONE' | 'RESCHEDULED' | 'CANCELLED';

export const CONTACT_TYPES: readonly ContactType[] = ['ORGANISATION', 'PERSON'];
export const CONTACT_STATUSES: readonly ContactStatus[] = ['TARGET', 'CONTACTED', 'IN_CONVERSATION', 'PARTNER', 'NOT_INTERESTED', 'NEEDS_DETAILS'];
export const TOUCH_CHANNELS: readonly TouchChannel[] = ['EMAIL', 'PHONE', 'WHATSAPP', 'VISIT', 'OTHER'];
export const TOUCH_TYPES: readonly TouchType[] = ['SENT', 'VISITED', 'REPLIED', 'FOLLOW_UP', 'NOTE'];
export const OUTCOME_TYPES: readonly OutcomeType[] = [
  'NO_RESPONSE', 'NOT_INTERESTED', 'MATERIAL_REQUESTED', 'FOLLOW_UP_REQUESTED', 'MEETING_REQUESTED', 'REFERRAL_RECEIVED', 'CONVERTED', 'OTHER',
];

/** Where a record came from. `statement` = the founder's original words; `quote` = the part that supports this item. */
export interface ResultProvenance {
  readonly kind: 'founder' | 'report' | 'message' | 'research' | 'system';
  readonly statement?: string;
  readonly quote?: string;
  readonly messageId?: string;
  readonly url?: string;
  /** The founder changed BB's reading of this item before confirming it. */
  readonly editedByFounder?: boolean;
}

export interface Contact {
  readonly id: string;
  readonly businessId: string;
  readonly type: ContactType;
  readonly name: string;
  readonly organisationName: string | null;
  readonly role: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly website: string | null;
  readonly source: ResultProvenance;
  readonly status: ContactStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Touch {
  readonly id: string;
  readonly businessId: string;
  readonly contactId: string;
  readonly actionRef: string | null;
  readonly channel: TouchChannel;
  readonly direction: TouchDirection;
  readonly type: TouchType;
  readonly occurredAt: string;
  readonly summary: string;
  readonly source: ResultProvenance;
  readonly createdBy: CreatedBy;
  readonly createdAt: string;
}

export interface Outcome {
  readonly id: string;
  readonly businessId: string;
  readonly contactId: string;
  readonly touchId: string | null;
  readonly outcomeType: OutcomeType;
  readonly stage: string | null;
  readonly occurredAt: string;
  readonly note: string;
  readonly evidence: ResultProvenance;
  readonly createdBy: CreatedBy;
  readonly createdAt: string;
}

export interface FollowUp {
  readonly id: string;
  readonly businessId: string;
  readonly contactId: string;
  readonly what: string;
  readonly reason: string;
  /** YYYY-MM-DD */
  readonly dueOn: string;
  readonly status: FollowUpStatus;
  readonly createdFrom: string | null;
  readonly replacesId: string | null;
  readonly resolvedByTouchId: string | null;
  readonly resolvedAt: string | null;
  readonly createdBy: CreatedBy;
  readonly createdAt: string;
}

export interface IContactRepository {
  insert(c: Contact): Promise<void>;
  /** Current-state update (details / status). History lives in touches and outcomes. */
  update(businessId: string, id: string, patch: Partial<Pick<Contact, 'name' | 'organisationName' | 'role' | 'email' | 'phone' | 'website' | 'status' | 'type'>>, at: string): Promise<Contact | null>;
  get(businessId: string, id: string): Promise<Contact | null>;
  list(businessId: string): Promise<Contact[]>;
}

/** Append-only: there is no update and no delete. */
export interface ITouchRepository {
  append(t: Touch): Promise<void>;
  list(businessId: string, contactId?: string): Promise<Touch[]>;
}

/** Append-only: there is no update and no delete. */
export interface IOutcomeRepository {
  append(o: Outcome): Promise<void>;
  list(businessId: string, contactId?: string): Promise<Outcome[]>;
}

export interface IFollowUpRepository {
  insert(f: FollowUp): Promise<void>;
  /** Resolve an OPEN follow-up once (DONE / RESCHEDULED / CANCELLED). Returns false when it was not open. */
  resolve(businessId: string, id: string, status: Exclude<FollowUpStatus, 'OPEN'>, at: string, touchId: string | null): Promise<boolean>;
  list(businessId: string, opts?: { status?: FollowUpStatus; contactId?: string }): Promise<FollowUp[]>;
}

export interface ResultLoopRepos {
  readonly contacts: IContactRepository;
  readonly touches: ITouchRepository;
  readonly outcomes: IOutcomeRepository;
  readonly followUps: IFollowUpRepository;
}

/** One contact as the strategy and Today read it. */
export interface ContactView {
  readonly contact: Contact;
  readonly lastTouch: Touch | null;
  readonly lastOutcome: Outcome | null;
  readonly openFollowUp: FollowUp | null;
}

/** Counted evidence across ALL logged outreach (never just the latest report). */
export interface CumulativeEvidence {
  readonly contacts: number;
  readonly contacted: number;
  readonly byStatus: Partial<Record<ContactStatus, number>>;
  readonly touches: Partial<Record<TouchType, number>>;
  readonly outcomes: Partial<Record<OutcomeType, number>>;
  /** Contacts reached who answered at all (any outcome other than NO_RESPONSE, or an inbound touch). */
  readonly responded: number;
  /** Contacts reached with an interested outcome. */
  readonly positive: number;
  /** Contacts with any outcome other than NO_RESPONSE, over contacts reached. Null when nobody was reached. */
  readonly responseRate: number | null;
  /** Contacts with an interested outcome (material / follow-up / meeting / referral / converted), over contacts reached. */
  readonly positiveRate: number | null;
  readonly referrals: number;
  readonly firstTouchAt: string | null;
  readonly lastTouchAt: string | null;
  /** Days between the first touch and `now`. */
  readonly daysSinceFirstTouch: number | null;
  readonly openFollowUps: number;
  readonly overdueFollowUps: number;
}
