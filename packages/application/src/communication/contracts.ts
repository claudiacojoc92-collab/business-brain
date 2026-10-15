/**
 * FOUNDER COMMUNICATION (Result Loop V1, intent/2026-10-14-result-loop). One-to-one messages the founder sends as
 * herself: email, WhatsApp, outreach. Deliberately separate from Slice 4 Voice (brand / social content, frozen).
 *
 *   brief → prose → sendability gate → repair (max 2) → ready, or an honest "couldn't write one you'd send" with why.
 *
 * The writing profile is evidence only: real samples, explicit preferences, accepted / rejected / never-say wording,
 * edits. No inferred personality. Every preference points at the entry it came from.
 */

export type MessagePurpose = 'first_outreach' | 'material_follow_up' | 'no_response_follow_up' | 'requested_follow_up';
export type MessageChannel = 'EMAIL' | 'WHATSAPP';
export const MESSAGE_PURPOSES: readonly MessagePurpose[] = ['first_outreach', 'material_follow_up', 'no_response_follow_up', 'requested_follow_up'];

// ── Writing state ──

/** RELEVANCE = the founder's correction of which offer parts matter to ONE contact (key = contact id; text = JSON). */
export type WritingEntryKind = 'SENDER' | 'SAMPLE' | 'ACCEPTED_PHRASE' | 'REJECTED_PHRASE' | 'NEVER_SAY' | 'PREFERENCE' | 'RELEVANCE';
export type PreferenceKey = 'greeting' | 'signoff' | 'length' | 'directness' | 'warmth';
export const PREFERENCE_KEYS: readonly PreferenceKey[] = ['greeting', 'signoff', 'length', 'directness', 'warmth'];

/**
 * Who a recipient is, as a register context (deterministic from the contact, never guessed by a model). Register
 * (formality, greeting, sign-off) is a property of this context, not of the founder.
 */
export type RecipientCategory = 'medical' | 'organisation' | 'individual';
export const RECIPIENT_CATEGORIES: readonly RecipientCategory[] = ['medical', 'organisation', 'individual'];

/** The context one message is written in: whom to, by which channel, for what. */
export interface WritingContext {
  readonly recipientCategory: RecipientCategory;
  readonly channel: MessageChannel;
  readonly purpose: MessagePurpose | null;
}

export interface WritingEvidence {
  /** explicit = the founder said it; sample = text she wrote herself; edit = she changed BB's draft before sending (the final
   *  counts as her own text only when most of it is her words); accepted_draft = she sent BB's draft unchanged (the wording
   *  was acceptable there, NOT how she writes); liked = someone else's outreach she liked (never her writing). */
  readonly kind: 'explicit' | 'edit' | 'sample' | 'accepted_draft' | 'liked';
  /** IDENTITY. `actor` = who did this in BB (the account user); `sender` = the confirmed sender identity the evidence is
   *  about / the message was signed as (senderKey). Never assumed to be the same person (Body Move: Claudia uses BB,
   *  Raluca signs). Evidence without a sender is unattributed and never shapes a sender's rules. */
  readonly actor?: { readonly kind: 'account_user'; readonly id: string };
  readonly sender?: string;
  /** The context it was written in (samples may give it; sent messages always do). */
  readonly recipientCategory?: RecipientCategory;
  readonly channel?: MessageChannel;
  /** edit: the share of the final text that is her words (added / final words). */
  readonly authoredShare?: number;
  readonly ref?: string;
  readonly before?: string;
  readonly after?: string;
  /** edit: the word runs she removed from / added to BB's draft (writing evidence only). */
  readonly removed?: string[];
  readonly added?: string[];
  /** edit: what the message was for and who it went to (the context a removal belongs to). */
  readonly purpose?: MessagePurpose;
  readonly contactId?: string;
}

/** A reusable writing constraint, traceable to the writing entries it came from. Never a personality trait. */
export type WritingRuleKey = 'length' | 'sentence_length' | 'greeting' | 'signoff' | 'formality' | 'cta' | 'punctuation' | 'directness' | 'warmth' | 'never_say'
  /** soft, from edits: wording she removed in several independent edits (a preference, never a ban). */
  | 'usually_avoids'
  /** soft, from ONE edit: wording she removed from one message (context evidence, never a ban). */
  | 'changed_once';
