import { createHash } from 'node:crypto';
import { generateId, ValidationError } from '@bb/shared';
import type { IUnderstandingSnapshotRepository, GovernedUnderstanding } from '../bi/index';
import type {
  IVoiceModelPort,
  IVoiceRepository,
  VoiceSubject,
  SpeakingRole,
  SampleChannel,
  VoiceSample,
  VoiceWorkingSet,
  SampleContent,
  BoundaryType,
  NegativeSpaceCategory,
  FeedbackTarget,
  AuthorizedMessageSpec,
  LicensedProposition,
  CommunicationJobKind,
  MaterialType,
} from './contracts';
import { classifyVoiceSample, sampleText, isExplicitBoundary, type VoiceSampleContext } from './validation';
import { classifyLayers, isPermittedDiscourse } from './proposition-classes';
import { buildAuthorizationSnapshot, type AuthorizationSnapshot, type SafetyDecision } from './authorization-snapshot';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'with', 'through', 'in', 'on', 'for', 'as', 'is', 'are', 'our', 'we', 'your', 'that', 'this', 'by', 'be']);
const contentTokens = (s: string): Set<string> => new Set(norm(s).replace(/[^a-z0-9 ]/g, '').split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ing|ed|s)$/, '').replace(/^(proof|prove|proven)$/, 'proof')));
/** Two strategy fields express the SAME decision if their content-token sets overlap heavily (Jaccard ≥ 0.34). */
function sameDecision(a: string, b: string): boolean {
  const ta = contentTokens(a); const tb = contentTokens(b);
  if (!ta.size || !tb.size) return false;
  let inter = 0; for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter) >= 0.34;
}
function quotedTerms(statement: string): string[] {
  return [...statement.matchAll(/[‘'"“]([^’'"”]{2,40})[’'"”]/g)].map((m) => m[1]!.trim()).filter(Boolean);
}

export interface VoiceStrategyView {
  diagnosis: string; coreBet: string; messagingDirection: string; contentRole: string; audience: string; ctaDirection: string;
}

export interface VoiceEvent {
  type: 'seeded' | 'sample_generated' | 'idea_critique' | 'voice_evidence' | 'pattern_promoted' | 'boundary_added' | 'gate_failed' | 'first_pass_ok' | 'repaired_ok' | 'fail_closed' | 'job_blocked' | 'job_selected' | 'material_gap';
  detail?: string;
  attempts?: number;
}

export interface VoiceDeps {
  voice: IVoiceRepository;
  model: IVoiceModelPort;
  understanding: IUnderstandingSnapshotRepository;
  currentStrategy: (businessId: string) => Promise<VoiceStrategyView | null>;
  /** Founder-OWNED facts the founder may state (from founder_state). Founder declaration authority only. */
  founderFacts?: (businessId: string) => Promise<string[]>;
  /** Proof-bearing material the founder/business has licensed (real case/result/artifact/testimonial). Empty by default. */
  proofFacts?: (businessId: string) => Promise<string[]>;
  log?: (e: VoiceEvent) => void;
}

interface AllowedFacts { business: string[]; founderOwned: string[]; strategyDecisions: string[]; proof: string[]; blob: string }

// The proposition-preservation judge is stochastic: a single call can miss a leak it would catch on a
// re-run. So every candidate is validated with N independent passes and UNION-FAIL — ANY pass detecting
// a new proposition rejects the candidate (never majority-pass). Residual leaks after the bounded repair
// budget FAIL CLOSED (no least-harmful fallback, no persistence, no founder-visible output).
const PROPOSITION_CHECK_PASSES = 3;
const MAX_SEMANTIC_REPAIR_ATTEMPTS = 2;

type NewProposition = { clause: string; proposition: string; reason: string };
type SelectedJob = { kind: CommunicationJobKind; objective: string; refs: string[] };

export class VoiceService {
  constructor(private readonly deps: VoiceDeps) {}

  private async strategyOrThrow(businessId: string): Promise<VoiceStrategyView> {
    const s = await this.deps.currentStrategy(businessId);
    if (!s) throw new ValidationError('NO_CURRENT_STRATEGY', 'Voice calibration needs an adopted Current Strategy first.');
    return s;
  }

