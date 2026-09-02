import { generateId } from '@bb/shared';
import type { IUnderstandingSnapshotRepository, IAhaRepository, GovernedUnderstanding } from '../bi/index';
import type {
  IConversationRepository,
  IInformationNeedRepository,
  IFounderStateRepository,
  IFounderObservationRepository,
  IConversationModelPort,
  ConversationSession,
  ConversationTurn,
  FounderStateItem,
  FounderObservation,
  FounderStateKind,
} from './contracts';

/** Compact, founder-language-neutral summary of governed understanding for the conversation model. */
export function summarizeUnderstanding(u: GovernedUnderstanding | null): string {
  if (!u) return '';
  const parts: string[] = [];
  if (u.offer?.summary) parts.push(`Offer: ${u.offer.summary}`);
  if (u.positioning?.summary) parts.push(`Positioning: ${u.positioning.summary}`);
  if (u.audience?.addressed?.length) parts.push(`Audience addressed: ${u.audience.addressed.join('; ')}`);
  if (u.acquisition?.visiblePaths?.length) parts.push(`Visible conversion paths: ${u.acquisition.visiblePaths.join('; ')}`);
  if (u.contradictions?.length) parts.push(`Tensions: ${u.contradictions.map((c) => c.tension).join('; ')}`);
  if (u.unknowns?.length) parts.push(`Unknowns: ${u.unknowns.join('; ')}`);
  return parts.join('\n');
}

/** The two core needs BB always wants before Aha 2 (goal + horizon are founder-owned, never inferred). */
const CORE_NEEDS = [
  { key: 'goal', whatMissing: "The founder's primary goal", whyMatters: 'Sets what the whole strategy optimizes for.' },
  { key: 'horizon', whatMissing: "The founder's time horizon", whyMatters: 'Bounds what is realistic to pursue.' },
];

export interface FounderModelProjection {
  goal: FounderStateItem | null;
  horizon: FounderStateItem | null;
  constraints: FounderStateItem[];
  preferences: FounderStateItem[];
  decisions: FounderStateItem[];
  intentions: FounderStateItem[];
  challengePermissions: FounderStateItem[];
  resources: FounderStateItem[];
  businessCorrections: FounderStateItem[];
  observations: FounderObservation[]; // supported|confirmed only — distinct from stated
}

export interface ConversationView {
  session: ConversationSession;
  turns: ConversationTurn[];
  readyForAha2: boolean;
}

export interface ConversationDeps {
  conversations: IConversationRepository;
  needs: IInformationNeedRepository;
  state: IFounderStateRepository;
  observations: IFounderObservationRepository;
  model: IConversationModelPort;
  understanding: IUnderstandingSnapshotRepository;
  aha1: IAhaRepository;
}

export class ConversationService {
  constructor(private readonly deps: ConversationDeps) {}

  async startOrResume(businessId: string, founderId: string, businessName: string, language: string): Promise<ConversationView> {
    let session = await this.deps.conversations.getByBusiness(businessId);
    if (!session) {
      session = await this.deps.conversations.create({ id: generateId(), businessId, founderId, conversationLanguage: language });
      await this.deps.needs.seed(session.id, businessId, CORE_NEEDS);
      // Generate the opener from Aha 1 (no founder message yet).
      const out = await this.deps.model.step(await this.buildStepInput(businessId, businessName, language, session.id, null));
      const opener = out.nextQuestion ?? out.interpretation;
      if (opener) {
        await this.deps.conversations.appendTurn({ id: generateId(), sessionId: session.id, businessId, role: 'bb', content: opener, language, infoNeedKey: null });
      }
    }
    const turns = await this.deps.conversations.listTurns(session.id);
    return { session, turns, readyForAha2: session.status === 'ready_for_aha2' };
  }