export interface WritingRule {
  readonly key: WritingRuleKey;
  /** Plain description the writer reads ("about 45 words", "Bună ziua,", "never uses dashes"). */
  readonly value: string;
  /** explicit = she said it (hard only for never_say); samples = derived from her real messages; edits = a pattern across
   *  several of her edits of BB drafts; edit = one edit of one message. */
  readonly source: 'explicit' | 'samples' | 'edits' | 'edit';
  /** The writing entry ids it rests on. */
  readonly evidence: string[];
  readonly maxWords?: number;
  readonly register?: 'formal' | 'informal';
  readonly noExclamation?: boolean;
  readonly noDashes?: boolean;
  readonly phrases?: string[];
  /** Soft rules: her own messages that DO use the wording (counter-evidence, always cited). */
  readonly against?: string[];
  /** changed_once: the purpose of the message she edited (it only informs a similar message). */
  readonly purpose?: MessagePurpose | null;
  /** Sample-derived rules: the context they hold for (register is never generalised across contexts). */
  readonly scope?: { readonly recipientCategory: RecipientCategory; readonly channel: MessageChannel };
}

/** One removal from one edited BB draft: evidence about THAT message, never a rule about every message. */
export interface ContextualRejection {
  readonly phrase: string;
  readonly entryId: string;
  readonly purpose: MessagePurpose | null;
  readonly contactId: string | null;
  readonly recipientCategory: RecipientCategory | null;
  readonly before: string;
  readonly after: string;
  readonly at: string;
}

export interface WritingEntry {
  readonly id: string;
  readonly businessId: string;
  readonly kind: WritingEntryKind;
  /** PREFERENCE: the preference key; RELEVANCE: the contact id. */
  readonly key: string | null;
  /** The phrase / sample / preference value; for SENDER, the JSON of {@link SenderIdentity}. */
  readonly text: string;
  readonly evidence: WritingEvidence;
  readonly createdAt: string;
}

/** Append-only. The profile is a projection (latest per key wins). */
export interface IWritingRepository {
  append(e: WritingEntry): Promise<void>;
  list(businessId: string): Promise<WritingEntry[]>;
}

/** Who signs. Business-specific and explicitly confirmed once (Body Move: Raluca, not the account owner). */
export interface SenderIdentity {
  readonly displayName: string;
  readonly role: string;
  readonly business: string;
  readonly signOff: string | null;
}

export interface WritingProfile {
  /** Null until the founder confirms who signs for this business. */
  readonly sender: SenderIdentity | null;
  /** The confirmed sender's own messages (written by her, or BB drafts she mostly rewrote), newest last. With a writing
   *  context: the ones from that context when there are any, else her others (`samplesFrom`). */
  readonly samples: { id: string; text: string }[];
  readonly samplesFrom: 'this_context' | 'other_contexts' | 'any';
  /** BB drafts sent unchanged: the wording was acceptable there; never her samples. */
  readonly acceptedDrafts: number;
  /** Outreach she liked (someone else's): what she likes, never treated as her voice. */
  readonly liked: { id: string; text: string }[];
  /** Wording she removed from BB drafts, each with its message context (REJECTED_IN_CONTEXT; soft, never a gate). */
  readonly rejectedInContext: ContextualRejection[];
  /** The derived + explicit writing rules, each traceable to its entries. */
  readonly rules: WritingRule[];
  readonly acceptedPhrases: string[];
  readonly rejectedPhrases: string[];
  readonly neverSay: string[];
  readonly preferences: Partial<Record<PreferenceKey, { value: string; entryId: string }>>;
  /** The founder's latest relevance correction per contact (durable evidence for future relevance decisions). */
  readonly relevanceCorrections: RelevanceCorrection[];
}

// ── Recipient relevance: decided ONCE per brief, used by the writer, every repair, the grounder, the judge and the UI ──

export type RelevanceConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export const RELEVANCE_CONFIDENCES: readonly RelevanceConfidence[] = ['HIGH', 'MEDIUM', 'LOW'];