  // ── working set (relevance selection; small) ──
  async workingSet(businessId: string, subject: VoiceSubject, language: string, market: string | null, channel: SampleChannel | null, speakingRole: SpeakingRole): Promise<VoiceWorkingSet> {
    const ex = await this.deps.voice.listExamples(businessId, subject, language);
    const active = ex.filter((e) => e.status === 'active');
    const scoped = (e: { channel: string | null }) => !channel || !e.channel || e.channel === channel; // inherit when no channel-specific delta
    // FOUNDER-VERIFIED evidence only — discovered website 'seed' copy is unverified and kept separate.
    const accepted = active.filter((e) => ['strongly_accepted', 'founder_written', 'edited_after', 'accepted'].includes(e.kind) && scoped(e)).map((e) => e.text);
    const seed = active.filter((e) => e.kind === 'seed' && scoped(e)).map((e) => e.text);
    const rejected = active.filter((e) => e.kind === 'rejected').map((e) => e.text);
    // before→after edit pairs
    const byGroup = new Map<string, { before?: string; after?: string }>();
    for (const e of active) {
      if ((e.kind === 'edited_before' || e.kind === 'edited_after') && e.editGroupId) {
        const g = byGroup.get(e.editGroupId) ?? {};
        if (e.kind === 'edited_before') g.before = e.text; else g.after = e.text;
        byGroup.set(e.editGroupId, g);
      }
    }
    const edits = [...byGroup.values()].filter((g): g is { before: string; after: string } => Boolean(g.before && g.after));
    const negs = (await this.deps.voice.listNegativeSpace(businessId, subject)).filter((n) => n.status === 'active' && (!n.language || n.language === language)).map((n) => n.value);
    const bounds = (await this.deps.voice.listBoundaries(businessId, subject)).filter((b) => b.status === 'active' && (!b.language || b.language === language) && b.type !== 'evidence').map((b) => b.statement);
    const patterns = (await this.deps.voice.listPatterns(businessId, subject, language)).filter((p) => p.status === 'established' || p.status === 'tentative').map((p) => `${p.dimension}: ${p.statement}`);
    // Calibrated ONLY on founder-verified signal — unverified seed alone never makes a language "sound like you".
    const calibrated = accepted.length >= 1 || patterns.length >= 1 || negs.length >= 1 || bounds.length >= 1 || edits.length >= 1;
    return { subject, language, market, channel, speakingRole, acceptedExamples: accepted.slice(0, 6), seedExamples: seed.slice(0, 6), rejectedExamples: rejected.slice(0, 6), edits: edits.slice(0, 5), negativeSpace: negs, boundaries: bounds, establishedPatterns: patterns.slice(0, 12), calibrated };
  }

  private async claimBoundaries(businessId: string, subject: VoiceSubject, language: string): Promise<string[]> {
    return (await this.deps.voice.listBoundaries(businessId, subject)).filter((b) => b.status === 'active' && (b.type === 'evidence' || b.type === 'legal') && (!b.language || b.language === language)).map((b) => b.statement);
  }

  /** Claim materialization — the ONLY factual specifics the copy may assert (governed evidence + founder-owned + strategy decisions). */
  private async allowedFactsFor(businessId: string, strategy: VoiceStrategyView): Promise<AllowedFacts> {
    const snap = await this.deps.understanding.latest(businessId);
    const business = allowedBusinessFacts(snap?.understanding ?? null);
    const founderOwned = this.deps.founderFacts ? await this.deps.founderFacts(businessId) : [];
    const strategyDecisions = [strategy.diagnosis, strategy.coreBet, strategy.messagingDirection, strategy.contentRole, strategy.audience, strategy.ctaDirection].map((s) => (s ?? '').trim()).filter(Boolean);
    const proof = this.deps.proofFacts ? await this.deps.proofFacts(businessId) : [];
    return { business, founderOwned, strategyDecisions, proof, blob: [...business, ...founderOwned, ...strategyDecisions].join(' \n ') };
  }

  /**
   * PRIMARY semantic guard: run the proposition-preservation judge N times over the EXACT same
   * (candidate, spec, channel) and return the UNION of every new proposition any pass detected
   * (obvious duplicates normalized). UNION-FAIL — a non-empty result means the candidate is invalid,
   * even if some passes returned clean. NEVER majority-pass. If the judge port is absent, returns [].
   */
  private async propositionUnion(content: SampleContent, channel: SampleChannel, spec: AuthorizedMessageSpec): Promise<{ passes: NewProposition[][]; union: NewProposition[] }> {
    if (!this.deps.model.checkPropositions) return { passes: [], union: [] };
    const seen = new Set<string>();
    const union: NewProposition[] = [];
    const passes: NewProposition[][] = [];
    for (let pass = 0; pass < PROPOSITION_CHECK_PASSES; pass++) {
      let found: NewProposition[] = [];
      try { found = (await this.deps.model.checkPropositions({ content, channel, spec })).newPropositions; }
      catch { passes.push([]); continue; /* a failed judge call cannot be read as "clean" — other passes still gate */ }
      passes.push(found);
      for (const p of found) {
        const key = `${norm(p.clause)}::${norm(p.proposition)}`;
        if (seen.has(key)) continue;
        seen.add(key); union.push(p);
      }
    }
    return { passes, union };
  }