  async submitResponse(businessId: string, founderId: string, businessName: string, message: string, language: string): Promise<ConversationView> {
    const session = await this.deps.conversations.getByBusiness(businessId);
    if (!session) throw new Error('NO_CONVERSATION');
    if (language !== session.conversationLanguage) await this.deps.conversations.setLanguage(session.id, language);

    const founderTurn = await this.deps.conversations.appendTurn({
      id: generateId(), sessionId: session.id, businessId, role: 'founder', content: message, language, infoNeedKey: null,
    });

    const out = await this.deps.model.step(await this.buildStepInput(businessId, businessName, language, session.id, message));

    // Route founder response to the correct state type (owned vs correction vs observed).
    for (const d of out.declarations) {
      await this.deps.state.append({
        id: generateId(), businessId, founderId,
        kind: d.kind, statement: d.statement, scope: d.scope ?? null, language, sourceTurnId: founderTurn.id,
      });
    }
    for (const c of out.businessCorrections) {
      await this.deps.state.append({
        id: generateId(), businessId, founderId,
        kind: 'business_correction', statement: c, scope: null, language, sourceTurnId: founderTurn.id,
      });
    }
    for (const oc of out.observationCandidates) {
      await this.deps.observations.observe(businessId, oc.behavior, founderTurn.id);
    }
    if (out.answeredNeedKeys.length) await this.deps.needs.markAnswered(session.id, out.answeredNeedKeys);
    if (out.newNeeds.length) await this.deps.needs.seed(session.id, businessId, out.newNeeds);

    const bbContent = [out.interpretation, out.nextQuestion].filter((s) => s && s.trim()).join('\n\n');
    if (bbContent) {
      await this.deps.conversations.appendTurn({ id: generateId(), sessionId: session.id, businessId, role: 'bb', content: bbContent, language, infoNeedKey: null });
    }

    const openNeeds = await this.deps.needs.listOpen(session.id);
    const ready = out.readyForAha2 || openNeeds.length === 0;
    await this.deps.conversations.setStatus(session.id, ready ? 'ready_for_aha2' : 'active', out.nextQuestion ?? null);

    const turns = await this.deps.conversations.listTurns(session.id);
    const updated = await this.deps.conversations.getByBusiness(businessId);
    return { session: updated ?? session, turns, readyForAha2: ready };
  }

  async pause(businessId: string): Promise<void> {
    const session = await this.deps.conversations.getByBusiness(businessId);
    if (session) await this.deps.conversations.setStatus(session.id, 'paused', session.currentFocus);
  }

  // ── founder-model control (inspect / correct / delete) ──
  deleteFounderState(businessId: string, id: string): Promise<FounderStateItem | null> {
    return this.deps.state.setStatus(businessId, id, 'deleted');
  }
  async markFounderStateTemporary(businessId: string, id: string, temporary: boolean): Promise<void> {
    await this.deps.state.setTemporary(businessId, id, temporary);
  }
  setObservationStatus(businessId: string, id: string, status: 'confirmed' | 'rejected' | 'deleted'): Promise<FounderObservation | null> {
    return this.deps.observations.setStatus(businessId, id, status);
  }

  async projection(businessId: string): Promise<FounderModelProjection> {
    const items = await this.deps.state.listActive(businessId);
    const pick = (k: FounderStateKind): FounderStateItem[] => items.filter((i) => i.kind === k);
    const obs = (await this.deps.observations.listActive(businessId)).filter((o) => o.status === 'supported' || o.status === 'confirmed');
    return {
      goal: pick('goal')[0] ?? null,
      horizon: pick('horizon')[0] ?? null,
      constraints: pick('constraint'),
      preferences: pick('preference'),
      decisions: pick('decision'),
      intentions: pick('intention'),
      challengePermissions: pick('challenge_permission'),
      resources: pick('resource'),
      businessCorrections: pick('business_correction'),
      observations: obs,
    };
  }

  private async buildStepInput(businessId: string, businessName: string, language: string, sessionId: string, latest: string | null) {
    const snap = await this.deps.understanding.latest(businessId);
    const aha = await this.deps.aha1.latest(businessId);
    const openNeeds = await this.deps.needs.listOpen(sessionId);
    const knownState = (await this.deps.state.listActive(businessId)).map((s) => ({ kind: s.kind, statement: s.statement }));
    const turns = await this.deps.conversations.listTurns(sessionId);
    return {
      businessName,
      interfaceLanguage: language,
      understandingSummary: summarizeUnderstanding(snap?.understanding ?? null),
      aha1: (aha?.findings ?? []).map((f) => ({ finding: f.finding })),
      openNeeds: openNeeds.map((n) => ({ key: n.key, whatMissing: n.whatMissing, whyMatters: n.whyMatters })),
      knownState,
      transcript: turns.slice(-20).map((t) => ({ role: t.role, content: t.content })),
      latestFounderMessage: latest,
    };
  }
}