/** One part of the business's VERIFIED offer that matters to this recipient, and why (grounded in the brief's own text). */
export interface RelevantOfferPart {
  /** Exactly one of the brief's offer_items (never an inferred service). */
  readonly offer_part: string;
  readonly reason: string;
  /** Verbatim spans of the context it rests on (the recipient's role, what happened, the strategy, the founder's words). */
  readonly evidence: string[];
  readonly confidence: RelevanceConfidence;
  /** Set when the model's reason added terms the context does not support: that reason is NOT shown (kept for review). */
  readonly droppedReason?: string;
  readonly ungroundedTerms?: string[];
}

export interface RelevanceDecision {
  /** At most two parts; empty when nothing in the offer is clearly relevant. */
  readonly parts: RelevantOfferPart[];
  /** Nothing chosen, or only LOW-confidence choices: BB is not sure what to lead with. */
  readonly uncertain: boolean;
  /** model = decided by BB from the context; founder = the founder's correction for this contact. */
  readonly source: 'model' | 'founder';
  /** The writing entry holding the founder's correction (source = founder). */
  readonly correctionId: string | null;
}

/** The founder's correction for one contact, as stored (a RELEVANCE writing entry). */
export interface RelevanceCorrection {
  readonly entryId: string;
  readonly contactId: string;
  /** Who the recipient was when she corrected it: lets future decisions for similar recipients learn from it. */
  readonly recipientRole: string | null;
  readonly organisation: string | null;
  readonly parts: { offer_part: string; reason: string }[];
  /** Offer parts she removed from BB's choice. */
  readonly removed: string[];
}

export interface RelevanceInput {
  readonly recipient: { name: string; organisation: string | null; role: string | null };
  readonly relationship_context: string;
  readonly why_now: string;
  readonly strategic_reason: string;
  /** The verified offer, split: the ONLY parts that may be chosen. */
  readonly offer_items: string[];
  readonly offer_or_value: string | null;
  readonly supporting_context: string[];
  /** The founder's corrections for OTHER contacts (evidence of what she considers relevant to whom). */
  readonly priorCorrections: RelevanceCorrection[];
  readonly language: string;
}

/** Proposes which offer parts matter to this recipient. Only proposes: checkRelevance keeps verified offer parts + evidence. */
export interface IRelevanceModel {
  select(input: RelevanceInput): Promise<unknown>;
}

// ── The brief ──

export interface CommunicationBrief {
  readonly sender_identity: SenderIdentity;
  readonly recipient_identity: { name: string; organisation: string | null; email: string | null; phone: string | null };
  readonly recipient_role: string | null;
  /** The register context (deterministic from the contact) and the register it calls for. Register comes from the
   *  context, never from how the founder talks to BB. */
  readonly recipient_category: RecipientCategory;
  readonly register: string;
  /** What has already happened with this person, from the touch history (never invented). */
  readonly relationship_context: string;
  readonly why_now: string;
  readonly strategic_reason: string;
  readonly desired_outcome: string;
  /** What the founder offers, from what BB holds; null when nothing concrete is held (never invented). */
  readonly offer_or_value: string | null;
  /** The founder's facts THIS message may use (the only facts it may state). Empty when the purpose needs none. */
  readonly supporting_context: string[];
  /** Every fact BB holds from the founder (AVAILABLE). Only `supporting_context` is NEEDED in this message. */
  readonly available_facts: string[];
  /** optional = a held fact may appear only if it materially helps (at most one); none = this message uses no held fact. */
  readonly facts_use: 'optional' | 'none';
  /** offer_or_value split into its parts (the verified catalogue). */
  readonly offer_items: string[];
  /** Her writing rules (explicit > samples > edits), each with its evidence. Empty → generic defaults apply. */
  readonly writing_rules: WritingRule[];
  /** THE relevance decision for this brief: the only offer parts the message may name. Decided once, never re-judged. */
  readonly relevant_offer_parts: RelevantOfferPart[];
  readonly relevance: { readonly uncertain: boolean; readonly source: 'model' | 'founder'; readonly correctionId: string | null };
  /** HARD: never in the message (generic bans + her explicit never-say). */
  readonly what_not_to_say: string[];
  /** SOFT: wording she cut from earlier drafts (a repeated pattern, or one edit of a similar message). Not a ban. */
  readonly prefer_to_avoid: string[];
  readonly cta: string;
  readonly tone: string;
  readonly length: { readonly maxWords: number };
  readonly language: string;
  readonly channel: MessageChannel;
  readonly purpose: MessagePurpose;
}