  // ── Voice REALIZATION of an AuthorizedMessageSpec (HOW). Order: realize → N-pass proposition check
  //    (UNION-FAIL, PRIMARY) → scoped semantic repair → re-check ALL N from zero → deterministic +
  //    judged backstops (defense-in-depth). Residual after the bounded budget FAILS CLOSED: returns
  //    null, so no least-harmful candidate is ever shown or persisted. ──
  private async generateWithWorkingSet(businessName: string, strategy: VoiceStrategyView, allowed: AllowedFacts, subject: VoiceSubject, language: string, market: string | null, channel: SampleChannel, speakingRole: SpeakingRole, job: SelectedJob, ws: VoiceWorkingSet): Promise<{ content: SampleContent; snapshot: AuthorizationSnapshot; decision: SafetyDecision } | null> {
    const claimBoundaries = ws.boundaries.filter((b) => /guarantee|prove|cannot|substantiate|legal|compliance/i.test(b));
    const spec = buildAuthorizedMessageSpec(strategy, allowed, speakingRole, job);
    // Immutable authorization snapshot — captured ONCE from the spec + resolved judge contract, stored with
    // the sample so a later audit replays from stored data, never from mutable current strategy.
    const judge = this.deps.model.judgeContract?.() ?? { modelId: 'stub', promptHash: 'stub' };
    const snapshot = buildAuthorizationSnapshot(spec, judge);
    const ctx: VoiceSampleContext = {
      language, ctaRequired: Boolean(spec.ctaFunction.trim()),
      negativeSpace: ws.negativeSpace,
      boundaryTerms: ws.boundaries.flatMap(quotedTerms),
      claimBoundaryTerms: claimBoundaries.flatMap(quotedTerms),
      acceptedExamples: [...ws.acceptedExamples, ...ws.seedExamples],
      factualFacts: [...allowed.business, ...allowed.founderOwned].join(' \n '),
    };
    const genInput = { businessName, language, market, channel, speakingRole, objective: job.objective, strategy, workingSet: ws, claimBoundaries, spec, allowedFacts: { business: allowed.business, founderOwned: allowed.founderOwned, strategyDecisions: allowed.strategyDecisions } };
    let content = (await this.deps.model.generateSample(genInput)).content;

    // attempts 0..MAX = initial candidate + up to MAX_SEMANTIC_REPAIR_ATTEMPTS repairs. Every candidate
    // (including each repair) gets a FRESH full validation set — no previous clean verdict is reused.
    for (let attempt = 0; attempt <= MAX_SEMANTIC_REPAIR_ATTEMPTS; attempt++) {
      const reasons: string[] = [];
      // DETERMINISTIC Layer 1/2 FIRST: audience-situation and sales-process (stance-gated) are classified
      // deterministically, so a CTA-only verdict never materially depends on the stochastic judge for these
      // known classes. Layer-1 violations are rejected here regardless of Layer 3.
      const layered = classifyLayers(content, spec);
      for (const v of layered.layer1Violations) {
        reasons.push(`LAYER1 ${v.propositionClass} "${v.clause}" — proposition-bearing and not authorized${v.stanceGated ? ' by an explicit behavioral stance' : ''}. Remove it; realize only the authorized message.`);
      }
      // PRIMARY: N-pass UNION-FAIL proposition preservation (Layer 3) over the RESIDUAL — any finding that
      // is in fact permitted Layer-2 discourse (brevity marker, invitation, relevance conditional) is
      // dropped, so the stochastic judge can never reject non-propositional framing.
      const judged = await this.propositionUnion(content, channel, spec);
      const union = judged.union.filter((p) => !isPermittedDiscourse(p.clause, spec));
      for (const p of union) reasons.push(`NEW PROPOSITION "${p.clause}" — ${p.reason}. Remove it; express only authorized propositions.`);
      // BACKSTOP (defense-in-depth), only consulted once the deterministic Layer-1 and semantic union are clean.
      if (reasons.length === 0) {
        const v = classifyVoiceSample(content, channel, ctx);
        for (const f of v.failures) reasons.push(`${f.gate}: ${f.detail}`);
        if (this.deps.model.auditClaims) {
          try {
            const viol = (await this.deps.model.auditClaims({ content, channel, allowed: { business: allowed.business, founderOwned: allowed.founderOwned, strategyDecisions: allowed.strategyDecisions } })).violations;
            for (const x of viol) reasons.push(`unauthorized_claim (${x.claimClass}): ${x.clause}`);
          } catch { /* judged backstop best-effort */ }
        }
      }

      if (reasons.length === 0) {
        this.deps.log?.(attempt === 0 ? { type: 'first_pass_ok' } : { type: 'repaired_ok', attempts: attempt });
        const decision: SafetyDecision = {
          deterministic: {
            layer1Violations: layered.layer1Violations.map((v) => ({ clause: v.clause, propositionClass: v.propositionClass ?? 'unknown' })),
            layer2Permitted: layered.permittedDiscourse.map((v) => ({ clause: v.clause, discourseCategory: v.discourseCategory ?? 'unknown' })),
            residualToJudge: layered.residual,
          },
          semanticJudge: {
            passes: judged.passes.map((ps) => ps.map((p) => ({ clause: p.clause, proposition: p.proposition }))),
            union: union.map((p) => ({ clause: p.clause, proposition: p.proposition })),
            repairAttempt: attempt,
          },
          finalDisposition: attempt === 0 ? 'persisted' : 'repaired_persisted',
        };
        return { content, snapshot, decision };
      }
      if (attempt === MAX_SEMANTIC_REPAIR_ATTEMPTS) break; // budget exhausted with residual → fail closed
      this.deps.log?.({ type: 'gate_failed', detail: reasons.slice(0, 3).join(' | ').slice(0, 200) });
      try {
        // Repair receives EVERY detected addition (the whole union), not just the first.
        content = (await this.deps.model.repairSample({ ...genInput, rejected: content, reason: 'Express ONLY the authorized propositions in the target voice. Do not explain why they are true, do not generalize about readers/markets/customers, do not add causal/comparative framing. Preserve voice FORM; remove these semantic additions: ' + reasons.join('; ') })).content;
      } catch { break; }
    }
    // FAIL CLOSED: residual unauthorized propositions after the bounded loop. There is no "mostly safe"
    // Voice output — the candidate is neither returned nor persisted.
    this.deps.log?.({ type: 'fail_closed', detail: 'residual-after-repair' });
    return null;
  }

