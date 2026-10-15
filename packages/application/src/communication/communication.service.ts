import { generateId, NotFoundError, ValidationError } from '@bb/shared';
import type { ResultLoopRepos, Touch } from '../result-loop/contracts';
import type { ResultLoopService } from '../result-loop/result-loop.service';
import { buildBrief, offerItems, purposeFor } from './brief';
import { checkRelevance, decisionFromCorrection, parseCorrectionParts } from './relevance';
import { checkClaimGrounding, checkJudgement, checkSendability } from './sendability';
import { isPreferenceKey, parseSender, projectWritingProfile, recipientCategory, senderKey } from './writing';
import { authoredShare, draftEdits, removedWording } from './writing-rules';
import type {
  CommunicationBrief, DraftAttempt, DraftMessage, DraftOutcome, GateFailure, GroundedClaim, IClaimGrounder, IMessageModel, IRelevanceModel, RelevanceDecision, ISendabilityJudge, IWritingRepository, MessageChannel, MessagePurpose,
  PreferenceKey, RecipientCategory, SenderIdentity, WritingContext, WritingEntryKind, WritingEvidence, WritingProfile,
} from './contracts';
import { MESSAGE_PURPOSES, RECIPIENT_CATEGORIES } from './contracts';

/** Who did it in BB (the account user): recorded on evidence, never assumed to be the sender. */
const actor = (id?: string): { actor?: { kind: 'account_user'; id: string } } => (id ? { actor: { kind: 'account_user', id } } : {});

/** What the brief reads from the rest of BB (narrow ports; composition wires them to the real services). */
export interface CommunicationContextPort {
  strategy(businessId: string): Promise<{ goal: string; bet: string; referrer: string | null } | null>;
  /** Today's selected move (never the plan's first action). */
  todayMove(businessId: string): Promise<string | null>;
  /** The founder's own statements (resources, decisions, intentions, preferences); never outcomes. */
  founderSaid(businessId: string): Promise<string[]>;
  constraints(businessId: string): Promise<string[]>;
  businessOffer(businessId: string): Promise<string | null>;
}

export interface CommunicationDeps {
  readonly results: ResultLoopRepos;
  readonly resultService: ResultLoopService;
  readonly writing: IWritingRepository;
  readonly context: CommunicationContextPort;
  readonly model: IMessageModel;
  readonly judge: ISendabilityJudge;
  /** Factual grounding: every claim cited against the brief, verified by checkClaimGrounding (fails closed). */
  readonly grounder: IClaimGrounder;
  /** Proposes which offer parts matter to the recipient, ONCE per brief (checked by checkRelevance). */
  readonly relevance: IRelevanceModel;
  readonly now?: () => Date;
  readonly id?: () => string;
}

/** Repairs after the first draft (the operator's limit). */
export const MAX_REPAIRS = 2;

const CLARIFY: Partial<Record<GateFailure['code'], string>> = {
  not_specific: 'What do you know about this person: how you met, what they treat, why them in particular?',
  invented_number: 'If a number belongs in the message (a price, a date), tell BB the real one.',
  too_long: 'Is there one thing this message must say? BB will keep only that.',
  unsupported_claim: 'If something it tried to say is true (a result, who already sends you people), tell BB in your own words so it can use it.',
  broadened_claim: 'BB only states what you told it, as exactly as you said it.',
  irrelevant_offer: 'Which of your services matters to this person? Correct the focus above and BB writes again.',
};

function checkMessage(raw: unknown, channel: MessageChannel): DraftMessage | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const body = typeof r['body'] === 'string' ? r['body'].trim() : '';
  const subject = channel === 'EMAIL' && typeof r['subject'] === 'string' ? r['subject'].trim() || null : null;
  return body ? { subject, body } : null;
}

export class CommunicationService {
  private readonly now: () => Date;
  private readonly id: () => string;
  constructor(private readonly deps: CommunicationDeps) {
    this.now = deps.now ?? (() => new Date());
    this.id = deps.id ?? generateId;
  }