export interface BriefProblem {
  /** blocking = cannot write a message the founder would send without it; warning = can draft, cannot send yet. */
  readonly severity: 'blocking' | 'warning';
  readonly code: 'sender_unconfirmed' | 'recipient_unnamed' | 'no_strategy' | 'no_reachable_channel';
  readonly detail: string;
}

// ── Prose + gate ──

export interface DraftMessage { readonly subject: string | null; readonly body: string }

export interface MessageWriteInput {
  readonly brief: CommunicationBrief;
  readonly samples: string[];
  /** Where the samples come from: this recipient context, or her messages to other kinds of recipients (voice only). */
  readonly samplesFrom?: 'this_context' | 'other_contexts' | 'any';
  /** Outreach she liked (not hers). */
  readonly liked?: string[];
  readonly acceptedPhrases: string[];
  /** Failures of the previous draft, for a repair. */
  readonly fix?: string[];
}

export interface IMessageModel {
  write(input: MessageWriteInput): Promise<unknown>;
}

export interface GateFailure {
  readonly code:
    | 'too_long' | 'placeholder' | 'invented_number' | 'corporate_phrase' | 'fake_warmth' | 'never_say' | 'multiple_asks'
    | 'not_specific' | 'unsigned' | 'long_subject' | 'judge'
    // evidence discipline (grounding): every claim as strong as the brief, never stronger
    | 'quantifier_inflation' | 'social_proof_distorted' | 'fact_not_needed' | 'writing_rule' | 'unsupported_claim' | 'broadened_claim' | 'irrelevant_offer' | 'offer_catalogue' | 'grounding';
  readonly detail: string;
}

// ── Factual grounding ──

export type ClaimKind = 'quantity' | 'result' | 'social_proof' | 'relationship' | 'offer' | 'recipient' | 'other';
export const CLAIM_KINDS: readonly ClaimKind[] = ['quantity', 'result', 'social_proof', 'relationship', 'offer', 'recipient', 'other'];

/** One factual statement the message makes, with the brief text that supports it (verified verbatim by the gate). */
export interface GroundedClaim {
  readonly claim: string;
  readonly kind: ClaimKind;
  /** Copied verbatim from the brief, or null when nothing in the brief supports it. */
  readonly support: string | null;
  /** exact = as strong as the support; broadened = vaguer or bigger quantity, or a stronger result than the support. */
  readonly verdict: 'exact' | 'broadened' | 'unsupported';
  readonly why: string;
}

/** Lists every factual claim in a draft and cites the brief for each. Only proposes: the gate verifies the citations. */
export interface IClaimGrounder {
  ground(input: { brief: CommunicationBrief; message: DraftMessage }): Promise<unknown>;
}

/** One generation attempt, for acceptance / debug only (never sent to the founder: a failed draft stays hidden). */
export interface DraftAttempt {
  readonly attempt: number;
  readonly message: DraftMessage | null;
  readonly deterministic: GateFailure[];
  readonly claims: GroundedClaim[] | null;
  readonly grounding: GateFailure[];
  readonly judge: GateFailure[] | null;
}

/** The model judge: the ten sendability questions, answered with reasons. Never the only check. */
export interface SendabilityJudgement {
  readonly sendable: boolean;
  readonly answers: { question: string; pass: boolean; why: string }[];
  /** Context the judge says is missing (e.g. "how the founder knows this doctor"). */
  readonly missingContext: string[];
}

export interface ISendabilityJudge {
  judge(input: { brief: CommunicationBrief; message: DraftMessage; samples: string[] }): Promise<unknown>;
}

export type DraftOutcome =
  | { readonly status: 'ready'; readonly brief: CommunicationBrief; readonly message: DraftMessage; readonly attempts: number; readonly warnings: BriefProblem[]; readonly messageId: string; readonly trace?: DraftAttempt[] }
  | { readonly status: 'needs_input'; readonly problems: BriefProblem[] }
  | {
      readonly status: 'failed'; readonly brief: CommunicationBrief; readonly attempts: number;
      /** Why the last draft failed (never shown as a usable draft). */
      readonly reasons: GateFailure[];
      readonly missingContext: string[];
      readonly clarify: string[];
      readonly trace?: DraftAttempt[];
    };