  // ── start calibration (from adopted Current Strategy) ──
  async startCalibration(businessId: string, businessName: string, subject: VoiceSubject, language: string, market: string | null): Promise<{ sessionId: string; samples: VoiceSample[]; calibrated: boolean }> {
    const strategy = await this.strategyOrThrow(businessId);
    await this.deps.voice.getOrCreateProfile(businessId, subject);

    // seed discovery (website brand copy → BrandVoice; founder public → FounderPublicVoice)
    const existing = await this.deps.voice.listExamples(businessId, subject, language);
    if (existing.length === 0) {
      const snap = await this.deps.understanding.latest(businessId);
      const websiteCopy = websiteCopyFrom(snap?.understanding ?? null);
      if (websiteCopy.length) {
        try {
          const seeded = await this.deps.model.seedDiscover({ businessName, websiteCopy, founderPublic: [] });
          for (const s of seeded.examples) {
            await this.deps.voice.addExample({ businessId, subject: s.subject, kind: 'seed', text: s.text, language, market, channel: null, speakingRole: null, source: s.source });
          }
          if (seeded.examples.length) this.deps.log?.({ type: 'seeded', detail: `${seeded.examples.length} seed(s)` });
        } catch { /* seed best-effort */ }
      }
    }

    let session = await this.deps.voice.getSession(businessId, subject, language, market);
    if (!session) session = await this.deps.voice.createSession({ businessId, subject, language, market });

    const speakingRole = resolveSpeakingRole(subject);
    const allowed = await this.allowedFactsFor(businessId, strategy);
    const inv = materialInventory(allowed, strategy);
    const samples: VoiceSample[] = [];
    for (const channel of ['reel', 'caption'] as SampleChannel[]) {
      // FEASIBILITY FIRST: only calibrate on an EXTERNALLY-EXECUTABLE message the authorized material can perform.
      const { selected, blocked } = selectFeasibleJob(channel, strategy, inv);
      if (blocked) this.deps.log?.({ type: 'job_blocked', detail: `${blocked} (${channel}): no licensed material${selected ? ` — falling back to ${selected.kind}` : ''}` });
      if (!selected) {
        // No externally-executable job exists — do NOT manufacture meta-strategy copy.
        this.deps.log?.({ type: 'material_gap', detail: `${channel}: I can keep learning your voice, but I need a little more real business material (an offer detail, a piece of work, or a result) before I can make this example useful.` });
        continue;
      }
      this.deps.log?.({ type: 'job_selected', detail: `${selected.kind} (${channel})` });
      const ws = await this.workingSet(businessId, subject, language, market, channel, speakingRole);
      const gen = await this.generateWithWorkingSet(businessName, strategy, allowed, subject, language, market, channel, speakingRole, selected, ws);
      if (!gen) continue; // FAIL CLOSED — a candidate with residual unauthorized propositions is never persisted
      const s = await this.deps.voice.addSample({ businessId, sessionId: session.id, subject, language, market, channel, speakingRole, objective: selected.objective, content: gen.content, authorizationSnapshot: gen.snapshot, safetyDecision: gen.decision });
      samples.push(s);
      this.deps.log?.({ type: 'sample_generated', detail: channel });
    }
    const ws0 = await this.workingSet(businessId, subject, language, market, null, speakingRole);
    return { sessionId: session.id, samples, calibrated: ws0.calibrated };
  }

  /** Current calibration state without generating anything (page load). */
  async getSessionView(businessId: string, subject: VoiceSubject, language: string, market: string | null): Promise<{ sessionId: string; samples: VoiceSample[]; calibrated: boolean } | null> {
    const session = await this.deps.voice.getSession(businessId, subject, language, market);
    if (!session) return null;
    const samples = (await this.deps.voice.listSamples(businessId, session.id)).filter((s) => s.status === 'pending');
    const ws = await this.workingSet(businessId, subject, language, market, null, resolveSpeakingRole(subject));
    return { sessionId: session.id, samples, calibrated: ws.calibrated };
  }