  /** The confirmed sender's writing profile; with a context, its rules and samples are that context's. */
  async profile(businessId: string, ctx: WritingContext | null = null): Promise<WritingProfile> {
    return projectWritingProfile(await this.deps.writing.list(businessId), ctx);
  }

  /** Confirm who signs for this business (explicit, once; reused until changed). `actorId` = the account user who did it. */
  async confirmSender(businessId: string, sender: unknown, actorId?: string): Promise<SenderIdentity> {
    const s = parseSender(sender);
    if (!s) throw new ValidationError('SENDER_INVALID', 'Name, role and business are required.');
    await this.append(businessId, 'SENDER', JSON.stringify(s), null, { kind: 'explicit', ...actor(actorId) });
    return s;
  }

  /**
   * An explicit piece of writing evidence about the CONFIRMED SENDER: a sample she wrote (optionally with the context it
   * was written in), a phrase she'd never say, a preference. Recorded with who entered it (the account user), which is not
   * assumed to be the sender. Needs a confirmed sender: evidence about nobody would shape nobody's writing.
   */
  async addWriting(businessId: string, kind: Exclude<WritingEntryKind, 'SENDER' | 'RELEVANCE'> | 'LIKED', text: string, key: string | null = null,
    opts: { actorId?: string; recipientCategory?: unknown; channel?: unknown; purpose?: unknown } = {}): Promise<WritingProfile> {
    const t = (text ?? '').trim();
    if (!t) throw new ValidationError('WRITING_EMPTY', 'Nothing to save.');
    const { sender } = await this.profile(businessId);
    if (!sender) throw new ValidationError('SENDER_UNCONFIRMED', 'Confirm who signs messages for this business first.');
    const who = { sender: senderKey(sender), ...actor(opts.actorId) };
    // Someone else's outreach she liked: kept apart from her own samples (never read as her voice).
    if (kind === 'LIKED') { await this.append(businessId, 'SAMPLE', t.slice(0, 4000), null, { kind: 'liked', ...who }); return this.profile(businessId); }
    if (kind === 'PREFERENCE' && !isPreferenceKey(key)) throw new ValidationError('WRITING_KEY', 'Unknown preference.');
    if (!['SAMPLE', 'ACCEPTED_PHRASE', 'REJECTED_PHRASE', 'NEVER_SAY', 'PREFERENCE'].includes(kind)) throw new ValidationError('WRITING_KIND', 'Unknown writing entry.');
    const where = kind === 'SAMPLE' ? {
      ...(RECIPIENT_CATEGORIES.includes(opts.recipientCategory as RecipientCategory) ? { recipientCategory: opts.recipientCategory as RecipientCategory } : {}),
      ...(opts.channel === 'EMAIL' || opts.channel === 'WHATSAPP' ? { channel: opts.channel as MessageChannel } : {}),
      ...(MESSAGE_PURPOSES.includes(opts.purpose as MessagePurpose) ? { purpose: opts.purpose as MessagePurpose } : {}),
    } : {};
    await this.append(businessId, kind, t.slice(0, kind === 'SAMPLE' ? 4000 : 300), kind === 'PREFERENCE' ? (key as PreferenceKey) : null, { kind: kind === 'SAMPLE' ? 'sample' : 'explicit', ...who, ...where });
    return this.profile(businessId);
  }

