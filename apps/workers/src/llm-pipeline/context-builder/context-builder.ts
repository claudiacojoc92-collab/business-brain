import type { PipelineContext } from '../pipeline-context';
import type { LLMRouter } from '@bb/infrastructure';
import type { PromptRegistryClient } from '@bb/infrastructure';
import { MEMORY_SNAPSHOT_STALENESS_MINUTES } from '@bb/shared';
import type { IFounderProfileRepository, IWeeklyCycleRepository } from '@bb/domain';
import type { IBusinessMemoryRepository } from '@bb/domain';
import { MemoryPackageAssembler } from './memory-package-assembler';
import { Pseudonymiser } from './pseudonymiser';

/**
 * Assembles the full PipelineContext before the pipeline begins.
 * Checks memory snapshot freshness (F018) and rebuilds if stale.
 * Source: Repository Structure V1 Section 02, Corrections Addendum V1 F018.
 */
export class ContextBuilder {
  private readonly memoryAssembler: MemoryPackageAssembler;

  constructor(
    private readonly founderRepo:   IFounderProfileRepository,
    private readonly cycleRepo:     IWeeklyCycleRepository,
    private readonly memoryRepo:    IBusinessMemoryRepository,
    private readonly llmRouter:     LLMRouter,
    private readonly promptRegistry:PromptRegistryClient,
  ) {
    this.memoryAssembler = new MemoryPackageAssembler(memoryRepo);
  }

  async build(params: {
    cycleId:      string;
    founderId:    string;
    cycleNumber:  number;
    correlationId:string;
    traceId:      string;
  }): Promise<{ context: PipelineContext; pseudonymiser: Pseudonymiser }> {
    const now = new Date();

    // Load founder
    const founder = await this.founderRepo.findById(params.founderId);
    if (!founder) {
      throw new Error(`Founder ${params.founderId} not found for pipeline context.`);
    }

    // Load memory snapshot — F018: check freshness
    const snapshot = await this.memoryRepo.findSnapshot(params.founderId);
    const memoryPackage = snapshot && !snapshot.isStale(MEMORY_SNAPSHOT_STALENESS_MINUTES, now)
      ? snapshot.snapshotJson
      : await this.memoryAssembler.build(params.founderId);

    // Load forward question (F011)
    const forwardQuestion = await this.cycleRepo.findForwardQuestion(params.founderId);

    // Load raw signals for this cycle from cycle.cycle_signals
    const cycleSignals = await this.cycleRepo.findSignalsForCycle(params.cycleId);
    const rawSignals = cycleSignals.map((s) => ({
      signalId:    s.signalId,
      signalType:  s.signalType,
      value:       s.value,
      collectedAt: s.collectedAt,
    }));

    // Build founder snapshot (pre-pseudonymisation)
    const founderSnapshot = {
      founderId:    founder.id,
      name:         founder.name,
      businessName: founder.businessName,
      offer: founder.currentOffer ? {
        name:           founder.currentOffer.name,
        primaryPromise: founder.currentOffer.primaryPromise,
        priceTier:      founder.currentOffer.priceTier,
        availability:   founder.currentOffer.availability,
        trustMultiplier:founder.currentOffer.trustMultiplier,
      } : {
        name: '', primaryPromise: '', priceTier: 'MID',
        availability: 'OPEN', trustMultiplier: 1.5,
      },
      audience: founder.currentAudience ? {
        description:        founder.currentAudience.description,
        sophisticationLevel:founder.currentAudience.sophisticationLevel,
        primaryPlatform:    founder.currentAudience.primaryPlatform,
        emotionalRegister:  founder.currentAudience.languageFingerprint.emotionalRegister,
        avoidPhrases:       [...founder.currentAudience.languageFingerprint.avoidPhrases],
      } : {
        description: '', sophisticationLevel: 'GROWTH',
        primaryPlatform: 'INSTAGRAM', emotionalRegister: 'ASPIRATIONAL',
        avoidPhrases: [],
      },
      voice: founder.currentVoice ? {
        sentenceRhythm:    founder.currentVoice.sentenceRhythm,
        openingPattern:    founder.currentVoice.openingPattern,
        convictionPosture: founder.currentVoice.convictionPosture,
        ctaStyle:          founder.currentVoice.ctaStyle,
        vulnerabilityLevel:founder.currentVoice.vulnerabilityLevel,
      } : {
        sentenceRhythm: 'MIXED', openingPattern: '',
        convictionPosture: 'OPINION_FIRST', ctaStyle: 'INVITATION',
        vulnerabilityLevel: 'LOW',
      },
      conviction: founder.currentConviction ? {
        statement:  founder.currentConviction.statement,
        domain:     founder.currentConviction.domain,
        confidence: founder.currentConviction.confidence,
      } : { statement: '', domain: '', confidence: 0.5 },
    };

    const pseudonymiser = new Pseudonymiser();
    const pseudonymisedSnapshot = pseudonymiser.pseudonymise(founderSnapshot);

    const context = {
      cycleId:      params.cycleId,
      founderId:    params.founderId,
      cycleNumber:  params.cycleNumber,
      correlationId:params.correlationId,
      traceId:      params.traceId,
      founderSnapshot:     pseudonymisedSnapshot,
      rawSignals,
      memoryPackage,
      typedSignals:        [],
      situationModel:      null,
      forwardQuestion,
      memoryInterrogation: null,
      hypotheses:          [],
      evaluation:          null,
      hardConstraints:     [],
      softConstraints:     [],
      selectedHypothesis:  null,
      selectedMode:        null,
      confidenceAssessment:null,
      critiqueOutcome:     null,
      critiqueReturnCount: 0,
      committedBrief:      null,
      intelligenceEvents:  [],
      isFallback:          false,
      fallbackReason:      null,
      errors:              [],
    };

    return { context, pseudonymiser };
  }
}