  // ── founder reaction (natural language) ──
  async submitReaction(businessId: string, businessName: string, sampleId: string, reactionText: string): Promise<{ target: FeedbackTarget; sample: VoiceSample | null; note: string }> {
    const sample = await this.deps.voice.getSample(businessId, sampleId);
    if (!sample) throw new ValidationError('SAMPLE_NOT_FOUND', 'Sample not found.');
    const strategy = await this.strategyOrThrow(businessId);
    const allowed = await this.allowedFactsFor(businessId, strategy);
    const cls = await this.deps.model.classifyFeedback({ reactionText, sample: sample.content, channel: sample.channel });
    await this.deps.voice.addFeedback({ businessId, sessionId: sample.sessionId, sampleId, target: cls.target, signal: cls.signal, reactionText });
    await this.deps.voice.setSampleStatus(businessId, sampleId, 'reacted');

    const invR = materialInventory(allowed, strategy);
    if (cls.target === 'idea') {
      // Strategy critique — NOT voice evidence. Regenerate a strategically different sample; voice untouched.
      this.deps.log?.({ type: 'idea_critique' });
      const ws = await this.workingSet(businessId, sample.subject, sample.language, sample.market, sample.channel, sample.speakingRole);
      const jobI = selectFeasibleJob(sample.channel, strategy, invR).selected;
      if (!jobI) return { target: cls.target, sample: null, note: 'insufficient' }; // no externally-executable job
      const gen = await this.generateWithWorkingSet(businessName, strategy, allowed, sample.subject, sample.language, sample.market, sample.channel, sample.speakingRole, { ...jobI, objective: `${jobI.objective} (try a different angle)` }, ws);
      if (!gen) return { target: cls.target, sample: null, note: 'insufficient' }; // FAIL CLOSED — no founder-visible sample
      const next = await this.deps.voice.addSample({ businessId, sessionId: sample.sessionId, subject: sample.subject, language: sample.language, market: sample.market, channel: sample.channel, speakingRole: sample.speakingRole, objective: sample.objective, content: gen.content, authorizationSnapshot: gen.snapshot, safetyDecision: gen.decision });
      return { target: cls.target, sample: next, note: 'idea' };
    }

    // wording / both → real voice evidence
    this.deps.log?.({ type: 'voice_evidence', detail: cls.signal });
    if (cls.signal === 'reject' || cls.signal === 'edit' || cls.signal === 'founder_written') {
      await this.deps.voice.addExample({ businessId, subject: sample.subject, kind: 'rejected', text: sampleText(sample.content), language: sample.language, market: sample.market, channel: sample.channel, speakingRole: sample.speakingRole, source: 'generated' });
    }
    for (const n of cls.negativeSpace) await this.deps.voice.addNegativeSpace({ businessId, subject: sample.subject, category: n.category, value: n.value, language: sample.language });
    if (cls.explicitBoundary || isExplicitBoundary(reactionText)) {
      await this.deps.voice.addBoundary({ businessId, subject: sample.subject, type: 'voice', statement: cls.explicitBoundary ?? reactionText.trim(), language: sample.language });
      this.deps.log?.({ type: 'boundary_added' });
    }
    for (const inf of cls.inferred) await this.learnPattern(businessId, sample.subject, sample.language, inf.dimension, inf.statement, sampleId);

    const ws = await this.workingSet(businessId, sample.subject, sample.language, sample.market, sample.channel, sample.speakingRole);
    const jobW = selectFeasibleJob(sample.channel, strategy, invR).selected;
    if (!jobW) return { target: cls.target, sample: null, note: 'insufficient' }; // no externally-executable job
    const gen = await this.generateWithWorkingSet(businessName, strategy, allowed, sample.subject, sample.language, sample.market, sample.channel, sample.speakingRole, jobW, ws);
    if (!gen) return { target: cls.target, sample: null, note: 'insufficient' }; // FAIL CLOSED — learning recorded, but no unsafe sample shown
    const next = await this.deps.voice.addSample({ businessId, sessionId: sample.sessionId, subject: sample.subject, language: sample.language, market: sample.market, channel: sample.channel, speakingRole: sample.speakingRole, objective: sample.objective, content: gen.content, authorizationSnapshot: gen.snapshot, safetyDecision: gen.decision });
    return { target: cls.target, sample: next, note: cls.signal };
  }

  // ── founder edit (before→after: strongest directional evidence) ──
  async submitEdit(businessId: string, businessName: string, sampleId: string, editedText: string): Promise<{ sample: VoiceSample | null }> {
    const sample = await this.deps.voice.getSample(businessId, sampleId);
    if (!sample) throw new ValidationError('SAMPLE_NOT_FOUND', 'Sample not found.');
    const strategy = await this.strategyOrThrow(businessId);
    const allowed = await this.allowedFactsFor(businessId, strategy);
    const group = generateId();
    await this.deps.voice.addExample({ businessId, subject: sample.subject, kind: 'edited_before', text: sampleText(sample.content), language: sample.language, market: sample.market, channel: sample.channel, speakingRole: sample.speakingRole, source: 'generated', editGroupId: group });
    await this.deps.voice.addExample({ businessId, subject: sample.subject, kind: 'edited_after', text: editedText.trim(), language: sample.language, market: sample.market, channel: sample.channel, speakingRole: sample.speakingRole, source: 'founder_upload', editGroupId: group });
    await this.deps.voice.addFeedback({ businessId, sessionId: sample.sessionId, sampleId, target: 'wording', signal: 'edit', reactionText: editedText });
    await this.deps.voice.setSampleStatus(businessId, sampleId, 'reacted');
    try {
      const cls = await this.deps.model.classifyFeedback({ reactionText: `The founder rewrote it to: "${editedText}"`, sample: sample.content, channel: sample.channel });
      for (const inf of cls.inferred) await this.learnPattern(businessId, sample.subject, sample.language, inf.dimension, inf.statement, sampleId);
      for (const n of cls.negativeSpace) await this.deps.voice.addNegativeSpace({ businessId, subject: sample.subject, category: n.category, value: n.value, language: sample.language });
    } catch { /* best-effort inference */ }
    const ws = await this.workingSet(businessId, sample.subject, sample.language, sample.market, sample.channel, sample.speakingRole);
    const jobE = selectFeasibleJob(sample.channel, strategy, materialInventory(allowed, strategy)).selected;
    if (!jobE) return { sample: null }; // no externally-executable job — nothing to regenerate
    const gen = await this.generateWithWorkingSet(businessName, strategy, allowed, sample.subject, sample.language, sample.market, sample.channel, sample.speakingRole, jobE, ws);
    if (!gen) return { sample: null }; // FAIL CLOSED — edit learned, but no unsafe regeneration shown
    const next = await this.deps.voice.addSample({ businessId, sessionId: sample.sessionId, subject: sample.subject, language: sample.language, market: sample.market, channel: sample.channel, speakingRole: sample.speakingRole, objective: sample.objective, content: gen.content, authorizationSnapshot: gen.snapshot, safetyDecision: gen.decision });
    return { sample: next };
  }