  /**
   * `trace: true` (acceptance / debug only) returns every attempt with its draft and failures. The API never passes it:
   * a failed draft is never shown to the founder.
   */
  async draft(businessId: string, contactId: string, opts: { channel?: MessageChannel; purpose?: MessagePurpose; trace?: boolean } = {}): Promise<DraftOutcome> {
    const contact = await this.deps.results.contacts.get(businessId, contactId);
    if (!contact) throw new NotFoundError('RESULT_NOT_FOUND', 'Contact not found.');
    const channel: MessageChannel = opts.channel === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL';
    const [touches, outcomes, open, entries, strategy, todayMove, founderSaid, constraints, businessOffer] = await Promise.all([
      this.deps.results.touches.list(businessId, contactId), this.deps.results.outcomes.list(businessId, contactId),
      this.deps.results.followUps.list(businessId, { status: 'OPEN', contactId }), this.deps.writing.list(businessId),
      this.deps.context.strategy(businessId), this.deps.context.todayMove(businessId), this.deps.context.founderSaid(businessId),
      this.deps.context.constraints(businessId), this.deps.context.businessOffer(businessId),
    ]);
    const openFollowUp = [...open].sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0] ?? null;
    const purpose = opts.purpose && MESSAGE_PURPOSES.includes(opts.purpose) ? opts.purpose : purposeFor(touches, outcomes, openFollowUp);
    // Her rules and samples for THIS context (kind of recipient + channel): register never travels across contexts.
    const profile = projectWritingProfile(entries, { recipientCategory: recipientCategory(contact), channel, purpose });
    const base = {
      profile, contact, touches, outcomes, openFollowUp, purpose, strategy, todayMove, founderSaid, constraints, businessOffer,
      language: await this.language(businessId), channel,
    };
    const first = buildBrief({ ...base, relevance: null });
    if (!first.brief) return { status: 'needs_input', problems: first.problems };
    // Relevance: decided ONCE here, then fixed for the writer, every repair, the grounder, the judge and the founder's view.
    const relevance = await this.decideRelevance(first.brief, profile, contact.id);
    const { brief, problems } = buildBrief({ ...base, relevance });
    if (!brief) return { status: 'needs_input', problems };