  /** Lifecycle: one-off → candidate; repeated same-direction → tentative → established. Never a score. */
  private async learnPattern(businessId: string, subject: string, language: string, dimension: string, statement: string, exampleRef: string): Promise<void> {
    const existing = (await this.deps.voice.listPatterns(businessId, subject, language)).find((p) => p.status !== 'superseded' && p.dimension === dimension && norm(p.statement) === norm(statement));
    const rec = await this.deps.voice.upsertPattern({ businessId, subject, language, dimension, statement, exampleRef });
    const obs = rec.observations;
    let next = rec.status;
    if (obs >= 3) next = 'established'; else if (obs >= 2) next = 'tentative'; else next = 'candidate';
    if (next !== rec.status) { await this.deps.voice.promotePattern(businessId, rec.id, next); if (next !== 'candidate') this.deps.log?.({ type: 'pattern_promoted', detail: `${dimension}:${next}` }); }
    void existing;
  }

  async addBoundary(businessId: string, subject: VoiceSubject, type: BoundaryType, statement: string, language: string | null): Promise<void> {
    await this.deps.voice.addBoundary({ businessId, subject, type, statement, language });
  }
  async addNegative(businessId: string, subject: VoiceSubject, category: NegativeSpaceCategory, value: string, language: string | null): Promise<void> {
    await this.deps.voice.addNegativeSpace({ businessId, subject, category, value, language });
  }
  async removeBoundary(businessId: string, id: string): Promise<void> { await this.deps.voice.setBoundaryStatus(businessId, id, 'removed'); }
  async removeNegative(businessId: string, id: string): Promise<void> { await this.deps.voice.setNegativeSpaceStatus(businessId, id, 'removed'); }

  // ── founder-facing projection ──
  async projection(businessId: string, subject: VoiceSubject, language: string): Promise<{ calibrated: boolean; lines: string[] }> {
    const ws = await this.workingSet(businessId, subject, language, null, null, resolveSpeakingRole(subject));
    if (!ws.calibrated) return { calibrated: false, lines: [] };
    try { const out = await this.deps.model.projectVoice({ subject, language, workingSet: ws }); return { calibrated: true, lines: out.lines }; }
    catch { return { calibrated: true, lines: ws.establishedPatterns }; }
  }

  /** Sufficiency — no count / %, no required "sounds exactly like me" checkpoint. */
  async sufficiency(businessId: string, subject: VoiceSubject, language: string, market: string | null): Promise<{ sufficient: boolean; reasons: string[] }> {
    const ws = await this.workingSet(businessId, subject, language, market, null, resolveSpeakingRole(subject));
    const reasons: string[] = [];
    const knowsBoundaries = ws.negativeSpace.length > 0 || ws.boundaries.length > 0;
    const converged = ws.establishedPatterns.length >= 1 || ws.acceptedExamples.length >= 2 || ws.edits.length >= 1;
    if (knowsBoundaries) reasons.push('knows what to avoid');
    if (converged) reasons.push('examples/patterns converging');
    const sufficient = knowsBoundaries && converged;
    if (sufficient) { const s = await this.deps.voice.getSession(businessId, subject, language, market); if (s && s.status !== 'sufficient') await this.deps.voice.setSessionStatus(s.id, 'sufficient'); }
    return { sufficient, reasons };
  }

  /** Stable resolved-voice version identity (so later Assets can reference which voice produced them). */
  async snapshotVersion(businessId: string, subject: VoiceSubject, language: string, market: string | null): Promise<{ version: number }> {
    const ws = await this.workingSet(businessId, subject, language, market, null, resolveSpeakingRole(subject));
    const version = await this.deps.voice.nextVoiceVersion(businessId, subject, language, market);
    return this.deps.voice.saveVoiceVersion({ businessId, subject, language, market, version, contentHash: sha256(JSON.stringify(ws)), resolved: ws });
  }
}

// ── pure helpers ──

/**
 * Build the AuthorizedMessageSpec from Strategy (WHAT to accomplish) + Evidence (WHAT may be claimed).
 * Licensed propositions are ONLY: adopted strategy DECISIONS (as decisions, never as empirical facts),
 * governed business facts, and founder-owned facts. The strategy DIAGNOSIS is context only — it may
 * itself contain market claims, so it is never a licensed proposition. Sparse inputs → sparse spec.
 */
export function buildAuthorizedMessageSpec(strategy: VoiceStrategyView, allowed: AllowedFacts, speakingRole: SpeakingRole, job: SelectedJob | string): AuthorizedMessageSpec {
  const j: SelectedJob = typeof job === 'string' ? { kind: primaryJobKind(strategy.contentRole ?? ''), objective: job, refs: [] } : job;
  const licensed: LicensedProposition[] = [];
  // INTERNAL vs EXTERNAL. coreBet / messagingDirection / contentRole are strategy DECISIONS — they shape
  // sequencing/emphasis but are NOT publishable marketing content ("we lead with proof" is meta about the
  // strategy, not an external message). They become internalDecisions (guidance), NOT licensed
  // propositions, so the copy cannot state them; only real external material may be asserted. Fold
  // near-duplicate decisions into one.
  const lead = [strategy.coreBet, strategy.messagingDirection, strategy.contentRole].map((d) => (d ?? '').trim()).filter(Boolean);
  const internalDecisions: string[] = [];
  for (const d of lead) if (!internalDecisions.some((k) => sameDecision(k, d))) internalDecisions.push(d);
  // LICENSED (externally assertable) = only real business/founder-owned/proof material.
  for (const b of allowed.business) licensed.push({ text: b, source: 'business_evidence' });
  for (const f of allowed.founderOwned) licensed.push({ text: f, source: 'founder_owned' });
  const proofFacts = allowed.proof ?? [];
  for (const p of proofFacts) licensed.push({ text: p, source: 'behavior_result' }); // real, licensed proof material
  const unknowns: string[] = [];
  if (allowed.business.length === 0) unknowns.push('No licensed business facts about the offer/positioning are available.');
  if (proofFacts.length === 0) unknowns.push('No licensed historical client-result / metric / testimonial proof exists.');
  // Feasibility of THIS job against the authorized material (a strategy decision is not execution material).
  const inv = materialInventory(allowed, strategy);
  const feas = jobFeasibility(j.kind, inv);
  const refs = j.refs.length ? j.refs : feas.refs;
  return {
    communicationJob: j.objective,
    communicationJobKind: j.kind,
    requiredMaterialTypes: requiredMaterialTypes(j.kind),
    availableMaterialRefs: refs,
    feasibility: refs.length > 0 ? 'feasible' : 'blocked_missing_material',
    speakingRole,
    audience: strategy.audience?.trim() || 'the intended audience for this strategy',
    requiredMeaning: strategy.coreBet?.trim() || j.objective,
    licensedPropositions: licensed,
    internalDecisions, // shape the copy; never stated as content
    stanceStatements: allowed.founderOwned, // founder-owned includes deliberate stances/preferences
    ctaFunction: strategy.ctaDirection?.trim() || '',
    unknowns,
    forbiddenClasses: ['market/population', 'customer history or anecdote', 'reader psychology / behavior', 'causal or mechanism claims', 'comparative/superiority', 'outcomes/results', 'quality claims', 'capabilities', 'operational facts', 'historical proof'],
  };
}

/** Governed business facts the copy may assert (grounded in website evidence). */
function allowedBusinessFacts(u: GovernedUnderstanding | null): string[] {
  if (!u) return [];
  const out: string[] = [];
  if (u.offer?.summary) out.push(u.offer.summary);
  for (const x of u.offer?.explicit ?? []) out.push(x);
  if (u.positioning?.summary) out.push(u.positioning.summary);
  for (const x of u.positioning?.evidenceBacked ?? []) out.push(x);
  for (const x of u.audience?.addressed ?? []) out.push(x);
  for (const x of u.acquisition?.visiblePaths ?? []) out.push(x);
  for (const x of u.messaging?.recurringThemes ?? []) out.push(x);
  for (const c of u.contradictions ?? []) out.push(c.tension);
  return out;
}

function websiteCopyFrom(u: GovernedUnderstanding | null): string[] {
  if (!u) return [];
  const out: string[] = [];
  if (u.offer?.summary) out.push(u.offer.summary);
  if (u.positioning?.summary) out.push(u.positioning.summary);
  for (const m of u.messaging?.recurringThemes ?? []) out.push(m);
  return out.slice(0, 8);
}

function resolveSpeakingRole(subject: VoiceSubject): SpeakingRole {
  return subject === 'founder_public' ? 'founder_self' : 'brand_institutional';
}