    const samples = profile.samples.map((s) => s.text.slice(0, 900)).slice(-5);
    const liked = profile.liked.map((s) => s.text.slice(0, 900));
    let fix: string[] | undefined;
    let reasons: GateFailure[] = [];
    let missingContext: string[] = [];
    const trace: DraftAttempt[] = [];
    const withTrace = <T extends object>(o: T): T => (opts.trace ? { ...o, trace } : o);
    for (let attempt = 1; attempt <= 1 + MAX_REPAIRS; attempt++) {
      let raw: unknown = null;
      try { raw = await this.deps.model.write({ brief, samples, samplesFrom: profile.samplesFrom, liked, acceptedPhrases: profile.acceptedPhrases, ...(fix ? { fix } : {}) }); } catch { raw = null; }
      const message = checkMessage(raw, channel);
      if (!message) {
        reasons = [{ code: 'judge', detail: 'The writer returned nothing usable.' }]; fix = ['Return the subject and body as JSON.'];
        trace.push({ attempt, message: null, deterministic: reasons, claims: null, grounding: [], judge: null });
        continue;
      }
      // 1. deterministic checks, 2. factual grounding (every claim cited against the brief), 3. the judge. All must pass.
      const deterministic = checkSendability(message, brief, profile);
      let claims: GroundedClaim[] | null = null;
      let grounding: GateFailure[] = [];
      let judge: GateFailure[] | null = null;
      if (!deterministic.length) {
        let rawClaims: unknown = null;
        try { rawClaims = await this.deps.grounder.ground({ brief, message }); } catch { rawClaims = null; }
        ({ claims, failures: grounding } = checkClaimGrounding(rawClaims, brief));
      }
      if (!deterministic.length && !grounding.length) {
        let judged = checkJudgement(null);
        try { judged = checkJudgement(await this.deps.judge.judge({ brief, message, samples })); } catch { /* fail closed */ }
        missingContext = judged.missingContext;
        judge = judged.sendable ? [] : judged.answers.filter((a) => !a.pass).map((a) => ({ code: 'judge' as const, detail: `${a.question} ${a.why}`.trim() }));
        if (!judged.sendable && !judge.length) judge = [{ code: 'judge', detail: 'The sendability check did not confirm it.' }];
      }
      trace.push({ attempt, message, deterministic, claims, grounding, judge });
      if (judge && !judge.length) return withTrace({ status: 'ready' as const, brief, message, attempts: attempt, warnings: problems, messageId: this.id() });
      reasons = [...deterministic, ...grounding, ...(judge ?? [])];
      // A repair carries EVERY failure seen so far, so fixing one thing never brings back an earlier one.
      fix = [...new Set([...(fix ?? []), ...reasons.map((r) => `${r.code}: ${r.detail}`)])];
    }
    const clarify = [...new Set([
      ...(brief.relevance.uncertain ? ['BB is not sure which of your services matters to this person. Pick the focus above.'] : []),
      ...reasons.map((r) => CLARIFY[r.code]).filter((x): x is string => Boolean(x)), ...missingContext,
    ])];
    return withTrace({ status: 'failed' as const, brief, attempts: 1 + MAX_REPAIRS, reasons, missingContext, clarify });
  }

  /**
   * The founder corrects which offer parts this message to ONE contact focuses on (remove one, add another verified offer
   * part, correct the reason). Stored as durable evidence (a RELEVANCE writing entry): it replaces BB's choice for this
   * contact and informs BB's choice for similar recipients. Never read as personality or as a new business fact: only parts
   * of the offer BB already holds can be chosen.
   */
  async correctRelevance(businessId: string, contactId: string, rawParts: unknown): Promise<RelevanceDecision> {
    const contact = await this.deps.results.contacts.get(businessId, contactId);
    if (!contact) throw new NotFoundError('RESULT_NOT_FOUND', 'Contact not found.');
    const items = offerItems(await this.deps.context.businessOffer(businessId));
    const parts = parseCorrectionParts(rawParts, items);
    if (!parts) throw new ValidationError('RELEVANCE_INVALID', 'Pick at most two of your services, each with a reason.');
    const previous = (await this.profile(businessId)).relevanceCorrections.find((c) => c.contactId === contactId);
    const before = previous?.parts.map((p) => p.offer_part) ?? [];
    const removed = before.filter((p) => !parts.some((x) => x.offer_part === p));
    const id = this.id();
    await this.deps.writing.append({
      id, businessId, kind: 'RELEVANCE', key: contactId,
      text: JSON.stringify({ recipientRole: contact.role, organisation: contact.organisationName, parts, removed }),
      evidence: { kind: 'explicit' }, createdAt: this.now().toISOString(),
    });
    return decisionFromCorrection({ entryId: id, contactId, recipientRole: contact.role, organisation: contact.organisationName, parts, removed }, items);
  }

  /** The founder's correction for this contact wins; otherwise BB proposes (with her corrections for others as evidence). */
  private async decideRelevance(brief: CommunicationBrief, profile: WritingProfile, contactId: string): Promise<RelevanceDecision> {
    const own = profile.relevanceCorrections.find((c) => c.contactId === contactId);
    if (own) return decisionFromCorrection(own, brief.offer_items);
    const input = {
      recipient: { name: brief.recipient_identity.name, organisation: brief.recipient_identity.organisation, role: brief.recipient_role },
      relationship_context: brief.relationship_context, why_now: brief.why_now, strategic_reason: brief.strategic_reason,
      offer_items: brief.offer_items, offer_or_value: brief.offer_or_value, supporting_context: brief.supporting_context,
      priorCorrections: profile.relevanceCorrections.filter((c) => c.contactId !== contactId).slice(-5), language: brief.language,
    };
    if (!input.offer_items.length) return { parts: [], uncertain: true, source: 'model', correctionId: null };
    let raw: unknown = null;
    try { raw = await this.deps.relevance.select(input); } catch { raw = null; }
    return checkRelevance(raw, input);
  }

  /**
   * The founder sent it (herself, from her own email / phone). Logged as a SENT touch (execution write-back: it also
   * completes the contact's open follow-up), and the sent text becomes writing evidence ABOUT THE SENDER it was signed as,
   * recorded with the account user who marked it sent (not assumed to be the same person):
   *  - BB's draft sent unchanged → accepted_draft: the wording was acceptable in this context, never "how she writes";
   *  - BB's draft edited → edit (draft, final, removed / added, context); the final counts as her own text only when most
   *    of it is her words (authoredShare), so a light edit never teaches BB its own prose as her voice;
   *  - no BB draft → her own sample, in this context.
   */
  async markSent(businessId: string, contactId: string, m: { messageId: string; subject: string | null; body: string; draftBody: string | null; channel: MessageChannel; actionRef?: string | null; purpose?: MessagePurpose; actorId?: string }): Promise<Touch> {
    const body = (m.body ?? '').trim();
    if (!body) throw new ValidationError('MESSAGE_EMPTY', 'Nothing was sent.');
    const contact = await this.deps.results.contacts.get(businessId, contactId);
    if (!contact) throw new NotFoundError('RESULT_NOT_FOUND', 'Contact not found.');
    // The purpose the draft was written for (read before this touch changes it): the context an edit belongs to.
    const [touches, outcomes, open, { sender }] = await Promise.all([this.deps.results.touches.list(businessId, contactId), this.deps.results.outcomes.list(businessId, contactId),
      this.deps.results.followUps.list(businessId, { status: 'OPEN', contactId }), this.profile(businessId)]);
    const purpose = m.purpose && MESSAGE_PURPOSES.includes(m.purpose) ? m.purpose : purposeFor(touches, outcomes, [...open].sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0] ?? null);
    const touch = await this.deps.resultService.logTouch(businessId, {
      contactId, channel: m.channel === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL', type: 'SENT', summary: (m.subject ? `${m.subject}: ` : '') + body.slice(0, 400),
      actionRef: m.actionRef ?? m.messageId, source: { kind: 'message', messageId: m.messageId, statement: body }, createdBy: 'FOUNDER',
    });
    const channel: MessageChannel = m.channel === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL';
    const context = { ref: touch.id, purpose, contactId, recipientCategory: recipientCategory(contact), channel, ...(sender ? { sender: senderKey(sender) } : {}), ...actor(m.actorId) };
    const draft = m.draftBody?.trim() ?? null;
    if (draft === null) { await this.append(businessId, 'SAMPLE', body.slice(0, 4000), null, { kind: 'sample', ...context }); return touch; }
    const diff = draftEdits(draft, body);
    if (!diff.removed.length && !diff.added.length) { await this.append(businessId, 'SAMPLE', body.slice(0, 4000), null, { kind: 'accepted_draft', ...context }); return touch; }
    // Her edit is writing evidence: BB's draft, her final version, exactly what she removed / added, and the message's
    // context. A removal is REJECTED_IN_CONTEXT (soft, about this message), never "she would not say this".
    await this.append(businessId, 'SAMPLE', body.slice(0, 4000), null, {
      kind: 'edit', ...context, before: draft.slice(0, 4000), after: body.slice(0, 4000), removed: removedWording(diff), added: diff.added.slice(0, 20),
      authoredShare: Math.round(authoredShare(body, diff.added) * 100) / 100,
    });
    return touch;
  }

  private language = async (_businessId: string): Promise<string> => 'en';

  /** Composition sets the content-language resolver (the business's stored content language). */
  withLanguage(resolve: (businessId: string) => Promise<string>): this {
    this.language = resolve;
    return this;
  }

  private async append(businessId: string, kind: WritingEntryKind, text: string, key: PreferenceKey | null, evidence: WritingEvidence) {
    await this.deps.writing.append({ id: this.id(), businessId, kind, key, text, evidence, createdAt: this.now().toISOString() });
  }
}