// ── COMMUNICATION-JOB FEASIBILITY ──
// A job can only run if the AUTHORIZED MATERIAL can execute it. A strategy DECISION to "use proof" is
// NOT proof material — proof needs a real case/result/artifact/testimonial. When the strategy-preferred
// job is blocked, calibration falls back to the nearest strategically-relevant FEASIBLE job (state the
// decision, or express the CTA) and records the material gap — never fabricates meta-copy about proof.
const PROOF_TYPES: MaterialType[] = ['result_evidence', 'case_evidence', 'work_artifact', 'testimonial', 'before_after', 'demonstrable_output'];
// EXTERNALLY-EXECUTABLE jobs produce publishable marketing. 'positioning_decision' is INTERNAL (it states
// the strategy itself) and is never selected as a calibration job.
const EXTERNAL_JOBS: CommunicationJobKind[] = ['proof', 'offer', 'positioning', 'mechanism', 'cta'];
function requiredMaterialTypes(kind: CommunicationJobKind): MaterialType[] {
  switch (kind) {
    case 'proof': return PROOF_TYPES;
    case 'offer': return ['offer_fact'];
    case 'positioning': return ['offer_fact']; // a public positioning proposition is a governed business/positioning fact
    case 'mechanism': return ['mechanism_process'];
    case 'cta': return ['cta_direction'];
    case 'positioning_decision': return ['strategy_decision']; // INTERNAL only — not externally executable
  }
}
/** What material the authorized set can actually supply (refs are the concrete authorized strings). */
function materialInventory(allowed: AllowedFacts, strategy: VoiceStrategyView): Map<MaterialType, string[]> {
  const m = new Map<MaterialType, string[]>();
  const proofFacts = allowed.proof ?? [];
  if (proofFacts.length) for (const t of PROOF_TYPES) m.set(t, proofFacts); // real proof material, if licensed
  if (allowed.business.length) m.set('offer_fact', allowed.business);
  if (strategy.ctaDirection?.trim()) m.set('cta_direction', [strategy.ctaDirection.trim()]);
  const decisions = [strategy.coreBet, strategy.messagingDirection, strategy.contentRole].map((s) => (s ?? '').trim()).filter(Boolean);
  if (decisions.length) m.set('strategy_decision', decisions);
  return m;
}
function jobFeasibility(kind: CommunicationJobKind, inv: Map<MaterialType, string[]>): { feasible: boolean; refs: string[] } {
  const refs: string[] = [];
  for (const t of requiredMaterialTypes(kind)) for (const r of inv.get(t) ?? []) refs.push(r);
  return { feasible: refs.length > 0, refs };
}
function primaryJobKind(role: string): CommunicationJobKind {
  const r = role.toLowerCase();
  if (/proof|prove|proven|evidence|result|outcome|case|testimonial|demonstrat|track record/.test(r)) return 'proof';
  if (/offer|service|product|what we (do|offer)|pricing/.test(r)) return 'offer';
  if (/mechanism|how it works|process|method|approach/.test(r)) return 'mechanism';
  return 'positioning_decision';
}
function jobObjective(kind: CommunicationJobKind, s: VoiceStrategyView, channel: SampleChannel): string {
  const tail = channel === 'caption' ? `for ${s.audience}, ending on: ${s.ctaDirection}` : `for ${s.audience} — hook + short beats + a clear next step toward: ${s.ctaDirection}`;
  switch (kind) {
    case 'proof': return `Demonstrate the licensed proof (${s.contentRole}) ${tail}`;
    case 'offer': return `Clearly state the offer ${tail}`;
    case 'positioning': return `Express the public positioning ${tail}`;
    case 'mechanism': return `Explain how the work works ${tail}`;
    case 'cta': return `Extend the commercial invitation (${s.ctaDirection}) ${tail}`;
    case 'positioning_decision': return `Articulate the adopted strategic decision (${s.coreBet}) ${tail}`;
  }
}
/**
 * Choose an EXTERNALLY-EXECUTABLE job the authorized material can perform. Selection order: strategy relevance
 * → material feasibility → external executability. The strategy-preferred job leads; if it is blocked (missing
 * material or internal-only) we record the gap and fall to offer → positioning → cta. Returns `selected: null`
 * when NO externally-executable job exists (calibration must not manufacture meta-strategy copy).
 */
function selectFeasibleJob(channel: SampleChannel, strategy: VoiceStrategyView, inv: Map<MaterialType, string[]>): { selected: SelectedJob | null; blocked: CommunicationJobKind | null } {
  const preferred = primaryJobKind(channel === 'caption' ? strategy.messagingDirection : strategy.contentRole);
  // Only EXTERNAL jobs are eligible; an internal preferred kind (positioning_decision) is simply not in the chain.
  const chain = ([preferred, 'offer', 'positioning', 'cta'] as CommunicationJobKind[]).filter((k) => EXTERNAL_JOBS.includes(k)).filter((k, i, a) => a.indexOf(k) === i);
  let blocked: CommunicationJobKind | null = EXTERNAL_JOBS.includes(preferred) ? null : preferred; // internal-only preferred = already "blocked" for external use
  for (const kind of chain) {
    const f = jobFeasibility(kind, inv);
    if (f.feasible) return { selected: { kind, objective: jobObjective(kind, strategy, channel), refs: f.refs }, blocked };
    if (kind === preferred) blocked = preferred; // the strategy's first choice couldn't be executed
  }
  return { selected: null, blocked: blocked ?? preferred }; // nothing externally executable — omit the sample
}
